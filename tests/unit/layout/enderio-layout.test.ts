import { describe, it, expect } from 'vitest';
import { hookupPath, logisticsHookup } from '../../../src/server/layout/hookups.ts';
import { hookupKeepOff, layoutLine } from '../../../src/server/layout/layout.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { makePins } from '../../../src/server/layout/pins.ts';
import { assignBuildSteps, bomFromBlocks, layoutSteps, type StepsInput } from '../../../src/server/layout/steps.ts';
import { faceName } from '../../../src/shared/layout/configure-text.ts';
import { DIRS, manhattan, posKey, rotateConnections, rotateFace, sideToward, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { conduitBlockRef, FACES, type Face } from '../../../src/shared/types/assets.ts';
import type { ConduitFace, ConduitSpec, Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { BuildStep } from '../../../src/shared/types/plan.ts';
import { flatVoxels, IDS, layoutPack, makePlan, makeProject } from '../../helpers/layout-fixtures.ts';
import { BASIC, ENDER, ITEM, basic, fluidPlan, lineGround, lineScan, setup, twoStep } from '../../helpers/enderio-fixtures.ts';

const placed = (rotation: 0 | 90 | 180 | 270) => makeProject({ logistics: 'enderio', placement: { origin: [30, 64, 10], rotation } });
/**
 * A singleblock's Input from Output Side in a builder's words (GT 5.09.54 `MTEBasicMachine`): every constructor turns it
 * on, so a machine placed from a newly crafted item has it; a Screwdriver right-click on the front or the output side
 * switches it and says the new state in chat (a sneaking one switches the Input Filter), and a click on a side also
 * works that side's cover.
 */
const FROM_OUTPUT_SIDE = 'Input from Output Side allowed: a newly crafted machine starts with it on, and a Screwdriver right-click on its front, '
  + 'or on its output side where no cover sits, switches it, so leave it where the chat says "Input from Output Side allowed" '
  + '(a sneak-click switches the Input Filter instead)';
const faceList = (l: Layout, turn: (f: Face) => Face) =>
  l.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((f) => `${c.kind} ${turn(f.face)} ${f.mode} ${f.target}`))).sort();
const linkList = (l: Layout, turn: (n: number) => number) => l.blocks.flatMap((b) => (b.conduits ?? []).map((c) => `${c.kind} ${turn(c.connections)}`)).sort();

describe('an EnderIO line in the layout', () => {
  it('puts every conduit and filter in the parts list and gives every configured face its own configure step', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), lineScan(), placed(0), lineGround());
    expect([layout.status, layout.mode, layout.rotation]).toEqual(['ok', 'enderio', 0]);
    expect(layout.bom).toContainEqual({ key: ITEM, amount: 4, why: 'conduits', group: 'logistics' });
    expect(layout.bom).toContainEqual({ key: BASIC, amount: 8, why: 'conduit filters', group: 'logistics' });
    const steps = layout.buildSteps.filter((s) => s.id.startsWith('layout:conduit:'));
    // plan 11, ruling R12: the line's power head is 3 columns wide, so its spine starts at local x 3; Plan 5's tier
    // spacing leaves x 4 empty between the LV macerators (x 3) and the MV assembler (x 5), and the tail is x 6
    expect(steps.map((s) => s.id)).toEqual(['layout:conduit:3,0,2:item:north', 'layout:conduit:3,0,2:item:south', 'layout:conduit:5,0,2:item:north',
      'layout:conduit:6,0,2:item:north', 'layout:conduit:6,0,2:item:south']);
    expect(steps.every((s) => s.kind === 'configure' && s.pin === layout.pins.find((p) => p.kind === 'site')!.n)).toBe(true);
    expect(steps[3]!.text).toBe('Item Conduit, north face to Chest (input): Extract; extract on Blue with a Basic Item Filter '
      + '(whitelist: Raw Input; match meta, ignore NBT), round robin on, self feed off, redstone Always active');
    expect(layout.buildSteps.find((s) => s.id === 'layout:configure:s1')!.text).toBe(`Basic Macerator ×2: ${FROM_OUTPUT_SIDE}`);
    // the machines' In / Out faces remind the builder of it: they insert through the output side
    expect(steps[0]!.text.endsWith('priority 1, into its output side: keep its Input from Output Side allowed (a newly crafted machine has it on)')).toBe(true);
    expect(layout.blocks.filter((b) => b.conduits !== undefined).every((b) => b.buildStep === 'layout:logistics:line')).toBe(true);
  });

  it('turns every conduit face with the line', async () => {
    const pack = layoutPack();
    const flat = await layoutLine(pack, twoStep(), lineScan(), placed(0), lineGround());
    const turned = await layoutLine(pack, twoStep(), lineScan(), placed(90), lineGround());
    expect(turned.rotation).toBe(90);
    expect(faceList(turned, (f) => f)).toEqual(faceList(flat, (f) => rotateFace(f, 90)));
    expect(linkList(turned, (n) => n)).toEqual(linkList(flat, (n) => rotateConnections(n, 90)));
    const chestStep = turned.buildSteps.find((s) => s.text.includes('to Chest (input)'))!;
    expect(chestStep.text.startsWith(`Item Conduit, ${faceName(rotateFace('north', 90))} face to Chest (input): Extract`)).toBe(true);
  });

  it("ends an EnderIO hookup on an Insert face into the input chest and asks for the storage tap's Extract face", async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] }), placed(0), lineGround());
    const hookup = layout.hookups.findIndex((h) => h.kind === 'logistics');
    expect(layout.hookups[hookup]!.found).toBe(true);
    const end = layout.blocks.find((b) => b.hookup === hookup && b.conduits !== undefined)!;
    const chest = layout.blocks.find((b) => b.tail?.side === 'input')!;
    expect(end.conduits![0]!.faces).toEqual([{ face: FACES[sideToward(end.pos, chest.pos)], mode: 'insert', target: 'Chest (input)',
      insert: { color: 'green', filter: basic(['t:in@0']), rate: 1, priority: 1 } }]);
    expect(layout.buildSteps.find((s) => s.id === 'layout:configure:conduit-tap')!.text).toBe('At the storage tap set the conduit face toward your storage '
      + 'to Extract (In / Out if it already inserts); extract on Green with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), '
      + 'round robin off, self feed off, redstone Always active');
    expect(layout.bom).toContainEqual({ key: BASIC, amount: 10, why: 'conduit filters; filter at the storage tap', group: 'logistics' });
    const endStep = layout.buildSteps.find((s) => s.id.startsWith('layout:conduit:') && s.text.includes('insert on Green'))!;
    expect(endStep.pin).toBe(layout.pins.find((p) => p.kind === 'logistics')!.n);
  });

  it('gives the fluid conduits to the fluid step', async () => {
    const layout = await layoutLine(layoutPack(), fluidPlan(), lineScan(), placed(0), lineGround());
    const fluidOnly = layout.blocks.filter((b) => b.conduits !== undefined && b.conduits.every((c) => c.kind !== 'item'));
    expect(fluidOnly.length).toBeGreaterThan(0);
    expect(fluidOnly.every((b) => b.buildStep === 'layout:logistics:fluids')).toBe(true);
  });

  it('marks the tail chests of the other modes too', () => {
    const chests = (mode: 'direct' | 'routed') =>
      buildMode(mode, { ...setup(twoStep(), PORT_SPACING[mode]), network: null }).blocks.filter((b) => b.role === 'chest').map((b) => b.tail);
    expect(chests('direct')).toEqual([{ side: 'input', keys: ['t:in@0'] }, { side: 'output', keys: ['t:out_s2@0'] }]);
    expect(chests('routed')).toEqual([{ side: 'input', keys: ['t:in@0'] }, { side: 'output', keys: ['t:out_s2@0'] }]);
  });
});

// ---- The details the plan's tests leave open ----

const SPEED = 'EnderIO:itemExtractSpeedUpgrade@0';
const ADVANCED = 'EnderIO:itemBasicFilterUpgrade@1';
const NAMES: Record<string, string> = {
  't:in@0': 'Raw Input', 't:dust@0': 'Titanium Dust', 'fluid:molten.iron': 'Molten Iron', [BASIC]: 'Basic Item Filter', [ADVANCED]: 'Advanced Item Filter',
  [SPEED]: 'Item Conduit Speed Upgrade',
};
const nameOf = (k: string) => NAMES[k] ?? k;
const stepsInput = (over: Partial<StepsInput>): StepsInput => ({ status: 'ok', pins: [], size: [6, 1, 5], site: null, units: [], stages: [],
  transformerName: () => 'Low Voltage Transformer', cables: [], power: null, supplyTier: null, drafts: [], fluids: [], logistics: null, reuse: [],
  blocks: [], origin: [0, 64, 0], nameOf, ...over });

/** The hookup's end face of Task 3's storage hookup: Insert on Green into the input chest at priority 1, whitelisting Raw Input. */
const END_FACE: Omit<ConduitFace, 'face'> = { mode: 'insert', target: 'Chest (input)', insert: { color: 'green', filter: basic(['t:in@0']), rate: 1, priority: 1 } };

/**
 * A bundle (an Item Conduit with an In / Out face, Basic extract filter, 2 speed upgrades and Advanced insert filter, and a
 * Disabled face; an Ender Fluid Conduit with its own fluid filter), a hookup's end cell, a ghost conduit and a set machine.
 */
function conduitBlocks(): LayoutBlock[] {
  return [
    { pos: [1, 64, 1], block: { id: 'gregtech:gt.blockmachines', meta: 0, mteId: IDS.MACERATOR }, role: 'machine', label: 'Basic Macerator', stepId: 's1',
      config: { inputFromOutputSide: true } },
    { pos: [1, 64, 2], block: conduitBlockRef('item'), role: 'pipe', label: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', item: ITEM, connections: 2 | 4,
      conduits: [
        { kind: 'item', item: ITEM, connections: 0, faces: [
          { face: 'north', mode: 'in_out', target: 'Basic Macerator',
            extract: { color: 'red', filter: basic(['t:dust@0']), rate: 20, roundRobin: false, selfFeed: false, redstone: 'ignore', speed: { item: SPEED, count: 2 } },
            insert: { color: 'blue', filter: { ...basic(['t:in@0']), item: ADVANCED }, rate: 1, priority: 1, outputSide: true } },
          { face: 'south', mode: 'disabled', target: 'Basic Macerator' }] },
        { kind: 'liquid_ender', item: ENDER, connections: 0, faces: [{ face: 'up', mode: 'extract', target: 'your tank',
          extract: { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1, roundRobin: false, redstone: 'ignore' } }] },
      ] },
    { pos: [2, 65, 1], block: conduitBlockRef('item'), role: 'pipe', label: 'Item Conduit', item: ITEM, hookup: 0, connections: 1 | 16,
      conduits: [{ kind: 'item', item: ITEM, connections: 16, faces: [{ face: 'down', ...END_FACE }] }] },
    { pos: [3, 64, 2], block: conduitBlockRef('item'), role: 'ghost', label: 'existing Item Conduit', connections: 4,
      conduits: [{ kind: 'item', item: ITEM, connections: 0, faces: [{ face: 'north', ...END_FACE }] }] },
  ];
}

describe('EnderIO conduits in the steps, the parts list and the hookup', () => {
  it('writes one step per face of every placed conduit after the block settings and before the base settings (plan 11, ruling R15)', () => {
    const pins = makePins({ dim: 0, site: { center: [5, 64, 5], text: 's' }, power: null, logistics: { pos: [9, 64, 9], text: 'l' }, reuse: [], warnings: [] });
    const steps = layoutSteps(stepsInput({ pins, blocks: conduitBlocks(),
      drafts: [{ id: 'layout:configure:conduit-tap', kind: 'configure', pin: 'logistics', text: 'At the storage tap set the conduit face to Extract' }] }));
    expect(steps.filter((s) => s.kind === 'configure').map((s) => [s.id, s.pin, s.text])).toEqual([
      ['layout:configure:s1', 1, `Basic Macerator: ${FROM_OUTPUT_SIDE}`],
      ['layout:conduit:1,0,2:item:north', 1, 'Item Conduit, north face to Basic Macerator: In / Out; extract on Red with a Basic Item Filter (whitelist: '
        + 'Titanium Dust; match meta, ignore NBT), 2× Item Conduit Speed Upgrade, round robin off, self feed off, redstone Always active; insert on Blue '
        + 'with an Advanced Item Filter (whitelist: Raw Input; match meta, ignore NBT), priority 1, into its output side: keep its Input from Output Side '
        + 'allowed (a newly crafted machine has it on)'],
      ['layout:conduit:1,0,2:item:south', 1, 'Item Conduit, south face to Basic Macerator: Disabled'],
      ['layout:conduit:1,0,2:liquid_ender:up', 1, 'Ender Fluid Conduit, top face to your tank: Extract; extract on Red with a fluid filter (whitelist: '
        + 'Molten Iron), round robin off, redstone Always active'],
      ['layout:conduit:2,1,1:item:down', 2, 'Item Conduit, bottom face to Chest (input): Insert; insert on Green with a Basic Item Filter (whitelist: '
        + 'Raw Input; match meta, ignore NBT), priority 1'],
      ['layout:configure:conduit-tap', 2, 'At the storage tap set the conduit face to Extract']]);
    expect(layoutSteps(stepsInput({ status: 'empty', blocks: conduitBlocks() })).some((s) => s.id.startsWith('layout:conduit:'))).toBe(false);
  });

  it("counts every conduit of a placed block, every side's filter upgrade and every speed upgrade instead of the block's item", () => {
    expect(bomFromBlocks(conduitBlocks(), [{ key: BASIC, amount: 1, why: 'filter at the storage tap', group: 'logistics' }])).toEqual([
      { key: BASIC, amount: 3, why: 'conduit filters; filter at the storage tap', group: 'logistics' },
      { key: ADVANCED, amount: 1, why: 'conduit filters', group: 'logistics' },
      { key: SPEED, amount: 2, why: 'conduit speed upgrades', group: 'logistics' },
      { key: ITEM, amount: 2, why: 'conduits; logistics hookup', group: 'logistics' },
      { key: ENDER, amount: 1, why: 'conduits', group: 'logistics' }]);
  });

  it('gives a block of fluid conduits only to the fluid step, a bundle to the line step and a hookup block to its hookup', () => {
    const [, bundle, end] = conduitBlocks();
    const fluidOnly: LayoutBlock = { ...bundle!, pos: [1, 65, 2], label: 'Ender Fluid Conduit', item: ENDER, conduits: [bundle!.conduits![1]!] };
    const steps = (ids: string[]): BuildStep[] => ids.map((id, i) => ({ id, order: i + 1, text: id, kind: 'logistics' }));
    const input = { cables: [], stages: [], transformerName: () => '', fluids: [] };
    const hookups = [{ kind: 'logistics' as const, from: { pos: [9, 64, 9] as Vec3, dim: 0, kind: 'pipe' as const, networkId: 'e' }, path: [], parts: [] }];
    const owners = (ids: string[]) => assignBuildSteps([fluidOnly, bundle!, end!], steps(ids), input, hookups).map((b) => b.buildStep);
    expect(owners(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:hookup']))
      .toEqual(['layout:logistics:fluids', 'layout:logistics:line', 'layout:logistics:hookup']);
    // without a fluid step the fluid conduits fall to the line step, like any pipe
    expect(owners(['layout:logistics:line'])).toEqual(['layout:logistics:line', 'layout:logistics:line', 'layout:logistics:line']);
  });

  it('sets the end face on a hookup end that touches its port, linked toward the hookup only, and none on an end that does not (plan 11, ruling R13)', () => {
    const pack = layoutPack();
    const hookAt = (port: Vec3, line: ReadonlySet<string>, maxNodes?: number) => logisticsHookup({ pack, parts: resolveParts(pack),
      tap: { pos: [0, 64, 0], dim: 0, kind: 'pipe', networkId: 'e' }, ports: [port], world: { vox: null, line }, part: 'eio_item_conduit', end: null,
      endConduit: { kind: 'item', face: END_FACE }, ...(maxNodes === undefined ? {} : { maxNodes }) });
    const port: Vec3 = [7, 64, 0];
    const hook = (line: ReadonlySet<string>) => hookAt(port, line);
    const touching = hook(new Set([posKey(port)]));
    expect(touching.blocks.map((b) => [b.pos[0], b.conduits !== undefined])).toEqual([[1, false], [2, false], [3, false], [4, false], [5, false], [6, true]]);
    const last = touching.blocks.at(-1)!;
    expect(last.connections).toBe(16 | 32);                      // toward the hookup (west) and the chest (east)
    expect(last.conduits).toEqual([{ kind: 'item', item: ITEM, connections: 16, faces: [{ face: 'east', ...END_FACE }] }]);
    // every cell around the port is the line's, so the guide's last laid cell stops short of it
    const enclosed = hook(new Set([port, ...DIRS.map((_, side) => step(port, side))].map(posKey)));
    expect(enclosed.blocks.at(-1)!.pos).toEqual([5, 64, 0]);
    expect(enclosed.blocks.some((b) => b.conduits !== undefined)).toBe(false);
    // a straight guide, the last resort (here a node budget of 1 leaves the dashed guide's search nothing), may pass
    // the port before it ends: only its last cell gets the face
    const passing = hookAt([3, 64, 1], new Set([posKey([3, 64, 1])]), 1);
    expect(passing.blocks.map((b) => [b.pos, b.conduits?.[0]?.faces.map((f) => f.face)])).toEqual([
      [[0, 64, 1], undefined], [[1, 64, 1], undefined], [[2, 64, 1], undefined], [[3, 64, 0], ['south']]]);
  });

  it('routes a hookup and its dashed guide around the cells it keeps off; only a straight guide crosses them (plan 11, ruling R14)', () => {
    const vox = flatVoxels({ origin: [-4, 60, -4], size: [30, 12, 20], groundY: 63 });
    const straight = hookupPath({ vox, line: new Set() }, [0, 64, 0], [[7, 64, 0]]);
    expect(straight.path).toEqual([[1, 64, 0], [2, 64, 0], [3, 64, 0], [4, 64, 0], [5, 64, 0], [6, 64, 0]]);
    const keepOff = new Set(straight.path.slice(1, -1).map(posKey));
    const around = hookupPath({ vox, line: new Set(), keepOff }, [0, 64, 0], [[7, 64, 0]]);
    expect(around.found).toBe(true);
    expect(around.path.some((p) => keepOff.has(posKey(p)))).toBe(false);
    // without voxels the dashed guide searches round them as the route does; a straight guide, the last resort when
    // even that finds nothing (here a node budget of 1), crosses them
    expect(hookupPath({ vox: null, line: new Set(), keepOff }, [0, 64, 0], [[7, 64, 0]])).toEqual({ path: around.path, found: false });
    expect(hookupPath({ vox: null, line: new Set(), keepOff }, [0, 64, 0], [[7, 64, 0]], 1)).toEqual({ path: straight.path, found: false });
  });

  it("keeps an EnderIO hookup off every cell next to the line's Item Conduits (plan 11, ruling R14)", async () => {
    const run = () => layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] }), placed(0), lineGround());
    const layout = await run();
    const hookup = layout.hookups.find((h) => h.kind === 'logistics')!;
    const lineConduits = layout.blocks.filter((b) => b.hookup === undefined && b.conduits?.some((c) => c.kind === 'item') === true);
    expect([hookup.found, lineConduits.length]).toEqual([true, 4]);
    expect(hookup.path.filter((p) => lineConduits.some((b) => manhattan(b.pos, p) === 1))).toEqual([]);
    expect(JSON.stringify(await run())).toBe(JSON.stringify(layout));
  });

  it('keeps an EnderIO hookup off every cell next to a line machine, hatch or chest but the input chest (plan 11, ruling R14 as widened in the Task 5 review)', async () => {
    // an item conduit joins any inventory it touches, and a hookup cell other than the last sets no face there
    const contacts = async (tap: Vec3, rotation: 0 | 90) => {
      const layout = await layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: 'enderio', taps: [tap] }] }), placed(rotation), lineGround());
      const hookup = layout.hookups.findIndex((h) => h.kind === 'logistics');
      const inventories = layout.blocks.filter((b) => b.hookup === undefined && (b.role === 'machine' || b.role === 'hatch' || b.role === 'chest')
        && b.tail?.side !== 'input');
      const touching = layout.blocks.filter((b) => b.hookup === hookup && inventories.some((m) => manhattan(m.pos, b.pos) === 1)).map((b) => posKey(b.pos));
      return { tap: posKey(tap), rotation, found: layout.hookups[hookup]?.found, touching };
    };
    const cases = [];
    for (const tap of [[26, 64, 12], [20, 64, 40]] as Vec3[]) for (const rotation of [0, 90] as const) cases.push(await contacts(tap, rotation));
    expect(cases).toEqual([
      { tap: '26,64,12', rotation: 0, found: true, touching: [] }, { tap: '26,64,12', rotation: 90, found: true, touching: [] },
      { tap: '20,64,40', rotation: 0, found: true, touching: [] }, { tap: '20,64,40', rotation: 90, found: true, touching: [] }]);
  });

  it("keeps off the cells next to a line block with an Item Conduit, a machine, a hatch such as a multiblock's bus, or a chest other than the port", () => {
    // blocks 10 apart, so their neighbours never meet; a fluid-only conduit, a GT pipe, a cable, a casing and a
    // transformer join no item conduit, and the port's own chest is where the hookup ends
    const at = (x: number, role: LayoutBlock['role'], label: string, more: Partial<LayoutBlock> = {}): LayoutBlock =>
      ({ pos: [x, 64, 0], block: { id: 'minecraft:stone', meta: 0 }, role, label, ...more });
    const item: ConduitSpec = { kind: 'item', item: ITEM, connections: 0, faces: [] };
    const fluid: ConduitSpec = { kind: 'liquid_ender', item: ENDER, connections: 0, faces: [] };
    const blocks = [
      at(0, 'chest', 'Chest (input)', { tail: { side: 'input', keys: ['t:in@0'] } }), at(10, 'chest', 'Chest (output)', { tail: { side: 'output', keys: [] } }),
      at(20, 'machine', 'Basic Macerator'), at(30, 'hatch', 'Input Bus (ULV)'), at(40, 'pipe', 'Item Conduit', { conduits: [item] }),
      at(50, 'pipe', 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', { conduits: [item, fluid] }),
      at(60, 'pipe', 'Ender Fluid Conduit', { conduits: [fluid] }), at(70, 'pipe', 'Tin Item Pipe'), at(80, 'cable', '1x Tin Cable'),
      at(90, 'casing', 'Heat Proof Machine Casing'), at(100, 'transformer', 'Low Voltage Transformer'),
    ];
    const around = (x: number) => DIRS.map((_, side) => posKey(step([x, 64, 0], side)));
    expect([...hookupKeepOff(blocks, [0, 64, 0])].sort()).toEqual([10, 20, 30, 40, 50].flatMap(around).sort());
  });

  it('routes an EnderIO hookup from a tap beside the output chest round it and round the end of the Item Conduit', async () => {
    // the tap is two cells south of the cell east of the output chest, and stone east of the tail column and above the
    // cell between leaves the shortest way north along the tail, past the output chest and the conduit's end; kept off
    // both, the hookup goes round the stone instead
    const plain = await layoutLine(layoutPack(), twoStep(), lineScan(), placed(0), lineGround());
    const input = plain.blocks.find((b) => b.tail?.side === 'input')!;
    const [x, , z] = plain.blocks.find((b) => b.tail?.side === 'output')!.pos;
    const ground = lineGround([[[x + 2, 64, z - 1], [x + 2, 66, z + 2]], [[x + 1, 65, z + 1], [x + 1, 65, z + 1]]]);
    const layout = await layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: 'enderio', taps: [[x + 1, 64, z + 2]] }] }), placed(0), ground);
    const index = layout.hookups.findIndex((h) => h.kind === 'logistics');
    const keptFrom = layout.blocks.filter((b) => b.hookup === undefined && posKey(b.pos) !== posKey(input.pos)
      && (b.role === 'machine' || b.role === 'hatch' || b.role === 'chest' || b.conduits?.some((c) => c.kind === 'item') === true));
    const cells = layout.blocks.filter((b) => b.hookup === index);
    expect([layout.hookups[index]!.found, layout.hookups[index]!.path.at(-1)]).toEqual([true, [x + 1, 64, input.pos[2]]]);
    expect(cells.filter((c) => keptFrom.some((b) => manhattan(b.pos, c.pos) === 1)).map((c) => posKey(c.pos))).toEqual([]);
  });

  it('keeps every other hookup as Plan 5 routes it: a routed hookup of a machine-to-machine line runs straight past the output chest', async () => {
    // the keep-off is only for a hookup that ends on an EnderIO conduit face (plan 11, ruling R14)
    const project = makeProject({ logistics: 'direct', placement: { origin: [30, 64, 10], rotation: 0 } });
    const plain = await layoutLine(layoutPack(), twoStep(), lineScan(), project, lineGround());
    const [x, , z] = plain.blocks.find((b) => b.tail?.side === 'output')!.pos;
    const layout = await layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: 'routed', taps: [[x + 1, 64, z + 2]] }] }), project, lineGround());
    const hookup = layout.hookups.find((h) => h.kind === 'logistics')!;
    expect([hookup.found, hookup.path]).toEqual([true, [[x + 1, 64, z + 1], [x + 1, 64, z], [x + 1, 64, z - 1], [x + 1, 64, z - 2]]]);
  });

  it("names each open fluid end's turned face in its own step and counts the fluid conduits of the bundles", async () => {
    const plan = () => makePlan([{ id: 's1', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144], ['t:in@0', 1]] }],
      { flows: [{ from: 'raw', to: 's1', key: 'fluid:molten.iron', perSecond: 1 }, { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 },
        { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });
    for (const rotation of [0, 90, 180, 270] as const) {
      const layout = await layoutLine(layoutPack(), plan(), lineScan(), placed(rotation), lineGround());
      const face = rotateFace('east', rotation);
      const tank = layout.buildSteps.filter((s) => s.text.includes(' face to your tank: '));
      expect(tank.map((s) => [s.id.endsWith(`:liquid_ender:${face}`), s.text.split(':')[0]]))
        .toEqual([[true, `Ender Fluid Conduit, ${faceName(face)} face to your tank`]]);
      // two of the four share a bundle with the Item Conduit
      expect(layout.bom).toContainEqual({ key: ENDER, amount: 4, why: 'conduits', group: 'logistics' });
    }
  });

  it("keeps the tail chests' side and items when the line is turned, and gives each direct output chest its own item", async () => {
    const tails = (l: Layout) => l.blocks.filter((b) => b.tail !== undefined).map((b) => ({ label: b.label, tail: b.tail }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const flat = await layoutLine(layoutPack(), twoStep(), lineScan(), placed(0), lineGround());
    expect(tails(flat)).toEqual([{ label: 'Chest (input)', tail: { side: 'input', keys: ['t:in@0'] } },
      { label: 'Chest (output)', tail: { side: 'output', keys: ['t:out_s2@0'] } }]);
    expect(tails(await layoutLine(layoutPack(), twoStep(), lineScan(), placed(90), lineGround()))).toEqual(tails(flat));
    const two = makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1], ['t:ingot@0', 1]] }], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: 1 }, { from: 's1', to: 'out', key: 't:dust@0', perSecond: 1 },
      { from: 's1', to: 'sink', key: 't:ingot@0', perSecond: 1 }] });
    const direct = buildMode('direct', { ...setup(two, PORT_SPACING.direct), network: null });
    expect(direct.blocks.filter((b) => b.role === 'chest').map((b) => b.tail)).toEqual([
      { side: 'input', keys: ['t:in@0'] }, { side: 'output', keys: ['t:dust@0'] }, { side: 'output', keys: ['t:ingot@0'] }]);
  });
});
