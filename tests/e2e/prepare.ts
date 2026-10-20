// Builds data/e2e for the end-to-end web server (architecture §11.7): the Mini-GT pack as a real export in the
// exporter's wire format (Plan 1's makeExport), and a config with the shared password on 127.0.0.1:18787. Playwright
// runs this before every server start (playwright.config.ts), so each run starts from an empty project database.
// Plans 3–5 extend main() (assets, line parts) instead of starting another server (ruling R15).

import { mkdir, rm } from 'node:fs/promises';
import { saveConfig } from '../../src/server/config.ts';
import { hashPassword, newSessionSecret } from '../../src/server/http/auth.ts';
import type {
  CelestialLine, CraftingLine, CraftingSlot, DimensionLine, FluidSlot, FurnaceLine, GtRecipeLine, ItemLine, ItemSlot,
  MachineLine, MetaValue, OreVeinLine, RecipeMapLine, SmallOreLine, UndergroundFluidLine,
} from '../../src/server/pack/format.ts';
import { DERIVED_FROM_FURNACE } from '../../src/server/pack/indices.ts';
import { PSEUDO_MAPS } from '../../src/server/pack/load.ts';
import { FLUID_SLOT_BASE, META_RENAMES, VANILLA_FURNACE_TICKS } from '../../src/server/pack/recipes.ts';
import { CAPABILITY_MIN_TIER, TIER_DEFAULTS, UNKNOWN_DIM_TIER, dimKey } from '../../src/server/pack/worldgen.ts';
import { isFluidKey, parseItemKey, type ItemKey, type StuffKey } from '../../src/shared/keys.ts';
import type { Pack, Product, Recipe, RecipeMapInfo } from '../../src/shared/types/pack.ts';
import { withLineParts } from '../helpers/line-parts-export.ts';
import { makeExport, type ExportSpec } from '../helpers/make-export.ts';
import { MINI_GT } from '../helpers/mini-gt.ts';
import { packFromSpec, type PackSpec } from '../helpers/pack-spec.ts';
import { prepareAssets } from './assets-fixture.ts';
import { E2E_PASSWORD } from './helpers.ts';

/** GT's chance scale in the wire format: 10000 = 100 %. */
const CHANCE_SCALE = 10000;
const SHAPELESS_CLASS = 'net.minecraft.item.crafting.ShapelessRecipes';
/** The formatter (and key) whose simple class name the loader reads as the map's kind of special value. */
const SPECIAL_VALUE_FORMATTERS: Readonly<Record<RecipeMapInfo['specialValue'], Pick<RecipeMapLine, 'svFormatter' | 'svKey'>>> = {
  none: {},
  heat: { svFormatter: 'gregtech.nei.formatter.HeatingCoilSpecialValueFormatter' },
  fusion: { svFormatter: 'gregtech.nei.formatter.FusionSpecialValueFormatter' },
  fuel: { svFormatter: 'gregtech.nei.formatter.FuelSpecialValueFormatter' },
  tier: { svFormatter: 'gregtech.nei.formatter.SimpleSpecialValueFormatter', svKey: 'GT5U.nei.tier' },
};
/** `Recipe.meta` keys → the GT metadata identifiers the exporter writes (the loader renames them back). */
const META_IDS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(META_RENAMES).map(([id, key]) => [key, id]));

function unsupported(what: string): never {
  throw new Error(`toExportSpec: ${what} has no export form that loads back the same`);
}

/** Ore-material keys of the GT family: what the exporter writes in vein lines for a material name. */
function materialKey(name: string): string {
  return `gt:${name}`;
}

function fluidName(key: StuffKey): string {
  return key.slice('fluid:'.length);
}

/** A wire slot: amount 0 (or chance 0) means not consumed; the chance is omitted at 100 %. */
function wireSlot<R>(ref: R, amount: number, consumed: boolean, chance: number): [R, number] | [R, number, number] {
  if (!consumed) return amount === 1 ? [ref, 0] : [ref, amount, 0];
  return chance === 1 ? [ref, amount] : [ref, amount, Math.round(chance * CHANCE_SCALE)];
}

function productSlot<R>(ref: R, p: Product): [R, number] | [R, number, number] {
  return wireSlot(ref, p.amount, true, p.chance);
}

function onlyOutput(r: Recipe): Product {
  const [out, ...more] = r.outputs;
  if (out === undefined || more.length > 0 || out.chance !== 1 || isFluidKey(out.key)) unsupported(`recipe ${r.id} without exactly one sure item output`);
  return out;
}

/** The one input of a smelting recipe: one item, consumed, once. */
function onlyInput(r: Recipe): ItemKey {
  const [ing, ...more] = r.inputs;
  const option = ing?.options[0];
  if (ing === undefined || more.length > 0 || ing.options.length !== 1 || !ing.consumed || ing.chance !== 1 || option?.amount !== 1 || isFluidKey(option.key)) {
    unsupported(`smelting recipe ${r.id} without exactly one input item`);
  }
  return option.key;
}

/**
 * The export whose loaded pack is `packFromSpec(spec)`, up to the loader's own conventions (architecture §11.4): recipe
 * ids become content hashes; the loader adds its pseudo maps (crafting, furnace, assemblyline), pseudo machines (−1,
 * −2) and the low-gravity capability; a crafting input of N items fills N slots; the electric furnace's derived recipes
 * come from the smelting list; every vein material gets a byproduct entry. Anything else the format cannot carry back
 * the same throws. The export's id is its folder name (makeExport).
 */
export function toExportSpec(spec: PackSpec): ExportSpec {
  const pack: Pack = packFromSpec(spec);

  const items: NonNullable<ExportSpec['items']> = [];
  const itemIndex = new Map<ItemKey, number>();
  const item = (key: ItemKey): number => {
    let i = itemIndex.get(key);
    if (i === undefined) {
      const { id, meta, nbtHash } = parseItemKey(key);
      if (nbtHash !== undefined) unsupported(`the NBT variant ${key}`);
      const line: Omit<ItemLine, 'i'> = { id, m: meta };
      const known = pack.items.get(key);   // a machine's item may be no pack item: it is then named after its key
      if (known !== undefined && known.name !== key) line.dn = known.name;
      if (known !== undefined && known.oreDict.length > 0) line.od = [...known.oreDict];
      if (known?.gt !== undefined) Object.assign(line, { gtPrefix: known.gt.prefix, gtMat: known.gt.material, gtAmt: known.gt.amount });
      itemIndex.set(key, (i = items.push(line) - 1));
    }
    return i;
  };
  for (const key of pack.items.keys()) item(key);

  const recipeMaps: NonNullable<ExportSpec['recipeMaps']> = [];
  const mapIndex = new Map<string, number>();
  for (const m of pack.maps.values()) {
    if (PSEUDO_MAPS.some((p) => p.id === m.id)) continue;   // the loader brings its own
    const line: (typeof recipeMaps)[number] = { id: m.id, dn: m.name, amps: m.amps, ...SPECIAL_VALUE_FORMATTERS[m.specialValue] };
    if (Object.hasOwn(DERIVED_FROM_FURNACE, m.id)) line.dynamic = 'overwrite';   // GT fills these maps from the smelting list
    mapIndex.set(m.id, recipeMaps.push(line) - 1);
  }

  const recipesGt: GtRecipeLine[] = [];
  const recipesCrafting: CraftingLine[] = [];
  const recipesFurnace: FurnaceLine[] = [];
  const derived: Recipe[] = [];
  for (const r of pack.recipes) {
    if (r.source === 'gt') recipesGt.push(gtRecipeLine(r, pack, mapIndex, item));
    else if (r.source === 'crafting') recipesCrafting.push(craftingLine(r, item));
    else if (r.source === 'furnace') recipesFurnace.push(furnaceLine(r, item));
    else if (r.source === 'derived') derived.push(r);
    else unsupported(`recipe ${r.id} of source ${r.source}`);
  }
  for (const r of derived) addDerived(r, recipesFurnace, item);

  const machines: MachineLine[] = [...pack.machines.values()].map((m) => {
    if (m.structure !== undefined) unsupported(`the structure of machine ${m.mteId}`);
    const line: MachineLine = { id: m.mteId, name: m.metaName, cls: m.cls, dn: m.name, item: item(m.itemKey), kind: m.kind, maps: [...m.maps] };
    if (m.tier !== undefined) line.tier = m.tier;
    if (m.voltage !== undefined) line.voltage = m.voltage;
    if (m.amps !== undefined) line.amps = m.amps;
    if (m.perfectOC !== undefined) line.perfectOC = m.perfectOC;
    if (m.heatOC !== undefined) line.heatOC = m.heatOC;
    return line;
  });

  return {
    items,
    fluids: [...pack.fluids.values()].map((f) => ({ id: f.id, dn: f.name, temp: f.temperature, gas: f.gas })),
    oreDict: [...pack.oreDict].map(([ore, keys]) => ({ ore, items: keys.map(item) })),
    recipeMaps, recipesGt, recipesCrafting, recipesFurnace, machines,
    ...worldgenLines(pack),
  };
}

function gtRecipeLine(r: Recipe, pack: Pack, mapIndex: ReadonlyMap<string, number>, item: (key: ItemKey) => number): GtRecipeLine {
  const [mapId, ...moreMaps] = r.maps;
  const info = mapId === undefined || moreMaps.length > 0 ? undefined : pack.maps.get(mapId);
  const map = info === undefined ? undefined : mapIndex.get(info.id);
  if (info === undefined || map === undefined) unsupported(`recipe ${r.id} on maps ${r.maps.join(', ')} (one declared GT map each)`);
  if (r.amps !== info.amps) unsupported(`recipe ${r.id} at ${r.amps} A (GT recipes take their map's amps)`);

  const line: GtRecipeLine = { map, in: [], out: [], fin: [], fout: [], eut: r.euPerTick, dur: r.durationTicks };
  const inAlt: Array<ItemSlot[] | null> = [];
  const finAlt: Array<FluidSlot[] | null> = [];
  for (const ing of r.inputs) {
    const [first, ...alts] = ing.options;
    if (first === undefined) unsupported(`an input of recipe ${r.id} without options`);
    if (ing.slot >= FLUID_SLOT_BASE) {
      line.fin.push(wireSlot(fluidName(first.key), first.amount, ing.consumed, ing.chance));
      finAlt.push(alts.length === 0 ? null : alts.map((o) => wireSlot(fluidName(o.key), o.amount, true, 1)));
    } else {
      line.in.push(wireSlot(item(first.key), first.amount, ing.consumed, ing.chance));
      inAlt.push(alts.length === 0 ? null : alts.map((o) => wireSlot(item(o.key), o.amount, true, 1)));
    }
  }
  if (inAlt.some((a) => a !== null)) line.inAlt = inAlt;
  if (finAlt.some((a) => a !== null)) line.finAlt = finAlt;
  for (const p of r.outputs) {
    if (isFluidKey(p.key)) line.fout.push(productSlot(fluidName(p.key), p));
    else line.out.push(productSlot(item(p.key), p));
  }

  if (r.specialValue !== 0) line.sv = r.specialValue;
  const meta: Record<string, MetaValue> = {};
  for (const [key, value] of Object.entries(r.meta)) {
    if (key === 'circuit') continue;   // the loader reads it off the programmed circuit input (mini-gt.ts)
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') unsupported(`meta ${key} of recipe ${r.id}`);
    meta[(Object.hasOwn(META_IDS, key) ? META_IDS[key] : undefined) ?? key] = value;
  }
  if (Object.keys(meta).length > 0) line.meta = meta;
  if (r.category !== undefined) line.cat = r.category;
  for (const [flag, value] of Object.entries(r.flags)) {
    if (value === undefined || value === false) continue;
    if (flag === 'hidden') line.hidden = true;
    else if (flag === 'fake') line.fake = true;
    else unsupported(`flag ${flag} of recipe ${r.id}`);
  }
  return line;
}

/** A shapeless crafting-table recipe: every input item takes a slot of its own. */
function craftingLine(r: Recipe, item: (key: ItemKey) => number): CraftingLine {
  if (r.euPerTick !== 0 || r.durationTicks !== 0 || r.amps !== 0 || r.specialValue !== 0 || Object.keys(r.meta).length > 0 || Object.keys(r.flags).length > 0 || r.category !== undefined) {
    unsupported(`crafting recipe ${r.id} with EU, time, meta, flags or a category`);
  }
  const slots: CraftingSlot[] = r.inputs.flatMap((ing): CraftingSlot[] => {
    // A crafting slot is not consumed only when it holds a tool by its tool ore name, which Mini-GT has none of.
    if (!ing.consumed || ing.chance !== 1) unsupported(`a not-consumed or chanced input of crafting recipe ${r.id}`);
    if (ing.options.some((o) => isFluidKey(o.key))) unsupported(`a fluid input of crafting recipe ${r.id}`);
    const [only] = ing.options;
    if (ing.options.length === 1 && only !== undefined && Number.isInteger(only.amount)) return Array.from({ length: only.amount }, () => item(only.key));
    if (ing.options.some((o) => o.amount !== 1)) unsupported(`an input of crafting recipe ${r.id} with options of several items`);
    return [ing.options.map((o) => item(o.key))];
  });
  const out = onlyOutput(r);
  return { cls: SHAPELESS_CLASS, shape: 'shapeless', in: slots, out: [item(out.key), out.amount] };
}

function furnaceLine(r: Recipe, item: (key: ItemKey) => number): FurnaceLine {
  if (r.euPerTick !== 0 || r.durationTicks !== VANILLA_FURNACE_TICKS || r.amps !== 0) unsupported(`smelting recipe ${r.id} other than 0 EU/t for ${VANILLA_FURNACE_TICKS} t`);
  const out = onlyOutput(r);
  const xp = r.meta.xp;
  return { in: item(onlyInput(r)), out: [item(out.key), out.amount], xp: typeof xp === 'number' ? xp : 0 };
}

/** A derived electric-furnace (or microwave) recipe becomes the `ef` (`mw`) result of the smelting line it derives from. */
function addDerived(r: Recipe, furnace: FurnaceLine[], item: (key: ItemKey) => number): void {
  const map = r.maps[0] ?? '';
  const rule = Object.hasOwn(DERIVED_FROM_FURNACE, map) ? DERIVED_FROM_FURNACE[map] : undefined;
  if (rule === undefined || r.maps.length !== 1 || r.euPerTick !== rule.euPerTick || r.durationTicks !== rule.durationTicks) {
    unsupported(`derived recipe ${r.id} (GT derives only ${Object.keys(DERIVED_FROM_FURNACE).join(', ')} recipes, at fixed EU/t and time)`);
  }
  const input = item(onlyInput(r));
  const smelting = furnace.find((f) => f.in === input && f[rule.from] === undefined);
  if (smelting === undefined) unsupported(`derived recipe ${r.id} without a smelting recipe of the same input`);
  const out = onlyOutput(r);
  smelting[rule.from] = [item(out.key), out.amount];
}

type WorldgenFiles = Pick<ExportSpec, 'dimensions' | 'celestial' | 'oreVeins' | 'smallOres' | 'undergroundFluids' | 'materials' | 'oreMaterials'>;

/** Dimensions (planets and moons with their celestial body), veins, underground fluids, materials and their ore keys. */
function worldgenLines(pack: Pack): WorldgenFiles {
  const { dimensions, veins, fluidSources, capabilities, byproducts } = pack.worldgen;
  if (capabilities.length > 0) unsupported(`capability ${capabilities[0]?.key}`);

  const dimensionLines: DimensionLine[] = [];
  const celestial: CelestialLine[] = [];
  for (const d of dimensions) {
    const tableTier = (Object.hasOwn(TIER_DEFAULTS, d.key) ? TIER_DEFAULTS[d.key]?.tier : undefined) ?? UNKNOWN_DIM_TIER;
    if (dimKey(d.key) !== d.key) unsupported(`dimension key ${d.key} (a GT ore-gen name in lower case without spaces)`);
    if (d.defaultTier !== tableTier) unsupported(`default tier ${d.defaultTier} of dimension ${d.key} (the loader's tier table says ${tableTier})`);
    const line: DimensionLine = { id: d.id, name: d.key, display: d.name, mod: d.mod };
    if (d.kind === 'planet' || d.kind === 'moon') {
      line.body = d.key;
      celestial.push({ name: d.key, display: d.name, kind: d.kind, tier: d.rocketTier ?? 0, dim: d.id, reachable: true });
    } else if (d.kind === 'asteroids') {
      line.ore = { type: 'Asteroid', voidMinable: false };
    } else if (d.kind !== 'dimension') {
      unsupported(`dimension kind ${d.kind} (${d.key})`);
    }
    if (d.rocketTier !== undefined && line.body === undefined) unsupported(`the rocket tier of ${d.key}, which is no planet or moon`);
    dimensionLines.push(line);
  }

  const oreVeins: OreVeinLine[] = [];
  const smallOres: SmallOreLine[] = [];
  for (const v of veins) {
    if (v.kind === 'small') {
      smallOres.push({ name: v.name, amount: v.weight, y: [v.minY, v.maxY], dims: [...v.dims], material: materialKey(v.materials.primary) });
      continue;
    }
    const { primary, secondary, between, sporadic } = v.materials;
    oreVeins.push({
      name: v.name, weight: v.weight, density: v.density, size: v.size, dims: [...v.dims],
      yByDim: Object.fromEntries(v.dims.map((dim) => [dim, [v.minY, v.maxY]])),
      primary: materialKey(primary), secondary: materialKey(secondary), between: materialKey(between), sporadic: materialKey(sporadic),
      stoneSpecific: false,
    });
  }

  const undergroundFluids: UndergroundFluidLine[] = fluidSources.map((s) => {
    if (s.kind !== 'underground' || s.minTier !== CAPABILITY_MIN_TIER.undergroundFluid) unsupported(`fluid source ${s.kind} of ${s.fluid} from tier ${s.minTier}`);
    const ids = s.dims.map((key) => dimensions.find((d) => d.key === key)?.id ?? unsupported(`underground ${s.fluid} in ${key}, which has no dimension id`));
    return { key: s.dims.join('+'), dims: ids, fluids: [{ fluid: fluidName(s.fluid), chance: 100, min: 1, max: 1, decrease: 0 }] };
  });

  const veinMaterials = new Set(veins.flatMap((v) => Object.values(v.materials)));
  for (const name of [...veinMaterials, ...Object.keys(byproducts)]) {
    if (!pack.materials.has(name) || !veinMaterials.has(name)) unsupported(`material ${name} (veins name item materials, and byproducts vein materials)`);
  }
  return {
    dimensions: dimensionLines, celestial, oreVeins, smallOres, undergroundFluids,
    materials: [...pack.materials.values()].map((m) => ({ name: m.name, rgba: [...m.rgba], iconSet: m.iconSet, byproducts: [...m.oreByproducts] })),
    oreMaterials: [...veinMaterials].map((name) => ({
      key: materialKey(name), family: 'gt', name, byproducts: (pack.materials.get(name)?.oreByproducts ?? []).map(materialKey), parts: {},
    })),
  };
}

/**
 * The pack the e2e server plans with: Mini-GT plus crafting recipes for its Advanced Bending Machine (102: an LV hull and
 * 4 circuits, as plan 12's Task 3 tests make it) and its Basic Electric Furnace (151: an LV hull, 2 circuits and 2 tin
 * cables, as the sand fixture makes it). Plan 12 never plans a machine no recipe makes as a new one (controller Amendment
 * OQ3): plan.spec.ts's impossible target (Titanium Plate at MV) is about the titanium the Moon holds, not about the
 * bender, and flow-focus.spec.ts's "Make it here instead" on Iron Ingot is about the furnace step it adds (ruling P4).
 */
const E2E_PACK: PackSpec = {
  ...MINI_GT,
  recipes: [
    ...(MINI_GT.recipes ?? []),
    { id: 'make-102', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 4]], out: [['machine:102@0', 1]] },
    { id: 'make-151', map: 'crafting', in: [['t:hull_lv@0', 1], ['t:circuit@0', 2], ['t:tin_cable@0', 2]], out: [['machine:151@0', 1]] },
  ],
};

/** Removes and recreates data/e2e: the e2e pack's export `e2e` with the line parts, and the config the e2e server starts with. */
async function main(): Promise<void> {
  await rm('data/e2e', { recursive: true, force: true });
  await mkdir('data/e2e', { recursive: true });
  await makeExport('data/e2e/export/e2e', withLineParts(toExportSpec(E2E_PACK)));
  saveConfig({
    port: 18787, host: '127.0.0.1', dataDir: 'data/e2e', serverFolder: null, activeExportId: 'e2e',
    passwordHash: hashPassword(E2E_PASSWORD), sessionSecret: newSessionSecret(),
  }, 'data/e2e/config.json');
  await prepareAssets('data/e2e', 'data/e2e/export/e2e');
}

if (import.meta.main) await main();
