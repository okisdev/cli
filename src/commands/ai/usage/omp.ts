import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { DATA_TIMEZONE, dayKey } from '@/src/commands/ai/usage/dates';
import { resolveHardwareId } from '@/src/commands/ai/usage/hardware';
import { DEFAULT_INGEST_URL, type IngestDay, type IngestSession, postUsage } from '@/src/commands/ai/usage/ingest';
import { estimateCost, fetchGrokPricing } from '@/src/commands/ai/usage/pricing';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

const TOOL = 'omp';

export function defaultOmpHome(): string {
  return process.env.OMP_HOME ?? join(homedir(), '.omp');
}

interface OmpOptions {
  dry?: boolean;
  url?: string;
  token?: string;
  since?: string;
  ompHome?: string;
}

export interface OmpUsage {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  cost?: { total?: unknown };
}

export interface OmpEvent {
  type?: unknown;
  timestamp?: unknown;
  id?: unknown;
  message?: {
    usage?: OmpUsage;
    model?: unknown;
  };
}

interface DayAccumulator {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function listJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsonl(path));
    else if (entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

function parseEvents(text: string): OmpEvent[] {
  const events: OmpEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) events.push(value);
    } catch {}
  }
  return events;
}

export function aggregateOmpEvents(events: OmpEvent[], since?: string): { days: IngestDay[]; sessions: IngestSession[] } {
  const byKey = new Map<string, DayAccumulator>();
  const sessionsByDate = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'session') {
      const date = typeof event.timestamp === 'string' ? dayKey(event.timestamp) : null;
      if (!date || (since && date < since)) continue;
      sessionsByDate.set(date, (sessionsByDate.get(date) ?? 0) + 1);
      continue;
    }

    const usage = event.message?.usage;
    if (!usage) continue;

    const date = typeof event.timestamp === 'string' ? dayKey(event.timestamp) : null;
    const model = nonEmptyString(event.message?.model) ?? 'unknown';
    if (!date || (since && date < since)) continue;

    const key = `${date}\t${model}`;
    const acc = byKey.get(key) ?? { date, model, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 };
    acc.inputTokens += nonNegativeNumber(usage.input);
    acc.outputTokens += nonNegativeNumber(usage.output);
    acc.cachedTokens += nonNegativeNumber(usage.cacheRead) + nonNegativeNumber(usage.cacheWrite);
    acc.cost += nonNegativeNumber(usage.cost?.total);
    byKey.set(key, acc);
  }

  return {
    days: Array.from(byKey.values(), (acc) => ({
      date: acc.date,
      tool: TOOL,
      model: acc.model,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cachedTokens: acc.cachedTokens,
      cost: acc.cost,
      sessions: 0,
    })).filter((day) => day.inputTokens > 0 || day.outputTokens > 0 || day.cachedTokens > 0 || day.cost > 0),
    sessions: Array.from(sessionsByDate, ([date, sessions]) => ({ date, tool: TOOL, sessions })),
  };
}

async function priceOmpDays(days: IngestDay[]): Promise<IngestDay[]> {
  const models = new Set(days.filter((day) => day.cost === 0 && (day.inputTokens > 0 || day.outputTokens > 0 || day.cachedTokens > 0)).map((day) => day.model));
  const pricingByModel = await fetchGrokPricing(models);

  return days.map((day) => {
    if (day.cost > 0) return day;
    const pricing = pricingByModel.get(day.model);
    if (!pricing) return day;
    return {
      ...day,
      cost: estimateCost({ input: day.inputTokens, output: day.outputTokens, cacheRead: day.cachedTokens, cacheWrite: 0 }, pricing),
    };
  });
}

export async function buildOmpUsage(ompHome: string = defaultOmpHome(), since?: string): Promise<{ days: IngestDay[]; sessions: IngestSession[] }> {
  const files = listJsonl(join(ompHome, 'agent', 'sessions'));
  const events = files.flatMap((file) => parseEvents(readFileSync(file, 'utf8')));
  const aggregated = aggregateOmpEvents(events, since);
  return { days: await priceOmpDays(aggregated.days), sessions: aggregated.sessions };
}

export const omp = new Command()
  .name('omp')
  .description('collect Oh My Pi usage from ~/.omp session logs and upload it to the ingest endpoint')
  .option('-d, --dry', 'parse and print without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_INGEST_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('-s, --since <date>', 'only collect on or after this date (YYYY-MM-DD)', process.env.AI_USAGE_SINCE)
  .option('--omp-home <dir>', 'OMP data directory', defaultOmpHome())
  .action(async (opts: OmpOptions) => {
    let days: IngestDay[];
    let sessions: IngestSession[];
    try {
      const result = await buildOmpUsage(opts.ompHome as string, opts.since);
      days = result.days;
      sessions = result.sessions;
    } catch (error) {
      logger.error(`failed to read OMP home: ${(error as Error).message}`);
      process.exit(1);
    }

    if (days.length === 0 && sessions.length === 0) {
      logger.warn('no usable OMP usage found');
      return;
    }

    const source = { hardwareId: resolveHardwareId(), name: hostname() };
    const dry = opts.dry || !opts.token;
    if (dry) {
      const tokensByModel: Record<string, number> = {};
      for (const row of days) {
        tokensByModel[row.model] = (tokensByModel[row.model] ?? 0) + row.inputTokens + row.outputTokens + row.cachedTokens;
      }
      logger.log(`hardware: ${source.hardwareId}`);
      logger.log(`name:     ${source.name}`);
      logger.log(`omp home: ${opts.ompHome}`);
      logger.log(`days:     ${days.length}`);
      logger.log(`sessions: ${sessions.reduce((total, session) => total + session.sessions, 0)}`);
      logger.log(`tokens by model: ${JSON.stringify(tokensByModel)}`);
      if (days[0]) logger.log(`sample day: ${JSON.stringify(days[0])}`);
      if (!opts.token) logger.warn('AI_USAGE_INGEST_TOKEN not set — dry run only.');
      return;
    }

    const result = await postUsage({
      url: opts.url as string,
      token: opts.token as string,
      source,
      tz: DATA_TIMEZONE,
      days,
      sessions,
    });
    if (!result.ok) process.exit(1);
  });
