import { describe, expect, it } from 'vitest';
import { dimLabel, pickWorldFiles, selectDims, uploadRel } from '../../src/client/world/pick-files.ts';
import { openZipInBrowser } from '../../src/client/world/zip-pick.ts';
import { zipBuffer } from '../helpers/zip-write.ts';

const LEVEL = new Uint8Array([10, 0, 0, 1, 2, 3, 0]);
const REG = Uint8Array.from({ length: 8192 + 100 }, (_, i) => (i * 7) & 0xff);

describe('pickWorldFiles', () => {
  it('finds the world root and keeps only the files a scan needs', () => {
    const pick = pickWorldFiles([
      { path: 'MyWorld/level.dat', size: 300 }, { path: 'MyWorld/region/r.0.0.mca', size: 4096 }, { path: 'MyWorld/region/r.-1.0.mca', size: 8192 },
      { path: 'MyWorld/DIM-1/region/r.-1.0.mca', size: 1000 }, { path: 'MyWorld/session.lock', size: 8 }, { path: 'MyWorld/playerdata/a.dat', size: 9 },
      { path: 'MyWorld/DIM7/data/x.dat', size: 1 }, { path: 'MyWorld/Region/r.0.0.mca', size: 1 } ]);
    expect(pick.root).toBe('MyWorld/');
    expect(pick.files.map((f) => f.rel)).toEqual(['level.dat', 'region/r.0.0.mca', 'region/r.-1.0.mca', 'DIM-1/region/r.-1.0.mca']);
    expect(pick.local.map((f) => f.rel)).toEqual(['playerdata/a.dat']);   // read in the browser only
    expect(pick.dims).toEqual([{ dim: -1, files: 1, bytes: 1000 }, { dim: 0, files: 2, bytes: 12288 }]);
    expect(selectDims(pick, [-1]).map((f) => f.rel)).toEqual(['level.dat', 'DIM-1/region/r.-1.0.mca']);
  });

  it('picks the shallowest level.dat and returns nothing without one', () => {
    expect(pickWorldFiles([{ path: 'saves/World/level.dat', size: 1 }, { path: 'saves/World/backup/level.dat', size: 1 }]).root).toBe('saves/World/');
    expect(pickWorldFiles([{ path: 'x/region/r.0.0.mca', size: 1 }])).toEqual({ root: null, files: [], local: [], dims: [] });
  });

  it('takes a level.dat at the top as the root and breaks ties by name', () => {
    expect(pickWorldFiles([{ path: 'region/r.0.0.mca', size: 5 }, { path: 'level.dat', size: 1 }]))
      .toEqual({ root: '', files: [{ path: 'region/r.0.0.mca', rel: 'region/r.0.0.mca', dim: 0, size: 5 }, { path: 'level.dat', rel: 'level.dat', dim: null, size: 1 }], local: [], dims: [{ dim: 0, files: 1, bytes: 5 }] });
    expect(pickWorldFiles([{ path: 'B/level.dat', size: 1 }, { path: 'A/level.dat', size: 1 }]).root).toBe('A/');
  });

  it('keeps the files of the root only, each once', () => {
    const pick = pickWorldFiles([
      { path: 'World/level.dat', size: 3 }, { path: 'Other/region/r.0.0.mca', size: 7 }, { path: 'World/region/r.1.1.mca', size: 7 },
      { path: 'World/region/r.1.1.mca', size: 7 }, { path: 'World/serverutilities/teams/claimedchunks/Alpha.dat', size: 2 },
      { path: 'World/serverutilities/teams/Alpha.dat', size: 2 }, { path: 'World/playerdata/sub/b.dat', size: 2 }, { path: 'World/playerdata/b.dat_old', size: 2 },
    ]);
    expect(pick.files.map((f) => f.path)).toEqual(['World/level.dat', 'World/region/r.1.1.mca']);
    expect(pick.local).toEqual([{ path: 'World/serverutilities/teams/claimedchunks/Alpha.dat', rel: 'serverutilities/teams/claimedchunks/Alpha.dat', size: 2 }]);
    expect(pick.dims).toEqual([{ dim: 0, files: 1, bytes: 7 }]);
  });

  it('selects level.dat first, then the region files of the chosen dimensions', () => {
    const pick = pickWorldFiles([
      { path: 'W/DIM7/region/r.0.0.mca', size: 1 }, { path: 'W/region/r.0.0.mca', size: 2 }, { path: 'W/level.dat', size: 3 }, { path: 'W/DIM-1/region/r.0.0.mca', size: 4 },
    ]);
    expect(pick.dims.map((d) => d.dim)).toEqual([-1, 0, 7]);
    expect(selectDims(pick, [7, 0]).map((f) => f.rel)).toEqual(['level.dat', 'DIM7/region/r.0.0.mca', 'region/r.0.0.mca']);
    expect(selectDims(pick, []).map((f) => f.rel)).toEqual(['level.dat']);
  });
});

describe('uploadRel', () => {
  it.each(['level.dat', 'region/r.0.0.mca', 'DIM-1/region/r.-1.2.mca'])('allows %s', (p) => expect(uploadRel(p)).toBe(p));
  it.each(['../level.dat', 'Region/r.0.0.mca', 'DIM-1/r.0.0.mca', 'region/r.0.0.mcr', 'playerdata/a.dat', 'world.zip', 'region/r.01.0.mca'])('refuses %s', (p) => expect(uploadRel(p)).toBeNull());
  it.each(['DIM0/region/r.0.0.mca', '/level.dat', 'region/../level.dat', 'serverutilities/teams/claimedchunks/Alpha.dat', 'DIM-01/region/r.0.0.mca'])(
    'refuses %s too (not the one spelling of an allowed file)', (p) => expect(uploadRel(p)).toBeNull());
});

describe('dimLabel', () => {
  it('names the three vanilla dimensions and the rest by folder', () =>
    expect([dimLabel(0), dimLabel(-1), dimLabel(1), dimLabel(7)]).toEqual(['Overworld', 'Nether', 'The End', 'DIM7']));
});

describe('openZipInBrowser', () => {
  it('lists a zipped world in the browser and extracts one entry', async () => {
    const zip = await openZipInBrowser(new Blob([zipBuffer([{ name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG }])]));
    expect(zip.entries.map((e) => e.path)).toEqual(['World/level.dat', 'World/region/r.0.0.mca']);
    expect(new Uint8Array(await (await zip.entries[0]!.read()).arrayBuffer())).toEqual(LEVEL);
    await zip.close();
  });

  it('gives the uncompressed sizes, skips folders and reads any entry', async () => {
    const zip = await openZipInBrowser(new Blob([zipBuffer([
      { name: 'World/', data: new Uint8Array(0) }, { name: 'World/region/', data: new Uint8Array(0) },
      { name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG },
    ])]));
    expect(zip.entries.map((e) => [e.path, e.size])).toEqual([['World/level.dat', LEVEL.length], ['World/region/r.0.0.mca', REG.length]]);
    expect(new Uint8Array(await (await zip.entries[1]!.read()).arrayBuffer())).toEqual(REG);
    expect(pickWorldFiles(zip.entries).files.map((f) => f.rel)).toEqual(['level.dat', 'region/r.0.0.mca']);
    await zip.close();
  });

  it('refuses a file that is not a zip', async () => {
    await expect(openZipInBrowser(new Blob([new Uint8Array(200).fill(7)]))).rejects.toThrow();
  });
});
