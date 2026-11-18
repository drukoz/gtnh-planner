// RUK-2675: satellite step-down banks, laid behind the `satellites` switch the way GregTech needs them. Each row is a
// benchmark line that starves machines when its LV wiring runs out; with the switch on it must lay banks that reach
// those machines and starve none, every bank a transformer facing up into a supply cable with a clean, tier-correct
// output beside it, and no lower-tier machine on any of its five output faces. Off, the line is exactly today's.
import { describe, it, expect } from 'vitest';
import { posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { machineIdOfLegacy } from '../../../src/shared/ids.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { lossGround, lossLine, lossPlan, lossScan, tierContacts } from '../../helpers/power-loss.ts';
import { lengthOf } from '../../helpers/layout-bench.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import { CandidateKind } from '../../../src/shared/types/layout.ts';
import type { InternalResult, SatelliteBank } from '../../../src/server/layout/internal.ts';
import type { LocalBlock, Placement } from '../../../src/server/layout/arrange.ts';

type Row = { n: number; mode: 'direct' | 'routed' | 'ae2' | 'enderio'; starved: number };
// the starved benchmark rows (spike SP-C), the machines each starves with the switch off on this branch (measured: the
// RUK-121 middle-head and AE2-interface work changed a few of these from the spike's numbers)
const ROWS: readonly Row[] = [
  { n: 20, mode: 'routed', starved: 7 },
  { n: 20, mode: 'ae2', starved: 7 },
  { n: 40, mode: 'direct', starved: 7 },
  { n: 40, mode: 'routed', starved: 22 },
  { n: 40, mode: 'ae2', starved: 22 },
  { n: 40, mode: 'enderio', starved: 7 },
];

// RUK-2976: Hi-Amp banks and stacking power the stacked 20-machine routed and AE2 lines without a satellite, so the
// satellite tests lay their satellites on the unstacked, unpacked line, which still needs them
const SATELLITES = { satellites: true, stacking: false, packing: false };

const UP = 1;
// the transformer feeds tier `toTier` out these five faces (its front, up, is its `fromTier` input): no lower-tier
// machine may stand on any of them (RUK-2668, Fix 4)
const OUT_SIDES = [0, 2, 3, 4, 5] as const;

const starvedByWiring = (internal: InternalResult): number =>
  internal.machines.filter((m) => !m.powered && m.tier <= m.feedTier).length;

const at = (blocks: readonly LocalBlock[], p: Vec3): LocalBlock | undefined => blocks.find((b) => posKey(b.pos) === posKey(p));

const cableOf = (internal: InternalResult, tier: number): string | undefined =>
  internal.cables.find((c) => c.tier === tier)?.cable.name;

describe('satellite step-down banks', () => {
  it('the 10-machine direct line lays no satellite and keeps its blocks', async () => {
    const on = await lossLine(10, 'direct', { satellites: true });
    expect(on.internal.satellites).toEqual([]);
    const off = await lossLine(10, 'direct');
    expect(JSON.stringify(on.layout.blocks)).toBe(JSON.stringify(off.layout.blocks));
  }, 60_000);

  for (const { n, mode, starved } of ROWS) {
    it(`the ${n}-machine ${mode} line lays satellites that starve no machine`, async () => {
      const { internal } = await lossLine(n, mode, SATELLITES);
      expect(internal.satellites.length, `${n} ${mode}: satellites laid`).toBeGreaterThan(0);
      expect(starvedByWiring(internal), `${n} ${mode}: starved by wiring`).toBe(0);
    }, 60_000);

    it(`the ${n}-machine ${mode} line keeps today's layout with the switch off`, async () => {
      const { internal } = await lossLine(n, mode, { stacking: false, packing: false });
      expect(internal.satellites).toEqual([]);
      expect(starvedByWiring(internal), `${n} ${mode}: starved with the switch off`).toBe(starved);
    }, 60_000);

    it(`the ${n}-machine ${mode} satellites face up into a supply cable with a tier cable beside`, async () => {
      const { internal } = await lossLine(n, mode, SATELLITES);
      const { satellites, blocks } = internal;
      expect(satellites.length).toBeGreaterThan(0);
      satellites.forEach((s: SatelliteBank, i) => {
        const transformer = at(blocks, s.cell);
        expect(transformer, `bank ${i}: a transformer at ${posKey(s.cell)}`).toBeDefined();
        expect(transformer!.role, `bank ${i}: role`).toBe('transformer');
        expect(transformer!.facing, `bank ${i}: the transformer faces up`).toBe(UP);
        expect(transformer!.satellite, `bank ${i}: its index is on the block`).toBe(i);
        expect(posKey(s.input), `bank ${i}: the input is directly above the transformer`).toBe(posKey(step(s.cell, UP)));
        expect(s.toTier, `bank ${i}: a step down by one tier`).toBe(s.fromTier - 1);
        const input = at(blocks, s.input);
        expect(input?.role, `bank ${i}: the input cell carries a cable`).toBe('cable');
        expect(input?.label, `bank ${i}: the input cell carries the ${s.fromTier}-tier cable`).toBe(cableOf(internal, s.fromTier));
        const output = at(blocks, s.output);
        expect(output?.role, `bank ${i}: the output cell carries a cable`).toBe('cable');
        expect(output?.label, `bank ${i}: the output cell carries the ${s.toTier}-tier cable`).toBe(cableOf(internal, s.toTier));
        // the transformer's own input and output are the only cable cells beside it; every other neighbour stays bare
        OUT_SIDES.forEach((side) => {
          const neighbour = step(s.cell, side);
          const b = at(blocks, neighbour);
          expect(posKey(neighbour) === posKey(s.output) || b === undefined || b.role !== 'cable',
            `bank ${i}: a foreign cable block on the transformer's face ${side}`).toBe(true);
        });
      });
    }, 60_000);

    it(`the ${n}-machine ${mode} satellites touch no foreign cable or lower-tier machine`, async () => {
      const { placement, internal } = await lossLine(n, mode, SATELLITES);
      expect(tierContacts(internal.blocks, internal.cables, placement), `${n} ${mode}: tier contacts`).toEqual([]);
      const machineTier = new Map(placement.units.filter((u) => u.electric && u.ports.power !== null)
        .map((u) => [posKey(step(u.ports.power!, u.facing)), u.tier]));
      internal.satellites.forEach((s, i) => {
        for (const side of OUT_SIDES) {
          const t = machineTier.get(posKey(step(s.cell, side)));
          expect(t === undefined || t >= s.toTier, `bank ${i}: a tier-${String(t)} machine on the transformer's output face ${side}`).toBe(true);
        }
      });
    }, 60_000);

    it(`the ${n}-machine ${mode} line lays the same satellites every time`, async () => {
      const a = await lossLine(n, mode, SATELLITES);
      const b = await lossLine(n, mode, SATELLITES);
      expect(JSON.stringify(b.internal.satellites)).toBe(JSON.stringify(a.internal.satellites));
    }, 60_000);
  }

  it('stacking alone powers the 20-machine routed line with satellites off', async () => {
    // RUK-2877: the stacked line is shorter, so the head's own trees reach every machine where the unstacked line starves 8
    const { internal } = await lossLine(20, 'routed', { stacking: false });
    expect(starvedByWiring(internal)).toBe(7);
    const stacked = await lossLine(20, 'routed');
    expect(starvedByWiring(stacked.internal)).toBe(0);
  }, 60_000);
});

// RUK-2677: one transformer per satellite. Groups close at one GT++ Hi-Amp Transformer's estimate (16 A out, 6 A in),
// the head bank is sized only for the machines its own trees feed, and the supply amps count every satellite's input.
const HIAMP_MTE_ID = 878;   // the fixture's LV Hi-Amp Transformer

describe('one transformer per satellite (RUK-2677)', () => {
  for (const { n, mode } of ROWS) {
    it(`the ${n}-machine ${mode} line gives every satellite one transformer, no bank warning, no starved machine`, async () => {
      const { internal, layout } = await lossLine(n, mode, SATELLITES);
      expect(internal.satellites.length, `${n} ${mode}: satellites laid`).toBeGreaterThan(0);
      internal.satellites.forEach((s, i) => { expect(s.count, `bank ${i}: one transformer`).toBe(1); });
      // the head bank's own `transformer_bank` (the M2-3 baseline, on these rows' OFF layout too) is allowed: the
      // amendment's rule is that an ON row gains no code its OFF row lacks. A satellite's warning says "satellite".
      expect(layout.warnings.some((w) => w.code === 'transformer_bank' && w.text.includes('satellite')), `${n} ${mode}: satellite bank warning`).toBe(false);
      expect(starvedByWiring(internal), `${n} ${mode}: starved by wiring`).toBe(0);
    }, 60_000);

    it(`the ${n}-machine ${mode} line lays the Hi-Amp Transformer on every satellite`, async () => {
      const { internal } = await lossLine(n, mode, SATELLITES);
      const laid = internal.blocks.filter((b) => b.satellite !== undefined);
      expect(laid.length, `${n} ${mode}: one block per satellite`).toBe(internal.satellites.length);
      laid.forEach((b) => { expect(b.block.mteId, `satellite block at ${posKey(b.pos)}`).toBe(HIAMP_MTE_ID); });
    }, 60_000);
  }

  it('the 40-machine ae2 line does not grow the head bank with satellites on', async () => {
    const on = await lossLine(40, 'ae2', { satellites: true });
    const off = await lossLine(40, 'ae2');
    const lvOn = on.internal.stages!.stages.find((s) => s.toTier === 1)!;
    const lvOff = off.internal.stages!.stages.find((s) => s.toTier === 1)!;
    expect(lvOn.count).toBeLessThanOrEqual(lvOff.count);
  }, 60_000);

  it('the 40-machine ae2 supply amps count the head bank and every satellite', async () => {
    const { internal } = await lossLine(40, 'ae2', { satellites: true });
    const lv = internal.stages!.stages.find((s) => s.toTier === 1)!;
    const satIn = internal.satellites.reduce((sum, s) => sum + s.ampsIn, 0);
    expect(internal.stages!.supplyAmps).toBeGreaterThanOrEqual(lv.ampsIn + satIn);
  }, 60_000);

  it('the 40-machine direct line still lays satellites with the Hi-Amp Transformer deleted', async () => {
    const pack = layoutPack();
    pack.machines.delete(machineIdOfLegacy(HIAMP_MTE_ID));
    pack.machineByMteId.delete(HIAMP_MTE_ID);
    const seen: Array<{ placement: Placement; internal: InternalResult }> = [];
    await layoutLine(pack, lossPlan(40), lossScan('direct'), makeProject({ logistics: 'direct' }),
      { ...lossGround(), localLine: (line) => { seen.push(line); }, satellites: true });
    const internal = seen[0]!.internal;
    expect(internal.satellites.length).toBeGreaterThan(0);
    expect(starvedByWiring(internal)).toBe(0);   // `transformer_bank` is allowed here: the groups are M2-3's
  }, 60_000);
});

// RUK-2679: satellites on by default, so the build steps tell the player to place them and every satellite transformer
// points at its satellite step.
describe('satellite build steps (RUK-2679)', () => {
  it('the 40-machine ae2 line lays a satellite step every satellite transformer points at', async () => {
    const { layout } = await lossLine(40, 'ae2', { satellites: true });
    expect(layout.buildSteps.some((s) => s.id === 'layout:power:satellites:1'), 'the satellite build step').toBe(true);
    const satBlocks = layout.blocks.filter((b) => b.satellite !== undefined);
    expect(satBlocks.length, 'satellite transformers laid').toBeGreaterThan(0);
    satBlocks.forEach((b) => {
      expect(b.buildStep, `satellite transformer at ${posKey(b.pos)}`).toBe('layout:power:satellites:1');
    });
    // the step names the transformer the satellites lay (GT++'s Hi-Amp Transformer here), not the head bank's
    const text = layout.buildSteps.find((s) => s.id === 'layout:power:satellites:1')!.text;
    expect(text).toContain(`× ${satBlocks[0]!.label} out along the line`);
    expect(satBlocks[0]!.label).toContain('Hi-Amp');
    expect(text).toContain('Leave it in full mode');
  }, 60_000);
});

// RUK-3027 (K1, `k1-fallback.patch`): when phase 2 starves a satellite, the line is routed again with that satellite's
// supply input and its six neighbours kept free for the supply tier's feed. A candidate whose satellites survive today's
// route is laid exactly as today, so the packed AE2 line keeps its satellites and the 80-machine lines power every machine.
// The 40-machine AE2 total counts its 26-block rain roof (RUK-3032): 174 + 26 = 200.
describe('a satellite keeps its supply input free (RUK-3027 K1)', () => {
  it('keeps every satellite of the 40-machine AE2 line, which stacks', async () => {
    const { layout, internal } = await lossLine(40, 'ae2', { satellites: true });
    const chosen = layout.search!.candidates[layout.search!.chosen]!;
    expect(chosen.kind, 'the chosen candidate is the stacked line').toBe(CandidateKind.Stacked);
    expect(internal.satellites, 'satellites kept').toHaveLength(3);
    expect(internal.machines.filter((m) => m.powered === false).length, 'unpowered machines').toBe(0);
    expect(lengthOf(layout).total, 'the 40-machine AE2 line total').toBe(200);
  }, 120_000);

  for (const mode of ['routed', 'ae2'] as const) {
    it(`powers all 80 machines of the ${mode} line through their satellites`, async () => {
      const { internal } = await lossLine(80, mode, { satellites: true });
      expect(internal.satellites.length, `80 ${mode}: satellites laid`).toBe(11);
      expect(internal.machines.filter((m) => m.powered === false).length, `80 ${mode}: unpowered machines`).toBe(0);
    }, 120_000);
  }

  for (const n of [40, 80]) {
    for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
      it(`lays no other tier's cable beside a satellite's input (${n} ${mode})`, async () => {
        const { internal } = await lossLine(n, mode, { satellites: true });
        const tierOf = new Map(internal.cables.map((c) => [c.cable.name, c.tier]));
        internal.satellites.forEach((s, i) => {
          for (let side = 0; side < 6; side++) {
            const c = step(s.input, side);
            if (posKey(c) === posKey(s.cell)) continue;   // the satellite's own transformer touches its input
            const b = at(internal.blocks, c);
            if (b?.role !== 'cable') continue;
            expect(tierOf.get(b.label), `${n} ${mode} satellite ${String(i)} side ${side}`).toBe(s.fromTier);
          }
        });
      }, 120_000);
    }
  }
});
