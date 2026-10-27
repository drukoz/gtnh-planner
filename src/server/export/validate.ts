// Checks a finished export before it may become the active one (export-mod.md §7 first-run checklist,
// materials-availability.md §8.6). Errors block activation; warnings are printed and the export is still used.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pack } from '../../shared/types/pack.ts';
import { tableItemCount } from '../pack/crops.ts';
import { MARKER_FAILED, MARKER_OK } from '../pack/format.ts';
import { loadPack } from '../pack/load.ts';
import { allMachines } from '../pack/lookup.ts';

export interface ValidationIssue { level: 'error' | 'warn'; code: string; text: string }
/** `ok` = no issue of level error; `pack` is null when the export could not be loaded. */
export interface ValidationReport { ok: boolean; issues: ValidationIssue[]; pack: Pack | null; summary: string }

/** GTNH 2.9 has well over 140 recipe maps; fewer means the recipe map section lost most of them. */
export const MIN_RECIPE_MAPS = 140;
/** GTNH 2.9.0-RC-1's ore veins and small ores (materials-availability.md §8.6); a newer pack may differ. */
const RC1_VEINS = 122;
const RC1_SMALL_ORES = 54;
/** How many lines of EXPORT_FAILED, name-failure samples and loader warnings an issue quotes. */
const QUOTED = 5;
const CIRCUIT = 'gregtech:gt.integrated_circuit@';

/** The first lines of the export's EXPORT_FAILED marker (its time and the start of the stack trace); null when there is none. */
export async function exportFailureLines(dir: string): Promise<string[] | null> {
  let text: string;
  try {
    text = await readFile(join(dir, MARKER_FAILED), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return [`(${MARKER_FAILED} exists but cannot be read: ${err instanceof Error ? err.message : String(err)})`];
  }
  return text.split(/\r?\n/).filter((line) => line.trim() !== '').slice(0, QUOTED);
}

const indented = (lines: readonly string[]) => lines.map((line) => `\n    ${line}`).join('');

/**
 * `items <n> · fluids <n> · …`, every number taken from the loaded Pack (ruling R2); `structures <n>` says how many have
 * hatch rules (exporter 0.6.0+) when some do.
 */
function summarize(pack: Pack): string {
  const machines = allMachines(pack);
  const { veins, dimensions } = pack.worldgen;
  const hatchRules = machines.filter((m) => m.structure?.elements !== undefined).length;
  return [
    `items ${tableItemCount(pack.items)}`, `fluids ${pack.fluids.size}`, `recipes ${pack.recipes.length}`, `maps ${pack.maps.size}`,
    `machines ${machines.length}`, `structures ${machines.filter((m) => m.structure !== undefined).length}${hatchRules > 0 ? ` (${hatchRules} with hatch rules)` : ''}`,
    `veins ${veins.length}`, `dimensions ${dimensions.length}`,
  ].join(' · ');
}

type Report = (code: string, text: string) => void;

/** The checks that need the loaded pack, errors first. */
function checkPack(pack: Pack, error: Report, warn: Report): void {
  const m = pack.manifest;
  const gt = pack.recipes.filter((r) => r.source === 'gt');
  if (gt.length === 0) error('no-gt-recipes', 'the export has no GregTech recipes');
  const maps = m.counts.recipeMaps ?? 0;
  if (maps < MIN_RECIPE_MAPS) error('few-maps', `the export has ${maps} recipe maps, expected at least ${MIN_RECIPE_MAPS}`);

  const items = tableItemCount(pack.items);   // the exporter counts name failures over its item table only
  if (typeof m.nameFailures === 'number' && m.nameFailures > items / 100) {
    const samples = (m.nameFailureSamples ?? []).slice(0, QUOTED);
    warn('name-failures', `${m.nameFailures} of ${items} items have no English name (more than 1 %)`
      + (samples.length > 0 ? `, e.g. ${samples.join(', ')}` : ''));
  }
  const spot = (kind: string, name: string, found: boolean) => {
    if (!found) warn('missing-names', `no ${kind} is named "${name}"; English names may have failed`);
  };
  spot('item', 'Iron Dust', [...pack.items.values()].some((i) => i.name === 'Iron Dust'));
  spot('fluid', 'Molten Iron', [...pack.fluids.values()].some((f) => f.name === 'Molten Iron'));
  spot('machine', 'Electric Blast Furnace', allMachines(pack).some((x) => x.name === 'Electric Blast Furnace'));
  if (!gt.some((r) => r.meta.cleanroom === true)) {
    warn('no-cleanroom', 'no GregTech recipe needs a cleanroom (meta.cleanroom); recipe metadata may be missing');
  }
  if (!gt.some((r) => r.inputs.some((i) => !i.consumed && i.options.some((o) => o.key.startsWith(CIRCUIT))))) {
    warn('no-circuit', 'no GregTech recipe has a programmed circuit as a not-consumed input');
  }

  const veins = pack.worldgen.veins.filter((v) => v.kind === 'vein').length;
  const small = pack.worldgen.veins.filter((v) => v.kind === 'small').length;
  if (veins !== RC1_VEINS || small !== RC1_SMALL_ORES) {
    warn('vein-count', `found ${veins} ore veins and ${small} small ores; GTNH 2.9.0-RC-1 has ${RC1_VEINS} and ${RC1_SMALL_ORES} `
      + '(a newer pack may differ)');
  }
  const failed = m.failedSections ?? [];
  if (failed.length > 0) warn('failed-sections', `sections that failed: ${failed.join(', ')}`);
  const skipped = m.skippedSections ?? [];
  if (skipped.length > 0) warn('skipped-sections', `sections skipped: ${skipped.join(', ')}`);
  const warnings = pack.warnings ?? [];
  if (warnings.length > 0) {
    warn('pack-warnings', `${warnings.length} loader warning${warnings.length === 1 ? '' : 's'}`
      + `${warnings.length > QUOTED ? `, the first ${QUOTED}` : ''}:${indented(warnings.slice(0, QUOTED))}`);
  }
}

/**
 * Checks the export in `dir`: its marker, that it loads, and that it holds what a GTNH 2.9 export must (GT recipes, at
 * least `MIN_RECIPE_MAPS` maps) and should (English names, cleanroom and programmed-circuit recipes, the RC-1 vein
 * counts, every section, no loader warnings). Never throws for a broken export: that is a `load-failed` error.
 */
export async function validateExport(dir: string): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const error = (code: string, text: string) => issues.push({ level: 'error', code, text });
  const warn = (code: string, text: string) => issues.push({ level: 'warn', code, text });

  if (!existsSync(join(dir, MARKER_OK))) error('no-marker', `${MARKER_OK} is missing, so the exporter did not finish`);
  const failure = await exportFailureLines(dir);
  if (failure !== null) error('export-failed', `the exporter wrote ${MARKER_FAILED}:${indented(failure)}`);

  let pack: Pack | null = null;
  try {
    pack = await loadPack(dir);
  } catch (err) {
    error('load-failed', `the export does not load: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (pack !== null) checkPack(pack, error, warn);

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    pack,
    summary: pack === null ? 'not loaded' : summarize(pack),
  };
}
