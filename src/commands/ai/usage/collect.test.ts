import { afterEach, describe, expect, it, vi } from 'vitest';
import { inferAgentFromModel, repriceGrokBuildRows } from './collect';

describe('inferAgentFromModel', () => {
  it('maps grok build and CLI models to grok', () => {
    expect(inferAgentFromModel('grok-4.6-build')).toBe('grok');
    expect(inferAgentFromModel('grok-4.5-build')).toBe('grok');
    expect(inferAgentFromModel('grok-4.6')).toBe('grok');
  });

  it('keeps the existing prefix mappings', () => {
    expect(inferAgentFromModel('claude-opus-5')).toBe('claude');
    expect(inferAgentFromModel('gpt-5.6-terra')).toBe('codex');
    expect(inferAgentFromModel('openai/gpt-5')).toBe('codex');
    expect(inferAgentFromModel('glm-5.2')).toBe('opencode');
    expect(inferAgentFromModel('stepfun-1')).toBe('hermes');
  });

  it('returns undefined when no prefix matches', () => {
    expect(inferAgentFromModel('composer-2.5')).toBeUndefined();
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
