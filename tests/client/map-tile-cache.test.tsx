import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTileCache, type TileKey } from '../../src/client/map/tile-cache.ts';
import { worldApi } from '../../src/client/map/api.ts';
import { ApiError } from '../../src/client/api/client.ts';
import { setName } from '../../src/client/state/name.ts';
import { NAME_HEADER } from '../../src/shared/types/api.ts';
import { encodeMapTile, TILE_SIZE, type MapTile } from '../../src/shared/types/world.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function emptyTile(k: Pick<TileKey, 'dim' | 'tx' | 'tz'>): MapTile {
  return { dim: k.dim, tx: k.tx, tz: k.tz, size: TILE_SIZE, top: new Uint32Array(TILE_SIZE * TILE_SIZE), height: new Uint8Array(TILE_SIZE * TILE_SIZE) };
}

/** Heights all 0 except column `i`. */
function heightsWith(i: number, h: number): Uint8Array {
  const height = new Uint8Array(TILE_SIZE * TILE_SIZE);
  height[i] = h;
  return height;
}

describe('createTileCache', () => {
  it('shares concurrent loads, evicts least recently used, answers surfaceY from cached surface tiles', async () => {
    const fetchTile = vi.fn(async (k: TileKey) => ({ ...emptyTile(k), height: heightsWith(4095, 70) }));
    const cache = createTileCache(fetchTile, 2);
    const k = { scanId: 's', dim: 0, tx: -1, tz: -1, y: 255 };
    await Promise.all([cache.load(k), cache.load(k)]);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect([cache.surfaceY('s', 0, -1, -1), cache.surfaceY('s', 0, 500, 500)]).toEqual([70, null]);
    await cache.load({ ...k, tx: 0 }); await cache.load({ ...k, tx: 1 });
    expect(cache.get(k)).toBeUndefined();
  });

  it('keeps a recently read tile, answers null for height 0 or other y levels, and forgets failed loads', async () => {
    let fail = true;
    const fetchTile = vi.fn(async (k: TileKey) => {
      if (fail && k.tx === 9) throw new Error('409');
      return { ...emptyTile(k), height: heightsWith(0, 64) };
    });
    const cache = createTileCache(fetchTile, 2);
    const a = { scanId: 's', dim: 0, tx: 0, tz: 0, y: 255 }, b = { ...a, tx: 1 }, c = { ...a, tx: 2 };
    await cache.load(a); await cache.load(b);
    expect(cache.get(a)).toBeDefined();   // a is now the most recently used
    await cache.load(c);
    expect([cache.get(a) !== undefined, cache.get(b) !== undefined]).toEqual([true, false]);
    expect([cache.surfaceY('s', 0, 0.7, 0.2), cache.surfaceY('s', 0, 1, 0), cache.surfaceY('s', 1, 0, 0)]).toEqual([64, null, null]);
    await cache.load({ ...a, y: 40 });
    expect(cache.surfaceY('s', 0, 0, 0)).toBe(64);   // only y = 255 tiles answer
    await expect(cache.load({ ...a, tx: 9 })).rejects.toThrow('409');
    fail = false;
    await expect(cache.load({ ...a, tx: 9 })).resolves.toMatchObject({ tx: 9 });
    expect(fetchTile).toHaveBeenCalledTimes(6);
  });

  it('drops loads that finish after clear()', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const cache = createTileCache(async (k) => { await gate; return emptyTile(k); });
    const k = { scanId: 's', dim: 0, tx: 0, tz: 0, y: 255 };
    const p = cache.load(k);
    cache.clear();
    release();
    await p;
    expect(cache.get(k)).toBeUndefined();
  });
});

describe('worldApi', () => {
  type Call = { url: string; init: RequestInit };
  function stubFetch(answer: (url: string) => Response): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer(url);
    }));
    return calls;
  }

  it('fetches a binary tile at a y level with the name header and decodes it', async () => {
    setName('Jörg 🙂');
    const tile = { ...emptyTile({ dim: -1, tx: -3, tz: 2 }), height: heightsWith(7, 99) };
    tile.top[7] = 12;
    const calls = stubFetch(() => new Response(encodeMapTile(tile), { status: 200 }));
    const got = await worldApi.tile('scan 1', -1, -3, 2, 64);
    expect(got).toEqual(tile);
    expect(calls[0]!.url).toBe('/api/world/scans/scan%201/tiles/-1/-3/2?y=64');
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect((calls[0]!.init.headers as Record<string, string>)[NAME_HEADER]).toBe(encodeURIComponent('Jörg 🙂'));
  });

  it('puts a raw file with each path segment encoded', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const body = new Blob([new Uint8Array([1, 2, 3])]);
    await worldApi.putFile('u 1', 'DIM-1/region/r.0.0.mca', body);
    await worldApi.putFile('u1', 'a b/c#d?.dat', body);
    expect(calls.map((c) => c.url)).toEqual(['/api/world/uploads/u%201/files/DIM-1/region/r.0.0.mca', '/api/world/uploads/u1/files/a%20b/c%23d%3F.dat']);
    expect([calls[0]!.init.method, calls[0]!.init.body, calls[0]!.init.credentials]).toEqual(['PUT', body, 'same-origin']);
  });

  it("turns a failed binary answer into Plan 2's ApiError", async () => {
    stubFetch((url) => url.includes('/tiles/')
      ? new Response(JSON.stringify({ error: 'not-finished', message: 'Scan is not finished' }), { status: 409 })
      : new Response('<html>bad gateway</html>', { status: 502 }));
    const tileErr = await worldApi.tile('s', 0, 0, 0, 255).catch((e: unknown) => e);
    expect(tileErr).toBeInstanceOf(ApiError);
    expect(tileErr).toMatchObject({ status: 409, code: 'not-finished', message: 'Scan is not finished' });
    await expect(worldApi.putFile('u', 'level.dat', new Blob([]))).rejects.toMatchObject({ status: 502, code: 'http-502', message: 'The server answered 502' });
  });

  it('answers the ids of JSON calls through apiGet / apiPost', async () => {
    const calls = stubFetch((url) => {
      if (url === '/api/world/scans') return Response.json({ scanId: 'sc1' });
      if (url === '/api/world/uploads') return Response.json({ uploadId: 'up1' });
      if (url === '/api/world/uploads/up%201/complete') return Response.json({ scanId: 'sc2' });
      if (url === '/api/assets/blocks') return Response.json([]);
      return new Response(null, { status: 204 });
    });
    expect(await worldApi.start({ kind: 'backup', file: 'a.zip' })).toBe('sc1');
    expect(await worldApi.createUpload()).toBe('up1');
    expect(await worldApi.completeUpload('up 1')).toBe('sc2');
    expect(await worldApi.cancel('x/y')).toBeUndefined();
    expect(await worldApi.blockFaces([{ id: 'minecraft:stone', meta: 0 }])).toEqual([]);
    expect(calls.map((c) => [c.init.method, c.url, c.init.body ?? null])).toEqual([
      ['POST', '/api/world/scans', JSON.stringify({ source: { kind: 'backup', file: 'a.zip' } })],
      ['POST', '/api/world/uploads', null],
      ['POST', '/api/world/uploads/up%201/complete', null],
      ['POST', '/api/world/scans/x%2Fy/cancel', null],
      ['POST', '/api/assets/blocks', JSON.stringify({ blocks: [{ id: 'minecraft:stone', meta: 0 }] })],
    ]);
  });
});
