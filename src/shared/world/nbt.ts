// NBT reading (world-format §2): a big-endian reader over a DataView, with cursor primitives for skip-scans that
// never build objects for what they skip. Shared by server and browser (architecture §11.12): it uses only
// Uint8Array, DataView and TextDecoder, no Node built-in modules.

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6, ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
} as const;

/**
 * Byte/Short/Int/Long/Float/Double → number (a Long beyond 2^53 loses precision); ByteArray → a Uint8Array view of
 * the input (no copy); IntArray → Int32Array; LongArray → number[]; List → array; Compound → NbtCompound.
 */
export type NbtValue = number | string | Uint8Array | Int32Array | number[] | NbtValue[] | NbtCompound;
export interface NbtCompound { [key: string]: NbtValue }

/** Malformed NBT: truncated, an unknown tag type, a negative length, nesting deeper than Minecraft allows. */
export class NbtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NbtError';
  }
}

export interface NbtCursor { buf: Uint8Array; view: DataView; pos: number }

/** Minecraft refuses NBT nested deeper than this (NBTTagCompound/NBTTagList depth > 512). */
const MAX_DEPTH = 512;

/** Payload bytes of the fixed-size tag types, indexed by tag type; 0 = variable size. */
const FIXED_SIZE = [0, 1, 2, 4, 8, 4, 8, 0, 0, 0, 0, 0, 0];

/** The fewest payload bytes a tag of each type takes, indexed by tag type (bounds a list's count before reading it). */
const MIN_SIZE = [0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4];

const UTF8 = new TextDecoder('utf-8');

/** Names this short are decoded by hand when they are ASCII, which every key and registry name is (world-format §2). */
const SHORT_ASCII = 32;

export function cursor(buf: Uint8Array, pos = 0): NbtCursor {
  return { buf, view: new DataView(buf.buffer, buf.byteOffset, buf.byteLength), pos };
}

/** Claims the next `n` bytes and returns where they start. */
function take(c: NbtCursor, n: number): number {
  const at = c.pos;
  if (at + n > c.buf.length) throw new NbtError(`truncated NBT: ${n} bytes needed at byte ${at} of ${c.buf.length}`);
  c.pos = at + n;
  return at;
}

function arrayLength(c: NbtCursor): number {
  const n = c.view.getInt32(take(c, 4));
  if (n < 0) throw new NbtError(`negative NBT length ${n} at byte ${c.pos - 4}`);
  return n;
}

function decodeText(buf: Uint8Array, at: number, len: number): string {
  if (len <= SHORT_ASCII) {
    let text = '';
    for (let i = at; i < at + len; i++) {
      const b = buf[i]!;
      if (b >= 0x80) return UTF8.decode(buf.subarray(at, at + len));
      text += String.fromCharCode(b);
    }
    return text;
  }
  return UTF8.decode(buf.subarray(at, at + len));
}

/** The type byte of the next tag (TAG.End closes a compound). */
export function readTagType(c: NbtCursor): number {
  return c.buf[take(c, 1)]!;
}

/** A u16-length string: a tag name, or a String payload. */
export function readName(c: NbtCursor): string {
  const len = c.view.getUint16(take(c, 2));
  return decodeText(c.buf, take(c, len), len);
}

function deeper(depth: number, at: number): number {
  if (depth >= MAX_DEPTH) throw new NbtError(`NBT nested deeper than ${MAX_DEPTH} at byte ${at}`);
  return depth + 1;
}

function readList(c: NbtCursor, depth: number): NbtValue[] {
  const inner = deeper(depth, c.pos);
  const type = readTagType(c);
  const count = arrayLength(c);
  if (count === 0) return [];
  const min = MIN_SIZE[type];
  if (min === undefined || type === TAG.End) throw new NbtError(`list of ${count} tags of type ${type} at byte ${c.pos - 5}`);
  if (c.pos + count * min > c.buf.length) throw new NbtError(`truncated NBT: a list of ${count} tags of type ${type} at byte ${c.pos - 5}`);
  const items: NbtValue[] = [];
  for (let i = 0; i < count; i++) items.push(payload(c, type, inner));
  return items;
}

function readCompound(c: NbtCursor, depth: number): NbtCompound {
  const inner = deeper(depth, c.pos);
  const out: NbtCompound = {};
  for (let type = readTagType(c); type !== TAG.End; type = readTagType(c)) {
    const name = readName(c);
    const value = payload(c, type, inner);
    // a plain assignment of "__proto__" would replace the prototype instead of adding a key
    if (name === '__proto__') Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
    else out[name] = value;
  }
  return out;
}

function payload(c: NbtCursor, type: number, depth: number): NbtValue {
  switch (type) {
    case TAG.Byte: return c.view.getInt8(take(c, 1));
    case TAG.Short: return c.view.getInt16(take(c, 2));
    case TAG.Int: return c.view.getInt32(take(c, 4));
    case TAG.Long: return Number(c.view.getBigInt64(take(c, 8)));
    case TAG.Float: return c.view.getFloat32(take(c, 4));
    case TAG.Double: return c.view.getFloat64(take(c, 8));
    case TAG.ByteArray: {
      const len = arrayLength(c);
      return new Uint8Array(c.buf.buffer, c.buf.byteOffset + take(c, len), len);
    }
    case TAG.String: return readName(c);
    case TAG.List: return readList(c, depth);
    case TAG.Compound: return readCompound(c, depth);
    case TAG.IntArray: {
      const len = arrayLength(c);
      const at = take(c, len * 4);
      const out = new Int32Array(len);
      for (let i = 0; i < len; i++) out[i] = c.view.getInt32(at + i * 4);
      return out;
    }
    case TAG.LongArray: {
      const len = arrayLength(c);
      const at = take(c, len * 8);
      const out: number[] = [];
      for (let i = 0; i < len; i++) out.push(Number(c.view.getBigInt64(at + i * 8)));
      return out;
    }
    default: throw new NbtError(`unknown NBT tag type ${type} at byte ${c.pos}`);
  }
}

/** The payload of a tag of `type` at the cursor (its type byte and name already read). */
export function readPayload(c: NbtCursor, type: number): NbtValue {
  return payload(c, type, 0);
}

function skip(c: NbtCursor, type: number, depth: number): void {
  const fixed = FIXED_SIZE[type];
  if (fixed !== undefined && fixed > 0) {
    take(c, fixed);
    return;
  }
  switch (type) {
    case TAG.ByteArray: take(c, arrayLength(c)); return;
    case TAG.String: take(c, c.view.getUint16(take(c, 2))); return;
    case TAG.IntArray: take(c, arrayLength(c) * 4); return;
    case TAG.LongArray: take(c, arrayLength(c) * 8); return;
    case TAG.List: {
      const inner = deeper(depth, c.pos);
      const elem = readTagType(c);
      const count = arrayLength(c);
      if (count === 0) return;
      const size = FIXED_SIZE[elem];
      if (size === undefined || elem === TAG.End) throw new NbtError(`list of ${count} tags of type ${elem} at byte ${c.pos - 5}`);
      if (size > 0) take(c, count * size);
      else for (let i = 0; i < count; i++) skip(c, elem, inner);
      return;
    }
    case TAG.Compound: {
      const inner = deeper(depth, c.pos);
      for (let t = readTagType(c); t !== TAG.End; t = readTagType(c)) {
        take(c, c.view.getUint16(take(c, 2)));   // the name
        skip(c, t, inner);
      }
      return;
    }
    default: throw new NbtError(`unknown NBT tag type ${type} at byte ${c.pos}`);
  }
}

/** Moves the cursor past a payload of `type` without building it: arrays and strings by length. */
export function skipPayload(c: NbtCursor, type: number): void {
  skip(c, type, 0);
}

/** The root compound of uncompressed NBT; the root name is read and ignored, trailing bytes are ignored. */
export function parseNbt(buf: Uint8Array): NbtCompound {
  const c = cursor(buf);
  const type = readTagType(c);
  if (type !== TAG.Compound) throw new NbtError(`NBT root is tag type ${type}, not a compound`);
  readName(c);
  return readCompound(c, 0);
}

/** True for gzip data (magic bytes 1f 8b). */
export function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

export function num(v: NbtValue | undefined, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

export function str(v: NbtValue | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

export function comp(v: NbtValue | undefined): NbtCompound | null {
  return typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) ? v : null;
}

/** A List (or LongArray) value; anything else is an empty list. */
export function list(v: NbtValue | undefined): NbtValue[] {
  return Array.isArray(v) ? v : [];
}
