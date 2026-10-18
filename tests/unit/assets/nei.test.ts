import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNeiDump, type NeiDumpRow } from '../../helpers/nei-dump.ts';
import { makePng } from '../../helpers/png.ts';
import { parseCsv, parseNeiCsv, neiFileBase, assignNeiFiles, importNeiIcons, loadNeiIndex, NeiImportError, NEI_HEADER, type NeiRow } from '../../../src/server/assets/nei.ts';

const ROWS: NeiDumpRow[] = [
  { name: 'minecraft:stone', meta: 0, display: 'Stone' },
  { name: 'minecraft:stone', meta: 1, display: 'Granite' },
  { name: 'gregtech:gt.metaitem.01', meta: 11032, display: 'Iron Ingot' },
  { name: 't:iron_ingot', meta: 0, display: 'Iron Ingot' },
  { name: 't:iron', meta: 0, display: 'iron ingot' },
  { name: 'NotEnoughItems:neiFluidDisplay', meta: 0, nbt: true, display: 'Water' },
  { name: 'minecraft:written_book', meta: 0, nbt: true, display: 'Book: "A", B' },
  { name: 't:weird', meta: 0, display: 'a/b:c*d' },
];
// Ruling R3: a case-sensitive dump holding both "Iron Ingot.png" and "iron ingot.png" cannot be written on the Mac's
// case-insensitive temp disk, so the tests that write a case-sensitive dump use row 5 = "Iron Ingot" (file
// "Iron Ingot_3.png" under both rules).
const ROWS_CS: NeiDumpRow[] = ROWS.map((r, i) => (i === 4 ? { name: 't:iron', meta: 0, display: 'Iron Ingot' } : r));
// Ruling R17: NEI's fluid rows are matched by Display Name against the pack's fluid names.
const FLUIDS = [{ key: 'fluid:water', name: 'Water' }];
const HEADER_LINE = `${NEI_HEADER.join(',')}\n`;
const asRows = (r: NeiDumpRow[]): NeiRow[] => r.map((x) => ({ name: x.name, meta: x.meta, hasNbt: !!x.nbt, display: x.display }));

describe('NEI dump rules', () => {
  it('parses CSV with quotes and CRLF', () => {
    expect(parseCsv('a,"b ""c"", d"\r\n1,2\n')).toEqual([['a', 'b "c", d'], ['1', '2']]);
  });

  // Ruling R16: NEI's DataDumper.concat quotes a field only when its first ',' or '"' is past index 0.
  it('decodes display names the way NEI writes them', () => {
    const text = `${HEADER_LINE}enderio:itemEnderios,1,0,false,"Enderios"\nt:a,2,0,false,"Book: ""A"", B"\nt:b,3,0,false,,lead\n`;
    expect(parseNeiCsv(text).map((r) => r.display)).toEqual(['"Enderios"', 'Book: "A", B', ',lead']);
  });

  it('refuses lines NEI would not write', () => {
    expect(() => parseNeiCsv(`${HEADER_LINE}t:a,1,0,false\n`)).toThrow('CSV row 1 has 4 fields, expected 5');
    expect(() => parseNeiCsv(`${HEADER_LINE}"t:a",1,0,false,A\n`)).toThrow(NeiImportError);
    expect(() => parseNeiCsv('a,b\n')).toThrow(/CSV header/);
  });

  it('cleans file names like NEI', () => {
    expect(neiFileBase('a/b:c*d?e<f>g|h"i\\j\u0001')).toBe('a_b_c_d_e_f_g_h_i_j_');
  });

  it('replays the _2, _3 collision rule on either kind of disk', () => {
    expect(assignNeiFiles(asRows(ROWS), false)).toEqual(['Stone.png', 'Granite.png', 'Iron Ingot.png', 'Iron Ingot_2.png', 'iron ingot.png', 'Water.png', 'Book_ _A_, B.png', 'a_b_c_d.png']);
    expect(assignNeiFiles(asRows(ROWS), true)[4]).toBe('iron ingot_3.png');
  });
});

describe('importNeiIcons', () => {
  it('joins rows to PNGs by order and indexes them by key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), ROWS_CS, { caseInsensitive: false });
    const r = await importNeiIcons({ csv: d.csv, fluids: FLUIDS, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toEqual({ rows: 8, imported: 7, skippedNbt: 1, fluids: 1, duplicates: 0, caseInsensitive: false });
    const nei = (await loadNeiIndex(join(dir, 'data', 'assets')))!;
    expect(nei.size).toBe(7);
    expect(nei.icon('t:iron_ingot@0')).toEqual({ path: 'nei/icons/adc999ea62bc5836.png' });
    expect(nei.icon('fluid:water')).toEqual({ path: 'nei/icons/79da7cf2c0480a76.png' });
    expect(nei.icon('minecraft:written_book@0')).toBeNull();
    expect(await readFile(join(dir, 'data', 'assets', 'nei', 'icons', 'adc999ea62bc5836.png'))).toEqual(makePng(16, 16, [80, 0, 0, 255]));
  });

  it('skips a fluid row whose name more than one fluid has', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), ROWS_CS, { caseInsensitive: false });
    const fluids = [{ key: 'fluid:water', name: 'Water' }, { key: 'fluid:ic2water', name: 'Water' }];
    const r = await importNeiIcons({ csv: d.csv, fluids, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toMatchObject({ imported: 6, skippedNbt: 2, fluids: 0 });
    expect((await loadNeiIndex(join(dir, 'data', 'assets')))!.icon('fluid:water')).toBeNull();
  });

  it('imports a display name that starts with a quote, as NEI wrote it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), [{ name: 'enderio:itemEnderios', meta: 0, display: '"Enderios"' }], { caseInsensitive: false });
    expect(d.files).toEqual(['_Enderios_.png']);
    const r = await importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toMatchObject({ rows: 1, imported: 1 });
    expect((await loadNeiIndex(join(dir, 'data', 'assets')))!.icon('enderio:itemEnderios@0')).not.toBeNull();
  });

  it('detects a dump written on a case-insensitive disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), ROWS, { caseInsensitive: true });
    expect((await importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') })).caseInsensitive).toBe(true);
  });

  it('refuses a row-order mismatch and keeps the previous import', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const good = await writeNeiDump(join(dir, 'good'), ROWS_CS, { caseInsensitive: false });
    // With the fluids, so that the fluid row is imported too (Ruling R18; without them it is skipped).
    await importNeiIcons({ csv: good.csv, fluids: FLUIDS, pngDir: good.pngDir, dataDir: join(dir, 'data') });
    const bad = await writeNeiDump(join(dir, 'bad'), ROWS_CS, { caseInsensitive: false });
    await rename(join(bad.pngDir, 'Granite.png'), join(bad.pngDir, 'Andesite.png'));
    await expect(importNeiIcons({ csv: bad.csv, pngDir: bad.pngDir, dataDir: join(dir, 'data') })).rejects.toThrow(/Row 2 \(minecraft:stone@1 "Granite"\) expects "Granite.png"/);
    await writeFile(join(dir, 'other.csv'), 'a,b\n');
    await expect(importNeiIcons({ csv: join(dir, 'other.csv'), pngDir: good.pngDir, dataDir: join(dir, 'data') })).rejects.toBeInstanceOf(NeiImportError);
    expect((await loadNeiIndex(join(dir, 'data', 'assets')))!.size).toBe(7);
  });

  it('returns null before any import', async () => {
    expect(await loadNeiIndex(await mkdtemp(join(tmpdir(), 'gp-nei-')))).toBeNull();
  });
});
