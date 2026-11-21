import { describe, expect, it } from 'vitest';
import { aggregateDevinGenerations } from './devin';

const generation = { inputTokens: 100, outputTokens: 10, cachedTokens: 5 };

describe('aggregateDevinGenerations', () => {
  it('sums generations per day and model and counts distinct sessions', () => {
    const { days, sessions } = aggregateDevinGenerations([
      { ...generation, sessionId: 'a', createdAt: '2026-11-20T02:00:00Z', model: 'swe-2-high' },
      { ...generation, sessionId: 'a', createdAt: '2026-11-20T03:00:00Z', model: 'swe-2-high' },
      { ...generation, sessionId: 'b', createdAt: '2026-11-20T04:00:00Z', model: 'kimi-k3-1-pro-high' },
    ]);

    expect(days).toEqual([
      { date: '2026-11-20', tool: 'devin', model: 'swe-2-high', inputTokens: 200, outputTokens: 20, cachedTokens: 10, cost: 0, sessions: 0 },
      { date: '2026-11-20', tool: 'devin', model: 'kimi-k3-1-pro-high', inputTokens: 100, outputTokens: 10, cachedTokens: 5, cost: 0, sessions: 0 },
    ]);
    expect(sessions).toEqual([{ date: '2026-11-20', tool: 'devin', sessions: 2 }]);
  });

  it('bills compactor turns under the session model and buckets days in the data timezone', () => {
    const { days } = aggregateDevinGenerations([
      { ...generation, sessionId: 'a', createdAt: '2026-11-20T15:00:00Z', model: 'muse-wonder-1-0-xhigh' },
      { ...generation, sessionId: 'a', createdAt: '2026-11-20T16:30:00Z', model: 'compactor' },
    ]);

    expect(days.map((day) => [day.date, day.model])).toEqual([
      ['2026-11-20', 'muse-wonder-1-0-xhigh'],
      ['2026-11-21', 'muse-wonder-1-0-xhigh'],
    ]);
  });

  it('drops days before since', () => {
    const { days, sessions } = aggregateDevinGenerations([{ ...generation, sessionId: 'a', createdAt: '2026-11-01T02:00:00Z', model: 'swe-2-high' }], '2026-11-10');
    expect(days).toEqual([]);
    expect(sessions).toEqual([]);
  });
});
