import { tzLabel } from '@/src/commands/ai/usage/dates';
import { DEFAULT_INGEST_URL, type IngestDay, postUsage } from '@/src/commands/ai/usage/ingest';
import { logger } from '@/src/utils/logger';
import { Command } from 'commander';

export const DEFAULT_PROXY_URL = 'https://llm.harisfox.com/api/usage/daily';
const DEFAULT_TZ = '480';

interface ProxyDay {
  date: string;
  tool: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
}

interface ProxyResponse {
  days?: ProxyDay[];
}

interface ProxyOptions {
  dry?: boolean;
  url?: string;
  token?: string;
  machine?: string;
  since?: string;
  proxyUrl?: string;
  proxyToken?: string;
  tz?: string;
}

export async function fetchProxyDays(proxyUrl: string, proxyToken: string, since?: string, tz?: string): Promise<IngestDay[]> {
  const feedUrl = new URL(proxyUrl);
  if (since) feedUrl.searchParams.set('since', since);
  if (tz) feedUrl.searchParams.set('tz', tz);

  const response = await fetch(feedUrl, {
    headers: { authorization: `Bearer ${proxyToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${feedUrl} -> ${response.status}${text ? `: ${text}` : ''}`);
  }

  const payload = (await response.json()) as ProxyResponse;
  return (payload.days ?? []).map((row) => ({ ...row, sessions: 0 }));
}

export const proxy = new Command()
  .name('proxy')
  .description('collect LLM-proxy usage from the /api/usage/daily feed and upload it to the ingest endpoint')
  .option('-d, --dry', 'fetch and print without uploading', false)
  .option('-u, --url <url>', 'ingest endpoint URL', process.env.AI_USAGE_INGEST_URL ?? DEFAULT_INGEST_URL)
  .option('-t, --token <token>', 'bearer token (AI_USAGE_INGEST_TOKEN)', process.env.AI_USAGE_INGEST_TOKEN)
  .option('-s, --since <date>', 'only collect on or after this date (YYYY-MM-DD)', process.env.AI_USAGE_SINCE)
  .option('--proxy-url <url>', 'llm-proxy usage feed URL', process.env.LLM_PROXY_URL ?? DEFAULT_PROXY_URL)
  .option('--proxy-token <token>', 'llm-proxy feed bearer token (LLM_PROXY_USAGE_TOKEN)', process.env.LLM_PROXY_USAGE_TOKEN)
  .option('--tz <minutes>', 'minutes ahead of UTC for day bucketing (default 480 = UTC+8)', process.env.LLM_PROXY_TZ ?? DEFAULT_TZ)
  .action(async (opts: ProxyOptions) => {
    if (!opts.proxyToken) {
      logger.error('LLM_PROXY_USAGE_TOKEN not set — cannot authenticate to the proxy feed.');
      process.exit(1);
    }

    let days: IngestDay[];
    try {
      days = await fetchProxyDays(opts.proxyUrl as string, opts.proxyToken, opts.since, opts.tz);
    } catch (error) {
      logger.error(`failed to fetch proxy feed: ${(error as Error).message}`);
      process.exit(1);
    }

    if (days.length === 0) {
      logger.warn('no rows returned by the proxy feed');
      return;
    }

    const dry = opts.dry || !opts.token;
    if (dry) {
      const tokensByTool: Record<string, number> = {};
      const tokensByModel: Record<string, number> = {};
      for (const row of days) {
        const total = row.inputTokens + row.outputTokens + row.cachedTokens;
        tokensByTool[row.tool] = (tokensByTool[row.tool] ?? 0) + total;
        tokensByModel[row.model] = (tokensByModel[row.model] ?? 0) + total;
      }
      logger.log('source:   llm-proxy');
      logger.log(`feed:     ${opts.proxyUrl}`);
      logger.log(`days:     ${days.length}`);
      logger.log(`tokens by tool: ${JSON.stringify(tokensByTool)}`);
      logger.log(`tokens by model: ${JSON.stringify(tokensByModel)}`);
      logger.log(`sample day: ${JSON.stringify(days[0])}`);
      if (!opts.token) {
        logger.warn('AI_USAGE_INGEST_TOKEN not set — dry run only.');
      }
      return;
    }

    const result = await postUsage({
      url: opts.url as string,
      token: opts.token as string,
      source: { machine: 'llm-proxy' },
      tz: tzLabel(opts.tz as string),
      days,
      sessions: [],
    });
    if (!result.ok) process.exit(1);
  });
