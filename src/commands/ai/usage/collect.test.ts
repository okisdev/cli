import { afterEach, describe, expect, it, vi } from 'vitest';
import { daysFromDaily, repriceGrokBuildRows } from './collect';

describe('daysFromDaily', () => {
  it('attributes every model to the agent ccusage reports it under', () => {
    const days = daysFromDaily([
      {
        period: '2026-11-19',
        agents: [
          { agent: 'antigravity', modelBreakdowns: [{ modelName: 'gemini-4-neon', inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 1, cost: 0.5 }] },
          { agent: 'claude', modelBreakdowns: [{ modelName: 'claude-opus-5-5', inputTokens: 1 }] },
        ],
      },
    ]);

    expect(days).toEqual([
      { date: '2026-11-19', tool: 'antigravity', model: 'gemini-4-neon', inputTokens: 10, outputTokens: 2, cachedTokens: 4, cost: 0.5, sessions: 0 },
      { date: '2026-11-19', tool: 'claude-code', model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 0, cachedTokens: 0, cost: 0, sessions: 0 },
    ]);
  });

  it('skips rows without an agent or model', () => {
    expect(daysFromDaily([{ period: '2026-11-19', agents: [{ modelBreakdowns: [{ modelName: 'x' }] }, { agent: 'codex', modelBreakdowns: [{}] }] }])).toEqual([]);
  });
});

describe('repriceGrokBuildRows', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const day = { date: '2026-08-20', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 2_000_000, cost: 0.5, sessions: 0 };

  it('rebills grok build rows at the base model list price', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'grok-4.6', pricing: { input: 2, output: 6, cached_input: 0.5 } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const days = await repriceGrokBuildRows([
      { ...day, tool: 'grok', model: 'grok-4.6-build' },
      { ...day, tool: 'grok', model: 'grok-4.6' },
      { ...day, tool: 'claude-code', model: 'claude-fable-5' },
    ]);

    expect(days[0].cost).toBe(9);
    expect(days[1].cost).toBe(0.5);
    expect(days[2].cost).toBe(0.5);
  });

  it('leaves rows untouched when pricing does not resolve', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const days = await repriceGrokBuildRows([{ ...day, tool: 'grok', model: 'grok-4.6-build' }]);

    expect(days[0].cost).toBe(0.5);
  });
});
