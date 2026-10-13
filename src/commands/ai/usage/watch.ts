import { hostname } from 'node:os';
import { gatherUsage } from '@/src/commands/ai/usage/collect';
import { DATA_TIMEZONE, dayKey, tzLabel } from '@/src/commands/ai/usage/dates';
import { resolveHardwareId } from '@/src/commands/ai/usage/hardware';
import { DEFAULT_INGEST_URL, type IngestDay, type IngestSession, postUsage } from '@/src/commands/ai/usage/ingest';
import { DEFAULT_PROXY_URL, fetchProxyDays } from '@/src/commands/ai/usage/proxy';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

const DEFAULT_POLL_SECONDS = '30';
const DEFAULT_INTERVAL_MINUTES = '60';
const DEFAULT_MIN_GAP_MINUTES = '5';
const DEFAULT_SINCE_DAYS = '3';
const DEFAULT_TZ = '480';
const DAY_MS = 86_400_000;
const POLL_TIMEOUT_MS = 10_000;

interface WatchOptions {
  dry?: boolean;
  url?: string;
  token?: string;
  ccusage?: string;
  proxyUrl?: string;
  proxyToken?: string;
  tz?: string;
  pollSeconds?: string;
  intervalMinutes?: string;
  minGapMinutes?: string;
  sinceDays?: string;
}

interface PollResponse {
  machine: string | null;
  lastVisitAt: string | null;
  lastIngestAt: string | null;
  stale: boolean;
}

export interface DecideUploadInput {
  now: number;
  lastUploadAt: number | undefined;
  stale: boolean;
  intervalMs: number;
  minGapMs: number;
}

export interface DecideUploadResult {
  upload: boolean;
  reason: 'visit' | 'interval' | null;
}

export function decideUpload({ now, lastUploadAt, stale, intervalMs, minGapMs }: DecideUploadInput): DecideUploadResult {
  const elapsed = now - (lastUploadAt ?? 0);

  if (stale && elapsed >= minGapMs) return { upload: true, reason: 'visit' };
  if (elapsed >= intervalMs) return { upload: true, reason: 'interval' };
  return { upload: false, reason: null };
}

function pollUrlFrom(ingestUrl: string): string {
  return ingestUrl.replace(/\/ingest$/, '/poll');
}

export function sinceFor(lastIngestAt: string | null | undefined, sinceDays: number, now: number): string | undefined {
  if (lastIngestAt === null) return undefined;
  const windowStart = dayKey(new Date(now - sinceDays * DAY_MS)) ?? undefined;
  if (lastIngestAt === undefined) return windowStart;
  const ingestedDay = dayKey(lastIngestAt) ?? undefined;
  return ingestedDay && windowStart ? (ingestedDay < windowStart ? ingestedDay : windowStart) : windowStart;
}

export const watch = new Command()
  .name('watch')
  .description('watch for visitor traffic and upload AI usage on visits or on an interval')
  .option('-d, --dry', 'log decisions and collected counts without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_INGEST_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('--ccusage <bin>', 'path to the ccusage binary', process.env.CCUSAGE_BIN ?? 'ccusage')
  .option('--proxy-url <url>', 'llm-proxy usage feed URL', process.env.LLM_PROXY_URL ?? DEFAULT_PROXY_URL)
  .option('--proxy-token <token>', 'llm-proxy feed bearer token (LLM_PROXY_USAGE_TOKEN)', process.env.LLM_PROXY_USAGE_TOKEN)
  .option('--tz <minutes>', 'minutes ahead of UTC for day bucketing (default 480 = UTC+8)', process.env.LLM_PROXY_TZ ?? DEFAULT_TZ)
  .option('--poll-seconds <seconds>', 'how often to poll the ingest endpoint for visitor traffic', process.env.AI_USAGE_POLL_SECONDS ?? DEFAULT_POLL_SECONDS)
  .option('--interval-minutes <minutes>', 'maximum time between uploads regardless of visits', process.env.AI_USAGE_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES)
  .option('--min-gap-minutes <minutes>', 'minimum time between visit-triggered uploads', DEFAULT_MIN_GAP_MINUTES)
  .option('--since-days <n>', 'how many days back to collect on each upload', DEFAULT_SINCE_DAYS)
  .action(async (opts: WatchOptions) => {
    if (!opts.token && !opts.dry) {
      logger.error('AI_USAGE_INGEST_TOKEN not set — pass --token or --dry.');
      process.exit(1);
    }

    const source = { hardwareId: resolveHardwareId(), name: hostname() };
    const url = opts.url as string;
    const pollUrl = pollUrlFrom(url);
    const pollMs = Math.max(1, Number(opts.pollSeconds)) * 1_000;
    const intervalMs = Math.max(1, Number(opts.intervalMinutes)) * 60_000;
    const minGapMs = Math.max(1, Number(opts.minGapMinutes)) * 60_000;
    const sinceDays = Math.max(0, Number(opts.sinceDays));

    if (!opts.proxyToken) {
      logger.warn('LLM_PROXY_USAGE_TOKEN not set — skipping the llm-proxy leg.');
    }

    let lastUploadAt: number | undefined;
    let lastIngestAt: string | null | undefined;

    async function uploadLocal(reason: string, since: string | undefined): Promise<void> {
      let days: IngestDay[];
      let sessions: IngestSession[];
      try {
        ({ days, sessions } = await gatherUsage(opts.ccusage ?? 'ccusage', since));
      } catch (error) {
        logger.warn(`[${reason}] failed to gather usage: ${(error as Error).message}`);
        return;
      }

      if (opts.dry) {
        logger.log(`[${reason}] would upload ${days.length} day rows, ${sessions.length} session rows`);
        logger.log(`hardware: ${source.hardwareId}`);
        logger.log(`name:     ${source.name}`);
        return;
      }

      if (days.length === 0 && sessions.length === 0) {
        logger.log(`[${reason}] no usable AI usage found, skipping upload`);
        return;
      }

      try {
        const result = await postUsage({ url, token: opts.token as string, source, tz: DATA_TIMEZONE, days, sessions });
        if (result.ok) {
          lastUploadAt = Date.now();
          logger.log(`[${reason}] uploaded ${days.length} day rows, ${sessions.length} session rows -> ${result.status}, machine: ${result.machine ?? 'unknown'}`);
        } else {
          logger.warn(`[${reason}] upload rejected -> ${result.status}`);
        }
      } catch (error) {
        logger.warn(`[${reason}] failed to upload usage: ${(error as Error).message}`);
      }
    }

    async function uploadProxy(reason: string, since: string | undefined): Promise<void> {
      if (!opts.proxyToken) return;

      try {
        const days = await fetchProxyDays(opts.proxyUrl as string, opts.proxyToken, since, opts.tz);
        if (days.length === 0) {
          logger.log(`[${reason}] no llm-proxy usage found, skipping proxy upload`);
          return;
        }

        if (opts.dry) {
          logger.log(`[${reason}] would upload ${days.length} llm-proxy day rows`);
          logger.log('source: llm-proxy');
          return;
        }

        const result = await postUsage({ url, token: opts.token as string, source: { machine: 'llm-proxy' }, tz: tzLabel(opts.tz as string), days, sessions: [] });
        logger.log(`[${reason}] uploaded ${days.length} llm-proxy day rows -> ${result.status}`);
      } catch (error) {
        logger.warn(`[${reason}] failed to upload llm-proxy usage: ${(error as Error).message}`);
      }
    }

    async function runUploadCycle(reason: string): Promise<void> {
      const since = sinceFor(lastIngestAt, sinceDays, Date.now());
      await uploadLocal(reason, since);
      await uploadProxy(reason, since);
    }

    async function pollOnce(): Promise<PollResponse | undefined> {
      let poll: PollResponse;
      try {
        const response = await fetch(`${pollUrl}?hardwareId=${encodeURIComponent(source.hardwareId)}`, {
          headers: opts.token ? { authorization: `Bearer ${opts.token}` } : undefined,
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        if (!response.ok) {
          logger.warn(`poll ${pollUrl} -> ${response.status}`);
          return;
        }
        poll = (await response.json()) as PollResponse;
      } catch (error) {
        logger.warn(`poll failed: ${(error as Error).message}`);
        return;
      }

      lastIngestAt = poll.lastIngestAt;
      return poll;
    }

    async function pollTick(): Promise<void> {
      const poll = await pollOnce();
      if (!poll) return;
      const decision = decideUpload({ now: Date.now(), lastUploadAt, stale: poll.stale, intervalMs, minGapMs });
      if (decision.upload && decision.reason) {
        await runUploadCycle(decision.reason);
      }
    }

    function scheduleTick(): void {
      setTimeout(() => {
        pollTick()
          .catch((error) => logger.warn(`tick failed: ${(error as Error).message}`))
          .finally(scheduleTick);
      }, pollMs);
    }

    await pollOnce();
    await runUploadCycle('startup');
    scheduleTick();
  });
