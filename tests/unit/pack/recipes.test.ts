import { describe, expect, it } from 'vitest';
import type { Pack, Recipe } from '../../../src/shared/types/pack.ts';
import { itemKey } from '../../../src/shared/keys.ts';
import { nbtHash, recipeId } from '../../../src/server/pack/recipe-id.ts';
import type { GtRecipeLine } from '../../../src/server/pack/format.ts';
import { RecipeCollector } from '../../../src/server/pack/recipes.ts';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

const inMap = (pack: Pack, map: string): Recipe[] => pack.recipes.filter((r) => r.maps.includes(map));

describe('GT recipes', () => {
  it('converts consumed and not-consumed inputs, fluids, chances and metadata', async () => {
    const [ebf] = inMap(await makePack(sampleExportSpec()), 'gt.recipe.blastfurnace');
    expect(ebf).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{16}$/), source: 'gt', maps: ['gt.recipe.blastfurnace'],
      inputs: [
        { slot: 0, consumed: true, chance: 1, options: [{ key: SAMPLE.ironDust, amount: 1 }] },
        { slot: 1, consumed: false, chance: 0, options: [{ key: SAMPLE.circuit, amount: 1 }] },
        { slot: 100, consumed: true, chance: 1, options: [{ key: SAMPLE.oxygen, amount: 1000 }] },
      ],
      outputs: [{ key: SAMPLE.steelIngot, amount: 1, chance: 1 }],
      euPerTick: 120, durationTicks: 1000, amps: 1, specialValue: 1000,
      meta: { coilHeat: 1000, circuit: 1 }, flags: {},
    });
  });

  it('turns 1/10000 chances into 0..1 on all four sides', async () => {
    const pack = await makePack({
      ...sampleExportSpec(),
      recipesGt: [{ map: 2, in: [[3, 1, 2500]], out: [[1, 1, 1000]], fin: [['oxygen', 100, 5000]], fout: [['water', 10, 7500]], eut: 8, dur: 40 }],
    });
    const [r] = inMap(pack, 'gt.recipe.centrifuge');
    expect(r!.inputs.map((i) => [i.consumed, i.chance])).toEqual([[true, 0.25], [true, 0.5]]);
    expect(r!.outputs.map((o) => o.chance)).toEqual([0.1, 0.75]);
  });

  it('merges the same recipe from two maps into one', async () => {
    const pack = await makePack(sampleExportSpec());
    const merged = pack.recipes.filter((r) => r.maps.includes('gt.recipe.centrifugeNonCell'));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.maps).toEqual(['gt.recipe.centrifuge', 'gt.recipe.centrifugeNonCell']);
    expect(pack.recipeById.get(merged[0]!.id)).toBe(merged[0]);
  });

  it('skips disabled recipes and keeps fake, hidden and recycling ones flagged', async () => {
    const spec = sampleExportSpec();
    spec.recipesGt!.push({ map: 2, in: [[0, 3]], out: [[1, 3]], fin: [], fout: [], eut: 4, dur: 10, hidden: true });
    const pack = await makePack(spec);
    expect(inMap(pack, 'gt.recipe.macerator').some((r) => r.inputs[0]!.options[0]!.key === SAMPLE.ironIngot)).toBe(false);
    expect(inMap(pack, 'gt.recipe.rockbreakerfakerecipes')[0]!.flags).toEqual({ fake: true });
    expect(inMap(pack, 'gt.recipe.centrifuge').find((r) => r.flags.hidden)).toBeDefined();
    const recycling = inMap(pack, 'gt.recipe.macerator').find((r) => r.category);
    expect(recycling).toMatchObject({ category: 'gt.recipe.category.macerator_recycling', flags: { recycling: true } });
  });

  it('uses the map amperage, the normalized map id and the map dynamic tag', async () => {
    const pack = await makePack({
      ...sampleExportSpec(),
      recipesGt: [...sampleExportSpec().recipesGt!, { map: 4, in: [[20, 1]], out: [[21, 1]], fin: [], fout: [], eut: 4, dur: 128 }],
    });
    expect(inMap(pack, 'gt.recipe.thermalcentrifuge')[0]!.amps).toBe(2);
    expect(inMap(pack, 'gt.recipe.testalias')).toHaveLength(1);
    expect(inMap(pack, 'gt.recipe.furnace').find((r) => r.source === 'gt')!.flags.dynamicMap).toBe('overwrite');
  });

  it('turns inAlt and finAlt into options', async () => {
    const pack = await makePack({
      ...sampleExportSpec(),
      recipesGt: [{ map: 6, in: [[4, 1]], inAlt: [[[4, 1], [0, 2]]], out: [[16, 1]], fin: [['molten.iron', 144]], finAlt: [[['molten.iron', 144], ['water', 1000]]], fout: [], eut: 30, dur: 200 }],
    });
    const [r] = inMap(pack, 'gt.recipe.circuitassembler');
    expect(r!.inputs[0]!.options).toEqual([{ key: SAMPLE.steelIngot, amount: 1 }, { key: SAMPLE.ironIngot, amount: 2 }]);
    expect(r!.inputs[1]!.options).toEqual([{ key: SAMPLE.moltenIron, amount: 144 }, { key: 'fluid:water', amount: 1000 }]);
  });

  it('lets a GT or assembly-line slot of GTNH\'s "Any <tier> Circuit" take every circuit of that stand-in\'s ore name', async () => {
    // NewHorizonsCoreMod's dreamcraft:Circuit<tier> items are what GT recipes list where they take any circuit of a tier
    // (GT matches its inputs by their ore-dictionary unification); nothing makes the stand-in itself. A crafting slot names
    // its ore name itself (or lists exactly what it takes), so it keeps its options.
    const spec = sampleExportSpec();
    const standIn = spec.items!.length;
    spec.items!.push(
      { id: 'dreamcraft:CircuitLV', m: 0, dn: 'Any LV Circuit', od: ['circuitBasic'], gtPrefix: 'circuit', gtMat: 'Basic', gtAmt: -1 },
      { id: 'examplemod:circuit', m: 0, dn: 'Example Circuit', od: ['circuitBasic'], gtPrefix: 'circuit', gtMat: 'Basic', gtAmt: -1 },
    );
    spec.oreDict!.push({ ore: 'circuitBasic', items: [standIn, standIn + 1] });
    spec.recipesGt = [{ map: 6, in: [[standIn, 2], [4, 1]], out: [[16, 1]], fin: [], fout: [], eut: 30, dur: 200 }];
    spec.recipesAssemblyLine = [{ research: 16, researchTime: 3600, researchVoltage: 30720, in: [[standIn, 4]], fin: [], out: [11, 1], eut: 7680, dur: 600 }];
    spec.recipesCrafting = [{ cls: 'net.minecraft.item.crafting.ShapelessRecipes', shape: 'shapeless', in: [standIn], out: [10, 1] }];
    const pack = await makePack(spec);
    const anyLv = 'dreamcraft:CircuitLV@0';
    const example = 'examplemod:circuit@0';
    const [gt] = inMap(pack, 'gt.recipe.circuitassembler');
    expect(gt!.inputs.map((ing) => ing.options)).toEqual([[{ key: anyLv, amount: 2 }, { key: example, amount: 2 }], [{ key: SAMPLE.steelIngot, amount: 1 }]]);
    const [line] = inMap(pack, 'assemblyline');
    expect(line!.inputs[0]!.options).toEqual([{ key: anyLv, amount: 4 }, { key: example, amount: 4 }]);
    const [craft] = inMap(pack, 'crafting');
    expect(craft!.inputs[0]!.options).toEqual([{ key: anyLv, amount: 1 }]);
  });

  it('renames metadata keys, turns item values into keys and keeps unknown keys', async () => {
    const pack = await makePack({
      ...sampleExportSpec(),
      recipesGt: [{ map: 6, in: [[4, 1]], out: [[16, 1]], fin: [], fout: [], eut: 30, dur: 200,
        meta: { cleanroom: true, low_gravity: true, coil_heat: 1800, research_item: { item: 1 }, fuel_value: 7 }, owners: ['gregtech'] }],
    });
    expect(inMap(pack, 'gt.recipe.circuitassembler')[0]!.meta).toEqual({
      cleanroom: true, lowGravity: true, coilHeat: 1800, research_item: SAMPLE.ironDust, fuel_value: 7, owners: ['gregtech'],
    });
  });

  it('turns item references at any depth of a metadata value into keys and keeps the rest of it', async () => {
    const recipe = (meta: GtRecipeLine['meta']): GtRecipeLine => ({ map: 6, in: [[4, 1]], out: [[16, 1]], fin: [], fout: [], eut: 30, dur: 200, meta });
    const meta = {
      SIEVERT: { isExact: true, sievert: 5 }, condensate_input: [['helium', 1000], null], nanite_tiers: ['Carbon', 'Gold'],
      target_chamber_metadata: { amount: 100, focusItem: { item: 3 }, minEnergy: 0.0005 }, crops: [{ item: 1 }, { item: 0 }],
      lookalike: { item: 7, size: 2 },
    };
    const pack = await makePack({ ...sampleExportSpec(), recipesGt: [recipe(meta)] });
    expect(inMap(pack, 'gt.recipe.circuitassembler')[0]!.meta).toEqual({
      SIEVERT: { isExact: true, sievert: 5 }, condensate_input: [['helium', 1000], null], nanite_tiers: ['Carbon', 'Gold'],
      target_chamber_metadata: { amount: 100, focusItem: SAMPLE.nickelDust, minEnergy: 0.0005 }, crops: [SAMPLE.ironDust, SAMPLE.ironIngot],
      lookalike: { item: 7, size: 2 },
    });
    await expect(makePack({ ...sampleExportSpec(), recipesGt: [recipe({ deep: [{ a: { item: 99 } }] })] }))
      .rejects.toMatchObject({ name: 'ExportFormatError', file: 'recipes-gt.jsonl.gz', line: 1 });
  });

  it('records the mode of each tree farm output', async () => {
    const pack = await makePack({
      items: [
        { id: 't:log', m: 0, dn: 'Log' }, { id: 't:sapling', m: 0, dn: 'Sapling' }, { id: 't:leaves', m: 0, dn: 'Leaves' },
        { id: 't:fruit', m: 0, dn: 'Fruit' }, { id: 't:dust', m: 0, dn: 'Dust' },
      ],
      recipeMaps: [{ id: 'gt.recipe.treefarm', dn: 'Tree Growth Simulator', amps: 1 }, { id: 'gt.recipe.centrifuge', dn: 'Centrifuge', amps: 1 }],
      recipesGt: [
        { map: 0, in: [], out: [[0, 5], [1, 5], null, [3, 1]], fin: [], fout: [], eut: 0, dur: 100, fake: true, special: 1 },
        { map: 1, in: [[0, 1]], out: [null, [4, 1]], fin: [], fout: [], eut: 5, dur: 100 },
      ],
    });
    const [tree] = inMap(pack, 'gt.recipe.treefarm');
    expect(tree!.outputs.map((o) => [o.key, o.amount])).toEqual([['t:log@0', 5], ['t:sapling@0', 5], ['t:fruit@0', 1]]);
    expect(tree!.meta.tgsModes).toEqual(['log', 'sapling', 'fruit']);
    expect(recipeId({ ...tree!, fake: tree!.flags.fake })).toBe(tree!.id);   // the modes are part of the recipe's id
    const [centrifuge] = inMap(pack, 'gt.recipe.centrifuge');
    expect(centrifuge!.outputs.map((o) => o.key)).toEqual(['t:dust@0']);
    expect(centrifuge!.meta).not.toHaveProperty('tgsModes');
  });

  it('gives a tree farm output past the four modes none, and warns', async () => {
    const pack = await makePack({
      items: [0, 1, 2, 3, 4].map((m) => ({ id: 't:thing', m, dn: `Thing ${m}` })),
      recipeMaps: [{ id: 'gt.recipe.treefarm', dn: 'Tree Growth Simulator', amps: 1 }],
      recipesGt: [{ map: 0, in: [], out: [[0, 5], [1, 5], [2, 2], [3, 1], [4, 1]], fin: [], fout: [], eut: 0, dur: 100, fake: true }],
    });
    const [tree] = inMap(pack, 'gt.recipe.treefarm');
    expect(tree!.outputs).toHaveLength(5);
    expect(tree!.meta.tgsModes).toEqual(['log', 'sapling', 'leaves', 'fruit']);
    expect(pack.warnings).toContain('gt.recipe.treefarm: item output 4 of a row is past the 4 Tree Growth Simulator modes, it has none');
  });

  it('reports a recipe that names an unknown map', async () => {
    await expect(makePack({ ...sampleExportSpec(), recipesGt: [{ map: 99, in: [], out: [[1, 1]], fin: [], fout: [], eut: 1, dur: 1 }] }))
      .rejects.toMatchObject({ name: 'ExportFormatError', file: 'recipes-gt.jsonl.gz', line: 1 });
  });

  it('gives the same id to the same recipe when item indices differ between exports', async () => {
    const a = await makePack({ items: [{ id: 'gregtech:gt.blockores', m: 32 }, { id: 'gregtech:gt.metaitem.01', m: 2032 }],
      recipeMaps: [{ id: 'gt.recipe.macerator', amps: 1 }], recipesGt: [{ map: 0, in: [[0, 1]], out: [[1, 2]], fin: [], fout: [], eut: 2, dur: 400 }] });
    const b = await makePack({ items: [{ id: 'gregtech:gt.metaitem.01', m: 2032 }, { id: 'gregtech:gt.blockores', m: 32 }],
      recipeMaps: [{ id: 'gt.recipe.macerator', amps: 1 }], recipesGt: [{ map: 0, in: [[1, 1]], out: [[0, 2]], fin: [], fout: [], eut: 2, dur: 400 }] });
    expect(a.recipes[0]!.id).toBe(b.recipes[0]!.id);
  });
});

describe('assembly line, crafting and furnace recipes', () => {
  it('converts assembly-line recipes', async () => {
    const [al] = inMap(await makePack(sampleExportSpec()), 'assemblyline');
    expect(al).toMatchObject({
      source: 'assemblyline', euPerTick: 7680, durationTicks: 600, amps: 1,
      meta: { researchItem: SAMPLE.goodCircuit, researchTime: 3600, researchVoltage: 30720 },
      outputs: [{ key: 'gregtech:gt.blockmachines@1000', amount: 1, chance: 1 }],
    });
    expect(al!.inputs.map((i) => i.slot)).toEqual([0, 1, 100]);
  });

  it('converts shaped ore slots, wildcards, tools and opaque recipes', async () => {
    const crafting = inMap(await makePack(sampleExportSpec()), 'crafting');
    const table = crafting.find((r) => r.outputs[0]!.key === SAMPLE.craftingTable)!;
    expect(table).toMatchObject({ euPerTick: 0, durationTicks: 0, amps: 0, flags: { shaped: true }, meta: { width: 2, height: 2 } });
    expect(table.inputs).toHaveLength(4);
    expect(table.inputs[0]!.options.map((o) => o.key)).toEqual([SAMPLE.oakPlanks, SAMPLE.sprucePlanks]);
    const sticks = crafting.find((r) => r.outputs[0]!.key === SAMPLE.stick)!;
    expect(sticks.outputs[0]!.amount).toBe(4);
    expect(sticks.inputs[0]!.options.map((o) => o.key)).toEqual([SAMPLE.oakPlanks, SAMPLE.sprucePlanks]);
    const hammered = crafting.find((r) => r.outputs[0]!.key === SAMPLE.ironDust)!;
    expect(hammered.inputs.map((i) => i.consumed)).toEqual([false, true]);
    const opaque = crafting.find((r) => r.flags.opaque)!;
    expect(opaque).toMatchObject({ inputs: [], outputs: [{ key: itemKey('minecraft:written_book', 0, nbtHash('{title:"Data"}')), amount: 1, chance: 1 }] });
  });

  it('converts furnace recipes', async () => {
    const furnace = inMap(await makePack(sampleExportSpec()), 'furnace');
    expect(furnace).toHaveLength(3);
    expect(furnace.find((r) => r.inputs[0]!.options[0]!.key === SAMPLE.ironDust)).toMatchObject({
      source: 'furnace', euPerTick: 0, durationTicks: 200, amps: 0, meta: { xp: 0.7 }, outputs: [{ key: SAMPLE.ironIngot, amount: 1, chance: 1 }],
    });
  });
});

describe('recipe rules the sample does not reach', () => {
  const recipe = (maps: string[], amps: number, flags: Recipe['flags']): Recipe => ({
    id: '0123456789abcdef', source: 'gt', maps, inputs: [], outputs: [], euPerTick: 1, durationTicks: 1, amps, specialValue: 0, meta: {}, flags,
  });

  it('merges copies: maps in first-seen order, max amps, hidden only if every copy is, recycling if any is', () => {
    const collector = new RecipeCollector();
    collector.add(recipe(['a', 'b'], 1, { hidden: true }));
    collector.add(recipe(['b', 'c'], 2, { recycling: true }));
    collector.add(recipe(['a'], 1, { hidden: true }));
    expect(collector.list()).toEqual([recipe(['a', 'b', 'c'], 2, { recycling: true })]);
    const hidden = new RecipeCollector();
    hidden.add(recipe(['a'], 1, { hidden: true }));
    hidden.add(recipe(['b'], 1, { hidden: true }));
    expect(hidden.list()[0]!.flags).toEqual({ hidden: true });
  });

  it('keeps GT flags, the special item and a wildcard output as metadata and keys', async () => {
    const pack = await makePack({
      ...sampleExportSpec(),
      recipesGt: [{ map: 6, in: [[4, 1]], out: [[8, 1]], fin: [], fout: [], eut: 30, dur: 200, needsEmptyOut: true, nbtSensitive: true, special: 16 }],
    });
    const [r] = inMap(pack, 'gt.recipe.circuitassembler');
    expect(r!.meta).toEqual({ needsEmptyOutput: true, nbtSensitive: true, specialItem: SAMPLE.goodCircuit });
    expect(r!.inputs.flatMap((i) => i.options.map((o) => o.key))).toEqual([SAMPLE.steelIngot]);
    expect(r!.outputs).toEqual([{ key: SAMPLE.oakPlanks, amount: 1, chance: 1 }]);
  });

  it('skips crafting lines without an output, warns about empty ore names and keeps GT tools', async () => {
    const pack = await makePack({
      ...sampleExportSpec(),
      recipesCrafting: [
        { cls: 'example.Dynamic', shape: 'shapeless', in: [1], out: null },
        { cls: 'example.Dynamic', shape: 'shapeless', in: [2], out: null },
        { cls: 'gregtech.api.util.GTShapelessRecipe', shape: 'shapeless', in: [19, { ore: 'dustUnobtainium' }, 2], out: [1, 1] },
      ],
    });
    const crafting = inMap(pack, 'crafting');
    expect(crafting).toHaveLength(1);
    expect(crafting[0]!.inputs.map((i) => [i.consumed, i.options.length])).toEqual([[false, 1], [true, 0], [true, 1]]);
    expect(pack.warnings!.filter((w) => w.includes('without an output'))).toEqual(['recipes-crafting.jsonl.gz: skipped 2 crafting recipe(s) without an output']);
    expect(pack.warnings!.filter((w) => w.includes('dustUnobtainium'))).toHaveLength(1);
  });

  it('reports a recipe that names an unknown item', async () => {
    await expect(makePack({ ...sampleExportSpec(), recipesFurnace: [{ in: 999, out: [0, 1], xp: 0 }] }))
      .rejects.toMatchObject({ name: 'ExportFormatError', file: 'recipes-furnace.jsonl.gz', line: 1, message: expect.stringContaining('unknown item index 999') });
  });
});
