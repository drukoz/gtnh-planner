// RUK-3013: a place step names the side each machine's output faces and the side its front faces. On rows all of a step's
// machines share them and the text is today's, pinned in pins-steps.test.ts; on a packed line each machine's output side is
// its own item port, and a row whose machines face two ways (a middle head) needs both. The words come from the blocks the
// line laid, so these tests derive them from LayoutBlock.facing/mainFacing and check the step's text against them.
import { describe, it, expect } from 'vitest';
import { CandidateKind } from '../../../src/shared/types/layout.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import { SIDE_NAMES } from '../../../src/shared/layout/geometry.ts';
import { fmtInt } from '../../../src/shared/layout/format.ts';
import { lossLine } from '../../helpers/power-loss.ts';

type Group = { out: string; front: string; n: number };

// The words the place step names, derived the way the step builds them: on rows (`packed` false) every machine faces its
// output into the spine, so the output word collapses to `the middle row`; on a packed line each machine names its own
// world output side. Grouped by the pair, in the order of each group's first block (the step lists them in unit order, so
// the tests check each group's fragment is present, not their joined order).
function faces(layout: Layout, stepId: string, packed: boolean): Group[] {
  const groups: Group[] = [];
  const at = new Map<string, Group>();
  for (const b of layout.blocks) {
    if (b.role !== 'machine' || b.hookup !== undefined || b.stepId !== stepId) continue;
    const out = packed ? SIDE_NAMES[b.facing!]! : 'the middle row';
    const front = SIDE_NAMES[b.mainFacing!]!;
    const key = `${out}\u0000${front}`;
    const g = at.get(key);
    if (g === undefined) {
      const ng = { out, front, n: 1 };
      at.set(key, ng);
      groups.push(ng);
    } else g.n += 1;
  }
  return groups;
}

const fragment = (g: Group): string => `${fmtInt(g.n)} with the output side facing ${g.out} and the front facing ${g.front}`;

function machineSteps(layout: Layout): string[] {
  return [...new Set(layout.blocks.flatMap((b) => (b.role === 'machine' && b.hookup === undefined && b.stepId !== undefined ? [b.stepId] : [])))];
}

function placeText(layout: Layout, stepId: string): string {
  return layout.buildSteps.find((s) => s.id === `layout:place:${stepId}`)!.text;
}

function chosen(layout: Layout): CandidateKind {
  return layout.search!.candidates[layout.search!.chosen]!.kind;
}

const machineBlocks = (layout: Layout): LayoutBlock[] => layout.blocks.filter((b) => b.role === 'machine' && b.hookup === undefined);

describe('a place step names each machine\'s own faces', () => {
  it('a packed line names the output side each machine faces, not the middle row', async () => {
    const { layout } = await lossLine(10, 'direct');
    expect(chosen(layout)).toBe(CandidateKind.Packed);
    for (const id of machineSteps(layout)) {
      const groups = faces(layout, id, true);
      const n = groups.reduce((t, g) => t + g.n, 0);
      const text = placeText(layout, id);
      expect(text.startsWith(`Place ${fmtInt(n)}× `)).toBe(true);
      expect(text).toContain('it takes its items through that side');
      expect(text).toContain("while the item lanes are still empty right-click such a machine's output side");
      expect(text).not.toContain('middle row');
      expect(text).not.toContain('middle-row');
      for (const g of groups) {
        expect(text).toContain(`the output side facing ${g.out} and the front facing ${g.front}`);
      }
      if (groups.length === 1) {
        const g = groups[0]!;
        expect(text).toContain(`then right-click ${g.out === 'up' ? 'its top' : `its ${g.out} side`} to make that the output side`);
      } else {
        expect(text).toContain(`, each turned as the 3D view shows it: `);
        for (const g of groups) expect(text).toContain(fragment(g));
        expect(text).toContain('the side its output faces to make that the output side');
      }
    }
    // the packed line lays both an up-facing and a side-facing output, so `up` and a compass side both appear
    const words = new Set(machineBlocks(layout).map((b) => SIDE_NAMES[b.facing!]!));
    expect(words.has('up')).toBe(true);
    expect([...words].some((w) => w !== 'up')).toBe(true);
  }, 60000);

  it('an AE2 packed line (6 machines: RUK-3015 keeps longer AE2 lines unpacked for reach) turns every machine\'s output to its own port, so its steps say up and its top', async () => {
    const { layout } = await lossLine(6, 'ae2');
    expect(chosen(layout)).toBe(CandidateKind.Packed);
    expect(machineBlocks(layout).every((b) => b.facing === 1)).toBe(true);
    for (const id of machineSteps(layout)) {
      const groups = faces(layout, id, true);
      expect(groups.every((g) => g.out === 'up')).toBe(true);
      const text = placeText(layout, id);
      expect(text).toContain('output side facing up');
      expect(text).toContain("while the item lanes are still empty right-click such a machine's output side");
      expect(text).not.toContain('middle row');
      expect(text).not.toContain('middle-row');
      if (groups.length === 1) expect(text).toContain('then right-click its top to make that the output side');
      else expect(text).toContain('the side its output faces to make that the output side');
    }
  }, 60000);

  it('a row whose machines face two ways (a middle head) lists both fronts, each facing the middle row', async () => {
    const { layout } = await lossLine(40, 'routed', { packing: false });
    const groups = faces(layout, 's2', false);
    expect(groups.length).toBe(2);
    expect([...new Set(groups.map((g) => g.front))].sort()).toEqual(['north', 'south']);
    const text = placeText(layout, 's2');
    const n = groups.reduce((t, g) => t + g.n, 0);
    expect(n).toBe(10);
    const name = layout.blocks.find((b) => b.role === 'machine' && b.hookup === undefined && b.stepId === 's2')!.label;
    expect(text.startsWith(`Place ${fmtInt(n)}× ${name}, each turned as the 3D view shows it: `)).toBe(true);
    for (const g of groups) expect(text).toContain(fragment(g));
    expect(text).toContain('the side its output faces to make that the output side');
    expect(text).toContain("so while the middle row is still empty right-click such a machine's middle-row side");
  }, 60000);

  it('words the logistics line of a packed line by its lanes', async () => {
    for (const mode of ['direct', 'enderio'] as const) {
      const { layout } = await lossLine(10, mode);
      expect(chosen(layout)).toBe(CandidateKind.Packed);
      expect(layout.buildSteps.find((s) => s.id === 'layout:logistics:line')!.text).toContain('on the lanes above the machines');
      for (const s of layout.buildSteps) {
        expect(s.text).not.toContain('middle row');
        expect(s.text).not.toContain('middle-row');
      }
    }
    const { layout } = await lossLine(10, 'direct', { packing: false });
    expect(layout.buildSteps.find((s) => s.id === 'layout:logistics:line')!.text).toContain('along the middle row');
  }, 60000);

  it('a row whose machines all face one way keeps today\'s single sentence and its middle-row check', async () => {
    const { layout } = await lossLine(10, 'direct', { packing: false });
    for (const id of machineSteps(layout)) {
      const groups = faces(layout, id, false);
      expect(groups.length).toBe(1);
      const front = groups[0]!.front;
      const text = placeText(layout, id);
      expect(text).toContain('with its output side facing the middle row and its front facing ');
      expect(text).toContain('then right-click its middle-row side to make that the output side');
      expect(text).toContain("so while the middle row is still empty right-click such a machine's middle-row side with a Screwdriver, "
        + 'not sneaking (a sneak-click switches the Input Filter), and once more if the chat says "Input from Output Side forbidden"');
      expect(text).toContain(`sneak-right-click its ${front} side to make that the front`);
    }
  }, 60000);
});
