import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

function readMachineFile(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

function persistMachineFile(filePath: string, value: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${value}\n`);
  } catch {
    return;
  }
}

export function freezeLabel(name: string, suffix: string): string {
  return `${name}-${suffix}`;
}

export function resolveMachineFrom(env: string | undefined, filePath: string, fallback: () => string): string {
  const trimmedEnv = env?.trim();
  if (trimmedEnv) return trimmedEnv;

  const fromFile = readMachineFile(filePath);
  if (fromFile) return fromFile;

  const value = fallback();
  persistMachineFile(filePath, value);
  return value;
}

export function resolveMachine(): string {
  return resolveMachineFrom(process.env.AI_USAGE_MACHINE, join(homedir(), '.config', 'okisdev', 'machine'), () => freezeLabel(hostname(), randomBytes(2).toString('hex')));
}
