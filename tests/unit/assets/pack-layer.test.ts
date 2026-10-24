import { describe, expect, it } from 'vitest';
import { layerPacks, type LayerInput } from '../../../src/server/assets/pack-layer.ts';

const B = 'a/textures/blocks/';
const input: LayerInput = {
  jarPngs: new Map([[B + 'stone.png', 0], [B + 'Fancy.png', 1], [B + 'anim.png', 1], [B + 'still.png', 1], [B + 'jaronly.png', 1], [B + 'jaranim.png', 1]]),
  jarHasMcmeta: (jar, png) => jar === 1 && (png === B + 'anim.png' || png === B + 'jaranim.png'),
  packs: [
    { format: 'folder', entries: new Set([B + 'fancy.png', B + 'still.png', B + 'still.png.mcmeta', B + 'p0only.png', B + 'stone.png.mcmeta', B + 'jaronly.png.mcmeta']) },
    { format: 'zip', entries: new Set([B + 'stone.png', B + 'fancy.png', B + 'still.png', B + 'New.png', B + 'Still.png.mcmeta']) },
    { format: 'folder', entries: new Set([B + 'new.png', B + 'anim.png', B + 'p0only.png.mcmeta']) },
  ],
};

describe('layering resource packs over the jars', () => {
  it('the last pack wins over every jar, and the jars keep their winner elsewhere', () => {
    const r = layerPacks(input);
    expect(Object.fromEntries(r.png)).toEqual({
      [B + 'stone.png']: { kind: 'pack', pack: 1, entry: B + 'stone.png' },
      [B + 'Fancy.png']: { kind: 'pack', pack: 0, entry: B + 'fancy.png' },   // folder: any case, under the jar's spelling
      [B + 'anim.png']: { kind: 'pack', pack: 2, entry: B + 'anim.png' },
      [B + 'still.png']: { kind: 'pack', pack: 1, entry: B + 'still.png' },
      [B + 'jaronly.png']: { kind: 'jar', jar: 1 },
      [B + 'jaranim.png']: { kind: 'jar', jar: 1 },
      [B + 'p0only.png']: { kind: 'pack', pack: 0, entry: B + 'p0only.png' },
      [B + 'New.png']: { kind: 'pack', pack: 2, entry: B + 'new.png' },      // no jar has it: the zip's spelling
    });
  });

  it('pairs an .mcmeta as the game does', () => {
    const r = layerPacks(input);
    expect(Object.fromEntries(r.mcmeta)).toEqual({
      [B + 'jaronly.png']: { kind: 'pack', pack: 0, entry: B + 'jaronly.png.mcmeta' },   // a pack's .mcmeta animates a jar PNG
      [B + 'jaranim.png']: { kind: 'jar', jar: 1 },
      [B + 'p0only.png']: { kind: 'pack', pack: 2, entry: B + 'p0only.png.mcmeta' },     // a higher pack's .mcmeta animates a lower pack's PNG
    });   // stone and still: the .mcmeta sits below the PNG's pack (the zip's Still.png.mcmeta differs in case: left out); anim: a pack PNG without one is still
  });

  it('case', () => {
    const r = layerPacks(input);
    expect(r.caseOnly).toEqual([{ pack: 1, entry: B + 'fancy.png' }, { pack: 1, entry: B + 'Still.png.mcmeta' }]);
    const lower = [...r.png.keys()].map((k) => k.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('no packs: the jars as before', () => {
    const r = layerPacks({ ...input, packs: [] });
    expect([...r.png.values()].every((f) => f.kind === 'jar')).toBe(true);
    expect([...r.mcmeta.keys()].sort()).toEqual([B + 'anim.png', B + 'jaranim.png']);
  });

  it('takes the highest .mcmeta at or above the PNG, a pack\'s own included', () => {
    const r = layerPacks({
      jarPngs: new Map([[B + 'x.png', 0], [B + 'y.png', 0]]),
      jarHasMcmeta: () => false,
      packs: [
        { format: 'folder', entries: new Set([B + 'x.png', B + 'x.png.mcmeta', B + 'y.png.mcmeta', B + 'z.png', B + 'z.png.mcmeta']) },
        { format: 'zip', entries: new Set([B + 'x.png', B + 'x.png.mcmeta', B + 'y.png']) },
        { format: 'folder', entries: new Set([B + 'x.png.mcmeta']) },
      ],
    });
    expect(Object.fromEntries(r.mcmeta)).toEqual({
      [B + 'x.png']: { kind: 'pack', pack: 2, entry: B + 'x.png.mcmeta' },   // the PNG is pack 1's: the highest of the three wins
      [B + 'z.png']: { kind: 'pack', pack: 0, entry: B + 'z.png.mcmeta' },   // the PNG's own pack
    });   // y: pack 0's .mcmeta is below the PNG's pack 1
    expect(r.caseOnly).toEqual([]);
  });

  it('a jar PNG takes a pack\'s .mcmeta before its own jar\'s', () => {
    const r = layerPacks({
      jarPngs: new Map([[B + 'x.png', 0], [B + 'y.png', 0]]),
      jarHasMcmeta: () => true,
      packs: [{ format: 'folder', entries: new Set([B + 'x.png.mcmeta']) }],
    });
    expect(Object.fromEntries(r.mcmeta)).toEqual({
      [B + 'x.png']: { kind: 'pack', pack: 0, entry: B + 'x.png.mcmeta' },
      [B + 'y.png']: { kind: 'jar', jar: 0 },
    });
  });

  it('a folder takes an .mcmeta in any case, a zip only the exact spelling', () => {
    const r = layerPacks({
      jarPngs: new Map([[B + 'Fancy.png', 0], [B + 'Plain.png', 0]]),
      jarHasMcmeta: () => false,
      packs: [
        { format: 'folder', entries: new Set([B + 'FANCY.png.mcmeta']) },
        { format: 'zip', entries: new Set([B + 'plain.png.mcmeta']) },
      ],
    });
    expect(Object.fromEntries(r.mcmeta)).toEqual({ [B + 'Fancy.png']: { kind: 'pack', pack: 0, entry: B + 'FANCY.png.mcmeta' } });
    expect(r.caseOnly).toEqual([{ pack: 1, entry: B + 'plain.png.mcmeta' }]);
  });

  it('with no jar to spell a path, the highest zip does, else the highest folder', () => {
    const r = layerPacks({
      jarPngs: new Map<string, number>(),
      jarHasMcmeta: () => false,
      packs: [
        { format: 'zip', entries: new Set([B + 'Zip.png']) },
        { format: 'folder', entries: new Set([B + 'fold.png']) },
        { format: 'zip', entries: new Set([B + 'zip.png']) },
        { format: 'folder', entries: new Set([B + 'FOLD.png']) },
      ],
    });
    expect(Object.fromEntries(r.png)).toEqual({
      [B + 'zip.png']: { kind: 'pack', pack: 2, entry: B + 'zip.png' },
      [B + 'FOLD.png']: { kind: 'pack', pack: 3, entry: B + 'FOLD.png' },
    });
    expect(r.caseOnly).toEqual([{ pack: 0, entry: B + 'Zip.png' }]);   // a folder's other spelling loses nothing
  });

  it('inside one pack, the first entry of a path takes it', () => {
    // a case-sensitive disk can hold both spellings in one folder pack; the Mac cannot
    const r = layerPacks({
      jarPngs: new Map([[B + 'a.png', 0]]),
      jarHasMcmeta: () => false,
      packs: [
        { format: 'folder', entries: new Set([B + 'A.png', B + 'a.png', B + 'b.png', B + 'B.png', B + 'A.png.mcmeta', B + 'a.png.mcmeta']) },
        { format: 'zip', entries: new Set([B + 'C.png', B + 'c.png']) },   // a zip: the first spelling stays, the other is left out
      ],
    });
    expect(Object.fromEntries(r.png)).toEqual({
      [B + 'a.png']: { kind: 'pack', pack: 0, entry: B + 'A.png' },
      [B + 'b.png']: { kind: 'pack', pack: 0, entry: B + 'b.png' },
      [B + 'C.png']: { kind: 'pack', pack: 1, entry: B + 'C.png' },
    });
    expect(Object.fromEntries(r.mcmeta)).toEqual({ [B + 'a.png']: { kind: 'pack', pack: 0, entry: B + 'A.png.mcmeta' } });
    expect(r.caseOnly).toEqual([{ pack: 1, entry: B + 'c.png' }]);
  });

  it('lists what it left out: PNGs before .mcmeta, the highest pack first, entries in order', () => {
    const r = layerPacks({
      jarPngs: new Map([[B + 'a.png', 0], [B + 'b.png', 0]]),
      jarHasMcmeta: () => false,
      packs: [
        { format: 'zip', entries: new Set([B + 'B.png', B + 'A.png', B + 'A.png.mcmeta']) },
        { format: 'zip', entries: new Set([B + 'B.png.mcmeta', B + 'A.png']) },
      ],
    });
    expect(r.caseOnly).toEqual([
      { pack: 1, entry: B + 'A.png' }, { pack: 0, entry: B + 'B.png' }, { pack: 0, entry: B + 'A.png' },
      { pack: 1, entry: B + 'B.png.mcmeta' }, { pack: 0, entry: B + 'A.png.mcmeta' },
    ]);
    expect([...r.png.values()]).toEqual([{ kind: 'jar', jar: 0 }, { kind: 'jar', jar: 0 }]);
    expect(r.mcmeta.size).toBe(0);
  });

  it('layers the chest model sheets too, and skips an .mcmeta whose PNG nobody holds', () => {
    const sheet = 'minecraft/textures/entity/chest/normal.png';
    const r = layerPacks({
      jarPngs: new Map([[sheet, 0]]),
      jarHasMcmeta: () => false,
      packs: [{ format: 'zip', entries: new Set([sheet, B + 'lost.png.mcmeta']) }],
    });
    expect(Object.fromEntries(r.png)).toEqual({ [sheet]: { kind: 'pack', pack: 0, entry: sheet } });
    expect(r.mcmeta.size).toBe(0);
    expect(r.caseOnly).toEqual([]);
  });
});
