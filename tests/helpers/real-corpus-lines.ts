// The real-data corpus of the layout's hatch checks (research hatch-rules.md §3): every line the planner's real-data
// tests plan, as settings only (no world). real-corpus.test.ts's 16 targets in its three variants; the further lines of
// real-acceptance.test.ts, with its pinned option and recipe and its avoid lists (its LV Machine Hull at LV is the
// corpus's LV Machine Hull per minute with supporting lines, so it is not listed twice, and its Aluminium Ingot at LV
// plans nothing: `infeasible`); and real-user-project.test.ts's stored settings, per hour, per minute, with supporting
// lines and for an Advanced Circuit. Pack keys and settings only, never anything from a world.

import { defaultSettings, normalizeSettings } from '../../src/shared/project/apply-op.ts';
import type { PlanSettings } from '../../src/shared/types/plan.ts';

export interface CorpusLine {
  name: string;
  settings: PlanSettings;
  /** The planner finds no way at this tier (real-acceptance.test.ts expects `infeasible`): nothing to lay out. */
  infeasible?: true;
}

/** real-corpus.test.ts's 16 targets at their natural tiers (name, key, tier, amount). */
const TARGETS: ReadonlyArray<readonly [string, string, number, number]> = [
  ['Electronic Circuit', 'IC2:itemPartCircuit@0', 1, 1], ['Good Electronic Circuit', 'gregtech:gt.metaitem.01@32702', 2, 1],
  ['Integrated Logic Circuit', 'gregtech:gt.metaitem.01@32701', 2, 1], ['Advanced Circuit', 'IC2:itemPartCircuitAdv@0', 3, 1],
  ['Vacuum Tube', 'gregtech:gt.metaitem.01@32700', 1, 1], ['Resistor', 'gregtech:gt.metaitem.01@32716', 1, 1],
  ['Glass Tube', 'gregtech:gt.metaitem.03@32012', 1, 1], ['Circuit Board', 'gregtech:gt.metaitem.03@32100', 1, 1],
  ['LV Machine Hull', 'gregtech:gt.blockmachines@11', 1, 1], ['MV Machine Hull', 'gregtech:gt.blockmachines@12', 2, 1],
  ['Electric Motor (LV)', 'gregtech:gt.metaitem.01@32600', 1, 1], ['Electric Pump (LV)', 'gregtech:gt.metaitem.01@32610', 1, 1],
  ['Robot Arm (LV)', 'gregtech:gt.metaitem.01@32650', 1, 1], ['Robot Arm (MV)', 'gregtech:gt.metaitem.01@32651', 2, 1],
  ['Polyethylene (PE) Bar', 'gregtech:gt.metaitem.01@11874', 1, 1], ['Steel Ingot', 'gregtech:gt.metaitem.01@11305', 1, 10],
];
/** real-corpus.test.ts's three variants of every target. */
const VARIANTS = [
  { label: 'per minute', per: 'min', routeDerived: false }, { label: 'per hour', per: 'hour', routeDerived: false },
  { label: 'per minute with supporting lines', per: 'min', routeDerived: true },
] as const;

const EC = 'IC2:itemPartCircuit@0', GEC = 'gregtech:gt.metaitem.01@32702', AC = 'IC2:itemPartCircuitAdv@0';
const STEEL = 'gregtech:gt.metaitem.01@11305', ALUMINIUM = 'gregtech:gt.metaitem.01@11019', MICROPROCESSOR = 'gregtech:gt.metaitem.03@32078';
const LV_HULL = 'gregtech:gt.blockmachines@11';
/** real-acceptance.test.ts's Electronic Circuit circuit assembler recipe and its solder slot. */
const EC_CIRCUIT_ASSEMBLER = 'c0106c4cb6b4b041';
const SOLDER_SLOT = 100;

/** real-acceptance.test.ts's lines, per minute over the defaults, but the corpus's LV Machine Hull at LV. */
const ACCEPTANCE: ReadonlyArray<readonly [string, Partial<PlanSettings>, boolean?]> = [
  ['Electronic Circuit at MV', { target: EC, amount: 1, tier: 2 }],
  ['Electronic Circuit at MV with Molten Tin pinned', { target: EC, amount: 1, tier: 2, optionChoice: { [`${EC_CIRCUIT_ASSEMBLER}#${SOLDER_SLOT}`]: 'fluid:molten.tin' } }],
  ['2 Good Electronic Circuits at HV', { target: GEC, amount: 2, tier: 3 }],
  ["Electronic Circuit at MV on GTNH's own recipe", { target: EC, amount: 1, tier: 2, recipeChoice: { [EC]: EC_CIRCUIT_ASSEMBLER } }],
  ['Steel Ingot at MV without supporting lines', { target: STEEL, amount: 10, tier: 2, routeDerived: false }],
  ['Steel Ingot at MV', { target: STEEL, amount: 10, tier: 2 }],
  ['Aluminium Ingot at HV', { target: ALUMINIUM, amount: 10, tier: 3 }],
  ['Aluminium Ingot at LV', { target: ALUMINIUM, amount: 10, tier: 1 }, true],
  ['Advanced Circuit at HV without a step charge', { target: AC, amount: 1, tier: 3, stepCharge: 0 }],
  ['2 Good Electronic Circuits at HV avoiding Silver', { target: GEC, amount: 2, tier: 3, avoid: ['Silver'] }],
  ['2 Good Electronic Circuits at HV avoiding Gold', { target: GEC, amount: 2, tier: 3, avoid: ['Gold'] }],
  ['2 Microprocessors at HV avoiding Diamond', { target: MICROPROCESSOR, amount: 2, tier: 3, avoid: ['Diamond'] }],
  ['2 Good Electronic Circuits at HV avoiding Calcite without a step charge', { target: GEC, amount: 2, tier: 3, avoid: ['Calcite'], stepCharge: 0 }],
  ['LV Machine Hull at LV avoiding Steel', { target: LV_HULL, amount: 1, tier: 1, avoid: ['Steel'] }],
  ['2 Good Electronic Circuits at HV avoiding Copper without supporting lines', { target: GEC, amount: 2, tier: 3, avoid: ['Copper'], routeDerived: false }],
];

/** real-user-project.test.ts's stored settings (2026-10-18), verbatim. */
const STORED: Partial<PlanSettings> = {
  target: EC, mode: 'rate', amount: 1, per: 'hour', tier: 2, dims: { policy: 'progression', overrides: {} },
  routeDerived: false, logistics: 'routed', costOverrides: {}, stopItems: [], expandItems: [],
  recipeChoice: { 'fluid:glue': '98f259e40a64e8b0', 'gregtech:gt.metaitem.01@32716': '0a074f4241a9e0f9' }, machineTier: {},
  excludedCategories: ['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion'],
  coilHeat: null, automateCrafting: false, declineReuse: [],
};

/** The corpus, in the order above: 48 + 15 + 4 lines. */
export function realCorpusLines(): CorpusLine[] {
  const out: CorpusLine[] = [];
  for (const [name, target, tier, amount] of TARGETS) {
    for (const v of VARIANTS) out.push({ name: `${name} ${v.label}`, settings: { ...defaultSettings(), target, amount, per: v.per, tier, routeDerived: v.routeDerived } });
  }
  for (const [name, s, infeasible] of ACCEPTANCE) {
    out.push({ name, settings: { ...defaultSettings(), per: 'min', ...s }, ...(infeasible === true ? { infeasible: true as const } : {}) });
  }
  const user = normalizeSettings(STORED);
  out.push({ name: "the user's Electronic Circuit project", settings: user });
  out.push({ name: "the user's project per minute", settings: { ...user, per: 'min' } });
  out.push({ name: "the user's project with supporting lines", settings: { ...user, routeDerived: true } });
  out.push({ name: "the user's project for an Advanced Circuit", settings: { ...user, target: AC, tier: 3, stepCharge: 0 } });
  return out;
}
