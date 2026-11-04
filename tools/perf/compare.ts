// `npm run perf`'s byte-for-byte check (RUK-563): compares a run's plan and layout JSON against a reference run, pass by
// pass. `node tools/perf/compare.ts <reference> <run>` prints one line per missing file, differing file and skipped pass,
// then `compared <n>, differing <d>, missing <m>`, and exits 1 when `d` or `m` is not 0. Files and passes only the run
// has are ignored, so a run may hold more than the reference.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A file whose bytes differ: the first differing byte, and up to 40 bytes from there in each file. */
export interface FileDiff { file: string; offset: number; reference: string; run: string }
/** What `compareRuns` found. `file` names are `<pass>/<name>`. */
export interface Comparison { compared: number; missing: string[]; differing: FileDiff[]; skippedPasses: string[] }

const PREVIEW_BYTES = 40;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The folders directly inside `dir`, sorted; in a run folder each is one pass. */
function passNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** The `.json` files directly inside `dir`, sorted by name. */
function jsonNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort();
}

/** The index of the first byte where `a` and `b` differ, or the shorter file's length when one is a prefix of the other. */
function firstDifference(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}

/** Up to `PREVIEW_BYTES` bytes from `offset`, as latin1 so every byte prints. */
function preview(bytes: Buffer, offset: number): string {
  return bytes.subarray(offset, offset + PREVIEW_BYTES).toString('latin1');
}

/**
 * Compares every `.json` file of every pass folder of `referenceDir` against the same `<pass>/<name>` under `runDir`.
 * A pass the run did not make is skipped and its files are not counted; a pass folder of the run is missing when the run
 * has no folder of that name.
 */
export function compareRuns(referenceDir: string, runDir: string): Comparison {
  const found: Comparison = { compared: 0, missing: [], differing: [], skippedPasses: [] };
  for (const pass of passNames(referenceDir)) {
    const runPassDir = join(runDir, pass);
    if (!isDirectory(runPassDir)) {
      found.skippedPasses.push(pass);
      continue;
    }
    for (const name of jsonNames(join(referenceDir, pass))) {
      found.compared++;
      const file = `${pass}/${name}`;
      const runFile = join(runPassDir, name);
      if (!isFile(runFile)) {
        found.missing.push(file);
        continue;
      }
      const reference = readFileSync(join(referenceDir, pass, name));
      const run = readFileSync(runFile);
      if (reference.equals(run)) continue;
      const offset = firstDifference(reference, run);
      found.differing.push({ file, offset, reference: preview(reference, offset), run: preview(run, offset) });
    }
  }
  return found;
}

/** The comparison as text: one line per missing file, per differing file and per skipped pass, then the tally. */
export function comparisonLines(found: Comparison): string[] {
  const lines = found.missing.map((file) => `MISSING ${file}`);
  for (const d of found.differing) lines.push(`DIFF ${d.file} at byte ${d.offset}: ${d.reference} | ${d.run}`);
  for (const pass of found.skippedPasses) lines.push(`SKIPPED ${pass}`);
  lines.push(`compared ${found.compared}, differing ${found.differing.length}, missing ${found.missing.length}`);
  return lines;
}

/** Whether the comparison has nothing left to explain: no differing and no missing file. */
export function comparisonIsClean(found: Comparison): boolean {
  return found.differing.length === 0 && found.missing.length === 0;
}

if (import.meta.main) {
  const referenceDir = process.argv[2] ?? '';
  const runDir = process.argv[3] ?? '';
  if (referenceDir === '' || runDir === '') {
    console.error('Usage: node tools/perf/compare.ts <reference> <run>');
    process.exit(2);
  }
  const found = compareRuns(referenceDir, runDir);
  for (const line of comparisonLines(found)) console.log(line);
  process.exit(comparisonIsClean(found) ? 0 : 1);
}
