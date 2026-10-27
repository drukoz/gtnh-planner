// Real-data check of the EnderIO mode (plan 11 Task 9, built like Plan 5's real-layout check; architecture §10): the
// active export of this host and the newest done scan in the config's data folder, a line of GTNH_TARGET (Iron Plate
// by default) at 60/min planned for the scan's first base in EnderIO mode and laid out next to it, as the app does. It
// runs only with GTNH_LOCAL=1 and is skipped everywhere else. It prints the EnderIO parts as the export names them
// (pack data, so the keys and names in PART_DEFS can be checked again) and otherwise counts and codes only, never a
// position or a name from the world. Opening the world service marks unfinished scans of the data folder as
// interrupted.

import { beforeAll, describe, expect, it } from 'vitest';
import { connectionsGraph } from '../../../src/client/connections/model.ts';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { overlaps } from '../../../src/server/layout/arrange.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { PART_DEFS, resolveParts, type PartId } from '../../../src/server/layout/parts.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { machineByMteId } from '../../../src/server/pack/lookup.ts';
import { planLine } from '../../../src/server/planner/plan.ts';
import { contextFromScan } from '../../../src/server/world/context.ts';
import { packFacts } from '../../../src/server/world/facts.ts';
import { createWorldService } from '../../../src/server/world/scan.ts';
import type { StuffKey } from '../../../src/shared/keys.ts';
import { CHANNEL_PALETTE } from '../../../src/shared/layout/enderio.ts';
import { OPPOSITE, posKey, step } from '../../../src/shared/layout/geometry.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { ConduitFace, ConduitFilter, DyeColor, Layout } from '../../../src/shared/types/layout.ts';
import type { Pack } from '../../../src/shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';

/** Iron Plate, unless GTNH_TARGET names another good. */
const DEFAULT_TARGET = 'gregtech:gt.metaitem.01@17032';
const PER_MINUTE = 60;
const LAYOUT_LIMIT_MS = 5_000;
const EIO_PARTS = (Object.keys(PART_DEFS) as PartId[]).filter((id) => id.startsWith('eio_'));

/** `value` or `value×n`, one per value in sorted order; `none` for an empty list. */
function counts(values: readonly string[]): string {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([v, c]) => (c === 1 ? v : `${v}×${c}`)).join(' ') || 'none';
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('an EnderIO line laid out on the real world', () => {
  let pack: Pack, plan: Plan, layout: Layout;
  let layoutMs = 0;

  beforeAll(async () => {
    const config = loadConfig();
    pack = await loadPack(activeExportDir(config));
    const world = createWorldService({ config, facts: async () => packFacts(pack), useWorker: false });
    const newest = (await world.listScans()).find((s) => s.state === 'done');   // newest first
    expect(newest, 'a done world scan in the data folder').toBeDefined();
    const scan = (await world.getScan(newest!.id))!;
    expect(scan.bases.length, 'bases in the newest done scan').toBeGreaterThan(0);
    const base = scan.bases[0]!;
    const target = (process.env.GTNH_TARGET || DEFAULT_TARGET) as StuffKey;
    expect(pack.items.has(target) || pack.fluids.has(target), `${target} in the export`).toBe(true);
    const ctx = contextFromScan(scan, pack, base.id, 'enderio');
    // as in Plan 5's check: a base that already owns every machine of the plan gets an `empty` layout, so the owned
    // types are declined (spec §3.3, "the group decides") and a whole new line is laid out on the real ground
    const settings: PlanSettings = {
      ...defaultSettings(), target, amount: PER_MINUTE, per: 'min', logistics: 'enderio', declineReuse: ctx.ownedMachines.map((m) => m.mteId),
    };
    plan = await planLine(pack, settings, ctx);
    expect(plan.status ?? 'ok', plan.warnings.map((w) => w.code).join(' ')).toBe('ok');
    const project = { ...makeProject({ scanId: scan.id, baseId: base.id }), settings };
    const started = performance.now();
    layout = await layoutLine(pack, plan, scan, project, { readArea: (dim, bbox) => world.readArea(scan.id, dim, bbox) });
    layoutMs = performance.now() - started;
  }, 300_000);

  it('finds every EnderIO part in the export under the key PART_DEFS gives it', () => {
    const rows = EIO_PARTS.map((id) => {
      const key = PART_DEFS[id].keys[0]!;
      return { id, key, name: pack.items.get(key)?.name };
    });
    console.log(['real-enderio parts (part, key, export name):', ...rows.map((r) => `${r.id} ${r.key} ${r.name ?? '(not in the export)'}`)].join('\n'));
    expect(rows.filter((r) => r.name === undefined).map((r) => r.id), 'EnderIO parts the export lacks: correct PART_DEFS').toEqual([]);
  });

  it('sets, counts and links every conduit face of the line', () => {
    const faces = layout.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((face) => ({ kind: c.kind, face, hookup: b.hookup }))));
    const filters = faces.flatMap(({ face }) => [face.extract?.filter, face.insert?.filter]).filter((f): f is ConduitFilter => f !== null && f !== undefined);
    const parts = resolveParts(pack);
    const partOf = new Map(EIO_PARTS.map((id) => [parts[id].key, id]));
    const colours = (f: ConduitFace): DyeColor[] => [f.extract?.color, f.insert?.color].filter((c): c is DyeColor => c !== undefined);
    // the line's own channels: a hookup's end face inserts on the base network, on the storage tap's own channel
    const itemColours = new Set(faces.filter((f) => f.kind === 'item' && f.hookup === undefined).flatMap((f) => colours(f.face)));
    const fluidColours = new Set(faces.filter((f) => f.kind !== 'item').flatMap((f) => colours(f.face)));
    const conduitBlocks = layout.blocks.filter((b) => (b.conduits ?? []).length > 0);
    const hookup = layout.hookups.find((h) => h.kind === 'logistics');
    const codes = layout.warnings.map((w) => w.code);
    // a flow with a placed end: from or into a step whose machines the line places
    const placed = new Set(layout.blocks.flatMap((b) => (b.role === 'machine' && b.hookup === undefined && b.stepId !== undefined ? [b.stepId] : [])));
    const graph = connectionsGraph(layout, plan, 'min');
    const flows = plan.flows.filter((f) => placed.has(f.from) || placed.has(f.to));
    const unlinked = flows.filter((f) => !graph.edges.some((e) => e.key === f.key
      && (!placed.has(f.from) || e.from === `step:${f.from}`) && (!placed.has(f.to) || e.to === `step:${f.to}`)));
    console.log(`real-enderio: status ${layout.status}, mode ${layout.mode}, conduit blocks ${conduitBlocks.length}, `
      + `bundles ${conduitBlocks.filter((b) => b.conduits!.length > 1).length}, faces ${counts(faces.map((f) => f.face.mode))}, `
      + `filters ${counts(filters.map((f) => (f.item === undefined ? 'fluid' : partOf.get(f.item) ?? 'other')))}, `
      + `speed upgrades ${faces.reduce((n, f) => n + (f.face.extract?.speed?.count ?? 0), 0)}, colours ${itemColours.size} item ${fluidColours.size} fluid, `
      + `logistics hookup ${hookup === undefined ? 'none' : hookup.found === false ? 'guide' : 'found'}, `
      + `flows with a placed end ${flows.length}, links ${graph.edges.length}, warnings ${counts(codes)}, ${Math.round(layoutMs)} ms`);

    // a failure tells counts, codes and pack keys only: the line stands next to a real base
    expect(layout.status).toBe('ok');
    expect(layout.mode).toBe('enderio');
    expect(overlaps(layout.blocks.filter((b) => b.role !== 'ghost')).length, 'cells holding two placed blocks').toBe(0);
    expect(layoutMs).toBeLessThan(LAYOUT_LIMIT_MS);
    expect(layout.warnings.filter((w) => w.code === 'part_unknown').map((w) => w.key), 'parts the export lacks: correct PART_DEFS').toEqual([]);
    expect(faces.length, 'conduit faces').toBeGreaterThan(0);
    expect(layout.buildSteps.filter((s) => s.id.startsWith('layout:conduit:')).length, 'layout:conduit: steps').toBe(faces.length);
    expect(layout.bom.filter((l) => l.group === undefined).map((l) => l.key), 'parts-list lines without a group').toEqual([]);
    expect(layout.bom.filter((l) => partOf.has(l.key) && l.group !== 'logistics').map((l) => l.key), 'EnderIO lines outside logistics').toEqual([]);
    expect(faces.filter(({ face }) => face.extract !== undefined && face.extract.redstone !== 'ignore').map((f) => `${f.kind} ${f.face.mode} ${f.face.extract!.redstone}`),
      'extract faces not Always active').toEqual([]);
    expect(itemColours.size <= CHANNEL_PALETTE.length || codes.includes('conduit_channels'), `${itemColours.size} item channel colours`).toBe(true);
    // the single pipe: the line's one channel, and one more only for the input chest's raw inputs
    expect(itemColours.size, 'item channel colours').toBeLessThanOrEqual(2);
    // one connection per GT basic machine: an ender fluid conduit meets it on its output side, beside its item face
    const at = new Map(layout.blocks.map((b) => [posKey(b.pos), b]));
    const offSide = layout.blocks.flatMap((b) => (b.conduits ?? []).filter((c) => c.kind !== 'item').flatMap((c) => c.faces.filter((f) => {
      const side = FACES.indexOf(f.face);
      const target = at.get(posKey(step(b.pos, side)));
      const basic = target?.role === 'machine' && target.block.mteId !== undefined && machineByMteId(pack, target.block.mteId)?.kind === 'basic';
      return f.mode !== 'disabled' && basic && target.facing !== OPPOSITE[side];
    })));
    expect(offSide.length, 'fluid faces of basic machines off their output side').toBe(0);
    expect(unlinked.map((f) => f.key), 'flows with a placed end and no link').toEqual([]);
  });
});
