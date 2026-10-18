// A synthetic NEI item-panel dump as NEI writes it (research §6.5.1, Task 11): `itempanel.csv`, `itempanel.json` and
// `itempanel_icons/<file>.png`, one entry per row, in row order.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assignNeiFiles, NEI_HEADER } from '../../src/server/assets/nei.ts';
import { makePng } from './png.ts';

export interface NeiDumpRow { name: string; meta: number; nbt?: boolean; display: string; fluid?: string }

/** RFC 4180: quoted (with doubled quotes) only when the value holds a comma, a quote or a line break. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Writes the three parts of a dump into `dir`: CSV rows with item ids `9000 + i`; one Json line per row (the fluid's
 * NBT when `fluid` is set, else `{}`); and for row `i` a 16×16 PNG of colour `[20 * (i + 1), 0, 0, 255]`, named by
 * `assignNeiFiles`. A PNG never replaces another one, so a dump that this disk cannot hold (a case-sensitive dump
 * with names that differ only in case, on a case-insensitive disk) fails here instead of losing a file.
 */
export async function writeNeiDump(
  dir: string, rows: NeiDumpRow[], opts: { caseInsensitive: boolean },
): Promise<{ csv: string; json: string; pngDir: string; files: string[] }> {
  const csv = join(dir, 'itempanel.csv');
  const json = join(dir, 'itempanel.json');
  const pngDir = join(dir, 'itempanel_icons');
  await mkdir(pngDir, { recursive: true });
  const lines = rows.map((r, i) => [r.name, String(9000 + i), String(r.meta), r.nbt === true ? 'true' : 'false', r.display].map(csvField).join(','));
  await writeFile(csv, `${[NEI_HEADER.join(','), ...lines].join('\n')}\n`);
  const nbt = rows.map((r) => (r.fluid === undefined ? '{}' : JSON.stringify({ tag: { FluidName: r.fluid, Amount: 1000 } })));
  await writeFile(json, `${nbt.join('\n')}\n`);
  const files = assignNeiFiles(rows.map((r) => ({ name: r.name, meta: r.meta, hasNbt: r.nbt === true, display: r.display })), opts.caseInsensitive);
  for (const [i, file] of files.entries()) {
    await writeFile(join(pngDir, file), makePng(16, 16, [20 * (i + 1), 0, 0, 255]), { flag: 'wx' });
  }
  return { csv, json, pngDir, files };
}
