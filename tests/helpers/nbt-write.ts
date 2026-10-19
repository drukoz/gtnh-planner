// Writes NBT bytes (world-format §2: big-endian, u16-length names) from tagged builders, so world tests never need
// real game files (architecture §2 rule 2, §10). Independent of the reader under test except `parseTag`.

import { parseNbt, type NbtCompound } from '../../src/shared/world/nbt.ts';

export type TagType =
  | 'end' | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'byteArray' | 'string' | 'list' | 'compound' | 'intArray' | 'longArray';

export type Tag =
  | { type: 'byte' | 'short' | 'int' | 'float' | 'double'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'string'; value: string }
  | { type: 'byteArray'; value: Uint8Array }
  | { type: 'intArray'; value: readonly number[] }
  | { type: 'longArray'; value: readonly bigint[] }
  | { type: 'list'; elemType: TagType; items: readonly Tag[] }
  | { type: 'compound'; entries: Readonly<Record<string, Tag>> };

const TYPE_ID: Readonly<Record<TagType, number>> = {
  end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12,
};

function integer(value: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${what} must be an integer from ${min} to ${max}, got ${value}`);
  return value;
}

/** Signed or unsigned: -128..255 (written as the low 8 bits). */
export const byte = (value: number): Tag => ({ type: 'byte', value: integer(value, -128, 255, 'byte') });
/** Signed or unsigned: -32768..65535 (written as the low 16 bits). */
export const short = (value: number): Tag => ({ type: 'short', value: integer(value, -32768, 65535, 'short') });
/** Signed or unsigned: -2^31..2^32-1 (written as the low 32 bits). */
export const int = (value: number): Tag => ({ type: 'int', value: integer(value, -(2 ** 31), 2 ** 32 - 1, 'int') });
export const long = (value: bigint): Tag => ({ type: 'long', value });
export const float = (value: number): Tag => ({ type: 'float', value });
export const double = (value: number): Tag => ({ type: 'double', value });
export const str = (value: string): Tag => ({ type: 'string', value });
export const bytes = (value: Uint8Array | readonly number[]): Tag => ({ type: 'byteArray', value: Uint8Array.from(value) });
/** Each value as for `int`. */
export const ints = (value: Int32Array | readonly number[]): Tag => ({ type: 'intArray', value: Array.from(value, (v) => integer(v, -(2 ** 31), 2 ** 32 - 1, 'int')) });
export const longs = (value: readonly bigint[]): Tag => ({ type: 'longArray', value: [...value] });
export const comp = (entries: Readonly<Record<string, Tag>>): Tag => ({ type: 'compound', entries });

/** A list whose items all have `elemType` (an empty list may use 'end'). */
export function list(elemType: TagType, items: readonly Tag[]): Tag {
  for (const item of items) if (item.type !== elemType) throw new TypeError(`list('${elemType}') cannot hold a '${item.type}' tag`);
  return { type: 'list', elemType, items };
}

function u8(value: number): Buffer {
  return Buffer.of(value & 0xff);
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value & 0xffff);
  return b;
}

function i32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value | 0);
  return b;
}

function i64(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt.asIntN(64, value));
  return b;
}

function name(text: string): Buffer[] {
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.length > 0xffff) throw new RangeError(`NBT string longer than 65535 bytes: ${encoded.length}`);
  return [u16(encoded.length), encoded];
}

function payload(t: Tag, out: Buffer[]): void {
  switch (t.type) {
    case 'byte': out.push(u8(t.value)); return;
    case 'short': out.push(u16(t.value)); return;
    case 'int': out.push(i32(t.value)); return;
    case 'long': out.push(i64(t.value)); return;
    case 'float': { const b = Buffer.alloc(4); b.writeFloatBE(t.value); out.push(b); return; }
    case 'double': { const b = Buffer.alloc(8); b.writeDoubleBE(t.value); out.push(b); return; }
    case 'string': out.push(...name(t.value)); return;
    case 'byteArray': out.push(i32(t.value.length), Buffer.from(t.value)); return;
    case 'intArray': out.push(i32(t.value.length), ...t.value.map(i32)); return;
    case 'longArray': out.push(i32(t.value.length), ...t.value.map(i64)); return;
    case 'list':
      out.push(u8(TYPE_ID[t.elemType]), i32(t.items.length));
      for (const item of t.items) payload(item, out);
      return;
    case 'compound':
      for (const [key, value] of Object.entries(t.entries)) {
        out.push(u8(TYPE_ID[value.type]), ...name(key));
        payload(value, out);
      }
      out.push(u8(TYPE_ID.end));
      return;
  }
}

/** A named root tag, uncompressed (the root is a compound in every real file). */
export function writeNbt(root: Tag, rootName = ''): Buffer {
  const out: Buffer[] = [u8(TYPE_ID[root.type]), ...name(rootName)];
  payload(root, out);
  return Buffer.concat(out);
}

/** `parseNbt(writeNbt(t))`: the parsed compound, for tests that start from parsed NBT. */
export function parseTag(t: Tag): NbtCompound {
  return parseNbt(writeNbt(t));
}
