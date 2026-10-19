// Real-data check of the line layout (Plan 5 Task 16, architecture §10): plans a line on this host's newest done world
// scan with the active export and lays it out at the scan's first base in each logistics mode, as the app does. It runs
// only with GTNH_LOCAL=1 and is skipped everywhere else. It prints counts and codes only (machines, footprint, pin
// kinds, warning codes, power fit, milliseconds), never positions or names from the world, plus the cover rows of
// COVER_RATES as the export names them (pack data), so the cited rates and ids can be checked against research §3.8.
// Opening the world service marks unfinished scans of the config's data folder as interrupted.

import { beforeAll, describe, expect, it } from 'vitest';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { overlaps } from '../../../src/server/layout/arrange.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { COVER_RATES, resolveParts, type PartId } from '../../../src/server/layout/parts.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { planLine } from '../../../src/server/planner/plan.ts';
import { contextFromScan } from '../../../src/server/world/context.ts';
import { packFacts } from '../../../src/server/world/facts.ts';
import { createWorldService, type WorldService } from '../../../src/server/world/scan.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { configuredLines } from '../../../src/shared/layout/configure-text.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Base, WorldScan } from '../../../src/shared/types/world.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';

/** Iron Plate, unless GTNH_TARGET names another good. */
const DEFAULT_TARGET = 'gregtech:gt.metaitem.01@17032';
const PER_MINUTE = 60;
const LAYOUT_LIMIT_MS = 5_000;
const MODES: readonly LogisticsMode[] = ['direct', 'routed', 'ae2'];

/** A non-ghost block with covers or settings: what needs a configure step (architecture §11.14). */
function isConfigured(b: LayoutBlock): boolean {
  return b.role !== 'ghost' && ((b.covers?.length ?? 0) > 0 || Object.keys(b.config ?? {}).length > 0);
}

/** `code` or `code×n`, one per code in code order. */
function warningCodes(layout: Layout): string {
  const counts = new Map<string, number>();
  for (const w of layout.warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([code, n]) => (n === 1 ? code : `${code}×${n}`)).join(' ') || 'none';
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('a line laid out on the real world', () => {
  let pack: Pack, world: WorldService, scan: WorldScan, base: Base, settings: PlanSettings, plan: Plan;

  beforeAll(async () => {
    const config = loadConfig();
    pack = await loadPack(activeExportDir(config));
    world = createWorldService({ config, facts: async () => packFacts(pack), useWorker: false });
    const newest = (await world.listScans()).find((s) => s.state === 'done');   // newest first
    expect(newest, 'a done world scan in the data folder').toBeDefined();
    scan = (await world.getScan(newest!.id))!;
    expect(scan.bases.length, 'bases in the newest done scan').toBeGreaterThan(0);
    base = scan.bases[0]!;
    const target = (process.env.GTNH_TARGET || DEFAULT_TARGET) as StuffKey;
    expect(pack.items.has(target) || pack.fluids.has(target), `${target} in the export`).toBe(true);
    const ctx = contextFromScan(scan, pack, base.id);
    // A base that already owns every machine of the plan gets an `empty` layout (nothing new to place); declining to
    // reuse the owned types (spec §3.3, "the group decides") makes the check lay a whole new line out on the real ground.
    settings = { ...defaultSettings(), target, amount: PER_MINUTE, per: 'min', declineReuse: ctx.ownedMachines.map((m) => m.mteId) };
    plan = await planLine(pack, settings, ctx);
    expect(plan.status ?? 'ok', plan.warnings.map((w) => w.code).join(' ')).toBe('ok');
  }, 300_000);

  it('names every cover of COVER_RATES as the export does', () => {
    const rows = [...COVER_RATES.conveyor, ...COVER_RATES.pump];
    console.log(['real-layout cover rates (tier, key, export name, per second):',
      ...rows.map((r) => `${r.tier} ${r.key} ${pack.items.get(r.key)?.name ?? '(not in the export)'} ${r.perSecond}`)].join('\n'));
    expect(rows.filter((r) => pack.items.get(r.key)?.name !== r.name).map((r) => r.key)).toEqual([]);
  });

  it.each(MODES)('lays the line out in %s mode', { timeout: 60_000 }, async (mode) => {
    const project = { ...makeProject({ scanId: scan.id, baseId: base.id }), settings: { ...settings, logistics: mode } };
    const started = performance.now();
    const layout = await layoutLine(pack, plan, scan, project, { readArea: (dim, bbox) => world.readArea(scan.id, dim, bbox) });
    const ms = performance.now() - started;
    console.log(`real-layout ${mode}: status ${layout.status}, ${layout.blocks.filter((b) => b.role === 'machine').length} machines, `
      + `footprint ${layout.size.join('×')}, pins ${layout.pins.map((p) => p.kind).join(' ') || 'none'}, warnings ${warningCodes(layout)}, `
      + `fits ${layout.power?.fits ?? 'unknown'}, ${Math.round(ms)} ms`);

    expect(layout.status).toBe('ok');
    expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost')).length, 'cells holding two placed blocks').toBe(0);
    expect(ms).toBeLessThan(LAYOUT_LIMIT_MS);

    const parts = resolveParts(pack);
    const partOf = (key: StuffKey | undefined): string => (Object.keys(parts) as PartId[]).find((id) => parts[id].key === key) ?? key ?? '?';
    expect(layout.warnings.filter((w) => w.code === 'part_unknown').map((w) => partOf(w.key)), 'parts the export lacks: correct PART_DEFS').toEqual([]);

    expect(layout.bom.filter((l) => l.group === undefined).map((l) => l.key), 'parts-list lines without a group').toEqual([]);
    const nameOf = (k: StuffKey): string => plan.names?.[k] ?? pack.nameOf(k);
    const configureTexts = layout.buildSteps.filter((s) => s.id.startsWith('layout:configure:')).map((s) => s.text);
    const unexplained = layout.blocks.filter(isConfigured).filter((b) => {
      const how = configuredLines(b, nameOf).join('; ');
      return how === '' || !configureTexts.some((t) => t.startsWith(b.label) && t.endsWith(`: ${how}`));
    });
    expect(unexplained.map((b) => `${b.role} ${b.label}`), 'configured blocks without a layout:configure: step').toEqual([]);
  });
});
