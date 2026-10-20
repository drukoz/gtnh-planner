import { describe, it, expect, vi } from 'vitest';
import { compositeLayers, solidPixels } from '../../src/client/assets/composite.ts';
import { createIconBatcher } from '../../src/client/assets/icon-batcher.ts';
import { assetFileUrl, frameHeight, loadLayerBitmap, resizeSteps } from '../../src/client/assets/texture-image.ts';
import { hashColor, type IconDescriptor, type TextureLayer } from '../../src/shared/types/assets.ts';

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

  it('scales evenly: whole multiples nearest-neighbour, otherwise through the next multiple, downscales smooth', () => {
    expect(resizeSteps(16, 16)).toEqual([{ size: 16, quality: 'pixelated' }]);
    expect(resizeSteps(16, 48)).toEqual([{ size: 48, quality: 'pixelated' }]);
    expect(resizeSteps(16, 24)).toEqual([{ size: 32, quality: 'pixelated' }, { size: 24, quality: 'high' }]);
    expect(resizeSteps(32, 48)).toEqual([{ size: 64, quality: 'pixelated' }, { size: 48, quality: 'high' }]);
    expect(resizeSteps(32, 24)).toEqual([{ size: 24, quality: 'high' }]);
  });

  it('draws a 32 px NEI render at 48 px through 64 px', async () => {
    const calls: unknown[][] = [];
    const bitmap = (w: number, h: number) => ({ width: w, height: h, close() {} }) as unknown as ImageBitmap;
    const deps = {
      fetch: vi.fn(async () => new Response(new Uint8Array([1]))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async (...args: unknown[]) => { calls.push(args); return calls.length === 1 ? bitmap(32, 32) : bitmap(64, 64); }) as unknown as typeof createImageBitmap,
    };
    expect(await loadLayerBitmap({ path: 'nei/icons/abc.png' }, 48, deps)).not.toBeNull();
    expect(calls[1]!.slice(1)).toEqual([0, 0, 32, 32, { resizeWidth: 64, resizeHeight: 64, resizeQuality: 'pixelated' }]);
    expect(calls[2]!.slice(1)).toEqual([{ resizeWidth: 48, resizeHeight: 48, resizeQuality: 'high' }]);
  });

  it('keeps the natural-size crop when no size is asked for', async () => {
    const calls: unknown[][] = [];
    const bitmap = (w: number, h: number) => ({ width: w, height: h, close() {} }) as unknown as ImageBitmap;
    const deps = {
      fetch: vi.fn(async () => new Response(new Uint8Array([1]))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async (...args: unknown[]) => { calls.push(args); return args.length > 1 ? bitmap(32, 32) : bitmap(32, 96); }) as unknown as typeof createImageBitmap,
    };
    expect(await loadLayerBitmap({ path: 'x/textures/items/natural.png', frames: 3 }, undefined, deps)).not.toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.slice(1)).toEqual([0, 0, 32, 32, undefined]);
  });

  it('downscales a 32 px frame to 16 px in one smooth step', async () => {
    const calls: unknown[][] = [];
    const bitmap = (w: number, h: number) => ({ width: w, height: h, close() {} }) as unknown as ImageBitmap;
    const deps = {
      fetch: vi.fn(async () => new Response(new Uint8Array([1]))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async (...args: unknown[]) => { calls.push(args); return args.length > 1 ? bitmap(16, 16) : bitmap(32, 96); }) as unknown as typeof createImageBitmap,
    };
    expect(await loadLayerBitmap({ path: 'x/textures/items/downscaled.png', frames: 3 }, 16, deps)).not.toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.slice(1)).toEqual([0, 0, 32, 32, { resizeWidth: 16, resizeHeight: 16, resizeQuality: 'high' }]);
  });

  it('closes the decoded image and every intermediate step, never the bitmap it returns', async () => {
    const closed: string[] = [];
    const bitmap = (name: string, side: number) => ({ width: side, height: side, close() { closed.push(name); } }) as unknown as ImageBitmap;
    const made = [bitmap('decoded', 32), bitmap('x64', 64), bitmap('x48', 48)];
    const deps = {
      fetch: vi.fn(async () => new Response(new Uint8Array([1]))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async () => made.shift()!) as unknown as typeof createImageBitmap,
    };
    const result = await loadLayerBitmap({ path: 'nei/icons/closing.png' }, 48, deps);
    expect(result?.width).toBe(48);
    expect([...closed].sort()).toEqual(['decoded', 'x64']);
  });

  it('gives null, with nothing left open, when a later step fails', async () => {
    const closed: string[] = [];
    const bitmap = (name: string, side: number) => ({ width: side, height: side, close() { closed.push(name); } }) as unknown as ImageBitmap;
    let decodes = 0;
    const deps = {
      fetch: vi.fn(async () => new Response(new Uint8Array([1]))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async () => {
        decodes += 1;
        if (decodes === 3) throw new Error('resize failed');
        return decodes === 1 ? bitmap('decoded', 32) : bitmap('x64', 64);
      }) as unknown as typeof createImageBitmap,
    };
    expect(await loadLayerBitmap({ path: 'nei/icons/failing.png' }, 48, deps)).toBeNull();
    expect([...closed].sort()).toEqual(['decoded', 'x64']);
  });

  it('crops a region, scaled to the file, straight to its place nearest-neighbour; caches by path and region', async () => {
    const calls: unknown[][] = [];
    const bitmap = (w: number, h: number) => ({ width: w, height: h, close() {} }) as unknown as ImageBitmap;
    const deps = {
      fetch: vi.fn(async () => new Response(new Uint8Array([1]))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async (...args: unknown[]) => { calls.push(args); return args.length > 1 ? bitmap(14, 10) : bitmap(128, 128); }) as unknown as typeof createImageBitmap,
    };
    const chest: TextureLayer = { path: 'x.png', region: { sheet: 64, src: [14, 33, 14, 10], dst: [1, 6, 14, 10] } };
    const cropped = await loadLayerBitmap(chest, 16, deps);
    expect(cropped).not.toBeNull();
    expect(calls).toHaveLength(2);   // decode, then the one crop: no second resize step
    expect(calls[1]!.slice(1)).toEqual([28, 66, 28, 20, { resizeWidth: 14, resizeHeight: 10, resizeQuality: 'pixelated' }]);
    expect(await loadLayerBitmap({ ...chest, region: { ...chest.region! } }, 16, deps)).toBe(cropped);   // an equal region is the same entry
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(await loadLayerBitmap({ path: 'x.png' }, 16, deps)).not.toBe(cropped);   // the same file without a region is its own entry
    await loadLayerBitmap({ path: 'x.png' }, 16, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    await loadLayerBitmap(chest, undefined, deps);   // no size: the crop at its own size
    expect(calls.at(-1)!.slice(1)).toEqual([28, 66, 28, 20, undefined]);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
  });
});
