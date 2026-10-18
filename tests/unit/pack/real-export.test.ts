import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Pack, Recipe } from '../../../src/shared/types/pack.ts';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { canonicalRecipe, recipeId } from '../../../src/server/pack/recipe-id.ts';
import { searchPack } from '../../../src/server/pack/search.ts';
import { runCli } from '../../helpers/run-cli.ts';

describe.skipIf(process.env.GTNH_LOCAL !== '1')('real export (GTNH 2.9.0-RC-1)', () => {
  let pack: Pack;
  let loadMs = 0;
  beforeAll(async () => {
    const t0 = performance.now();
    pack = await loadPack(activeExportDir(loadConfig()));
    loadMs = performance.now() - t0;
    console.log(`loadPack ${Math.round(loadMs)} ms, rss ${Math.round(process.memoryUsage().rss / 2 ** 20)} MiB`);
  }, 180_000);

  it('is a complete export of the right pack, loaded in under a minute', () => {
    expect(pack.manifest).toMatchObject({ format: 'gtnh-planner-export/1', packVersion: '2.9.0-RC-1', gtVersion: '5.09.54.183', failedSections: [] });
    expect(pack.manifest.counts.recipeMaps).toBeGreaterThanOrEqual(140);
    expect(pack.recipes.filter((r) => r.source === 'gt').length).toBeGreaterThan(10_000);
    expect(pack.recipes.filter((r) => r.source === 'crafting').length).toBeGreaterThan(50_000);
    expect(pack.manifest.nameFailures!).toBeLessThan(pack.items.size / 100);
    expect(loadMs).toBeLessThan(60_000);
  });

  it('has English names and the common GT machines', () => {
    expect(pack.machines.get(1000)).toMatchObject({ name: 'Electric Blast Furnace', kind: 'multiblock', heatOC: true });
    expect(pack.machines.get(1169)).toMatchObject({ kind: 'multiblock', perfectOC: true });
    expect(pack.machines.get(1002)!.perfectOC ?? false).toBe(false);
    expect(pack.machines.get(140)!.kind).toBe('multiblock');                      // bricked blast furnace (IConstructable)
    expect(pack.machines.get(114)!.kind).toBe('boiler');
    expect(pack.machines.get(114)!.steamPerSecondMax).toBeGreaterThan(0);
    expect(pack.machines.get(1120)).toMatchObject({ kind: 'turbine', tier: 1 });
    expect(pack.machines.get(1120)!.turbineEfficiency).toBeCloseTo(3 / 7, 3);
    for (const id of [90, 303, 373, 423, 512, 1121, 1122, 1172, 31040]) expect(pack.machines.has(id), `mte ${id}`).toBe(true);
    expect(pack.fluids.get('fluid:molten.iron')!.name).toBe('Molten Iron');
    expect(searchPack(pack, 'Iron Dust')[0]!.name).toBe('Iron Dust');
    expect(pack.machinesByMap.get('gt.recipe.macerator')).toContain(303);
    expect([...pack.items.values()].some((i) => (i.electric?.maxCharge ?? 0) > 0)).toBe(true);   // IC2 battery data (§11.5)
  });

  it('keeps cleanroom, programmed circuits, maps and derived recipes right', () => {
    const gt = pack.recipes.filter((r) => r.source === 'gt');
    expect(gt.some((r) => r.meta.cleanroom === true)).toBe(true);
    expect(gt.some((r) => r.inputs.some((i) => !i.consumed && i.options[0]!.key.startsWith('gregtech:gt.integrated_circuit@')))).toBe(true);
    expect(pack.maps.get('gt.recipe.blastfurnace')!.specialValue).toBe('heat');
    expect(pack.maps.get('gt.recipe.furnace')!.dynamic).toBe('overwrite');
    const ironDust = searchPack(pack, 'Iron Dust')[0]!.key;
    const microwave = pack.recipes.filter((r) => r.source === 'derived' && r.maps.includes('gt.recipe.microwave'));
    expect(microwave.length).toBeGreaterThan(0);
    expect(microwave.some((r) => r.inputs[0]!.options.some((o) => o.key === ironDust))).toBe(false);   // would explode
    const sample = gt[Math.floor(gt.length / 2)]!;
    expect(recipeId({ ...sample, fake: sample.flags.fake })).toBe(sample.id);
  });

  it('has multiblock structures in the canonical frame', () => {
    const ebf = pack.machines.get(1000)!.structure!;
    expect(ebf.size).toEqual([3, 4, 3]);
    expect(ebf.blocks.length + ebf.air.length).toBe(36);
    const turbine = pack.machines.get(15524)!.structure!;   // 2.9 Large Steam Turbine: 3×3×6 plus a 3×3 air layer in front
    expect(turbine.air).toHaveLength(9);
    expect([...turbine.size].sort((a, b) => a - b)).toEqual([3, 3, 7]);
  });

  it('has the worldgen the availability model needs', () => {
    const { worldgen } = pack;
    expect(worldgen.veins.filter((v) => v.kind === 'vein')).toHaveLength(122);
    expect(worldgen.veins.filter((v) => v.kind === 'small')).toHaveLength(54);
    const dim = (k: string) => worldgen.dimensions.find((d) => d.key === k);
    expect(dim('moon')).toMatchObject({ rocketTier: 1, defaultTier: 3 });
    expect(dim('ross128b')).toMatchObject({ rocketTier: 3 });
    expect(dim('ross128ba')).toMatchObject({ rocketTier: 5 });
    expect(dim('endasteroid')).toMatchObject({ kind: 'region', id: 1 });
    expect(dim('underdark')).toBeDefined();
    expect(pack.warnings!.filter((w) => w.includes('tier table'))).toEqual([]);
    expect(worldgen.capabilities.find((c) => c.key === 'void_miner:moon')!.yields).toContain('Bauxite');
    expect(worldgen.fluidSources.some((s) => s.kind === 'underground' && s.dims.includes('moon'))).toBe(true);
    expect(worldgen.fluidSources.some((s) => s.kind === 'air_intake' && s.dims.includes('nether'))).toBe(true);   // Nether Air is a fluid, not a gas
    expect(worldgen.byproducts.Iron).toContain('Nickel');
  });

  it('gives the same recipe ids as the export made just before it (run npm run export twice in a row)', async () => {
    const active = activeExportDir(loadConfig());
    const root = dirname(active);
    const earlier = readdirSync(root)
      .filter((id) => id.startsWith(`${pack.manifest.packVersion}_`) && id < basename(active) && existsSync(join(root, id, 'EXPORT_OK')))
      .sort();
    expect(earlier.length, 'needs an earlier export of the same pack by the same exporter: run npm run export twice in a row').toBeGreaterThan(0);
    const previous = await loadPack(join(root, earlier.at(-1)!));
    const differing = (a: Pack, b: Pack): string[] => {
      const ids = new Set(b.recipes.map((r) => r.id));
      return a.recipes.filter((r) => !ids.has(r.id)).map((r: Recipe) => canonicalRecipe({ ...r, fake: r.flags.fake }));
    };
    const onlyNow = differing(pack, previous);
    const onlyBefore = differing(previous, pack);
    console.log(`re-export ${earlier.at(-1)} → ${basename(active)}: ${pack.recipes.length} / ${previous.recipes.length} recipes, `
      + `${onlyNow.length} ids only in the active export, ${onlyBefore.length} only in the earlier one`);
    expect({ onlyNow: onlyNow.slice(0, 5), onlyBefore: onlyBefore.slice(0, 5) }).toEqual({ onlyNow: [], onlyBefore: [] });
    expect(pack.recipes.length).toBe(previous.recipes.length);
  }, 180_000);

  it('answers pack:info --find', async () => {
    // 51 producers at 0 EU/t (crafting, Eye of Harmony) sort before the first Macerator recipe, past the default 20
    const r = await runCli('pack-info', ['--find', 'Iron Dust', '--limit', '100'], { cwd: process.cwd(), timeoutMs: 180_000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\d+ producing recipes:/);
    expect(r.stdout).toContain('Macerator');
  }, 200_000);
});
