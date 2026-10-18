// `npm run scan -- [--backup <file> | --upload <uploadId>] [--json]` (Plan 4 Task 13): one world scan from the shell,
// through the same world service as the app, with progress lines on stderr and a summary (or the scan as JSON) on
// stdout. Importing this module does nothing: the direct-run entry that loads the config and the pack is added with
// Plan 1's config.ts (ledger ruling R5); until then `runScanCli` is the entry, with the config and facts injected.

import { parseArgs } from 'node:util';
import type { PowerNetwork, WorldScan, WorldSource } from '../../shared/types/world.ts';
import type { ScanPackFacts } from '../world/facts.ts';
import { createWorldService } from '../world/scan.ts';
import { scanSummary } from '../world/scan.worker.ts';
import { SourceError, type WorldConfig } from '../world/sources.ts';

export const SCAN_USAGE = 'Usage: npm run scan -- [--backup <file> | --upload <uploadId>] [--json]';

/** How often the progress line is refreshed. */
const PROGRESS_POLL_MS = 100;

/** `stdout` and `stderr` get whole lines, each ending in '\n'. */
export interface ScanCliIo {
  config: WorldConfig;
  facts: () => Promise<ScanPackFacts>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface ScanArgs { source: WorldSource; json: boolean }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseScanArgs(argv: string[]): ScanArgs | string {
  let values: { backup?: string; upload?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { backup: { type: 'string' }, upload: { type: 'string' }, json: { type: 'boolean' } },
    }));
  } catch (err) {
    return errorMessage(err);
  }
  if (values.backup !== undefined && values.upload !== undefined) return 'Use --backup or --upload, not both';
  const source: WorldSource = values.backup !== undefined ? { kind: 'backup', file: values.backup }
    : values.upload !== undefined ? { kind: 'upload', uploadId: values.upload } : { kind: 'server' };
  return { source, json: values.json === true };
}

/** `"[ 42%]"`: the progress rounded down, so 100% shows only once the scan is done. */
function percent(progress: number): string {
  return `[${String(Math.floor(Math.min(1, Math.max(0, progress)) * 100)).padStart(3)}%]`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const euText = (v: number): string => String(Math.round(v * 100) / 100);

function powerLine(n: PowerNetwork, baseName: string | undefined): string {
  const { clear, rain, average } = n.generatorEUt;
  return `Power ${n.id}${baseName === undefined ? '' : ` (${baseName})`}: ${euText(clear)}/${euText(rain)}/${euText(average)} EU/t clear/rain/average, `
    + `${Math.round(n.storedEU)} EU stored`;
}

/** The scan summary, one line per base and one per power network. */
function summaryLines(scan: WorldScan): string[] {
  const baseNames = new Map(scan.bases.map((b) => [b.id, b.name] as const));
  return [
    scanSummary(scan),
    ...scan.bases.map((b) => `${b.name}: ${plural(b.machineCount, 'machine')}, top tier ${b.topTier}`),
    ...scan.power.map((n) => powerLine(n, n.baseId === null ? undefined : baseNames.get(n.baseId))),
  ];
}

/** Runs one scan; 0 when it is done, 1 for bad arguments, a source that cannot be used or a failed scan. */
export async function runScanCli(argv: string[], io: ScanCliIo): Promise<number> {
  const args = parseScanArgs(argv);
  if (typeof args === 'string') {
    io.stderr(`${args}\n${SCAN_USAGE}\n`);
    return 1;
  }
  const world = createWorldService({ config: io.config, facts: io.facts });
  let id: string;
  try {
    id = await world.startScan(args.source);
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    io.stderr(`${err.message}\n`);
    return 1;
  }

  let shown = '';
  const showProgress = (): void => {
    const status = world.scanStatus(id);
    if (status.state !== 'running') return;
    const line = `${percent(status.progress)} ${status.message}`;
    if (line === shown) return;
    shown = line;
    io.stderr(`${line}\n`);
  };
  const timer = setInterval(showProgress, PROGRESS_POLL_MS);
  try {
    await world.idle();
  } finally {
    clearInterval(timer);
  }

  const status = world.scanStatus(id);
  const scan = status.state === 'done' ? await world.getScan(id) : null;
  if (scan === null) {
    io.stderr(`Scan failed: ${status.message}\n`);
    return 1;
  }
  if (args.json) {
    io.stdout(`${JSON.stringify(scan)}\n`);
  } else {
    for (const warning of scan.warnings ?? []) io.stderr(`Warning: ${warning}\n`);
    io.stdout(`${summaryLines(scan).join('\n')}\n`);
  }
  return 0;
}
