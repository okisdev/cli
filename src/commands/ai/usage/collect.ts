import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

const DEFAULT_URL = 'https://okis.dev/api/ai/usage/ingest';

interface IngestDay {
  date: string;
  tool: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cost?: number;
  sessions?: number;
}

interface CollectOptions {
  dry?: boolean;
  url?: string;
  token?: string;
  machine?: string;
  ccusage?: string;
}

interface ClaudeModelBreakdown {
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
}

interface ClaudeDailyItem {
  period?: string;
  date?: string;
  modelBreakdowns?: ClaudeModelBreakdown[];
}

interface CodexModelValue {
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
}

interface CodexDailyItem {
  date?: string;
  period?: string;
  models?: Record<string, CodexModelValue>;
  costUSD?: number;
}

function sum(...values: (number | undefined)[]) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function runCcusage(bin: string, args: string[]): unknown {
  const stdout = execFileSync(bin, [...args, '--json'], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function claudeCodeRows(bin: string): IngestDay[] {
  const payload = runCcusage(bin, ['daily']) as { daily?: ClaudeDailyItem[] };
  const rows: IngestDay[] = [];
  for (const day of payload.daily ?? []) {
    const date = day.period ?? day.date;
    if (!date) continue;
    for (const model of day.modelBreakdowns ?? []) {
      if (!model.modelName?.startsWith('claude')) continue;
      rows.push({
        date,
        tool: 'claude-code',
        model: model.modelName,
        inputTokens: model.inputTokens ?? 0,
        outputTokens: model.outputTokens ?? 0,
        cachedTokens: sum(model.cacheCreationTokens, model.cacheReadTokens),
        cost: model.cost ?? 0,
        sessions: 0,
      });
    }
  }
  return rows;
}

function codexRows(bin: string): IngestDay[] {
  const payload = runCcusage(bin, ['codex']) as { daily?: CodexDailyItem[] };
  const rows: IngestDay[] = [];
  for (const day of payload.daily ?? []) {
    const date = day.date ?? day.period;
    if (!date) continue;
    const models = Object.entries(day.models ?? {});
    const dayTokens = sum(...models.map(([, value]) => value.totalTokens)) || 1;
    for (const [model, value] of models) {
      rows.push({
        date,
        tool: 'codex',
        model,
        inputTokens: value.inputTokens ?? 0,
        outputTokens: sum(value.outputTokens, value.reasoningOutputTokens),
        cachedTokens: sum(value.cacheCreationTokens, value.cacheReadTokens),
        cost: (day.costUSD ?? 0) * ((value.totalTokens ?? 0) / dayTokens),
        sessions: 0,
      });
    }
  }
  return rows;
}

function collectDays(bin: string): IngestDay[] {
  return [...claudeCodeRows(bin), ...codexRows(bin)];
}

export const collect = new Command()
  .name('collect')
  .description('collect AI usage via ccusage and upload it to the ingest endpoint')
  .option('-d, --dry', 'parse and print without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('-m, --machine <name>', 'machine identifier', process.env.AI_USAGE_MACHINE ?? hostname())
  .option('--ccusage <bin>', 'path to the ccusage binary', process.env.CCUSAGE_BIN ?? 'ccusage')
  .action(async (opts: CollectOptions) => {
    const bin = opts.ccusage ?? 'ccusage';
    let days: IngestDay[];
    try {
      days = collectDays(bin);
    } catch (error) {
      logger.error(`failed to run ccusage: ${(error as Error).message}`);
      logger.warn('ensure ccusage is on PATH or pass --ccusage <bin>');
      process.exit(1);
    }

    const dry = opts.dry || !opts.token;
    if (dry) {
      const byTool: Record<string, number> = {};
      for (const row of days) {
        byTool[row.tool] = (byTool[row.tool] ?? 0) + (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.cachedTokens ?? 0);
      }
      logger.log(`machine:  ${opts.machine}`);
      logger.log(`rows:     ${days.length}`);
      logger.log(`tokens by tool: ${JSON.stringify(byTool)}`);
      logger.log(`sample: ${JSON.stringify(days.slice(0, 3), null, 2)}`);
      if (!opts.token) {
        logger.warn('AI_USAGE_INGEST_TOKEN not set — dry run only.');
      }
      return;
    }

    const response = await fetch(opts.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({ machine: opts.machine, days }),
    });

    logger.log(`POST ${opts.url} -> ${response.status}`);
    const text = await response.text();
    if (text) logger.log(text);
    if (!response.ok) process.exit(1);
  });
