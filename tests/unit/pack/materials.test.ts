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

it('joins a BartWorks or GT++ ore line to the GT material of its name when it is the same material, and prefixes only a different one', async () => {
  const spec = sampleExportSpec();
  spec.items!.push(
    { id: 'bartworks:bw.blockores.01', m: 18, dn: 'Thorianite Ore', gtPrefix: 'ore', gtMat: 'Thorianite' }, // 25
    { id: 'bartworks:gt.bwMetaGenerateddust', m: 18, dn: 'Thorianite Dust', gtPrefix: 'dust', gtMat: 'Thorianite' }, // 26
    { id: 'bartworks:gt.bwMetaGeneratedgem', m: 18, dn: 'Thorianite Gem' }, // 27: no GT association
    { id: 'bartworks:gt.bwMetaGenerateddust', m: 32, dn: 'Iron Dust (BW)', gtPrefix: 'dust', gtMat: 'Iron' }, // 28
    { id: 'miscutils:itemDustZircon', m: 0, dn: 'Zircon Dust' }, // 29: GT++ parts have no GT association
  );
  // BartWorks' GT bridge material: same name, no ore data of its own
  spec.materials!.push(
    { name: 'Thorianite', rgba: [48, 48, 48, 0], iconSet: 'METALLIC', byproducts: ['Thorium', 'Thorianite'] },
    { name: 'Zircon', rgba: [1, 2, 3, 0], iconSet: 'DULL', byproducts: [] },
  );
  // first-use order as the exporter writes it: bw/gtpp lines before the gt line of Iron
  spec.oreMaterials!.unshift(
    { key: 'bw:Thorianite', family: 'bw', name: 'Thorianite', id: 18, byproducts: ['gt:Thorium', 'bw:Thorianite', 'gt:Iron'], parts: { ore: 25, dust: 26, gem: 27 } },
    { key: 'bw:Iron', family: 'bw', name: 'Iron', id: 32, byproducts: ['gt:Nickel'], parts: { dust: 28 } },
    { key: 'gtpp:Iron', family: 'gtpp', name: 'Iron', byproducts: [], parts: {} },
    { key: 'gtpp:Zircon', family: 'gtpp', name: 'Zircon', byproducts: ['gt:Iron'], parts: { dust: 29 } },
  );
  spec.oreVeins!.push({
    name: 'ore.mix.thorianite', weight: 10, density: 2, size: 16, dims: ['moon'], yByDim: { moon: [10, 60] },
    primary: 'bw:Thorianite', secondary: 'bw:Iron', between: 'gtpp:Zircon', sporadic: 'gtpp:Iron', stoneSpecific: false,
  });
  const pack = await makePack(spec);
  expect([...pack.materials.keys()].filter((name) => name.includes(':'))).toEqual(['gtpp:Iron']);
  expect(pack.materials.get('Thorianite')).toMatchObject({
    key: 'bw:Thorianite', family: 'bw', iconSet: 'METALLIC', oreByproducts: ['Thorium', 'Thorianite', 'Iron'],
    parts: { ore: 'bartworks:bw.blockores.01@18', dust: 'bartworks:gt.bwMetaGenerateddust@18', gem: 'bartworks:gt.bwMetaGeneratedgem@18' },
  });
  // the GT line keeps Iron's key and parts although it comes later in the file; bw:Iron's dust says Iron, so it joins
  expect(pack.materials.get('Iron')).toMatchObject({ key: 'gt:Iron', family: 'gt', parts: { ore: SAMPLE.ironOre, dust: SAMPLE.ironDust, ingot: SAMPLE.ironIngot }, oreByproducts: ['Nickel', 'Tin'] });
  expect(pack.materials.get('Zircon')).toMatchObject({ key: 'gtpp:Zircon', family: 'gtpp', parts: { dust: 'miscutils:itemDustZircon@0' }, oreByproducts: ['Iron'] });
  expect(pack.materials.get('gtpp:Iron')).toMatchObject({ key: 'gtpp:Iron', family: 'gtpp' });
  const vein = pack.worldgen.veins.find((v) => v.name === 'ore.mix.thorianite')!;
  expect(vein.materials).toEqual({ primary: 'Thorianite', secondary: 'Iron', between: 'Zircon', sporadic: 'gtpp:Iron' });
  expect(pack.items.get('bartworks:gt.bwMetaGenerateddust@18')!.gt!.material).toBe(vein.materials.primary);
  expect(pack.worldgen.byproducts.Thorianite).toEqual(['Thorium', 'Thorianite', 'Iron']);
});
