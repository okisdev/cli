import { execFileSync } from 'node:child_process';
import { DATA_TIMEZONE, dayKey } from '@/src/commands/ai/usage/dates';
import { buildGrokUsage, defaultGrokHome, priceGrokDays } from '@/src/commands/ai/usage/grok';
import { buildOmpUsage } from '@/src/commands/ai/usage/omp';
import { DEFAULT_INGEST_URL, type IngestDay, type IngestSession, postUsage } from '@/src/commands/ai/usage/ingest';
import { resolveMachine } from '@/src/commands/ai/usage/machine';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

interface CollectOptions {
  dry?: boolean;
  url?: string;
  token?: string;
  machine?: string;
  ccusage?: string;
  since?: string;
}

interface ModelBreakdown {
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
}

interface DailyItem {
  period?: string;
  date?: string;
  metadata?: { agents?: string[] };
  modelBreakdowns?: ModelBreakdown[];
}

interface SessionItem {
  agent?: string;
  metadata?: { lastActivity?: string };
}

function sum(...values: (number | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

// ccusage's "claude" agent is Claude Code; keep the existing tool id so historical rows match.
function toolForAgent(agent: string): string {
  return agent === 'claude' ? 'claude-code' : agent;
}

function runCcusage(bin: string, args: string[]): unknown {
  const stdout = execFileSync(bin, [...args, '--json'], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, TZ: DATA_TIMEZONE },
  });
  return JSON.parse(stdout);
}

function buildDays(bin: string, since?: string): IngestDay[] {
  const args = ['daily'];
  if (since) args.push('--since', since);
  const payload = runCcusage(bin, args) as { daily?: DailyItem[] };
  const items = payload.daily ?? [];

  // Learn model -> agent from single-agent days (where attribution is certain),
  // so multi-agent days can be split without a hardcoded model-prefix table.
  const modelToAgent = new Map<string, string>();
  for (const item of items) {
    const agents = item.metadata?.agents ?? [];
    if (agents.length === 1) {
      for (const model of item.modelBreakdowns ?? []) {
        if (model.modelName) modelToAgent.set(model.modelName, agents[0]);
      }
    }
  }

  const days: IngestDay[] = [];
  for (const item of items) {
    const date = item.period ?? item.date;
    if (!date) continue;
    const agents = item.metadata?.agents ?? [];
    for (const model of item.modelBreakdowns ?? []) {
      if (!model.modelName) continue;
      const agent = agents.length === 1 ? agents[0] : (modelToAgent.get(model.modelName) ?? inferAgentFromModel(model.modelName) ?? 'unknown');
      days.push({
        date,
        tool: toolForAgent(agent),
        model: model.modelName,
        inputTokens: model.inputTokens ?? 0,
        outputTokens: model.outputTokens ?? 0,
        cachedTokens: sum(model.cacheCreationTokens, model.cacheReadTokens),
        cost: model.cost ?? 0,
        sessions: 0,
      });
    }
  }
  return days;
}

export function inferAgentFromModel(modelName: string): string | undefined {
  if (modelName.startsWith('claude')) return 'claude';
  if (modelName.startsWith('gpt') || modelName.startsWith('openai/') || modelName.startsWith('o1') || modelName.startsWith('o3')) return 'codex';
  if (modelName.startsWith('glm')) return 'opencode';
  if (modelName.startsWith('stepfun')) return 'hermes';
  if (modelName.startsWith('grok')) return 'grok';
  return undefined;
}

function buildSessions(bin: string, since?: string): IngestSession[] {
  const args = ['session'];
  if (since) args.push('--since', since);
  const payload = runCcusage(bin, args) as { session?: SessionItem[] };
  const counts = new Map<string, number>();
  for (const session of payload.session ?? []) {
    const iso = session.metadata?.lastActivity;
    const agent = session.agent;
    if (!iso || !agent) continue;
    const date = dayKey(iso);
    if (!date) continue;
    const tool = toolForAgent(agent);
    const key = `${date}\t${tool}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, sessions]) => {
    const [date, tool] = key.split('\t');
    return { date, tool, sessions };
  });
}

// ccusage cannot price grok *-build ids (they are not API SKUs), so its cost for those rows is garbage; rebill them at the base model's list price.
export async function repriceGrokBuildRows(days: IngestDay[]): Promise<IngestDay[]> {
  const buildRows = days.filter((row) => row.tool === 'grok' && row.model.endsWith('-build'));
  if (buildRows.length === 0) return days;

  const repriced = new Map((await priceGrokDays(buildRows)).map((row) => [`${row.date}\t${row.model}`, row]));
  return days.map((row) => (row.tool === 'grok' ? (repriced.get(`${row.date}\t${row.model}`) ?? row) : row));
}

export async function gatherUsage(bin: string, since?: string, grokHome: string = defaultGrokHome()): Promise<{ days: IngestDay[]; sessions: IngestSession[] }> {
  const days = await repriceGrokBuildRows(buildDays(bin, since));
  const sessions = buildSessions(bin, since);

  try {
    const grokUsage = await buildGrokUsage(grokHome, since);
    const grokDates = new Set(days.filter((row) => row.tool === 'grok').map((row) => row.date));
    days.push(...grokUsage.days.filter((row) => !grokDates.has(row.date)));
    sessions.push(...grokUsage.sessions.filter((row) => !grokDates.has(row.date)));
  } catch (error) {
    logger.warn(`skipping Grok usage: ${(error as Error).message}`);
  }

  try {
    const ompUsage = await buildOmpUsage(undefined, since);
    days.push(...ompUsage.days);
    sessions.push(...ompUsage.sessions);
  } catch (error) {
    logger.warn(`skipping OMP usage: ${(error as Error).message}`);
  }

  return { days, sessions };
}

export const collect = new Command()
  .name('collect')
  .description('collect AI usage via ccusage and upload it to the ingest endpoint')
  .option('-d, --dry', 'parse and print without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_INGEST_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('-m, --machine <name>', 'machine identifier', resolveMachine())
  .option('--ccusage <bin>', 'path to the ccusage binary', process.env.CCUSAGE_BIN ?? 'ccusage')
  .option('-s, --since <date>', 'only collect on or after this date (YYYY-MM-DD)', process.env.AI_USAGE_SINCE)
  .passThroughOptions()
  .action(async (opts: CollectOptions) => {
    const bin = opts.ccusage ?? 'ccusage';
    let days: IngestDay[];
    let sessions: IngestSession[];
    try {
      ({ days, sessions } = await gatherUsage(bin, opts.since));
    } catch (error) {
      logger.error(`failed to run ccusage: ${(error as Error).message}`);
      logger.warn('ensure ccusage is on PATH or pass --ccusage <bin>');
      process.exit(1);
    }

    if (days.length === 0 && sessions.length === 0) {
      logger.warn('no usable AI usage found');
      return;
    }

    const dry = opts.dry || !opts.token;
    if (dry) {
      const tokensByTool: Record<string, number> = {};
      for (const row of days) {
        tokensByTool[row.tool] = (tokensByTool[row.tool] ?? 0) + row.inputTokens + row.outputTokens + row.cachedTokens;
      }
      const sessionsByTool: Record<string, number> = {};
      for (const row of sessions) {
        sessionsByTool[row.tool] = (sessionsByTool[row.tool] ?? 0) + row.sessions;
      }
      logger.log(`machine:  ${opts.machine}`);
      logger.log(`days:     ${days.length}`);
      logger.log(`sessions: ${sessions.length}`);
      logger.log(`tokens by tool: ${JSON.stringify(tokensByTool)}`);
      logger.log(`sessions by tool: ${JSON.stringify(sessionsByTool)}`);
      logger.log(`sample day: ${JSON.stringify(days[0] ?? null)}`);
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
