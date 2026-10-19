import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { containerBlock, stepMembership, projectorPayload, payloadVersion } from '../../../src/server/projector/payload.ts';
import { projectorLayout, projectorProject, CONVEYOR } from '../../helpers/projector-fixtures.ts';

const nameOf = (k: string) => (k === CONVEYOR ? 'Conveyor Module (LV)' : k);
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
    const p = projectorPayload(projectorProject(), projectorLayout(), nameOf);
    expect(p.blocks).toHaveLength(10);
    expect(p.blocks[0]).toEqual({ pos: [100, 64, 201], id: 'gregtech:gt.blockmachines', meta: null, mteId: 1180, role: 'cable', label: '1x Tin Cable', step: 'layout:power:hookup' });
    expect(p.blocks[2]).toMatchObject({ mteId: 21, facing: 4, meta: null });
    expect(p.blocks[3]).toEqual({ pos: [102, 64, 201], id: 'gregtech:gt.blockmachines', meta: null, mteId: 201, facing: 3, role: 'machine', label: 'Basic Macerator',
      step: 'layout:place:s1', covers: [{ face: 3, item: CONVEYOR, label: 'Conveyor Module (LV)' }] });
    expect('covers' in p.blocks[4]!).toBe(false);
    expect(p.blocks[6]).toEqual({ pos: [104, 64, 202], id: 'minecraft:chest', meta: null, role: 'chest', label: 'Chest (input)', step: 'layout:logistics:line' });
    expect(p.blocks[8]).toMatchObject({ id: 'ForgeMultipart:block', part: 'pr_rinterface', meta: null });
    expect('facing' in p.blocks[8]!).toBe(false);
    expect(p.blocks[9]).toEqual({ pos: [103, 65, 203], id: 'gregtech:gt.blockcasings', meta: 11, role: 'casing', label: 'Heat Proof Machine Casing', step: 'layout:place:s2' });
  });

  it('lists each step\'s blocks and which steps are done', () => {
    const p = projectorPayload(projectorProject(), projectorLayout(), nameOf);
    expect(p.steps.map((s) => [s.order, s.id, s.blocks, s.done])).toEqual([
      [1, 'layout:site', [], false], [2, 'layout:place:s1', [3, 4], false], [3, 'layout:place:s2', [9], true],
      [4, 'layout:power:stage:1', [2], false], [5, 'layout:power:wire:1', [1], false], [6, 'layout:power:hookup', [0], false],
      [7, 'layout:logistics:line', [5, 6, 8], false], [8, 'layout:logistics:fluid:fluid:water', [7], false],
      [9, 'layout:configure:s1', [], false], [10, 'layout:test', [], false]]);
    expect([p.format, p.projectId, p.name, p.rev, p.status, p.message, p.dim, p.origin, p.size])
      .toEqual(['gtnh-planner-projector/1', 'Pr0jectAb1', 'Steel line', 7, 'ok', null, 0, [99, 64, 200], [7, 2, 4]]);
  });

  it('sends no blocks for an unplaced or empty layout', () => {
    const p = projectorPayload(projectorProject(), { ...projectorLayout(), status: 'no-world' }, nameOf);
    expect([p.status, p.blocks, p.steps, p.message]).toEqual(['no-world', [], [], 'This project is not placed in the world yet: pick a world scan and base on its Map tab']);
    expect(projectorPayload(projectorProject(), { ...projectorLayout(), status: 'empty' }, nameOf).message).toBe('Nothing to build yet: this plan places no machines');
  });

  it('keeps its version when only ticks change, and changes it when a block moves', () => {
    const a = projectorPayload(projectorProject(), projectorLayout(), nameOf);
    const ticked = projectorPayload({ ...projectorProject(), marks: {} }, projectorLayout(), nameOf);
    const moved = projectorLayout(); moved.blocks[4]!.pos = [103, 64, 199];
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(ticked.version).toBe(a.version);
    expect(projectorPayload(projectorProject(), moved, nameOf).version).not.toBe(a.version);
    expect(payloadVersion(a)).toBe(a.version);
  });

  it('matches the shared sample the mod tests against', () => {
    const json = `${JSON.stringify(projectorPayload(projectorProject(), projectorLayout(), nameOf), null, 2)}\n`;
    if (process.env.UPDATE_PROJECTOR_SAMPLE === '1') { mkdirSync('projector-mod/src/test/resources', { recursive: true }); writeFileSync(SAMPLE, json); }
    expect(readFileSync(SAMPLE, 'utf8')).toBe(json);
  });
});
