// `npm run pack:info [-- --export <dir>] [--find "<text>"] [--limit <n>]`: what the active (or given) export holds,
// or the recipes that make the best match of a search. Exit 0 on success; 1 when there is no active export, the
// export or settings file is damaged, or nothing matches; 2 on bad arguments.

import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { recipeTier, tierName } from '../../shared/gt/tiers.ts';
import type { Ingredient, Pack, Product, Recipe, RecipeSource, SearchHit } from '../../shared/types/pack.ts';
import { activeExportDir, ConfigError, loadConfig, NoActiveExportError } from '../config.ts';
import { tableItemCount } from '../pack/crops.ts';
import { ExportFormatError, loadPack } from '../pack/load.ts';
import { searchPack } from '../pack/search.ts';

const USAGE = 'Usage: npm run pack:info [-- --export <dir>] [--find "<text>"] [--limit <n>]';
const SOURCES: readonly RecipeSource[] = ['gt', 'assemblyline', 'crafting', 'furnace', 'derived'];
const SHOWN_WARNINGS = 20;
const SHOWN_MACHINES = 3;
const OTHER_HITS = 5;
const DEFAULT_LIMIT = 20;

class UsageError extends Error {}

interface Options { help: boolean; exportDir?: string; find?: string; limit: number }

function parseOptions(argv: string[]): Options {
  let values: { help?: boolean; export?: string; find?: string; limit?: string };
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { help: { type: 'boolean', short: 'h' }, export: { type: 'string' }, find: { type: 'string' }, limit: { type: 'string' } },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  if (values.export !== undefined && values.export.trim() === '') throw new UsageError('--export needs a folder');
  if (values.find !== undefined && values.find.trim() === '') throw new UsageError('--find needs some text');
  if (values.limit !== undefined && !/^[1-9]\d*$/.test(values.limit)) {
    throw new UsageError(`--limit must be a whole number above 0, got "${values.limit}"`);
  }
  return {
    help: values.help === true, exportDir: values.export, find: values.find,
    limit: values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit),
  };
}

function summary(exportId: string, pack: Pack): string[] {
  const m = pack.manifest;
  const bySource = (source: RecipeSource) => pack.recipes.filter((r) => r.source === source).length;
  const machines = [...pack.machines.values()];
  const { dimensions, veins, capabilities } = pack.worldgen;
  const warnings = [...(pack.warnings ?? []), ...(m.warnings ?? [])];   // the loader's, then the exporter's
  const lines = [
    `Export:     ${exportId}`,
    `Pack:       ${m.packVersion} · GregTech ${m.gtVersion} · exporter ${m.exporterVersion} · exported ${m.exportedAt}`,
    `Items:      ${tableItemCount(pack.items)} · Fluids: ${pack.fluids.size} · Ore names: ${pack.oreDict.size}`,
    `Recipes:    ${pack.recipes.length} (${SOURCES.map((s) => `${s} ${bySource(s)}`).join(', ')}) in ${pack.maps.size} maps`,
    `Machines:   ${machines.length} (${machines.filter((x) => x.kind === 'multiblock').length} multiblocks, ${machines.filter((x) => x.structure !== undefined).length} with structure)`,
    `Materials:  ${pack.materials.size} · Dimensions: ${dimensions.length} · Veins: ${veins.filter((v) => v.kind === 'vein').length} (+${veins.filter((v) => v.kind === 'small').length} small ores) · Capabilities: ${capabilities.length}`,
    `Name failures: ${m.nameFailures ?? 'unknown'}`,
    `Warnings:   ${warnings.length}`,
    ...warnings.slice(0, SHOWN_WARNINGS).map((w) => `  - ${w}`),
  ];
  if (warnings.length > SHOWN_WARNINGS) lines.push(`  … and ${warnings.length - SHOWN_WARNINGS} more`);
  return lines;
}

/** A chance as a percentage with at most two decimals: 0.1 → "10", 0.0125 → "1.25". */
function percent(chance: number): string {
  return String(Number((chance * 100).toFixed(2)));
}

function ingredientText(pack: Pack, input: Ingredient): string {
  const [first] = input.options;
  if (first === undefined) return '(empty slot)';
  const chance = input.consumed && input.chance < 1 ? `${percent(input.chance)}% ` : '';
  const alt = input.options.length > 1 ? ` +${input.options.length - 1} alt` : '';
  return `${chance}${first.amount}× ${pack.nameOf(first.key)}${alt}${input.consumed ? '' : ' (not consumed)'}`;
}

function productText(pack: Pack, output: Product): string {
  return `${output.chance < 1 ? `${percent(output.chance)}% ` : ''}${output.amount}× ${pack.nameOf(output.key)}`;
}

/** The names of the machines that run any of the recipe's maps, lowest tier first. */
function machineText(pack: Pack, recipe: Recipe): string {
  const ids = new Set(recipe.maps.flatMap((map) => pack.machinesByMap.get(map) ?? []));
  const names = [...ids].map((id) => pack.machines.get(id)?.name ?? `machine ${id}`);
  if (names.length === 0) return '(no machine)';
  const more = names.length > SHOWN_MACHINES ? ` +${names.length - SHOWN_MACHINES} more` : '';
  return `${names.slice(0, SHOWN_MACHINES).join(', ')}${more}`;
}

function recipeLine(pack: Pack, r: Recipe): string {
  const maps = r.maps.map((id) => pack.maps.get(id)?.name ?? id).join(' / ') || '(no map)';
  const tier = r.euPerTick === 0 ? '—' : tierName(recipeTier(r.euPerTick, r.amps));
  const side = (texts: string[]) => (texts.length === 0 ? '(nothing)' : texts.join(', '));
  const inputs = side(r.inputs.map((i) => ingredientText(pack, i)));
  const outputs = side(r.outputs.map((o) => productText(pack, o)));
  const flags = [r.flags.fake && ' [fake]', r.flags.hidden && ' [hidden]', r.flags.recycling && ' [recycling]'].filter(Boolean).join('');
  return `  - ${maps} · ${machineText(pack, r)} · ${r.euPerTick} EU/t · ${r.durationTicks} t (${(r.durationTicks / 20).toFixed(1)} s) · ${tier}  |  ${inputs} → ${outputs}${flags}`;
}

/** Real recipes before fake and recycling ones, then by EU/t, then by duration. */
function compareRecipes(a: Recipe, b: Recipe): number {
  const odd = (r: Recipe) => (r.flags.fake || r.flags.recycling ? 1 : 0);
  return odd(a) - odd(b) || a.euPerTick - b.euPerTick || a.durationTicks - b.durationTicks;
}

function producing(pack: Pack, hit: SearchHit, others: readonly SearchHit[], limit: number): string[] {
  const recipes = (pack.producers.get(hit.key) ?? []).map((i) => pack.recipes[i]!).sort(compareRecipes);
  const lines = [`${hit.name}  ${hit.key}`, `${recipes.length} producing recipes:`, ...recipes.slice(0, limit).map((r) => recipeLine(pack, r))];
  if (recipes.length > limit) lines.push(`  … and ${recipes.length - limit} more`);
  if (others.length > 0) lines.push(`Also matching: ${others.map((h) => `${h.name} (${h.key})`).join(', ')}`);
  return lines;
}

export async function main(argv: string[]): Promise<number> {
  const out = (lines: string[]) => process.stdout.write(`${lines.join('\n')}\n`);
  const fail = (message: string, code: number) => {
    process.stderr.write(`${message}\n`);
    return code;
  };
  let opts: Options;
  try {
    opts = parseOptions(argv);
  } catch (err) {
    if (err instanceof UsageError) return fail(`${err.message}\n${USAGE}`, 2);
    throw err;
  }
  if (opts.help) {
    out([USAGE]);
    return 0;
  }
  let dir: string;
  try {
    dir = opts.exportDir === undefined ? activeExportDir(loadConfig()) : resolve(opts.exportDir);
  } catch (err) {
    if (err instanceof NoActiveExportError || err instanceof ConfigError) return fail(err.message, 1);
    throw err;
  }
  let pack: Pack;
  try {
    pack = await loadPack(dir);
  } catch (err) {
    if (err instanceof ExportFormatError) return fail(`Cannot load the export in ${dir}: ${err.message}`, 1);
    throw err;
  }
  if (opts.find === undefined) {
    out(summary(basename(dir), pack));   // the folder name, which is the export id (ruling R13)
    return 0;
  }
  const [hit, ...others] = searchPack(pack, opts.find, 1 + OTHER_HITS);
  if (hit === undefined) return fail(`No item or fluid matches "${opts.find}"`, 1);
  out(producing(pack, hit, others, opts.limit));
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
