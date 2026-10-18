// `npm run import-nei-icons -- --csv <itempanel.csv> --png <itempanel_icons>`: joins a one-time NEI item-panel dump,
// taken by hand in a copy of the client instance, to item and fluid keys and installs its icons under
// `<dataDir>/assets/nei/` (Task 11). Fluid rows are matched by name against the active export's fluids (Ruling R17);
// without an export that loads they are skipped. Exit 0 imported; 1 the dump was refused or could not be copied (the
// previous import stays in place); 2 bad arguments or settings. Every path is resolved from the working directory,
// which is the repo root under npm.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { FluidKey } from '../../shared/keys.ts';
import { importNeiIcons, NeiImportError, type NeiImportResult } from '../assets/nei.ts';
import { activeExportDir, ConfigError, loadConfig, type AppConfig } from '../config.ts';
import { loadPack } from '../pack/load.ts';

const USAGE = 'Usage: npm run import-nei-icons -- --csv <itempanel.csv> --png <itempanel_icons folder>';
const HOW_TO_DUMP = 'Take the dump in a copy of the client instance: NEI options → Tools → Data Dumps → Item Panel, with an '
  + 'empty search box and every collapsible group expanded; dump CSV, then PNG, in the same session. The files are '
  + 'in <instance>/.minecraft/dumps/. Fluid icons are matched by name against the active export, so run '
  + '`npm run export` first.';

const FAILED = 1;
const USAGE_ERROR = 2;

class UsageError extends Error {}

type NeiFluids = Iterable<{ key: FluidKey; name: string }>;

interface Options { help: boolean; csv?: string; png?: string }

function parseOptions(argv: string[]): Options {
  let values: { help?: boolean; csv?: string; png?: string };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { help: { type: 'boolean', short: 'h' }, csv: { type: 'string' }, png: { type: 'string' } },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  for (const flag of ['csv', 'png'] as const) {
    if (values[flag] !== undefined && values[flag].trim() === '') throw new UsageError(`--${flag} needs a value`);
  }
  return { help: values.help === true, csv: values.csv, png: values.png };
}

/** The active export's fluids; null (after one `err` line) when no export loads. */
async function activeFluids(config: AppConfig, err: (line: string) => void): Promise<NeiFluids | null> {
  try {
    return (await loadPack(activeExportDir(config))).fluids.values();
  } catch (e) {
    err(`NEI fluid rows are skipped: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function summaryLine(r: NeiImportResult): string {
  return `Imported ${r.imported} NEI icons (${r.fluids} fluids) from ${r.rows} rows; skipped ${r.skippedNbt} rows with NBT; `
    + `file names matched ${r.caseInsensitive ? 'case-insensitively' : 'case-sensitively'}`;
}

export async function main(
  argv: string[],
  deps: { config?: AppConfig; fluids?: NeiFluids; out?: (line: string) => void; err?: (line: string) => void } = {},
): Promise<number> {
  const out = deps.out ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const err = deps.err ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const usageError = (message: string) => {
    err(message);
    err(USAGE);
    return USAGE_ERROR;
  };

  let opts: Options;
  try {
    opts = parseOptions(argv);
  } catch (e) {
    if (e instanceof UsageError) return usageError(e.message);
    throw e;
  }
  if (opts.help) {
    out(USAGE);
    out(HOW_TO_DUMP);
    return 0;
  }
  const { csv, png } = opts;
  if (csv === undefined || png === undefined) {
    const missing = [...(csv === undefined ? ['--csv <file>'] : []), ...(png === undefined ? ['--png <folder>'] : [])];
    return usageError(`Missing ${missing.join(' and ')}`);
  }

  let config: AppConfig;
  try {
    config = deps.config ?? loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return USAGE_ERROR;
    }
    throw e;
  }
  const fluids = deps.fluids ?? await activeFluids(config, err);
  let result: NeiImportResult;
  try {
    result = await importNeiIcons({ csv: resolve(csv), fluids, pngDir: resolve(png), dataDir: config.dataDir });
  } catch (e) {
    if (e instanceof NeiImportError) {
      err(e.message);
      return FAILED;
    }
    throw e;
  }
  out(summaryLine(result));
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
