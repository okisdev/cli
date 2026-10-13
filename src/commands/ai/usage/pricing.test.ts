import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalCursorModel, estimateCost, fetchCursorPricing } from './pricing';

describe('canonicalCursorModel', () => {
  it('strips trailing thinking/effort variant tokens', () => {
    expect(canonicalCursorModel('claude-4.5-opus-high-thinking')).toBe('claude-4.5-opus');
  });

  it('strips a trailing max token', () => {
    expect(canonicalCursorModel('glm-5.2-max')).toBe('glm-5.2');
  });

  it('keeps max when preceded by codex', () => {
    expect(canonicalCursorModel('gpt-5.1-codex-max')).toBe('gpt-5.1-codex-max');
  });

  it('strips a colon-separated tag', () => {
    expect(canonicalCursorModel('glm-5.2:cloud')).toBe('glm-5.2');
  });

  it('leaves grok-code-fast-1 unchanged', () => {
    expect(canonicalCursorModel('grok-code-fast-1')).toBe('grok-code-fast-1');
  });

  it('strips a preview date suffix', () => {
    expect(canonicalCursorModel('gemini-2.5-pro-preview-06-05')).toBe('gemini-2.5-pro');
  });

  it('folds cursor grok variants into the grok model id', () => {
    expect(canonicalCursorModel('cursor-grok-4.5-fast')).toBe('grok-4.5');
    expect(canonicalCursorModel('cursor-grok-4.5-high-fast')).toBe('grok-4.5');
    expect(canonicalCursorModel('cursor-grok-4.6-xhigh-fast')).toBe('grok-4.6');
    expect(canonicalCursorModel('cursor-grok-4.6-high')).toBe('grok-4.6');
  });
});

describe('estimateCost', () => {
  it('computes cost from known pricing', () => {
    const cost = estimateCost({ input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 }, { input: 3, output: 15 });
    expect(cost).toBe(10.5);
  });

  it('falls back cache read rate to the input rate when unset', () => {
    const cost = estimateCost({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }, { input: 2, output: 8 });
    expect(cost).toBe(2);
  });

  it('treats missing rates as zero contribution', () => {
    const cost = estimateCost({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, {});
    expect(cost).toBe(0);
  });
});

describe('fetchCursorPricing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves pricing for a mapped model on the happy path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'claude-sonnet-4-0', pricing: { input: 3, output: 15, cached_input: 0.3, cache_write: 3.75 } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchCursorPricing(['claude-4-sonnet']);

    expect(result.get('claude-4-sonnet')).toEqual({ input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 });
  });

  it('omits the model when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchCursorPricing(['claude-4-sonnet']);

    expect(result.size).toBe(0);
  });
});
