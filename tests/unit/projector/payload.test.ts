import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { containerBlock, stepMembership, projectorPayload, payloadVersion } from '../../../src/server/projector/payload.ts';
import { projectorLayout, projectorPack, projectorProject, CONVEYOR } from '../../helpers/projector-fixtures.ts';
import type { Machine, MachineKind } from '../../../src/shared/types/pack.ts';
import { gtMachineId } from '../../../src/shared/ids.ts';
import type { BuildStep } from '../../../src/shared/types/plan.ts';

const pack = projectorPack();
const SAMPLE = 'projector-mod/src/test/resources/projector-sample.json';

describe('projector payload', () => {
  it('assigns every block to the build step that places it', () => {
    expect(stepMembership(projectorLayout())).toEqual([
      'layout:power:hookup', 'layout:power:wire:1', 'layout:power:stage:1', 'layout:place:s1', 'layout:place:s1',
      'layout:logistics:line', 'layout:logistics:line', 'layout:logistics:fluid:fluid:water', 'layout:logistics:line', null, 'layout:place:s2']);
  });

  it('falls through to the next rule when a step does not exist', () => {
    const l = projectorLayout();
    l.buildSteps = l.buildSteps.filter((s) => !['layout:power:wire:1', 'layout:logistics:fluid:fluid:water', 'layout:place:s2'].includes(s.id));
    const m = stepMembership(l);
    expect([m[1], m[7], m[10]]).toEqual([null, 'layout:logistics:line', null]);
  });

  it('takes the step a block names itself before the text rules, and the rules when that step does not exist', () => {
    const l = projectorLayout();
    l.blocks[0]!.buildStep = 'layout:power:wire:1';   // the rules would say layout:power:hookup
    l.blocks[3]!.buildStep = 'layout:site';           // the rules would say layout:place:s1
    l.blocks[4]!.buildStep = 'layout:gone';           // no such step: the rules say layout:place:s1
    l.blocks[9]!.buildStep = 'layout:test';           // a ghost is never part of a step
    expect(stepMembership(l)).toEqual([
      'layout:power:wire:1', 'layout:power:wire:1', 'layout:power:stage:1', 'layout:site', 'layout:place:s1',
      'layout:logistics:line', 'layout:logistics:line', 'layout:logistics:fluid:fluid:water', 'layout:logistics:line', null, 'layout:place:s2']);
  });

  it('resolves pseudo part ids to their container block', () => {
    expect(containerBlock({ id: 'fmp:pr_rinterface', meta: 0 })).toEqual({ id: 'ForgeMultipart:block', part: 'pr_rinterface' });
    expect(containerBlock({ id: 'conduit:item', meta: 0 })).toEqual({ id: 'EnderIO:blockConduitBundle', part: 'item' });
    expect(containerBlock({ id: 'ae2cable:glass', meta: 0 })).toEqual({ id: 'appliedenergistics2:tile.BlockCableBus', part: 'glass' });
    expect(containerBlock({ id: 'gregtech:gt.blockcasings', meta: 11 })).toEqual({ id: 'gregtech:gt.blockcasings' });
  });

  it('leaves real registry names alone, even ones that look like a prefix', () => {
    for (const id of ['ForgeMultipart:block', 'EnderIO:blockConduitBundle', 'stone', 'constructor:x', 'toString:x', ':fmp:x']) {
      expect(containerBlock({ id, meta: 0 })).toEqual({ id });
    }
  });

  it('compares meta and facing only where they mean something', () => {
    const p = projectorPayload(projectorProject(), projectorLayout(), pack);
    expect(p.blocks).toHaveLength(10);
    expect(p.blocks[0]).toEqual({ pos: [100, 64, 201], id: 'gregtech:gt.blockmachines', meta: null, mteId: 1180, role: 'cable', label: '1x Tin Cable', step: 'layout:power:hookup' });
    expect(p.blocks[2]).toMatchObject({ mteId: 21, facing: 4, meta: null });
    expect(p.blocks[3]).toEqual({ pos: [102, 64, 201], id: 'gregtech:gt.blockmachines', meta: null, mteId: 201, facing: 3, facingIsOutput: true,
      mainFacing: 4, role: 'machine', label: 'Basic Macerator', step: 'layout:place:s1', covers: [{ face: 3, item: CONVEYOR, label: 'Conveyor Module (LV)' }] });
    expect('covers' in p.blocks[4]!).toBe(false);
    expect(p.blocks[6]).toEqual({ pos: [104, 64, 202], id: 'minecraft:chest', meta: null, role: 'chest', label: 'Chest (input)', step: 'layout:logistics:line' });
    expect(p.blocks[8]).toMatchObject({ id: 'ForgeMultipart:block', part: 'pr_rinterface', meta: null });
    expect('facing' in p.blocks[8]!).toBe(false);
    expect(p.blocks[9]).toEqual({ pos: [103, 65, 203], id: 'gregtech:gt.blockcasings', meta: 11, role: 'casing', label: 'Heat Proof Machine Casing', step: 'layout:place:s2' });
  });

  it("says when the checked facing is a single-block machine's output side", () => {
    const withKind = (kind: MachineKind | null) => {
      const id = gtMachineId(201);
      const machines = new Map(pack.machines);
      const machineByMteId = new Map(pack.machineByMteId);
      if (kind === null) {
        machines.delete(id);
        machineByMteId.delete(201);
      } else {
        const m = { ...machines.get(id)!, kind };
        machines.set(id, m);
        machineByMteId.set(201, m);
      }
      return projectorPayload(projectorProject(), projectorLayout(), { ...pack, machines, machineByMteId });
    };
    // GT front facing = output side on basic and steam machines; a transformer's front is its front
    expect(withKind('steam').blocks[3]).toMatchObject({ facing: 3, facingIsOutput: true });
    expect(withKind('basic').blocks[4]).toMatchObject({ facing: 3, facingIsOutput: true });
    expect('facingIsOutput' in withKind('basic').blocks[2]!).toBe(false);
    for (const kind of ['multiblock', 'hatch', null] as const) expect('facingIsOutput' in withKind(kind).blocks[3]!, String(kind)).toBe(false);
    // no hint without a checked facing
    const noFacing = projectorLayout(); delete noFacing.blocks[4]!.facing;
    expect(Object.keys(projectorPayload(projectorProject(), noFacing, pack).blocks[4]!)).not.toContain('facingIsOutput');
  });

  it("sends a single-block machine's front, where GT draws its face overlay, beside its output side", () => {
    // the review of the EnderIO In / Out fix: the layout turns a singleblock's front along the row (west here) and its
    // output side to the spine (south), so the ghost draws the face overlay on that front, as the 3D view does, and the
    // mod checks it too; it is sent only beside a checked output side
    const p = projectorPayload(projectorProject(), projectorLayout(), pack);
    expect([p.blocks[3], p.blocks[4]]).toMatchObject([{ facing: 3, facingIsOutput: true, mainFacing: 4 }, { facing: 3, facingIsOutput: true, mainFacing: 4 }]);
    expect('mainFacing' in p.blocks[2]!).toBe(false);                                   // a transformer has one front
    const id = gtMachineId(201);
    const machines = new Map(pack.machines);
    const machineByMteId = new Map(pack.machineByMteId);
    const m: Machine = { ...machines.get(id)!, kind: 'multiblock' };
    machines.set(id, m);
    machineByMteId.set(201, m);
    expect('mainFacing' in projectorPayload(projectorProject(), projectorLayout(), { ...pack, machines, machineByMteId }).blocks[3]!).toBe(false);
    const noFront = projectorLayout(); delete noFront.blocks[4]!.mainFacing;
    expect('mainFacing' in projectorPayload(projectorProject(), noFront, pack).blocks[4]!).toBe(false);
  });

  it('names every conduit of a bundle and the step that lays each, and lists a block only under the step that places it', () => {
    // the audit of the EnderIO In / Out fix: a bundle was sent as its first conduit, in the line step only. The review of
    // the EnderIO single pipe: a bundle listed under the fluids step too let a mod that checks only the bundle block (0.1)
    // tick "Lay N× Ender Fluid Conduit" once the Item Conduits stood, as every basic machine's fluid conduit is in a bundle
    const ITEM = 'EnderIO:itemItemConduit@0', ENDER = 'EnderIO:itemLiquidConduit@2';
    const conduit = (kind: 'item' | 'liquid_ender') => ({ kind, item: kind === 'item' ? ITEM : ENDER, connections: 0, faces: [] });
    const l = { ...projectorLayout(), mode: 'enderio' as const };
    l.blocks.push(
      { pos: [104, 64, 201], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', item: ITEM,
        conduits: [conduit('item'), conduit('liquid_ender')], buildStep: 'layout:logistics:line' },
      { pos: [104, 65, 201], block: { id: 'conduit:liquid_ender', meta: 0 }, role: 'pipe', label: 'Ender Fluid Conduit', item: ENDER,
        conduits: [conduit('liquid_ender')], buildStep: 'layout:logistics:fluids' },
      { pos: [105, 64, 201], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Item Conduit', item: ITEM, conduits: [conduit('item')], hookup: 0 },
      { pos: [106, 64, 201], block: { id: 'conduit:item', meta: 0 }, role: 'pipe', label: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', item: ITEM,
        conduits: [conduit('item'), conduit('liquid_ender')], hookup: 0 });
    l.buildSteps.splice(8, 0, { id: 'layout:logistics:fluids', order: 9, kind: 'logistics',
      text: "Lay 2× Ender Fluid Conduit from every machine's fluid port; 1 of them goes in the same bundle as the Item Conduit" });
    const p = projectorPayload(projectorProject(), l, pack);
    expect(p.blocks.slice(10).map((b) => [b.id, b.part, b.parts, b.partSteps, b.step])).toEqual([
      ['EnderIO:blockConduitBundle', 'item', ['item', 'liquid_ender'], ['layout:logistics:line', 'layout:logistics:fluids'], 'layout:logistics:line'],
      ['EnderIO:blockConduitBundle', 'liquid_ender', undefined, undefined, 'layout:logistics:fluids'],
      ['EnderIO:blockConduitBundle', 'item', undefined, undefined, 'layout:power:hookup'],
      // a hookup's conduits all belong to its hookup
      ['EnderIO:blockConduitBundle', 'item', ['item', 'liquid_ender'], ['layout:power:hookup', 'layout:power:hookup'], 'layout:power:hookup']]);
    const blocksOf = (id: string) => p.steps.find((s) => s.id === id)!.blocks;
    // a step lists the blocks it places only: the fluids step finds the bundle through its partSteps
    expect([blocksOf('layout:logistics:line'), blocksOf('layout:logistics:fluids'), blocksOf('layout:power:hookup')]).toEqual([[5, 6, 8, 10], [11], [0, 12, 13]]);
    // without a fluids step the line step lays the bundle's fluid conduit too, and places the fluid-only cell (its rule)
    const noFluids = projectorPayload(projectorProject(), { ...l, buildSteps: l.buildSteps.filter((s) => s.id !== 'layout:logistics:fluids') }, pack);
    expect(noFluids.blocks[10]!.partSteps).toEqual(['layout:logistics:line', 'layout:logistics:line']);
    expect(noFluids.steps.find((s) => s.id === 'layout:logistics:line')!.blocks).toEqual([5, 6, 8, 10, 11]);
  });

  it('lists each step\'s blocks and which steps are done', () => {
    const p = projectorPayload(projectorProject(), projectorLayout(), pack);
    expect(p.steps.map((s) => [s.order, s.id, s.blocks, s.done])).toEqual([
      [1, 'layout:site', [], false], [2, 'layout:place:s1', [3, 4], false], [3, 'layout:place:s2', [9], true],
      [4, 'layout:power:stage:1', [2], false], [5, 'layout:power:wire:1', [1], false], [6, 'layout:power:hookup', [0], false],
      [7, 'layout:logistics:line', [5, 6, 8], false], [8, 'layout:logistics:fluid:fluid:water', [7], false],
      [9, 'layout:configure:s1', [], false], [10, 'layout:test', [], false]]);
    expect([p.format, p.projectId, p.name, p.rev, p.status, p.message, p.dim, p.origin, p.size])
      .toEqual(['gtnh-planner-projector/1', 'Pr0jectAb1', 'Steel line', 7, 'ok', null, 0, [99, 64, 200], [7, 2, 4]]);
  });

  it("numbers the steps as the checklist does, with the plan's own steps around the layout's", () => {
    const planSteps: BuildStep[] = [
      { id: 'gather', order: 1, kind: 'gather', text: 'Gather the base materials: 24× Iron Ingot' },
      { id: 'craft:machine:201@0', order: 2, kind: 'craft', text: 'Craft 2× Basic Macerator' },
      { id: 'place', order: 3, kind: 'place', text: 'Place the machines' },
      { id: 'power', order: 4, kind: 'power', text: 'Connect power' },
      { id: 'logistics:direct', order: 5, kind: 'logistics', text: 'Connect the machines' },
      { id: 'configure:s1', order: 6, kind: 'configure', text: 'Put a Programmed Circuit (1) in the Basic Macerator' },
      { id: 'test', order: 7, kind: 'test', text: 'Run the line' },
    ];
    const p = projectorPayload({ ...projectorProject(), marks: { 'step:gather': { by: 'Ann', at: '2026-10-18T10:00:00.000Z' } } }, projectorLayout(), pack, planSteps);
    // gather and craft first, then the layout's steps (Plan 2's generic place, power and logistics steps are left out),
    // then configure and test, numbered from 1; steps that place nothing come with no blocks
    expect(p.steps.map((s) => [s.order, s.id, s.blocks, s.done])).toEqual([
      [1, 'gather', [], true], [2, 'craft:machine:201@0', [], false], [3, 'layout:site', [], false], [4, 'layout:place:s1', [3, 4], false],
      [5, 'layout:place:s2', [9], false], [6, 'layout:power:stage:1', [2], false], [7, 'layout:power:wire:1', [1], false], [8, 'layout:power:hookup', [0], false],
      [9, 'layout:logistics:line', [5, 6, 8], false], [10, 'layout:logistics:fluid:fluid:water', [7], false], [11, 'layout:configure:s1', [], false],
      [12, 'layout:test', [], false], [13, 'configure:s1', [], false], [14, 'test', [], false]]);
    expect(p.steps[1]).toMatchObject({ kind: 'craft', text: 'Craft 2× Basic Macerator' });
    expect(p.blocks[3]!.step).toBe('layout:place:s1');
    // other numbers are another version: the mod reloads its steps
    expect(p.version).not.toBe(projectorPayload(projectorProject(), projectorLayout(), pack).version);
  });

  it('sends no blocks for an unplaced or empty layout', () => {
    const p = projectorPayload(projectorProject(), { ...projectorLayout(), status: 'no-world' }, pack);
    expect([p.status, p.blocks, p.steps, p.message]).toEqual(['no-world', [], [], 'This project is not placed in the world yet: pick a world scan and base on its Map tab']);
    expect(projectorPayload(projectorProject(), { ...projectorLayout(), status: 'empty' }, pack).message).toBe('Nothing to build yet: this plan places no machines');
  });

  it('keeps its version when only ticks change, and changes it when a block moves', () => {
    const a = projectorPayload(projectorProject(), projectorLayout(), pack);
    const ticked = projectorPayload({ ...projectorProject(), marks: {} }, projectorLayout(), pack);
    const moved = projectorLayout(); moved.blocks[4]!.pos = [103, 64, 199];
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(ticked.version).toBe(a.version);
    expect(projectorPayload(projectorProject(), moved, pack).version).not.toBe(a.version);
    expect(payloadVersion(a)).toBe(a.version);
  });

  it('matches the shared sample the mod tests against', () => {
    const json = `${JSON.stringify(projectorPayload(projectorProject(), projectorLayout(), pack), null, 2)}\n`;
    if (process.env.UPDATE_PROJECTOR_SAMPLE === '1') { mkdirSync('projector-mod/src/test/resources', { recursive: true }); writeFileSync(SAMPLE, json); }
    expect(readFileSync(SAMPLE, 'utf8')).toBe(json);
  });
});
