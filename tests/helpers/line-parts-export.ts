// The layout fixtures' line parts as export rows (Plan 5 Task 16, architecture §10): the transformers, hatches, cables
// and wires, pipes, boiler and turbines of `addLineParts`, each with its item, and the part items (covers, chest,
// Project Red, AE2 and EnderIO parts), written as Plan 1 export lines. Plan 1's loader turns them back into exactly the
// fixture values (tests/unit/layout/fixtures.test.ts), so the e2e export lays a line out the way the unit tests do.
// The rows are read off `addLineParts(emptyPack())`, so the fixture table stays the one source.

import type { ItemLine, MachineLine } from '../../src/server/pack/format.ts';
import { parseItemKey } from '../../src/shared/keys.ts';
import type { Machine } from '../../src/shared/types/pack.ts';
import { addLineParts, emptyPack } from './layout-fixtures.ts';
import type { ExportSpec } from './make-export.ts';

/** The loader reads an item pipe as `slots × 20 / tickTime` stacks per second, so 20 ticks keep `slots` = stacks/s. */
const ITEM_PIPE_TICK_TIME = 20;
/** Fluid pipe fields the loader does not read (one pipe per block). */
const FLUID_PIPE_REST = { pipes: 1, maxTemp: 2000, gasProof: true } as const;

function machineLine(m: Machine, item: number): MachineLine {
  const line: MachineLine = { id: m.mteId, name: m.metaName, cls: m.cls, dn: m.name, item, kind: m.kind, maps: [...m.maps] };
  if (m.tier !== undefined) line.tier = m.tier;
  if (m.cable !== undefined) line.cable = { ...m.cable };
  if (m.fluidPipe !== undefined) line.fluidPipe = { capacityPerSecond: m.fluidPipe.litresPerSecond, ...FLUID_PIPE_REST, material: m.fluidPipe.material };
  if (m.itemPipe !== undefined) {
    line.itemPipe = { slots: m.itemPipe.stacksPerSecond, tickTime: ITEM_PIPE_TICK_TIME, stepSize: 1, restrictive: false, material: m.itemPipe.material };
  }
  if (m.steamPerSecondMax !== undefined) line.steamPerSecondMax = m.steamPerSecondMax;
  return line;
}

/**
 * `spec` plus the line parts: their item lines after `spec.items` and their machine lines after `spec.machines`.
 * Nothing else changes. A machine id or item key the spec already has makes the loader warn (the first line wins).
 */
export function withLineParts(spec: ExportSpec): ExportSpec {
  if ((spec.rawLines?.items?.length ?? 0) > 0) throw new Error('withLineParts: raw item lines would move to other item indices');
  const parts = addLineParts(emptyPack());
  const items: Array<Omit<ItemLine, 'i'>> = [...(spec.items ?? [])];
  const indexOf = new Map<string, number>();
  for (const item of parts.items.values()) {
    const { id, meta } = parseItemKey(item.key);
    indexOf.set(item.key, items.push({ id, m: meta, dn: item.name }) - 1);
  }
  const machines = [...parts.machines.values()].map((m) => machineLine(m, indexOf.get(m.itemKey)!));
  return { ...spec, items, machines: [...(spec.machines ?? []), ...machines] };
}
