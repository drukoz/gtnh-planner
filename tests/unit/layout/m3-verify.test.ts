// RUK-3044: milestone M3 verification (RUK-2877). The merged M3 tasks promise six things on the benchmark: no row is
// worse than M2 on power now that stacked, packed and open packed lines are search candidates judged with the two best
// kept (M3-1…M3-5, Assumption 4); packed lines appear only where a shared item port is legal (spikes SP-E, SP-G, SP-I);
// the GT rules still hold on every laid line (no two cable tiers touch, no machine starves, a machine's front is never
// its output side); the reach measure agrees with the `machine_unreachable` warning (Assumption 8, M3-8, M3-11); the
// rain roof covers every block GT rains on, is built last and is skipped where it never rains (M3-13, M3-14, M3-20,
// M3-17, gt-mechanics §3.4a); and a packed line's words never mention a middle row (M3-6, M3-7). These lay all 132
// benchmark rows through the real pipeline (`layoutLine`) and read `internal` through the `localLine` dep the way
// `lossLine` does; nothing here touches `src/`. M3's own totals are not comparable to M2's (the glass roof joins
// `total`, and `lossEUt` may rise a little), so promise 1 compares only what must not move.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CandidateKind, type Layout, type LayoutCandidate } from '../../../src/shared/types/layout.ts';
import type { LogisticsMode } from '../../../src/shared/types/plan.ts';
import type { BiomeInfo } from '../../../src/shared/types/pack.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import type { InternalResult } from '../../../src/server/layout/internal.ts';
import type { LocalBlock, Placement } from '../../../src/server/layout/arrange.ts';
import { unreachableMachines } from '../../../src/server/layout/reach.ts';
import { rainExposures } from '../../../src/server/layout/rain.ts';
import { benchLines, lengthOf, type LengthReport } from '../../helpers/layout-bench.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import { lossLine, tierContacts } from '../../helpers/power-loss.ts';

const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2', 'enderio'];
const KIND: Record<number, string> = { [CandidateKind.WestHead]: 'WestHead', [CandidateKind.MiddleHead]: 'MiddleHead',
  [CandidateKind.Stacked]: 'Stacked', [CandidateKind.Packed]: 'Packed', [CandidateKind.PackedOpen]: 'PackedOpen',
  [CandidateKind.Reordered]: 'Reordered' };
const M2_BASELINE = fileURLToPath(new URL('../../fixtures/layout-bench/baseline-m2.json', import.meta.url));
const m2Rows = (): LengthReport[] => JSON.parse(readFileSync(M2_BASELINE, 'utf8')) as LengthReport[];
const DESERT: BiomeInfo[] = [{ id: 2, name: 'Desert', rain: false }];
const PLAINS: BiomeInfo[] = [{ id: 1, name: 'Plains', rain: true }];

interface Row {
  name: string;
  mode: LogisticsMode;
  layout: Layout;
  placement: Placement;
  internal: InternalResult;
}

const rows: Row[] = [];

/** The row's own blocks (no hookup, no ghost) in the line's local grid: `layout.origin[1]` off every y, as `reach` and `rain` read it. */
const ownOf = (layout: Layout): LocalBlock[] => {
  const dy = layout.origin[1];
  return layout.blocks
    .filter((b) => b.hookup === undefined && b.role !== 'ghost')
    .map((b) => ({ ...b, pos: [b.pos[0], b.pos[1] - dy, b.pos[2]] }));
};

/** The blocks GT rains on (rain.ts `rainChecked`): every transformer, every energy hatch, every singleblock machine —
 *  a machine block is a GT singleblock when it carries `mainFacing`, and steam machines have no EU buffer. */
const rainCheckedOf = (own: readonly LocalBlock[]): LocalBlock[] => own.filter((b) => b.role === 'transformer'
  || (b.role === 'hatch' && b.hatch === 'energy')
  || (b.role === 'machine' && b.mainFacing !== undefined && !b.label.includes('Steam')));

const chosenOf = (layout: Layout): LayoutCandidate => {
  const search = layout.search;
  if (search === undefined) throw new Error('the line has no search record');
  return search.candidates[search.chosen]!;
};

const starvedOf = (internal: InternalResult): string[] =>
  internal.machines.filter((m) => !m.powered && m.tier <= m.feedTier).map((m) => m.stepId);

/** How many blocks of these rows GT rains on, so promise 5's exposure check is not vacuous. */
const checkedTotal = (rows: readonly Row[]): number => rows.reduce((n, r) => n + rainCheckedOf(ownOf(r.layout)).length, 0);

describe('milestone M3 verification', () => {
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

  it('promise 1: no row is worse than M2 on what the chosen line must never lose', () => {
    const m2 = new Map(m2Rows().map((r) => [`${r.name} ${r.mode}`, r]));
    expect(m2.size).toBe(132);
    const fails: string[] = [];
    for (const row of rows) {
      const base = m2.get(`${row.name} ${row.mode}`);
      if (base === undefined) { fails.push(`${row.name} ${row.mode}: no M2 baseline row`); continue; }
      const m = lengthOf(row.layout);
      // M2's baseline predates the roof and reach: a missing `roof` or `unreachable` reads as 0, and `total`/`lossEUt`
      // are not compared (M3 adds the glass roof to `total`, and may lose a few EU/t more in direct and EnderIO).
      const weak = m.weakTiers.length, baseWeak = base.weakTiers.length;
      if (m.unpowered > base.unpowered) fails.push(`${row.name} ${row.mode}: unpowered ${m.unpowered} > M2 ${base.unpowered}`);
      if (m.routeFailed > base.routeFailed) fails.push(`${row.name} ${row.mode}: routeFailed ${m.routeFailed} > M2 ${base.routeFailed}`);
      if (weak > baseWeak) fails.push(`${row.name} ${row.mode}: weak tiers ${m.weakTiers.join(',')} (${weak}) > M2 ${base.weakTiers.join(',')} (${baseWeak})`);
    }
    expect(fails, fails.join('\n')).toEqual([]);
  });

  it('promise 2: packed lines are chosen only where a shared item port is legal', () => {
    const packedIn = new Map<CandidateKind, readonly LogisticsMode[]>([
      [CandidateKind.Packed, ['direct', 'enderio', 'ae2']],
      [CandidateKind.PackedOpen, ['ae2']],
    ]);
    const chosen: string[] = [];
    for (const row of rows) {
      const kind = chosenOf(row.layout).kind;
      expect(KIND[kind], `${row.name} ${row.mode}: its chosen candidate is a known kind`).toBeDefined();
      const legal = packedIn.get(kind);
      if (legal === undefined) continue;
      expect(legal, `${row.name} ${row.mode}: a ${KIND[kind]} line was chosen in ${row.mode}`).toContain(row.mode);
      chosen.push(`${row.name} ${row.mode}`);
    }
    expect(rows.filter((r) => r.mode === 'routed' && packedIn.has(chosenOf(r.layout).kind))).toEqual([]);
    // packed lines do get chosen on this branch, so the check above is not vacuous
    expect(chosen.length, 'rows whose chosen line is packed').toBeGreaterThan(0);
  });

  it('promise 3: the GT rules hold on every laid line', () => {
    const contacts: string[] = [];
    const starved: string[] = [];
    const facing: string[] = [];
    let singleblocks = 0;
    for (const row of rows) {
      const where = `${row.name} ${row.mode}`;
      const touching = tierContacts(row.internal.blocks, row.internal.cables, row.placement);
      if (touching.length > 0) contacts.push(`${where}: ${touching.join('; ')}`);
      const hungry = starvedOf(row.internal);
      if (hungry.length > 0) starved.push(`${where}: ${hungry.join(', ')}`);
      for (const b of ownOf(row.layout)) {
        if (b.mainFacing === undefined) continue;
        singleblocks++;
        // GT keeps `mMainFacing` apart from `mFacing` (the output side, where the output cover and inputs go)
        if (b.mainFacing === b.facing) facing.push(`${where}: ${b.label} at ${b.pos.join(',')} has front = output side = ${b.mainFacing}`);
      }
    }
    expect(contacts, `cable tiers touching\n${contacts.join('\n')}`).toEqual([]);
    expect(starved, `starved machines\n${starved.join('\n')}`).toEqual([]);
    expect(singleblocks, 'GT singleblock machine blocks checked').toBeGreaterThan(100);
    expect(facing, `a machine's front is its output side\n${facing.join('\n')}`).toEqual([]);
  });

  it('promise 4: a row has unreachable machines exactly when it warns machine_unreachable', () => {
    const shutRows: string[] = [];
    const fails: string[] = [];
    for (const row of rows) {
      const where = `${row.name} ${row.mode}`;
      const own = ownOf(row.layout);
      const shut = unreachableMachines(own);
      const warned = row.layout.warnings.filter((w) => w.code === 'machine_unreachable');
      if ((shut.length > 0) !== (warned.length > 0)) {
        fails.push(`${where}: ${shut.length} shut-in machine(s) ${shut.map((p) => p.join(',')).join(' | ')}, ${warned.length} machine_unreachable warning(s)`);
        continue;
      }
      if (shut.length === 0) continue;
      const at = new Set(shut.map((p) => p.join(',')));
      const labels = own.filter((b) => b.role === 'machine' && at.has(b.pos.join(','))).map((b) => b.label);
      shutRows.push(`${where}: ${shut.length} × ${[...new Set(labels)].join(', ')}`);
      expect(warned.length, `${where}: one machine_unreachable warning`).toBe(1);
      expect(warned[0]!.text, `${where}: the warning names the shut-in machines`)
        .toContain(shut.length === 1 ? '1 machine is closed in' : `${shut.length} machines are closed in`);
      expect(warned[0]!.text, `${where}: the warning names them by label`).toContain(labels[0]!);
    }
    expect(fails, fails.join('\n')).toEqual([]);
    expect(shutRows.sort(), `rows with shut-in machines:\n${shutRows.join('\n')}`).toEqual([
      'mixed-02 ae2: 1 × Electric Blast Furnace', 'mixed-03 ae2: 2 × Electric Blast Furnace',
      'mixed-18 ae2: 1 × Electric Blast Furnace',
    ]);
  });

  it('promise 5: the rain roof covers every block GT rains on, and the step names its count', () => {
    const exposed: string[] = [];
    const steps: string[] = [];
    let roofed = 0;
    for (const row of rows) {
      const where = `${row.name} ${row.mode}`;
      const own = ownOf(row.layout);
      const checked = rainCheckedOf(own);
      for (const e of rainExposures(own, checked)) {
        if (e.top || e.sides.length > 0) exposed.push(`${where}: ${e.pos.join(',')} ${e.top ? 'top' : ''} ${e.sides.join(',')}`);
      }
      const n = own.filter((b) => b.role === 'roof').length;
      const order = row.layout.buildSteps.map((s) => s.id);
      if (n === 0) {
        expect(order, `${where}: a line with no roof blocks has no roof step`).not.toContain('layout:roof');
        continue;
      }
      roofed += n;
      expect(order[order.length - 2], `${where}: the roof step is second to last, just before layout:test`).toBe('layout:roof');
      expect(order[order.length - 1], `${where}: the last step is the test`).toBe('layout:test');
      const text = row.layout.buildSteps.find((s) => s.id === 'layout:roof')!.text;
      expect(text, `${where}: the roof step counts the roof blocks (${n})`).toContain(`${n}× Glass`);
      const bom = row.layout.bom.find((l) => l.why === 'rain roof');
      if (bom === undefined || bom.amount !== n) steps.push(`${where}: ${n} roof blocks, bom rain roof ${bom?.amount ?? 'missing'}`);
    }
    expect(checkedTotal(rows), 'blocks GT rains on').toBeGreaterThan(100);
    expect(roofed, 'roof blocks over the bench').toBeGreaterThan(100);
    expect(exposed, `rain reaches a checked block\n${exposed.join('\n')}`).toEqual([]);
    expect(steps, `the roof bom does not match\n${steps.join('\n')}`).toEqual([]);
  });

  it('promise 5: a dry biome lays no roof, a raining one keeps it', async () => {
    for (const mode of MODES) {
      const dry = (await lossLine(10, mode, { biomes: DESERT, biome: 2 })).layout;
      expect(dry.blocks.filter((b) => b.role === 'roof'), `${mode}: a Desert line lays a roof`).toEqual([]);
      expect(dry.buildSteps.map((s) => s.id), `${mode}: a Desert line has a roof step`).not.toContain('layout:roof');
      expect(dry.bom.filter((l) => l.why === 'rain roof'), `${mode}: a Desert line's bom has a rain roof line`).toEqual([]);
      expect(dry.dryBiomes, `${mode}: the dry biomes are named`).toEqual(['Desert']);
      for (const [tag, opts] of [['Plains', { biomes: PLAINS, biome: 1 }], ['no biome table', {}]] as const) {
        const wet = (await lossLine(10, mode, opts)).layout;
        expect(wet.blocks.filter((b) => b.role === 'roof').length, `${mode}: the ${tag} line keeps its roof`).toBeGreaterThan(0);
        expect(wet.buildSteps.map((s) => s.id), `${mode}: the ${tag} line has a roof step`).toContain('layout:roof');
        expect(wet.dryBiomes, `${mode}: the ${tag} line names no dry biome`).toBeUndefined();
      }
    }
  }, 300_000);

  it('promise 6: a packed line\'s build steps never mention a middle row', () => {
    let packed = 0;
    const fails: string[] = [];
    for (const row of rows) {
      const kind = chosenOf(row.layout).kind;
      if (kind !== CandidateKind.Packed && kind !== CandidateKind.PackedOpen) continue;
      packed++;
      const said = row.layout.buildSteps.filter((s) => s.text.includes('middle row') || s.text.includes('middle-row'))
        .map((s) => `${s.id}: ${s.text}`);
      if (said.length > 0) fails.push(`${row.name} ${row.mode} (${KIND[kind]}):\n${said.join('\n')}`);
    }
    expect(packed, 'rows whose chosen line is packed').toBeGreaterThan(0);
    expect(fails, `a packed line has no middle row\n${fails.join('\n')}`).toEqual([]);
  });
});
