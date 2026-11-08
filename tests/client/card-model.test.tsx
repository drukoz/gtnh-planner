import { describe, it, expect } from 'vitest';
import { cardBodyTop, cardGeometry, cardLines, tileCentre, STEP_CARD_WIDTH, LINE_CARD_WIDTH, STUB_HEIGHT, STUB_TILE } from '../../src/client/views/card-model.ts';
import { flowGraph, rowCentre, rowLine, rowsTop } from '../../src/client/views/flow-model.ts';
import type { Plan, PlanStep } from '../../src/shared/types/plan.ts';

const step = (p: Partial<PlanStep>): PlanStep => ({ id: 'circuit-lv', recipeId: 'circuit-lv', mapId: 'gt.recipe.assembler', machine: { mteId: 121, name: 'Basic Assembler', tier: 1 },
  count: 5, owned: 0, runsPerSecond: 0.5, utilization: 1, euPerTick: 16, durationTicks: 200, overclocks: 0, inputs: [], outputs: [], alternatives: [], handCraft: false, warnings: [],
  mainOutput: 't:circuit@0', oc: { recipeEuPerTick: 16, recipeDurationTicks: 200, machineVoltage: 32, machineAmps: 1, perfect: false, heatOverclocks: 0 }, ...p });
const plan = { status: 'ok', steps: [step({ inputs: [{ key: 't:redstone@0', amount: 1, chance: 1 }], outputs: [{ key: 't:circuit@0', amount: 1, chance: 1 }] })],
  names: { 't:circuit@0': 'Basic Circuit', 't:redstone@0': 'Redstone' },
  flows: [{ from: 'raw', to: 'circuit-lv', key: 't:redstone@0', perSecond: 0.5 }, { from: 'circuit-lv', to: 'out', key: 't:circuit@0', perSecond: 0.5 }],
  rawInputs: [{ key: 't:redstone@0', perSecond: 0.5, cost: 0.5, available: true, sources: [] }], byproducts: [], warnings: [], unlocks: [] } as unknown as Plan;

describe('card geometry (RUK-740 round 2)', () => {
  it('stands a step card\'s tiles, machine column and foot where the model says', () => {
    const g = cardGeometry({ step: true, inputs: 3, outputs: 1, power: true, extraLines: 0 });
    expect([g.width, g.bodyTop]).toEqual([388, 44]);
    expect(g.tiles).toHaveLength(5);
    expect(g.tiles[3]).toEqual({ x: 6, y: 44 + 3 * 38, side: 'in', line: 3, power: true });
    expect(g.height).toBe(44 + 4 * 38 - 4 + 6 + 20);
    expect(g.machine).toEqual({ x: 152, y: 44, width: 84, height: 148 });
    expect(g.footTop).toBe(198);
  });
  it('keeps a step card two tile lines tall, and stands its output tile at the right edge', () => {
    const g = cardGeometry({ step: true, inputs: 1, outputs: 1, power: false, extraLines: 0 });
    expect(cardLines({ step: true, inputs: 1, outputs: 1, power: false, extraLines: 0 })).toBe(2);
    expect(g.height).toBe(44 + 2 * 38 - 4 + 6 + 20);
    expect(g.tiles[1]?.x).toBe(388 - 6 - 140);
  });
  it('makes a supporting line\'s card two columns wide, with no machine column and no foot', () => {
    const g = cardGeometry({ step: false, inputs: 2, outputs: 3, power: false, extraLines: 1 });
    expect(g.width).toBe(298);
    expect(g.bodyTop).toBe(60);
    expect(g.machine).toBeNull();
    expect(g.footTop).toBeNull();
    expect(g.height).toBe(60 + 3 * 38 - 4 + 6);
  });
  it('puts a tile line\'s middle 17 px under its top, 38 px a line', () => {
    expect(tileCentre(44, 2)).toBe(137);
    expect(cardBodyTop(0)).toBe(44);
    expect([STEP_CARD_WIDTH, LINE_CARD_WIDTH, STUB_HEIGHT]).toEqual([388, 298, 18 + 34 + 6]);
    expect(STUB_TILE.y).toBe(18);
  });
  it('sits a flow-model step node\'s ports on its tiles, in a 388 px card', () => {
    const node = flowGraph(plan, 'min').nodes.find((n) => n.id === 'circuit-lv')!;
    expect(node.width).toBe(STEP_CARD_WIDTH);
    for (let i = 0; i < node.rows.length; i++) {
      expect(rowCentre(node, i)).toBe(tileCentre(rowsTop(node), rowLine(node, i)));
    }
  });
});
