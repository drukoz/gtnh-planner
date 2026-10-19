import { describe, it, expect } from 'vitest';
import { mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNeiDump, type NeiDumpRow } from '../../helpers/nei-dump.ts';
import { makePng } from '../../helpers/png.ts';
import { parseCsv, parseNeiCsv, neiFileBase, assignNeiFiles, matchNeiFiles, importNeiIcons, loadNeiIndex, NeiImportError, NEI_HEADER, type NeiRow } from '../../../src/server/assets/nei.ts';

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
// Some items pick a display name at random each time they are drawn, so NEI's PNG dump, taken a few seconds after the
// CSV one, can name their icon differently (both seen in a real dump).
const QED: NeiDumpRow = { name: 'ExtraUtilities:endConstructor', meta: 0, display: 'QED (Quite Elegant Device)' };
const BREAD: NeiDumpRow = { name: 'dreamcraft:QuantumBread', meta: 0, display: 'Quantum Sliced Bread' };
const RENAMED_PNGS: Array<[string, string]> = [
  ['QED (Quite Elegant Device).png', 'QED (Quantum Ender Diviner).png'],
  ['Quantum Sliced Bread.png', 'Quantum Bread.png'],
];
/** The rows with QED as row 2 and the bread as row 7. */
const withRandomNames = (r: NeiDumpRow[]): NeiDumpRow[] => [r[0]!, QED, ...r.slice(1, 5), BREAD, ...r.slice(5)];
/** `count` rows with names of their own, "Item 0", "Item 1", … */
const items = (count: number): NeiDumpRow[] => Array.from({ length: count }, (_, i) => ({ name: 't:item', meta: i, display: `Item ${i}` }));

/** Renames PNGs one after the other, as NEI named them for rows whose display name changed before the PNG dump. */
async function renamePngs(pngDir: string, renames: Array<[string, string]>): Promise<void> {
  for (const [from, to] of renames) await rename(join(pngDir, from), join(pngDir, to));
}

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

  // importNeiIcons refuses a PNG count other than the row count first; matchNeiFiles checks the two counts on its own.
  it('accepts rows without a PNG only with as many PNGs that no row expects', () => {
    const rows = asRows([{ name: 't:a', meta: 0, display: 'A' }, { name: 't:b', meta: 0, display: 'B' }, { name: 't:c', meta: 0, display: 'C' }]);
    expect(matchNeiFiles(rows, new Set(['A.png', 'X.png', 'Y.png']), 'icons').missing).toEqual([1, 2]);
    expect(() => matchNeiFiles(rows, new Set(['A.png', 'X.png', 'Y.png', 'Z.png']), 'icons'))
      .toThrow(/^Row 2 \(t:b@0 "B"\) expects "B.png", which is not in icons\. 2 rows have no PNG but 3 PNGs belong to no row/);
    expect(() => matchNeiFiles(rows, new Set(['A.png', 'X.png']), 'icons')).toThrow(/2 rows have no PNG but 1 PNGs belong to no row/);
  });

  it('compares file bases case-insensitively only when the file names matched case-insensitively', () => {
    const foo = asRows([{ name: 't:a', meta: 0, display: 'Foo' }, { name: 't:b', meta: 0, display: 'FOO' }]);
    // NEI drew "Foo" as "foo": on a case-insensitive disk "foo" and "FOO" share one numbering, so the names are ambiguous.
    expect(() => matchNeiFiles(foo, new Set(['foo.png', 'FOO_2.png']), 'icons')).toThrow(/^Row 1 \(t:a@0 "Foo"\) expects "Foo.png".*ambiguous/);
    // "Baz" drawn as "FOO" after "Foo": FOO_2.png is named like row 3 once case is ignored.
    const iron = asRows([{ name: 't:i', meta: 0, display: 'Iron Ingot' }, { name: 't:j', meta: 0, display: 'iron ingot' }]);
    const baz = [...iron, ...asRows([{ name: 't:a', meta: 0, display: 'Foo' }, { name: 't:b', meta: 0, display: 'Baz' }])];
    expect(() => matchNeiFiles(baz, new Set(['Iron Ingot.png', 'iron ingot_2.png', 'Foo.png', 'FOO_2.png']), 'icons'))
      .toThrow(/^Row 4 \(t:b@0 "Baz"\) expects "Baz.png".*ambiguous/);
    // Matched case-sensitively, "Foo" and "FOO" are names of their own.
    expect(matchNeiFiles(foo, new Set(['Bar.png', 'FOO.png']), 'icons')).toEqual({ files: ['Foo.png', 'FOO.png'], caseInsensitive: false, missing: [0] });
  });

  it('matches a dump with a _<n> name case-sensitively when a case-insensitive disk would not have numbered it otherwise', () => {
    // MK.png and Mk.png cannot both be on a case-insensitive disk, so "Mk:2" drawn as "Zed" leaves Mk.png to row 2 (an
    // importNeiIcons test refuses the same rows when the PNGs may come from either kind of disk).
    const mk = asRows([{ name: 't:a', meta: 0, display: 'MK' }, { name: 't:b', meta: 0, display: 'Mk' }, { name: 't:c', meta: 0, display: 'Mk:2' }]);
    expect(matchNeiFiles(mk, new Set(['MK.png', 'Mk.png', 'Zed.png']), 'icons')).toEqual({ files: ['MK.png', 'Mk.png', 'Mk_2.png'], caseInsensitive: false, missing: [2] });
    // Without names that differ only in case, either kind of disk gives "Mk:2" Mk_2.png.
    const qed = asRows([{ name: 't:c', meta: 0, display: 'Mk:2' }, QED]);
    expect(matchNeiFiles(qed, new Set(['Mk_2.png', 'QED (Quantum Ender Diviner).png']), 'icons'))
      .toEqual({ files: ['Mk_2.png', 'QED (Quite Elegant Device).png'], caseInsensitive: false, missing: [1] });
  });

  it('matches a dump with a _<n> name case-insensitively when that finds more files', () => {
    // A case-insensitive disk numbered "FOO" after "Foo"; matched that way, only the QED misses its file.
    const rows = asRows([{ name: 't:a', meta: 0, display: 'Foo' }, { name: 't:b', meta: 0, display: 'FOO' }, { name: 't:c', meta: 0, display: 'Mk:2' }, QED]);
    expect(matchNeiFiles(rows, new Set(['Foo.png', 'FOO_2.png', 'Mk_2.png', 'QED (Quantum Ender Diviner).png']), 'icons'))
      .toEqual({ files: ['Foo.png', 'FOO_2.png', 'Mk_2.png', 'QED (Quite Elegant Device).png'], caseInsensitive: true, missing: [3] });
  });

  it('allows one row without a PNG per 1000 rows in a large dump', () => {
    const rows = asRows(items(11_999));
    const listing = (renamed: number) => new Set(rows.map((_, i) => (i < renamed ? `Other ${i}.png` : `Item ${i}.png`)));
    expect(matchNeiFiles(rows, listing(11), 'icons').missing).toHaveLength(11);
    expect(() => matchNeiFiles(rows, listing(12), 'icons')).toThrow(/^Row 1 \(t:item@0 "Item 0"\) expects "Item 0.png", which is not in icons\. 12 rows/);
  });
});

describe('importNeiIcons', () => {
  it('joins rows to PNGs by order and indexes them by key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), ROWS_CS, { caseInsensitive: false });
    const r = await importNeiIcons({ csv: d.csv, fluids: FLUIDS, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toEqual({ rows: 8, imported: 7, skippedNbt: 1, fluids: 1, duplicates: 0, caseInsensitive: false, unmatched: [] });
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
    // A second Stone where the CSV has Granite. A name of its own (Andesite.png) would pass for a random name.
    await rename(join(bad.pngDir, 'Granite.png'), join(bad.pngDir, 'Stone_2.png'));
    await expect(importNeiIcons({ csv: bad.csv, pngDir: bad.pngDir, dataDir: join(dir, 'data') })).rejects.toThrow(/Row 2 \(minecraft:stone@1 "Granite"\) expects "Granite.png"/);
    await writeFile(join(dir, 'other.csv'), 'a,b\n');
    await expect(importNeiIcons({ csv: join(dir, 'other.csv'), pngDir: good.pngDir, dataDir: join(dir, 'data') })).rejects.toBeInstanceOf(NeiImportError);
    expect((await loadNeiIndex(join(dir, 'data', 'assets')))!.size).toBe(7);
  });

  it('leaves the rows whose display name changed before the PNG dump without an icon', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), withRandomNames(ROWS_CS), { caseInsensitive: false });
    await renamePngs(d.pngDir, RENAMED_PNGS);
    const r = await importNeiIcons({ csv: d.csv, fluids: FLUIDS, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toEqual({
      rows: 10, imported: 7, skippedNbt: 1, fluids: 1, duplicates: 0, caseInsensitive: false,
      unmatched: [
        { row: 2, key: 'ExtraUtilities:endConstructor@0', display: 'QED (Quite Elegant Device)' },
        { row: 7, key: 'dreamcraft:QuantumBread@0', display: 'Quantum Sliced Bread' },
      ],
    });
    const assets = join(dir, 'data', 'assets');
    const nei = (await loadNeiIndex(assets))!;
    expect(nei.size).toBe(7);
    // writeNeiDump draws row i (from 0) in red 20 * (i + 1).
    const reds: Array<[string, number]> = [
      ['minecraft:stone@0', 20], ['minecraft:stone@1', 60], ['gregtech:gt.metaitem.01@11032', 80], ['t:iron_ingot@0', 100],
      ['t:iron@0', 120], ['fluid:water', 160], ['t:weird@0', 200],
    ];
    for (const [key, red] of reds) {
      const icon = nei.icon(key);
      expect(icon, key).not.toBeNull();
      expect(await readFile(join(assets, icon!.path)), key).toEqual(makePng(16, 16, [red, 0, 0, 255]));
    }
    expect(nei.icon('ExtraUtilities:endConstructor@0')).toBeNull();
    expect(nei.icon('dreamcraft:QuantumBread@0')).toBeNull();
    // The two PNGs that no row expects are not copied.
    expect(await readdir(join(assets, 'nei', 'icons'))).toHaveLength(7);
  });

  it('leaves them without an icon in a dump written on a case-insensitive disk too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), withRandomNames(ROWS), { caseInsensitive: true });
    await renamePngs(d.pngDir, RENAMED_PNGS);
    const r = await importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toMatchObject({ imported: 6, caseInsensitive: true, unmatched: [{ row: 2, key: 'ExtraUtilities:endConstructor@0' }, { row: 7, key: 'dreamcraft:QuantumBread@0' }] });
    const assets = join(dir, 'data', 'assets');
    expect(await readFile(join(assets, (await loadNeiIndex(assets))!.icon('t:iron@0')!.path))).toEqual(makePng(16, 16, [120, 0, 0, 255]));
  });

  it('refuses a missing row whose file name another row has too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const foo: NeiDumpRow[] = [{ name: 't:a', meta: 0, display: 'Foo' }, { name: 't:b', meta: 0, display: 'Foo' }];
    // NEI drew the first "Foo" as "Bar" and the second one as Foo.png, so the first row would get the second one's icon.
    const first = await writeNeiDump(join(dir, 'first'), foo, { caseInsensitive: false });
    await renamePngs(first.pngDir, [['Foo.png', 'Bar.png'], ['Foo_2.png', 'Foo.png']]);
    await expect(importNeiIcons({ csv: first.csv, pngDir: first.pngDir, dataDir: join(dir, 'data') }))
      .rejects.toThrow(/^Row 2 \(t:b@0 "Foo"\) expects "Foo_2.png", which is not in .*ambiguous/);
    // Both changed: the first drawn as "Foo_2", the second as "Qux", so the second row would get the first one's icon.
    const both = await writeNeiDump(join(dir, 'both'), foo, { caseInsensitive: false });
    await renamePngs(both.pngDir, [['Foo_2.png', 'Qux.png'], ['Foo.png', 'Foo_2.png']]);
    await expect(importNeiIcons({ csv: both.csv, pngDir: both.pngDir, dataDir: join(dir, 'data') }))
      .rejects.toThrow(/^Row 1 \(t:a@0 "Foo"\) expects "Foo.png", which is not in .*ambiguous/);
    expect(await loadNeiIndex(join(dir, 'data', 'assets'))).toBeNull();
  });

  it('refuses a missing row whose file NEI numbered after another row', async () => {
    // "Foo", "Foo", "Foo_2" expect Foo.png, Foo_2.png, Foo_2_2.png. NEI drew the first as "Bar", so the second took
    // Foo.png and the third Foo_2.png: only the third misses its file, yet the first two would get the next row's icon.
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const rows = [{ name: 't:a', meta: 0, display: 'Foo' }, { name: 't:b', meta: 0, display: 'Foo' }, { name: 't:c', meta: 0, display: 'Foo_2' }];
    const d = await writeNeiDump(join(dir, 'dumps'), rows, { caseInsensitive: false });
    await renamePngs(d.pngDir, [['Foo.png', 'Bar.png'], ['Foo_2.png', 'Foo.png'], ['Foo_2_2.png', 'Foo_2.png']]);
    await expect(importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') }))
      .rejects.toThrow(/^Row 3 \(t:c@0 "Foo_2"\) expects "Foo_2_2.png", which is not in .*ambiguous/);
  });

  it('refuses a PNG that no row expects but that is named like a row', async () => {
    // NEI drew "Baz" as "Foo" (Foo.png) and so the row "Foo" after it as Foo_2.png: the second row would get the
    // first one's icon.
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), [{ name: 't:a', meta: 0, display: 'Baz' }, { name: 't:b', meta: 0, display: 'Foo' }], { caseInsensitive: false });
    await renamePngs(d.pngDir, [['Foo.png', 'Foo_2.png'], ['Baz.png', 'Foo.png']]);
    await expect(importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') }))
      .rejects.toThrow(/^Row 1 \(t:a@0 "Baz"\) expects "Baz.png", which is not in .*ambiguous/);
    expect(await loadNeiIndex(join(dir, 'data', 'assets'))).toBeNull();
  });

  it('refuses a case-sensitive match of PNGs that a case-insensitive disk may have numbered', async () => {
    // On a case-insensitive disk NEI writes "MK", "Mk", "Mk:2" as MK.png, Mk_2.png, Mk_2_2.png; it drew the third as
    // "Zed". Matched case-sensitively only row 2 misses its file (Mk.png), and row 3 would get row 2's Mk_2.png. The
    // same three files from a case-sensitive disk would mean that row 2 was drawn as "Zed".
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const rows = [{ name: 't:a', meta: 0, display: 'MK' }, { name: 't:b', meta: 0, display: 'Mk' }, { name: 't:c', meta: 0, display: 'Mk:2' }];
    const d = await writeNeiDump(join(dir, 'dumps'), rows, { caseInsensitive: true });
    await renamePngs(d.pngDir, [['Mk_2_2.png', 'Zed.png']]);
    await expect(importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') })).rejects.toThrow(
      /^Row 2 \(t:b@0 "Mk"\) expects "Mk.png", which is not in .*ambiguous: row 2 expects "Mk_2.png" if the PNGs were written on a case-insensitive disk/);
    expect(await loadNeiIndex(join(dir, 'data', 'assets'))).toBeNull();
  });

  it('allows at most 10 rows without a PNG in a dump of 100 rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const dump = async (renamed: number) => {
      const d = await writeNeiDump(join(dir, `renamed-${renamed}`), items(100), { caseInsensitive: false });
      await renamePngs(d.pngDir, Array.from({ length: renamed }, (_, i): [string, string] => [`Item ${i}.png`, `Other ${i}.png`]));
      return importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, `data-${renamed}`) });
    };
    expect((await dump(10)).unmatched).toHaveLength(10);
    await expect(dump(11)).rejects.toThrow(/^Row 1 \(t:item@0 "Item 0"\) expects "Item 0.png", which is not in .*11 rows/);
  });

  it('returns null before any import', async () => {
    expect(await loadNeiIndex(await mkdtemp(join(tmpdir(), 'gp-nei-')))).toBeNull();
  });
});
