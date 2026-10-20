import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateExport } from '../../../src/server/export/validate.ts';
import { makeExport, type ExportSpec } from '../../helpers/make-export.ts';
import { SAMPLE, sampleExportSpec, sampleInlineCrop } from '../../helpers/sample-export.ts';

const exportOf = async (spec: ExportSpec) => makeExport(join(await mkdtemp(join(tmpdir(), 'gp-val-')), 'x'), spec);
const codes = (r: { issues: Array<{ level: string; code: string }> }, level: string) => r.issues.filter((i) => i.level === level).map((i) => i.code);

describe('validateExport', () => {
  it('accepts a complete export and lists warnings', async () => {
    const r = await validateExport(await exportOf({ ...sampleExportSpec(), fillerMaps: 140 }));
    expect(r.ok).toBe(true);
    expect(codes(r, 'error')).toEqual([]);
    expect(codes(r, 'warn')).toEqual(expect.arrayContaining(['vein-count', 'name-failures']));
    expect(codes(r, 'warn')).not.toContain('missing-names');
    expect(r.summary).toMatch(/^items 24 · fluids 11 · recipes \d+ · maps 154 · machines 8 · structures 1 · veins 3 · dimensions \d+$/);
  });

  it('rejects a missing marker, EXPORT_FAILED, too few maps, no GT recipes and a damaged file', async () => {
    expect(codes(await validateExport(await exportOf({ ...sampleExportSpec(), fillerMaps: 140, marker: null })), 'error')).toContain('no-marker');
    expect(codes(await validateExport(await exportOf({ ...sampleExportSpec(), fillerMaps: 140, marker: 'EXPORT_FAILED' })), 'error')).toContain('export-failed');
    expect(codes(await validateExport(await exportOf(sampleExportSpec())), 'error')).toContain('few-maps');
    expect(codes(await validateExport(await exportOf({ ...sampleExportSpec(), fillerMaps: 140, recipesGt: [] })), 'error')).toContain('no-gt-recipes');
    const damaged = await validateExport(await exportOf({ ...sampleExportSpec(), fillerMaps: 140, rawLines: { fluids: ['{oops'] } }));
    expect(damaged.issues).toContainEqual(expect.objectContaining({ level: 'error', code: 'load-failed', text: expect.stringContaining('fluids.jsonl.gz') }));
  });

  it('warns about missing spot names, cleanroom and programmed-circuit recipes', async () => {
    const spec = { ...sampleExportSpec(), fillerMaps: 140 };
    spec.items = spec.items!.map((i) => (i.dn === 'Iron Dust' ? { ...i, dn: 'Eisenstaub' } : i));
    spec.recipesGt = spec.recipesGt!.map(({ meta, ...r }) => ({ ...r, in: r.in.filter((s) => s === null || s[0] !== 5) }));
    const warns = codes(await validateExport(await exportOf(spec)), 'warn');
    expect(warns).toEqual(expect.arrayContaining(['missing-names', 'no-cleanroom', 'no-circuit']));
  });

  it('counts the items of the item table, not the crop items, in its summary and in the share of name failures', async () => {
    // 75 more items make 99 in the item table, of which the sample's one name failure is more than 1 %; with the three
    // crop items of the crop table it would be one of 102, less than 1 %
    const spec = { ...sampleExportSpec(), fillerMaps: 140, crops: [sampleInlineCrop()] };
    spec.items = [...spec.items!, ...Array.from({ length: 75 }, (_, m) => ({ id: 'examplemod:filler', m, dn: `Filler ${m}` }))];
    const r = await validateExport(await exportOf(spec));
    expect(r.pack!.items.size).toBe(102);
    expect(r.summary).toMatch(/^items 99 · /);
    expect(r.issues).toContainEqual({
      level: 'warn', code: 'name-failures', text: '1 of 99 items have no English name (more than 1 %), e.g. examplemod:broken@0',
    });
  });

  it('names the structures with hatch rules in the summary', async () => {
    const spec = { ...sampleExportSpec(), fillerMaps: 140 };
    spec.structures = spec.structures!.map((s) => (s.id === SAMPLE.ebf ? { ...s, elements: [{ ch: 'b', hatches: ['input_bus'] }], elementOf: [0, -1, 0] } : s));
    const r = await validateExport(await exportOf(spec));
    expect(r.summary).toContain('structures 1 (1 with hatch rules) · veins 3');
  });
});
