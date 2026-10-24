// A synchronous, in-memory `Pack` for the planner tests (Plan 2). Not Plan 1's async `makePack(spec: ExportSpec)` in
// make-pack.ts (architecture §11.18): this one skips the export format and fills the Pack directly, with the loader's
// conventions (§11.4) as defaults. Only declared maps and machines exist (no pseudo maps or machines), except that the
// loader's supply recipes are derived as it does (fix spec R2: a pump machine brings the pseudo map `pump`), and so are
// its Auto Workbench variants of tool recipes (bench-tools.ts, plan 12 controller ruling 214 (a)); keys that recipes use
// without declaring them become items, or fluids for `fluid:` keys, named after their key.

import { V } from '../../src/shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type FluidKey, type ItemKey, type StuffKey } from '../../src/shared/keys.ts';
import { gtMachineId } from '../../src/shared/ids.ts';
import type {
  Fluid, GtMaterial, Ingredient, Item, Machine, MachineKind, Pack, PackManifest, Product, Recipe, RecipeMapInfo, RecipeSource,
  StructureInfo, Worldgen,
} from '../../src/shared/types/pack.ts';
import { buildIndices, buildMachinesByMap } from '../../src/server/pack/indices.ts';
import { PSEUDO_MAPS } from '../../src/server/pack/load.ts';
import { circuitStandIns, withStandIns } from '../../src/server/pack/stand-ins.ts';
import { benchVariants } from '../../src/server/pack/bench-tools.ts';
import { deriveSupply } from '../../src/server/pack/supply.ts';

export interface PackSpec {
  exportId?: string; items?: ItemSpec[]; fluids?: FluidSpec[]; maps?: MapSpec[]; machines?: MachineSpec[]; recipes?: RecipeSpec[]; materials?: string[]; worldgen?: Partial<Worldgen>;
  /** Filled containers and the fluid each holds (`Pack.fluidContainers`), copied into the pack; their keys become items. */
  fluidContainers?: Pack['fluidContainers'];
}
export interface ItemSpec { key: ItemKey; name?: string; oreDict?: string[]; gt?: { prefix: string; material: string; amount?: number /* M units, default 3628800 */ } }
export interface FluidSpec { key: FluidKey; name?: string; gas?: boolean }
export interface MapSpec { id: string; name?: string; amps?: number; specialValue?: RecipeMapInfo['specialValue'] }
export interface MachineSpec { mteId: number; name: string; maps: string[]; kind?: MachineKind /* 'basic' */; tier?: number; amps?: number; perfectOC?: boolean; heatOC?: boolean; itemKey?: ItemKey /* `machine:${mteId}@0` */; cls?: string; structure?: StructureInfo; metaName?: string /* `test.machine.${mteId}` */ }
export type IngredientSpec = [StuffKey, number] | [StuffKey, number, number /* consume chance */] | { any: Array<[StuffKey, number]> } | { nc: StuffKey /* not consumed */ }
  | { ncAny: StuffKey[] /* not consumed, any of these: a crafting tool slot's ore name */ };
export interface RecipeSpec { id?: string /* `r${index + 1}` */; map: string; source?: RecipeSource; in?: IngredientSpec[]; out?: Array<[StuffKey, number] | [StuffKey, number, number /* chance */]>; eut?: number /* 0 */; dur?: number /* 20 */; amps?: number /* 1 */; sv?: number; meta?: Recipe['meta']; flags?: Recipe['flags']; category?: string }

/** One dust or ingot in GT's material units. */
const M = 3_628_800;
const FLUID_SLOT_BASE = 100;

/** A fresh copy for every pack, so a test that changes its pack changes no other. */
function defaultWorldgen(): Worldgen {
  return {
    dimensions: [{ key: 'overworld', id: 0, name: 'Overworld', mod: 'minecraft', kind: 'dimension', defaultTier: 0 }],
    veins: [], fluidSources: [], capabilities: [], byproducts: {},
  };
}

/** The loader's per-source timings (architecture §11.4); other sources get 20 ticks at 1 A. */
const SOURCE_DEFAULTS: Readonly<Partial<Record<RecipeSource, { dur: number; amps: number }>>> = {
  crafting: { dur: 0, amps: 0 },
  furnace: { dur: 200, amps: 0 },
};

function sourceOf(map: string): RecipeSource {
  return map === 'crafting' ? 'crafting' : map === 'furnace' ? 'furnace' : 'gt';
}

function itemFor(key: ItemKey, spec?: ItemSpec): Item {
  const { id, meta } = parseItemKey(key);
  const item: Item = { key, id, meta, name: spec?.name ?? key, oreDict: [...(spec?.oreDict ?? [])] };
  if (spec?.gt) item.gt = { prefix: spec.gt.prefix, material: spec.gt.material, amount: spec.gt.amount ?? M };
  return item;
}

function fluidFor(key: FluidKey, spec?: FluidSpec): Fluid {
  if (!isFluidKey(key)) throw new Error(`fluid keys start with "fluid:", got ${key}`);
  const id = key.slice('fluid:'.length);
  return { key, id, name: spec?.name ?? key, temperature: 300, gas: spec?.gas ?? false, molten: id.startsWith('molten.') };
}

/** GT's rule (loader `consumption`): amount 0 or chance 0 is not consumed, and then the chance is 0. */
function ingredientFrom(spec: IngredientSpec, slot: number): Ingredient {
  if (Array.isArray(spec)) {
    const [key, amount, chance = 1] = spec;
    const consumed = amount > 0 && chance > 0;
    return { slot, consumed, chance: consumed ? chance : 0, options: [{ key, amount: Math.max(amount, 1) }] };
  }
  if ('any' in spec) return { slot, consumed: true, chance: 1, options: spec.any.map(([key, amount]) => ({ key, amount })) };
  if ('ncAny' in spec) return { slot, consumed: false, chance: 0, options: spec.ncAny.map((key) => ({ key, amount: 1 })) };
  return { slot, consumed: false, chance: 0, options: [{ key: spec.nc, amount: 1 }] };
}

function firstKeyOf(spec: IngredientSpec): StuffKey | undefined {
  if (Array.isArray(spec)) return spec[0];
  return 'any' in spec ? spec.any[0]?.[0] : 'ncAny' in spec ? spec.ncAny[0] : spec.nc;
}

/** Item inputs are numbered from 0 and fluid inputs from 100, each in their own order. */
function ingredientsFrom(specs: readonly IngredientSpec[]): Ingredient[] {
  let items = 0;
  let fluids = 0;
  return specs.map((spec) => {
    const key = firstKeyOf(spec);
    const slot = key !== undefined && isFluidKey(key) ? FLUID_SLOT_BASE + fluids++ : items++;
    return ingredientFrom(spec, slot);
  });
}

function recipeFrom(spec: RecipeSpec, index: number): Recipe {
  const source = spec.source ?? sourceOf(spec.map);
  const defaults = SOURCE_DEFAULTS[source] ?? { dur: 20, amps: 1 };
  const outputs: Product[] = (spec.out ?? []).map(([key, amount, chance = 1]) => ({ key, amount, chance }));
  const recipe: Recipe = {
    id: spec.id ?? `r${index + 1}`, source, maps: [spec.map], inputs: ingredientsFrom(spec.in ?? []), outputs,
    euPerTick: spec.eut ?? 0, durationTicks: spec.dur ?? defaults.dur, amps: spec.amps ?? defaults.amps, specialValue: spec.sv ?? 0,
    meta: { ...spec.meta }, flags: { ...spec.flags },
  };
  if (spec.category !== undefined) recipe.category = spec.category;
  return recipe;
}

function mapFrom(spec: MapSpec): RecipeMapInfo {
  const pseudo = PSEUDO_MAPS.find((m) => m.id === spec.id);
  return {
    id: spec.id, name: spec.name ?? pseudo?.name ?? spec.id, amps: spec.amps ?? pseudo?.amps ?? 1,
    specialValue: spec.specialValue ?? 'none', aliases: [],
  };
}

function machineFrom(spec: MachineSpec): Machine {
  const machine: Machine = {
    id: gtMachineId(spec.mteId), mteId: spec.mteId, metaName: spec.metaName ?? `test.machine.${spec.mteId}`, name: spec.name, cls: spec.cls ?? 'test.Machine',
    itemKey: spec.itemKey ?? `machine:${spec.mteId}@0`, kind: spec.kind ?? 'basic', maps: [...spec.maps],
  };
  if (spec.tier !== undefined) {
    machine.tier = spec.tier;
    machine.voltage = V[spec.tier];
  }
  if (spec.amps !== undefined) machine.amps = spec.amps;
  if (spec.perfectOC !== undefined) machine.perfectOC = spec.perfectOC;
  if (spec.heatOC !== undefined) machine.heatOC = spec.heatOC;
  if (spec.structure !== undefined) machine.structure = spec.structure;
  return machine;
}

function addOnce<K, T>(map: Map<K, T>, key: K, value: T, what: string): void {
  if (map.has(key)) throw new Error(`packFromSpec: ${what} ${String(key)} is declared twice`);
  map.set(key, value);
}

/**
 * The loader's supply recipes (load.ts `addDerivedRecipes`, fix spec R2), added the same way: the derived recipes join
 * `recipes` (one the spec already has by id is not added again), a pump machine gets the pseudo map `pump`, and the
 * compressor recipes are marked `meta.supply` with their ids unchanged (ruling P20).
 */
function addSupply(recipes: Recipe[], machines: Map<number, Machine>, maps: Map<string, RecipeMapInfo>, fluidContainers: NonNullable<Pack['fluidContainers']>): void {
  const supply = deriveSupply({ recipes, machines, maps, fluidContainers });
  const flagged = new Set(supply.flagged);
  for (const r of recipes) if (flagged.has(r.id)) r.meta.supply = 'compressor';
  const ids = new Set(recipes.map((r) => r.id));
  for (const r of supply.recipes) if (!ids.has(r.id)) recipes.push(r);
  if (supply.pumpMap === null) return;
  const map = supply.pumpMap.id;
  maps.set(map, supply.pumpMap);
  for (const id of supply.pumpMachines) {
    const machine = machines.get(id);
    if (machine !== undefined && !machine.maps.includes(map)) machine.maps.push(map);
  }
}

export function packFromSpec(spec: PackSpec): Pack {
  const exportId = spec.exportId ?? 'test';
  const manifest: PackManifest = {
    format: 'gtnh-planner-export/1', exportId, exporterVersion: 'test', exportedAt: '2026-01-01T00:00:00.000Z',
    packVersion: 'test', gtVersion: 'test', mods: {}, counts: {},
  };

  const items = new Map<ItemKey, Item>();
  for (const s of spec.items ?? []) addOnce(items, s.key, itemFor(s.key, s), 'item');
  const fluids = new Map<FluidKey, Fluid>();
  for (const s of spec.fluids ?? []) addOnce(fluids, s.key, fluidFor(s.key, s), 'fluid');

  const recipes = (spec.recipes ?? []).map(recipeFrom);
  const fluidContainers = (spec.fluidContainers ?? []).map((c) => ({ ...c }));
  for (const c of fluidContainers) {
    for (const key of c.empty === null ? [c.container] : [c.container, c.empty]) if (!items.has(key)) items.set(key, itemFor(key));
    if (!fluids.has(c.fluid)) fluids.set(c.fluid, fluidFor(c.fluid));
  }
  const maps = new Map<string, RecipeMapInfo>();
  for (const s of spec.maps ?? []) addOnce(maps, s.id, mapFrom(s), 'map');
  const machines = new Map<number, Machine>();
  for (const s of spec.machines ?? []) addOnce(machines, s.mteId, machineFrom(s), 'machine');
  addSupply(recipes, machines, maps, fluidContainers);
  // the loader's bench variants (load.ts `addDerivedRecipes`), from the declared items' ore names
  recipes.push(...benchVariants(recipes, items));

  const recipeById = new Map<string, Recipe>();
  for (const r of recipes) {
    addOnce(recipeById, r.id, r, 'recipe');
    const keys = [...r.inputs.flatMap((ing) => ing.options.map((o) => o.key)), ...r.outputs.map((p) => p.key)];
    for (const key of keys) {
      if (isFluidKey(key)) {
        if (!fluids.has(key)) fluids.set(key, fluidFor(key));
      } else if (!items.has(key)) {
        items.set(key, itemFor(key));
      }
    }
  }

  const oreDict = new Map<string, ItemKey[]>();
  for (const item of items.values()) {
    for (const ore of item.oreDict) {
      const list = oreDict.get(ore);
      if (list === undefined) oreDict.set(ore, [item.key]);
      else list.push(item.key);
    }
  }
  // The loader's GT and assembly-line slots (recipes.ts): a GTNH circuit stand-in also takes every item it stands for.
  const standIns = circuitStandIns(items.values(), oreDict);
  for (const r of recipes) {
    if (r.source !== 'gt' && r.source !== 'assemblyline') continue;
    r.inputs = r.inputs.map((ing) => ({ ...ing, options: withStandIns(ing.options, standIns) }));
  }

  const worldgen: Worldgen = { ...defaultWorldgen(), ...spec.worldgen };
  const materials = new Map<string, GtMaterial>();
  const materialNames = [...(spec.materials ?? []), ...[...items.values()].flatMap((item) => (item.gt ? [item.gt.material] : []))];
  for (const name of materialNames) {
    if (materials.has(name)) continue;
    materials.set(name, { name, rgba: [255, 255, 255, 0], iconSet: 'NONE', oreByproducts: [...(worldgen.byproducts[name] ?? [])] });
  }

  const { producers, consumers } = buildIndices(recipes);
  const pack: Pack = {
    manifest, items, fluids, oreDict, maps, recipes, recipeById, producers, consumers,
    machines, machinesByMap: buildMachinesByMap(machines), materials, worldgen,
    nameOf: (key) => items.get(key)?.name ?? fluids.get(key)?.name ?? key,
  };
  if (spec.fluidContainers !== undefined) pack.fluidContainers = fluidContainers;
  return pack;
}
