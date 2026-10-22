import { describe, it, expect } from 'vitest';
import {
  CHANNEL_PALETTE, CONDUIT_MODE_NAMES, CONDUIT_NAMES, DEFAULT_CHANNEL, DYE_COLORS, DYE_HEX, DYE_NAMES, FLUID_CONDUITS, FLUID_FILTER_SLOTS,
  ITEM_FILTER_SLOTS, REDSTONE_NAMES, TAP_CHANNEL, dyeRgb, itemFaceRate,
} from '../../../src/shared/layout/enderio.ts';
import { LogisticsMode } from '../../../src/shared/types/plan.ts';
import { validateOp } from '../../../src/shared/project/apply-op.ts';
import { reachKinds } from '../../../src/shared/world/storage-totals.ts';
import { PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { chooseLogisticsNetwork } from '../../../src/server/layout/hookups.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makeScan } from '../../helpers/layout-fixtures.ts';

describe('EnderIO 2.10.46 facts', () => {
  it('moves 8 items/s through a face and 8 more per Item Conduit Speed Upgrade, at most 15', () => {
    expect([0, 1, 2, 7, 15, 16].map(itemFaceRate)).toEqual([8, 16, 24, 64, 128, 128]);
  });
  it('lists the dye colours in EnderIO order and hands out 15 channels, never the default green', () => {
    expect(DYE_COLORS).toEqual(['black', 'red', 'green', 'brown', 'blue', 'purple', 'cyan', 'silver', 'gray', 'pink', 'lime', 'yellow', 'light_blue', 'magenta', 'orange', 'white']);
    expect(CHANNEL_PALETTE).toEqual(['red', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'pink', 'light_blue', 'brown', 'white', 'black', 'gray', 'silver']);
    expect(DEFAULT_CHANNEL).toBe('green');
    // the storage tap's link to the input chest has a channel of its own, not a base face's default
    expect(TAP_CHANNEL).toBe('silver');
    expect([DYE_NAMES.silver, DYE_NAMES.light_blue]).toEqual(['Light Gray', 'Light Blue']);
  });
  it("tints with the game's own dye colours, as three bytes", () => {
    // EnderCore 0.5.15 DyeColor.getColor() = ItemDye.field_150922_c[ordinal]: Minecraft 1.7.10's table (minecraft_server
    // 1.7.10, class acj), which the conduit renderers tint the arrows with; not the later game versions' dye colours
    const GAME = [0x1e1b1b, 0xb3312c, 0x3b511a, 0x51301a, 0x253192, 0x7b2fbe, 0x287697, 0xababab, 0x434343, 0xd88198, 0x41cd34, 0xdecf2a,
      0x6689d3, 0xc354cd, 0xeb8844, 0xf0f0f0];
    expect(DYE_COLORS.map(dyeRgb)).toEqual(GAME.map((v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255]));
    expect([dyeRgb('red'), dyeRgb('blue'), dyeRgb('white')]).toEqual([[179, 49, 44], [37, 49, 146], [240, 240, 240]]);
    for (const color of DYE_COLORS) expect(`#${dyeRgb(color).map((v) => v.toString(16).padStart(2, '0')).join('')}`).toBe(DYE_HEX[color]);
    const red = dyeRgb('red');
    red[0] = 0;
    expect(dyeRgb('red')[0]).toBe(179);                                                  // a fresh triple each time
  });
  it('names modes and redstone settings as the EnderIO GUI does', () => {
    expect(CONDUIT_MODE_NAMES).toEqual({ extract: 'Extract', insert: 'Insert', in_out: 'In / Out', disabled: 'Disabled' });
    expect(REDSTONE_NAMES).toEqual({ ignore: 'Always active', on: 'Active with signal', off: 'Active without signal', never: 'Never active' });
    expect([CONDUIT_NAMES.item, CONDUIT_NAMES.liquid_ender]).toEqual(['Item Conduit', 'Ender Fluid Conduit']);
  });
  it('rates the ender fluid conduits per face in L/s and sizes the filters', () => {
    expect(FLUID_CONDUITS.map((c) => [c.kind, c.meta, c.extractPerTick * 20, c.maxIoPerTick * 20])).toEqual([
      ['liquid_ender', 2, 4000, 16000], ['liquid_crystalline', 3, 20000, 80000], ['liquid_pink_slime', 4, 40000, 160000],
      ['liquid_melodic', 5, 200000, 800000], ['liquid_stellar', 6, 400000, 1600000]]);
    expect([ITEM_FILTER_SLOTS.basic, ITEM_FILTER_SLOTS.advanced, ITEM_FILTER_SLOTS.big, FLUID_FILTER_SLOTS]).toEqual([5, 10, 24, 5]);
  });
});

describe('the enderio logistics mode', () => {
  it('is a mode a project can choose, with machine ports that may share a spine cell', () => {
    expect(LogisticsMode.EnderIO).toBe('enderio');
    expect(validateOp({ op: 'settings', patch: { logistics: 'enderio' } })).toBeNull();
    expect(PORT_SPACING.enderio).toBe(0);
  });
  it('counts storage on the base EnderIO network as reachable', () => {
    expect([...reachKinds('enderio')]).toEqual(['enderio']);
  });
  it('hooks only into an EnderIO item network', () => {
    const scan = makeScan({ logistics: [{ kind: 'routed', taps: [[0, 64, 0]] }, { kind: 'enderio', taps: [[2, 64, 0]] }] });
    expect(chooseLogisticsNetwork(scan, scan.bases[0]!, 'enderio')?.kind).toBe('enderio');
    scan.logistics[1]!.id = 'e:liquid:0:5';
    expect(chooseLogisticsNetwork(scan, scan.bases[0]!, 'enderio')).toBeNull();
  });
  it('resolves the new EnderIO parts against the pack', () => {
    const parts = resolveParts(layoutPack());
    expect([parts.eio_advanced_filter, parts.eio_big_filter, parts.eio_speed_upgrade, parts.eio_fluid_ender, parts.eio_fluid_stellar]
      .map((p) => [p.key, p.name, p.found])).toEqual([
      ['EnderIO:itemBasicFilterUpgrade@1', 'Advanced Item Filter', true], ['EnderIO:itemBigFilterUpgrade@0', 'Big Item Filter', true],
      ['EnderIO:itemExtractSpeedUpgrade@0', 'Item Conduit Speed Upgrade', true], ['EnderIO:itemLiquidConduit@2', 'Ender Fluid Conduit', true],
      ['EnderIO:itemLiquidConduit@6', 'Stellar Ender Fluid Conduit', true]]);
    expect(parts.eio_fluid_ender.block).toEqual({ id: 'conduit:liquid_ender', meta: 0 });
  });
});
