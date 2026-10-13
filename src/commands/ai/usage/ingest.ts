import { logger } from '@/src/utils/logger';

export const DEFAULT_INGEST_URL = 'https://okis.dev/api/ai/usage/ingest';

export interface IngestDay {
  date: string;
  tool: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  sessions: number;
}

export interface IngestSession {
  date: string;
  tool: string;
  sessions: number;
}

interface PostUsageOptions {
  url: string;
  token: string;
  machine: string;
  tz: string;
  days: IngestDay[];
  sessions: IngestSession[];
}

export interface PostUsageResult {
  ok: boolean;
  status: number;
}

export async function postUsage(opts: PostUsageOptions): Promise<PostUsageResult> {
  const response = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify({ machine: opts.machine, tz: opts.tz, days: opts.days, sessions: opts.sessions }),
  });

  logger.log(`POST ${opts.url} -> ${response.status}`);
  const text = await response.text();
  if (text) logger.log(text);
  return { ok: response.ok, status: response.status };
}
