import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  averageTopColor, FACES_BATCH, fallbackColor, layerPixels, OVERRIDE_COLORS, packRgb, PALETTE_TEXTURE_SIZE, resolvePaletteColors, unpackRgb,
  type PaletteDeps,
} from '../../src/client/map/palette.ts';
import { loadLayerBitmap } from '../../src/client/assets/texture-image.ts';
import type { LayerPixels } from '../../src/client/assets/composite.ts';
import { hashColor, type BlockFaces, type Rgb, type TextureLayer } from '../../src/shared/types/assets.ts';
import type { BlockRef } from '../../src/shared/types/pack.ts';
import { UNKNOWN_BLOCK } from '../../src/shared/types/world.ts';

vi.mock('../../src/client/assets/texture-image.ts', () => ({
  loadLayerBitmap: vi.fn(async () => ({ width: 16, height: 16, close() {} })),
}));

/** A fake OffscreenCanvas whose 2D context answers every getImageData with grey pixels and records drawImage. */
class FakeCanvas {
  static draws: unknown[][] = [];
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(): unknown {
    return {
      drawImage: (...args: unknown[]) => { FakeCanvas.draws.push(args); },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }),
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const AIR: BlockRef = { id: 'minecraft:air', meta: 0 };
const NO_FACES = { down: [], up: [], north: [], south: [], west: [], east: [] };

type FakeSpec = { path: string; pixels: number[] } | { unresolved: Rgb };

/** Answers `faces` from `specs` by block id (others: resolved, no textures) and records each batch size. */
function fakeDeps(specs: Record<string, FakeSpec>): PaletteDeps & { facesCalls: number[] } {
  const facesCalls: number[] = [];
  const pixelsByPath = new Map<string, number[]>();
  for (const spec of Object.values(specs)) if ('path' in spec) pixelsByPath.set(spec.path, spec.pixels);
  return {
    facesCalls,
    async faces(blocks) {
      facesCalls.push(blocks.length);
      return blocks.map((block): BlockFaces => {
        const spec = specs[block.id];
        if (spec !== undefined && 'unresolved' in spec) return { block, faces: NO_FACES, fallbackColor: spec.unresolved, resolved: false };
        return { block, faces: { ...NO_FACES, up: spec === undefined ? [] : [{ path: spec.path }] }, fallbackColor: [1, 2, 3], resolved: true };
      });
    },
    async image(layer) {
      const pixels = pixelsByPath.get(layer.path);
      return pixels === undefined ? null : { data: new Uint8ClampedArray(pixels), width: 1, height: 1 };
    },
  };
}

describe('averageTopColor', () => {
  it('averages opaque pixels, applies tint and alpha-composites overlays', () => {
    const px = (...a: number[]) => new Uint8ClampedArray(a);
    expect(averageTopColor([{ data: px(255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255), width: 2, height: 2 }])).toEqual([170, 85, 170]);
    expect(averageTopColor([{ data: px(255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255), width: 2, height: 2, tint: [128, 255, 255] }])).toEqual([85, 85, 170]);
    expect(averageTopColor([{ data: px(100, 100, 100, 255), width: 1, height: 1 }, { data: px(200, 0, 0, 128), width: 1, height: 1 }])).toEqual([150, 50, 50]);
    expect([averageTopColor([]), averageTopColor([{ data: px(9, 9, 9, 0), width: 1, height: 1 }])]).toEqual([null, null]);
  });
});

describe('layerPixels', () => {
  it('loads layer pixels through Plan 3 loadLayerBitmap at 16 px', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    FakeCanvas.draws = [];
    const p = await layerPixels({ path: 'gregtech/textures/blocks/iconsets/MACHINE_MV_SIDE.png', tint: [128, 255, 255], frames: 4 });
    expect(loadLayerBitmap).toHaveBeenCalledWith({ path: 'gregtech/textures/blocks/iconsets/MACHINE_MV_SIDE.png', tint: [128, 255, 255], frames: 4 }, 16);
    expect([p!.width, p!.height, p!.data.length, p!.tint]).toEqual([16, 16, 1024, [128, 255, 255]]);
    expect(FakeCanvas.draws).toHaveLength(1);
    vi.mocked(loadLayerBitmap).mockResolvedValueOnce(null);
    expect(await layerPixels({ path: 'missing.png' })).toBeNull();
    expect(PALETTE_TEXTURE_SIZE).toBe(16);
  });
});

describe('fallbackColor and packing', () => {
  it('uses overrides, then name rules on the block name, then a stable hash colour', () => {
    expect(fallbackColor({ id: 'minecraft:grass', meta: 0 })).toEqual([127, 178, 56]);
    expect(fallbackColor(UNKNOWN_BLOCK)).toEqual(OVERRIDE_COLORS['gtnh-planner:unknown']);
    expect(fallbackColor({ id: 'gregtech:gt.blockores', meta: 86 })).toEqual([125, 125, 125]);
    expect(fallbackColor({ id: 'IC2:blockOreCopper', meta: 0 })).toEqual([125, 125, 125]);
    expect(fallbackColor({ id: 'Forestry:log1', meta: 0 })).toEqual([143, 119, 72]);   // "Forestry" is the mod, not an ore
    expect(fallbackColor({ id: 'minecraft:sand', meta: 0 })).toEqual([219, 207, 163]);
    expect(fallbackColor({ id: 'minecraft:dirt', meta: 2 })).toEqual([134, 96, 67]);
    expect(fallbackColor({ id: 'minecraft:glass', meta: 0 })).toEqual([192, 220, 235]);
    expect(fallbackColor({ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 })).toEqual([96, 125, 139]);
    expect(fallbackColor({ id: 'gregtech:gt.blockcasings', meta: 2 })).toEqual([158, 158, 158]);
    expect(fallbackColor({ id: 'mod:thing', meta: 3 })).toEqual(hashColor('mod:thing@3'));
  });

  it('packs and unpacks RGB', () => {
    expect(packRgb([1, 2, 3])).toBe(0x010203);
    expect(unpackRgb(packRgb([255, 128, 0]))).toEqual([255, 128, 0]);
  });
});

describe('resolvePaletteColors', () => {
  it('resolves colours in batches with overrides and fallbacks, and survives a failing assets API', async () => {
    const palette = [AIR, UNKNOWN_BLOCK, { id: 'minecraft:stone', meta: 0 }, { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 }, { id: 'minecraft:grass', meta: 0 },
                     ...Array.from({ length: 445 }, (_, i) => ({ id: `mod:b${i}`, meta: 0 }))];
    const deps = fakeDeps({ 'minecraft:stone': { path: 'minecraft/textures/blocks/stone.png', pixels: [120, 120, 120, 255] },
                            'gregtech:gt.blockmachines': { unresolved: [10, 20, 30] }, 'minecraft:grass': { path: 'g.png', pixels: [90, 90, 90, 255] } });
    const updates: number[] = [];
    const c = await resolvePaletteColors(palette, deps, () => updates.push(1));
    expect([unpackRgb(c[2]!), unpackRgb(c[3]!), unpackRgb(c[4]!)]).toEqual([[120, 120, 120], [10, 20, 30], [127, 178, 56]]);
    expect(unpackRgb(c[1]!)).toEqual([32, 32, 36]);
    expect(unpackRgb(c[5]!)).toEqual(fallbackColor({ id: 'mod:b0', meta: 0 }));   // resolved, but without textures
    expect(deps.facesCalls).toEqual([FACES_BATCH, FACES_BATCH, 50]);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const broken = await resolvePaletteColors(palette, { faces: async () => { throw new Error('404'); }, image: async () => null });
    expect(unpackRgb(broken[2]!)).toEqual(fallbackColor({ id: 'minecraft:stone', meta: 0 }));
  });

  it('reports the fallbacks at once, keeps a failed batch on fallbacks and still asks for the later ones', async () => {
    const palette = Array.from({ length: 450 }, (_, i) => ({ id: `minecraft:stone${i}`, meta: 0 }));
    let call = 0;
    const seen: number[][] = [];
    const deps: PaletteDeps = {
      async faces(blocks) {
        call++;
        if (call === 2) throw new Error('400 bad block');
        return blocks.map((block) => ({ block, faces: { ...NO_FACES, up: [{ path: 'p.png' }] }, fallbackColor: [0, 0, 0], resolved: true }));
      },
      image: async () => ({ data: new Uint8ClampedArray([7, 8, 9, 255]), width: 1, height: 1 }),
    };
    const c = await resolvePaletteColors(palette, deps, (colors) => seen.push([colors[0]!, colors[449]!]));
    const grey = packRgb([125, 125, 125]), resolved = packRgb([7, 8, 9]);
    expect([c[0], c[199], c[200], c[399], c[400], c[449]]).toEqual([resolved, resolved, grey, grey, resolved, resolved]);
    expect(seen).toEqual([[grey, grey], [resolved, grey], [resolved, resolved]]);   // fallbacks, batch 1, batch 3 (batch 2 failed)
  });

  it('treats layers it cannot composite or load as no average', async () => {
    const layers: Record<string, LayerPixels | null> = {
      'a.png': { data: new Uint8ClampedArray([1, 1, 1, 255]), width: 1, height: 1 },
      'b.png': { data: new Uint8ClampedArray(16).fill(255), width: 2, height: 2 },
    };
    const deps: PaletteDeps = {
      faces: async (blocks) => blocks.map((block, i) => ({
        block, faces: { ...NO_FACES, up: i === 0 ? [{ path: 'a.png' }, { path: 'b.png' }] : [{ path: 'gone.png' }] }, fallbackColor: [5, 5, 5], resolved: i === 0,
      })),
      image: async (layer: TextureLayer) => {
        if (layer.path === 'gone.png') throw new Error('network');
        return layers[layer.path] ?? null;
      },
    };
    const palette = [{ id: 'mod:mixed', meta: 0 }, { id: 'mod:gone', meta: 0 }];
    const c = await resolvePaletteColors(palette, deps);
    expect(unpackRgb(c[0]!)).toEqual(fallbackColor(palette[0]!));   // 1×1 and 2×2 layers: RangeError → local fallback
    expect(unpackRgb(c[1]!)).toEqual([5, 5, 5]);                     // unresolved and its texture failed → the server's fallback
  });
});
