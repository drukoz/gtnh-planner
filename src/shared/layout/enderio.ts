// EnderIO facts and names for the EnderIO conduit mode (spec §3.6 mode 4; architecture §11.30 and "EnderIO conduits,
// granted change requests (add-on 11)"), pinned in the pack's EnderIO 2.10.46 jar and its `config/enderio/EnderIO.cfg`
// (read once; nothing from either is committed):
// - An item conduit face extracts `SpeedUpgrade.BASE_MAX_EXTRACTED` = 4 items plus 4 per Item Conduit Speed Upgrade (at
//   most the upgrade's `maxStackSize` of 15) at a time, then waits `round(n × 10 / max)` ticks
//   (`ItemConduit.getTickTimePerItem` = 10 / max, `NetworkedInventory.itemExtracted`).
// - The ender fluid conduits' extract and max IO rates per face are EnderIO's `Config` defaults, which the pack's
//   `EnderIO.cfg` keeps. The basic and pressurized fluid conduits carry one fluid per network and have no channels,
//   so the mode never lays them.
// - A face nobody set extracts on Green (`ItemConduit.getInputColor`) and only with a redstone signal, ON
//   (`ItemConduit.getExtractionRedstoneMode`), so the line never hands out Green and sets every extract face's redstone.
// - Insert targets fill sticky ones first, then by priority, highest first, then by distance
//   (`NetworkedInventory$Target.compareTo`).
// - Item filters hold 5 (Basic), 10 (Advanced) or 24 (Big) items and match meta and NBT by default
//   (`ItemFilter.DEFAULT_MBT`); an ender fluid conduit's own `FluidFilter` holds 5 fluids.
// - `ConnectionMode`, `DyeColor` and `RedstoneControlMode` are the enums behind the face types in `../types/layout.ts`;
//   the names are the conduit GUI's (`en_US.lang`, `gui.conduit.ioMode.*` for the modes).
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { ConduitKind, ConduitMode, DyeColor, RedstoneMode } from '../types/layout.ts';

const TICKS_PER_SECOND = 20;

// ---- Colours and names ----

/** EnderIO `DyeColor` in ordinal order: a colour's index is its NBT value (`inSC.<DIR>` / `outSC.<DIR>`). */
export const DYE_COLORS: readonly DyeColor[] = Object.freeze([
  'black', 'red', 'green', 'brown', 'blue', 'purple', 'cyan', 'silver', 'gray', 'pink', 'lime', 'yellow', 'light_blue', 'magenta', 'orange', 'white',
]);

/** Each colour as the game names it; `silver` is Light Gray. */
export const DYE_NAMES: Readonly<Record<DyeColor, string>> = Object.freeze({
  black: 'Black', red: 'Red', green: 'Green', brown: 'Brown', blue: 'Blue', purple: 'Purple', cyan: 'Cyan', silver: 'Light Gray',
  gray: 'Gray', pink: 'Pink', lime: 'Lime', yellow: 'Yellow', light_blue: 'Light Blue', magenta: 'Magenta', orange: 'Orange', white: 'White',
});

/** A swatch per colour for drawing channels. */
export const DYE_HEX: Readonly<Record<DyeColor, string>> = Object.freeze({
  black: '#1d1d21', red: '#b02e26', green: '#5e7c16', brown: '#835432', blue: '#3c44aa', purple: '#8932b8', cyan: '#169c9c', silver: '#9d9d97',
  gray: '#474f52', pink: '#f38baa', lime: '#80c71f', yellow: '#fed83d', light_blue: '#3ab3da', magenta: '#c74ebd', orange: '#f9801d', white: '#f9fffe',
});

/** The channel of a face nobody set (`ItemConduit.getInputColor` falls back to GREEN). */
export const DEFAULT_CHANNEL: DyeColor = 'green';

/**
 * Channel colours in the order the line hands them out: the 15 colours other than `DEFAULT_CHANNEL`, so a base
 * network's unconfigured faces never trade with the line.
 */
export const CHANNEL_PALETTE: readonly DyeColor[] = Object.freeze([
  'red', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'pink', 'light_blue', 'brown', 'white', 'black', 'gray', 'silver',
]);

/** The face modes as the conduit GUI names them (`en_US.lang` `gui.conduit.ioMode.*`). */
export const CONDUIT_MODE_NAMES: Readonly<Record<ConduitMode, string>> = Object.freeze({
  extract: 'Extract', insert: 'Insert', in_out: 'In / Out', disabled: 'Disabled',
});

/** The redstone settings of an extract side as the conduit GUI names them; an unset face is `on`. */
export const REDSTONE_NAMES: Readonly<Record<RedstoneMode, string>> = Object.freeze({
  ignore: 'Always active', on: 'Active with signal', off: 'Active without signal', never: 'Never active',
});

/** The pack's item names of the conduits the mode lays. */
export const CONDUIT_NAMES: Readonly<Record<ConduitKind, string>> = Object.freeze({
  item: 'Item Conduit',
  liquid_ender: 'Ender Fluid Conduit',
  liquid_crystalline: 'Crystalline Ender Fluid Conduit',
  liquid_pink_slime: 'Crystalline Pink Slime Ender Fluid Conduit',
  liquid_melodic: 'Melodic Ender Fluid Conduit',
  liquid_stellar: 'Stellar Ender Fluid Conduit',
});

// ---- Rates ----

/**
 * An item conduit face's extraction: `baseExtract` items plus `perUpgrade` per speed upgrade, at most `maxUpgrades`
 * upgrades, one extraction every `ticksPerExtraction` ticks.
 */
export const ITEM_CONDUIT: { readonly baseExtract: 4; readonly perUpgrade: 4; readonly maxUpgrades: 15; readonly ticksPerExtraction: 10 } =
  Object.freeze({ baseExtract: 4, perUpgrade: 4, maxUpgrades: 15, ticksPerExtraction: 10 });

/** Items/s one face moves with `upgrades` speed upgrades: 20 / 10 × (4 + 4 × min(upgrades, 15)). */
export function itemFaceRate(upgrades: number): number {
  const { baseExtract, perUpgrade, maxUpgrades, ticksPerExtraction } = ITEM_CONDUIT;
  return (TICKS_PER_SECOND / ticksPerExtraction) * (baseExtract + perUpgrade * Math.min(upgrades, maxUpgrades));
}

/**
 * An ender fluid conduit: its `EnderIO:itemLiquidConduit` meta and, per face, the most it extracts (`extractPerTick`)
 * and the most it moves in or out (`maxIoPerTick`), in mB per tick.
 */
export interface FluidConduitRow { kind: ConduitKind; meta: number; extractPerTick: number; maxIoPerTick: number }

function fluidConduit(kind: ConduitKind, meta: number, extractPerTick: number, maxIoPerTick: number): FluidConduitRow {
  return Object.freeze({ kind, meta, extractPerTick, maxIoPerTick });
}

/** The ender fluid conduits, slowest first (EnderIO `Config` defaults). */
export const FLUID_CONDUITS: readonly FluidConduitRow[] = Object.freeze([
  fluidConduit('liquid_ender', 2, 200, 800),
  fluidConduit('liquid_crystalline', 3, 1000, 4000),
  fluidConduit('liquid_pink_slime', 4, 2000, 8000),
  fluidConduit('liquid_melodic', 5, 10000, 40000),
  fluidConduit('liquid_stellar', 6, 20000, 80000),
]);

// ---- Filters ----

/** Item slots of the Basic, Advanced and Big Item Filter. */
export const ITEM_FILTER_SLOTS: { readonly basic: 5; readonly advanced: 10; readonly big: 24 } = Object.freeze({ basic: 5, advanced: 10, big: 24 });

/** Fluid slots of an ender fluid conduit's own filter. */
export const FLUID_FILTER_SLOTS: 5 = 5;
