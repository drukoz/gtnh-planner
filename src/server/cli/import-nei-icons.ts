// `npm run import-nei-icons -- --csv <itempanel.csv> --png <itempanel_icons> [--json <itempanel.json>]`: joins a
// one-time NEI item-panel dump, taken by hand in a copy of the client instance, to item and fluid keys and installs
// its icons under `<dataDir>/assets/nei/` (Task 11). Exit 0 imported; 1 the dump was refused or could not be copied
// (the previous import stays in place); 2 bad arguments or settings. Every path is resolved from the working
// directory, which is the repo root under npm.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { importNeiIcons, NeiImportError, type NeiImportResult } from '../assets/nei.ts';
import { ConfigError, loadConfig, type AppConfig } from '../config.ts';

const USAGE = 'Usage: npm run import-nei-icons -- --csv <itempanel.csv> --png <itempanel_icons folder> [--json <itempanel.json>]';
const HOW_TO_DUMP = 'Take the dump in a copy of the client instance: NEI options → Tools → Data Dumps → Item Panel, with an '
  + 'empty search box and every collapsible group expanded; dump CSV, Json and PNG in the same session. The files are '
  + 'in <instance>/.minecraft/dumps/.';

const FAILED = 1;
const USAGE_ERROR = 2;

class UsageError extends Error {}

interface Options { help: boolean; csv?: string; png?: string; json?: string }

function parseOptions(argv: string[]): Options {
  let values: { help?: boolean; csv?: string; png?: string; json?: string };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { help: { type: 'boolean', short: 'h' }, csv: { type: 'string' }, png: { type: 'string' }, json: { type: 'string' } },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  for (const flag of ['csv', 'png', 'json'] as const) {
    if (values[flag] !== undefined && values[flag].trim() === '') throw new UsageError(`--${flag} needs a value`);
  }
  return { help: values.help === true, csv: values.csv, png: values.png, json: values.json };
}

function summaryLine(r: NeiImportResult): string {
  return `Imported ${r.imported} NEI icons (${r.fluids} fluids) from ${r.rows} rows; skipped ${r.skippedNbt} rows with NBT; `
    + `file names matched ${r.caseInsensitive ? 'case-insensitively' : 'case-sensitively'}`;
}

export async function main(
  argv: string[],
  deps: { config?: AppConfig; out?: (line: string) => void; err?: (line: string) => void } = {},
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
  const { csv, png, json } = opts;
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
  let result: NeiImportResult;
  try {
    result = await importNeiIcons({ csv: resolve(csv), json: json === undefined ? null : resolve(json), pngDir: resolve(png), dataDir: config.dataDir });
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
