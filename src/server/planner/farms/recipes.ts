// The synthetic farm recipes of a line (add-on 17, architecture §11.45 (2)): for each good the line wants, the Tree
// Growth Simulator rows of the export and the crops of its crop table that make most of it, as recipes on the farm
// machines the line may use (farms/setup.ts) at their own tier; the soil each crop is planted on (`cropSoil`); how a farm
// recipe runs on its machine (never overclocked), the farm step a plan shows for one, and what planting a crop farm
// takes. The recipes join the line's pack (farms/pack.ts); the loader never makes them.

import type { MachineOc } from '../../../shared/gt/overclock.ts';
import { V, tierName } from '../../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { TGS_MODE_ORDER, type FarmRecipeMeta, type FarmSettings, type FarmStep, type TgsMode } from '../../../shared/types/farm.ts';
import type { CropCard, Ingredient, Machine, Pack, Product, Recipe } from '../../../shared/types/pack.ts';
import type { PlanStep } from '../../../shared/types/plan.ts';
import { recipeId } from '../../pack/recipe-id.ts';
import { TREE_FARM_MAP } from '../../pack/recipes.ts';
import { canonicalRank, type CandidateGraph } from '../candidates.ts';
import type { PriceTable } from '../costs.ts';
import { cropHarvest, managerSide, type CropHarvest } from './crops.ts';
import { CROP_MANAGER_MAP } from './pack.ts';
import type { FarmSetup } from './setup.ts';
import { TGS_TOOLS, tgsOp, toolPrice, type TgsOp } from './tgs.ts';

/** Tree farm rows, and crop cards, a line gets per good it wants: those that make most of it. */
export const FARM_SOURCES_PER_GOOD = 2;
/** CropsNH's Crop Sticks: one per planted crop, on its soil block. */
export const CROP_STICKS: StuffKey = 'cropsnh:cropSticks@0';
/** A Tree Growth Simulator's footprint (x, height, z) when its controller's export has no structure. */
const TGS_FOOTPRINT: readonly [number, number, number] = [7, 7, 7];
const WATER: StuffKey = 'fluid:water';
/** Fluid ingredient slots start here (architecture §11.4). */
const FLUID_SLOT = 100;
const TICKS_PER_SECOND = 20;
/** A stick count this little above a whole number stays whole. */
const TINY = 1e-9;

/** The mode of each offered tool, by its item. */
const TOOL_MODES: ReadonlyMap<StuffKey, TgsMode> = new Map(TGS_MODE_ORDER.map((mode) => [TGS_TOOLS[mode].key, mode]));

const DIRT: StuffKey = 'minecraft:dirt@0';
/**
 * The soils a group has wherever it digs dirt, most wanted first (the final review of add-on 17): dirt itself, farmland
 * (dirt hoed) and grass (dirt grass has grown over). A crop is planted on the first of them its card lists.
 */
export const PLAIN_SOILS: readonly StuffKey[] = Object.freeze([DIRT, 'minecraft:farmland@0', 'minecraft:grass@0']);
/** What the group does to the dirt it places for a plain soil other than dirt itself. */
const DIRT_WORK: ReadonlyMap<StuffKey, string> = new Map([['minecraft:farmland@0', 'hoe it into Farmland'], ['minecraft:grass@0', 'let grass grow over it']]);

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What a line can get of a crop's soils (`cropSoil`): whether it can get an item at its tier (`Availability.available`),
 * and what one costs to build with (`ItemPrices.cost`, as machines and plantings are priced; Infinity: no price).
 */
export interface SoilSource { canGet(key: StuffKey): boolean; cost(key: StuffKey): number }

/** The item placed for a soil: dirt for farmland and grass (`PLAIN_SOILS`), else the soil itself. */
export function soilItem(soil: StuffKey): StuffKey {
  return DIRT_WORK.has(soil) ? DIRT : soil;
}

/** What to do to the dirt placed for `soil` (`hoe it into Farmland`), or undefined when the soil is placed as it is. */
export function soilWork(soil: StuffKey): string | undefined {
  return DIRT_WORK.get(soil);
}

/** The first of `PLAIN_SOILS` the card lists, where the line can get dirt; else undefined. */
function plainSoil(card: Pick<CropCard, 'soils'>, canGet: (key: StuffKey) => boolean): StuffKey | undefined {
  return PLAIN_SOILS.find((key) => card.soils.includes(key) && canGet(soilItem(key)));
}

/** The card's other soils the line can get (`PLAIN_SOILS` aside), sorted, each once. */
function otherSoils(card: Pick<CropCard, 'soils'>, canGet: (key: StuffKey) => boolean): StuffKey[] {
  return [...new Set(card.soils)].filter((key) => !PLAIN_SOILS.includes(key) && canGet(key)).sort(byString);
}

/**
 * The soil a crop is planted on, from its card's soils (`CropCard.soils`, kept in the export's order, which is CropsNH's
 * by key and says nothing of what a group would use: on the 2.9 export 29 crops list MagicBees' Enchanted Earth first
 * and 27 Chisel's dirt): the first of `PLAIN_SOILS` the card lists, where the line can get dirt; else the cheapest soil
 * the line can get (`soils.canGet`, at `soils.cost`, a priced one before an unpriced one), ties by key. Null when it can
 * get none of them, or the card lists none: such a crop gets no recipe, so a line never plants on a soil it cannot get.
 * Whether it is null depends on `canGet` alone.
 */
export function cropSoil(card: Pick<CropCard, 'soils'>, soils: SoilSource): StuffKey | null {
  const plain = plainSoil(card, soils.canGet);
  if (plain !== undefined) return plain;
  let best: { key: StuffKey; cost: number } | null = null;
  for (const key of otherSoils(card, soils.canGet)) {
    const cost = soils.cost(key);
    const each = Number.isFinite(cost) ? cost : Infinity;
    if (best === null || each < best.cost) best = { key, cost: each };
  }
  return best?.key ?? null;
}

/** What `products` make of `key`, in all. */
function madeOf(products: readonly Product[], key: StuffKey): number {
  let made = 0;
  for (const p of products) if (p.key === key) made += p.amount * p.chance;
  return made;
}

/**
 * The goods a line wants from farms: every good a step recipe (`kind: 'recipe'`) of its graph consumes, but for an
 * ore-dictionary slot (a virtual good) only the option of canonical rank 0 with the lowest key among those its
 * conversions take (none when every option is of rank 1); never one of the graph's targets.
 */
export function wantedGoods(graph: CandidateGraph): Set<StuffKey> {
  const options = new Map<StuffKey, StuffKey[]>();
  for (const r of graph.recipes) {
    if (r.kind !== 'convert') continue;
    const slot = r.coeffs.find(([, c]) => c > 0)?.[0];
    const option = r.coeffs.find(([, c]) => c < 0)?.[0];
    if (slot === undefined || option === undefined) continue;
    const list = options.get(slot);
    if (list === undefined) options.set(slot, [option]);
    else list.push(option);
  }
  const targets = new Set(graph.targets);
  const wanted = new Set<StuffKey>();
  for (const r of graph.recipes) {
    if (r.kind !== 'recipe') continue;
    for (const [key, c] of r.coeffs) {
      if (!(c < 0)) continue;
      const good = graph.goods.get(key)?.virtual === true
        ? (options.get(key) ?? []).filter((option) => canonicalRank(option) === 0).sort(byString)[0] : key;
      if (good !== undefined && !targets.has(good)) wanted.add(good);
    }
  }
  return wanted;
}

/** A synthetic farm recipe on `map`: derived, 1 A, no special value or flags, its id the content hash (`recipeId`). */
function farmRecipe(map: string, content: Pick<Recipe, 'inputs' | 'outputs' | 'euPerTick' | 'durationTicks' | 'meta'>): Recipe {
  const body = { source: 'derived' as const, ...content, specialValue: 0 };
  return { id: recipeId(body), ...body, maps: [map], amps: 1, flags: {} };
}

/** The first `FARM_SOURCES_PER_GOOD` of `candidates` by what they make of a good, most first, then by `tie`. */
function mostFirst<T extends { made: number; tie: string }>(candidates: T[]): T[] {
  return candidates.sort((a, b) => b.made - a.made || byString(a.tie, b.tie)).slice(0, FARM_SOURCES_PER_GOOD);
}

/**
 * The crops a line's farms would plant (with `setup.crops`): per wanted good (`goods`, sorted) the FARM_SOURCES_PER_GOOD
 * cards of the crop table whose harvest under the setup's Crop Manager (`cropHarvest`; none for a crop with growth
 * requirements) makes most of it (ties by crop id), among those planted on a soil the line can get (`cropSoil` not null,
 * which `canGet` alone decides), each card once, in the order first chosen; none without `setup.crops`.
 */
function chosenCrops(pack: Pack, setup: FarmSetup, goods: readonly StuffKey[], canGet: (key: StuffKey) => boolean): Array<{ card: CropCard; h: CropHarvest }> {
  const crops = setup.crops;
  if (crops === null) return [];
  const settings = setup.settings.crops;
  const harvests = (pack.crops ?? []).flatMap((card) => {
    const h = cropHarvest(card, settings.stats, crops.tier, settings);
    const planted = h !== null && (plainSoil(card, canGet) !== undefined || otherSoils(card, canGet).length > 0);
    return h === null || !planted ? [] : [{ card, h }];
  });
  const cards = new Map<string, { card: CropCard; h: CropHarvest }>();
  for (const good of goods) {
    const candidates = harvests.map((c) => ({ ...c, made: madeOf(c.h.drops, good), tie: c.card.id })).filter((c) => c.made > 0);
    for (const c of mostFirst(candidates)) if (!cards.has(c.card.id)) cards.set(c.card.id, { card: c.card, h: c.h });
  }
  return [...cards.values()];
}

/**
 * The soils a line must price for `farmRecipes` to choose its crops' soils (`cropSoil`): of the crops its farms would
 * plant (`chosenCrops`), those listing no plain soil the line can get and more than one other soil it can, those soils,
 * sorted, each once. None on most lines of the 2.9 export, whose crops grow on dirt or farmland (there a price graph of
 * every soil of its crop table took 0.75 s a line).
 */
export function soilsToPrice(pack: Pack, setup: FarmSetup, wanted: ReadonlySet<StuffKey>, canGet: (key: StuffKey) => boolean): StuffKey[] {
  const keys = new Set<StuffKey>();
  for (const { card } of chosenCrops(pack, setup, [...wanted].sort(byString), canGet)) {
    const others = plainSoil(card, canGet) === undefined ? otherSoils(card, canGet) : [];
    if (others.length > 1) for (const key of others) keys.add(key);
  }
  return [...keys].sort(byString);
}

/**
 * A Tree Growth Simulator's footprint, as layout sizes are (x, height, z): its controller's exported `structure.size` —
 * the controller of the first machine the line may use — else `TGS_FOOTPRINT`.
 */
function tgsFootprint(pack: Pack, machines: readonly number[]): [number, number, number] {
  const id = machines[0];
  const size = id === undefined ? undefined : pack.machines.get(id)?.structure?.size;
  return size === undefined ? [...TGS_FOOTPRINT] : [size[0], size[1], size[2]];
}

/** The tree farm recipe of one export row: its tools of `op.wear` as consumed slots in mode order, its products, its EU/t. */
function tgsRecipe(op: TgsOp, sapling: StuffKey, setup: { tier: number; machines: readonly number[] }, footprint: [number, number, number]): Recipe {
  const farm: FarmRecipeMeta = {
    kind: 'tgs', tier: setup.tier, machines: [...setup.machines], parallel: 1, footprint, sapling, tools: op.wear.map((w) => w.key),
  };
  const inputs: Ingredient[] = op.wear.map((w, slot) => ({ options: [{ key: w.key, amount: 1 }], consumed: true, chance: w.perOp, slot }));
  return farmRecipe(TREE_FARM_MAP, { inputs, outputs: op.outputs.map((p) => ({ ...p })), euPerTick: op.euPerTick, durationTicks: op.ticks, meta: { farm } });
}

/** The crop recipe of one card planted on `soil`: its fertilizer (slot 0), its water (slot 100), its drops; one harvest of one stick a run. */
function cropRecipe(card: CropCard, h: CropHarvest, soil: StuffKey, setup: NonNullable<FarmSetup['crops']>, crops: FarmSettings['crops']): Recipe {
  const side = managerSide(setup.tier);
  const farm: FarmRecipeMeta = {
    kind: 'crop', tier: setup.tier, machines: [...setup.machines], parallel: setup.parallel, footprint: [side, 2 * crops.layers, side],
    crop: { id: card.id, name: card.name, growthTicks: h.growthTicks, stats: { ...crops.stats }, soil, seed: card.seed },
  };
  const inputs: Ingredient[] = [];
  if (h.fertilizer !== null) inputs.push({ options: [{ key: h.fertilizer.key, amount: h.fertilizer.perRun }], consumed: true, chance: 1, slot: 0 });
  inputs.push({ options: [{ key: WATER, amount: h.waterPerRun }], consumed: true, chance: 1, slot: FLUID_SLOT });
  return farmRecipe(CROP_MANAGER_MAP, { inputs, outputs: h.drops.map((p) => ({ ...p })), euPerTick: h.euPerRun / h.cycleTicks, durationTicks: h.cycleTicks, meta: { farm } });
}

/**
 * The synthetic farm recipes for the goods a line wants, sorted by id, and the price of every tool they wear
 * (`toolPrice`), by its item:
 * - with `setup.tgs`, per wanted good the FARM_SOURCES_PER_GOOD rows of `gt.recipe.treefarm` with a sapling (the row's
 *   special item) whose operation at the setup's tier with the farm settings' tools and material (`tgsOp`) makes most of
 *   it (ties by sapling key), each row once: its tools of `wear` as consumed slots `{ options: [{ key, amount: 1 }],
 *   consumed: true, chance: perOp, slot: i }`, its `outputs`, `euPerTick`, `TGS_OP_TICKS`, map `gt.recipe.treefarm`;
 *   footprint the controller's `structure.size`, else 7 × 7 × 7;
 * - with `setup.crops`, the crops its farms would plant (`chosenCrops`: per wanted good the FARM_SOURCES_PER_GOOD cards
 *   of the crop table whose harvest under the setup's Crop Manager makes most of it, among the cards planted on a soil
 *   the line can get, `soils.canGet`; a card without one is never offered), each card once: `waterPerRun` L of water
 *   (slot 100) and, with fertilizer, `perRun` of it (slot 0), its `drops`, `euPerRun / cycleTicks` EU/t for
 *   `cycleTicks`, map `CROP_MANAGER_MAP`; footprint `[managerSide, 2 × layers, managerSide]` (a layer is a soil block
 *   and its crop sticks), its soil `cropSoil`'s with `soils` (whose `cost` needs to price only `soilsToPrice`).
 * Both `source: 'derived'`, `amps: 1`, `specialValue: 0`, `flags: {}`, with `meta.farm` (`FarmRecipeMeta`), ids from
 * `recipeId`.
 */
export function farmRecipes(
  pack: Pack, setup: FarmSetup, wanted: ReadonlySet<StuffKey>, prices: PriceTable, soils: SoilSource,
): { recipes: Recipe[]; tools: Map<StuffKey, number> } {
  const recipes = new Map<string, Recipe>();
  const tools = new Map<StuffKey, number>();
  const goods = [...wanted].sort(byString);
  const { tgs, crops } = setup;
  if (tgs !== null) {
    const { tools: bus, toolMaterial } = setup.settings.tgs;
    const footprint = tgsFootprint(pack, tgs.machines);
    const rows = new Map<string, { op: TgsOp; sapling: StuffKey }>();
    for (const good of goods) {
      const candidates: Array<{ id: string; op: TgsOp; sapling: StuffKey; made: number; tie: string }> = [];
      for (const i of pack.producers.get(good) ?? []) {
        const row = pack.recipes[i];
        const sapling = row?.meta.specialItem;
        if (row === undefined || !row.maps.includes(TREE_FARM_MAP) || row.meta.farm !== undefined || typeof sapling !== 'string') continue;
        const op = tgsOp(row, tgs.tier, bus, toolMaterial);
        const made = op === null ? 0 : madeOf(op.outputs, good);
        if (op !== null && made > 0) candidates.push({ id: row.id, op, sapling, made, tie: `${sapling}\n${row.id}` });
      }
      for (const c of mostFirst(candidates)) if (!rows.has(c.id)) rows.set(c.id, { op: c.op, sapling: c.sapling });
    }
    for (const { op, sapling } of rows.values()) {
      const r = tgsRecipe(op, sapling, tgs, footprint);
      recipes.set(r.id, r);
      for (const { key } of op.wear) {
        const mode = TOOL_MODES.get(key);
        if (mode !== undefined) tools.set(key, toolPrice(mode, toolMaterial, prices));
      }
    }
  }
  if (crops !== null) {
    for (const { card, h } of chosenCrops(pack, setup, goods, soils.canGet)) {
      // never null: `chosenCrops` keeps the cards planted on a soil the line can get
      const r = cropRecipe(card, h, cropSoil(card, soils) as StuffKey, crops, setup.settings.crops);
      recipes.set(r.id, r);
    }
  }
  return { recipes: [...recipes.values()].sort((a, b) => byString(a.id, b.id)), tools };
}

/** The machine kind a farm machine runs as: a multiblock (a Tree Growth Simulator) or a basic machine (a Crop Manager). */
export function farmMachineKind(m: Machine): 'basic' | 'multiblock' {
  return m.kind === 'multiblock' ? 'multiblock' : 'basic';
}

/**
 * How a farm recipe runs on one of its machines: at its own tier, never overclocked, one machine tending `parallel` runs
 * at once (a Crop Manager's crop sticks; 1 for a Tree Growth Simulator), so it draws `parallel` × the recipe's EU/t.
 */
export function farmOc(r: Recipe, farm: FarmRecipeMeta): MachineOc {
  return {
    euPerTick: r.euPerTick * farm.parallel, durationTicks: r.durationTicks, overclocks: 0, heatOverclocks: 0,
    machineVoltage: V[farm.tier] as number, machineAmps: 1, parallel: farm.parallel,
  };
}

/**
 * One part of planting a crop stick of a crop farm (the final review of add-on 17): its Crop Sticks (`sticks`), the item
 * placed for its soil (`soil`: `soilItem`, with the soil itself, so farmland is dirt the group hoes) and its seed
 * (`seed`), which comes from the group's own seed bank.
 */
export interface PlantingPart { key: StuffKey; part: 'sticks' | 'soil' | 'seed'; soil?: StuffKey }

/** What planting one crop stick of a crop farm takes (`PlantingPart`), in that order; none for a tree farm (its sapling is no planting). */
export function plantingParts(farm: FarmRecipeMeta): PlantingPart[] {
  if (farm.kind !== 'crop') return [];
  const soil = farm.crop?.soil ?? null;
  const seed = farm.crop?.seed ?? null;
  return [
    { key: CROP_STICKS, part: 'sticks' },
    ...(soil === null ? [] : [{ key: soilItem(soil), part: 'soil' as const, soil }]),
    ...(seed === null ? [] : [{ key: seed, part: 'seed' as const }]),
  ];
}

/**
 * The goods planting one crop stick of a crop farm takes that its build cost counts: a Crop Sticks and the item placed
 * for its soil (`plantingParts` but the seeds, which are the group's own); none for a tree farm.
 */
export function plantingKeys(farm: FarmRecipeMeta): StuffKey[] {
  return plantingParts(farm).filter((p) => p.part !== 'seed').map((p) => p.key);
}

/**
 * What planting one crop stick costs at `cost` (`plantingKeys`). A part without a finite price counts nothing here, as
 * in the build MIP; `unpricedPlantings` names it, and the plan's `build-cost-unknown` warning says so.
 */
export function stickCost(farm: FarmRecipeMeta, cost: (key: StuffKey) => number): number {
  let total = 0;
  for (const key of plantingKeys(farm)) {
    const each = cost(key);
    if (Number.isFinite(each)) total += each;
  }
  return total;
}

/** The parts of planting a crop stick (`plantingKeys`) that have no finite price at `cost`, in that order. */
export function unpricedPlantings(farm: FarmRecipeMeta, cost: (key: StuffKey) => number): StuffKey[] {
  return plantingKeys(farm).filter((key) => !Number.isFinite(cost(key)));
}

/** The crop sticks a crop farm step tends: its runs a second × seconds a run (one harvest of one stick a run), whole. */
export function sticksOf(runsPerSecond: number, r: Recipe): number {
  return Math.max(0, Math.ceil((runsPerSecond * r.durationTicks) / TICKS_PER_SECOND - TINY));
}

/** "a", "a and b": the tool names of a tree farm's input bus. */
function joined(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

/**
 * The words of `count` crop farm machines named `machine` tending `sticks` crop sticks: `<count>× <machine>: <sticks> crop
 * stick(s) <planting>` (`FarmStep.planting`). A crop farm step's own words give its count and all its sticks
 * (`farmStepOf`); the area the layout keeps for one of its new machines gives 1 and that machine's share (layout/farms.ts).
 */
export function cropFarmText(count: number, machine: string, sticks: number, planting: string): string {
  return `${count}× ${machine}: ${sticks} crop stick${sticks === 1 ? '' : 's'} ${planting}`;
}

/**
 * The farm of a step of farm recipe `r` (`PlanStep.farm`), sized as `step` is: its kind, tier, footprint and words, and
 * what it plants. A tree farm: `Tree Growth Simulator (<tier>): <sapling> in the controller; <tools, by their tool names,
 * joined by " and "> (<the farm settings' tool material>) in an input bus`, its sapling and tools. A crop farm: `<count>×
 * <machine>: <sticks> crop sticks of <crop> (growth <g>, gain <g>, resistance <r>) on <soil>, watering on` and, with
 * fertilizer, `, fertilizer: <its name>` (`cropFarmText`; the soil `cropSoil` chose, by its own name: Farmland, not the
 * dirt hoed into it); its crop, the crop sticks it tends (`sticksOf`) and its planting, the words after the stick count.
 * Undefined for any other recipe.
 */
export function farmStepOf(pack: Pack, step: Pick<PlanStep, 'count' | 'machine' | 'runsPerSecond'>, r: Recipe, farms: FarmSettings): FarmStep | undefined {
  const farm = r.meta.farm;
  if (farm === undefined) return undefined;
  const footprint: [number, number, number] = [farm.footprint[0], farm.footprint[1], farm.footprint[2]];
  if (farm.kind === 'tgs') {
    const tools = [...(farm.tools ?? [])];
    const names = joined(tools.map((key) => {
      const mode = TOOL_MODES.get(key);
      return mode === undefined ? pack.nameOf(key) : TGS_TOOLS[mode].name;
    }));
    const sapling = farm.sapling;
    const planted = sapling === undefined ? 'a sapling' : pack.nameOf(sapling);
    const text = `Tree Growth Simulator (${tierName(farm.tier)}): ${planted} in the controller; ${names} (${farms.tgs.toolMaterial}) in an input bus`;
    const out: FarmStep = { kind: 'tgs', tier: farm.tier, footprint, text, tools };
    if (sapling !== undefined) out.sapling = sapling;
    return out;
  }
  const crop = farm.crop;
  const sticks = sticksOf(step.runsPerSecond, r);
  const name = crop?.name ?? pack.nameOf(r.outputs[0]?.key ?? r.id);
  const stats = crop?.stats ?? farms.crops.stats;
  const soil = crop?.soil ?? null;
  const fertilizer = r.inputs.find((ing) => ing.consumed && ing.options.some((o) => !isFluidKey(o.key)))?.options[0]?.key;
  const planting = `of ${name} (growth ${stats.growth}, gain ${stats.gain}, resistance ${stats.resistance})`
    + `${soil === null ? '' : ` on ${pack.nameOf(soil)}`}, watering on` + (fertilizer === undefined ? '' : `, fertilizer: ${pack.nameOf(fertilizer)}`);
  const text = cropFarmText(step.count, step.machine.name, sticks, planting);
  return { kind: 'crop', tier: farm.tier, footprint, text, crop: { id: crop?.id ?? r.id, name, stats: { ...stats } }, sticks, planting };
}
