// The slice of the pack a world scan needs (architecture §6.2, §11.5, §11.19): what each GT mID is, the dimensions and
// the battery capacities. Only Maps, arrays and plain objects, so it reaches the scan worker by structured clone.
// Architecture §11.19: `Machine.cls` is the fully qualified Java class name, so every class check compares
// `simpleClassName(cls)`, never the raw `cls`.

import type { ItemKey } from '../../shared/keys.ts';
import type { DimensionInfo, Machine, Pack } from '../../shared/types/pack.ts';

/** A machine as the scan needs it: the export entry without its multiblock structure. */
export type FactMachine = Omit<Machine, 'structure'>;

export interface ScanPackFacts {
  /** The export the facts come from; null when the scan runs without one. */
  exportId: string | null;
  /** Export entries by mID; an mID that is missing is unknown to the export. */
  machines: Map<number, FactMachine>;
  dimensions: DimensionInfo[];
  /** IC2 electric items (batteries) by item key, from `Item.electric`: capacity in EU and voltage tier. */
  electric: Map<ItemKey, { maxCharge: number; tier: number }>;
}

/** The text after the last `.` (the whole string when it has none); null for null, undefined, '' or a trailing dot. */
export function simpleClassName(cls: string | null | undefined): string | null {
  if (cls === null || cls === undefined) return null;
  const name = cls.slice(cls.lastIndexOf('.') + 1);
  return name === '' ? null : name;
}

/** An energy hatch, tested only as `ENERGY_HATCH_RE.test(simpleClassName(cls) ?? '')` on export kind `hatch`. */
export const ENERGY_HATCH_RE = /Energy/;

/** Facts that know nothing: every mID is unknown, no dimension or battery is named. */
export function emptyFacts(): ScanPackFacts {
  return { exportId: null, machines: new Map(), dimensions: [], electric: new Map() };
}

/** The facts of `pack` (`emptyFacts()` without one). */
export function packFacts(pack: Pack | null): ScanPackFacts {
  if (pack === null) return emptyFacts();
  const machines = new Map<number, FactMachine>();
  for (const [mteId, { structure: _structure, ...machine }] of pack.machines) machines.set(mteId, machine);
  const electric = new Map<ItemKey, { maxCharge: number; tier: number }>();
  for (const [key, item] of pack.items) {
    if (item.electric !== undefined) electric.set(key, { maxCharge: item.electric.maxCharge, tier: item.electric.tier });
  }
  return { exportId: pack.manifest.exportId, machines, dimensions: [...pack.worldgen.dimensions], electric };
}
