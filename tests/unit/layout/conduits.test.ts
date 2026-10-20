import { describe, it, expect } from 'vitest';
import { assignChannels, fluidFilterFor, itemFilterFor, pickFluidConduit, speedUpgradesFor, type ChannelEnd } from '../../../src/server/layout/conduits.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { conduitFaceText, conduitFilterText, conduitLines, conduitSideText } from '../../../src/shared/layout/configure-text.ts';
import type { ConduitFace } from '../../../src/shared/types/layout.ts';
import { layoutPack } from '../../helpers/layout-fixtures.ts';

const parts = resolveParts(layoutPack());
const BASIC = 'EnderIO:itemBasicFilterUpgrade@0';
const SPEED = 'EnderIO:itemExtractSpeedUpgrade@0';
const names: Record<string, string> = { [BASIC]: 'Basic Item Filter', [SPEED]: 'Item Conduit Speed Upgrade', 't:dust@0': 'Titanium Dust', 't:in@0': 'Raw Input', 'fluid:molten.iron': 'Molten Iron' };
const nameOf = (k: string) => names[k] ?? k;
const keys = (n: number) => Array.from({ length: n }, (_, i) => `t:i${String(i).padStart(2, '0')}@0`);

describe('conduit sizing', () => {
  it('adds the fewest speed upgrades that move the rate', () => {
    expect([0, 8, 8.01, 64, 128, 129].map(speedUpgradesFor)).toEqual([
      { count: 0, short: false }, { count: 0, short: false }, { count: 1, short: false }, { count: 7, short: false },
      { count: 15, short: false }, { count: 15, short: true }]);
  });
  it('picks the smallest item filter that holds the keys and says how many slots it has', () => {
    expect(itemFilterFor(parts, ['t:b@0', 't:a@0', 't:a@0'])).toEqual({ dropped: [], filter: {
      item: BASIC, whitelist: true, keys: ['t:a@0', 't:b@0'], matchMeta: true, matchNbt: false, oreDict: false, sticky: false, slots: 5 } });
    expect([itemFilterFor(parts, keys(6)).filter.item, itemFilterFor(parts, keys(6)).filter.slots]).toEqual(['EnderIO:itemBasicFilterUpgrade@1', 10]);
    expect([itemFilterFor(parts, keys(11)).filter.item, itemFilterFor(parts, keys(11)).filter.slots]).toEqual(['EnderIO:itemBigFilterUpgrade@0', 24]);
    const full = itemFilterFor(parts, keys(25));
    expect([full.filter.item, full.filter.keys.length, full.dropped]).toEqual(['EnderIO:itemBigFilterUpgrade@0', 24, ['t:i24@0']]);
    expect(itemFilterFor(parts, ['t:a@0#0123456789ab']).filter.matchNbt).toBe(true);
  });
  it('holds at most five fluids in a fluid conduit filter', () => {
    expect(fluidFilterFor(['fluid:b', 'fluid:a'])).toEqual({ filter: { whitelist: true, keys: ['fluid:a', 'fluid:b'], slots: 5 }, dropped: [] });
    expect(fluidFilterFor(['fluid:a', 'fluid:b', 'fluid:c', 'fluid:d', 'fluid:e', 'fluid:f']).dropped).toEqual(['fluid:f']);
  });
  it('picks the first ender fluid conduit that carries the busiest face', () => {
    const pick = (extract: number, insert: number) => { const p = pickFluidConduit(parts, { extract, insert }); return [p.kind, p.part.key, p.short]; };
    expect(pick(1, 1)).toEqual(['liquid_ender', 'EnderIO:itemLiquidConduit@2', false]);
    expect(pick(4000, 0)).toEqual(['liquid_ender', 'EnderIO:itemLiquidConduit@2', false]);
    expect(pick(4001, 0)).toEqual(['liquid_crystalline', 'EnderIO:itemLiquidConduit@3', false]);
    expect(pick(10, 20000)).toEqual(['liquid_crystalline', 'EnderIO:itemLiquidConduit@3', false]);
    expect(pick(1e6, 0)).toEqual(['liquid_stellar', 'EnderIO:itemLiquidConduit@6', true]);
  });
});

/** An end of the face `face` (its id unless given). */
const end = (id: string, side: 'extract' | 'insert', keys: string[], more: Partial<ChannelEnd> = {}): ChannelEnd => ({ id, side, keys, face: id, ...more });
/** The input chest of the item line: a stock, so its extract side keeps to its links. */
const stock = (id: string, keys: string[]) => end(id, 'extract', keys, { guarded: true });
/** `n` channels, each a stock handing `k` to a machine: any two on one colour would hand `k` to each other's machine. */
const stocks = (n: number, keysOf: (i: number) => string[] = () => ['k']) => ({
  ends: Array.from({ length: n }, (_, i) => [stock(`s${i}`, keysOf(i)), end(`m${i}`, 'insert', keysOf(i))]).flat(),
  links: Array.from({ length: n }, (_, i) => ({ from: `s${i}`, to: `m${i}` })),
});

describe('channel colours', () => {
  it('puts every channel on the one colour of the line while no guarded end can trade off its links', () => {
    // two channels of their own (a hands k1 to b, c hands k2 to d) and a third that takes k1 too: filters keep each item
    // to the faces that take it, so all of them share Red
    const plan = assignChannels([end('a', 'extract', ['k1']), end('b', 'insert', ['k1']), end('c', 'extract', ['k2']), end('d', 'insert', ['k2']),
      end('e', 'insert', ['k1'])], [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]);
    expect(Object.fromEntries(plan.colors)).toEqual({ a: 'red', b: 'red', c: 'red', d: 'red', e: 'red' });
    expect(plan.shared).toEqual([]);
  });
  it('gives a channel the next colour when a stock on the colour would hand it one of its keys', () => {
    // the input chest hands k to b; a hands k to c: on one colour the chest would fill c as well and a would back up
    const plan = assignChannels([stock('chest', ['k', 'j']), end('b', 'insert', ['k']), end('a', 'extract', ['k']), end('c', 'insert', ['k']),
      end('x', 'extract', ['j2']), end('y', 'insert', ['j2'])], [{ from: 'chest', to: 'b' }, { from: 'a', to: 'c' }, { from: 'x', to: 'y' }]);
    expect(Object.fromEntries(plan.colors)).toEqual({ chest: 'red', b: 'red', a: 'blue', c: 'blue', x: 'red', y: 'red' });
    expect(plan.shared).toEqual([]);
  });
  it('gives a channel the next colour when a guarded insert side on the colour would take one of its keys', () => {
    // an open fluid end has no priority, so a maker whose fluid goes to a machine must not reach it
    const plan = assignChannels([end('a', 'extract', ['f']), end('tank', 'insert', ['f'], { guarded: true }), end('b', 'extract', ['f']),
      end('c', 'insert', ['f'])], [{ from: 'a', to: 'tank' }, { from: 'b', to: 'c' }]);
    expect(Object.fromEntries(plan.colors)).toEqual({ a: 'red', tank: 'red', b: 'blue', c: 'blue' });
  });
  it('never counts the two sides of one face against each other', () => {
    // an In / Out open end takes Molten Iron in and sends the surplus out: EnderIO never fills the tank it drains
    const plan = assignChannels([end('in', 'extract', ['f'], { face: 'tank', guarded: true }), end('m', 'insert', ['f']), end('p', 'extract', ['f']),
      end('out', 'insert', ['f'], { face: 'tank', guarded: true })], [{ from: 'in', to: 'm' }, { from: 'p', to: 'out' }]);
    expect(new Set(plan.colors.values())).toEqual(new Set(['red']));
  });
  it('shares the colour with the fewest keys that would leak once the palette is used up, and names them', () => {
    const plan = assignChannels(stocks(16).ends, stocks(16).links);
    expect([plan.colors.get('s0'), plan.colors.get('s14'), plan.colors.get('m14'), plan.colors.get('s15')]).toEqual(['red', 'silver', 'silver', 'red']);
    expect(plan.shared).toEqual([{ color: 'red', keys: ['k'] }]);
  });
  it('refuses a link to an end it does not know', () => {
    expect(() => assignChannels([end('a', 'extract', [])], [{ from: 'a', to: 'x' }])).toThrow(RangeError);
  });
});

describe('the words for a conduit face', () => {
  const filter = (k: string) => ({ item: BASIC, whitelist: true, keys: [k], matchMeta: true, matchNbt: false, oreDict: false, sticky: false });
  it('says both sides of an In / Out face, each with its own colour and filter, and what the face holds', () => {
    const face: ConduitFace = { face: 'north', mode: 'in_out', target: 'Basic Macerator',
      extract: { color: 'red', filter: filter('t:dust@0'), rate: 20, roundRobin: false, selfFeed: false, redstone: 'ignore', speed: { item: SPEED, count: 2 } },
      insert: { color: 'blue', filter: filter('t:in@0'), rate: 20, priority: 1 } };
    expect(conduitFaceText('item', face, nameOf)).toBe('Item Conduit, north face to Basic Macerator: In / Out (2 filters, 2 speed upgrades); '
      + 'extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), 2× Item Conduit Speed Upgrade, round robin off, self feed off, redstone Always active; '
      + 'insert on Blue with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), priority 1');
  });
  it("names the slots a filter's items fill out of the filter's own, so the builder knows which filter each list needs", () => {
    const face: ConduitFace = { face: 'south', mode: 'insert', target: 'Chest (output)',
      insert: { color: 'red', filter: { ...filter('t:dust@0'), keys: ['t:dust@0', 't:in@0'], slots: 5 }, rate: 2, priority: 0 } };
    expect(conduitFaceText('item', face, nameOf)).toBe('Item Conduit, south face to Chest (output): Insert (1 filter); insert on Red with a Basic '
      + 'Item Filter (whitelist, 2 of 5 slots: Titanium Dust and Raw Input; match meta, ignore NBT), priority 0');
    expect(conduitFilterText({ whitelist: true, keys: ['fluid:molten.iron'], slots: 5 }, nameOf)).toBe('fluid filter (whitelist, 1 of 5 slots: Molten Iron)');
  });
  it('says a fluid face and a disabled face', () => {
    // an ender fluid conduit's filters are its own, so the face holds no filter item
    expect(conduitFaceText('liquid_ender', { face: 'down', mode: 'extract', target: 'Basic Fluid Extractor',
      extract: { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1, roundRobin: false, redstone: 'ignore' } }, nameOf))
      .toBe('Ender Fluid Conduit, bottom face to Basic Fluid Extractor: Extract; extract on Red with a fluid filter (whitelist: Molten Iron), round robin off, redstone Always active');
    expect(conduitFaceText('liquid_ender', { face: 'up', mode: 'disabled', target: 'Basic Fluid Extractor' }, nameOf))
      .toBe('Ender Fluid Conduit, top face to Basic Fluid Extractor: Disabled');
  });
  it('lists every face of every conduit in a bundle, item first', () => {
    const lines = conduitLines({ conduits: [
      { kind: 'item', item: 'EnderIO:itemItemConduit@0', connections: 32, faces: [{ face: 'north', mode: 'disabled', target: 'A' }] },
      { kind: 'liquid_ender', item: 'EnderIO:itemLiquidConduit@2', connections: 2, faces: [{ face: 'south', mode: 'disabled', target: 'B' }] }] }, nameOf);
    expect(lines.map((l) => [l.kind, l.face])).toEqual([['item', 'north'], ['liquid_ender', 'south']]);
  });
});

// ---- Beyond the plan's cases: the edges of each rule and the words the plan lists but does not pin ----

const ADVANCED = 'EnderIO:itemBasicFilterUpgrade@1';
const BIG = 'EnderIO:itemBigFilterUpgrade@0';
const colorsOf = (ends: ChannelEnd[], links: Array<{ from: string; to: string }>) => Object.fromEntries(assignChannels(ends, links).colors);

describe('conduit sizing at its edges', () => {
  it('moves up a filter size only past 5 and 10 items', () => {
    expect([5, 6, 10, 11, 24].map((n) => itemFilterFor(parts, keys(n)).filter.item)).toEqual([BASIC, ADVANCED, ADVANCED, BIG, BIG]);
    expect(itemFilterFor(parts, keys(24)).dropped).toEqual([]);
    expect(fluidFilterFor(['fluid:a', 'fluid:b', 'fluid:c', 'fluid:d', 'fluid:e']).dropped).toEqual([]);
  });
  it('looks for an NBT suffix only in the keys a filter keeps', () => {
    const past = itemFilterFor(parts, [...keys(24), 't:z@0#0123456789ab']);
    expect([past.filter.matchNbt, past.dropped]).toEqual([false, ['t:z@0#0123456789ab']]);
  });
  it('carries a face exactly at the limit of an ender fluid conduit and no further', () => {
    const pick = (extract: number, insert: number) => { const p = pickFluidConduit(parts, { extract, insert }); return [p.kind, p.short]; };
    expect([pick(0, 16000), pick(0, 16001), pick(400000, 1600000), pick(400000, 1600001), pick(400001, 0)]).toEqual([
      ['liquid_ender', false], ['liquid_crystalline', false], ['liquid_stellar', false], ['liquid_stellar', true], ['liquid_stellar', true]]);
  });
});

describe('channel colours in detail', () => {
  it('colours channels by their first end, whatever order the links come in', () => {
    // c hands k1 to the chest's machine b unless they share a channel; d's channel takes k1 from c
    const four = [end('b', 'insert', ['k1']), stock('chest', ['k1']), end('c', 'extract', ['k1']), end('d', 'insert', ['k1'])];
    expect(colorsOf(four, [{ from: 'chest', to: 'b' }, { from: 'c', to: 'd' }])).toEqual({ b: 'red', chest: 'red', c: 'blue', d: 'blue' });
    expect(colorsOf(four, [{ from: 'c', to: 'd' }, { from: 'chest', to: 'b' }])).toEqual({ b: 'red', chest: 'red', c: 'blue', d: 'blue' });
    // with c also feeding b, all four trade along links: one channel
    expect(colorsOf(four, [{ from: 'c', to: 'b' }, { from: 'chest', to: 'b' }, { from: 'c', to: 'd' }])).toEqual({ b: 'red', chest: 'red', c: 'red', d: 'red' });
  });
  it('compares a whole channel with a colour, not only its first end', () => {
    // the third channel's first end takes nothing the stock gives, its second does
    const plan = assignChannels([stock('chest', ['k']), end('m', 'insert', ['k']), end('x', 'extract', ['j']), end('y', 'insert', ['j', 'k'])],
      [{ from: 'chest', to: 'm' }, { from: 'x', to: 'y' }]);
    expect([plan.colors.get('x'), plan.colors.get('y')]).toEqual(['blue', 'blue']);
  });
  it('leaves a stock on the colour of a channel that only gives what the stock gives', () => {
    // a second maker of k hands it to its own machine: k from the chest would reach that machine, k from the maker the
    // chest never takes (an extract side takes nothing), so only the machine's side counts
    const plan = assignChannels([stock('chest', ['k']), end('m', 'insert', ['k']), end('a', 'extract', ['k']), end('n', 'insert', ['j'])],
      [{ from: 'chest', to: 'm' }, { from: 'a', to: 'n' }]);
    expect(new Set(plan.colors.values())).toEqual(new Set(['red']));
  });
  it('shares the colour with the fewest leaking keys and names them sorted', () => {
    // fifteen channels hand x and y to each other's machines; the sixteenth hands only x, so a colour whose stock gives x alone leaks least
    const keysOf = (i: number) => (i === 1 ? ['x'] : ['y', 'x']);
    const { ends, links } = stocks(16, keysOf);
    const plan = assignChannels(ends, links);
    expect(plan.colors.get('s15')).toBe('blue');
    expect(plan.shared).toEqual([{ color: 'blue', keys: ['x'] }]);
    expect(assignChannels(stocks(16, () => ['y', 'x']).ends, stocks(16, () => ['y', 'x']).links).shared).toEqual([{ color: 'red', keys: ['x', 'y'] }]);
  });
  it('refuses a link from an end it does not know and two ends with one id', () => {
    expect(() => assignChannels([end('a', 'insert', [])], [{ from: 'x', to: 'a' }])).toThrow(RangeError);
    expect(() => assignChannels([end('a', 'extract', []), end('a', 'insert', [])], [])).toThrow(RangeError);
  });
});

describe('the words for one side of a conduit face', () => {
  it('names the settings of a filter', () => {
    expect(conduitFilterText({ item: BASIC, whitelist: false, keys: ['t:dust@0', 't:in@0'], matchMeta: false, matchNbt: true, oreDict: true, sticky: true }, nameOf))
      .toBe('Basic Item Filter (blacklist: Titanium Dust and Raw Input; ignore meta, match NBT, ore dictionary, sticky)');
    expect(conduitFilterText({ whitelist: false, keys: ['fluid:molten.iron'] }, nameOf)).toBe('fluid filter (blacklist: Molten Iron)');
  });
  it('says "an" before a filter name that starts with a vowel', () => {
    const named = (k: string) => (k === ADVANCED ? 'Advanced Item Filter' : nameOf(k));
    const advanced = { item: ADVANCED, whitelist: true, keys: ['t:dust@0'], matchMeta: true, matchNbt: false, oreDict: false, sticky: false };
    expect(conduitSideText('extract', { color: 'yellow', filter: advanced, rate: 20, roundRobin: true, redstone: 'on' }, named))
      .toBe('extract on Yellow with an Advanced Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), round robin on, redstone Active with signal');
    expect(conduitSideText('insert', { color: 'light_blue', filter: advanced, rate: 20, priority: 1 }, named))
      .toBe('insert on Light Blue with an Advanced Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), priority 1');
  });
  it('says an extract side without a filter, with self feed on, and each redstone setting', () => {
    const extract = (redstone: 'ignore' | 'on' | 'off' | 'never') => conduitSideText('extract', { color: 'silver', filter: null, rate: 1, roundRobin: false, redstone }, nameOf);
    expect((['ignore', 'on', 'off', 'never'] as const).map((r) => extract(r))).toEqual([
      'extract on Light Gray, round robin off, redstone Always active', 'extract on Light Gray, round robin off, redstone Active with signal',
      'extract on Light Gray, round robin off, redstone Active without signal', 'extract on Light Gray, round robin off, redstone Never active']);
    expect(conduitSideText('extract', { color: 'lime', filter: null, rate: 1, roundRobin: true, selfFeed: true, redstone: 'ignore', speed: { item: SPEED, count: 1 } }, nameOf))
      .toBe('extract on Lime, 1× Item Conduit Speed Upgrade, round robin on, self feed on, redstone Always active');
  });
  it('says an insert side with its priority, 0 included, or without one', () => {
    expect(conduitSideText('insert', { color: 'green', filter: null, rate: 1, priority: 0 }, nameOf)).toBe('insert on Green, priority 0');
    expect(conduitSideText('insert', { color: 'blue', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1 }, nameOf))
      .toBe('insert on Blue with a fluid filter (whitelist: Molten Iron)');
  });
  it('says an insert-only fluid face, and lists faces in the order they are stored', () => {
    expect(conduitFaceText('liquid_crystalline', { face: 'east', mode: 'insert', target: 'Basic Fluid Solidifier',
      insert: { color: 'blue', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1 } }, nameOf))
      .toBe('Crystalline Ender Fluid Conduit, east face to Basic Fluid Solidifier: Insert; insert on Blue with a fluid filter (whitelist: Molten Iron)');
    expect(conduitLines({}, nameOf)).toEqual([]);
    expect(conduitLines({ conduits: [{ kind: 'item', item: 'EnderIO:itemItemConduit@0', connections: 0,
      faces: [{ face: 'south', mode: 'disabled', target: 'B' }, { face: 'north', mode: 'disabled', target: 'A' }] }] }, nameOf)
      .map((l) => [l.face, l.text])).toEqual([['south', 'Item Conduit, south face to B: Disabled'], ['north', 'Item Conduit, north face to A: Disabled']]);
  });
});
