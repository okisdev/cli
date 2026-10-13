import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function parseIoregUuid(output: string): string | undefined {
  return output.match(/^[ \t|]*"IOPlatformUUID"\s*=\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\s*$/im)?.[1];
}

export function parseMachineId(output: string): string | undefined {
  return output.trim() || undefined;
}

export function parseMachineGuid(output: string): string | undefined {
  return output.match(/^\s*MachineGuid\s+REG_SZ\s+([^\r\n]+?)\s*$/im)?.[1]?.trim() || undefined;
}

export function resolveHardwareId(): string {
  let rawId: string | undefined;

  if (process.platform === 'darwin') {
    try {
      rawId = parseIoregUuid(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }));
    } catch {
      rawId = undefined;
    }
  } else if (process.platform === 'linux') {
    for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        rawId = parseMachineId(readFileSync(path, 'utf8'));
        if (rawId) break;
      } catch {
        rawId = undefined;
      }
    }
  } else if (process.platform === 'win32') {
    try {
      rawId = parseMachineGuid(execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8' }));
    } catch {
      rawId = undefined;
    }
  }

  if (!rawId) throw new Error(`Could not read a hardware ID on ${process.platform}`);
  return createHash('sha256').update(rawId).digest('hex');
}
