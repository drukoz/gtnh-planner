// `npm run perf` (RUK-563): plans and lays out every project of a copy of the group's data on a server of its own, times
// each request and how long the server takes to answer in the meantime, and checks every plan and layout byte for byte
// against a reference run. Usage:
//   npm run perf -- --source <copy of the data> --out <new folder> [--reference <folder>] [--restart] [--profile] [--threads N]
// Exit 0 when every request answered 200 and, with `--reference`, nothing differs or is missing; 1 when something did not
// match; 2 on bad arguments. The server runs on a free port (config `port` 0), so runs never collide with 8765 or 18787,
// and only the child this tool started is ever signalled. See `tools/perf/README.md`.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { loadavg } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { comparisonIsClean, comparisonLines, compareRuns, type Comparison } from './compare.ts';

const USAGE = 'Usage: npm run perf -- --source <copy of the data> --out <new folder> [--reference <folder>] [--restart] [--profile] [--threads N]';
/** The repository root: this file sits in `tools/perf/`. */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REQUIRED_SOURCE_PATHS = ['planner.sqlite.orig', 'config.json', 'data/export', 'data/scans'] as const;
const START_LINE = /GTNH Line Planner on (http:\/\/\S+)/;
const START_TIMEOUT_MS = 60_000;
const KILL_TIMEOUT_MS = 10_000;
const PROBE_MS = 50;
const MAX_THREADS = 64;

interface Options {
  source: string;
  out: string;
  reference: string | null;
  threads: number;
  restart: boolean;
  profile: boolean;
}

interface Project { id: string; name: string; createdAt: string }

interface ProjectRow {
  id: string;
  name: string;
  planSeconds: number;
  layoutSeconds?: number;
  healthMaxSeconds: number;
  /** The HTTP status of each request of this project, plan first and layout second. */
  status: number[];
}

interface PassSummary {
  totalSeconds: number;
  projects: ProjectRow[];
  /** The `/api/health` probe's answer times during the pass, in seconds. */
  health: { p50: number; p95: number; max: number };
}

interface Summary {
  commit: string;
  dirty: boolean;
  threads: number;
  loadavg: { start: number[]; end: number[] };
  passes: Record<string, PassSummary>;
  compare?: Comparison;
}

interface Response { status: number; body: Buffer; seconds: number }

let options: Options;
let outDir = '';
let runDir = '';
let dataDir = '';
let logPath = '';
let child: ChildProcess | undefined;
let exited: Promise<void> = Promise.resolve();
let log = '';
let baseUrl = '';
let probeTimer: NodeJS.Timeout | undefined;
let probeInFlight = false;
/** Settles when the probe last sent has answered or failed. */
let probeSettled: Promise<void> = Promise.resolve();
let probeTimes: number[] = [];
let probeMax = 0;

function refuse(reason: string): never {
  console.error(`${reason}\n${USAGE}`);
  process.exit(2);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Seconds to three decimals, as the summary and the table print them. */
function round3(seconds: number): number {
  return +seconds.toFixed(3);
}

function parseOptions(): Options {
  let values: { source?: string; out?: string; reference?: string; threads?: string; restart?: boolean; profile?: boolean };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2), strict: true, allowPositionals: false,
      options: {
        source: { type: 'string' }, out: { type: 'string' }, reference: { type: 'string' }, threads: { type: 'string' },
        restart: { type: 'boolean' }, profile: { type: 'boolean' },
      },
    }));
  } catch (err) {
    refuse(messageOf(err));
  }
  if (values.source === undefined || values.source === '') refuse('--source is required');
  if (values.out === undefined || values.out === '') refuse('--out is required');
  const threads = values.threads === undefined ? 4 : Number(values.threads);
  if (!Number.isInteger(threads) || threads < 1 || threads > MAX_THREADS) {
    refuse(`--threads must be a whole number from 1 to ${MAX_THREADS}, got "${values.threads ?? ''}"`);
  }
  const path = (p: string): string => (isAbsolute(p) ? p : resolve(p));
  return {
    source: path(values.source), out: path(values.out),
    reference: values.reference === undefined ? null : path(values.reference),
    threads, restart: values.restart === true, profile: values.profile === true,
  };
}

/** Checks the source folder, and that `--out` is new or empty: the tool never deletes what it did not create. */
function checkFolders(): void {
  for (const needed of REQUIRED_SOURCE_PATHS) {
    if (!existsSync(join(options.source, needed))) {
      refuse(`${options.source} is not a copy of the group's data: it has no ${needed} (never point --source at a checkout's data/)`);
    }
  }
  if (existsSync(outDir)) {
    if (!statSync(outDir).isDirectory()) refuse(`${outDir} exists and is not a folder`);
    const entries = readdirSync(outDir);
    if (entries.length > 0) refuse(`${outDir} exists and is not empty (${entries.length} item(s)); pick a new --out`);
  }
  if (options.reference !== null && !existsSync(options.reference)) refuse(`${options.reference} is not a folder`);
}

function setupRunFolder(): void {
  mkdirSync(dataDir, { recursive: true });
  // The export and the scans as APFS clones (about 0.1 s); `data/assets/` is 80,000 textures no plan or layout reads.
  for (const d of ['export', 'scans']) {
    cpSync(join(options.source, 'data', d), join(dataDir, d), { recursive: true, mode: constants.COPYFILE_FICLONE });
  }
  copyFileSync(join(options.source, 'planner.sqlite.orig'), join(dataDir, 'planner.sqlite'), constants.COPYFILE_FICLONE);
  const sourceConfig: { activeExportId?: unknown } = JSON.parse(readFileSync(join(options.source, 'config.json'), 'utf8'));
  const id = sourceConfig.activeExportId;
  if (typeof id !== 'string' && id !== null && id !== undefined) refuse(`${options.source}/config.json: activeExportId must be a string or null`);
  writeFileSync(join(runDir, 'config.json'), JSON.stringify({
    dataDir, serverFolder: null, activeExportId: typeof id === 'string' ? id : null,
    port: 0, host: '127.0.0.1', passwordHash: '', sessionSecret: '', requirePassword: false, clientJar: null,
  }, null, 2));
}

function appendLog(chunk: Buffer): void {
  const text = chunk.toString();
  log += text;
  appendFileSync(logPath, text);
}

/** Starts a server for `pass` on the run folder and waits up to 60 s for the line that names its port. */
async function startServer(pass: string): Promise<void> {
  const args = ['--disable-warning=ExperimentalWarning'];
  if (options.profile) {
    const profDir = join(outDir, 'prof', pass);
    mkdirSync(profDir, { recursive: true });
    args.push('--cpu-prof', `--cpu-prof-dir=${profDir}`);
  }
  args.push('src/server/main.ts');
  const spawned = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, GTNH_PLANNER_CONFIG: join(runDir, 'config.json'), GTNH_LP_THREADS: String(options.threads) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = spawned;
  exited = new Promise<void>((r) => { spawned.on('exit', () => r()); });
  spawned.stdout?.on('data', (chunk: Buffer) => appendLog(chunk));
  spawned.stderr?.on('data', (chunk: Buffer) => appendLog(chunk));
  const from = log.length;
  const deadline = Date.now() + START_TIMEOUT_MS;
  const line = await new Promise<string | null>((resolveLine) => {
    const timer = setInterval(() => {
      const match = START_LINE.exec(log.slice(from));
      if (match?.[1] !== undefined) { clearInterval(timer); resolveLine(match[1]); return; }
      if (spawned.exitCode !== null) { clearInterval(timer); resolveLine(null); }
      else if (Date.now() > deadline) { clearInterval(timer); resolveLine(null); }
    }, 20);
  });
  if (line === null) {
    await stopServer();
    throw new Error(`the server did not print "${START_LINE.source}" within ${START_TIMEOUT_MS / 1000} s; its log:\n${log.slice(from)}`);
  }
  baseUrl = line;
}

/** SIGTERMs the child this tool started (never another process), and SIGKILLs it after 10 s. */
async function stopServer(): Promise<void> {
  const running = child;
  if (running === undefined) return;
  child = undefined;
  if (running.exitCode === null && running.signalCode === null) {
    running.kill('SIGTERM');
    const killer = setTimeout(() => running.kill('SIGKILL'), KILL_TIMEOUT_MS);
    killer.unref();
    await exited;
    clearTimeout(killer);
  }
  await exited;
}

function get(path: string): Promise<Response> {
  return new Promise((resolveGet, rejectGet) => {
    const startedAt = performance.now();
    // `agent: false`: a new connection per request. The default agent keeps connections open and the server closes idle
    // ones, which kills the first pass with ECONNRESET. No Accept-Encoding, so the answer is the plain JSON the reference holds.
    const req = request(baseUrl + path, { agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolveGet({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), seconds: (performance.now() - startedAt) / 1000 }));
      // An answer cut off mid-body (the server died) emits 'error' only when someone listens; without this it never settles.
      res.on('error', rejectGet);
    });
    req.on('error', rejectGet);
    req.end();
  });
}

/** Probes `/api/health` every 50 ms while no probe is in flight. A probe that fails (the server restarting) is not counted. */
function startProbe(): void {
  probeTimer = setInterval(() => {
    if (probeInFlight) return;
    probeInFlight = true;
    probeSettled = get('/api/health').then((r) => {
      probeTimes.push(r.seconds);
      probeMax = Math.max(probeMax, r.seconds);
    }, () => {}).finally(() => { probeInFlight = false; });
  }, PROBE_MS);
}

function stopProbe(): void {
  if (probeTimer !== undefined) clearInterval(probeTimer);
  probeTimer = undefined;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function healthStats(times: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...times].sort((a, b) => a - b);
  return { p50: round3(percentile(sorted, 0.5)), p95: round3(percentile(sorted, 0.95)), max: round3(sorted[sorted.length - 1] ?? 0) };
}

/** Every project, oldest first: plans read the surplus other projects published, so the order of visits changes the bytes. */
async function listProjects(): Promise<Project[]> {
  const listed: { id: string; name: string }[] = JSON.parse((await get('/api/projects')).body.toString());
  const projects: Project[] = [];
  for (const e of listed) {
    const full: { createdAt?: unknown } = JSON.parse((await get(`/api/projects/${e.id}`)).body.toString());
    projects.push({ id: e.id, name: e.name, createdAt: typeof full.createdAt === 'string' ? full.createdAt : '' });
  }
  return projects.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Plans (and with `withLayout` lays out) every project of the pass, writing each answer's body as received. */
async function runPass(name: string, withLayout: boolean, projects: Project[]): Promise<PassSummary> {
  const passDir = join(outDir, name);
  mkdirSync(passDir, { recursive: true });
  probeTimes = [];
  probeMax = 0;
  const rows: ProjectRow[] = [];
  const startedAt = performance.now();
  for (const p of projects) {
    probeMax = 0;
    const plan = await get(`/api/projects/${p.id}/plan`);
    writeFileSync(join(passDir, `plan-${p.id}.json`), plan.body);
    const row: ProjectRow = { id: p.id, name: p.name, planSeconds: round3(plan.seconds), healthMaxSeconds: 0, status: [plan.status] };
    if (withLayout) {
      const layout = await get(`/api/projects/${p.id}/layout`);
      writeFileSync(join(passDir, `layout-${p.id}.json`), layout.body);
      row.layoutSeconds = round3(layout.seconds);
      row.status.push(layout.status);
    }
    // The probe that waited behind this project's last stall answers just after it: count it here, not in the next project.
    await probeSettled;
    row.healthMaxSeconds = round3(probeMax);
    rows.push(row);
  }
  return { totalSeconds: round3((performance.now() - startedAt) / 1000), projects: rows, health: healthStats(probeTimes) };
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function loadAvg(): number[] {
  return loadavg().map((v) => +v.toFixed(2));
}

function tableRow(pass: string, row: ProjectRow): string {
  const layout = row.layoutSeconds === undefined ? ''.padStart(9) : row.layoutSeconds.toFixed(3).padStart(9);
  return `${pass.padEnd(8)}${row.name.slice(0, 30).padEnd(31)}${row.planSeconds.toFixed(3).padStart(8)}${layout}${row.healthMaxSeconds.toFixed(3).padStart(11)}`;
}

function printTable(summary: Summary, compare: string[]): void {
  console.log('pass    project                          plan s layout s  health s');
  for (const [pass, p] of Object.entries(summary.passes)) {
    for (const row of p.projects) console.log(tableRow(pass, row));
    console.log(`${pass} total ${p.totalSeconds.toFixed(3)} s, health p50 ${p.health.p50.toFixed(3)} p95 ${p.health.p95.toFixed(3)} max ${p.health.max.toFixed(3)} s`);
  }
  console.log(`loadavg start ${summary.loadavg.start.join(' ')}  end ${summary.loadavg.end.join(' ')}`);
  for (const line of compare) console.log(line);
}

async function main(): Promise<number> {
  options = parseOptions();
  outDir = options.out;
  runDir = join(outDir, 'run');
  dataDir = join(runDir, 'data');
  logPath = join(outDir, 'server.log');
  checkFolders();
  setupRunFolder();
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']) !== '';
  const start = loadAvg();
  const passes: Record<string, PassSummary> = {};
  startProbe();
  try {
    await startServer('cold');
    const projects = await listProjects();
    passes.cold = await runPass('cold', true, projects);
    passes.warm1 = await runPass('warm1', false, projects);
    passes.warm2 = await runPass('warm2', false, projects);
    if (options.restart) {
      await stopServer();
      await startServer('restart');
      passes.restart = await runPass('restart', true, projects);
    }
  } finally {
    stopProbe();
    await stopServer();
    rmSync(dataDir, { recursive: true, force: true });   // the ~90 MB of copies, which this tool made
  }
  const summary: Summary = { commit, dirty, threads: options.threads, loadavg: { start, end: loadAvg() }, passes };
  if (options.reference !== null) summary.compare = compareRuns(options.reference, outDir);
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  const compare = summary.compare === undefined ? [] : comparisonLines(summary.compare);
  printTable(summary, compare);
  const allServed = Object.values(passes).every((p) => p.projects.every((r) => r.status.every((s) => s === 200)));
  return allServed && (summary.compare === undefined || comparisonIsClean(summary.compare)) ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(messageOf(err));
  process.exitCode = 1;
}
