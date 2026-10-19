// GET /api/world/scans/:id/palette?names=1 (architecture §11, Map hover): every palette entry with its English name, in
// palette order, for the map's hover tooltip; without names=1 the route answers exactly as before. The world service is
// a stub holding one palette with an entry per naming rule; the pack is testPack() plus a few block items.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AppContext } from '../../../src/server/app.ts';
import { DEFAULT_CONFIG } from '../../../src/server/config.ts';
import { HttpError } from '../../../src/server/http/router.ts';
import { worldRoutes } from '../../../src/server/http/routes/world.ts';
import type { WorldService } from '../../../src/server/world/scan.ts';
import { itemKey } from '../../../src/shared/keys.ts';
import type { PaletteName } from '../../../src/shared/types/api.ts';
import type { BlockRef, Pack } from '../../../src/shared/types/pack.ts';
import { serveRoutes } from '../../helpers/serve-routes.ts';
import { testPack } from '../../helpers/world-facts.ts';

const SCAN_ID = '20261017T120000Z-abcdef';
const RUNNING_ID = '20261017T120000Z-012345';
const GT = 'gregtech:gt.blockmachines';

/** Each palette entry with the name it must get. */
const ENTRIES: ReadonlyArray<readonly [BlockRef, string]> = [
  [{ id: 'minecraft:air', meta: 0 }, 'Air'],
  [{ id: 'gtnh-planner:unknown', meta: 0 }, 'Unknown block'],
  [{ id: 'minecraft:stone', meta: 0 }, 'Stone'],
  [{ id: 'minecraft:log', meta: 1 }, 'Spruce Wood'],               // the item of its own meta
  [{ id: 'minecraft:log', meta: 4 }, 'Oak Wood'],                  // no item of meta 4 (a log lying east–west): the item of meta 0
  [{ id: GT, meta: 1, mteId: 2002 }, 'Advanced Assembler'],        // Pack.machines, not the item of its block meta
  [{ id: GT, meta: 2, mteId: 31999 }, 'Unknown machine #31999'],  // a machine the export does not know
  [{ id: GT, meta: 1 }, GT],                                       // no tile id: the registry name, again not the item of meta 1
  [{ id: 'SomeMod:block', meta: 3 }, 'SomeMod:block'],             // nothing in the pack: the registry name (pack.nameOf would say "SomeMod:block@3")
];
const PALETTE: BlockRef[] = ENTRIES.map(([block]) => block);

/** testPack() with block items: stone, oak and spruce wood, and the item of mID 1 (another machine than 2002). */
function blockPack(): Pack {
  const pack = testPack();
  const items: Array<[string, number, string]> = [['minecraft:stone', 0, 'Stone'], ['minecraft:log', 0, 'Oak Wood'], ['minecraft:log', 1, 'Spruce Wood'], [GT, 1, 'ULV Machine Hull']];
  for (const [id, meta, name] of items) pack.items.set(itemKey(id, meta), { key: itemKey(id, meta), id, meta, name, oreDict: [] });
  return pack;
}

const world = {
  hasScan: (id: string) => id === SCAN_ID || id === RUNNING_ID,
  palette: async (id: string) => (id === SCAN_ID ? PALETTE.map((b) => ({ ...b })) : null),
} as unknown as WorldService;

let packLoads = 0;
let served: { url: string; close(): Promise<void> };
let noExport: { url: string; close(): Promise<void> };

function appWith(pack: () => Promise<Pack>): AppContext {
  return { config: { ...DEFAULT_CONFIG }, services: { world }, pack } as unknown as AppContext;
}

beforeAll(async () => {
  const pack = blockPack();
  served = await serveRoutes(worldRoutes(appWith(async () => {
    packLoads++;
    return pack;
  })));
  noExport = await serveRoutes(worldRoutes(appWith(() => Promise.reject(new HttpError(503, 'no-export', 'No recipe export yet — run npm run export')))));
});
afterAll(async () => {
  await Promise.all([served.close(), noExport.close()]);
});

const palettePath = (query = '', id = SCAN_ID): string => `/api/world/scans/${id}/palette${query}`;

it('names every palette entry in palette order, a GT machine by its machine', async () => {
  const res = await fetch(`${served.url}${palettePath('?names=1')}`);
  expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual([200, 'application/json; charset=utf-8', 'no-store']);
  const named = await res.json() as PaletteName[];
  expect(named).toEqual(ENTRIES.map(([block, name]) => ({ block, name })));
  expect(named.map((n) => n.block)).toEqual(PALETTE);   // the plain palette's order and entries, mteId and all
});

it('answers the plain palette without names=1, exactly as before', async () => {
  for (const query of ['', '?names=0', '?names=true', '?names=', '?y=1']) {
    const res = await fetch(`${served.url}${palettePath(query)}`);
    expect([query, res.status, res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual([query, 200, 'application/json; charset=utf-8', 'no-store']);
    expect(await res.json()).toEqual(PALETTE);
  }
});

it('loads the pack only for names, and answers 503 for names without a recipe export', async () => {
  const before = packLoads;
  await (await fetch(`${served.url}${palettePath()}`)).arrayBuffer();
  expect(packLoads).toBe(before);
  const res = await fetch(`${noExport.url}${palettePath('?names=1')}`);
  expect([res.status, await res.json()]).toEqual([503, { error: 'no-export', message: 'No recipe export yet — run npm run export' }]);
  const plain = await fetch(`${noExport.url}${palettePath()}`);
  expect([plain.status, await plain.json()]).toEqual([200, PALETTE]);
});

it('answers 409 for a scan that is not finished and 404 for an unknown scan, names or not', async () => {
  for (const query of ['', '?names=1']) {
    const running = await fetch(`${served.url}${palettePath(query, RUNNING_ID)}`);
    expect([running.status, await running.json()]).toEqual([409, { error: 'not-finished', message: 'Scan is not finished' }]);
    expect((await fetch(`${served.url}${palettePath(query, '20991231T000000Z-abcdef')}`)).status).toBe(404);
  }
});
