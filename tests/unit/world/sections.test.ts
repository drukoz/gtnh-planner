import { describe, expect, it } from 'vitest';
import { biomeAt, decodeSection, isLegacySection, sectionIndex } from '../../../src/server/world/sections.ts';
import { byte, bytes, comp, parseTag, type Tag } from '../../helpers/nbt-write.ts';

// Arrays are filled at i = sectionIndex(1, 2, 3) = 0x231; i is odd, so its nibble is the high half of byte i >> 1.
const i = sectionIndex(1, 2, 3);

function array(length: number, at: number, value: number): Uint8Array {
  const a = new Uint8Array(length);
  a[at] = value;
  return a;
}

const section = (arrays: Record<string, Tag>) => parseTag(comp({ Y: byte(0), ...arrays }));

describe('sectionIndex', () => {
  it('is y<<8 | z<<4 | x within the section', () => {
    expect([i, sectionIndex(0, 0, 0), sectionIndex(15, 15, 15), sectionIndex(-1, 17, 16)]).toEqual([0x231, 0, 4095, 0x10f]);
  });
});

describe('decodeSection', () => {
  it('decodes a legacy Blocks16/Data16 section as big-endian u16', () => {
    const b16 = new Uint8Array(8192), d16 = new Uint8Array(8192);
    b16[2 * i] = 0x2b; b16[2 * i + 1] = 0x11;
    d16[2 * i] = 0x01; d16[2 * i + 1] = 0x31;
    const sec = section({ Blocks16: bytes(b16), Data16: bytes(d16) });
    const { ids, meta } = decodeSection(sec);
    expect(isLegacySection(sec)).toBe(true);
    expect([ids[i], meta[i]]).toEqual([11025, 305]);
    expect([ids[i - 1], meta[i + 1], ids.length, meta.length]).toEqual([0, 0, 4096, 4096]);
  });

  it('decides per section by the Blocks16 key, even when EndlessIDs arrays are also present', () => {
    const b16 = new Uint8Array(8192);
    b16[2 * i + 1] = 0x05;
    const sec = section({ Blocks16: bytes(b16), Blocks: bytes(array(4096, i, 0x11)) });
    expect([isLegacySection(sec), decodeSection(sec).ids[i]]).toEqual([true, 5]);
    expect(isLegacySection(section({ Blocks: bytes(array(4096, i, 0x11)) }))).toBe(false);
  });

  it('decodes EndlessIDs with the Add → BlocksB2Hi cascade', () => {
    const sec = section({
      Blocks: bytes(array(4096, i, 0x11)), Add: bytes(array(2048, i >> 1, 0xb0)), BlocksB2Hi: bytes(array(2048, i >> 1, 0x20)),
      Data: bytes(array(2048, i >> 1, 0x10)), Data1High: bytes(array(2048, i >> 1, 0x30)), Data2: bytes(array(4096, i, 1)),
    });
    const { ids, meta } = decodeSection(sec);
    expect(isLegacySection(sec)).toBe(false);
    expect([ids[i], meta[i]]).toEqual([11025, 305]);
    expect([ids[i - 1], meta[i - 1]]).toEqual([0, 0]);   // the low nibbles of byte i >> 1 belong to the even index i - 1
  });

  it('reads the low nibble at an even index', () => {
    const j = sectionIndex(0, 2, 3);   // 0x230, even
    const { ids, meta } = decodeSection(section({ Blocks: bytes(array(4096, j, 0x01)), Add: bytes(array(2048, j >> 1, 0x07)), Data: bytes(array(2048, j >> 1, 0x09)) }));
    expect([ids[j], meta[j], ids[j + 1], meta[j + 1]]).toEqual([0x701, 9, 0, 0]);
  });

  it('ignores BlocksB2Hi when Add is absent and Data2 when Data1High is absent', () => {
    const { ids, meta } = decodeSection(section({
      Blocks: bytes(array(4096, i, 0x11)), BlocksB2Hi: bytes(array(2048, i >> 1, 0x20)), Data: bytes(array(2048, i >> 1, 0x10)), Data2: bytes(array(4096, i, 1)),
    }));
    expect([ids[i], meta[i]]).toEqual([0x11, 1]);
  });

  it('reads BlocksB3 only under BlocksB2Hi', () => {
    const base = { Blocks: bytes(array(4096, i, 0x11)), Add: bytes(array(2048, i >> 1, 0xb0)), BlocksB3: bytes(array(4096, i, 0x01)) };
    expect(decodeSection(section(base)).ids[i]).toBe(0xb11);
    expect(decodeSection(section({ ...base, BlocksB2Hi: bytes(array(2048, i >> 1, 0x20)) })).ids[i]).toBe(0x12b11);
  });

  it('reads missing arrays and missing bytes as zero', () => {
    expect(decodeSection(section({})).ids.every((v) => v === 0)).toBe(true);
    const { ids, meta } = decodeSection(section({ Blocks: bytes([0, 9]), Data: bytes([0x30]) }));
    expect([ids[1], meta[1], ids[i], meta[i]]).toEqual([9, 3, 0, 0]);
  });
});

describe('biomeAt', () => {
  it('reads Biomes16v2 little-endian at z<<4|x, 65535 = none', () => {
    const k = (5 << 4) | 3;
    const b16v2 = new Uint8Array(512);
    b16v2[2 * k] = 0x2a; b16v2[2 * k + 1] = 0x01;
    b16v2[0] = 0xff; b16v2[1] = 0xff;
    const eid = parseTag(comp({ Biomes16v2: bytes(b16v2) }));
    const b = new Uint8Array(256);
    b[k] = 7; b[0] = 255;
    const vanilla = parseTag(comp({ Biomes: bytes(b) }));
    expect([biomeAt(eid, 3, 5), biomeAt(eid, 19, -11), biomeAt(eid, 0, 0)]).toEqual([298, 298, -1]);
    expect([biomeAt(vanilla, 3, 5), biomeAt(vanilla, 0, 0), biomeAt({}, 0, 0)]).toEqual([7, -1, -1]);
  });

  it('prefers Biomes16v2 over Biomes and answers -1 past the end of a short array', () => {
    const both = parseTag(comp({ Biomes16v2: bytes(new Uint8Array(512)), Biomes: bytes(new Uint8Array(256).fill(7)) }));
    const short = parseTag(comp({ Biomes: bytes([4]) }));
    expect([biomeAt(both, 1, 1), biomeAt(short, 0, 0), biomeAt(short, 1, 0)]).toEqual([0, 4, -1]);
  });
});
