// Real-data acceptance of the add-on 12 x 17 integration, A2 and A3 (design spec §3.11; architecture §11.45 (4)): the
// group's live projects, alone and on the surplus board. Alone (A2), each plans within main's new machine blocks unless
// it uses less raw material a minute (main's plan breaks the raw cap), the known exceptions held to their measured
// bounds; by hand nowhere (the user's "crafting always automated", the controller's U2), with no free loop and its build
// MIP not stalled at its start; the duty project with farms on at most one new block above farms off (the user's U1);
// the poly project's farm rule logged at its stored step charge and at 0.5 (OPEN-2, fix wave 4). On the board (A3), the
// projects planned oldest first, each reading and publishing surplus, settle in two rounds, by hand nowhere and within
// main's settled board; and the duty project, whose plan decides the board, plans alike on a recorded board and on that
// board with every offer x 0.999. Each case plans on fresh apps over temporary copies of a `sqlite3 .backup` of the live
// database (the gitignored data/planner.sqlite); the projects' names, main's figures, the known exceptions and the boards
// come from the gitignored docs/local/int12x17/ (live.json, boards/), never from this file. It runs only with
// GTNH_LOCAL=1 and live.json there, and logs counts, figures, hashes and the projects' names.

import { afterAll, describe, expect, it, vi } from 'vitest';

// The build MIP's end of every plan made here (A3 (a) logs the duty project's each round) comes from the solves that plan
// ran: every call runs the real `solveLine`.
vi.mock('../../../src/server/planner/solve.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/server/planner/solve.ts')>();
  return { ...mod, solveLine: vi.fn(mod.solveLine) };
});

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createApp, type AppContext } from '../../../src/server/app.ts';
import { loadConfig } from '../../../src/server/config.ts';
import { ROUTE_MODULES } from '../../../src/server/http/routes/index.ts';
import { planForProject } from '../../../src/server/http/routes/projects.ts';
import { solveLine, type Solution } from '../../../src/server/planner/solve.ts';
import { SUMMARY_PREFIX, type PublishedSummary } from '../../../src/server/projects/surplus.ts';
import { defaultFarmSettings } from '../../../src/shared/types/farm.ts';
import type { Plan, PlanSettings } from '../../../src/shared/types/plan.ts';
import type { Project } from '../../../src/shared/types/project.ts';
import { localDocPath } from '../../helpers/local-docs.ts';
import { buildRun, newBlocks } from '../../helpers/real-build-cases.ts';

/** The live projects, main's figures and the known exceptions (`Live`; gitignored, never committed). */
const LIVE = join('docs', 'local', 'int12x17', 'live.json');
/**
 * The boards of A3 (b), each the published summaries of the other live projects: the one the duty project read in
 * round 0 on the merge before this integration, and that board with every offer x 0.999 (gitignored, never committed).
 */
const BOARDS = ['beforeDuty-r0.json', 'r0-x0999.json'].map((file) => join('docs', 'local', 'int12x17', 'boards', file));
const SECONDS_PER_MINUTE = 60;
/** Add-on 17's farms off (its ruling S15's settings): no farm kind offered. */
const FARMS_OFF = { ...defaultFarmSettings(), kinds: [] };

/** A plan's new machine blocks and raw material a minute (main's: planned on main 01da27d). */
interface Figures { blocks: number; rawPerMinute: number }
/**
 * A known exception (the controller's ruling of 2026-10-24: F2's G, until fix wave 4's machine-aware pruning) with its
 * bounds as measured: its new blocks planned alone (`maxBlocks`) and on the settled board (`maxBoardBlocks`), or its raw
 * material a minute (`maxRawPerMinute`, its new blocks still within main's).
 */
interface Exception { maxBlocks?: number; maxBoardBlocks?: number; maxRawPerMinute?: number; why: string }
/**
 * docs/local/int12x17/live.json: the live projects' names in the order they were made, oldest first (deleted ones left
 * out); the duty and poly projects' names; main's figures of each project planned alone with "Use other projects'
 * surplus" off (`main`) and on main's settled board (`mainBoard`); and the known exceptions by project name.
 */
interface Live {
  order: string[]; duty: string; poly: string;
  main: Record<string, Figures>; mainBoard: Record<string, Figures>; exceptions: Record<string, Exception>;
}

type BuildStats = NonNullable<Solution['buildStats']>;
/** A plan made here and the build stats of the solves it ran (none where the plan cache held it). */
interface Planned { plan: Plan; stats: BuildStats[] }

const local = process.env.GTNH_LOCAL === '1';
const liveFile = local ? localDocPath(LIVE) : undefined;
if (local && liveFile === undefined) console.log(`real-board: skipped, no ${LIVE}`);

/** The data folder of each fresh app not yet released. */
const folders = new Map<AppContext, string>();

/**
 * A fresh app as the server makes one, on its own copy of the live projects: a temporary data folder holding a copy of
 * the config's planner.sqlite (the backup), links to the config's export and assets, and a scans folder of links to the
 * live projects' scans only, each finished (a world service marks every queued or running scan of its folder
 * interrupted, which through a link would write into the main checkout's data); a config naming no server folder; every
 * published summary deleted (an empty board); then the route modules registered, as the server does (the world
 * service's plan context hook among them).
 */
function freshApp(): AppContext {
  const config = loadConfig();
  const dir = mkdtempSync(join(tmpdir(), 'real-board-'));
  copyFileSync(join(config.dataDir, 'planner.sqlite'), join(dir, 'planner.sqlite'));
  for (const name of ['export', 'assets']) symlinkSync(realpathSync(join(config.dataDir, name)), join(dir, name));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify({ dataDir: dir, serverFolder: null, activeExportId: config.activeExportId, host: '127.0.0.1', port: 0 }));
  const app = createApp(loadConfig(file));
  folders.set(app, dir);
  for (const { key } of app.db.listMeta(SUMMARY_PREFIX)) app.db.deleteMeta(key);
  mkdirSync(join(dir, 'scans'));
  const scans = new Set(app.projects.list().flatMap((s) => app.projects.get(s.id)?.world.scanId ?? []));
  for (const id of scans) {
    const scan = realpathSync(join(config.dataDir, 'scans', id));
    const { state } = JSON.parse(readFileSync(join(scan, 'status.json'), 'utf8')) as { state?: unknown };
    if (state !== 'done' && state !== 'failed') throw new Error(`real-board: scan ${id} has not finished (${String(state)}): plan once it has`);
    symlinkSync(scan, join(dir, 'scans', id));
  }
  ROUTE_MODULES.flatMap((m) => m(app));
  return app;
}

/** Closes `app`'s database and removes its data folder (the links in it, never what they point to). */
function release(app: AppContext): void {
  const dir = folders.get(app);
  folders.delete(app);
  app.db.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
}

/** The live project named `name` (`ProjectStore.list` gives summaries; `planForProject` takes the project). */
function byName(app: AppContext, name: string): Project {
  const summary = app.projects.list().find((s) => s.name === name);
  if (summary === undefined) throw new Error(`real-board: no live project named ${name}`);
  return app.projects.get(summary.id)!;
}

/** Every live project, oldest first (by `createdAt`, then id: the board's own order). */
function ordered(app: AppContext): Project[] {
  const order = (a: Project, b: Project): number =>
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return app.projects.list().map((s) => app.projects.get(s.id)!).sort(order);
}

const rawPerMinute = (plan: Plan): number => (plan.rawCost?.perSecond ?? 0) * SECONDS_PER_MINUTE;
const handSteps = (plan: Plan): string[] => plan.steps.filter((s) => s.handCraft).map((s) => s.id);
const statsText = (st: BuildStats): string =>
  `${st.status}${st.stop === undefined ? '' : `/${st.stop}`}, ${st.nodes} nodes${st.approx ? ', approx' : ''}${st.bare === undefined ? '' : `, bare ${st.bare}`}, `
  + `objective ${st.objective ?? '-'}, bound ${st.bound ?? '-'}, ${st.seconds.toFixed(2)} s`;

/**
 * `project` planned through `planForProject` (`opts`: other settings, and whether it publishes), logged under `label`:
 * its status, steps, new blocks, raw material a minute, build, hand steps, the hash of what it read and its seconds, and
 * the end of each build MIP its solves ran — a `time` stop flagged, as the 30-s far guard decided that plan and so the
 * host's load did.
 */
async function planned(app: AppContext, project: Project, label: string, opts: { settings?: PlanSettings; publish?: boolean } = {}): Promise<Planned> {
  const solves = vi.mocked(solveLine);
  solves.mockClear();
  const started = performance.now();
  const plan = await planForProject(app, project, opts);
  const seconds = (performance.now() - started) / 1000;
  const solved = await Promise.all(solves.mock.results.flatMap((r) => (r.type === 'return' ? [r.value] : [])));
  solves.mockClear();
  const stats = solved.flatMap((sol) => (sol.buildStats === undefined ? [] : [sol.buildStats]));
  console.log(`real-board ${project.name}, ${label}: ${plan.status}, ${plan.steps.length} steps, ${newBlocks(plan)} new blocks, `
    + `${rawPerMinute(plan)} raw a minute, build ${plan.cost?.build ?? '-'}, ${handSteps(plan).length} hand steps, crossHash ${plan.crossHash ?? '-'}, `
    + `${seconds.toFixed(2)} s; build MIP ${stats.length === 0 ? 'none run (the plan cache held it)' : stats.map(statsText).join('; ')}`);
  if (stats.some((st) => st.stop === 'time')) {
    console.log(`real-board FLAG ${project.name}, ${label}: the 30-s far guard stopped its build MIP, so the host's load decided this plan`);
  }
  return { plan, stats };
}

/**
 * The build stats of `project`'s line in `settings` with its build MIP run on its own (`buildRun`,
 * tests/helpers/real-build-cases.ts: as `planLine` solves it, nothing read from the board) in the project's world
 * (`app.services.planContext`): whether that MIP stalled at its start.
 */
async function stalledStats(app: AppContext, project: Project, settings: PlanSettings): Promise<Solution['buildStats']> {
  return (await buildRun(await app.pack(), await app.services.planContext!(project), settings)).sol.buildStats;
}

/** `figures[name]`, which live.json must give every live project. */
function figuresOf(figures: Record<string, Figures>, name: string): Figures {
  const found = figures[name];
  if (found === undefined) throw new Error(`real-board: live.json gives no figures for ${name}`);
  return found;
}

/**
 * A2's and A3's rule for `plan` against main's `figures`: at most main's new machine blocks, or less raw material a minute
 * than main's plan (which breaks the raw cap). A known exception is logged against that rule and held to its measured
 * bounds instead: its new blocks to `maxBlocks` (alone, or the exception's board count on the board), or, with
 * `maxRawPerMinute` (only its raw material is the exception), its new blocks to main's and its raw material a minute to
 * that bound + 1 %.
 */
function expectWithinMain(label: string, plan: Plan, figures: Figures, exception: Exception | undefined, maxBlocks: number | undefined): void {
  const blocks = newBlocks(plan);
  const raw = rawPerMinute(plan);
  const text = `${label}: ${blocks} new blocks at ${raw} raw a minute against main's ${figures.blocks} at ${figures.rawPerMinute}`;
  if (exception === undefined) {
    expect(blocks <= figures.blocks || raw < figures.rawPerMinute, text).toBe(true);
    return;
  }
  console.log(`real-board ${text}: a known exception (${exception.why}), held to its measured bounds`);
  expect(maxBlocks !== undefined || exception.maxRawPerMinute !== undefined, `${label}: live.json gives its exception no bound here`).toBe(true);
  if (maxBlocks !== undefined) expect(blocks, text).toBeLessThanOrEqual(maxBlocks);
  if (exception.maxRawPerMinute !== undefined) {
    expect(blocks, text).toBeLessThanOrEqual(figures.blocks);
    expect(raw, text).toBeLessThanOrEqual(exception.maxRawPerMinute * 1.01);
  }
}

describe.skipIf(liveFile === undefined)('the live projects alone and on the surplus board (add-on 12 x 17 A2, A3)', () => {
  const live = (liveFile === undefined ? undefined : JSON.parse(readFileSync(liveFile, 'utf8'))) as Live;

  afterAll(() => {
    for (const app of [...folders.keys()]) release(app);
  });

  it("plans each live project alone within main's blocks unless it uses less raw, by hand nowhere (A2)", async () => {
    const { order, duty, poly, main, exceptions } = live;
    const app = freshApp();
    expect(ordered(app).map((p) => p.name)).toEqual(order);
    const alone: Array<{ name: string; plan: Plan; stats: Solution['buildStats'] }> = [];
    for (const name of order) {
      const project = byName(app, name);
      const settings: PlanSettings = { ...project.settings, useSurplus: false };
      const { plan } = await planned(app, project, 'alone', { settings, publish: false });
      const stats = await stalledStats(app, project, settings);
      console.log(`real-board ${name}, alone: its build MIP run on its own ${stats === undefined ? 'none' : statsText(stats)}`);
      alone.push({ name, plan, stats });
    }
    // The duty project with farms off (U1: farms on at most one new block above it).
    const dutyProject = byName(app, duty);
    const dutyOff = (await planned(app, dutyProject, 'alone, farms off', { settings: { ...dutyProject.settings, useSurplus: false, farms: FARMS_OFF }, publish: false })).plan;
    // The poly project: its farm rule (farms on at most one step above farms off) applies at a step charge above 0, so at
    // its stored charge it is logged only (OPEN-2); at 0.5 it is fix wave 4's acceptance case (7 against 4 on the combined
    // prototype; the log gives this tree's count), logged, not asserted.
    const polyProject = byName(app, poly);
    const polyAlone = { ...polyProject.settings, useSurplus: false };
    const polySteps = async (label: string, settings: PlanSettings): Promise<number> =>
      (await planned(app, polyProject, label, { settings, publish: false })).plan.steps.length;
    const polyOn = alone.find((a) => a.name === poly)?.plan.steps.length;
    const polyOff = await polySteps('alone, farms off', { ...polyAlone, farms: FARMS_OFF });
    const halfOn = await polySteps('alone at step charge 0.5', { ...polyAlone, stepCharge: 0.5 });
    const halfOff = await polySteps('alone at step charge 0.5, farms off', { ...polyAlone, stepCharge: 0.5, farms: FARMS_OFF });
    console.log(`real-board ${poly}: farms on ${polyOn} steps against ${polyOff} farms off at its stored step charge ${polyProject.settings.stepCharge} `
      + `(OPEN-2: logged only); at 0.5 ${halfOn} against ${halfOff} (fix wave 4's acceptance case, logged)`);
    release(app);

    for (const { name, plan, stats } of alone) {
      expect(plan.status, `${name}: ${JSON.stringify(plan.warnings)}`).toBe('ok');
      expect(handSteps(plan), `${name}: steps by hand`).toEqual([]);
      expect(plan.warnings.map((w) => w.code), name).not.toContain('free-loop');
      const exception = exceptions[name];
      expectWithinMain(`${name} alone`, plan, figuresOf(main, name), exception, exception?.maxBlocks);
      expect(stats, `${name}: its build MIP`).toBeDefined();
      const st = stats as BuildStats;
      expect(!(st.nodes === 0 && (st.objective ?? 0) > 1.5 * (st.bound ?? Infinity)), `${name}: stalled at its start, ${statsText(st)}`).toBe(true);
    }
    const dutyOn = alone.find((a) => a.name === duty)?.plan as Plan;
    expect(dutyOff.status).toBe('ok');
    expect(newBlocks(dutyOn), `${duty}: new blocks with farms on against farms off (U1)`).toBeLessThanOrEqual(newBlocks(dutyOff) + 1);
  }, 1_200_000);

  it('settles the board in two rounds, by hand nowhere (A3 (a))', async () => {
    const { order, duty, mainBoard, exceptions } = live;
    const app = freshApp();
    // Round 0 starts from the empty board; each plan reads what the projects planned before it published, and publishes.
    const rounds: Array<Map<string, Plan>> = [];
    for (let round = 0; round <= 3; round++) {
      const projects = ordered(app);
      expect(projects.map((p) => p.name)).toEqual(order);
      const plans = new Map<string, Plan>();
      for (const project of projects) {
        const made = await planned(app, project, `round ${round}`);
        plans.set(project.name, made.plan);
        if (project.name === duty) {
          console.log(`real-board ${duty}, round ${round}: build MIP stop ${made.stats.map((st) => st.stop ?? 'none').join(', ') || '- (the plan cache held it)'}`
            + `${made.stats.some((st) => st.stop === 'time') ? ' (the 30-s far guard: load-dependent)' : ''}`);
        }
      }
      rounds.push(plans);
    }
    release(app);

    for (const [round, plans] of rounds.entries()) {
      for (const [name, plan] of plans) {
        expect(plan.status, `${name}, round ${round}: ${JSON.stringify(plan.warnings)}`).toBe('ok');
        expect(handSteps(plan), `${name}, round ${round}: steps by hand`).toEqual([]);
      }
    }
    for (const name of order) {
      const hashes = rounds.slice(1).map((plans) => plans.get(name)?.crossHash);
      expect(hashes, `${name}: what it read in rounds 1, 2 and 3`).toEqual([hashes[0], hashes[0], hashes[0]]);
    }
    const settled = rounds[3] as Map<string, Plan>;
    for (const name of order) {
      const exception = exceptions[name];
      expectWithinMain(`${name} on the settled board`, settled.get(name) as Plan, figuresOf(mainBoard, name), exception, exception?.maxBoardBlocks);
    }
  }, 3_600_000);

  it('plans Duty plate on a board and on the board x0.999 alike (A3 (b))', async () => {
    const { order, duty } = live;
    const plans: Plan[] = [];
    for (const board of BOARDS) {
      const file = localDocPath(board);
      if (file === undefined) throw new Error(`real-board: no ${board}`);
      const app = freshApp();
      // The board's summaries, before the app's first plan builds its board from the database (`surplusBoardFor`).
      for (const s of JSON.parse(readFileSync(file, 'utf8')) as PublishedSummary[]) app.db.setMeta(`${SUMMARY_PREFIX}${s.projectId}`, JSON.stringify(s));
      expect(ordered(app).map((p) => p.name)).toEqual(order);
      plans.push((await planned(app, byName(app, duty), `on ${basename(board)}`, { publish: false })).plan);
      release(app);
    }
    const [a, b] = plans as [Plan, Plan];
    for (const plan of plans) {
      expect(plan.status, JSON.stringify(plan.warnings)).toBe('ok');
      expect(plan.crossHash, 'what it read of the board').toBeDefined();
      expect(handSteps(plan), 'steps by hand').toEqual([]);
    }
    expect(a.crossHash, 'the board x 0.999 offers other amounts').not.toBe(b.crossHash);
    expect(Math.abs(newBlocks(a) - newBlocks(b)), `new blocks ${newBlocks(a)} against ${newBlocks(b)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(rawPerMinute(a) - rawPerMinute(b)), `raw a minute ${rawPerMinute(a)} against ${rawPerMinute(b)}`).toBeLessThanOrEqual(0.05 * rawPerMinute(a));
  }, 1_200_000);
});
