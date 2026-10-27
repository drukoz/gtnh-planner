// Real-data check of GT's primitive machines in the routed, AE2 and EnderIO modes (architecture §10 and §11 entry 48):
// the active export of this host, and two lines made of its own recipes and machines, laid out as the app lays out a
// project without a world: a steam-age line (Steam Macerators, a Steam Alloy Smelter and a Steam Forge Hammer making
// Bronze Plates) and a steel line (Coke Ovens and Bricked Blast Furnaces making Steel Ingots for a Basic Bending
// Machine and a Steam Macerator). The planner never picks a steam machine, so the lines are put together from the
// export's recipes here. It reads the export only (no world scan or service is opened), runs only with GTNH_LOCAL=1 and
// is skipped everywhere else, and prints counts and warning codes only.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { emptyScan, layoutLine } from '../../../src/server/layout/layout.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { OPPOSITE, step, type Vec3 } from '../../../src/shared/layout/geometry.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanFlow } from '../../../src/shared/types/plan.ts';
import { makePlan, makeProject, type StepSpec } from '../../helpers/layout-fixtures.ts';

const MODES = ['routed', 'ae2', 'enderio'] as const;
const UP = 1;
const HORIZONTAL = [2, 3, 4, 5];
const LAYOUT_LIMIT_MS = 5_000;
/** The machines of the export the lines run on (GT mte ids). */
const STEAM_MACERATOR = 106, STEAM_ALLOY_SMELTER = 118, STEAM_FORGE_HAMMER = 112, BRICKED_BLAST_FURNACE = 140, COKE_OVEN = 236, BENDER_LV = 221;
/** Their recipes (content-hash ids, stable across re-exports). */
const R = {
  copperDust: '75e6ae6de3b322d7', tinDust: 'e4e4276e01b1a867', bronze: '40cc736b3009f2fe', bronzePlate: 'a1421e687c4c7519',
  coke: '1bd897154fa732bb', steel: 'e91337e7a8f15fb1', steelPlate: '476e63bb6f889d49', steelDust: '09b767dbb5b1f5b1',
} as const;

const key = (p: readonly number[]) => p.join();
const adjacent = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;

/** `value` or `value×n`, one per value in sorted order; `none` for an empty list. */
function counts(values: readonly string[]): string {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([v, c]) => (c === 1 ? v : `${v}×${c}`)).join(' ') || 'none';
}

/** A plan step of `count` × machine `mteId` on the export's recipe `recipeId` (its id is the recipe's, so its circuit is found). */
function stepOf(pack: Pack, recipeId: string, mteId: number, count: number): StepSpec {
  const r = pack.recipeById.get(recipeId);
  const m = machineByMteId(pack, mteId);
  expect(r, `recipe ${recipeId} in the export`).toBeDefined();
  expect(m, `machine ${mteId} in the export`).toBeDefined();
  return {
    id: recipeId, mteId, count, tier: m!.tier ?? 1, euPerTick: r!.euPerTick, name: m!.name,
    inputs: r!.inputs.filter((i) => i.consumed).map((i): [string, number] => [i.options[0]!.key, i.options[0]!.amount]),
    outputs: r!.outputs.map((o): [string, number] => [o.key, o.amount * o.chance]),
  };
}

/** The flows of `steps`: each input from the step listed for it in `from` (else raw), each output to the step taking it (else out). */
function chained(steps: readonly StepSpec[], from: Readonly<Record<string, string>>): PlanFlow[] {
  const flows: PlanFlow[] = [];
  for (const s of steps) {
    for (const [k] of s.inputs ?? []) flows.push({ from: from[`${s.id}:${k}`] ?? 'raw', to: s.id, key: k, perSecond: 1 });
    for (const [k] of s.outputs ?? []) {
      if (!steps.some((t) => (t.inputs ?? []).some(([i]) => i === k) && from[`${t.id}:${k}`] === s.id)) flows.push({ from: s.id, to: 'out', key: k, perSecond: 1 });
    }
  }
  return flows;
}

/** The steam-age line: copper and tin ingots to dust, Bronze Ingots, Bronze Plates, all on steam machines. */
function steamLine(pack: Pack): Plan {
  const steps = [stepOf(pack, R.copperDust, STEAM_MACERATOR, 3), stepOf(pack, R.tinDust, STEAM_MACERATOR, 1), stepOf(pack, R.bronze, STEAM_ALLOY_SMELTER, 1),
    stepOf(pack, R.bronzePlate, STEAM_FORGE_HAMMER, 2)];
  const [copper, tin, bronze, plate] = steps.map((s) => s.id);
  return makePlan(steps, { flows: chained(steps, {
    [`${bronze}:gregtech:gt.metaitem.01@2035`]: copper!, [`${bronze}:gregtech:gt.metaitem.01@2057`]: tin!, [`${plate}:gregtech:gt.metaitem.01@11300`]: bronze!,
  }) });
}

/** The steel line: Coal Coke from Coke Ovens and Steel Ingots from Bricked Blast Furnaces for a Basic Bending Machine and a Steam Macerator. */
function steelLine(pack: Pack): Plan {
  const steps = [stepOf(pack, R.coke, COKE_OVEN, 2), stepOf(pack, R.steel, BRICKED_BLAST_FURNACE, 2), stepOf(pack, R.steelPlate, BENDER_LV, 1),
    stepOf(pack, R.steelDust, STEAM_MACERATOR, 1)];
  const [coke, steel, plate, dust] = steps.map((s) => s.id);
  return makePlan(steps, { flows: chained(steps, {
    [`${steel}:Railcraft:fuel.coke@0`]: coke!, [`${plate}:gregtech:gt.metaitem.01@11305`]: steel!, [`${dust}:gregtech:gt.metaitem.01@11305`]: steel!,
  }) });
}

/** The side of a steam machine its own logistics part touches: its interface, interface pipe or conduit face. */
function servedSide(layout: Layout, machine: LayoutBlock): number | undefined {
  const at = new Map(layout.blocks.map((b) => [key(b.pos), b]));
  return HORIZONTAL.find((side) => {
    const b = at.get(key(step(machine.pos, side)));
    return b !== undefined && (b.label.endsWith(`(${machine.label})`)
      || (b.conduits ?? []).some((c) => c.faces.some((f) => f.target === machine.label && f.mode !== 'disabled')));
  });
}

/** What breaks the primitive rules in `layout`, one text per fault (machine names and codes only). */
function faults(pack: Pack, layout: Layout): string[] {
  const out: string[] = [];
  const taken = new Set(layout.blocks.map((b) => key(b.pos)));
  for (const s of layout.blocks.filter((b) => b.role === 'machine' && b.block.mteId !== undefined && machineByMteId(pack, b.block.mteId)?.kind === 'steam')) {
    if (s.facing !== UP || !HORIZONTAL.includes(s.mainFacing ?? -1)) out.push(`${s.label}: output side ${s.facing}, front ${s.mainFacing}`);
    if ((s.covers ?? []).length > 0) out.push(`${s.label}: a cover`);
    if (taken.has(key(step(s.pos, UP)))) out.push(`${s.label}: a block on its vent`);
    const served = servedSide(layout, s);
    if (served === undefined) out.push(`${s.label}: no logistics part on its middle-row side`);
    else if (taken.has(key(step(s.pos, OPPOSITE[served]!)))) out.push(`${s.label}: a block on its steam inlet`);
  }
  const manualSteps = new Set(layout.blocks.filter((b) => b.role === 'machine' && (b.block.mteId === BRICKED_BLAST_FURNACE || b.block.mteId === COKE_OVEN))
    .map((b) => b.stepId!));
  for (const id of manualSteps) {
    const own = layout.blocks.filter((b) => b.stepId === id && b.hookup === undefined && b.role !== 'ghost');
    const mine = new Set(own.map((b) => key(b.pos)));
    const name = own.find((b) => b.role === 'machine')!.label;
    if (own.some((b) => b.role !== 'machine' && b.role !== 'casing')) out.push(`${name}: a hatch`);
    if (own.some((b) => (b.covers ?? []).length > 0)) out.push(`${name}: a cover`);
    const touching = layout.blocks.filter((b) => !mine.has(key(b.pos)) && own.some((c) => adjacent(c.pos, b.pos)));
    if (touching.length > 0) out.push(`${name}: touched by ${counts(touching.map((b) => b.role))}`);
    for (const c of own.filter((b) => b.role === 'machine')) if (taken.has(key(step(c.pos, c.facing!)))) out.push(`${name}: a block in front of its controller`);
  }
  return out;
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')("GT's primitive machines laid out with the real export", () => {
  let pack: Pack;

  beforeAll(async () => {
    pack = await loadPack(activeExportDir(loadConfig()));
  }, 300_000);

  it.each(MODES)('%s mode: steam machines vent up, furnaces and ovens are run by hand', { timeout: 60_000 }, async (mode) => {
    const project = { ...makeProject({ logistics: mode, scanId: null, baseId: null }) };
    for (const [line, plan] of [['steam-age', steamLine(pack)], ['steel', steelLine(pack)]] as const) {
      const started = performance.now();
      const layout = await layoutLine(pack, plan, emptyScan(), project);
      const ms = performance.now() - started;
      const steam = layout.blocks.filter((b) => b.role === 'machine' && b.block.mteId !== undefined && machineByMteId(pack, b.block.mteId)?.kind === 'steam');
      const hand = layout.buildSteps.filter((s) => s.id.startsWith('layout:hand:'));
      console.log(`real-primitive ${mode} ${line}: status ${layout.status}, ${layout.blocks.filter((b) => b.role === 'machine').length} machines `
        + `(${steam.length} steam), footprint ${layout.size.join('×')}, hand steps ${hand.length}, warnings ${counts(layout.warnings.map((w) => w.code))}, `
        + `${Math.round(ms)} ms`);
      expect(layout.status).toBe('no-world');
      expect(faults(pack, layout), `${line} line`).toEqual([]);
      const placed = layout.blocks.filter((b) => b.role !== 'ghost');
      expect(new Set(placed.map((b) => key(b.pos))).size, `${line}: cells holding two blocks`).toBe(placed.length);
      expect(ms).toBeLessThan(LAYOUT_LIMIT_MS);
      expect(layout.warnings.filter((w) => w.code === 'part_unknown').map((w) => w.key), 'parts the export lacks').toEqual([]);
      if (line === 'steam-age') {
        expect(steam.length).toBe(7);
        // AE2: nothing takes a steam machine's output back into the ME system, so each step's is taken out by hand
        expect(hand.length).toBe(mode === 'ae2' ? 4 : 0);
        expect(layout.warnings.filter((w) => w.code === 'steam_items').length).toBe(mode === 'ae2' ? 4 : 0);
      } else {
        expect(layout.warnings.filter((w) => w.code === 'manual_machine').map((w) => w.stepId)).toEqual([R.coke, R.steel]);
        expect(hand.map((s) => s.id)).toEqual([...(mode === 'ae2' ? [`layout:hand:${R.steelDust}:empty`] : []),
          `layout:hand:${R.coke}:fill`, `layout:hand:${R.coke}:empty`, `layout:hand:${R.steel}:fill`, `layout:hand:${R.steel}:empty`]);
        expect(hand.find((s) => s.id === `layout:hand:${R.steel}:fill`)!.text.startsWith('Fill each Bricked Blast Furnace (2×) by hand: 1× Iron Ingot + 2× ')).toBe(true);
        // only the bending machine draws power: one energy-free line but for its LV cable
        expect(layout.blocks.filter((b) => b.role === 'hatch')).toEqual([]);
      }
    }
  });
});
