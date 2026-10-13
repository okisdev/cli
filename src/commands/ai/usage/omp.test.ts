import { describe, expect, it } from 'vitest';
import { aggregateOmpEvents } from './omp';

describe('aggregateOmpEvents', () => {
  it('aggregates assistant usage and session starts by Shanghai day', () => {
    const result = aggregateOmpEvents([
      { type: 'session', timestamp: '2026-08-19T07:43:45.032Z', id: 'one' },
      {
        type: 'message',
        timestamp: '2026-08-19T07:44:00.000Z',
        message: { model: 'grok-4.6', usage: { input: 10, output: 4, cacheRead: 8, cacheWrite: 2, cost: { total: 0 } } },
      },
      {
        type: 'message',
        timestamp: '2026-08-19T07:45:00.000Z',
        message: { model: 'grok-4.6', usage: { input: 5, output: 1, cacheRead: 1, cacheWrite: 0, cost: { total: 1.25 } } },
      },
      { type: 'message', timestamp: '2026-08-19T07:46:00.000Z', message: { model: 'grok-4.6' } },
    ]);

    expect(result.days).toEqual([
      {
        date: '2026-08-19',
        tool: 'omp',
        model: 'grok-4.6',
        inputTokens: 15,
        outputTokens: 5,
        cachedTokens: 11,
        cost: 1.25,
        sessions: 0,
      },
    ]);
    expect(result.sessions).toEqual([{ date: '2026-08-19', tool: 'omp', sessions: 1 }]);
  });

  it('applies since filtering and buckets a UTC evening event on the next Shanghai day', () => {
    const result = aggregateOmpEvents(
      [
        { type: 'session', timestamp: '2026-07-10T15:00:00Z', id: 'old' },
        {
          type: 'message',
          timestamp: '2026-07-10T17:00:00Z',
          message: { model: 'kimi-k3', usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } },
        },
      ],
      '2026-07-11'
    );

    expect(result.days).toEqual([
      {
        date: '2026-07-11',
        tool: 'omp',
        model: 'kimi-k3',
        inputTokens: 3,
        outputTokens: 2,
        cachedTokens: 0,
        cost: 0,
        sessions: 0,
      },
    ]);
    expect(result.sessions).toEqual([]);
  });

  it('drops models that recorded no tokens', () => {
    const result = aggregateOmpEvents([
      {
        type: 'message',
        timestamp: '2026-08-19T07:00:00Z',
        message: { model: 'kimi-k3', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      },
    ]);

    expect(result.days).toEqual([]);
  });
});
