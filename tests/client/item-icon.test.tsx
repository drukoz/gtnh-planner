import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemIcon, placeholderLetters } from '../../src/client/components/ItemIcon.tsx';
import { iconImageUrl, iconPixelSize } from '../../src/client/assets/icons.ts';
import type { IconDescriptor } from '../../src/shared/types/assets.ts';

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

describe('iconImageUrl', () => {
  // A 1×1 stand-in for the browser: a "PNG" is its RGBA as JSON, a bitmap holds that RGBA, a canvas one pixel.
  class FakeBitmap {
    readonly width = 1;
    readonly height = 1;
    constructor(readonly rgba: number[]) {}
    close(): void {}
  }
  class FakeCanvas {
    pixels = new Uint8ClampedArray(4);
    constructor(readonly width: number, readonly height: number) {}
    getContext() {
      const canvas = this;
      return {
        imageSmoothingEnabled: true,
        clearRect: () => { canvas.pixels = new Uint8ClampedArray(4); },
        drawImage: (bitmap: FakeBitmap) => { canvas.pixels = new Uint8ClampedArray(bitmap.rgba); },
        getImageData: () => ({ data: new Uint8ClampedArray(canvas.pixels) }),
        createImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: (image: { data: Uint8ClampedArray }) => { canvas.pixels = new Uint8ClampedArray(image.data); },
      };
    }
    async convertToBlob(): Promise<Blob> { return new Blob([JSON.stringify([...this.pixels])]); }
  }
  const FILES: Record<string, number[]> = { 'u/base.png': [200, 100, 50, 255], 'u/over.png': [255, 0, 0, 128] };

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
});
