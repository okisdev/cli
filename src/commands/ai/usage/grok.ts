import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { DATA_TIMEZONE, dayKey } from '@/src/commands/ai/usage/dates';
import { resolveHardwareId } from '@/src/commands/ai/usage/hardware';
import { DEFAULT_INGEST_URL, type IngestDay, type IngestSession, postUsage } from '@/src/commands/ai/usage/ingest';
import { estimateCost, fetchGrokPricing } from '@/src/commands/ai/usage/pricing';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

const TOOL = 'grok';

export function defaultGrokHome(): string {
  return process.env.GROK_HOME ?? join(homedir(), '.grok');
}

interface GrokOptions {
  dry?: boolean;
  url?: string;
  token?: string;
  since?: string;
  grokHome?: string;
}

export interface GrokSessionSummary {
  created_at?: unknown;
  updated_at?: unknown;
  last_active_at?: unknown;
  current_model_id?: unknown;
  info?: {
    id?: unknown;
  };
}

export interface GrokSessionEntry {
  sid: string;
  summary: GrokSessionSummary;
}

export interface GrokSessionAggregation {
  modelBySid: Map<string, string>;
  sessions: IngestSession[];
}

interface GrokDayAccumulator {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
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

function dateValue(value: unknown): string | null {
  return typeof value === 'string' ? dayKey(value) : null;
}

export function aggregateGrokSessions(entries: GrokSessionEntry[], since?: string): GrokSessionAggregation {
  const modelBySid = new Map<string, string>();
  const sessionsByDate = new Map<string, number>();

  for (const entry of entries) {
    const sid = nonEmptyString(entry.summary.info?.id) ?? entry.sid;
    if (!sid) continue;

    modelBySid.set(sid, nonEmptyString(entry.summary.current_model_id) ?? 'unknown');

    const date = dateValue(entry.summary.last_active_at ?? entry.summary.updated_at ?? entry.summary.created_at);
    if (!date || (since && date < since)) continue;

    sessionsByDate.set(date, (sessionsByDate.get(date) ?? 0) + 1);
  }

  return {
    modelBySid,
    sessions: Array.from(sessionsByDate, ([date, sessions]) => ({ date, tool: TOOL, sessions })),
  };
}

export function aggregateGrokInference(logText: string, modelBySid: ReadonlyMap<string, string>, since?: string): IngestDay[] {
  const byKey = new Map<string, GrokDayAccumulator>();

  for (const line of logText.split(/\r?\n/)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(event) || event.msg !== 'shell.turn.inference_done' || !isRecord(event.ctx)) continue;

    const sid = nonEmptyString(event.sid);
    const date = dateValue(event.ts);
    if (!sid || !date || (since && date < since)) continue;

    const promptTokens = nonNegativeNumber(event.ctx.prompt_tokens);
    const cachedTokens = nonNegativeNumber(event.ctx.cached_prompt_tokens);
    const outputTokens = nonNegativeNumber(event.ctx.completion_tokens);
    const model = modelBySid.get(sid) ?? 'unknown';
    const key = `${date}\t${model}`;
    const acc = byKey.get(key) ?? { date, model, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

    acc.inputTokens += Math.max(0, promptTokens - cachedTokens);
    acc.outputTokens += outputTokens;
    acc.cachedTokens += cachedTokens;
    byKey.set(key, acc);
  }

  return Array.from(byKey.values(), (acc) => ({
    date: acc.date,
    tool: TOOL,
    model: acc.model,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cachedTokens: acc.cachedTokens,
    cost: 0,
    sessions: 0,
  }));
}

export async function priceGrokDays(days: IngestDay[]): Promise<IngestDay[]> {
  const models = new Set(days.filter((day) => day.inputTokens > 0 || day.outputTokens > 0 || day.cachedTokens > 0).map((day) => day.model));
  const pricingByModel = await fetchGrokPricing(models);

  return days.map((day) => {
    const pricing = pricingByModel.get(day.model);
    if (!pricing) return day;

    return {
      ...day,
      cost: estimateCost({ input: day.inputTokens, output: day.outputTokens, cacheRead: day.cachedTokens, cacheWrite: 0 }, pricing),
    };
  });
}

function summaryFrom(value: unknown): GrokSessionSummary {
  if (!isRecord(value)) return {};

  return {
    created_at: value.created_at,
    updated_at: value.updated_at,
    last_active_at: value.last_active_at,
    current_model_id: value.current_model_id,
    info: isRecord(value.info) ? { id: value.info.id } : undefined,
  };
}

function readSessionSummary(summaryPath: string): GrokSessionSummary | undefined {
  try {
    return summaryFrom(JSON.parse(readFileSync(summaryPath, 'utf8')));
  } catch {
    return undefined;
  }
}

function readGrokSessions(grokHome: string): GrokSessionEntry[] {
  const sessionsDir = join(grokHome, 'sessions');
  if (!statSync(sessionsDir).isDirectory()) {
    throw new Error(`sessions path is not a directory: ${sessionsDir}`);
  }

  const entries: GrokSessionEntry[] = [];
  for (const cwdEntry of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!cwdEntry.isDirectory()) continue;

    const cwdDir = join(sessionsDir, cwdEntry.name);
    let sessionEntries: ReturnType<typeof readdirSync>;
    try {
      sessionEntries = readdirSync(cwdDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;

      const summary = readSessionSummary(join(cwdDir, sessionEntry.name, 'summary.json'));
      if (summary) entries.push({ sid: sessionEntry.name, summary });
    }
  }

  return entries;
}

function readGrokLog(grokHome: string): string | undefined {
  const logPath = join(grokHome, 'logs', 'unified.jsonl');
  if (!existsSync(logPath)) {
    logger.warn(`Grok unified log not found: ${logPath}`);
    return undefined;
  }

  try {
    return readFileSync(logPath, 'utf8');
  } catch {
    logger.warn(`Grok unified log could not be read: ${logPath}`);
    return undefined;
  }
}

export async function buildGrokUsage(grokHome: string, since?: string): Promise<{ days: IngestDay[]; sessions: IngestSession[] }> {
  const sessionAggregation = aggregateGrokSessions(readGrokSessions(grokHome), since);
  const logText = readGrokLog(grokHome);
  const days = logText ? await priceGrokDays(aggregateGrokInference(logText, sessionAggregation.modelBySid, since)) : [];

  return { days, sessions: sessionAggregation.sessions };
}

export const grok = new Command()
  .name('grok')
  .description('collect Grok CLI usage from ~/.grok and upload it to the ingest endpoint')
  .option('-d, --dry', 'parse and print without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_INGEST_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('-s, --since <date>', 'only collect on or after this date (YYYY-MM-DD)', process.env.AI_USAGE_SINCE)
  .option('--grok-home <dir>', 'Grok CLI data directory', defaultGrokHome())
  .action(async (opts: GrokOptions) => {
    let days: IngestDay[];
    let sessions: IngestSession[];
    try {
      const result = await buildGrokUsage(opts.grokHome as string, opts.since);
      days = result.days;
      sessions = result.sessions;
    } catch (error) {
      logger.error(`failed to read Grok home: ${(error as Error).message}`);
      process.exit(1);
    }

    if (days.length === 0 && sessions.length === 0) {
      logger.warn('no usable Grok usage found');
      return;
    }

    const source = { hardwareId: resolveHardwareId(), name: hostname() };
    const dry = opts.dry || !opts.token;
    if (dry) {
      const tokensByModel: Record<string, number> = {};
      for (const row of days) {
        tokensByModel[row.model] = (tokensByModel[row.model] ?? 0) + row.inputTokens + row.outputTokens + row.cachedTokens;
      }
      logger.log(`hardware:  ${source.hardwareId}`);
      logger.log(`name:      ${source.name}`);
      logger.log(`grok home: ${opts.grokHome}`);
      logger.log(`days:      ${days.length}`);
      const sessionDates = sessions.map((session) => session.date).sort();
      const sessionRange = sessionDates.length > 0 ? ` (${sessionDates[0]} through ${sessionDates[sessionDates.length - 1]})` : '';
      logger.log(`sessions:  ${sessions.reduce((total, session) => total + session.sessions, 0)}${sessionRange}`);
      logger.log(`tokens by model: ${JSON.stringify(tokensByModel)}`);
      if (days[0]) logger.log(`sample day: ${JSON.stringify(days[0])}`);
      if (sessions[0]) logger.log(`sample session: ${JSON.stringify(sessions[0])}`);
      if (days.length === 0) logger.warn('no Grok token usage found');
      if (!opts.token) logger.warn('AI_USAGE_INGEST_TOKEN not set, dry run only.');
      return;
    }

    try {
      const result = await postUsage({
        url: opts.url as string,
        token: opts.token as string,
        source,
        tz: DATA_TIMEZONE,
        days,
        sessions,
      });
      if (!result.ok) process.exit(1);
    } catch (error) {
      logger.error(`failed to upload Grok usage: ${(error as Error).message}`);
      process.exit(1);
    }
  });
