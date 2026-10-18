import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  comp as compOf, cursor, isGzip, list as listOf, NbtError, num, parseNbt, readGzipNbt, readName, readPayload, readTagType,
  skipPayload, str as strOf, TAG,
} from '../../../src/server/world/nbt.ts';
import { byte, bytes, comp, double, float, int, ints, list, long, longs, short, str, writeNbt } from '../../helpers/nbt-write.ts';

describe('parseNbt', () => {
  it('parses every tag type', () => {
    const buf = writeNbt(comp({ b: byte(-1), s: short(-2), i: int(70000), l: long(1234567890123n), f: float(1.5), d: double(2.25),
      t: str('gregtech:gt.blockmachines'), ba: bytes([1, 255]), ia: ints([1, -1]), la: longs([5n]), li: list('int', [int(1), int(2)]),
      e: list('end', []), c: comp({ x: int(3) }), 'GT.ItemCharge': long(5n) }));
    const n = parseNbt(buf);
    expect([n.b, n.s, n.i, n.l, n.f, n.d, n.t]).toEqual([-1, -2, 70000, 1234567890123, 1.5, 2.25, 'gregtech:gt.blockmachines']);
    expect(Array.from(n.ba as Uint8Array)).toEqual([1, 255]);
    expect(Array.from(n.ia as Int32Array)).toEqual([1, -1]);
    expect([n.la, n.li, n.e, n.c, n['GT.ItemCharge']]).toEqual([[5], [1, 2], [], { x: 3 }, 5]);
  });

  it('returns byte arrays as views of the input, not copies', () => {
    const buf = writeNbt(comp({ ba: bytes([7, 8, 9]) }));
    const ba = parseNbt(buf).ba as Uint8Array;
    expect([ba.constructor, ba.buffer === buf.buffer, ba[0]]).toEqual([Uint8Array, true, 7]);
  });

  it('throws NbtError on truncated input', () => expect(() => parseNbt(writeNbt(comp({ a: str('abcdef') })).subarray(0, 8))).toThrow(NbtError));

  it('throws NbtError on a non-compound root, an unknown tag type and negative lengths', () => {
    expect(() => parseNbt(writeNbt(int(1)))).toThrow(NbtError);
    expect(() => parseNbt(Uint8Array.of(10, 0, 0, 13, 0, 1, 0x61, 0))).toThrow(NbtError);   // tag type 13 'a'
    expect(() => parseNbt(Uint8Array.of(10, 0, 0, 7, 0, 1, 0x61, 0xff, 0xff, 0xff, 0xff, 0))).toThrow(NbtError);   // ByteArray length -1
  });

  it('refuses nesting deeper than 512 with NbtError, reading and skipping alike', () => {
    let deep = comp({}), list600 = list('end', []);
    for (let d = 0; d < 600; d++) { deep = comp({ a: deep }); list600 = list('list', [list600]); }
    for (const t of [deep, comp({ l: list600 })]) {
      expect(() => parseNbt(writeNbt(t))).toThrow(NbtError);
      const c = cursor(writeNbt(t), 3);
      expect(() => skipPayload(c, TAG.Compound)).toThrow(NbtError);
    }
    let ok = comp({});
    for (let d = 0; d < 500; d++) ok = comp({ a: ok });
    expect(() => parseNbt(writeNbt(ok))).not.toThrow();
  });

  it('keeps a "__proto__" key as an own property', () => {
    const n = parseNbt(writeNbt(comp({ ['__proto__']: comp({ polluted: int(1) }), x: int(2) })));
    expect([Object.getPrototypeOf(n), Object.hasOwn(n, '__proto__'), (n as Record<string, unknown>).polluted, n.x]).toEqual([Object.prototype, true, undefined, 2]);
  });
});

describe('cursor primitives', () => {
  it('skips a payload and lands on the next tag', () => {
    const c = cursor(writeNbt(comp({ big: bytes(new Uint8Array(10000)), after: int(7) })));
    expect([readTagType(c), readName(c)]).toEqual([TAG.Compound, '']);
    expect([readTagType(c), readName(c)]).toEqual([TAG.ByteArray, 'big']);
    skipPayload(c, TAG.ByteArray);
    expect([readTagType(c), readName(c)]).toEqual([TAG.Int, 'after']);
    expect(readPayload(c, TAG.Int)).toBe(7);
  });

  it('skips every tag type, nested lists and compounds included', () => {
    const every = comp({ b: byte(1), s: short(2), i: int(3), l: long(4n), f: float(5), d: double(6), t: str('seven'), ba: bytes([8]),
      ia: ints([9, 10]), la: longs([11n]), ls: list('string', [str('a'), str('bc')]), ll: list('list', [list('int', [int(1)]), list('end', [])]),
      lc: list('compound', [comp({ x: int(1) }), comp({})]), c: comp({ inner: comp({ y: bytes([1, 2, 3]) }) }) });
    const c = cursor(writeNbt(comp({ every, after: str('here') })));
    readTagType(c); readName(c);
    expect([readTagType(c), readName(c)]).toEqual([TAG.Compound, 'every']);
    skipPayload(c, TAG.Compound);
    expect([readTagType(c), readName(c), readPayload(c, TAG.String), readTagType(c)]).toEqual([TAG.String, 'after', 'here', TAG.End]);
    expect(c.pos).toBe(c.buf.length);
  });

  it('starts a cursor at an offset and throws NbtError when a skip runs past the end', () => {
    const buf = writeNbt(comp({ a: str('abcdef') }));
    const c = cursor(buf, 3);
    expect([readTagType(c), readName(c)]).toEqual([TAG.String, 'a']);
    expect(() => skipPayload(cursor(buf.subarray(0, 9), 7), TAG.String)).toThrow(NbtError);
  });
});

describe('gzip and getters', () => {
  it('reads gzip and raw NBT alike', () => {
    const raw = writeNbt(comp({ a: int(1) }));
    expect(readGzipNbt(gzipSync(raw))).toEqual(readGzipNbt(raw));
    expect(readGzipNbt(raw)).toEqual({ a: 1 });
    expect([isGzip(gzipSync(raw)), isGzip(raw), isGzip(Uint8Array.of(0x1f))]).toEqual([true, false, false]);
  });

  it('reads values by type with fallbacks', () => {
    const n = parseNbt(writeNbt(comp({ i: int(4), t: str('x'), c: comp({ y: int(1) }), l: list('int', [int(1)]), ba: bytes([1]) })));
    expect([num(n.i), num(n.t), num(n.missing, 9), strOf(n.t), strOf(n.i), strOf(undefined)]).toEqual([4, 0, 9, 'x', null, null]);
    expect([compOf(n.c), compOf(n.l), compOf(n.ba), compOf(n.i), compOf(undefined)]).toEqual([{ y: 1 }, null, null, null, null]);
    expect([listOf(n.l), listOf(n.c), listOf(undefined)]).toEqual([[1], [], []]);
  });
});
