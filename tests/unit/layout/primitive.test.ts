// GT primitive machines in the routed, AE2 and EnderIO modes (architecture §11 entry 48; Plan 5 follow-ups 7 and 8):
// a steam singleblock vents steam through its output side (GT 5.09.54 `MTEBasicMachineBronze.allowToCheckRecipe` waits
// while a cover or a block with a hit box is there), so its output side faces up and the cell above it stays empty;
// a Bricked Blast Furnace lets nothing automated move its items (`allowPullStack` and `allowPutStack` are false) and a
// Coke Oven takes items only through its own Coke Oven Hatch, so both are run by hand, with nothing of the line
// touching them. Machine-to-machine mode is add-on 15's and keeps its layout.

import { describe, it, expect } from 'vitest';
import { connectionSpans, connectionsGraph } from '../../../src/client/connections/model.ts';
import { placeUnits, unitsFromPlan } from '../../../src/server/layout/arrange.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { projectorPayload } from '../../../src/server/projector/payload.ts';
import { OPPOSITE, step, type Rotation, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';
import { lineGround, lineScan } from '../../helpers/enderio-fixtures.ts';
import { IDS, makePlan, makeProject } from '../../helpers/layout-fixtures.ts';
import { BRICKED, COKE, primitivePack, STEAM, steelLine } from '../../helpers/primitive-fixtures.ts';

const MODES = ['routed', 'ae2', 'enderio'] as const;
const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const UP = 1;
const HORIZONTAL = [2, 3, 4, 5];
const NO_IO = { itemIn: false, itemOut: false, fluidIn: [], fluidOut: [] };

const key = (p: readonly number[]) => p.join();
const adjacent = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;

/** `plan` laid out next to the line scan's base in `mode`, at 30 64 10 turned by `rotation`. */
function laid(mode: LogisticsMode, rotation: Rotation = 0, plan: Plan = steelLine()): Promise<Layout> {
  return layoutLine(primitivePack(), plan, lineScan(), makeProject({ logistics: mode, placement: { origin: [30, 64, 10], rotation } }), lineGround());
}

/** The line's own blocks of plan step `stepId` (no hookup blocks, no ghosts). */
function ownBlocks(layout: Layout, stepId: string): LayoutBlock[] {
  return layout.blocks.filter((b) => b.stepId === stepId && b.hookup === undefined && b.role !== 'ghost');
}

/** The side of a steam machine its own logistics part touches: its interface, interface pipe or conduit face. */
function servedSide(layout: Layout, machine: LayoutBlock): number | undefined {
  const at = new Map(layout.blocks.map((b) => [key(b.pos), b]));
  return HORIZONTAL.find((side) => {
    const b = at.get(key(step(machine.pos, side)));
    return b !== undefined && (b.label.endsWith(`(${machine.label})`)
      || (b.conduits ?? []).some((c) => c.faces.some((f) => f.target === machine.label && f.mode !== 'disabled')));
  });
}

describe('primitive machines: units', () => {
  it('runs a Bricked Blast Furnace and a Coke Oven by hand: no hatch, no power, nothing for the line to move', () => {
    const pack = primitivePack();
    const { units, warnings } = unitsFromPlan(pack, steelLine(), { primitive: true });
    const unit = (id: string) => units.find((u) => u.stepId === id)!;
    const [b, k] = [unit('b'), unit('k')];
    expect([b.manual, b.electric, b.multiblock, b.size, k.manual, k.electric, k.size])
      .toEqual(['no_automation', false, true, [3, 4, 3], 'own_hatch', false, [3, 3, 3]]);
    // the exported structure as it is: the controller, 32 firebricks and 2 lava cells; 25 coke oven bricks round one air cell
    expect([b.cells.length, k.cells.length, [...b.cells, ...k.cells].filter((c) => c.role === 'hatch')]).toEqual([35, 26, []]);
    expect([b.io, k.io]).toEqual([NO_IO, NO_IO]);
    expect(warnings).toEqual([
      { code: 'manual_machine', stepId: 'k', text: 'Coke Oven: GregTech lets items into it only through its own Coke Oven Hatch, which this layout '
        + 'does not place, so nothing of the line touches it: fill and empty it by hand' },
      { code: 'manual_machine', stepId: 'b', text: 'Bricked Blast Furnace: GregTech lets no pipe, conveyor, bus or interface move items in or out of '
        + 'it, so nothing of the line touches it: fill and empty it by hand' },
      { code: 'steam_machine', stepId: 's', text: 'Steam Macerator runs on steam: pipe your steam into its back, the side away from the middle row '
        + '(GregTech takes steam on every side but its front, and its top must stay clear to vent)' }]);
    // the steam machine is on the line's logistics and vents
    expect([unit('s').vent, unit('s').electric, unit('s').io]).toEqual([true, false, { itemIn: true, itemOut: true, fluidIn: [], fluidOut: [] }]);
  });

  it('leaves the units to the hatch rules without the option (machine-to-machine mode is add-on 15\'s)', () => {
    const { units, warnings } = unitsFromPlan(primitivePack(), steelLine());
    const b = units.find((u) => u.stepId === 'b')!;
    // GT's rows for the furnace and the oven (hatch-rules.ts) take no hatch and no power: no unit is run by hand, none
    // vents, and each says so once, with hatch_not_taken and no manual_machine
    expect([b.manual, b.electric, b.cells.some((c) => c.role === 'hatch'), units.some((u) => u.vent !== undefined)]).toEqual([undefined, false, false, false]);
    expect(warnings.map((w) => [w.code, w.stepId])).toEqual([['hatch_not_taken', 'k'], ['hatch_not_taken', 'b'], ['steam_machine', 's']]);
  });
});

describe('primitive machines: placement', () => {
  // raw → b (the furnace) → s (the steam macerator) → out: b is placed last, s first
  const plan = () => makePlan([
    { id: 'b', mteId: BRICKED, count: 1, euPerTick: 0, name: 'Bricked Blast Furnace', inputs: [['t:iron@0', 1]], outputs: [['t:steel@0', 1]] },
    { id: 's', mteId: STEAM, count: 1, euPerTick: 4, name: 'Steam Macerator', inputs: [['t:steel@0', 1]] }]);

  it("turns a steam machine's output side up and keeps the cell above it and its steam inlet behind it empty", () => {
    const p = placeUnits(unitsFromPlan(primitivePack(), plan(), { primitive: true }).units, { headWidth: 1, portSpacing: 0 });
    // s: row N at x 1 (the middle row at z 2), facing it, front west, output side up; b: row S one block back from the
    // middle row (z 4–6 instead of 3–5), its controller in the middle of its front's second layer
    expect(p.units.map((u) => [u.stepId, u.row, u.at, u.facing, u.mainFacing ?? null, u.outputSide ?? null])).toEqual([
      ['s', 'N', [1, 0, 1], 3, 4, UP], ['b', 'S', [1, 0, 4], 2, null, null]]);
    expect(p.blocks.filter((b) => b.role === 'machine').map((b) => [b.stepId, b.pos, b.facing, b.mainFacing ?? null])).toEqual([
      ['s', [1, 0, 1], UP, 4], ['b', [2, 1, 4], 2, null]]);
    expect([p.size, p.spineZ, p.tailX]).toEqual([[5, 4, 8], 2, 4]);
    // kept empty: the steam inlet (1,0,0) and the vent (1,1,1); the furnace's front row z 3 (3 wide, 4 high) and its
    // own air cell (2,3,5)
    expect(p.reserved).toEqual([[1, 0, 0], [1, 0, 3], [1, 1, 1], [1, 1, 3], [1, 2, 3], [1, 3, 3], [2, 0, 3], [2, 1, 3], [2, 2, 3], [2, 3, 3], [2, 3, 5],
      [3, 0, 3], [3, 1, 3], [3, 2, 3], [3, 3, 3]]);
    // the steam machine takes and gives its items on its middle-row side, which takes no cover; the furnace has no port
    expect(p.units.map((u) => u.ports)).toEqual([
      { power: null, items: [[1, 0, 2]], fluidIn: [], fluidOut: [], fluidInSides: [], fluidOutSides: [], itemFaces: [], fluidFaces: [] },
      { power: null, items: [], fluidIn: [], fluidOut: [], fluidInSides: [], fluidOutSides: [], itemFaces: [], fluidFaces: [] }]);
  });

  it('places as before without the option', () => {
    const p = placeUnits(unitsFromPlan(primitivePack(), plan()).units, { headWidth: 1, portSpacing: 0 });
    // b first in row N (its controller at x 2), s in row S at x 1 facing the middle row (north)
    expect(p.blocks.filter((b) => b.role === 'machine').map((b) => [b.stepId, b.facing])).toEqual([['s', 2], ['b', 3]]);
    expect(p.units.some((u) => u.outputSide !== undefined)).toBe(false);
  });
});

describe.each(MODES)('primitive machines in %s mode', (mode) => {
  it.each(ROTATIONS)('keeps the steam vent and inlet empty and nothing of the line touches the furnace or the oven, turned %i°', async (rotation) => {
    const layout = await laid(mode, rotation);
    expect(layout.status).toBe('ok');
    const taken = new Set(layout.blocks.map((b) => key(b.pos)));              // every role, ghosts too
    const steam = layout.blocks.filter((b) => b.role === 'machine' && b.block.mteId === STEAM);
    expect(steam).toHaveLength(1);
    for (const s of steam) {
      expect([s.facing, HORIZONTAL.includes(s.mainFacing ?? -1), s.covers ?? []]).toEqual([UP, true, []]);
      expect(taken.has(key(step(s.pos, UP))), 'a block on the vent').toBe(false);
      const served = servedSide(layout, s);
      expect(served, 'the logistics part on its middle-row side').toBeDefined();
      expect(taken.has(key(step(s.pos, OPPOSITE[served!]!))), 'a block on the steam inlet').toBe(false);
    }
    for (const id of ['k', 'b']) {
      const own = ownBlocks(layout, id);
      expect(own.map((b) => b.role).filter((r) => r !== 'machine' && r !== 'casing'), `${id}: hatches`).toEqual([]);
      expect(own.flatMap((b) => b.covers ?? []), `${id}: covers`).toEqual([]);
      const mine = new Set(own.map((b) => key(b.pos)));
      const touching = layout.blocks.filter((b) => !mine.has(key(b.pos)) && own.some((c) => adjacent(c.pos, b.pos)));
      expect(touching.map((b) => `${b.role} ${b.label}`), `${id}: blocks touching it`).toEqual([]);
      const controller = own.find((b) => b.role === 'machine')!;
      expect(taken.has(key(step(controller.pos, controller.facing!))), `${id}: the block in front of its controller`).toBe(false);
    }
    const placed = layout.blocks.filter((b) => b.role !== 'ghost');
    expect(new Set(placed.map((b) => key(b.pos))).size).toBe(placed.length);
  });

  it('shows the flows of the furnace and the oven as carried by hand in the Connections view, as their hand steps say', async () => {
    const layout = await laid(mode);
    const g = connectionsGraph(layout, steelLine(), 'min');
    const flows = g.edges.filter((e) => e.key !== null);
    const by = (hand: boolean) => flows.filter((e) => (e.via === 'hand') === hand).map((e) => `${e.from} > ${e.to} ${e.key}`);
    // every flow into a machine with a layout:hand:<step>:fill step and out of one with a :empty step; in AE2 mode the
    // steam macerator's output too, which its own empty step takes out by hand
    expect(by(true)).toEqual(['raw > step:k t:coal@0', 'step:k > step:b t:coke@0', 'step:k > out fluid:creosote', 'step:m > step:b t:iron@0',
      'step:b > step:s t:steel@0', 'step:b > out t:ash@0', ...(mode === 'ae2' ? ['step:s > out t:out_s@0'] : [])]);
    expect(by(false)).toHaveLength(mode === 'ae2' ? 1 : 2);
    expect(flows.filter((e) => e.via !== 'hand').every((e) => e.via === { routed: 'routed', ae2: 'ae2', enderio: 'item_conduit' }[mode])).toBe(true);
    // a hand link names no conduit face or channel, says so, and gives the hand steps' words
    const iron = flows.find((e) => e.to === 'step:b' && e.key === 't:iron@0')!;
    // (the fixture's plan names no goods, so the label shows the key)
    expect([iron.label, iron.color, iron.fromFace, iron.toFace, iron.lines[0]]).toEqual(['t:iron@0 60/min · by hand', null, null, null, 'By hand']);
    expect(iron.lines.at(-1)).toBe(layout.buildSteps.find((s) => s.id === 'layout:hand:b:fill')!.text);
    // in the 3D view a hand link from your storage has nothing in the line to start from
    const spans = connectionSpans(layout, g);
    expect(spans.some((s) => s.edge === flows.find((e) => e.key === 't:coal@0')!.id)).toBe(false);
    expect(spans.some((s) => s.edge === iron.id)).toBe(true);
  });

  it('fills and empties the furnace and the oven by hand and says why', async () => {
    const layout = await laid(mode);
    const steps = new Map(layout.buildSteps.map((s) => [s.id, s.text]));
    const line = mode === 'ae2' ? 'your ME system' : null;
    expect(['layout:hand:k:fill', 'layout:hand:k:empty', 'layout:hand:b:fill', 'layout:hand:b:empty'].map((id) => steps.get(id))).toEqual([
      'Fill the Coke Oven by hand: 1× Coal a run (from your storage)',
      'Empty the Coke Oven by hand: Coal Coke into the Bricked Blast Furnace and Creosote into your storage',
      `Fill the Bricked Blast Furnace by hand: 1× Iron Ingot + 2× Coal Coke a run (Iron Ingot from ${line ?? 'the output chest'}, Coal Coke from the Coke Oven)`,
      `Empty the Bricked Blast Furnace by hand: Steel Ingot into ${line ?? 'the input chest'} and Dark Ash into your storage`]);
    expect(layout.warnings.filter((w) => w.code === 'manual_machine').map((w) => w.stepId)).toEqual(['k', 'b']);
    // the line's own step says where its parts do not meet a machine at its output side
    expect(steps.get('layout:logistics:line')).toContain("output side or bus (a steam machine's middle-row side instead, as its output side faces "
      + 'up; the Coke Oven and the Bricked Blast Furnace get nothing)');
    expect(steps.get('layout:place:b')).toBe('Build 1× Bricked Blast Furnace (3×4×3) with the controller facing the middle row, one block back from '
      + 'it, and keep the blocks in front of it free: it gets no hatches, covers, pipes or power, as you fill and empty it by hand through its controller');
    expect(steps.get('layout:place:s')).toBe('Place 1× Steam Macerator with its output side facing up and nothing above it (GregTech vents its steam '
      + 'there after every run, and waits while that side is covered or blocked) and its front facing west: with a Wrench, sneak-right-click its '
      + 'west side to make that the front (where a neighbour covers that side, click the edge of the wrench grid toward it), then right-click its top '
      + 'to make that the output side; pipe its steam into its back, the side away from the middle row');
    // a steam machine takes its items on a side that is not its output side: no Input from Output Side to set
    const s = layout.blocks.find((b) => b.role === 'machine' && b.block.mteId === STEAM)!;
    expect(s.config?.inputFromOutputSide).toBeUndefined();
    // the furnace and the oven draw no power: only the macerator's LV machine is wired
    expect(layout.blocks.filter((b) => b.role === 'hatch')).toEqual([]);
  });

  it('roofs the line above every steam machine, whose top stays open', async () => {
    // the line is as tall as the furnace (4 blocks); the block above the steam macerator is its vent, under the roof
    const layout = await laid(mode);
    expect(layout.buildSteps.find((s) => s.id === 'layout:roof')?.text).toBe('Roof the line over its 4-high space: GT machines left in the rain '
      + 'can catch fire or explode, and each steam machine vents its steam through its top: keep the block above it open and roof above it');
  });

  it('sends the projector the same output side and nothing on the vent', async () => {
    const layout = await laid(mode, 90);
    const payload = projectorPayload(makeProject({ logistics: mode }), layout, primitivePack());
    const s = payload.blocks.filter((b) => b.mteId === STEAM);
    expect(s.map((b) => [b.facing, b.facingIsOutput, HORIZONTAL.includes(b.mainFacing ?? -1)])).toEqual([[UP, true, true]]);
    expect(payload.blocks.some((b) => key(b.pos) === key(step(s[0]!.pos, UP)))).toBe(false);
  });
});

describe('primitive machines, mode by mode', () => {
  it('routed: the steam machine gets its interface pipe on its middle-row side; the chests carry what goes to and from the hand-run furnace', async () => {
    const layout = await laid('routed');
    const s = layout.blocks.find((b) => b.role === 'machine' && b.block.mteId === STEAM)!;
    const pipe = layout.blocks.find((b) => b.label === 'Routed Interface Pipe (Steam Macerator)')!;
    expect([adjacent(pipe.pos, s.pos), pipe.config]).toEqual([true, { chips: 'Item Responder Chip (whitelist: Steel Ingot) + Item Extractor Chip' }]);
    expect(layout.blocks.filter((b) => b.tail !== undefined).map((b) => b.tail)).toEqual([
      { side: 'input', keys: ['t:in@0', 't:steel@0'] }, { side: 'output', keys: ['t:iron@0', 't:out_s@0'] }]);
    expect(layout.blocks.find((b) => b.label === 'Routed Interface Pipe (output chest)')?.config).toEqual({
      chips: 'Item Responder Chip (whitelist: Iron Ingot and Steel Dust)' });
  });

  it('ae2: the steam machine gets its interface but no cover, and what it makes is taken out by hand', async () => {
    const layout = await laid('ae2');
    const s = layout.blocks.find((b) => b.role === 'machine' && b.block.mteId === STEAM)!;
    expect([s.covers, layout.blocks.some((b) => b.label === 'ME Interface (Steam Macerator)' && adjacent(b.pos, s.pos))]).toEqual([undefined, true]);
    expect(layout.warnings.filter((w) => w.code === 'steam_items')).toEqual([{ code: 'steam_items', stepId: 's', text: 'Steam Macerator takes no '
      + 'conveyor cover (GregTech allows none on a steam machine) and never pushes out what it makes, so no ME interface gets Steel Dust back from '
      + 'it: take it out by hand' }]);
    expect(layout.buildSteps.find((x) => x.id === 'layout:hand:s:empty')?.text).toBe('Empty the Steam Macerator by hand: Steel Dust into your storage');
  });

  it('enderio: the steam machine is met In / Out on its middle-row side; the chests carry what goes to and from the hand-run furnace', async () => {
    const layout = await laid('enderio');
    const s = layout.blocks.find((b) => b.role === 'machine' && b.block.mteId === STEAM)!;
    const faces = layout.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((f) => ({ ...f, at: b.pos }))))
      .filter((f) => f.target === 'Steam Macerator' && adjacent(f.at, s.pos));
    expect(faces.map((f) => [f.mode, f.insert?.outputSide ?? null, f.extract?.filter?.keys, f.insert?.filter?.keys])).toEqual([
      ['in_out', null, ['t:out_s@0'], ['t:steel@0']]]);
    expect(layout.blocks.filter((b) => b.tail !== undefined).map((b) => b.tail)).toEqual([
      { side: 'input', keys: ['t:in@0', 't:steel@0'] }, { side: 'output', keys: ['t:iron@0', 't:out_s@0'] }]);
    expect(layout.warnings.some((w) => w.code === 'steam_items')).toBe(false);
  });

  it('enderio: lays no conduit on a steam machine\'s vent for fluids its step lists, and says so', async () => {
    const pack = primitivePack();
    pack.machines.set(IDS.SOLIDIFIER, { ...pack.machines.get(IDS.SOLIDIFIER)!, name: 'Steam Solidifier', kind: 'steam' });
    const plan = makePlan([{ id: 'y', mteId: IDS.SOLIDIFIER, count: 1, name: 'Steam Solidifier', inputs: [['fluid:molten.iron', 144], ['t:in@0', 1]] }],
      { flows: [{ from: 'raw', to: 'y', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'raw', to: 'y', key: 't:in@0', perSecond: 1 },
        { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });
    const layout = await layoutLine(pack, plan, lineScan(), makeProject({ logistics: 'enderio', placement: { origin: [30, 64, 10], rotation: 0 } }), lineGround());
    const y = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'y')!;
    expect([y.facing, layout.blocks.some((b) => key(b.pos) === key(step(y.pos, UP)))]).toEqual([UP, false]);
    expect(layout.blocks.some((b) => b.conduits?.some((c) => c.kind !== 'item'))).toBe(false);
    expect(layout.warnings).toContainEqual({ code: 'steam_fluids', stepId: 'y', text: 'Steam Solidifier vents steam through its top, so the line lays '
      + 'no pipe to it: move Molten Iron by hand' });
  });

  it('leaves machine-to-machine mode as it was (add-on 15 lays it out)', async () => {
    const layout = await laid('direct');
    const s = layout.blocks.find((b) => b.role === 'machine' && b.block.mteId === STEAM)!;
    expect([s.facing === UP, layout.warnings.some((w) => w.code === 'manual_machine'), layout.buildSteps.some((x) => x.id.startsWith('layout:hand:'))])
      .toEqual([false, false, false]);
    // the hatch rules (hatch-rules.ts) put no hatch on the furnace there either, and it says so once
    expect(ownBlocks(layout, 'b').some((b) => b.role === 'hatch')).toBe(false);
    expect(layout.warnings.filter((w) => w.stepId === 'b').map((w) => w.code)).toEqual(['hatch_not_taken']);
  });
});

describe('primitive machines: where their goods come from and go', () => {
  it('names a machine of yours the line does not place, and the end of the line for a fluid', async () => {
    // m is a macerator you own (no unit); the oven's Creosote goes to a fluid solidifier on the line, which gets it from
    // a pipe that starts at the end of the line, as from any fluid that enters it
    const plan = makePlan([
      { id: 'm', mteId: IDS.MACERATOR, count: 1, owned: 1, inputs: [['t:in@0', 1]], outputs: [['t:iron@0', 1]] },
      { id: 'k', mteId: COKE, count: 1, euPerTick: 0, name: 'Coke Oven', inputs: [['t:coal@0', 1]], outputs: [['t:coke@0', 1], ['fluid:creosote', 500]] },
      { id: 'b', mteId: BRICKED, count: 1, euPerTick: 0, name: 'Bricked Blast Furnace', inputs: [['t:iron@0', 1], ['t:coke@0', 2]], outputs: [['t:steel@0', 1]] },
      { id: 'y', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:creosote', 500]], outputs: [['t:out_y@0', 1]] }],
      { flows: [{ from: 'raw', to: 'm', key: 't:in@0', perSecond: 1 }, { from: 'm', to: 'b', key: 't:iron@0', perSecond: 1 },
        { from: 'raw', to: 'k', key: 't:coal@0', perSecond: 1 }, { from: 'k', to: 'b', key: 't:coke@0', perSecond: 2 },
        { from: 'k', to: 'y', key: 'fluid:creosote', perSecond: 500 }, { from: 'b', to: 'out', key: 't:steel@0', perSecond: 1 },
        { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }] });
    const layout = await laid('routed', 0, plan);
    const steps = new Map(layout.buildSteps.map((x) => [x.id, x.text]));
    expect([steps.get('layout:hand:k:empty'), steps.get('layout:hand:b:fill')]).toEqual([
      'Empty the Coke Oven by hand: Coal Coke into the Bricked Blast Furnace and Creosote into the end of the line',
      'Fill the Bricked Blast Furnace by hand: 1× Iron Ingot + 2× Coal Coke a run (Iron Ingot from your Basic Macerator, Coal Coke from the Coke Oven)']);
    // the Creosote pipe runs from above the tail to the solidifier's top, and touches neither the oven nor the furnace
    const pipes = layout.blocks.filter((b) => b.label.endsWith('(Creosote)'));
    expect(pipes.length).toBeGreaterThan(1);
    const y = layout.blocks.find((b) => b.role === 'machine' && b.stepId === 'y')!;
    expect(pipes.some((b) => key(b.pos) === key(step(y.pos, UP)))).toBe(true);
    for (const id of ['k', 'b']) {
      const own = ownBlocks(layout, id);
      expect(pipes.filter((b) => own.some((c) => adjacent(c.pos, b.pos))), id).toEqual([]);
    }
  });
});

describe('primitive machines next to the power head', () => {
  it.each(MODES)('%s: a furnace first in its row keeps a block from the power head', async (mode) => {
    // m (LV, fed from the MV tap through a bank: a head 3 columns wide) stands first in row N; the furnace is first in row S
    const plan = makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1, inputs: [['t:in@0', 1]], outputs: [['t:iron@0', 1]] },
      { id: 'b', mteId: BRICKED, count: 1, euPerTick: 0, name: 'Bricked Blast Furnace', inputs: [['t:iron@0', 1]], outputs: [['t:steel@0', 1]] }]);
    const layout = await laid(mode, 0, plan);
    const own = ownBlocks(layout, 'b');
    const mine = new Set(own.map((b) => key(b.pos)));
    expect(layout.blocks.filter((b) => !mine.has(key(b.pos)) && own.some((c) => adjacent(c.pos, b.pos))).map((b) => `${b.role} ${b.label}`)).toEqual([]);
    expect(Math.min(...own.map((b) => b.pos[0])) - layout.origin[0]).toBe(4);
  });
});

describe('primitive machines in a line of their own', () => {
  it.each(MODES)('%s: a coke oven and a furnace alone still get their hand steps', async (mode) => {
    const plan = makePlan([
      { id: 'k', mteId: COKE, count: 1, euPerTick: 0, name: 'Coke Oven', inputs: [['t:coal@0', 1]], outputs: [['t:coke@0', 1]] },
      { id: 'b', mteId: BRICKED, count: 2, euPerTick: 0, name: 'Bricked Blast Furnace', inputs: [['t:iron@0', 1], ['t:coke@0', 2]], outputs: [['t:steel@0', 1]] }],
      { flows: [{ from: 'raw', to: 'k', key: 't:coal@0', perSecond: 1 }, { from: 'k', to: 'b', key: 't:coke@0', perSecond: 1 },
        { from: 'raw', to: 'b', key: 't:iron@0', perSecond: 1 }, { from: 'b', to: 'out', key: 't:steel@0', perSecond: 1 }] });
    const layout = await laid(mode, 0, plan);
    expect(layout.status).toBe('ok');
    expect(layout.buildSteps.filter((s) => s.id.startsWith('layout:hand:')).map((s) => s.text)).toEqual([
      'Fill the Coke Oven by hand: 1× Coal a run (from your storage)',
      'Empty the Coke Oven by hand: Coal Coke into each Bricked Blast Furnace',
      'Fill each Bricked Blast Furnace (2×) by hand: 1× Iron Ingot + 2× Coal Coke a run (Iron Ingot from your storage, Coal Coke from the Coke Oven)',
      'Empty each Bricked Blast Furnace (2×) by hand: Steel Ingot into your storage']);
    // nothing to power and nothing for the logistics to move: no cable, no pipe, no interface, no chest
    expect(layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost' && b.stepId === undefined).map((b) => b.role)).toEqual([]);
  });
});
