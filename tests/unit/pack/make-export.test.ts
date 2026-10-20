import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPORT_FILES, EXPORT_FORMAT, MARKER_OK, type ExportFileKey, type FluidSlot, type ItemSlot } from '../../../src/server/pack/format.ts';
import { makeExport, readJsonlGz } from '../../helpers/make-export.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

const tmp = () => mkdtemp(join(tmpdir(), 'gp-export-'));
const FILE_KEYS = Object.keys(EXPORT_FILES).filter((k): k is ExportFileKey => k !== 'manifest');

describe('makeExport', () => {
  it('writes every file, a manifest whose counts match the lines, and EXPORT_OK', async () => {
    const dir = await makeExport(join(await tmp(), 'sample'), sampleExportSpec());
    const names = await readdir(dir);
    for (const f of Object.values(EXPORT_FILES)) expect(names).toContain(f);
    expect(names).toContain(MARKER_OK);
    const manifest = JSON.parse(await readFile(join(dir, EXPORT_FILES.manifest), 'utf8'));
    expect(manifest).toMatchObject({ format: EXPORT_FORMAT, exportId: 'sample', packVersion: '2.9.0-RC-1', nameFailures: 1 });
    expect(manifest.counts.items).toBe(25);
    expect(manifest.counts.recipesGt).toBe(10);
    expect(manifest.counts.items).toBe((await readJsonlGz(join(dir, EXPORT_FILES.items))).length);
  });

  it('numbers items and maps by position and counts GT recipes per map', async () => {
    const dir = await makeExport(join(await tmp(), 'x'), sampleExportSpec());
    const items = (await readJsonlGz(join(dir, EXPORT_FILES.items))) as Array<{ i: number; id: string; m: number }>;
    expect(items[1]).toMatchObject({ i: 1, id: 'gregtech:gt.metaitem.01', m: 2032 });
    const maps = (await readJsonlGz(join(dir, EXPORT_FILES.recipeMaps))) as Array<{ i: number; id: string; recipes: number }>;
    expect(maps[0]).toMatchObject({ i: 0, id: 'gt.recipe.macerator', recipes: 3 });
  });

  it('supports omitted files, other markers, filler maps, raw lines and count overrides', async () => {
    const dir = await makeExport(join(await tmp(), 'y'), {
      ...sampleExportSpec(), omitFiles: ['structures'], marker: 'EXPORT_FAILED', fillerMaps: 140,
      rawLines: { recipesGt: ['{not json'] }, countOverrides: { items: 99 },
    });
    const names = await readdir(dir);
    expect(names).not.toContain(EXPORT_FILES.structures);
    expect(names).toContain('EXPORT_FAILED');
    expect(names).not.toContain(MARKER_OK);
    expect(await readJsonlGz(join(dir, EXPORT_FILES.recipeMaps))).toHaveLength(151);
    expect((await readJsonlGz(join(dir, EXPORT_FILES.recipesGt), { raw: true })).at(-1)).toBe('{not json');
    const manifest = JSON.parse(await readFile(join(dir, EXPORT_FILES.manifest), 'utf8'));
    expect(manifest.counts.items).toBe(99);
    expect(manifest.counts.recipesGt).toBe(11);
  });

  it('writes empty files, the default manifest and no marker for a bare spec, and applies manifest overrides', async () => {
    const dir = await makeExport(join(await tmp(), 'bare'), { marker: null, manifest: { packVersion: '2.9.0' } });
    expect((await readdir(dir)).sort()).toEqual(Object.values(EXPORT_FILES).sort());
    for (const k of FILE_KEYS) expect(await readJsonlGz(join(dir, EXPORT_FILES[k]))).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, EXPORT_FILES.manifest), 'utf8'))).toEqual({
      format: EXPORT_FORMAT, exportId: 'bare', exporterVersion: '0.1.0', exportedAt: '2026-10-17T12:00:00Z',
      packVersion: '2.9.0', gtVersion: '5.09.54.183', mods: { minecraft: '1.7.10', gregtech: '5.09.54.183' },
      counts: Object.fromEntries(FILE_KEYS.map((k) => [k, 0])),
      nameFailures: 0, nameFailureSamples: [], sectionMillis: {}, failedSections: [], skippedSections: [], warnings: [],
    });
  });
});

describe('sampleExportSpec', () => {
  it('has the documented number of lines per file', () => {
    const s = sampleExportSpec();
    expect(Object.fromEntries(FILE_KEYS.map((k) => [k, s[k]?.length ?? 0]))).toEqual({
      items: 25, fluids: 11, fluidContainers: 1, oreDict: 9, recipeMaps: 11, recipesGt: 10, recipesAssemblyLine: 1,
      recipesCrafting: 4, recipesFurnace: 3, machines: 6, structures: 1, materials: 4, oreMaterials: 3, dimensions: 7,
      celestial: 5, oreVeins: 2, smallOres: 1, undergroundFluids: 2, voidMiner: 2, gasSiphon: 1, spacePump: 1, spaceAsteroids: 1,
      crops: 0,
    });
  });

  it('builds a fresh spec on every call', () => {
    const a = sampleExportSpec();
    a.recipesGt!.push(a.recipesGt![0]!);
    a.items![0]!.dn = 'changed';
    expect(sampleExportSpec().recipesGt).toHaveLength(10);
    expect(sampleExportSpec().items![0]!.dn).toBe('Iron Ingot');
  });

  it('resolves every SAMPLE constant and every item index, map index and fluid name it uses', () => {
    const s = sampleExportSpec();
    const items = s.items!;
    const fluids = s.fluids!.map((f) => f.id);
    const plainKeys = items.filter((it) => it.nbt === undefined && it.m !== 32767).map((it) => `${it.id}@${it.m}`);
    for (const v of Object.values(SAMPLE)) {
      if (typeof v === 'number') expect(s.machines!.map((m) => m.id)).toContain(v);
      else if (v.startsWith('fluid:')) expect(fluids).toContain(v.slice('fluid:'.length));
      else expect(plainKeys).toContain(v);
    }

    const itemsIn = (slots: readonly ItemSlot[]) => slots.flatMap((x) => (x === null ? [] : [x[0]]));
    const altItemsIn = (alts: Array<ItemSlot[] | null> = []) => alts.flatMap((x) => itemsIn(x ?? []));
    const fluidsIn = (slots: readonly FluidSlot[]) => slots.flatMap((x) => (x === null ? [] : [x[0]]));
    const itemRefs = [
      ...s.recipesGt!.flatMap((r) => [...itemsIn(r.in), ...itemsIn(r.out), ...altItemsIn(r.inAlt)]),
      ...s.recipesAssemblyLine!.flatMap((r) => [...(r.research === null ? [] : [r.research]), ...itemsIn(r.in), ...altItemsIn(r.inAlt), ...itemsIn([r.out])]),
      ...s.recipesCrafting!.flatMap((r) => [...(r.in ?? []).flatMap((c) => (typeof c === 'number' ? [c] : Array.isArray(c) ? c : [])), ...itemsIn([r.out])]),
      ...s.recipesFurnace!.flatMap((r) => [r.in, r.out[0], ...(r.ef ? [r.ef[0]] : []), ...(r.mw ? [r.mw[0]] : [])]),
      ...s.fluidContainers!.flatMap((c) => [c.container, ...(c.empty === null ? [] : [c.empty])]),
      ...s.oreDict!.flatMap((o) => o.items),
      ...s.machines!.flatMap((m) => (m.item === null ? [] : [m.item])),
      ...s.oreMaterials!.flatMap((o) => Object.values(o.parts).filter((i) => i !== undefined)),
      ...s.voidMiner!.flatMap((v) => [...v.drops, ...v.extra].map((d) => d.item)),
      ...s.spaceAsteroids!.flatMap((a) => a.outputs),
    ];
    for (const i of itemRefs) expect(items[i], `item index ${i}`).toBeDefined();
    for (const r of s.recipesGt!) expect(s.recipeMaps![r.map], `map index ${r.map}`).toBeDefined();
    const fluidRefs = [
      ...s.recipesGt!.flatMap((r) => [...fluidsIn(r.fin), ...fluidsIn(r.fout), ...(r.finAlt ?? []).flatMap((x) => fluidsIn(x ?? []))]),
      ...s.recipesAssemblyLine!.flatMap((r) => fluidsIn(r.fin)),
      ...s.fluidContainers!.map((c) => c.fluid),
      ...s.dimensions!.flatMap((d) => (d.airIntake ? [d.airIntake] : [])),
      ...s.undergroundFluids!.flatMap((u) => u.fluids.map((f) => f.fluid)),
      ...s.gasSiphon!.flatMap((g) => g.depths.map((d) => d[1])),
      ...s.spacePump!.map((p) => p.fluid),
    ];
    for (const f of fluidRefs) expect(fluids).toContain(f);
  });
});
