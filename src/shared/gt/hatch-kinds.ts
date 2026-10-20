// The hatch kinds the exporter probes on every element of a multiblock structure (exporter 0.6.0, architecture
// §11.49; the evidence is docs/research/gt-mechanics.md §5.5). A structure line's `elements[k].hatches` lists kinds in
// the order of EXPORT_HATCH_KINDS. The exporter's own table (`HatchKinds.ALL` in exporter-mod's export/sections) lists
// the same kinds, classes and metaName prefixes in the same order.
// - A kind is one GT hatch class, matched by its exact simple name, so a subclass is never its superclass's kind: the
//   steam buses (`MTEHatchSteamBusInput extends MTEHatchInputBus`, and GT's input-bus adder tests the steam bus first)
//   and the laser target hatch (`MTEHatchEnergyTunnel extends MTEHatchEnergyMulti`) are kinds of their own, and an ME
//   input bus is none.
// - Two kinds also need a metaName prefix. `MTEHatchCustomFluidBase` is the Steam Hatch and also the Cryotheum and
//   Pyrotheum hatches, so `steam_hatch` is only the one named `hatch.steam.…`. GT's plain dynamo adder takes any
//   `MTEHatchDynamo` of at most 4 A, multi-amp ones included, so `dynamo_multi` is only the 16 A ones
//   (`hatch.dynamomulti16.…`); `energy_multi` keeps every `MTEHatchEnergyMulti`, which no plain energy adder takes.
// - A kind's probe hatch is the lowest MTE id of its class (and prefix): a 4 A one for `energy_multi`, a 16 A one for
//   `dynamo_multi`.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

/** The 17 kinds of exporter 0.6.0, in the order a structure element lists them. */
export const EXPORT_HATCH_KINDS = ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'energy_multi', 'energy_laser',
  'maintenance', 'muffler', 'dynamo', 'dynamo_multi', 'dynamo_laser', 'steam_input_bus', 'steam_output_bus', 'steam_hatch',
  'data_access', 'coke_oven_hatch'] as const;
export type ExportHatchKind = (typeof EXPORT_HATCH_KINDS)[number];

/** Each kind as the planner's messages name it. */
export const EXPORT_HATCH_KIND_NAMES: Readonly<Record<ExportHatchKind, string>> = Object.freeze({
  input_bus: 'input bus', output_bus: 'output bus', input_hatch: 'input hatch', output_hatch: 'output hatch',
  energy: 'energy hatch', energy_multi: 'multi-amp energy hatch (4 A)', energy_laser: 'laser target hatch',
  maintenance: 'maintenance hatch', muffler: 'muffler hatch', dynamo: 'dynamo hatch',
  dynamo_multi: 'multi-amp dynamo hatch (16 A)', dynamo_laser: 'laser source hatch',
  steam_input_bus: 'steam input bus', steam_output_bus: 'steam output bus', steam_hatch: 'steam hatch',
  data_access: 'data access hatch', coke_oven_hatch: 'Coke Oven Hatch',
});

function hatchClass(cls: string, metaPrefix?: string): { cls: string; metaPrefix?: string } {
  return Object.freeze(metaPrefix === undefined ? { cls } : { cls, metaPrefix });
}

/** Each kind's GT class (simple name) and, for two kinds, the prefix its metaName must start with. */
export const EXPORT_HATCH_CLASSES: Readonly<Record<ExportHatchKind, { cls: string; metaPrefix?: string }>> = Object.freeze({
  input_bus: hatchClass('MTEHatchInputBus'),
  output_bus: hatchClass('MTEHatchOutputBus'),
  input_hatch: hatchClass('MTEHatchInput'),
  output_hatch: hatchClass('MTEHatchOutput'),
  energy: hatchClass('MTEHatchEnergy'),
  energy_multi: hatchClass('MTEHatchEnergyMulti'),
  energy_laser: hatchClass('MTEHatchEnergyTunnel'),
  maintenance: hatchClass('MTEHatchMaintenance'),
  muffler: hatchClass('MTEHatchMuffler'),
  dynamo: hatchClass('MTEHatchDynamo'),
  dynamo_multi: hatchClass('MTEHatchDynamoMulti', 'hatch.dynamomulti16.'),
  dynamo_laser: hatchClass('MTEHatchDynamoTunnel'),
  steam_input_bus: hatchClass('MTEHatchSteamBusInput'),
  steam_output_bus: hatchClass('MTEHatchSteamBusOutput'),
  steam_hatch: hatchClass('MTEHatchCustomFluidBase', 'hatch.steam.'),
  data_access: hatchClass('MTEHatchDataAccess'),
  coke_oven_hatch: hatchClass('MTEHatchCokeOven'),
});

const KIND_SET: ReadonlySet<string> = new Set(EXPORT_HATCH_KINDS);

/** Whether `s` is one of the 17 kinds; a newer exporter may write kinds this planner does not know. */
export function isExportHatchKind(s: string): s is ExportHatchKind {
  return KIND_SET.has(s);
}

/**
 * The kind whose class has simple name `simpleName` (and, when the kind has a metaPrefix, for a `metaName` that starts
 * with it); null for any other hatch.
 */
export function exportKindOfClass(simpleName: string, metaName: string): ExportHatchKind | null {
  return EXPORT_HATCH_KINDS.find((kind) => {
    const { cls, metaPrefix } = EXPORT_HATCH_CLASSES[kind];
    return cls === simpleName && (metaPrefix === undefined || metaName.startsWith(metaPrefix));
  }) ?? null;
}
