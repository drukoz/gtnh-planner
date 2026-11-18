// RUK-3032: the rain roof as glass. A laid line carries its own roof: every machine and transformer of the line is
// under cover (design rule: no `rainExposures` among the line's own blocks), the roof is glass laid one level above
// the tallest block of the line in the `layout:roof` step, and the parts list counts it. The spike (spikes/rain-roof)
// carries the measurement; this is the promotion's own test.
import { describe, it, expect } from 'vitest';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { rainExposures } from '../../../src/server/layout/rain.ts';
import { lossLine } from '../../helpers/power-loss.ts';

describe('rain roof', () => {
  it('leaves no machine or transformer of a laid line open to the rain', async () => {
    for (const n of [10, 40]) for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
      const { layout } = await lossLine(n, mode);
      // the line's own blocks (the convention of layout.test.ts C1): hookup runs and the ghosts they mark at the
      // taps are not the line; the roof covers it, so it is a block like any other
      const own = layout.blocks.filter((b) => b.hookup === undefined && b.role !== 'ghost');
      const checked = own.filter((b) => b.role === 'machine' || b.role === 'transformer');
      const exposed = rainExposures(own, checked).filter((e) => e.top || e.sides.length > 0);
      expect(exposed, `${n} ${mode}`).toEqual([]);
    }
  }, 120000);

  it('lays the roof as glass one level above the tallest block, in the roof step', async () => {
    const { layout } = await lossLine(10, 'direct');
    const roof = layout.blocks.filter((b) => b.role === 'roof');
    expect(roof.length).toBe(16);
    const own = layout.blocks.filter((b) => b.role !== 'roof' && b.hookup === undefined && b.role !== 'ghost');
    const tallest = Math.max(...own.map((b) => b.pos[1]!));
    const cells = new Set(layout.blocks.filter((b) => b.role !== 'roof').map((b) => posKey(b.pos)));
    for (const b of roof) {
      expect(b.block).toEqual({ id: 'minecraft:glass', meta: 0 });
      expect(b.label).toBe('Glass');
      expect(b.buildStep).toBe('layout:roof');
      expect(b.pos[1]).toBe(tallest + 1);
      expect(cells.has(posKey(b.pos)), `roof at ${b.pos.join(',')}`).toBe(false);
    }
  }, 120000);

  it('lists the roof in the parts', async () => {
    const { layout } = await lossLine(10, 'direct');
    expect(layout.bom).toContainEqual(expect.objectContaining({ key: 'minecraft:glass@0', amount: 16, why: 'rain roof' }));
  }, 120000);

  it('puts the roof step last, naming the glass the line lays', async () => {
    const { layout } = await lossLine(10, 'direct');
    const roof = layout.blocks.filter((b) => b.role === 'roof');
    expect(roof.length).toBe(16);
    expect(layout.buildSteps.at(-1)!.id).toBe('layout:test');
    const roofStep = layout.buildSteps.at(-2)!;
    expect(roofStep).toMatchObject({ id: 'layout:roof', kind: 'place' });
    expect(roofStep.text).toBe('Roof the line last, once everything under it is placed and set: lay 16× Glass in one layer one block '
      + 'above its 2-high space, where the view marks them, to keep the rain off its machines, transformers and energy hatches '
      + '(GT machines left in the rain can catch fire or explode)');
    expect(roofStep.text).toContain(`${roof.length}× ${roof[0]!.label}`);
    for (const s of layout.buildSteps) {
      if (s.id === 'layout:roof' || s.id === 'layout:test') continue;
      expect(s.order, s.id).toBeLessThan(roofStep.order);
    }
  }, 120000);
});
