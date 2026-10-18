import { describe, it, expect, vi } from 'vitest';
import { compositeLayers, solidPixels } from '../../src/client/assets/composite.ts';
import { createIconBatcher } from '../../src/client/assets/icon-batcher.ts';
import { assetFileUrl, frameHeight, loadLayerBitmap } from '../../src/client/assets/texture-image.ts';
import { hashColor, type IconDescriptor } from '../../src/shared/types/assets.ts';

const one = (rgba: number[], tint?: [number, number, number]) => ({ data: new Uint8ClampedArray(rgba), width: 1, height: 1, ...(tint ? { tint } : {}) });

describe('compositeLayers', () => {
  it('tints by multiplying RGB and leaves alpha alone', () => {
    expect([...compositeLayers(1, [one([200, 100, 50, 255], [128, 255, 0])])]).toEqual([100, 100, 0, 255]);
  });
  it('draws later layers over earlier ones with straight alpha', () => {
    expect([...compositeLayers(1, [one([0, 0, 255, 255]), one([255, 0, 0, 128])])]).toEqual([128, 0, 127, 255]);
    expect([...compositeLayers(1, [one([0, 0, 255, 128]), one([255, 0, 0, 128])])]).toEqual([170, 0, 85, 192]);
    expect([...compositeLayers(1, [one([9, 9, 9, 0])])]).toEqual([0, 0, 0, 0]);
  });
  it('fills a solid colour', () => {
    expect([...solidPixels(2, [1, 2, 3])]).toEqual([1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 255]);
  });
  it('refuses a layer of another size', () => {
    expect(() => compositeLayers(2, [one([1, 2, 3, 255])])).toThrow(RangeError);
  });
});

describe('createIconBatcher', () => {
  const desc = (key: string): IconDescriptor => ({ key, layers: [], source: 'gt', fallbackColor: [1, 2, 3] });
  function harness(max = 500, fail = false) {
    const calls: string[][] = [];
    let pending: (() => void) | null = null;
    const b = createIconBatcher(async (keys) => {
      calls.push(keys);
      if (fail) throw new Error('boom');
      return keys.filter((k) => k !== 'missing').map(desc);
    }, { max, schedule: (fn) => { pending = fn; } });
    return { b, calls, flush: () => { const f = pending; pending = null; f?.(); } };
  }

  it('collects one tick of requests, de-duplicated, and caches the answers', async () => {
    const h = harness();
    const p = [h.b.get('a'), h.b.get('b'), h.b.get('a')];
    h.flush();
    expect((await Promise.all(p)).map((d) => d.key)).toEqual(['a', 'b', 'a']);
    expect(h.calls).toEqual([['a', 'b']]);
    expect((await h.b.get('a')).key).toBe('a');
    expect(h.calls).toHaveLength(1);
  });

  it('splits large batches at the server cap', async () => {
    const h = harness(500);
    const p = Array.from({ length: 1201 }, (_, i) => h.b.get(`k${i}`));
    h.flush();
    await Promise.all(p);
    expect(h.calls.map((c) => c.length)).toEqual([500, 500, 201]);
  });

  it('answers keys the server left out with a fallback', async () => {
    const h = harness();
    const p = h.b.get('missing');
    h.flush();
    expect(await p).toEqual({ key: 'missing', layers: [], source: 'fallback', fallbackColor: hashColor('missing') });
  });

  it('forgets failed keys so a later request retries', async () => {
    const h = harness(500, true);
    const p = h.b.get('a');
    h.flush();
    await expect(p).rejects.toThrow('boom');
    const q = h.b.get('a');
    h.flush();
    await expect(q).rejects.toThrow('boom');
    expect(h.calls).toEqual([['a'], ['a']]);
  });

  it('refuses a chunk size that is not a positive integer', () => {
    expect(() => createIconBatcher(async () => [], { max: 0 })).toThrow(RangeError);
  });
});

describe('texture images', () => {
  it('builds file URLs segment by segment', () => {
    expect(assetFileUrl('nei/icons/a b#c.png')).toBe('/api/assets/file/nei/icons/a%20b%23c.png');
  });

  it('takes frame 0 of animated strips', () => {
    expect(frameHeight(16, 64, 4)).toBe(16);
    expect(frameHeight(16, 512, 32)).toBe(16);
    expect(frameHeight(32, 32)).toBe(32);
    expect(frameHeight(16, 48)).toBe(16);
  });

  it('loads, crops, resizes and caches a layer; null when it cannot', async () => {
    const calls: unknown[][] = [];
    const bitmap = (width: number, height: number) => ({ width, height, close() {} }) as unknown as ImageBitmap;
    const deps = {
      fetch: vi.fn(async (url: string) => (url.endsWith('missing.png') ? new Response('', { status: 404 }) : new Response(new Uint8Array([1])))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async (...args: unknown[]) => { calls.push(args); return args.length > 1 ? bitmap(16, 16) : bitmap(16, 64); }) as unknown as typeof createImageBitmap,
    };
    const b = await loadLayerBitmap({ path: 'x/textures/blocks/a.png', frames: 4 }, 16, deps);
    expect(b).not.toBeNull();
    expect(calls[1]!.slice(1)).toEqual([0, 0, 16, 16, { resizeWidth: 16, resizeHeight: 16, resizeQuality: 'pixelated' }]);
    expect(await loadLayerBitmap({ path: 'x/textures/blocks/a.png', frames: 4 }, 16, deps)).toBe(b);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(await loadLayerBitmap({ path: 'x/textures/blocks/missing.png' }, 16, deps)).toBeNull();
  });
});
