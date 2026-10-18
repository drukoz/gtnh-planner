import { describe, expect, it } from 'vitest';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { dimKey, siphonPlanet } from '../../../src/server/pack/worldgen.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { sampleExportSpec } from '../../helpers/sample-export.ts';

const dim = (pack: Pack, key: string) => pack.worldgen.dimensions.find((d) => d.key === key);

it.each([
  ['Overworld', 'overworld'], ['The End', 'theend'], ['EndAsteroid', 'endasteroid'],
  ['Twilight Forest', 'twilightforest'], ['dimensionDarkWorld', 'dimensiondarkworld'], ['Underdark', 'underdark'],
])('dimKey(%s) = %s', (name, key) => expect(dimKey(name)).toBe(key));

describe('dimensions', () => {
  it('builds keys, ids, kinds, rocket tiers and default tiers', async () => {
    const pack = await makePack(sampleExportSpec());
    expect(dim(pack, 'overworld')).toMatchObject({ id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 });
    expect(dim(pack, 'nether')).toMatchObject({ id: -1, defaultTier: 0 });
    expect(dim(pack, 'theend')).toMatchObject({ id: 1, kind: 'dimension', defaultTier: 3 });
    expect(dim(pack, 'endasteroid')).toMatchObject({ id: 1, kind: 'region', name: 'Far End Asteroids', defaultTier: 3 });
    expect(dim(pack, 'moon')).toMatchObject({ id: 28, kind: 'moon', rocketTier: 1, defaultTier: 3, mod: 'GalacticraftCore' });
    expect(dim(pack, 'underdark')).toMatchObject({ id: 100, name: 'Deep Dark', defaultTier: 11 });
    expect(dim(pack, 'spiritworld')).toMatchObject({ id: 55, defaultTier: 14 });
    expect(dim(pack, 'station:overworld')).toMatchObject({ id: null, kind: 'station', rocketTier: 1, defaultTier: 3 });
    expect(dim(pack, 'station:jupiter')).toMatchObject({ kind: 'station', rocketTier: 3, defaultTier: 5 });
    expect(pack.warnings!.filter((w) => w.includes('tier table'))).toEqual([]);
  });

  it('flags an ore dimension the tier table does not know', async () => {
    const pack = await makePack({
      dimensions: [
        { id: 99, name: 'newplanet', display: 'New Planet', ore: { type: 'Planet', voidMinable: true }, body: 'newplanet' },
        { id: 98, name: 'Strange', ore: { type: 'Planet', voidMinable: false } },
      ],
      celestial: [{ name: 'newplanet', kind: 'planet', parent: 'sol', tier: 5, dim: 99, reachable: true }],
    });
    expect(dim(pack, 'newplanet')).toMatchObject({ rocketTier: 5, defaultTier: 14 });
    expect(dim(pack, 'strange')).toMatchObject({ defaultTier: 14 });
    expect(pack.warnings!.filter((w) => w.includes('tier table'))).toHaveLength(2);
  });

  it('keeps the first line of a duplicate key and reads only the tier table\'s own keys', async () => {
    const pack = await makePack({
      dimensions: [
        { id: 0, name: 'Overworld', display: 'Overworld' },
        { id: 0, name: 'Over World', display: 'Copy', ore: { type: 'Planet', voidMinable: true } },
        { id: 5, name: 'constructor', ore: { type: 'Planet', voidMinable: true } },
      ],
    });
    expect(pack.worldgen.dimensions.map((d) => [d.key, d.name, d.defaultTier])).toEqual([['overworld', 'Overworld', 0], ['constructor', 'constructor', 14]]);
    expect(pack.warnings).toEqual([
      'dimension Over World: duplicate dimension key overworld ignored, the first one wins',
      'dimension constructor (constructor) is not in the tier table; assuming MAX (14)',
    ]);
  });
});

describe('veins, fluid sources, capabilities and byproducts', () => {
  it('builds veins and small ores with dimension keys and material names', async () => {
    const { worldgen } = await makePack(sampleExportSpec());
    expect(worldgen.veins.find((v) => v.name === 'ore.mix.iron')).toEqual({
      name: 'ore.mix.iron', dims: ['overworld', 'moon'], kind: 'vein', weight: 80, minY: 10, maxY: 60, size: 24, density: 3,
      materials: { primary: 'Iron', secondary: 'Iron', between: 'Nickel', sporadic: 'Nickel' },
    });
    expect(worldgen.veins.find((v) => v.name === 'ore.small.nickel')).toMatchObject({
      dims: ['nether'], kind: 'small', weight: 16, minY: 5, maxY: 120, size: 0, density: 0, materials: { primary: 'Nickel' },
    });
    expect(worldgen.veins.find((v) => v.name === 'ore.mix.prasiolite')!.dims).toEqual(['endasteroid']);
  });

  it('builds fluid sources', async () => {
    const { worldgen } = await makePack(sampleExportSpec());
    const src = (fluid: string, kind: string) => worldgen.fluidSources.find((s) => s.fluid === fluid && s.kind === kind);
    expect(src('fluid:oil', 'underground')).toEqual({ fluid: 'fluid:oil', kind: 'underground', dims: ['overworld'], minTier: 2 });
    expect(src('fluid:helium-3', 'underground')!.dims).toEqual(['moon']);
    expect(src('fluid:netherair', 'air_intake')).toEqual({ fluid: 'fluid:netherair', kind: 'air_intake', dims: ['nether'], minTier: 0 });
    expect(src('fluid:air', 'air_intake')!.dims).toEqual(expect.arrayContaining(['overworld', 'theend', 'endasteroid', 'moon', 'underdark']));
    expect(src('fluid:hydrogen', 'gas_siphon')).toEqual({ fluid: 'fluid:hydrogen', kind: 'gas_siphon', dims: ['station:jupiter'], minTier: 5 });
    expect(src('fluid:chlorobenzene', 'space_pump')).toEqual({ fluid: 'fluid:chlorobenzene', kind: 'space_pump', dims: [], minTier: 9 });
  });

  it('builds capabilities and byproducts', async () => {
    const { worldgen } = await makePack(sampleExportSpec());
    const cap = (key: string) => worldgen.capabilities.find((c) => c.key === key);
    expect(cap('void_miner:moon')).toEqual({ key: 'void_miner:moon', name: 'Void miner on Moon', minTier: 6, dim: 'moon', yields: ['Iron'] });
    expect(cap('deep_dark_void_miner')).toMatchObject({ minTier: 11, dim: 'underdark', yields: ['Iron'] });
    expect(cap('space_elevator_mining')).toMatchObject({ minTier: 8, yields: ['Iron', 'Nickel'] });
    expect(cap('space_elevator_mining_mk2')!.minTier).toBe(9);
    expect(cap('space_elevator_mining_mk3')!.minTier).toBe(10);
    expect(cap('low_gravity')).toEqual({ key: 'low_gravity', name: 'Low-gravity processing (space station)', minTier: 3, dim: 'station:overworld', yields: [] });
    expect(worldgen.byproducts).toMatchObject({ Iron: ['Nickel', 'Tin'], Nickel: ['Iron'], Prasiolite: [] });
  });

  it('puts gas-siphon fluids on the station of the planet, whether the line names it as GT does or plainly', async () => {
    expect(['planet.jupiter', 'jupiter', 'planet.saturn'].map(siphonPlanet)).toEqual(['jupiter', 'jupiter', 'saturn']);
    const spec = sampleExportSpec();
    spec.gasSiphon = [
      { planet: 'planet.jupiter', tier: 3, depths: [[1, 'hydrogen', 15000], [2, 'helium', 500]] },
      { planet: 'jupiter', tier: 3, depths: [[3, 'nitrogen', 300]] },
      { planet: 'planet.saturn', tier: 5, depths: [[1, 'deuterium', 5000]] },
    ];
    const pack = await makePack(spec);
    const siphon = pack.worldgen.fluidSources.filter((s) => s.kind === 'gas_siphon').map((s) => [s.fluid, s.dims, s.minTier]);
    expect(siphon).toEqual([
      ['fluid:hydrogen', ['station:jupiter'], 5], ['fluid:helium', ['station:jupiter'], 5], ['fluid:nitrogen', ['station:jupiter'], 5],
      ['fluid:deuterium', ['station:saturn'], 6],
    ]);
    expect(pack.warnings).toEqual(['gas siphon planet.saturn: no space station station:saturn among the dimensions']);
  });

  it('skips unknown underground dimension ids and items without a material, and rejects an unknown item index', async () => {
    const spec = sampleExportSpec();
    spec.undergroundFluids!.push({ key: 'Gone', dims: [42], fluids: [{ fluid: 'mystery', chance: 1, min: 1, max: 1, decrease: 1 }] });
    spec.voidMiner![0]!.extra.push({ item: 5, weight: 1 });   // the programmed circuit has no material
    const pack = await makePack(spec);
    expect(pack.worldgen.fluidSources.some((s) => s.fluid === 'fluid:mystery')).toBe(false);
    expect(pack.worldgen.capabilities.find((c) => c.key === 'void_miner:moon')!.yields).toEqual(['Iron']);
    expect(pack.warnings).toEqual([
      'underground fluids Gone: unknown dimension id(s) 42 skipped',
      'void miner moon: 1 item(s) without a material skipped',
    ]);
    spec.voidMiner![0]!.extra.push({ item: 99, weight: 1 });
    await expect(makePack(spec)).rejects.toMatchObject({ name: 'ExportFormatError', file: 'void-miner.jsonl.gz', line: 1 });
  });
});
