import { describe, expect, it } from 'vitest';
import { aggregateGrokInference, aggregateGrokSessions } from './grok';

describe('aggregateGrokInference', () => {
  it('aggregates inference events and ignores unrelated or malformed lines', () => {
    const rows = aggregateGrokInference(
      [
        JSON.stringify({
          ts: '2026-07-10T00:09:44.571Z',
          sid: 'known',
          msg: 'shell.turn.inference_done',
          ctx: { prompt_tokens: 22_907, cached_prompt_tokens: 1_152, completion_tokens: 159, reasoning_tokens: 61 },
        }),
        JSON.stringify({ ts: '2026-07-10T00:10:00Z', sid: 'known', msg: 'shell.turn.started', ctx: { prompt_tokens: 1 } }),
        '{',
        JSON.stringify({
          ts: '2026-07-10T01:00:00Z',
          sid: 'unknown',
          msg: 'shell.turn.inference_done',
          ctx: { prompt_tokens: 10, cached_prompt_tokens: 15, completion_tokens: 5 },
        }),
      ].join('\n'),
      new Map([['known', 'grok-4.5']])
    );

    expect(rows).toEqual([
      {
        date: '2026-07-10',
        tool: 'grok',
        model: 'grok-4.5',
        inputTokens: 21_755,
        outputTokens: 159,
        cachedTokens: 1_152,
        cost: 0,
        sessions: 0,
      },
      {
        date: '2026-07-10',
        tool: 'grok',
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 5,
        cachedTokens: 15,
        cost: 0,
        sessions: 0,
      },
    ]);
  });

  it('buckets a UTC evening event on the next Shanghai day', () => {
    const rows = aggregateGrokInference(
      JSON.stringify({
        ts: '2026-07-10T17:00:00Z',
        sid: 'known',
        msg: 'shell.turn.inference_done',
        ctx: { prompt_tokens: 10, cached_prompt_tokens: 0, completion_tokens: 1 },
      }),
      new Map([['known', 'grok-4.5']])
    );

    expect(rows[0]?.date).toBe('2026-07-11');
  });

  it('applies since filtering to inference days', () => {
    const rows = aggregateGrokInference(
      [
        JSON.stringify({ ts: '2026-07-09T01:00:00Z', sid: 'known', msg: 'shell.turn.inference_done', ctx: { prompt_tokens: 1, cached_prompt_tokens: 0, completion_tokens: 1 } }),
        JSON.stringify({ ts: '2026-07-10T01:00:00Z', sid: 'known', msg: 'shell.turn.inference_done', ctx: { prompt_tokens: 1, cached_prompt_tokens: 0, completion_tokens: 1 } }),
      ].join('\n'),
      new Map([['known', 'grok-4.5']]),
      '2026-07-10'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe('2026-07-10');
  });
});

describe('aggregateGrokSessions', () => {
  it('uses last activity, then updated time, then creation time and counts sessions per day', () => {
    const result = aggregateGrokSessions([
      { sid: 'one', summary: { last_active_at: '2026-07-10T01:00:00Z', updated_at: '2026-07-09T01:00:00Z', created_at: '2026-07-08T01:00:00Z', current_model_id: 'grok-4.5' } },
      { sid: 'two', summary: { updated_at: '2026-07-11T01:00:00Z', created_at: '2026-07-08T01:00:00Z', current_model_id: 'grok-build' } },
      { sid: 'three', summary: { created_at: '2026-07-11T04:00:00Z', current_model_id: 'grok-build' } },
    ]);

    expect(result.sessions).toEqual([
      { date: '2026-07-10', tool: 'grok', sessions: 1 },
      { date: '2026-07-11', tool: 'grok', sessions: 2 },
    ]);
    expect(result.modelBySid).toEqual(
      new Map([
        ['one', 'grok-4.5'],
        ['two', 'grok-build'],
        ['three', 'grok-build'],
      ])
    );
  });

  it('applies since filtering to session days while preserving model attribution', () => {
    const result = aggregateGrokSessions(
      [
        { sid: 'earlier', summary: { created_at: '2026-07-09T01:00:00Z', current_model_id: 'grok-4.5' } },
        { sid: 'later', summary: { created_at: '2026-07-10T01:00:00Z', current_model_id: 'grok-build' } },
      ],
      '2026-07-10'
    );

    expect(result.sessions).toEqual([{ date: '2026-07-10', tool: 'grok', sessions: 1 }]);
    expect(result.modelBySid.get('earlier')).toBe('grok-4.5');
  });
});
