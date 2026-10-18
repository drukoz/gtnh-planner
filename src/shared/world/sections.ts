// Section and biome decoding (world-format §3.3, §3.4 and the §9 reference helpers). The format is decided per
// section by the `Blocks16` key, exactly as EndlessIDs does: present → NotEnoughIDs legacy big-endian u16 arrays,
// absent → EndlessIDs arrays with the Add → BlocksB2Hi → BlocksB3 and Data1High → Data2 cascades.
// Shared by server and browser: only Uint8Array, no Node built-in modules.

import type { NbtCompound, NbtValue } from './nbt.ts';

/** 4096 block ids and metadata values of one 16×16×16 section, at `sectionIndex(x, y, z)`. */
export interface DecodedSection { ids: Uint32Array; meta: Uint16Array }

const BLOCKS = 4096;
const NIBBLES = BLOCKS / 2;

/** `y<<8 | z<<4 | x` of the block's position inside its section (each coordinate taken `& 15`). */
export function sectionIndex(x: number, y: number, z: number): number {
  return ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
}

export function isLegacySection(sec: NbtCompound): boolean {
  return Object.hasOwn(sec, 'Blocks16');
}

/**
 * A byte array of at least `length` bytes, or null when the key is absent (or not a byte array). A short array is
 * zero-padded, so a truncated array reads its missing bytes as 0, as the §9 reference decoder does.
 */
function bytesOf(v: NbtValue | undefined, length: number): Uint8Array | null {
  if (!(v instanceof Uint8Array)) return null;
  if (v.length >= length) return v;
  const padded = new Uint8Array(length);
  padded.set(v);
  return padded;
}

/** Vanilla NibbleArray order: byte `i >> 1`, low half for an even index, high half for an odd one. */
function nibble(a: Uint8Array, i: number): number {
  const b = a[i >> 1]!;
  return (i & 1 ? b >> 4 : b) & 15;
}

export function decodeSection(sec: NbtCompound): DecodedSection {
  const ids = new Uint32Array(BLOCKS), meta = new Uint16Array(BLOCKS);
  if (isLegacySection(sec)) {
    const b = bytesOf(sec.Blocks16, 2 * BLOCKS), d = bytesOf(sec.Data16, 2 * BLOCKS);
    if (b) for (let i = 0; i < BLOCKS; i++) ids[i] = (b[2 * i]! << 8) | b[2 * i + 1]!;
    if (d) for (let i = 0; i < BLOCKS; i++) meta[i] = (d[2 * i]! << 8) | d[2 * i + 1]!;
    return { ids, meta };
  }
  const blocks = bytesOf(sec.Blocks, BLOCKS);
  const add = bytesOf(sec.Add, NIBBLES);
  const b2hi = add && bytesOf(sec.BlocksB2Hi, NIBBLES);
  const b3 = b2hi && bytesOf(sec.BlocksB3, BLOCKS);
  const data = bytesOf(sec.Data, NIBBLES);
  const data1 = bytesOf(sec.Data1High, NIBBLES);
  const data2 = data1 && bytesOf(sec.Data2, BLOCKS);
  for (let i = 0; i < BLOCKS; i++) {
    let id = blocks ? blocks[i]! : 0;
    if (add) {
      id |= nibble(add, i) << 8;
      if (b2hi) {
        id |= nibble(b2hi, i) << 12;
        if (b3) id |= b3[i]! << 16;
      }
    }
    let m = data ? nibble(data, i) : 0;
    if (data1) {
      m |= nibble(data1, i) << 4;
      if (data2) m |= data2[i]! << 8;
    }
    ids[i] = id;
    meta[i] = m;
  }
  return { ids, meta };
}

/**
 * The biome id of column (x, z) of a chunk's `Level` compound (coordinates taken `& 15`): `Biomes16v2` (256 little-endian
 * u16, null 65535) when present, else vanilla `Biomes` (256 u8, null 255); −1 for null, an absent array or a column
 * past the end of a short one.
 */
export function biomeAt(level: NbtCompound, x: number, z: number): number {
  const k = ((z & 15) << 4) | (x & 15);
  const wide = level.Biomes16v2;
  if (wide instanceof Uint8Array) {
    if (2 * k + 1 >= wide.length) return -1;
    const v = wide[2 * k]! | (wide[2 * k + 1]! << 8);
    return v === 0xffff ? -1 : v;
  }
  const narrow = level.Biomes;
  if (narrow instanceof Uint8Array) {
    if (k >= narrow.length) return -1;
    const v = narrow[k]!;
    return v === 0xff ? -1 : v;
  }
  return -1;
}
