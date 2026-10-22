import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemIcon, placeholderClass, placeholderInk, placeholderLetters } from '../../src/client/components/ItemIcon.tsx';
import { iconImageUrl, iconPixelSize, useItemIcon } from '../../src/client/assets/icons.ts';
import type { IconDescriptor } from '../../src/shared/types/assets.ts';

// The real hook, except where a test hands ItemIcon a descriptor and an image URL (server rendering never gets either).
vi.mock('../../src/client/assets/icons.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/assets/icons.ts')>();
  return { ...actual, useItemIcon: vi.fn(actual.useItemIcon) };
});

describe('ItemIcon', () => {
  it('renders the placeholder until the icon is ready', () => {
    const html = renderToStaticMarkup(<ItemIcon itemKey="fluid:water" size={16} />);
    expect(html).toContain('data-item-key="fluid:water"');
    expect(html).toContain('data-icon-source="loading"');
    expect(html).toContain('title="fluid:water"');
    expect(html).toContain('width:16px');
    expect(html).toContain('rgb(89, 192, 106)');
    expect(html).toContain('>WA<');
  });

  it('names the good it shows in its tooltip and accessible name', () => {
    const html = renderToStaticMarkup(<ItemIcon itemKey="t:copper_wire@0" size={16} name="Copper Wire" />);
    expect(html).toContain('title="Copper Wire"');
    expect(html).toContain('aria-label="Copper Wire"');
    expect(html).not.toContain('title="t:copper_wire@0"');
    expect(html).not.toContain('aria-label="t:copper_wire@0"');
    expect(html).toContain('data-item-key="t:copper_wire@0"');               // the key stays for the code that looks it up
  });

  it('keeps the placeholder letters', () => {
    expect(placeholderLetters('gregtech:gt.metaitem.01@2032')).toBe('GT');
    expect(placeholderLetters('fluid:molten.iron')).toBe('MO');
    expect(placeholderLetters('t:iron_ingot@0')).toBe('IR');
  });

  it('renders at least 16 device pixels', () => {
    expect(iconPixelSize(8)).toBe(16);
    expect(iconPixelSize(24)).toBe(24);
  });
});

describe('placeholder ink', () => {
  it('light placeholders get dark ink; hash colours keep white letters; every placeholder has a border', () => {
    expect(placeholderInk([255, 255, 255])).toBe('dark');   // GT Basic, white non-GT fluids
    expect(placeholderInk([255, 233, 0])).toBe('dark');     // luma 213
    expect(placeholderInk([192, 192, 89])).toBe('light');   // the lightest hashColor (luma 180)
    expect(placeholderInk([128, 128, 128])).toBe('light');
    expect(placeholderClass([255, 255, 255])).toBe('item-icon placeholder ink-dark');
    expect(placeholderClass([89, 192, 106])).toBe('item-icon placeholder');
    expect(renderToStaticMarkup(<ItemIcon itemKey="fluid:water" size={16} />)).toContain('class="item-icon placeholder"');
  });

  it('switches to dark ink at luma 200 exactly', () => {
    expect(placeholderInk([200, 200, 200])).toBe('dark');
    expect(placeholderInk([199, 199, 199])).toBe('light');
  });

  it('puts dark ink on a light server colour, and drops the placeholder class once the image shows', () => {
    const desc: IconDescriptor = { key: 'fluid:snow', source: 'fallback', fallbackColor: [255, 255, 255], layers: [] };
    vi.mocked(useItemIcon).mockReturnValueOnce({ desc, url: null });
    const placeholder = renderToStaticMarkup(<ItemIcon itemKey="fluid:snow" size={16} />);
    expect(placeholder).toContain('class="item-icon placeholder ink-dark"');
    expect(placeholder).toContain('background:rgb(255, 255, 255)');

    vi.mocked(useItemIcon).mockReturnValueOnce({ desc: { ...desc, source: 'nei' }, url: 'blob:icon-1' });
    const shown = renderToStaticMarkup(<ItemIcon itemKey="fluid:snow" size={16} />);
    expect(shown).toContain('class="item-icon"');
    expect(shown).toContain('src="blob:icon-1"');
    expect(shown).not.toContain('placeholder');
    expect(shown).not.toContain('background');
  });
});

describe('iconImageUrl', () => {
  // A 1×1 stand-in for the browser: a "PNG" is its RGBA as JSON, a bitmap holds that RGBA, a canvas one pixel.
  class FakeBitmap {
    readonly width = 1;
    readonly height = 1;
    constructor(readonly rgba: number[]) {}
    close(): void {}
  }
  /** Every drawImage call's arguments, in order. */
  const draws: unknown[][] = [];
  class FakeCanvas {
    pixels = new Uint8ClampedArray(4);
    constructor(readonly width: number, readonly height: number) {}
    getContext() {
      const canvas = this;
      return {
        imageSmoothingEnabled: true,
        clearRect: () => { canvas.pixels = new Uint8ClampedArray(4); },
        drawImage: (bitmap: FakeBitmap, ...at: number[]) => { draws.push([bitmap, ...at]); canvas.pixels = new Uint8ClampedArray(bitmap.rgba); },
        getImageData: () => ({ data: new Uint8ClampedArray(canvas.pixels) }),
        createImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => { canvas.pixels = new Uint8ClampedArray(image.data); },
      };
    }
    async convertToBlob(): Promise<Blob> { return new Blob([JSON.stringify([...this.pixels])]); }
  }
  const FILES: Record<string, number[]> = { 'u/base.png': [200, 100, 50, 255], 'u/over.png': [255, 0, 0, 128], 'u/sheet.png': [10, 20, 30, 255] };

  async function withBrowser<T>(run: (made: Blob[]) => Promise<T>): Promise<T> {
    const made: Blob[] = [];
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.stubGlobal('fetch', async (url: string) => {
      const rgba = FILES[decodeURIComponent(url.replace('/api/assets/file/', ''))];
      return rgba ? new Response(JSON.stringify(rgba)) : new Response(null, { status: 404 });
    });
    vi.stubGlobal('createImageBitmap', async (src: Blob | FakeBitmap) =>
      src instanceof FakeBitmap ? new FakeBitmap(src.rgba) : new FakeBitmap(JSON.parse(await src.text()) as number[]));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      made.push(blob as Blob);
      return `blob:icon-${made.length}`;
    });
    try {
      return await run(made);
    } finally {
      createObjectURL.mockRestore();
      vi.unstubAllGlobals();
    }
  }

  it('stacks the layers that load, each with its own tint, into one cached PNG', async () => {
    await withBrowser(async (made) => {
      const desc: IconDescriptor = {
        key: 't:tinted@0', source: 'gt', fallbackColor: [1, 2, 3],
        layers: [{ path: 'u/base.png', tint: [128, 255, 0] }, { path: 'u/missing.png' }, { path: 'u/over.png' }],
      };
      const first = iconImageUrl(desc, 1);
      expect(iconImageUrl(desc, 1)).toBe(first);
      expect(await first).toBe('blob:icon-1');
      expect(made).toHaveLength(1);
      // base tinted to [100, 100, 0], then the untinted half-transparent red drawn over it
      expect(JSON.parse(await made[0]!.text())).toEqual([178, 50, 0, 255]);
    });
  });

  it('gives null when no layer loads', async () => {
    await withBrowser(async (made) => {
      const desc: IconDescriptor = { key: 't:gone@0', source: 'jar', fallbackColor: [1, 2, 3], layers: [{ path: 'u/nothing.png' }] };
      expect(await iconImageUrl(desc, 1)).toBeNull();
      expect(made).toHaveLength(0);
    });
  });

  it('draws a region layer at its place in the icon', async () => {
    await withBrowser(async () => {
      draws.length = 0;
      const desc: IconDescriptor = { key: 't:chest@0', source: 'jar', fallbackColor: [1, 2, 3],
        layers: [{ path: 'u/sheet.png', region: { sheet: 64, src: [14, 33, 14, 10], dst: [1, 6, 14, 10] } }] };
      // The 1×1 fake canvas cannot composite a 32 px icon (compositeLayers refuses its 4 bytes); only where the layer goes counts here.
      await iconImageUrl(desc, 32).catch(() => null);
      expect(draws).toEqual([[expect.any(FakeBitmap), 2, 12, 28, 20]]);
    });
  });
});
