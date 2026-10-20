// Machine and structure converters (architecture §6.2, §11.4): the lines of machines.jsonl.gz and structures.jsonl.gz
// become `Machine`s and their `StructureInfo`, plus the pseudo machines of the crafting table and the vanilla furnace.
//
// Item indices go through `LoadContext.items`, which throws for an index the export does not have; `buildPack` turns
// whatever a converter throws into an `ExportFormatError` with the file and line.

import { isExportHatchKind } from '../../shared/gt/hatch-kinds.ts';
import { PSEUDO_MACHINES } from '../../shared/gt/tiers.ts';
import { itemKey, type ItemKey } from '../../shared/keys.ts';
import type { BlockRef, Machine, StructureElement, StructureInfo } from '../../shared/types/pack.ts';
import { EXPORT_FILES, type MachineLine, type StructureLine } from './format.ts';
import type { LoadContext } from './load.ts';
import { normalizeMapId } from './map-aliases.ts';

/** GT maps that show assembly-line recipes; a machine with one of them also runs the data-stick recipes of 'assemblyline'. */
export const ASSEMBLY_LINE_VIEW_MAPS: readonly string[] = Object.freeze(['gt.recipe.fakeAssemblylineProcess']);

/** The pseudo map of the data-stick assembly-line recipes (load.ts `PSEUDO_MAPS`). */
const ASSEMBLY_LINE_MAP = 'assemblyline';
/** The block every GT machine item belongs to; its meta is the MTE id. */
const GT_MACHINE_BLOCK = 'gregtech:gt.blockmachines';
/** Item pipes move `slots` stacks every `tickTime` ticks. */
const TICKS_PER_SECOND = 20;
/**
 * GT's names of battery buffers (plan 10, ruling R10): `batterybuffer.<slots>.tier.<tier>`, and
 * `batterycharger.16.tier.<tier>` and `batteryturbocharger.16.tier.<tier>` for the chargers. Group 1 is the family
 * (`buffer`, `charger` or `turbocharger`), group 2 the number, a slot count only for `buffer` (ruling R16).
 */
const BATTERY_BUFFER_NAME_RE = /^battery(buffer|charger|turbocharger)\.(\d+)\.tier\.\d+$/;
/** The slots GT registers every charger and turbo charger with (`LoaderMetaTileEntities`); their 16 is not a slot count. */
const CHARGER_SLOTS = 4;

function pseudoMachine(mteId: number, metaName: string, name: string, key: ItemKey, map: string): Machine {
  return Object.freeze({ mteId, metaName, name, cls: 'pseudo', itemKey: key, kind: 'other', maps: [map] });
}

/**
 * The machines of the recipes that no GT machine runs: the crafting table (map 'crafting') and the vanilla furnace
 * (map 'furnace'). `PSEUDO_MACHINES.HAND` has no entry. The pack gets its own copies.
 */
export const PSEUDO_MACHINE_ENTRIES: readonly Machine[] = Object.freeze([
  pseudoMachine(PSEUDO_MACHINES.CRAFTING_TABLE, 'crafting_table', 'Crafting Table', 'minecraft:crafting_table@0', 'crafting'),
  pseudoMachine(PSEUDO_MACHINES.FURNACE, 'furnace', 'Furnace', 'minecraft:furnace@0', 'furnace'),
]);

/** Normalized map ids without duplicates, in first-seen order, plus 'assemblyline' when one of them is an assembly-line view map. */
function machineMaps(raw: readonly string[]): string[] {
  const maps = new Set(raw.map(normalizeMapId));
  if (ASSEMBLY_LINE_VIEW_MAPS.some((id) => maps.has(id))) maps.add(ASSEMBLY_LINE_MAP);
  return [...maps];
}

/**
 * The slots of a battery buffer exported with 0 (exporter 0.2.0 and older wrote the prototype's battery count, 0 for
 * every buffer; plan 10 Task 2): the count a `batterybuffer` metaName gives, `CHARGER_SLOTS` for a charger or turbo
 * charger, or 0 when the name gives none (TecTech's Tesla coils share one name across sizes); one warning either way.
 */
function slotsFromName(line: MachineLine, ctx: LoadContext): number {
  const m = BATTERY_BUFFER_NAME_RE.exec(line.name);
  if (m === null) {
    ctx.warn(`machine ${line.id} (${line.name}): the export gives 0 battery slots and its name does not tell how many, slots unknown`);
    return 0;
  }
  if (m[1] !== 'buffer') {
    ctx.warn(`machine ${line.id} (${line.name}): the export gives 0 battery slots, using ${CHARGER_SLOTS}, the slot count GT gives every charger`);
    return CHARGER_SLOTS;
  }
  const slots = Number(m[2]);
  ctx.warn(`machine ${line.id} (${line.name}): the export gives 0 battery slots, using ${slots} from its name`);
  return slots;
}

/**
 * A machine line: names, item, kind and maps, plus the stats the line has (pipe throughputs per second). A line whose
 * maps the exporter could not read warns and has no maps; a battery buffer exported with 0 slots takes them from its
 * name.
 */
export function toMachine(line: MachineLine, ctx: LoadContext): Machine {
  if (line.mapsError) ctx.warn(`machine ${line.id} (${line.name}): recipe maps unreadable: ${line.mapsError}`);
  const machine: Machine = {
    mteId: line.id, metaName: line.name, name: line.dn || line.name, cls: line.cls,
    itemKey: line.item == null ? itemKey(GT_MACHINE_BLOCK, line.id) : (ctx.items.optionsAt(line.item)[0] as ItemKey),
    kind: line.kind, maps: machineMaps(line.maps ?? []),
  };
  if (line.tier != null) machine.tier = line.tier;
  if (line.voltage != null) machine.voltage = line.voltage;
  if (line.amps != null) machine.amps = line.amps;
  if (line.cable) {
    const { voltage, amps, lossPerBlock, insulated, material } = line.cable;
    machine.cable = { voltage, amps, lossPerBlock, insulated, material: material ?? '' };
  }
  if (line.fluidPipe) machine.fluidPipe = { litresPerSecond: line.fluidPipe.capacityPerSecond, material: line.fluidPipe.material ?? '' };
  if (line.itemPipe) {
    const { slots, tickTime, material } = line.itemPipe;
    machine.itemPipe = { stacksPerSecond: (slots * TICKS_PER_SECOND) / tickTime, material: material ?? '' };
  }
  const { batterySlots } = line;
  if (batterySlots != null) machine.batterySlots = line.kind === 'battery_buffer' && batterySlots === 0 ? slotsFromName(line, ctx) : batterySlots;
  if (line.steamPerSecondMax != null) machine.steamPerSecondMax = line.steamPerSecondMax;
  if (line.turbineEfficiency != null) machine.turbineEfficiency = line.turbineEfficiency;
  if (line.perfectOC != null) machine.perfectOC = line.perfectOC;
  if (line.heatOC != null) machine.heatOC = line.heatOC;
  if (line.itemInSlots != null) machine.itemInSlots = line.itemInSlots;
  if (line.itemOutSlots != null) machine.itemOutSlots = line.itemOutSlots;
  return machine;
}

/**
 * The elements of a structure line with hatch rules (exporter 0.6.0+, the "Structure elements" rule of format.ts,
 * architecture §11.49): each keeps its character, the hatch kinds this planner knows in the line's order, and as
 * `cells` the positions of its blocks in block order. Kinds it does not know are dropped with one warning for the line
 * (line `n`), each named once in first-seen order. Throws for rules that do not fit the blocks: `elements` or
 * `elementOf` alone, an `elementOf` without exactly one value per block, a value that is neither -1 nor the index of
 * an element, and an element on the controller's block.
 */
function toElements(line: StructureLine, ctx: LoadContext, n: number): StructureElement[] {
  const { id, blocks, controller: [cx, cy, cz], elements: elementLines, elementOf } = line;
  if (elementLines == null) throw new RangeError(`structure ${id}: elementOf without elements`);
  if (elementOf == null) throw new RangeError(`structure ${id}: elements without elementOf`);
  if (elementOf.length !== blocks.length) throw new RangeError(`structure ${id}: elementOf has ${elementOf.length} values for ${blocks.length} blocks`);
  const unknown = new Set<string>();
  const elements = elementLines.map(({ ch, hatches }): StructureElement => {
    for (const kind of hatches) if (!isExportHatchKind(kind)) unknown.add(kind);
    const known = hatches.filter(isExportHatchKind);
    return ch == null ? { hatches: known, cells: [] } : { ch, hatches: known, cells: [] };
  });
  blocks.forEach(([x, y, z], i) => {
    const k = elementOf[i] as number;
    if (!Number.isInteger(k) || k < -1 || k >= elements.length) {
      throw new RangeError(`structure ${id}: elementOf[${i}] (the block at ${x},${y},${z}) is ${JSON.stringify(k)}, neither -1 nor the index of one of its ${elements.length} elements`);
    }
    if (k === -1) return;
    if (x === cx && y === cy && z === cz) throw new RangeError(`structure ${id}: elementOf[${i}] puts the controller's block at ${x},${y},${z} in element ${k}, it must be -1`);
    elements[k]!.cells.push([x, y, z]);
  });
  if (unknown.size > 0) ctx.warn(`${EXPORT_FILES.structures}:${n}: structure ${id}: hatch kinds unknown to this planner ignored: ${[...unknown].join(', ')}`);
  return elements;
}

/**
 * A structure line with its palette resolved: every block that names one palette entry shares one `BlockRef`. Throws
 * for a block whose palette index the line does not have. The caller warns about `truncated`. A line with hatch rules
 * (exporter 0.6.0+) also gets their `elements` (`toElements`; `n` is the line's number, for its warning); one without
 * has no `elements` key, so a structure the exporter did not probe never reads as one that takes no hatch.
 */
export function toStructure(line: StructureLine, ctx: LoadContext, n: number): StructureInfo {
  const palette = line.palette.map(({ id, meta, mte }): BlockRef => (mte == null ? { id, meta } : { id, meta, mteId: mte }));
  const structure: StructureInfo = {
    size: [...line.size], controller: [...line.controller],
    blocks: line.blocks.map(([x, y, z, p]) => {
      const block = palette[p];
      if (block === undefined) throw new RangeError(`structure ${line.id}: block at ${x},${y},${z} names palette entry ${p}, the palette has ${palette.length}`);
      return { pos: [x, y, z], block };
    }),
    air: line.air.map(([x, y, z]) => [x, y, z]),
  };
  if (line.truncated) structure.truncated = true;
  if (line.elements != null || line.elementOf != null) structure.elements = toElements(line, ctx, n);
  return structure;
}
