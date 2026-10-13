const MODELPEDIA_BASE = 'https://api.modelpedia.dev/v1';

export interface ModelPricing {
  input?: number;
  output?: number;
  cachedInput?: number;
  cacheWrite?: number;
}

// Cursor canonical model id -> a modelpedia id with confirmed non-null pricing.
// Curated by hand against https://api.modelpedia.dev/v1/models; omitted entries
// (composer-2.5, code-supernova, cursor-small, auto, deepseek-v3) have no priced
// modelpedia match and keep the CSV-reported cost (0 for subscription usage).
export const CURSOR_MODEL_IDS: Record<string, string> = {
  'claude-4-sonnet': 'claude-sonnet-4-0',
  'claude-4.5-sonnet': 'claude-sonnet-4-5',
  'claude-4-opus': 'claude-opus-4-0',
  'claude-4.1-opus': 'claude-opus-4-1',
  'claude-4.5-opus': 'claude-opus-4-5',
  'claude-3.5-sonnet': 'anthropic/claude-3-5-sonnet-20241022',
  'claude-3.7-sonnet': 'claude-3-7-sonnet',
  'gpt-5': 'gpt-5-2025-08-07',
  'gpt-5.1': 'openai/gpt-5.1-20251113',
  'gpt-5.2': 'gpt-5.2-2025-12-11',
  'gpt-5.5': 'gpt-5.5',
  'gpt-5-codex': 'gpt-5-codex',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  'gpt-4o': 'openai/gpt-4o',
  o3: 'openai/o3',
  'gemini-2.5-pro': 'google-ai-studio/gemini-2.5-pro',
  'gemini-3-pro': 'google-ai-studio/gemini-3-pro-preview',
  'glm-5.2': 'glm-5.2',
  'grok-4': 'grok/grok-4-07-09',
  'grok-code-fast-1': 'grok-code-fast-1',
  'composer-1': 'composer-1',
};

// Grok CLI model id -> a modelpedia id with confirmed non-null pricing; the
// omitted grok-composer-2.5-fast has no priced modelpedia match and keeps cost 0.
export const GROK_MODEL_IDS: Record<string, string> = {
  'grok-4.6': 'grok-4.6',
  'grok-4.5': 'grok-4.5',
  // xAI has no *-build API SKU; ccusage sees these ids in session logs and cannot price them, so they bill at the base model's list price.
  'grok-4.6-build': 'grok-4.6',
  'grok-4.5-build': 'grok-4.5',
  'grok-build': 'grok-build-0.1',
  'grok-4': 'grok/grok-4-07-09',
  'grok-code-fast-1': 'grok-code-fast-1',
};

const VARIANT_TOKENS = new Set(['thinking', 'high', 'low', 'medium', 'minimal', 'fast', 'preview', 'exp', 'latest', 'build', 'xhigh', 'xlow']);

const DATE_TOKEN = /^\d{4,8}$/;
const SHORT_TOKEN = /^\d{1,2}$/;

export function canonicalCursorModel(model: string): string {
  const withoutOrg = model.slice(model.lastIndexOf('/') + 1);
  const tokens = withoutOrg.toLowerCase().split(':')[0].split('-');

  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (DATE_TOKEN.test(last) || VARIANT_TOKENS.has(last)) {
      tokens.pop();
      continue;
    }
    if (last === 'max' && tokens[tokens.length - 2] !== 'codex') {
      tokens.pop();
      continue;
    }
    if (SHORT_TOKEN.test(last)) {
      let anchor = tokens.length - 2;
      while (anchor >= 0 && SHORT_TOKEN.test(tokens[anchor])) anchor--;
      if (anchor >= 0 && (tokens[anchor] === 'preview' || tokens[anchor] === 'exp')) {
        tokens.pop();
        continue;
      }
    }
    break;
  }

  if (tokens[0] === 'cursor' && tokens[1] === 'grok') tokens.shift();
  return tokens.join('-');
}

interface ModelpediaEntry {
  id: string;
  pricing?: {
    input?: number;
    output?: number;
    cached_input?: number;
    cache_write?: number;
  };
}

async function fetchExactPricing(id: string): Promise<ModelPricing | undefined> {
  try {
    const url = `${MODELPEDIA_BASE}/models?q=${encodeURIComponent(id)}&limit=20`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;

    const payload = (await response.json()) as { data?: ModelpediaEntry[] };
    const entry = (payload.data ?? []).find((candidate) => candidate.id === id && candidate.pricing);
    if (!entry?.pricing) return undefined;

    return {
      input: entry.pricing.input,
      output: entry.pricing.output,
      cachedInput: entry.pricing.cached_input,
      cacheWrite: entry.pricing.cache_write,
    };
  } catch {
    return undefined;
  }
}

async function fetchPricing(models: Iterable<string>, modelIds: Record<string, string>): Promise<Map<string, ModelPricing>> {
  const result = new Map<string, ModelPricing>();
  const modelpediaIds = new Map<string, string>();

  for (const model of Array.from(models)) {
    const modelpediaId = modelIds[model];
    if (modelpediaId) modelpediaIds.set(model, modelpediaId);
  }

  const resolvedById = new Map<string, ModelPricing | undefined>();
  for (const modelpediaId of Array.from(new Set(modelpediaIds.values()))) {
    resolvedById.set(modelpediaId, await fetchExactPricing(modelpediaId));
  }

  for (const [model, modelpediaId] of Array.from(modelpediaIds)) {
    const pricing = resolvedById.get(modelpediaId);
    if (pricing) result.set(model, pricing);
  }

  return result;
}

export async function fetchCursorPricing(models: Iterable<string>): Promise<Map<string, ModelPricing>> {
  return fetchPricing(models, { ...CURSOR_MODEL_IDS, ...GROK_MODEL_IDS });
}

export async function fetchGrokPricing(models: Iterable<string>): Promise<Map<string, ModelPricing>> {
  return fetchPricing(models, GROK_MODEL_IDS);
}

export function estimateCost(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }, pricing: ModelPricing): number {
  const inputRate = pricing.input ?? 0;
  const outputRate = pricing.output ?? 0;
  const cacheReadRate = pricing.cachedInput ?? pricing.input ?? 0;
  const cacheWriteRate = pricing.cacheWrite ?? pricing.input ?? 0;

  const cost = (tokens.input * inputRate + tokens.output * outputRate + tokens.cacheRead * cacheReadRate + tokens.cacheWrite * cacheWriteRate) / 1_000_000;

  return Math.round(cost * 10_000) / 10_000;
}
