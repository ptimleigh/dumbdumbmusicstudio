import { describe, it, expect } from 'vitest';
import { crc32, makeZip } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('writes a readable archive structure', () => {
    const zip = makeZip([{ name: 'a.txt', data: bytes('hello') }, { name: 'tracks/b.txt', data: bytes('world!!') }], new Date(2026, 10, 14, 12, 30, 10));
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);                  // first local header
    const eocd = zip.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);               // end of central directory
    expect(v.getUint16(eocd + 10, true)).toBe(2);                   // two entries
    const cdOffset = v.getUint32(eocd + 16, true), cdSize = v.getUint32(eocd + 12, true);
    expect(cdOffset + cdSize).toBe(eocd);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);           // first central entry
    expect(v.getUint32(cdOffset + 16, true)).toBe(crc32(bytes('hello')));
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(zip.slice(35, 40))).toBe('hello');
  });
  it('handles an empty list and binary data', () => {
    expect(makeZip([]).length).toBe(22);
    const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    const zip = makeZip([{ name: 'x.bin', data }]);
    expect(zip.length).toBe(30 + 5 + 1000 + 46 + 5 + 22);
  });
});
