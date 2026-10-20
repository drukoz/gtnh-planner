// GregTech's own hatch rules from the export (exporter 0.6.0, architecture §11.49; research gt-mechanics.md §5.5): a
// structure's `elements` name the hatch kinds GT's structure check took on each element of its definition and the
// cells each element checked. Here they become what the layout reads: each covered cell's element character, each
// character's layout hatch kinds (`KIND_SOURCES`), the cells of a tower built taller than exported, the power the
// export implies and the steam bus classes. A structure without `elements` was not probed and has no rules here, which
// never reads as "takes no hatch"; a cell no element holds (GT's check never reached it, or two elements checked it)
// is not covered and takes none. Positions are in the frame of the exported structure, as the unit's shape is.

import { EXPORT_HATCH_CLASSES, EXPORT_HATCH_KINDS, type ExportHatchKind } from '../../shared/gt/hatch-kinds.ts';
import { posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { HatchKind } from '../../shared/types/layout.ts';
import type { Machine } from '../../shared/types/pack.ts';
import type { RulePower } from './hatch-rules.ts';

/** The export kinds that give each layout kind, best first (architecture §11.49). */
export const KIND_SOURCES: Readonly<Record<HatchKind, readonly ExportHatchKind[]>> = {
  input_bus: ['input_bus', 'steam_input_bus'], output_bus: ['output_bus', 'steam_output_bus'], input_hatch: ['input_hatch'],
  output_hatch: ['output_hatch'], energy: ['energy'], maintenance: ['maintenance'], muffler: ['muffler'], steam: ['steam_hatch'],
};

/** The layout kinds in `KIND_SOURCES` order. */
const LAYOUT_KINDS = Object.keys(KIND_SOURCES) as HatchKind[];

/** A multiblock's hatch rules from the export, cell by cell. */
export interface ExportedCells {
  /** posKey → the character of the element GT checked the cell with: its `ch`, else `#<element index>`. */
  charOf: ReadonlyMap<string, string>;
  /** Character → the layout kinds one of its element's export kinds gives (`KIND_SOURCES`). */
  takes: ReadonlyMap<string, ReadonlySet<HatchKind>>;
  /** Every export kind some element takes. */
  anywhere: ReadonlySet<ExportHatchKind>;
  /** A steam bus's class for a bus kind no element takes as the plain bus but one takes as the steam bus. */
  classes: Partial<Record<'input_bus' | 'output_bus', string>>;
  /** The exported structure's height. */
  height: number;
}

/** `m`'s hatch rules from the export; null for a structure without `elements` (an older export, an unprobed machine). */
export function exportedCells(m: Machine): ExportedCells | null {
  const st = m.structure;
  const elements = st?.elements;
  if (st === undefined || elements === undefined) return null;
  const charOf = new Map<string, string>();
  const takes = new Map<string, ReadonlySet<HatchKind>>();
  elements.forEach((element, k) => {
    const ch = element.ch ?? `#${k}`;
    const kinds = LAYOUT_KINDS.filter((kind) => KIND_SOURCES[kind].some((source) => element.hatches.includes(source)));
    // one character is one element of GT's definition; were two elements to share one, its cells take what both take
    const before = takes.get(ch);
    takes.set(ch, new Set(before === undefined ? kinds : kinds.filter((kind) => before.has(kind))));
    for (const cell of element.cells) charOf.set(posKey(cell), ch);
  });
  const anywhere = new Set(EXPORT_HATCH_KINDS.filter((kind) => elements.some((e) => e.hatches.includes(kind))));
  const classes: ExportedCells['classes'] = {};
  if (!anywhere.has('input_bus') && anywhere.has('steam_input_bus')) classes.input_bus = EXPORT_HATCH_CLASSES.steam_input_bus.cls;
  if (!anywhere.has('output_bus') && anywhere.has('steam_output_bus')) classes.output_bus = EXPORT_HATCH_CLASSES.steam_output_bus.cls;
  return { charOf, takes, anywhere, classes, height: st.size[1] };
}

/**
 * The cells of a tower grown by `extra` layers, as `growLayers` grows its shape: rows below the top keep their
 * character, the top moves up by `extra`, each inserted layer copies layer 1. `extra` ≤ 0 or a structure under 3 high:
 * `cells` unchanged.
 */
export function grownCells(cells: ExportedCells, extra: number): ExportedCells {
  const h = cells.height;
  if (extra <= 0 || h < 3) return cells;
  const charOf = new Map<string, string>();
  const layerOne: Array<[x: number, z: number, ch: string]> = [];
  for (const [key, ch] of cells.charOf) {
    const [x, y, z] = key.split(',').map(Number) as Vec3;
    charOf.set(y === h - 1 ? posKey([x, y + extra, z]) : key, ch);
    if (y === 1) layerOne.push([x, z, ch]);
  }
  for (let k = 0; k < extra; k++) for (const [x, z, ch] of layerOne) charOf.set(posKey([x, h - 1 + k, z]), ch);
  return { ...cells, charOf, height: h + extra };
}

const EU_KINDS: readonly ExportHatchKind[] = ['energy', 'energy_multi', 'energy_laser'];
const STEAM_KINDS: readonly ExportHatchKind[] = ['steam_hatch', 'steam_input_bus', 'steam_output_bus'];

/** The power the export implies: EU where an element takes an energy hatch of any kind, else steam where one takes a steam hatch or bus, else none. */
export function exportedPower(cells: ExportedCells): RulePower {
  if (EU_KINDS.some((kind) => cells.anywhere.has(kind))) return 'eu';
  return STEAM_KINDS.some((kind) => cells.anywhere.has(kind)) ? 'steam' : 'none';
}
