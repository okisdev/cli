import { readFileSync } from 'node:fs';
import { DATA_TIMEZONE, csvDay } from '@/src/commands/ai/usage/dates';
import { DEFAULT_INGEST_URL, type IngestDay, type IngestSession, postUsage } from '@/src/commands/ai/usage/ingest';
import { resolveMachine } from '@/src/commands/ai/usage/machine';
import { canonicalCursorModel, estimateCost, fetchCursorPricing } from '@/src/commands/ai/usage/pricing';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

const TOOL = 'cursor';

interface CursorOptions {
  csv?: string;
  dry?: boolean;
  url?: string;
  token?: string;
  machine?: string;
  since?: string;
}

interface DayAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
  events: number;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // handled by the following \n
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function toNumber(value: string): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function buildDays(csvPath: string, since?: string): Promise<{ days: IngestDay[]; sessions: IngestSession[] }> {
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length === 0) return { days: [], sessions: [] };

  const header = rows[0].map((column) => column.trim());
  const index = {
    date: header.indexOf('Date'),
    model: header.indexOf('Model'),
    inputWithCache: header.indexOf('Input (w/ Cache Write)'),
    inputWithoutCache: header.indexOf('Input (w/o Cache Write)'),
    cacheRead: header.indexOf('Cache Read'),
    output: header.indexOf('Output Tokens'),
    cost: header.indexOf('Cost'),
  };

  if (index.date === -1 || index.model === -1) {
    throw new Error('CSV is missing required Date or Model columns');
  }

  const byKey = new Map<string, DayAccumulator>();

  for (let i = 1; i < rows.length; i++) {
    const columns = rows[i];
    if (columns.length === 0) continue;

    const iso = columns[index.date]?.trim() ?? '';
    const model = columns[index.model]?.trim() ?? '';
    const date = csvDay(iso);
    if (!date || !model) continue;
    if (since && date < since) continue;

    const key = `${date}\t${model}`;
    const acc = byKey.get(key) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheWrite: 0,
      cacheRead: 0,
      cost: 0,
      events: 0,
    };

    acc.inputTokens += toNumber(columns[index.inputWithoutCache] ?? '');
    acc.outputTokens += toNumber(columns[index.output] ?? '');
    acc.cacheWrite += toNumber(columns[index.inputWithCache] ?? '');
    acc.cacheRead += toNumber(columns[index.cacheRead] ?? '');
    acc.cost += toNumber(columns[index.cost] ?? '');
    acc.events += 1;
    byKey.set(key, acc);
  }

  const modelsNeedingPricing = new Set<string>();
  for (const [key, acc] of Array.from(byKey)) {
    if (acc.cost === 0 && (acc.inputTokens > 0 || acc.outputTokens > 0 || acc.cacheRead > 0 || acc.cacheWrite > 0)) {
      const [, model] = key.split('\t');
      modelsNeedingPricing.add(canonicalCursorModel(model));
    }
  }
  const pricingByCanonicalModel = await fetchCursorPricing(modelsNeedingPricing);

  const days: IngestDay[] = [];
  const sessionsByDate = new Map<string, number>();

  for (const [key, acc] of Array.from(byKey)) {
    const [date, model] = key.split('\t');
    let cost = acc.cost;
    if (cost === 0) {
      const pricing = pricingByCanonicalModel.get(canonicalCursorModel(model));
      if (pricing) {
        cost = estimateCost({ input: acc.inputTokens, output: acc.outputTokens, cacheRead: acc.cacheRead, cacheWrite: acc.cacheWrite }, pricing);
      }
    }
    days.push({
      date,
      tool: TOOL,
      model,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cachedTokens: acc.cacheWrite + acc.cacheRead,
      cost,
      sessions: 0,
    });
    sessionsByDate.set(date, (sessionsByDate.get(date) ?? 0) + acc.events);
  }

  const sessions: IngestSession[] = Array.from(sessionsByDate.entries()).map(([date, count]) => ({
    date,
    tool: TOOL,
    sessions: count,
  }));

  return { days, sessions };
}

export const cursor = new Command()
  .name('cursor')
  .description('collect Cursor usage from an exported usage-events CSV and upload it to the ingest endpoint')
  .requiredOption('--csv <path>', 'path to the Cursor usage-events CSV export')
  .option('-d, --dry', 'parse and print without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_INGEST_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('-m, --machine <name>', 'machine identifier', resolveMachine())
  .option('-s, --since <date>', 'only collect on or after this date (YYYY-MM-DD)', process.env.AI_USAGE_SINCE)
  .action(async (opts: CursorOptions) => {
    let days: IngestDay[];
    let sessions: IngestSession[];
    try {
      const result = await buildDays(opts.csv as string, opts.since);
      days = result.days;
      sessions = result.sessions;
    } catch (error) {
      logger.error(`failed to parse CSV: ${(error as Error).message}`);
      process.exit(1);
    }

    if (days.length === 0) {
      logger.warn('no usable rows found in the CSV');
      return;
    }

    const dry = opts.dry || !opts.token;
    if (dry) {
      const tokensByModel: Record<string, number> = {};
      for (const row of days) {
        tokensByModel[row.model] = (tokensByModel[row.model] ?? 0) + row.inputTokens + row.outputTokens + row.cachedTokens;
      }
      logger.log(`machine:  ${opts.machine}`);
      logger.log(`csv:      ${opts.csv}`);
      logger.log(`days:     ${days.length}`);
      logger.log(`sessions: ${sessions.length}`);
      logger.log(`tokens by model: ${JSON.stringify(tokensByModel)}`);
      logger.log(`sample day: ${JSON.stringify(days[0])}`);
      logger.log(`sample session: ${JSON.stringify(sessions[0])}`);
      if (!opts.token) {
        logger.warn('AI_USAGE_INGEST_TOKEN not set — dry run only.');
      }
      return;
    }

    const result = await postUsage({
      url: opts.url as string,
      token: opts.token as string,
      machine: opts.machine as string,
      tz: DATA_TIMEZONE,
      days,
      sessions,
    });
    if (!result.ok) process.exit(1);
  });
