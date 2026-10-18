// Machine and structure converters (architecture §6.2, §11.4): the lines of machines.jsonl.gz and structures.jsonl.gz
// become `Machine`s and their `StructureInfo`, plus the pseudo machines of the crafting table and the vanilla furnace.
//
// Item indices go through `LoadContext.items`, which throws for an index the export does not have; `buildPack` turns
// whatever a converter throws into an `ExportFormatError` with the file and line.

import { PSEUDO_MACHINES } from '../../shared/gt/tiers.ts';
import { itemKey, type ItemKey } from '../../shared/keys.ts';
import type { BlockRef, Machine, StructureInfo } from '../../shared/types/pack.ts';
import type { MachineLine, StructureLine } from './format.ts';
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
 * A machine line: names, item, kind and maps, plus the stats the line has (pipe throughputs per second). A line whose
 * maps the exporter could not read warns and has no maps.
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
  if (line.batterySlots != null) machine.batterySlots = line.batterySlots;
  if (line.steamPerSecondMax != null) machine.steamPerSecondMax = line.steamPerSecondMax;
  if (line.turbineEfficiency != null) machine.turbineEfficiency = line.turbineEfficiency;
  if (line.perfectOC != null) machine.perfectOC = line.perfectOC;
  if (line.heatOC != null) machine.heatOC = line.heatOC;
  return machine;
}

/**
 * A structure line with its palette resolved: every block that names one palette entry shares one `BlockRef`. Throws
 * for a block whose palette index the line does not have. The caller warns about `truncated`.
 */
export function toStructure(line: StructureLine): StructureInfo {
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
  return structure;
}
