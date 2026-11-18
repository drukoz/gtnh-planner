// RUK-3045: on the benchmark's loss lines the head-bank step names the Hi-Amp Transformers the bank actually lays,
// with its laid count, and every transformer block the line lays owns a step. One test per line × mode, over the real
// layouts; the table is the CTO probe of the fixed code (bug report RUK-3045).
import { it, expect } from 'vitest';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { benchLines } from '../../helpers/layout-bench.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import type { LogisticsMode } from '../../../src/shared/types/plan.ts';

const TABLE: ReadonlyArray<readonly [string, LogisticsMode, number, string]> = [
  ['loss-10', 'direct', 2, 'LV Hi-Amp Transformer'],
  ['loss-10', 'routed', 5, 'Low Voltage Transformer'],
  ['loss-10', 'ae2', 5, 'Low Voltage Transformer'],
  ['loss-10', 'enderio', 2, 'LV Hi-Amp Transformer'],
  ['loss-20', 'direct', 3, 'LV Hi-Amp Transformer'],
  ['loss-20', 'routed', 3, 'LV Hi-Amp Transformer'],
  ['loss-20', 'ae2', 3, 'LV Hi-Amp Transformer'],
  ['loss-20', 'enderio', 3, 'LV Hi-Amp Transformer'],
  ['loss-40', 'direct', 5, 'LV Hi-Amp Transformer'],
  ['loss-40', 'routed', 3, 'LV Hi-Amp Transformer'],
  ['loss-40', 'ae2', 5, 'LV Hi-Amp Transformer'],
  ['loss-40', 'enderio', 5, 'LV Hi-Amp Transformer'],
];

for (const [name, mode, n, transformer] of TABLE) {
  it(`${name} ${mode}: the head bank's step names ${n}× ${transformer} and owns its blocks`, async () => {
    const line = benchLines().find((l) => l.name === name)!;
    const layout = await layoutLine(layoutPack(), line.plan, line.scan(mode), makeProject({ logistics: mode }), line.deps);
    const transformers = layout.blocks.filter((b) => b.role === 'transformer');
    expect(transformers.length, 'the line lays transformers').toBeGreaterThan(0);
    // (a) every transformer block owns a step
    for (const b of transformers) expect(b.buildStep, `transformer at ${b.pos.join(',')}`).toBeDefined();
    // (b) the head-bank blocks are the stage's, named as the bank lays them
    const head = transformers.filter((b) => b.satellite === undefined);
    expect(head.map((b) => b.buildStep)).toEqual(Array(head.length).fill('layout:power:stage:1'));
    expect(head.map((b) => b.label)).toEqual(Array(n).fill(transformer));
    // (c) the stage step names the laid count and the laid block
    const step = layout.buildSteps.find((s) => s.id === 'layout:power:stage:1')!;
    expect(step.text.startsWith(`Place ${n}× ${transformer} between the MV and LV cables`), step.text).toBe(true);
    // (d) the half-mode sentence rides only on a Hi-Amp bank
    expect(step.text.includes('Leave them in full mode')).toBe(transformer.includes('Hi-Amp'));
  }, 120_000);
}
