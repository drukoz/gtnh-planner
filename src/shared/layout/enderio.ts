// EnderIO facts and names for the EnderIO conduit mode (spec §3.6 mode 4; architecture §11.30 and "EnderIO conduits,
// granted change requests (add-on 11)"), pinned in the pack's EnderIO 2.10.46 and EnderCore 0.5.15 jars and its
// `config/enderio/EnderIO.cfg` (read only; nothing from them is committed):
// - An item conduit face extracts `SpeedUpgrade.BASE_MAX_EXTRACTED` = 4 items plus 4 per Item Conduit Speed Upgrade (at
//   most the upgrade's `maxStackSize` of 15) at a time, then waits `round(n × 10 / max)` ticks
//   (`ItemConduit.getTickTimePerItem` = 10 / max, `NetworkedInventory.itemExtracted`).
// - The ender fluid conduits' extract and max IO rates per face are EnderIO's `Config` defaults, which the pack's
//   `EnderIO.cfg` keeps. The basic and pressurized fluid conduits carry one fluid per network and have no channels,
//   so the mode never lays them.
// - A face nobody set is Extract (`INPUT`: `ItemConduit` and `AbstractLiquidConduit` override `AbstractConduit`'s
//   `IN_OUT` in `getDefaultConnectionMode`), so it never inserts. It is Green on both sides (`getInputColor` and
//   `getOutputColor` fall back to `GREEN`) and extracts only with a redstone signal, ON (`getExtractionRedstoneMode`),
//   so the line never hands out Green and sets every extract face's redstone.
// - Insert targets fill sticky ones first, then by priority, highest first, then by distance
//   (`NetworkedInventory$Target.compareTo`): each extraction goes to the first that takes it. With round robin on, a
//   face starts each extraction at the target after the one served last, over all of its targets whatever their
//   priority (`NetworkedInventory.getTargetIterator` hands out the pack's EnderCore 0.5.15 `RoundRobinIterator`, whose
//   index only moves on), so a chest takes its turn with the machines.
// - Ender fluid conduits have no priority. Without round robin a face tries the target that took fluid last first
//   (`EnderLiquidConduitNetwork$TankIterator.rewind`), so a tank that always takes fluid keeps it all; with it, the
//   targets take turns.
// - Item filters hold 5 (Basic), 10 (Advanced) or 24 (Big) items and match meta and NBT by default
//   (`ItemFilter.DEFAULT_MBT`); an ender fluid conduit's own `FluidFilter` holds 5 fluids.
// - `ConnectionMode`, `DyeColor` and `RedstoneControlMode` are the enums behind the face types in `../types/layout.ts`;
//   the names are the conduit GUI's (`en_US.lang`, `gui.conduit.ioMode.*` for the modes). `DyeColor.getColor()` is
//   Minecraft 1.7.10's `ItemDye.field_150922_c` (the pack's `minecraft_server.1.7.10.jar`), the colours `DYE_HEX` holds.
// - Plan 4 names a scanned EnderIO network `e:<conduit type>:…` and gives its taps the kind `pipe`, as it does a GT pipe
//   network's, so `hookupNetworkKind` tells the two apart by the network id.
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { Rgb } from '../types/assets.ts';
import type { ConduitKind, ConduitMode, DyeColor, Hookup, RedstoneMode } from '../types/layout.ts';
import type { LogisticsMode } from '../types/plan.ts';
import type { LogisticsNetwork } from '../types/world.ts';

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

/**
 * Each colour as the game draws it, for drawing channels: Minecraft 1.7.10's dye colours (`ItemDye.field_150922_c`),
 * which EnderCore's `DyeColor.getColor()` returns and the conduit renderers tint a connector's arrows with
 * (`Tessellator.setColorOpaque_I`), so the 3D view's arrows and the Connections view's links show what the player sees in
 * game. Later game versions changed these colours; this pack's are these.
 */
export const DYE_HEX: Readonly<Record<DyeColor, string>> = Object.freeze({
  black: '#1e1b1b', red: '#b3312c', green: '#3b511a', brown: '#51301a', blue: '#253192', purple: '#7b2fbe', cyan: '#287697', silver: '#ababab',
  gray: '#434343', pink: '#d88198', lime: '#41cd34', yellow: '#decf2a', light_blue: '#6689d3', magenta: '#c354cd', orange: '#eb8844', white: '#f0f0f0',
});

/** A colour as the game draws it (`DYE_HEX`), as a fresh RGB triple, to tint a texture with. */
export function dyeRgb(color: DyeColor): Rgb {
  const hex = DYE_HEX[color];
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

/** The channel of a face nobody set (`ItemConduit.getInputColor` falls back to GREEN). */
export const DEFAULT_CHANNEL: DyeColor = 'green';

/**
 * Channel colours in the order the line hands them out: the 15 colours other than `DEFAULT_CHANNEL`, so a base
 * network's unconfigured faces never trade with the line.
 */
export const CHANNEL_PALETTE: readonly DyeColor[] = Object.freeze([
  'red', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'pink', 'light_blue', 'brown', 'white', 'black', 'gray', 'silver',
]);

/**
 * The channel of the link from the storage tap to the line's input chest, on the base's EnderIO network: the tap's
 * extract side and the input chest's Insert face. An extract side hands items only to Insert faces of its colour and
 * extracts only what one of them takes (`NetworkedInventory.doTransfer` moves nothing when no target takes the stack), so
 * with the input chest's face the only one on this colour, the tap stops while the chest is full. On Green, every face's
 * default, it would hand the raw inputs on to the base's other storages (and back again from any that extract on Green).
 * The scan does not read the base's face colours, so the steps ask the builder to keep this one free.
 */
export const TAP_CHANNEL: DyeColor = 'silver';

/** Why the storage tap's link has `TAP_CHANNEL`, and what to check, in a builder's words, for the steps that set it. */
export const TAP_CHANNEL_NOTE = `${DYE_NAMES[TAP_CHANNEL]} is the tap's own channel, so check that no other face on your network inserts on `
  + `${DYE_NAMES[TAP_CHANNEL]}: then the tap hands the raw inputs to the input chest alone and stops while the chest is full (on Green, every `
  + "face's default, it would go on filling your other storages)";

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

// ---- Networks ----

/** How Plan 4's ids of EnderIO networks start: `e:item:…`, `e:liquid:…`. */
const ENDERIO_NETWORK_PREFIX = 'e:';

/**
 * The network a hookup joins: null for power; a `pipe` tap is EnderIO in enderio mode or when its network id starts
 * with `e:` (Plan 4's `e:item:…`), else a GT pipe.
 */
export function hookupNetworkKind(h: Hookup, mode: LogisticsMode): LogisticsNetwork['kind'] | null {
  if (h.kind === 'power') return null;
  if (h.from.kind === 'routed' || h.from.kind === 'ae2') return h.from.kind;
  return mode === 'enderio' || h.from.networkId.startsWith(ENDERIO_NETWORK_PREFIX) ? 'enderio' : 'gtpipe';
}
