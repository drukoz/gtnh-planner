// RUK-3072: milestone M4 verification (RUK-3057). M4 adds one thing to the search: after M3's candidates are ranked, the
// best line is laid again with two machines of one feed tier swapped, up to `reorderSwapCap(movable)` times
// (`reorderBest` in `src/server/layout/layout.ts`); every swap it keeps is a `CandidateKind.Reordered` candidate, and
// `layoutLine` keeps the finished swapped line only when it `finalReplaces` the line M3 would keep and `compareFinal`
// puts it strictly first (`src/server/layout/score.ts`). These lay all 132 benchmark rows through the real pipeline
// (`layoutLine`) and read `internal` through the `localLine` dep the way `lossLine` does; nothing here touches `src/`.
// Four promises: no row is worse than M3 (its `baseline.json` is committed here as `baseline-m3.json`, and both baselines
// carry the roof, so `total` is comparable this time); the search record names the swapped line correctly; a reordered
// line keeps the same machines it started with; and the search is deterministic. M3's own promises (promise 5) run in
// `m2-verify.test.ts` and `m3-verify.test.ts`, the timing (promise 6) and the 3D label (promise 7) are measured and
// recorded in the RUK-3072 hand-over, not asserted here.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CandidateKind, type Layout, type LayoutCandidate } from '../../../src/shared/types/layout.ts';
import type { LogisticsMode } from '../../../src/shared/types/plan.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import type { InternalResult } from '../../../src/server/layout/internal.ts';
import { benchLines, lengthOf, type LengthReport } from '../../helpers/layout-bench.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];
const KIND: Record<number, string> = { [CandidateKind.WestHead]: 'WestHead', [CandidateKind.MiddleHead]: 'MiddleHead',
  [CandidateKind.Stacked]: 'Stacked', [CandidateKind.Packed]: 'Packed', [CandidateKind.PackedOpen]: 'PackedOpen',
  [CandidateKind.Reordered]: 'Reordered' };
const M3_BASELINE = fileURLToPath(new URL('../../fixtures/layout-bench/baseline-m3.json', import.meta.url));
const m3Rows = (): LengthReport[] => JSON.parse(readFileSync(M3_BASELINE, 'utf8')) as LengthReport[];
/** `reorderBest` lays at most this many swapped lines per line (`REORDER_SWAP_CAP` in `layout.ts`). */
const SWAP_CAP = 8;

/** The per-mode sums the plan re-baselined to (RUK-3068): M3's come from `baseline-m3.json`, M4's from these rows. */
const SUMS: Record<LogisticsMode, { m3: { total: number; lossEUt: number }, m4: { total: number; lossEUt: number } }> = {
  direct: { m3: { total: 2098, lossEUt: 10176 }, m4: { total: 2083, lossEUt: 10100 } },
  routed: { m3: { total: 2509, lossEUt: 10837 }, m4: { total: 2501, lossEUt: 10790 } },
  ae2: { m3: { total: 2333, lossEUt: 10407 }, m4: { total: 2322, lossEUt: 10353 } },
  enderio: { m3: { total: 2075, lossEUt: 10176 }, m4: { total: 2060, lossEUt: 10100 } },
};
/** The `unreachable` sum over AE2, where the swapped lines open two of M3's shut-in machines. */
const AE2_UNREACHABLE = { m3: 6, m4: 4 };

interface Row {
  name: string;
  mode: LogisticsMode;
  layout: Layout;
  internal: InternalResult;
}

const rows: Row[] = [];

const chosenOf = (layout: Layout): LayoutCandidate => {
  const search = layout.search;
  if (search === undefined) throw new Error('the line has no search record');
  return search.candidates[search.chosen]!;
};

/** The row's live cost, keyed like the baselines: `lengthOf` plus the line's name. */
const measuredOf = (row: Row): LengthReport => ({ name: row.name, ...lengthOf(row.layout) });

/** The machines a laid line runs, as a multiset of `step:feed tier`: a swap moves machines, it never changes them. */
const machinesOf = (internal: InternalResult): string =>
  internal.machines.map((m) => `${m.stepId}:${m.feedTier}`).sort((a, b) => a.localeCompare(b)).join(', ');

const sum = (rows: readonly LengthReport[], of: (r: LengthReport) => number): number => rows.reduce((acc, r) => acc + of(r), 0);

const byName = (rows: readonly Row[]): Map<string, Row[]> => {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const of = out.get(row.name);
    if (of === undefined) out.set(row.name, [row]);
    else of.push(row);
  }
  return out;
};

describe('milestone M4 verification', () => {
  beforeAll(async () => {
    for (const line of benchLines()) {
      for (const mode of MODES) {
        const seen: InternalResult[] = [];
        const layout = await layoutLine(layoutPack(), line.plan, line.scan(mode), makeProject({ logistics: mode }), {
          ...line.deps, localLine: (l) => { seen.push(l.internal); },
        });
        const internal = seen[0];
        if (internal === undefined) throw new Error(`${line.name} ${mode}: the line laid nothing of its own`);
        rows.push({ name: line.name, mode, layout, internal });
      }
    }
    if (rows.length !== 132) throw new Error(`the bench laid ${rows.length} rows, not 132`);
  }, 300_000);

  it('promise 1: no row is worse than M3, and the per-mode sums match the re-baseline', () => {
    const m3 = new Map(m3Rows().map((r) => [`${r.name} ${r.mode}`, r]));
    expect(m3.size).toBe(132);
    const fails: string[] = [];
    const live: LengthReport[] = [];
    for (const row of rows) {
      const where = `${row.name} ${row.mode}`;
      const base = m3.get(where);
      if (base === undefined) { fails.push(`${where}: no M3 baseline row`); continue; }
      const m = measuredOf(row);
      live.push(m);
      if (m.routeFailed > base.routeFailed) fails.push(`${where}: routeFailed ${m.routeFailed} > M3 ${base.routeFailed}`);
      if (m.unreachable > base.unreachable) fails.push(`${where}: unreachable ${m.unreachable} > M3 ${base.unreachable}`);
      if (m.unpowered > base.unpowered) fails.push(`${where}: unpowered ${m.unpowered} > M3 ${base.unpowered}`);
      if (m.weakTiers.length > base.weakTiers.length) {
        fails.push(`${where}: weak tiers ${m.weakTiers.join(',')} (${m.weakTiers.length}) > M3 ${base.weakTiers.join(',')} (${base.weakTiers.length})`);
      }
      // a line that powers more machines, or opens more of them, may cost more; the rest must not
      if (m.unpowered >= base.unpowered && m.unreachable >= base.unreachable) {
        if (m.total > base.total) fails.push(`${where}: total ${m.total} > M3 ${base.total}`);
        if (m.lossEUt > base.lossEUt) fails.push(`${where}: lossEUt ${m.lossEUt} > M3 ${base.lossEUt}`);
      }
    }
    expect(fails, fails.join('\n')).toEqual([]);
    for (const mode of MODES) {
      const b = m3Rows().filter((r) => r.mode === mode);
      const l = live.filter((r) => r.mode === mode);
      expect(l.length, `${mode}: rows measured`).toBe(33);
      expect(sum(b, (r) => r.total), `M3 ${mode}: sum of total`).toBe(SUMS[mode].m3.total);
      expect(sum(b, (r) => r.lossEUt), `M3 ${mode}: sum of lossEUt`).toBe(SUMS[mode].m3.lossEUt);
      expect(sum(l, (r) => r.total), `M4 ${mode}: sum of total`).toBe(SUMS[mode].m4.total);
      expect(sum(l, (r) => r.lossEUt), `M4 ${mode}: sum of lossEUt`).toBe(SUMS[mode].m4.lossEUt);
    }
    expect(sum(m3Rows().filter((r) => r.mode === 'ae2'), (r) => r.unreachable), 'M3 ae2: sum of unreachable').toBe(AE2_UNREACHABLE.m3);
    expect(sum(live.filter((r) => r.mode === 'ae2'), (r) => r.unreachable), 'M4 ae2: sum of unreachable').toBe(AE2_UNREACHABLE.m4);
  });

  it('promise 2: the search record names the reordered line correctly', () => {
    const fails: string[] = [];
    let chose = 0, rejected = 0;
    for (const row of rows) {
      const where = `${row.name} ${row.mode}`;
      const search = row.layout.search;
      if (search === undefined) { fails.push(`${where}: the layout has no search record`); continue; }
      const index = search.candidates.map((c, i) => [c.kind, i] as const);
      const swapped = index.filter(([kind]) => kind === CandidateKind.Reordered).map(([, i]) => i);
      const others = index.filter(([kind]) => kind !== CandidateKind.Reordered).map(([, i]) => i);
      if (swapped.length > SWAP_CAP) fails.push(`${where}: ${swapped.length} Reordered candidates, more than the cap of ${SWAP_CAP}`);
      if (swapped.length > 0 && Math.min(...swapped) < Math.max(...others)) {
        fails.push(`${where}: Reordered candidates at ${swapped.join(',')} are not the last candidates (last other ${Math.max(...others)})`);
      }
      const chosen = search.candidates[search.chosen]!;
      expect(KIND[chosen.kind], `${where}: its chosen candidate is a known kind`).toBeDefined();
      if (chosen.kind === CandidateKind.Reordered) {
        chose++;
        if (search.rejected !== undefined) fails.push(`${where}: chose the Reordered candidate ${search.chosen} and still names rejected ${search.rejected}`);
        continue;
      }
      if (swapped.length === 0) continue;
      rejected++;
      if (search.rejected === undefined) {
        fails.push(`${where}: Reordered candidates at ${swapped.join(',')}, chose ${KIND[chosen.kind]} ${search.chosen}, names no rejected`);
      } else if (search.candidates[search.rejected]!.kind !== CandidateKind.Reordered) {
        fails.push(`${where}: rejected candidate ${search.rejected} is ${KIND[search.candidates[search.rejected]!.kind]}, not Reordered`);
      }
    }
    expect(fails, fails.join('\n')).toEqual([]);
    expect(chose, 'rows whose chosen line is Reordered').toBeGreaterThan(0);
    expect(rejected, 'rows that have a Reordered candidate and chose something else').toBeGreaterThan(0);
  });

  it('promise 3: a reordered line keeps the same machines as the same line laid unswapped', () => {
    const fails: string[] = [];
    const noPeer: string[] = [];
    const chosen: Row[] = rows.filter((r) => chosenOf(r.layout).kind === CandidateKind.Reordered);
    for (const [name, of] of [...byName(rows)].sort(([a], [b]) => a.localeCompare(b))) {
      const swapped = of.filter((r) => chosenOf(r.layout).kind === CandidateKind.Reordered);
      const plain = of.filter((r) => chosenOf(r.layout).kind !== CandidateKind.Reordered);
      if (swapped.length === 0) continue;
      if (plain.length === 0) { noPeer.push(name); continue; }
      for (const row of swapped) {
        const list = machinesOf(row.internal);
        for (const peer of plain) {
          const their = machinesOf(peer.internal);
          if (their !== list) fails.push(`${row.name} ${row.mode}: machines [${list}] differ from ${peer.mode} [${their}]`);
        }
      }
      // the unswapped rows of one line are laid from one plan, so their lists agree; if they do not, that is not M4's doing
      const lists = new Set(plain.map((r) => machinesOf(r.internal)));
      if (lists.size > 1) fails.push(`NOT M4: ${name}: its unswapped rows already disagree:\n${[...lists].join('\n')}`);
    }
    expect(fails, fails.join('\n')).toEqual([]);
    expect(chosen.length, 'rows whose chosen line is Reordered').toBeGreaterThan(0);
    // these lines have no unswapped row on this branch, so nothing here can check their swapped lines; named in the
    // RUK-3072 hand-over (spike SP-M): every one of their four modes chooses a Reordered line
    expect(noPeer, `lines with no unswapped row to compare against:\n${noPeer.join('\n')}`).toEqual(['mixed-02', 'mixed-03']);
  });

  it('promise 4: the search is deterministic and keeps its two pinned rows', async () => {
    const lay = async (name: string): Promise<Layout> => {
      const l = benchLines().find((x) => x.name === name)!;
      return layoutLine(layoutPack(), l.plan, l.scan('direct'), makeProject({ logistics: 'direct' }), l.deps);
    };
    for (const [name, kind, total, lossEUt] of [['mixed-01', CandidateKind.Reordered, 35, 335],
      ['fluid-02', CandidateKind.Stacked, 71, 441]] as const) {
      const first = await lay(name);
      const second = await lay(name);
      expect(JSON.stringify(second), `${name} direct: laying it twice gives a different layout`).toBe(JSON.stringify(first));
      const m = lengthOf(first);
      expect(m.total, `${name} direct: total blocks`).toBe(total);
      expect(m.lossEUt, `${name} direct: loss EU/t`).toBe(lossEUt);
      const chosen = chosenOf(first);
      expect(KIND[chosen.kind], `${name} direct: the chosen candidate`).toBe(KIND[kind]);
      const search = first.search!;
      if (kind === CandidateKind.Reordered) expect(search.rejected, `${name} direct: the chosen reordered line names no rejection`).toBeUndefined();
      else expect(KIND[search.candidates[search.rejected!]!.kind], `${name} direct: the rejected candidate`).toBe('Reordered');
    }
  }, 120_000);
});
