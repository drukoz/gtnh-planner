// RUK-2675: satellite step-down banks, laid behind the `satellites` switch the way GregTech needs them. Each row is a
// benchmark line that starves machines when its LV wiring runs out; with the switch on it must lay banks that reach
// those machines and starve none, every bank a transformer facing up into a supply cable with a clean, tier-correct
// output beside it, and no lower-tier machine on any of its five output faces. Off, the line is exactly today's.
import { describe, it, expect } from 'vitest';
import { posKey, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import { lossLine, tierContacts } from '../../helpers/power-loss.ts';
import type { InternalResult, SatelliteBank } from '../../../src/server/layout/internal.ts';
import type { LocalBlock } from '../../../src/server/layout/arrange.ts';

type Row = { n: number; mode: 'direct' | 'routed' | 'ae2' | 'enderio'; starved: number };
// the starved benchmark rows (spike SP-C), the machines each starves with the switch off on this branch (measured: the
// RUK-121 middle-head and AE2-interface work changed a few of these from the spike's numbers)
const ROWS: readonly Row[] = [
  { n: 20, mode: 'routed', starved: 8 },
  { n: 20, mode: 'ae2', starved: 8 },
  { n: 40, mode: 'direct', starved: 7 },
  { n: 40, mode: 'routed', starved: 22 },
  { n: 40, mode: 'ae2', starved: 22 },
  { n: 40, mode: 'enderio', starved: 7 },
];

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
  for (const { n, mode, starved } of ROWS) {
    it(`the ${n}-machine ${mode} line lays satellites that starve no machine`, async () => {
      const { internal } = await lossLine(n, mode, { satellites: true });
      expect(internal.satellites.length, `${n} ${mode}: satellites laid`).toBeGreaterThan(0);
      expect(starvedByWiring(internal), `${n} ${mode}: starved by wiring`).toBe(0);
    }, 60_000);

    it(`the ${n}-machine ${mode} line keeps today's layout with the switch off`, async () => {
      const { internal } = await lossLine(n, mode);
      expect(internal.satellites).toEqual([]);
      expect(starvedByWiring(internal), `${n} ${mode}: starved with the switch off`).toBe(starved);
    }, 60_000);

    it(`the ${n}-machine ${mode} satellites face up into a supply cable with a tier cable beside`, async () => {
      const { internal } = await lossLine(n, mode, { satellites: true });
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
      });
    }, 60_000);

    it(`the ${n}-machine ${mode} satellites touch no foreign cable or lower-tier machine`, async () => {
      const { placement, internal } = await lossLine(n, mode, { satellites: true });
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
      const a = await lossLine(n, mode, { satellites: true });
      const b = await lossLine(n, mode, { satellites: true });
      expect(JSON.stringify(b.internal.satellites)).toBe(JSON.stringify(a.internal.satellites));
    }, 60_000);
  }
});
