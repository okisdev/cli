import { describe, expect, it } from 'vitest';
import { parseIoregUuid, parseMachineGuid, parseMachineId } from './hardware';

describe('hardware ID parsers', () => {
  it('reads IOPlatformUUID from ioreg output', () => {
    const output = '+-o IOPlatformExpertDevice  <class IOPlatformExpertDevice>\n    |   "IOPlatformUUID" = "A1B2C3D4-1234-5678-9ABC-DEF012345678"\n';
    expect(parseIoregUuid(output)).toBe('A1B2C3D4-1234-5678-9ABC-DEF012345678');
  });

  it('reads MachineGuid from reg query output', () => {
    const output = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    a1b2c3d4-1234-5678-9abc-def012345678\r\n';
    expect(parseMachineGuid(output)).toBe('a1b2c3d4-1234-5678-9abc-def012345678');
  });

  it('trims Linux machine IDs', () => {
    expect(parseMachineId('  abc123\n')).toBe('abc123');
  });

  it('rejects missing or blank IDs', () => {
    expect(parseIoregUuid('"OtherKey" = "a1b2c3d4-1234-5678-9abc-def012345678"')).toBeUndefined();
    expect(parseIoregUuid('"IOPlatformUUID" = ""')).toBeUndefined();
    expect(parseMachineGuid('MachineGuid    REG_SZ    \r\n')).toBeUndefined();
    expect(parseMachineGuid('OtherValue    REG_SZ    abc')).toBeUndefined();
    expect(parseMachineId(' \n\t')).toBeUndefined();
  });
});
