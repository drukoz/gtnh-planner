// A synthetic NEI item-panel dump as NEI writes it (research §6.5.1, Task 11, Rulings R16 and R17): `itempanel.csv`
// and `itempanel_icons/<file>.png`, one entry per row, in row order.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assignNeiFiles, NEI_HEADER } from '../../src/server/assets/nei.ts';
import { makePng } from './png.ts';

export interface NeiDumpRow { name: string; meta: number; nbt?: boolean; display: string }

/**
 * NEI's `DataDumper.concat`: a field is wrapped in quotes, with its `"` doubled, only when its first `,` or its first
 * `"` is past index 0. Anything else, a leading quote or comma and line breaks included, is written as it is.
 */
function neiField(value: string): string {
  return value.indexOf(',') > 0 || value.indexOf('"') > 0 ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Writes the two parts of a dump into `dir`: CSV rows with item ids `9000 + i`, and for row `i` a 16×16 PNG of colour
 * `[20 * (i + 1), 0, 0, 255]`, named by `assignNeiFiles`. A PNG never replaces another one, so a dump that this disk
 * cannot hold (a case-sensitive dump with names that differ only in case, on a case-insensitive disk) fails here
 * instead of losing a file.
 */
export async function writeNeiDump(
  dir: string, rows: NeiDumpRow[], opts: { caseInsensitive: boolean },
): Promise<{ csv: string; pngDir: string; files: string[] }> {
  const csv = join(dir, 'itempanel.csv');
  const pngDir = join(dir, 'itempanel_icons');
  await mkdir(pngDir, { recursive: true });
  const lines = [[...NEI_HEADER], ...rows.map((r, i) => [r.name, String(9000 + i), String(r.meta), r.nbt === true ? 'true' : 'false', r.display])];
  await writeFile(csv, `${lines.map((fields) => fields.map(neiField).join(',')).join('\n')}\n`);
  const files = assignNeiFiles(rows.map((r) => ({ name: r.name, meta: r.meta, hasNbt: r.nbt === true, display: r.display })), opts.caseInsensitive);
  for (const [i, file] of files.entries()) {
    await writeFile(join(pngDir, file), makePng(16, 16, [20 * (i + 1), 0, 0, 255]), { flag: 'wx' });
  }
  return { csv, pngDir, files };
}
