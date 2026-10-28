// GT covers in the feeding simulation (plan `docs/superpowers/plans/2026-10-20-21-feeding-checker.md` Task 4 rules 5 and
// 5a; E9, E10): what a conveyor, an Item Filter or a Shutter cover lets through its side, and what it moves when it acts.
// - A conveyor lets items in when it imports or allows input, and out when it exports or allows input (E10); an Item
//   Filter cover lets them through both ways (E9); a Shutter in on "Only Input allowed", out on "Only Output allowed",
//   both ways open.
// - Covers act in their host's tile tick, before the host's own update: only once the host's chunk has been loaded for 10
//   ticks, and on ticks whose count since that load is a multiple of the cover's tick rate (E9; the Item Filter cover's
//   rate is 1).
// - An export conveyor moves, by GT's transfer (E4), up to its stacks of up to its items out of its host into what is on
//   its side; with nothing there it drops them into the world (E10: `dropItems`). An import conveyor moves them out of the
//   inventory on its side into its host. An Item Filter cover moves up to 64 stacks of 64 of its filter's items out of
//   its host, and nothing when nothing is there. A Shutter moves nothing.
// Pure TypeScript: nothing from node:* may be imported here.

import { OPPOSITE } from '../../../../shared/layout/geometry.ts';
import type { GtCover } from '../model.ts';
import { gtTransfer, insertEmpties, isInv, isTarget, NEVER, type PushTarget, type SimEntity, type SimInv } from './core.ts';
import type { SimEnv } from './machine.ts';

/** What GT lets through side `side` of a host from its covers: in and out (true where no cover stops it). */
export function coverGates(covers: readonly GtCover[]): { lets: (side: number, way: 'in' | 'out') => boolean } {
  const into: boolean[] = [true, true, true, true, true, true];
  const out: boolean[] = [true, true, true, true, true, true];
  const seen = new Set<number>();
  for (const c of covers) {
    if (seen.has(c.side) || c.side < 0 || c.side > 5) continue;
    seen.add(c.side);
    switch (c.kind) {
      case 'conveyor':
        into[c.side] = !c.export || c.allowInput;
        out[c.side] = c.export || c.allowInput;
        break;
      case 'filter':
        break;
      case 'shutter':
        into[c.side] = c.shutter !== 'output_only';
        out[c.side] = c.shutter !== 'input_only';
        break;
    }
  }
  return { lets: (side, way) => (side < 0 || side > 5 ? true : way === 'in' ? into[side]! : out[side]!) };
}

/**
 * A push target that puts what it is given into `inv` from the side it is told (`insertEmpties`, gtnhlib's sink) and
 * records it as delivered to `inv`: a GT transfer that hands items straight to a machine or a chest.
 */
export function deliverInto(env: SimEnv, inv: SimInv): PushTarget {
  return {
    accept(key, n, side, by) {
      const got = insertEmpties(inv, key, n, side, by);
      if (got > 0) env.stats.delivered(inv.id, key, got, env.sim.t);
      return got;
    },
  };
}

/** A push target that drops everything it is given into the world (`dropItems`, E1, E10): lost to the line, recorded as spilled by `host`. */
export function dropFor(env: SimEnv, host: string): PushTarget {
  return {
    accept(key, n) {
      env.stats.spilled(host, key, n, env.sim.t);
      return n;
    },
  };
}

/** What a GT transfer out of `host` through a side pushes into: the push target there, the inventory there, or the world. */
export function pushTargetOf(env: SimEnv, host: string, there: PushTarget | SimInv | null): PushTarget {
  return there === null ? dropFor(env, host) : isTarget(there) ? there : deliverInto(env, there);
}

/** The ticks between a cover's acts: a conveyor's tick rate, 1 for an Item Filter cover; a Shutter never acts. */
function rateOf(c: GtCover): number {
  if (c.kind === 'conveyor') return c.op === undefined ? 0 : c.op.tickRate;
  return c.kind === 'filter' ? 1 : 0;
}

/** Whether an Item Filter cover's filter passes item `key` (a whitelist lists it, a blacklist does not). */
function filterTest(env: SimEnv, c: GtCover): (key: number) => boolean {
  const keys = new Set((c.filter?.keys ?? []).map((k) => env.keys.id(k)));
  const whitelist = (c.filter?.mode ?? 'whitelist') === 'whitelist';
  return (key) => keys.has(key) === whitelist;
}

/** The covers of a host, acting in its tick: call it first in the host's tick; `next(t)` is the first tick after `t` one of them acts. */
export type CoverTicks = ((t: number) => void) & { next(t: number): number };

/** The covers on `host` (in side order) acting in its tile tick (rule 5a); the host calls it first in every tick. */
export function coverTicks(host: SimInv & SimEntity, covers: GtCover[], env: SimEnv): CoverTicks {
  const acting = covers.filter((c) => rateOf(c) > 0).sort((a, b) => a.side - b.side).map((c) => ({
    c, rate: rateOf(c), back: OPPOSITE[c.side]!, accept: c.kind === 'filter' ? filterTest(env, c) : undefined,
    there: undefined as PushTarget | SimInv | null | undefined, into: undefined as PushTarget | undefined, self: undefined as PushTarget | undefined,
  }));
  const act = (s: (typeof acting)[number]): void => {
    const { c } = s;
    // what is at its side does not change once the run is built: looked up at its first act
    if (s.there === undefined) s.there = env.push(host.id, c.side);
    const there = s.there;
    if (c.kind === 'conveyor' && c.op !== undefined) {
      if (c.export) {
        s.into ??= pushTargetOf(env, host.id, there);
        gtTransfer(host, host.sideSlots(c.side), c.side, s.into, s.back, c.op.stacks, c.op.items, host);
      } else if (there !== null && isInv(there)) {
        s.self ??= deliverInto(env, host);
        gtTransfer(there, there.sideSlots(s.back), s.back, s.self, c.side, c.op.stacks, c.op.items, host);
      }
    } else if (c.kind === 'filter' && there !== null) {
      s.into ??= pushTargetOf(env, host.id, there);
      gtTransfer(host, host.sideSlots(c.side), c.side, s.into, s.back, 64, 64, host, s.accept);
    }
  };
  return Object.assign((t: number): void => {
    const age = t - env.loadedAt;
    if (age < 10) return;
    for (const s of acting) if (age % s.rate === 0) act(s);
  }, {
    next(t: number): number {
      let best = NEVER;
      const age = Math.max(t + 1 - env.loadedAt, 10);
      for (const s of acting) best = Math.min(best, env.loadedAt + Math.ceil(age / s.rate) * s.rate);
      return best;
    },
  });
}
