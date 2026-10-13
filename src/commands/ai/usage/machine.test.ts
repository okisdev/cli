import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { freezeLabel, resolveMachineFrom } from './machine';

function tempMachinePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'okisdev-machine-'));
  return join(dir, 'machine');
}

describe('resolveMachineFrom', () => {
  it('prefers a trimmed env override even when the file already has a value', () => {
    const filePath = tempMachinePath();
    writeFileSync(filePath, 'file-value\n');

    const result = resolveMachineFrom('  env-value  ', filePath, () => 'fallback-value');

    expect(result).toBe('env-value');
  });

  it('falls through a blank env value to the file', () => {
    const filePath = tempMachinePath();
    writeFileSync(filePath, 'file-value\n');

    const result = resolveMachineFrom('   ', filePath, () => 'fallback-value');

    expect(result).toBe('file-value');
  });

  it('returns the persisted file value over the fallback', () => {
    const filePath = tempMachinePath();
    writeFileSync(filePath, 'file-value\n');
    const fallback = vi.fn(() => 'fallback-value');

    const result = resolveMachineFrom(undefined, filePath, fallback);

    expect(result).toBe('file-value');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('persists the fallback on first run and reuses it on the next call', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'okisdev-machine-')), 'nested', 'machine');
    const fallback = vi.fn(() => freezeLabel('Harrys-MacBook-Pro.local', 'a1b2'));

    const first = resolveMachineFrom(undefined, filePath, fallback);

    expect(first).toMatch(/^Harrys-MacBook-Pro\.local-[0-9a-f]{4}$/);
    expect(readFileSync(filePath, 'utf8')).toBe(`${first}\n`);

    const second = resolveMachineFrom(undefined, filePath, fallback);

    expect(second).toBe(first);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('reuses the exact persisted suffixed value on a second resolution instead of generating a new suffix', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'okisdev-machine-')), 'nested', 'machine');
    let calls = 0;
    const fallback = vi.fn(() => freezeLabel('Harrys-MacBook-Pro.local', calls++ === 0 ? 'a1b2' : 'c3d4'));

    const first = resolveMachineFrom(undefined, filePath, fallback);
    const second = resolveMachineFrom(undefined, filePath, fallback);

    expect(second).toBe(first);
    expect(second).toBe('Harrys-MacBook-Pro.local-a1b2');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back without throwing when the file path is unwritable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'okisdev-machine-'));
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const filePath = join(blocker, 'nested', 'machine');

    const result = resolveMachineFrom(undefined, filePath, () => 'fallback-value');

    expect(result).toBe('fallback-value');
  });
});
