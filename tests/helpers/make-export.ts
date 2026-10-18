// Writes synthetic export directories in the wire format of src/server/pack/format.ts, so tests never need a real
// game export (architecture §2 rule 2, §10).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  EXPORT_FILES, EXPORT_FORMAT, MARKER_FAILED, MARKER_OK,
  type ExportFileKey, type ExportLineTypes, type ItemLine, type ManifestFile, type RecipeMapLine,
} from '../../src/server/pack/format.ts';

type PlainLineArrays = { [K in Exclude<ExportFileKey, 'items' | 'recipeMaps'>]?: ExportLineTypes[K][] };

/** What `makeExport` writes. Every part is optional: a missing line array becomes an empty file. */
export interface ExportSpec extends PlainLineArrays {
  /** Merged over the default manifest; `counts` always come from the lines written (see `countOverrides`). */
  manifest?: Partial<ManifestFile>;
  /** Default 'EXPORT_OK'; null writes no marker. */
  marker?: 'EXPORT_OK' | 'EXPORT_FAILED' | null;
  omitFiles?: ExportFileKey[];
  /** Appends this many maps `gt.recipe.filler.<n>` (n from 1) after `recipeMaps`. */
  fillerMaps?: number;
  /** Appended verbatim after the JSON lines of a file, one string per line. */
  rawLines?: Partial<Record<ExportFileKey, string[]>>;
  countOverrides?: Partial<Record<ExportFileKey, number>>;
  /** `i` is assigned by position. */
  items?: Array<Omit<ItemLine, 'i'>>;
  /** `i` is assigned by position; `recipes` defaults to the number of `recipesGt` lines that name the map. */
  recipeMaps?: Array<Omit<RecipeMapLine, 'i' | 'recipes'> & { recipes?: number }>;
}

const FILE_KEYS = Object.keys(EXPORT_FILES).filter((k): k is ExportFileKey => k !== 'manifest');

/** Marker contents in the exporter's own format (`OK <ms>ms`, `FAILED <ms>ms` + the error). */
const MARKER_TEXT = { [MARKER_OK]: 'OK 0ms\n', [MARKER_FAILED]: 'FAILED 0ms\nsynthetic export failure written by makeExport\n' };

function defaultManifest(exportId: string): ManifestFile {
  return {
    format: EXPORT_FORMAT, exportId, exporterVersion: '0.1.0', exportedAt: '2026-10-17T12:00:00Z',
    packVersion: '2.9.0-RC-1', gtVersion: '5.09.54.183', mods: { minecraft: '1.7.10', gregtech: '5.09.54.183' }, counts: {},
    nameFailures: 0, nameFailureSamples: [], sectionMillis: {}, failedSections: [], skippedSections: [], warnings: [],
  };
}

function linesOf(spec: ExportSpec, key: ExportFileKey): readonly unknown[] {
  if (key === 'items') return (spec.items ?? []).map((item, i) => ({ i, ...item }));
  if (key === 'recipeMaps') {
    const recipesPerMap = new Map<number, number>();
    for (const r of spec.recipesGt ?? []) recipesPerMap.set(r.map, (recipesPerMap.get(r.map) ?? 0) + 1);
    const fillers = Array.from({ length: spec.fillerMaps ?? 0 }, (_, n) => ({ id: `gt.recipe.filler.${n + 1}`, dn: `Filler ${n + 1}`, amps: 1, recipes: 0 }));
    return [...(spec.recipeMaps ?? []), ...fillers].map((m, i) => ({ i, ...m, recipes: m.recipes ?? recipesPerMap.get(i) ?? 0 }));
  }
  return spec[key] ?? [];
}

/**
 * Writes every file of `EXPORT_FILES` except `omitFiles` into `dir` (created if needed), then `manifest.json`
 * (counts = lines written, or `countOverrides`), then the marker. Returns `dir`; `exportId` defaults to its basename.
 */
export async function makeExport(dir: string, spec: ExportSpec): Promise<string> {
  await mkdir(dir, { recursive: true });
  const omitted = new Set(spec.omitFiles);
  const counts: ManifestFile['counts'] = {};
  for (const key of FILE_KEYS) {
    if (omitted.has(key)) continue;
    const lines = linesOf(spec, key);
    const raw = spec.rawLines?.[key] ?? [];
    await writeJsonlGz(join(dir, EXPORT_FILES[key]), lines, raw);
    counts[key] = lines.length + raw.length;
  }
  const manifest: ManifestFile = { ...defaultManifest(basename(dir)), ...spec.manifest, counts: { ...counts, ...spec.countOverrides } };
  await writeFile(join(dir, EXPORT_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
  const marker = spec.marker === undefined ? MARKER_OK : spec.marker;
  if (marker !== null) await writeFile(join(dir, marker), MARKER_TEXT[marker]);
  return dir;
}

/** Gzip'd JSON Lines: each value, then each raw line, followed by '\n' (no lines at all = empty text). */
export async function writeJsonlGz(file: string, lines: readonly unknown[], raw: readonly string[] = []): Promise<void> {
  const text = [...lines.map((line) => JSON.stringify(line)), ...raw].map((line) => `${line}\n`).join('');
  await writeFile(file, gzipSync(text));
}

/** The lines of a gzip'd JSON Lines file, parsed unless `raw`. */
export async function readJsonlGz(file: string, opts: { raw?: boolean } = {}): Promise<unknown[]> {
  const lines = gunzipSync(await readFile(file)).toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return opts.raw ? lines : lines.map((line) => JSON.parse(line));
}
