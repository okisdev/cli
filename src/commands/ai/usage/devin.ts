import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dayKey } from '@/src/commands/ai/usage/dates';
import type { IngestDay, IngestSession } from '@/src/commands/ai/usage/ingest';

const TOOL = 'devin';

// Devin labels context compaction turns with this pseudo model; they bill under the session's working model.
const COMPACTOR = 'compactor';

export interface DevinGeneration {
  sessionId: string;
  createdAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export function defaultDevinDb(): string {
  return join(process.env.DEVIN_HOME ?? join(homedir(), '.local', 'share', 'devin'), 'cli', 'sessions.db');
}

export function aggregateDevinGenerations(generations: DevinGeneration[], since?: string): { days: IngestDay[]; sessions: IngestSession[] } {
  const byKey = new Map<string, IngestDay>();
  const sessionsByDate = new Map<string, Set<string>>();
  const lastModel = new Map<string, string>();

  for (const generation of generations) {
    let model = generation.model;
    if (model === COMPACTOR) model = lastModel.get(generation.sessionId) ?? model;
    else lastModel.set(generation.sessionId, model);

    const date = dayKey(generation.createdAt);
    if (!date || (since && date < since)) continue;

    const key = `${date}\t${model}`;
    const day = byKey.get(key) ?? { date, tool: TOOL, model, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, sessions: 0 };
    day.inputTokens += generation.inputTokens;
    day.outputTokens += generation.outputTokens;
    day.cachedTokens += generation.cachedTokens;
    byKey.set(key, day);

    const sessions = sessionsByDate.get(date) ?? new Set<string>();
    sessions.add(generation.sessionId);
    sessionsByDate.set(date, sessions);
  }

  return {
    days: Array.from(byKey.values()),
    sessions: Array.from(sessionsByDate, ([date, ids]) => ({ date, tool: TOOL, sessions: ids.size })),
  };
}

export function buildDevinUsage(dbPath: string = defaultDevinDb(), since?: string): { days: IngestDay[]; sessions: IngestSession[] } {
  if (!existsSync(dbPath)) return { days: [], sessions: [] };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const generations = db
      .prepare(
        `select session_id as sessionId,
                json_extract(chat_message, '$.metadata.created_at') as createdAt,
                json_extract(chat_message, '$.metadata.generation_model') as model,
                coalesce(json_extract(chat_message, '$.metadata.metrics.input_tokens'), 0) as inputTokens,
                coalesce(json_extract(chat_message, '$.metadata.metrics.output_tokens'), 0) as outputTokens,
                coalesce(json_extract(chat_message, '$.metadata.metrics.cache_read_tokens'), 0)
                  + coalesce(json_extract(chat_message, '$.metadata.metrics.cache_creation_tokens'), 0) as cachedTokens
           from message_nodes
          where json_extract(chat_message, '$.metadata.metrics.input_tokens') is not null
            and json_extract(chat_message, '$.metadata.generation_model') is not null
            and json_extract(chat_message, '$.metadata.created_at') is not null
          order by row_id`
      )
      .all() as unknown as DevinGeneration[];
    return aggregateDevinGenerations(generations, since);
  } finally {
    db.close();
  }
}
