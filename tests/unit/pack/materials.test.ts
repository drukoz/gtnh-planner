import { expect, it } from 'vitest';
import { makePack } from '../../helpers/make-pack.ts';
import { SAMPLE, sampleExportSpec } from '../../helpers/sample-export.ts';

it('loads GT materials and merges their ore data', async () => {
  const pack = await makePack(sampleExportSpec());
  expect(pack.materials.get('Iron')).toMatchObject({
    name: 'Iron', rgba: [200, 200, 200, 0], iconSet: 'METALLIC', oreByproducts: ['Nickel', 'Tin'],
    key: 'gt:Iron', family: 'gt', parts: { ore: SAMPLE.ironOre, dust: SAMPLE.ironDust, ingot: SAMPLE.ironIngot },
  });
});

it('adds BartWorks and GT++ ore materials and prefixes names that collide', async () => {
  const spec = sampleExportSpec();
  spec.oreMaterials!.push({ key: 'gtpp:Iron', family: 'gtpp', name: 'Iron', byproducts: ['gt:Unobtainium'], parts: {} });
  const pack = await makePack(spec);
  expect(pack.materials.get('Prasiolite')).toMatchObject({ family: 'bw', key: 'bw:Prasiolite', rgba: [156, 177, 94, 0], iconSet: 'GEM_VERTICAL' });
  expect(pack.materials.get('gtpp:Iron')).toMatchObject({ family: 'gtpp', key: 'gtpp:Iron', oreByproducts: ['Unobtainium'] });
  expect(pack.warnings!.some((w) => w.includes('gt:Unobtainium'))).toBe(true);
});

it('creates a GT ore material the GT list lacks, keeps the first line of a duplicate key and rejects an unknown part index', async () => {
  const spec = sampleExportSpec();
  spec.oreMaterials!.push(
    { key: 'gt:Copper', family: 'gt', name: 'Copper', byproducts: ['gt:Iron', 'bw:Prasiolite'], parts: { dust: 3 } },
    { key: 'gt:Copper', family: 'gt', name: 'Copper', byproducts: [], parts: {} },
  );
  const pack = await makePack(spec);
  expect(pack.materials.get('Copper')).toEqual({
    name: 'Copper', rgba: [255, 255, 255, 0], iconSet: 'NONE', oreByproducts: ['Iron', 'Prasiolite'],
    key: 'gt:Copper', family: 'gt', displayName: 'Copper', parts: { dust: SAMPLE.nickelDust },
  });
  expect(pack.warnings).toEqual(['ore-materials.jsonl.gz:5: duplicate ore material gt:Copper ignored, the first line wins']);
  spec.oreMaterials!.push({ key: 'gt:Tin', family: 'gt', name: 'Tin', byproducts: [], parts: { ore: 99 } });
  await expect(makePack(spec)).rejects.toMatchObject({ name: 'ExportFormatError', file: 'ore-materials.jsonl.gz', line: 6 });
});
