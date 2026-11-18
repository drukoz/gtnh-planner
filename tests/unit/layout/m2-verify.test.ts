// RUK-2680: milestone M2 verification (RUK-2668). The merged M2 tasks promise five things on the benchmark: the AE2
// lines carry an ME Interface per column, each Wrench-targeted at its own machine (M2-1, M2-2); long low-tier lines
// get satellite step-down banks so no machine the supply tier could run starves (M2-3…M2-7); every satellite is wired
// the way GregTech needs it (docs/research/gt-mechanics.md §3.6: front up into the supply cable, the lower tier out
// its output, nothing else touching it); each satellite is one transformer and the supply amps count its input amps;
// and the build steps tell the player to place the satellites. These lay all 132 benchmark rows through the real
// pipeline (`layoutLine`, satellites on by default per RUK-2679) and read `internal` through the `localLine` dep the
// way `lossLine` does; nothing here touches `src/`.
import { describe, it, expect, beforeAll } from 'vitest';
import { posKey, step } from '../../../src/shared/layout/geometry.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { LogisticsMode } from '../../../src/shared/types/plan.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import type { InternalResult, SatelliteBank } from '../../../src/server/layout/internal.ts';
import type { LocalBlock, Placement } from '../../../src/server/layout/arrange.ts';
import { benchLines } from '../../helpers/layout-bench.ts';
import { tierContacts } from '../../helpers/power-loss.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];
const UP = 1;
// the transformer feeds tier `toTier` out these five faces (its front, up, is its `fromTier` input): no foreign
// cable and no lower-tier machine may stand on any of them (RUK-2668, Fix 4)
const OUT_SIDES = [0, 2, 3, 4, 5] as const;

interface Row {
  name: string;
  mode: LogisticsMode;
  layout: Layout;
  placement: Placement;
  internal: InternalResult;
}

// starved = a machine the wiring cannot run at the tier its supply delivers (the benchmark's measure, RUK-2617)
const starvedOf = (internal: InternalResult): string[] =>
  internal.machines.filter((m) => !m.powered && m.tier <= m.feedTier).map((m) => m.stepId);

const atPos = (blocks: readonly LocalBlock[]): Map<string, LocalBlock> =>
  new Map(blocks.map((b) => [posKey(b.pos), b]));

const rows: Row[] = [];

describe('milestone M2 verification', () => {
  beforeAll(async () => {
    for (const line of benchLines()) {
      for (const mode of MODES) {
        const seen: Array<{ placement: Placement; internal: InternalResult }> = [];
        const layout = await layoutLine(layoutPack(), line.plan, line.scan(mode), makeProject({ logistics: mode }), {
          ...line.deps, localLine: (l) => { seen.push(l); },
        });
        const local = seen[0];
        if (local === undefined) throw new Error(`${line.name} ${mode}: the line laid nothing of its own`);
        rows.push({ name: line.name, mode, layout, placement: local.placement, internal: local.internal });
      }
    }
    if (rows.length !== 132) throw new Error(`the bench laid ${rows.length} rows, not 132`);
  }, 300_000);

  it('promise 1: every AE2 ME Interface has a Wrench target at its machine, and the build text says so', () => {
    const ae2 = rows.filter((r) => r.mode === 'ae2');
    expect(ae2.length).toBe(33);
    let checked = 0;
    for (const row of ae2) {
      const placed = new Map(row.layout.blocks.filter((b) => b.role !== 'ghost').map((b) => [posKey(b.pos), b]));
      // an interface with no patterns pushes nothing, so it carries no Wrench target by RUK-2670's design; every
      // patterned one must. A line that moves no crafted items (fluid-only steps) lays no patterned interface at all.
      const ifaces = row.layout.blocks.filter((b) => b.role === 'interface' && b.feed?.interface !== undefined);
      checked += ifaces.length;
      const texts = row.layout.buildSteps.filter((s) => s.kind === 'configure').map((s) => s.text).filter((t) => t.includes('Wrench: point it at its'));
      for (const b of ifaces) {
        const targets = b.feed!.interface!.targets;
        expect(targets, `${row.name} ae2: ME Interface (${b.label}) at ${posKey(b.pos)} has no Wrench target`).toBeDefined();
        expect(targets!.length, `${row.name} ae2: Wrench targets on the interface at ${posKey(b.pos)}`).toBeGreaterThan(0);
        for (const f of targets!) {
          const nb = placed.get(posKey(step(b.pos, FACES.indexOf(f))));
          // a singleblock's interface points at the machine; a multiblock's, at the Input Bus its items go into
          const atItsMachine = nb?.role === 'machine' || (nb?.role === 'hatch' && nb.label.includes('Input Bus'));
          expect(atItsMachine, `${row.name} ae2: the interface at ${posKey(b.pos)} targets ${f}, which points at ${nb === undefined ? 'nothing' : `${nb.role} ${nb.label}`}, not its machine`).toBe(true);
        }
        expect(texts.some((t) => t.startsWith(`${b.label}:`)),
          `${row.name} ae2: no build text tells the builder to Wrench-target ${b.label}`).toBe(true);
      }
    }
    expect(checked, 'patterned ME Interfaces checked').toBeGreaterThan(0);
  });

  it('promise 2: no benchmark row starves a machine', () => {
    expect(rows.length).toBe(132);
    const fails: string[] = [];
    for (const row of rows) {
      const starved = starvedOf(row.internal);
      if (starved.length > 0) fails.push(`${row.name} ${row.mode}: ${starved.length} starved (${starved.join(', ')})`);
    }
    expect(fails, fails.join('\n')).toEqual([]);
  });

  it('promise 3: every satellite transformer faces up into the supply cable and feeds its tier out its output', () => {
    let checked = 0;
    for (const row of rows) {
      const { internal } = row;
      const at = atPos(internal.blocks);
      const cableOf = (tier: number): string | undefined => internal.cables.find((c) => c.tier === tier)?.cable.name;
      internal.satellites.forEach((s: SatelliteBank, i) => {
        const where = `${row.name} ${row.mode} bank ${i}`;
        const transformer = at.get(posKey(s.cell));
        expect(transformer?.role, `${where}: a transformer at ${posKey(s.cell)}`).toBe('transformer');
        expect(transformer?.facing, `${where}: the transformer faces up`).toBe(UP);
        expect(transformer?.satellite, `${where}: its index is on the block`).toBe(i);
        expect(posKey(s.input), `${where}: the input is directly above the transformer`).toBe(posKey(step(s.cell, UP)));
        expect(s.toTier, `${where}: a step down by one tier`).toBe(s.fromTier - 1);
        const input = at.get(posKey(s.input));
        expect(input?.role, `${where}: the input cell carries a cable`).toBe('cable');
        expect(input?.label, `${where}: the input cell carries the ${s.fromTier}-tier cable`).toBe(cableOf(s.fromTier));
        const output = at.get(posKey(s.output));
        expect(output?.role, `${where}: the output cell carries a cable`).toBe('cable');
        expect(output?.label, `${where}: the output cell carries the ${s.toTier}-tier cable`).toBe(cableOf(s.toTier));
        checked++;
      });
    }
    expect(checked, 'satellites checked').toBeGreaterThan(0);
  });

  it('promise 3: no satellite is touched by a foreign cable, and no lower-tier machine stands beside it', () => {
    for (const row of rows) {
      const { internal, placement } = row;
      const at = atPos(internal.blocks);
      const machineTier = new Map(placement.units.filter((u) => u.electric && u.ports.power !== null)
        .map((u) => [posKey(step(u.ports.power!, u.facing)), u.tier]));
      internal.satellites.forEach((s, i) => {
        const where = `${row.name} ${row.mode} bank ${i}`;
        for (const side of OUT_SIDES) {
          const nbPos = step(s.cell, side);
          const nb = at.get(posKey(nbPos));
          expect(posKey(nbPos) === posKey(s.output) || nb === undefined || nb.role !== 'cable',
            `${where}: a foreign cable block on the transformer's face ${side}`).toBe(true);
          const t = machineTier.get(posKey(nbPos));
          expect(t === undefined || t >= s.toTier, `${where}: a tier-${String(t)} machine on the transformer's output face ${side}`).toBe(true);
        }
      });
    }
  });

  it('promise 3: no two cable tiers touch on any row', () => {
    for (const row of rows) {
      expect(tierContacts(row.internal.blocks, row.internal.cables, row.placement), `${row.name} ${row.mode}: tier contacts`).toEqual([]);
    }
  });

  it('promise 4: every satellite is one transformer, and the supply amps count the head stage and the satellites', () => {
    let satellites = 0;
    for (const row of rows) {
      row.internal.satellites.forEach((s, i) => {
        expect(s.count, `${row.name} ${row.mode}: bank ${i} is one transformer`).toBe(1);
        satellites++;
      });
      const stages = row.internal.stages;
      if (stages === null || stages.stages.length === 0) continue;
      const top = stages.stages[0]!;
      const satIn = row.internal.satellites.reduce((sum, s) => sum + s.ampsIn, 0);
      expect(stages.supplyAmps,
        `${row.name} ${row.mode}: supplyAmps ${stages.supplyAmps} < the top stage's ${top.ampsIn} + the satellites' ${satIn}`)
        .toBeGreaterThanOrEqual(top.ampsIn + satIn);
    }
    expect(satellites, 'satellites counted').toBeGreaterThan(0);
  });

  it('promise 5: the build steps carry a satellite step and every satellite transformer points at it', () => {
    for (const row of rows) {
      row.internal.satellites.forEach((s, i) => {
        const id = `layout:power:satellites:${s.toTier}`;
        const stepDef = row.layout.buildSteps.find((st) => st.id === id);
        expect(stepDef, `${row.name} ${row.mode}: the build step ${id}`).toBeDefined();
        expect(stepDef!.text, `${row.name} ${row.mode}: ${id} tells the player to turn the front up`).toContain('front (input) up');
        const laid = row.layout.blocks.filter((b: LayoutBlock) => b.satellite === i);
        expect(laid.length, `${row.name} ${row.mode}: satellite ${i} lays one marked transformer`).toBe(1);
        expect(laid[0]!.buildStep, `${row.name} ${row.mode}: satellite ${i}'s buildStep`).toBe(id);
      });
    }
  });
});
