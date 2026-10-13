import { describe, expect, it } from 'vitest';
import { decideUpload } from './watch';

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
