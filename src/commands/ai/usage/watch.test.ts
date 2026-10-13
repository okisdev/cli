import { describe, expect, it } from 'vitest';
import { decideUpload, sinceFor } from './watch';

describe('decideUpload', () => {
  it('uploads when never uploaded before', () => {
    const result = decideUpload({ now: 1_000_000, lastUploadAt: undefined, stale: false, intervalMs: 60_000, minGapMs: 5_000 });

    expect(result.upload).toBe(true);
  });

  it('suppresses a stale visit within the minimum gap', () => {
    const result = decideUpload({ now: 100_000, lastUploadAt: 99_000, stale: true, intervalMs: 1_000_000, minGapMs: 5_000 });

    expect(result).toEqual({ upload: false, reason: null });
  });

  it('uploads with reason visit once a stale visit clears the minimum gap', () => {
    const result = decideUpload({ now: 100_000, lastUploadAt: 95_000, stale: true, intervalMs: 1_000_000, minGapMs: 5_000 });

    expect(result).toEqual({ upload: true, reason: 'visit' });
  });

  it('uploads with reason interval once the interval elapses without a stale visit', () => {
    const result = decideUpload({ now: 160_000, lastUploadAt: 100_000, stale: false, intervalMs: 60_000, minGapMs: 5_000 });

    expect(result).toEqual({ upload: true, reason: 'interval' });
  });

  it('does not upload when neither the gap nor the interval has elapsed', () => {
    const result = decideUpload({ now: 100_500, lastUploadAt: 100_000, stale: false, intervalMs: 60_000, minGapMs: 5_000 });

    expect(result).toEqual({ upload: false, reason: null });
  });
});

describe('sinceFor', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');

  it('collects full history when a successful poll reports no prior ingest', () => {
    expect(sinceFor(null, 3, now)).toBeUndefined();
  });

  it('uses the configured window before any successful poll', () => {
    expect(sinceFor(undefined, 3, now)).toBe('2026-10-10');
  });

  it('catches up from an older ingest date', () => {
    expect(sinceFor('2026-10-01T12:00:00Z', 3, now)).toBe('2026-10-01');
  });

  it('keeps the configured window when the latest ingest is newer', () => {
    expect(sinceFor('2026-10-12T12:00:00Z', 3, now)).toBe('2026-10-10');
  });
});
