import { describe, expect, it } from 'vitest';
import { csvDay, dayKey, tzLabel } from './dates';

describe('dayKey', () => {
  it('rolls a UTC evening instant into the next Shanghai day', () => {
    expect(dayKey('2026-07-11T17:30:00Z')).toBe('2026-07-12');
  });

  it('keeps a UTC early-morning instant on the same Shanghai day', () => {
    expect(dayKey('2026-07-11T02:00:00Z')).toBe('2026-07-11');
  });

  it('returns null for an unparseable date', () => {
    expect(dayKey('garbage')).toBeNull();
  });
});

describe('csvDay', () => {
  it('passes a bare YYYY-MM-DD value through unchanged', () => {
    expect(csvDay('2026-07-11')).toBe('2026-07-11');
  });

  it('re-buckets a full ISO timestamp crossing the Shanghai midnight boundary', () => {
    expect(csvDay('2026-07-11T17:30:00Z')).toBe('2026-07-12');
  });

  it('returns null for an unparseable value', () => {
    expect(csvDay('garbage')).toBeNull();
  });
});

describe('tzLabel', () => {
  it('maps the default offset to the data timezone name', () => {
    expect(tzLabel('480')).toBe('Asia/Shanghai');
  });

  it('formats a whole-hour offset', () => {
    expect(tzLabel('600')).toBe('UTC+10');
  });

  it('formats a negative half-hour offset', () => {
    expect(tzLabel('-330')).toBe('UTC-5:30');
  });
});
