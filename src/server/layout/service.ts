// The layout service (Plan 5 Task 12; architecture §6.7, §7, §11.8, §11.15–§11.16; spec §3.5–§3.10): each project's
// line layout, cached by the plan's own cache key (export, scan, base, settings hash) plus the placement, which only
// the layout depends on; and the work of Plan 2's `planFinish` hook, which merges that layout into the plan: its power
// fit, its parts broken down to base materials, and its pin-linked build steps. The app's real dependencies read the
// world service and the planner hook on every call, so a service registered later is the one used.

import type { AppContext } from '../app.ts';
import { planForProject } from '../http/routes/projects.ts';
import { worldService } from '../http/routes/world.ts';
import { expandBomLines } from '../planner/bom.ts';
import { emptyContext, planCacheKey } from '../planner/plan.ts';
import { emptyScan, layoutLine, type LayoutDeps } from './layout.ts';
import { isOptional, mergeLayoutIntoPlan } from './merge.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { BomLine, Plan } from '../../shared/types/plan.ts';
import type { Project } from '../../shared/types/project.ts';
import type { BBox, Voxels, WorldScan } from '../../shared/types/world.ts';

/** Layouts kept, the least recently used dropped first. */
export const LAYOUT_CACHE_SIZE = 16;

/** The layout's required parts broken down to base materials (`expandBomLines`). */
interface Expansion { lines: BomLine[]; totals: BomLine[] }

export interface LayoutServiceDeps {
  pack(): Promise<Pack>;
  /** The project's plan before `planFinish`: the plan the plan route finishes. */
  plan(project: Project): Promise<Plan>;
  /** Null unless the scan is done. */
  scan(scanId: string): Promise<WorldScan | null>;
  readArea(scanId: string, dim: number, bbox: BBox): Promise<Voxels>;
  expand(pack: Pack, lines: BomLine[], project: Project): Promise<Expansion>;
  /** Tests inject failures; `layoutLine` by default. */
  layout?: typeof layoutLine;
}

export interface LayoutService {
  layoutFor(project: Project): Promise<Layout>;
  /** The plan with the project's layout merged in; a plan with nothing to build comes back as it is (same object). */
  finishPlan(plan: Plan, project: Project): Promise<Plan>;
  /** Layouts computed so far (cache misses). */
  readonly computations: number;
}

/** A cached layout and, once a plan was finished with it, its expansion. */
interface Entry { layout: Promise<Layout>; expansion: Promise<Expansion> | null }

/**
 * The plan cache key of `plan` in `project`'s scan and base (architecture §11.8), then the placement as
 * `<x>,<y>,<z>@<rotation>` ('-' without one).
 */
export function layoutKey(plan: Plan, project: Project): string {
  const { scanId, baseId } = project.world;
  const { placement } = project;
  return `${planCacheKey(plan.settingsHash, plan.exportId, scanId, baseId)}|${placement ? `${placement.origin.join(',')}@${placement.rotation}` : '-'}`;
}

/**
 * Layouts by `layoutKey`, at most `LAYOUT_CACHE_SIZE`. Callers that ask for a key while it is being laid out share
 * that computation; one that fails is not kept, so the next caller tries again. The same holds for the expansion of a
 * layout's parts, kept next to its layout.
 */
export function createLayoutService(deps: LayoutServiceDeps): LayoutService {
  const layOut = deps.layout ?? layoutLine;
  const entries = new Map<string, Entry>();
  let computations = 0;

  /** The layout of `plan` in `project`'s scan (an empty scan while there is none or it is not done). */
  async function compute(plan: Plan, project: Project): Promise<Layout> {
    const pack = await deps.pack();
    const { scanId } = project.world;
    if (scanId === null) return layOut(pack, plan, emptyScan(), project, {});
    const scan = await deps.scan(scanId);
    const layoutDeps: LayoutDeps = { readArea: (dim, bbox) => deps.readArea(scanId, dim, bbox) };
    return layOut(pack, plan, scan ?? emptyScan(), project, layoutDeps);
  }

  /**
   * The entry of `project`'s key, made the youngest; a miss starts the layout and drops the oldest beyond the cap.
   * Nothing is awaited between the lookup and the insert, so concurrent callers share one computation.
   */
  async function entryFor(project: Project): Promise<Entry> {
    const plan = await deps.plan(project);
    const key = layoutKey(plan, project);
    const hit = entries.get(key);
    if (hit !== undefined) {
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }
    computations++;
    const entry: Entry = { layout: compute(plan, project), expansion: null };
    entries.set(key, entry);
    if (entries.size > LAYOUT_CACHE_SIZE) entries.delete(entries.keys().next().value as string);
    entry.layout.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry;
  }

  /** The required parts of `layout` (its entry's) broken down to base materials, started on first use. */
  function expansionOf(entry: Entry, pack: Pack, layout: Layout, project: Project): Promise<Expansion> {
    if (entry.expansion !== null) return entry.expansion;
    const expansion = deps.expand(pack, layout.bom.filter((l) => !isOptional(l)), project);
    entry.expansion = expansion;
    expansion.catch(() => {
      if (entry.expansion === expansion) entry.expansion = null;
    });
    return expansion;
  }

  return {
    get computations() {
      return computations;
    },
    async layoutFor(project) {
      return (await entryFor(project)).layout;
    },
    async finishPlan(plan, project) {
      if (plan.status !== undefined && plan.status !== 'ok') return plan;
      const entry = await entryFor(project);
      const layout = await entry.layout;
      const pack = await deps.pack();
      return mergeLayoutIntoPlan(plan, layout, await expansionOf(entry, pack, layout, project), (k) => pack.nameOf(k));
    },
  };
}

/**
 * The app's layout service (`app.services.layout`), created on first use: the active pack, the plan the plan route
 * serves (`planForProject`), scans and voxels from the world service, and parts broken down in the project's world
 * context (`app.services.planContext`, else an empty one).
 */
export function layoutService(app: AppContext): LayoutService {
  const existing = app.services.layout as LayoutService | undefined;
  if (existing !== undefined) return existing;
  const service = createLayoutService({
    pack: () => app.pack(),
    plan: (project) => planForProject(app, project),
    scan: (scanId) => worldService(app).getScan(scanId),
    readArea: (scanId, dim, bbox) => worldService(app).readArea(scanId, dim, bbox),
    expand: async (pack, lines, project) =>
      expandBomLines(pack, lines, project.settings, await (app.services.planContext?.(project) ?? emptyContext())),
  });
  app.services.layout = service;
  return service;
}
