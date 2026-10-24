import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, gzipSync } from 'node:zlib';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanRegionBuffer } from '../../src/server/world/tile-entities.ts';
import { SmartUploadPanel } from '../../src/client/views/SmartUploadPanel.tsx';
import { browserInflate } from '../../src/client/world/inflate.ts';
import { uploadRel, type WorldPick } from '../../src/client/world/pick-files.ts';
import {
  findHotspots, formatSize, planSmartUpload, selectChunks, SMART_RADIUS, type Hotspot, type ReadFile, type SmartPlan,
} from '../../src/client/world/smart.ts';
import type { UploadItem } from '../../src/client/world/upload.ts';
import { chunkIndex, REGION_HEADER_BYTES, regionChunkRefs, trimRegion } from '../../src/shared/world/region.ts';
import { claimedChunks, playerPosition } from '../../src/shared/world/side-files.ts';
import { makeWorld, type WorldSpec } from '../helpers/make-world.ts';
import { pickDir } from '../helpers/pick-dir.ts';

// SMART: spawn (-100, 64, 40) → chunk (-7, 2); player p1 in DIM -1 at (-40.5, 70, 300.2) → chunk (-3, 18); team Alpha
// claims DIM 0 chunk (30, -2); DIM 0 chunks (0,0) InhabitedTime 500,000, (5,5) 10, (-7,2) 0, (30,-2) 0, (40,40) 0;
// DIM -1 chunk (-3,18) 0; DIM 7 chunk (0,0) 0.
const SMART: WorldSpec = {
  spawn: [-100, 64, 40],
  dims: {
    0: [{ cx: 0, cz: 0, inhabitedTime: 500_000 }, { cx: 5, cz: 5, inhabitedTime: 10 }, { cx: -7, cz: 2 }, { cx: 30, cz: -2 }, { cx: 40, cz: 40 }],
    [-1]: [{ cx: -3, cz: 18 }],
    7: [{ cx: 0, cz: 0 }],
  },
  players: [{ file: 'p1', dim: -1, pos: [-40.5, 70, 300.2] }],
  claims: { Alpha: { 0: [[30, -2]] } },
};

// BARE: level.dat (spawn 0, 64, 0) and one region: chunk (0,0) InhabitedTime 100,000, chunk (1,0) corrupt; no playerdata, no claims
const BARE: WorldSpec = { spawn: [0, 64, 0], dims: { 0: [{ cx: 0, cz: 0, inhabitedTime: 100_000 }, { cx: 1, cz: 0, corrupt: true }] } };

const AREAS = [
  { dim: 0, x: -8, z: 48, why: 'spawn, inhabited', chunks: 3 }, { dim: -1, x: -40, z: 296, why: 'player', chunks: 1 },
  { dim: 0, x: 488, z: -24, why: 'claim', chunks: 1 },
];

function item(rel: string, size: number): UploadItem {
  return { rel, size, blob: async () => new Blob([new Uint8Array(size)]) };
}

const PLAN: SmartPlan = {
  items: [item('level.dat', 300), item('DIM-1/region/r.-1.0.mca', 3000), item('region/r.-1.0.mca', 3000), item('region/r.0.-1.mca', 3000),
    item('region/r.0.0.mca', 2988)],
  areas: AREAS, bytes: 12_288, chunks: 5,
};

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

let tmp = '', tmp2 = '', tmp3 = '';
let pick: WorldPick, read: ReadFile, hs: Hotspot[];
const progress: Array<[number, number]> = [];

beforeAll(async () => {
  [tmp, tmp2, tmp3] = await Promise.all(['gp-smart-', 'gp-smart-bare-', 'gp-smart-junk-'].map((p) => mkdtemp(join(tmpdir(), p))));
  ({ pick, read } = await pickDir((await makeWorld(tmp, SMART)).worldDir));
  hs = await findHotspots(pick, read, browserInflate, (done, total) => progress.push([done, total]));
});

afterAll(async () => {
  await Promise.all([tmp, tmp2, tmp3].filter((d) => d !== '').map((d) => rm(d, { recursive: true, force: true })));
});

describe('findHotspots', () => {
  it('finds players, spawn, claims and inhabited chunks', () => expect(hs).toEqual([
    { dim: -1, cx: -3, cz: 18, why: 'player' }, { dim: 0, cx: -7, cz: 2, why: 'spawn' },
    { dim: 0, cx: 0, cz: 0, why: 'inhabited' }, { dim: 0, cx: 30, cz: -2, why: 'claim' }]));

  it('reports progress after each region file', () => {
    expect(progress).toEqual([[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6]]);
  });

  it('works without player or claim files and skips a corrupt chunk', async () => {
    const bare = await pickDir((await makeWorld(tmp2, BARE)).worldDir), bhs = await findHotspots(bare.pick, bare.read, browserInflate);
    expect(bhs).toEqual([{ dim: 0, cx: 0, cz: 0, why: 'spawn' }, { dim: 0, cx: 0, cz: 0, why: 'inhabited' }]);
    expect((await planSmartUpload(bare.pick, bhs, 8, bare.read)).chunks).toBe(1);
  });

  it('skips side files it cannot read and lists a chunk once per reason', async () => {
    const { worldDir } = await makeWorld(tmp3, {
      spawn: [3, 64, 3], dims: { 0: [{ cx: 0, cz: 0 }] },
      players: [{ file: 'a', dim: 0, pos: [8.5, 64, 8.5] }, { file: 'b', dim: 0, pos: [1, 64, 1] }],
    });
    await writeFile(join(worldDir, 'playerdata', 'junk.dat'), 'not nbt');
    await mkdir(join(worldDir, 'serverutilities', 'teams', 'claimedchunks'), { recursive: true });
    await writeFile(join(worldDir, 'serverutilities', 'teams', 'claimedchunks', 'Beta.dat'), gzipSync(new Uint8Array([10, 0])));   // truncated NBT
    await writeFile(join(worldDir, 'region', 'r.5.5.mca'), new Uint8Array(100));   // a torn region file: no chunk in it
    const j = await pickDir(worldDir);
    expect(j.pick.local.map((f) => f.rel).sort()).toEqual(['playerdata/a.dat', 'playerdata/b.dat', 'playerdata/junk.dat', 'serverutilities/teams/claimedchunks/Beta.dat']);
    expect(await findHotspots(j.pick, j.read, browserInflate)).toEqual([{ dim: 0, cx: 0, cz: 0, why: 'player' }, { dim: 0, cx: 0, cz: 0, why: 'spawn' }]);
  });
});

describe('selectChunks', () => {
  it('selects the square around each hotspot across region borders', () => {
    const sel = selectChunks([{ dim: 0, cx: 0, cz: 0, why: 'spawn' }], 1);
    expect([...sel.keys()].sort()).toEqual(['region/r.-1.-1.mca', 'region/r.-1.0.mca', 'region/r.0.-1.mca', 'region/r.0.0.mca']);
    expect([sel.get('region/r.0.0.mca'), sel.get('region/r.-1.-1.mca')]).toEqual([[0, 1, 32, 33], [1023]]);
  });

  it('orders regions by dim, rx, rz and collects the chunks of a region from every hotspot', () => {
    const sel = selectChunks([{ dim: 0, cx: 33, cz: 0, why: 'claim' }, { dim: -1, cx: 0, cz: 0, why: 'player' }, { dim: 0, cx: 32, cz: 1, why: 'claim' }], 0);
    expect([...sel]).toEqual([['DIM-1/region/r.0.0.mca', [0]], ['region/r.1.0.mca', [1, 32]]]);
    expect(() => selectChunks([], -1)).toThrow(RangeError);
  });
});

describe('planSmartUpload', () => {
  it('trims a region to the chosen chunks', async () => {
    const trimmed = trimRegion((await read('region/r.0.0.mca'))!, [chunkIndex(0, 0)]);   // the file holds (0,0) and (5,5)
    expect(regionChunkRefs(trimmed.subarray(0, REGION_HEADER_BYTES)).map((r) => r.index)).toEqual([0]);
    const out = scanRegionBuffer(trimmed, 0);
    expect([out.chunks.map((c) => [c.stat.cx, c.stat.cz]), out.skipped]).toEqual([[[0, 0]], 0]);
  });

  it('never sends player files', async () => {
    const plan = await planSmartUpload(pick, hs, SMART_RADIUS.default, read);
    expect(plan.items.map((i) => i.rel)).toEqual(['level.dat', 'DIM-1/region/r.-1.0.mca', 'region/r.-1.0.mca', 'region/r.0.-1.mca', 'region/r.0.0.mca']);
    for (const item of plan.items) { expect(uploadRel(item.rel)).toBe(item.rel); expect(item.rel.startsWith('playerdata/')).toBe(false); }
    expect(pick.local.map((f) => f.rel).sort()).toEqual(['playerdata/p1.dat', 'serverutilities/teams/claimedchunks/Alpha.dat']);   // read here, never sent
  });

  it('sends level.dat as picked and each trimmed region at its size', async () => {
    const plan = await planSmartUpload(pick, hs, SMART_RADIUS.default, read);
    const [level, ...regions] = plan.items;
    expect(level!.size).toBe(pick.files.find((f) => f.rel === 'level.dat')!.size);
    expect(await bytesOf(await level!.blob())).toEqual(await read('level.dat'));
    for (const r of regions) {
      const sent = await bytesOf(await r.blob());
      expect(sent.length).toBe(r.size);
      expect(sent).toEqual(trimRegion((await read(r.rel))!, selectChunks(hs, SMART_RADIUS.default).get(r.rel)!));
    }
    expect(plan.bytes).toBe(plan.items.reduce((n, i) => n + i.size, 0));
  });

  it('radius 2 sends fewer chunks and bytes than radius 8', async () => {
    const [r2, r8] = [await planSmartUpload(pick, hs, 2, read), await planSmartUpload(pick, hs, 8, read)];
    expect([r2.chunks, r8.chunks]).toEqual([4, 5]);   // (5,5) only at radius 8
    expect(r2.bytes).toBeLessThan(r8.bytes);
  });

  it('groups the selection into areas with their reasons', async () =>
    expect((await planSmartUpload(pick, hs, 8, read)).areas).toEqual(AREAS));

  it('splits areas whose squares do not touch and joins those that do', async () => {
    // radius 2: the spawn square (-9..-5) and the inhabited square (-2..2) leave a gap of two chunks
    expect((await planSmartUpload(pick, hs, 2, read)).areas.map((a) => a.why)).toEqual(['player', 'spawn', 'inhabited', 'claim']);
    // radius 3: -10..-4 and -3..3 are 8-neighbours, one area
    expect((await planSmartUpload(pick, hs, 3, read)).areas.map((a) => a.why)).toEqual(['spawn, inhabited', 'player', 'claim']);
  });

  it('sends nothing but level.dat when no hotspot lies in a picked region', async () => {
    const plan = await planSmartUpload(pick, [{ dim: 3, cx: 0, cz: 0, why: 'player' }], 8, read);
    expect([plan.items.map((i) => i.rel), plan.areas, plan.chunks]).toEqual([['level.dat'], [], 0]);
  });
});

describe('side files', () => {
  it('reads a player position and claimed chunks', () => {
    expect(playerPosition({ Dimension: -1, Pos: [-40.5, 70, 300.2] })).toEqual({ dim: -1, x: -40.5, y: 70, z: 300.2 });
    expect([playerPosition({ Pos: [1, 2, 3] }), playerPosition({ Dimension: 0 }), playerPosition({ Dimension: 0, Pos: [1, 2] }),
      playerPosition({ Dimension: 0, Pos: [Number.NaN, 2, 3] })]).toEqual([null, null, null, null]);
    expect(claimedChunks({ ClaimedChunks: { '0': [{ x: 1, z: -2 }], '-1': [{ x: -5, z: 6 }, { z: 1 }], junk: [{ x: 9, z: 9 }] } }))
      .toEqual([{ dim: 0, cx: 1, cz: -2 }, { dim: -1, cx: -5, cz: 6 }]);
    expect(claimedChunks({})).toEqual([]);
  });
});

describe('browserInflate', () => {
  it('inflates zlib and gzip like node:zlib', async () => {
    const raw = new TextEncoder().encode('chunk'.repeat(100));
    expect([await browserInflate(deflateSync(raw), 'zlib'), await browserInflate(gzipSync(raw), 'gzip')]).toEqual([raw, raw]);
  });

  it('rejects data it cannot inflate', async () => {
    await expect(browserInflate(new Uint8Array([1, 2, 3, 4]), 'zlib')).rejects.toThrow();
    await expect(browserInflate(new Uint8Array([0x1f, 0x8b, 8, 0]), 'gzip')).rejects.toThrow();
  });
});

describe('SmartUploadPanel', () => {
  it('shows areas, the radius and the total before upload', () => {
    const html = renderToStaticMarkup(<SmartUploadPanel reading={null} plan={PLAN} radius={8} busy={false} onRadius={() => {}} onUpload={() => {}} />);
    for (const t of ['Smart upload (recommended)', 'type="range"', 'min="2"', 'max="32"', 'value="8"', '8 chunks (128 blocks) around each spot',
      'data-testid="smart-area"', 'Overworld around -8, 48 — spawn, inhabited — 3 chunks', 'data-testid="smart-total"', '5 chunks, 12 KB',
      'player files stay on your computer', 'data-testid="upload-button"']) expect(html).toContain(t);
    expect([formatSize(1), formatSize(5 * 1_048_576 + 1)]).toEqual(['1 KB', '5.0 MB']);
  });

  it('lists every area, one chunk in the singular, and enables the upload', () => {
    const html = renderToStaticMarkup(<SmartUploadPanel reading={null} plan={PLAN} radius={8} busy={false} onRadius={() => {}} onUpload={() => {}} />);
    expect(html.match(/data-testid="smart-area"/g)).toHaveLength(3);
    expect(html).toContain('Nether around -40, 296 — player — 1 chunk<');
    expect(html).toMatch(/<input type="range" min="2" max="32" step="1"[^>]*aria-label="Radius in chunks"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="upload-button"/);
  });

  it('says how far it has read and cannot upload while reading, while busy or without a region', () => {
    const reading = renderToStaticMarkup(<SmartUploadPanel reading={{ done: 3, total: 10 }} plan={null} radius={8} busy={false} onRadius={() => {}} onUpload={() => {}} />);
    expect(reading).toContain('Reading your world… 3 / 10 region files');
    const levelOnly = { ...PLAN, items: [item('level.dat', 300)], areas: [], bytes: 300, chunks: 0 };
    for (const html of [reading,
      renderToStaticMarkup(<SmartUploadPanel reading={null} plan={PLAN} radius={8} busy onRadius={() => {}} onUpload={() => {}} />),
      renderToStaticMarkup(<SmartUploadPanel reading={null} plan={levelOnly} radius={8} busy={false} onRadius={() => {}} onUpload={() => {}} />)])
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="upload-button"/);
  });
});

// The Machine GUI restyle (restyle plan Phase 1 Task 9): the panel's inline styles are classes of the stylesheet now.
describe('the Machine GUI smart upload panel', () => {
  it('draws the panel, its areas, its radius and its total with the stylesheet, and no inline style', () => {
    const html = renderToStaticMarkup(<SmartUploadPanel reading={null} plan={PLAN} radius={8} busy={false} onRadius={() => {}} onUpload={() => {}} />);
    expect(html).not.toContain('style=');
    for (const markup of [
      '<div class="smart-upload"><h3>Smart upload (recommended)</h3><p class="muted">', '<ul class="smart-areas"><li data-testid="smart-area">',
      '<div class="row smart-radius"><input type="range" min="2" max="32" step="1" aria-label="Radius in chunks" value="8"/>',
      '<p data-testid="smart-total" class="smart-total">To send: 5 chunks, 12 KB</p>',
    ]) expect(html, markup).toContain(markup);
    // nothing is added after an area's text, and the status lines are the same muted lines
    expect(html).toContain('Nether around -40, 296 — player — 1 chunk</li>');
    const reading = renderToStaticMarkup(<SmartUploadPanel reading={{ done: 3, total: 10 }} plan={null} radius={8} busy={false} onRadius={() => {}} onUpload={() => {}} />);
    expect(reading).toContain('<p class="muted" role="status">Reading your world… 3 / 10 region files</p>');
    expect(reading).not.toContain('style=');
  });
});
