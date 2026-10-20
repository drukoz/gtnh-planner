// The plan 09 corpus (fix spec §7.2): 16 targets at their natural tiers and the three variants each is planned in,
// shared by the real-data tests that plan it (tests/unit/planner/real-corpus.test.ts, the planner's invariants;
// tests/unit/layout/real-hatch-export.test.ts, the layout's hatches by the export's rules). Pack keys and settings
// only, never anything from a world.

import type { StuffKey } from '../../src/shared/keys.ts';

export interface Target { name: string; key: StuffKey; tier: number; amount: number }
/** The 16 targets of fix spec §7.2 and their natural tiers on the 2.9 export (LV 1, MV 2, HV 3). */
export const CORPUS: readonly Target[] = [
  { name: 'Electronic Circuit', key: 'IC2:itemPartCircuit@0', tier: 1, amount: 1 },
  { name: 'Good Electronic Circuit', key: 'gregtech:gt.metaitem.01@32702', tier: 2, amount: 1 },
  { name: 'Integrated Logic Circuit', key: 'gregtech:gt.metaitem.01@32701', tier: 2, amount: 1 },
  { name: 'Advanced Circuit', key: 'IC2:itemPartCircuitAdv@0', tier: 3, amount: 1 },
  { name: 'Vacuum Tube', key: 'gregtech:gt.metaitem.01@32700', tier: 1, amount: 1 },
  { name: 'Resistor', key: 'gregtech:gt.metaitem.01@32716', tier: 1, amount: 1 },
  { name: 'Glass Tube', key: 'gregtech:gt.metaitem.03@32012', tier: 1, amount: 1 },
  { name: 'Circuit Board', key: 'gregtech:gt.metaitem.03@32100', tier: 1, amount: 1 },
  { name: 'LV Machine Hull', key: 'gregtech:gt.blockmachines@11', tier: 1, amount: 1 },
  { name: 'MV Machine Hull', key: 'gregtech:gt.blockmachines@12', tier: 2, amount: 1 },
  { name: 'Electric Motor (LV)', key: 'gregtech:gt.metaitem.01@32600', tier: 1, amount: 1 },
  { name: 'Electric Pump (LV)', key: 'gregtech:gt.metaitem.01@32610', tier: 1, amount: 1 },
  { name: 'Robot Arm (LV)', key: 'gregtech:gt.metaitem.01@32650', tier: 1, amount: 1 },
  { name: 'Robot Arm (MV)', key: 'gregtech:gt.metaitem.01@32651', tier: 2, amount: 1 },
  { name: 'Polyethylene (PE) Bar', key: 'gregtech:gt.metaitem.01@11874', tier: 1, amount: 1 },
  { name: 'Steel Ingot', key: 'gregtech:gt.metaitem.01@11305', tier: 1, amount: 10 },
];
/** The three variants of every target (fix spec §7.2). */
export const VARIANTS = [
  { label: 'per minute', per: 'min', routeDerived: false },
  { label: 'per hour', per: 'hour', routeDerived: false },
  { label: 'per minute with supporting lines', per: 'min', routeDerived: true },
] as const;
