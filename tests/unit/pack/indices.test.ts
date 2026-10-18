import { describe, expect, it } from 'vitest';
import type { Pack } from '../../../src/shared/types/pack.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

const derived = (pack: Pack, map: string) => pack.recipes.filter((r) => r.source === 'derived' && r.maps.includes(map));

describe('derived furnace recipes', () => {
  it('derives an electric furnace recipe for every entry with an ef output', async () => {
    const ef = derived(await makePack(sampleExportSpec()), 'gt.recipe.furnace');
    expect(ef).toHaveLength(3);
    for (const r of ef) expect(r).toMatchObject({ euPerTick: 4, durationTicks: 128, amps: 1, flags: { dynamicMap: 'overwrite' } });
  });

  it('derives microwave recipes only where the export recorded a safe output', async () => {
    const mw = derived(await makePack(sampleExportSpec()), 'gt.recipe.microwave');
    expect(mw).toHaveLength(1);
    expect(mw[0]).toMatchObject({ durationTicks: 32, inputs: [{ options: [{ key: SAMPLE.potato, amount: 1 }] }], outputs: [{ key: SAMPLE.bakedPotato }] });
  });

  it('derives nothing for a map the export does not have', async () => {
    const spec = sampleExportSpec();
    spec.recipeMaps = spec.recipeMaps!.filter((m) => m.id !== 'gt.recipe.microwave');
    spec.recipesGt = [];
    expect(derived(await makePack(spec), 'gt.recipe.microwave')).toHaveLength(0);
  });
});

describe('indices', () => {
  it('indexes producers and consumers, including not-consumed inputs', async () => {
    const pack = await makePack(sampleExportSpec());
    const producerMaps = pack.producers.get(SAMPLE.ironDust)!.map((i) => pack.recipes[i]!.maps[0]).sort();
    expect(producerMaps).toEqual(['crafting', 'gt.recipe.macerator', 'gt.recipe.macerator', 'gt.recipe.testalias', 'gt.recipe.thermalcentrifuge']);
    const circuitUsers = pack.consumers.get(SAMPLE.circuit)!.map((i) => pack.recipes[i]!.maps[0]);
    expect(circuitUsers).toEqual(['gt.recipe.blastfurnace']);
  });

  it('lists a recipe once per key even when the key fills several slots', async () => {
    const pack = await makePack(sampleExportSpec());
    const tableRecipe = pack.recipes.findIndex((r) => r.outputs[0]?.key === SAMPLE.craftingTable);
    expect(pack.consumers.get(SAMPLE.oakPlanks)!.filter((i) => i === tableRecipe)).toHaveLength(1);
  });
});
