// Real-data check of Plan 16's textures (architecture §11.43), view by view: the pack's icons, two re-planned plan
// pages, the Map's storage list and palette, the blocks of their two layouts, the user's reports, the file-name rule's
// precision, block items, the chest sheets and both exporter versions' fields. It runs only with GTNH_LOCAL=1 and a
// GTNH_PLANNER_CONFIG whose data folder links to the real export, assets and scans; GTNH_EXPORT_ID checks an export
// other than the config's active one. Everything is read-only: the newest done scan's files are read directly (opening
// the world service would mark unfinished scans interrupted), and the chest sheets are extracted into a temporary
// folder that is removed afterwards. It prints counts, keys and texture paths only, each view as `before → after`:
// before is main's code on export 2.9.0-RC-1_20261019-010938 and scan 20261019T043524Z-8fe022 (plan Task 8).

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { summarize } from '../../../src/client/map/summary.ts';
import { blockKey, frontOf } from '../../../src/client/three/scene-data.ts';
import { curatedBlock, curatedPaths } from '../../../src/server/assets/curated.ts';
import { extractAssets } from '../../../src/server/assets/extract.ts';
import { gtItemIcon, gtOreFaces } from '../../../src/server/assets/gt-faces.ts';
import { iconPath, loadAssetIndex, type AssetIndex } from '../../../src/server/assets/index.ts';
import { facesByName, fileByName, modDomains, nameIndex } from '../../../src/server/assets/names.ts';
import { loadNeiIndex } from '../../../src/server/assets/nei.ts';
import { resolveBlocks, resolveIcons, type AssetSources } from '../../../src/server/assets/resolve.ts';
import { derivedUnconnected, loadTexturesDump, TEXTURES_FILE, type TexturesDump, type TexturesDumpFile } from '../../../src/server/assets/textures-dump.ts';
import { clientJarOf, findClientJar, listModJars } from '../../../src/server/cli/extract-assets.ts';
import { exportDirFor, loadConfig, type AppConfig } from '../../../src/server/config.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { planLine } from '../../../src/server/planner/plan.ts';
import { createBlockReader, readAreaVoxels, regionStoreFromDir, type AreaInput } from '../../../src/server/world/area.ts';
import { contextFromScan } from '../../../src/server/world/context.ts';
import { posKey } from '../../../src/server/world/model.ts';
import { parseItemKey, type ItemKey, type StuffKey } from '../../../src/shared/keys.ts';
import { defaultSettings } from '../../../src/shared/project/apply-op.ts';
import type { BlockFaces, TextureLayer } from '../../../src/shared/types/assets.ts';
import type { BlockRole, Layout, LayoutBlock } from '../../../src/shared/types/layout.ts';
import type { BlockRef, Pack } from '../../../src/shared/types/pack.ts';
import type { LogisticsMode, Plan } from '../../../src/shared/types/plan.ts';
import type { Base, BBox, Voxels, WorldScan } from '../../../src/shared/types/world.ts';
import { makeProject } from '../../helpers/layout-fixtures.ts';

/** The two live projects' targets and modes, re-planned with `defaultSettings()`. */
const TARGETS: ReadonlyArray<readonly [StuffKey, LogisticsMode]> = [['IC2:itemPartCircuit@0', 'routed'], ['fluid:ethylene', 'direct']];
/** The Electronic Circuit page's icons no rule of this plan draws: IC2 meta items and GT++ Tumbaga parts (plan, Later). */
const CIRCUIT_LEFT = ['IC2:itemDust@13', 'IC2:itemDust@2', 'IC2:itemPlates@0', 'miscutils:blockFrameGtTumbaga@0',
  'miscutils:itemPlateTumbaga@0', 'miscutils:itemRingTumbaga@0', 'miscutils:itemRodTumbaga@0', 'miscutils:itemRotorTumbaga@0'];
// Reviewed: none. The plan's 11 block items whose registry name names their item icon in items/ (vanilla's
// items/hopper.png, etfuturum's modern lanterns, chain, brewing stand, ...) are all block ids, which never take an
// items/ file by name (architecture §11.43 (a)), so they keep their block face like every other block item.
const ITEM_NAME_OVER_BLOCK: string[] = [];

const GT_MACHINES = 'gregtech:gt.blockmachines';   // its item meta is the MTE id
/** A scan folder's name, as the world service makes it. */
const SCAN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;
/** Plan names that are recipe maps and dimensions: text on the page, no icon. */
const PAGE_TEXT = /^(map|dim|dimId):/;
/** GT's insulation rings, all six sizes (MEDIUM_PLUS is every 8x cable): an insulated cable's connected side. */
const INSULATION_RING = /\/INSULATION_(TINY|SMALL|MEDIUM|MEDIUM_PLUS|LARGE|HUGE)\.png$/;
/** A pipe's connected-side template file, the base of its texture set. */
const PIPE_TEMPLATE = /\/pipe(Tiny|Small|Medium|Large|Huge|Quadruple|Nonuple)?\.png$/;
/** ProjectRed and AE2 parts (Task 9 draws them from crops of their model sheets). */
const RC5_BLOCK = /^(fmp:|ae2cable:|ForgeMultipart:block$)/;
/** The roles drawn as a core with arms. */
const PIPE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['cable', 'pipe', 'chip_pipe']);
/** The chests' model sheets the extractor copies (architecture §11.43 (e)). */
const CHEST_SHEET_PATH = /^(minecraft\/textures\/entity\/chest|ironchest\/textures\/model)\//;
const CRACKED = /^(lightly|moderately|severely)(steam|hydro)cracked\./;

const fmt = (n: number): string => n.toLocaleString('en-US');

/** `n of m, p %`. */
function share(n: number, of: number): string {
  return `${fmt(n)} of ${fmt(of)}, ${of === 0 ? '-' : ((100 * n) / of).toFixed(2)} %`;
}

/** Prints one view: its title, then each line indented. */
function show(view: string, lines: readonly string[]): void {
  console.log([`real coverage: ${view}`, ...lines.map((line) => `  ${line}`)].join('\n'));
}

/** ` a b c` for a printout line, nothing for no keys. */
function listed(keys: readonly string[]): string {
  return keys.length === 0 ? '' : ` ${keys.join(' ')}`;
}

function isNbtKey(key: ItemKey): boolean {
  try {
    return parseItemKey(key).nbtHash !== undefined;
  } catch {
    return false;
  }
}

/** The mod and registry name of a registry id, as the resolver splits it; null without either. */
function splitId(id: string): { mod: string; name: string } | null {
  const colon = id.indexOf(':');
  return colon <= 0 || colon === id.length - 1 ? null : { mod: id.slice(0, colon), name: id.slice(colon + 1) };
}

/** The keys whose icon falls back, in `keys` order. */
function fallbacks(src: AssetSources, keys: readonly StuffKey[]): StuffKey[] {
  return resolveIcons(src, keys).filter((icon) => icon.source === 'fallback').map((icon) => icon.key);
}

/** The block an item key places (a GT machine item: its MTE). */
function blockRefOf(id: string, meta: number): BlockRef {
  return id === GT_MACHINES ? { id, meta, mteId: meta } : { id, meta };
}

describe.skipIf(process.env.GTNH_LOCAL !== '1')('real coverage', { timeout: 300_000 }, () => {
  let config: AppConfig;
  let index: AssetIndex;
  let dump: TexturesDump;
  let raw: TexturesDumpFile;
  let pack: Pack;
  let src: AssetSources;
  let srcNoNei: AssetSources;
  let scan: WorldScan;
  let palette: BlockRef[];
  let base: Base;
  let plainKeys: ItemKey[];
  const plans = new Map<StuffKey, Plan>();
  /** Per target its layout and the canonical faces of each of its distinct blocks, by `blockKey`. */
  const layouts = new Map<StuffKey, { layout: Layout; faces: Map<string, BlockFaces> }>();

  beforeAll(async () => {
    config = loadConfig();
    const exportId = process.env.GTNH_EXPORT_ID || config.activeExportId;
    expect(exportId, "GTNH_EXPORT_ID or the config's activeExportId").toBeTruthy();
    const exportDir = exportDirFor(config, exportId!);
    const assetsDir = join(config.dataDir, 'assets');
    index = await loadAssetIndex(assetsDir);
    const loaded = await loadTexturesDump(exportDir, index);
    expect(loaded, `the texture dump of ${exportId}`).not.toBeNull();
    dump = loaded!;
    raw = JSON.parse(gunzipSync(await readFile(join(exportDir, TEXTURES_FILE))).toString('utf8')) as TexturesDumpFile;
    pack = await loadPack(exportDir);
    const nei = await loadNeiIndex(assetsDir);
    expect(nei, 'the NEI icon import').not.toBeNull();
    src = { index, dump, nei, pack };
    srcNoNei = { ...src, nei: null };
    plainKeys = [...pack.items.keys()].filter((key) => !isNbtKey(key));

    const scansDir = join(config.dataDir, 'scans');
    let scanId: string | undefined;
    for (const id of (await readdir(scansDir)).filter((name) => SCAN_ID.test(name)).sort().reverse()) {   // newest first
      const status = JSON.parse(await readFile(join(scansDir, id, 'status.json'), 'utf8').catch(() => '{}')) as { state?: unknown };
      if (status.state === 'done') {
        scanId = id;
        break;
      }
    }
    expect(scanId, `a done scan in ${scansDir}`).toBeDefined();
    const scanDir = join(scansDir, scanId!);
    scan = JSON.parse(await readFile(join(scanDir, 'scan.json'), 'utf8')) as WorldScan;
    palette = JSON.parse(await readFile(join(scanDir, 'palette.json'), 'utf8')) as BlockRef[];
    const meta = JSON.parse(await readFile(join(scanDir, 'meta.json'), 'utf8')) as { blockNames?: Array<[number, string]> };
    expect(scan.bases.length, 'bases in the newest done scan').toBeGreaterThan(0);
    base = scan.bases[0]!;
    const mteIds = new Map<string, number>();
    for (const r of [...scan.machines, ...scan.pipes]) mteIds.set(posKey(r.dim, ...r.pos), r.mteId);
    const area: AreaInput = {
      reader: createBlockReader(regionStoreFromDir(join(scanDir, 'regions'))), blockNames: new Map(meta.blockNames ?? []),
      mteAt: (d, x, y, z) => mteIds.get(posKey(d, x, y, z)),
    };
    const readArea = (dim: number, bbox: BBox): Promise<Voxels> => readAreaVoxels(area, dim, bbox);

    const lines: string[] = [];
    for (const [target, logistics] of TARGETS) {
      const settings = { ...defaultSettings(), target, logistics };
      const plan = await planLine(pack, settings, contextFromScan(scan, pack, base.id, logistics));
      expect(plan.status ?? 'ok', `${target}: ${plan.warnings.map((w) => w.code).join(' ')}`).toBe('ok');
      const project = { ...makeProject({ logistics, scanId: scan.id, baseId: base.id }), settings };
      const layout = await layoutLine(pack, plan, scan, project, { readArea });
      const refs = new Map<string, BlockRef>();
      for (const b of layout.blocks) refs.set(blockKey(b.block), b.block);
      const resolved = resolveBlocks(src, [...refs.values()]);
      plans.set(target, plan);
      layouts.set(target, { layout, faces: new Map([...refs.keys()].map((key, i) => [key, resolved[i]!])) });
      lines.push(`${target} ${logistics}: ${plan.steps.length} steps; layout ${layout.status}, ${fmt(layout.blocks.length)} blocks, ${fmt(refs.size)} distinct`);
    }
    show(`export ${exportId} (exporter ${dump.exporterVersion}), scan ${scan.id}, base ${base.id}`, [
      `${fmt(index.size)} extracted files, ${fmt(nei!.size)} NEI icons; ${fmt(pack.items.size)} items (${fmt(plainKeys.length)} without NBT), ${fmt(pack.fluids.size)} fluids`,
      ...lines,
    ]);
  }, 300_000);

  /** A plan page's icons: the plan's names minus recipe maps and dimensions. */
  const pageKeys = (target: StuffKey): StuffKey[] => Object.keys(plans.get(target)!.names ?? {}).filter((key) => !PAGE_TEXT.test(key));
  const pageFallbacks = (target: StuffKey, s: AssetSources): StuffKey[] => fallbacks(s, pageKeys(target));

  const blocksOf = (target: StuffKey): LayoutBlock[] => layouts.get(target)!.layout.blocks;
  /** A layout block's canonical faces (front on north). */
  function facesOf(b: LayoutBlock): BlockFaces {
    const key = blockKey(b.block);
    for (const { faces } of layouts.values()) {
      const found = faces.get(key);
      if (found !== undefined) return found;
    }
    throw new Error(`no faces resolved for ${key}`);
  }
  const unresolvedBlocks = (target: StuffKey): number => blocksOf(target).filter((b) => !facesOf(b).resolved).length;
  const isPipeMte = (b: LayoutBlock): boolean => b.block.mteId !== undefined && dump.mte.get(b.block.mteId)?.pipe === true;
  /** A GT pipe or insulated cable: a `pipe` MTE whose canonical north face is its connected side. */
  const isGtPipe = (b: LayoutBlock): boolean =>
    isPipeMte(b) && facesOf(b).faces.north.some((l) => INSULATION_RING.test(l.path) || PIPE_TEMPLATE.test(l.path));
  /** The layout's GT pipes and insulated cables, ghosts included. */
  const gtPipes = (target: StuffKey): LayoutBlock[] => blocksOf(target).filter(isGtPipe);
  /** The layout's other `pipe` MTE blocks (bare wires, frames). */
  const otherPipeMtes = (target: StuffKey): LayoutBlock[] => blocksOf(target).filter((b) => isPipeMte(b) && !isGtPipe(b));
  /** The blocks whose faces carry `pipe` layers (architecture §11.43 (c)). */
  const withPipe = (blocks: LayoutBlock[]): LayoutBlock[] => blocks.filter((b) => facesOf(b).pipe !== undefined);
  const rc5 = (target: StuffKey): LayoutBlock[] => blocksOf(target).filter((b) => RC5_BLOCK.test(b.block.id));
  /** Blocks other than cables and pipes whose front faces up or down. */
  const vertical = (target: StuffKey): LayoutBlock[] =>
    blocksOf(target).filter((b) => !PIPE_ROLES.has(b.role) && (frontOf(b) === 0 || frontOf(b) === 1));

  it('pack-wide icons', () => {
    const nbtKeys = [...pack.items.keys()].filter(isNbtKey);
    const fluidKeys = [...pack.fluids.keys()];
    const nbtIcons = resolveIcons(src, nbtKeys);
    const c = {
      plainNoNei: fallbacks(srcNoNei, plainKeys).length, plainNei: fallbacks(src, plainKeys).length,
      nbt: nbtIcons.filter((icon) => icon.source === 'fallback').length,
      fluidsNoNei: fallbacks(srcNoNei, fluidKeys), fluidsNei: fallbacks(src, fluidKeys),
    };
    const nbtSources = new Map<string, number>();
    for (const icon of nbtIcons) if (icon.source !== 'fallback') nbtSources.set(icon.source, (nbtSources.get(icon.source) ?? 0) + 1);
    show('pack-wide icons falling back (no NEI / NEI)', [
      `items without NBT (${fmt(plainKeys.length)}): 22,501 / 14,158 → ${fmt(c.plainNoNei)} / ${fmt(c.plainNei)} (bounds 16,300 / 10,200)`,
      `NBT variants (${fmt(nbtKeys.length)}), NEI: 51,624 → ${fmt(c.nbt)} (with an icon: ${[...nbtSources].map(([s, n]) => `${s} ${fmt(n)}`).join(', ')})`,
      `fluids (${fmt(fluidKeys.length)}): 478 / 477 → ${fmt(c.fluidsNoNei.length)} / ${fmt(c.fluidsNei.length)}${listed(c.fluidsNoNei)}`,
    ]);
    // An NBT variant shows the icon of its id and meta, as the resolver always drew it (1,210 had GT's or their texture
    // name's before this plan); Task 2's item rules give 127 more theirs (Adventure Backpacks, Volumetric Flasks,
    // Twilight Forest gear, Botania mana rings, ...). Icons composed from NBT are RC11, later.
    expect([c.nbt, c.fluidsNei.length, c.fluidsNoNei.length]).toEqual([51_497, 0, 0]);
    expect(c.plainNei).toBeLessThanOrEqual(10_200);
    expect(c.plainNoNei).toBeLessThanOrEqual(16_300);
  });

  it('plan pages', () => {
    const before: Record<StuffKey, string> = { 'IC2:itemPartCircuit@0': '46 / 27', 'fluid:ethylene': '30 / 19' };
    show('plan page icons falling back (no NEI / NEI)', TARGETS.map(([target, logistics]) => {
      const left = pageFallbacks(target, src);
      return `${target} ${logistics} (${fmt(pageKeys(target).length)} icons): ${before[target]} → `
        + `${fmt(pageFallbacks(target, srcNoNei).length)} / ${fmt(left.length)}${listed(left)}`;
    }));
    expect(pageFallbacks('IC2:itemPartCircuit@0', src).filter((k) => !CIRCUIT_LEFT.includes(k))).toEqual([]);
    expect(pageFallbacks('fluid:ethylene', src)).toEqual([]);
  });

  it('Map storage list and palette', () => {
    const storage = summarize(scan, base.id).storage.items.map((i) => i.key);
    const left = fallbacks(src, storage);
    const noUp = resolveBlocks(src, palette).filter((f) => f.faces.up.length === 0);
    show('Map storage list and palette', [
      `storage list icons falling back (${fmt(storage.length)} keys), no NEI / NEI: 533 / 215 → ${fmt(fallbacks(srcNoNei, storage).length)} / ${fmt(left.length)} `
        + `(bound 150)${listed([...left].sort())}`,
      `palette entries without a top face (${fmt(palette.length)}): 465 → ${fmt(noUp.length)} (bound 260)${listed(noUp.map((f) => blockKey(f.block)).sort())}`,
    ]);
    expect(left.length).toBeLessThanOrEqual(150);
    expect(noUp.length).toBeLessThanOrEqual(260);
  });

  it('3D blocks, server side', () => {
    const before: Record<StuffKey, string> = {
      'IC2:itemPartCircuit@0': '637 blocks: unresolved 4, GT pipes and insulated cables with pipe 0 of 427, other pipe MTEs 0; RC5 39, vertical 18',
      'fluid:ethylene': '909 blocks: unresolved 0, GT pipes and insulated cables with pipe 0 of 602, other pipe MTEs 0; RC5 0, vertical 37',
    };
    show('layout blocks (vertical facings printed only: Task 10)', TARGETS.flatMap(([target, logistics]) => {
      const unresolved = blocksOf(target).filter((b) => !facesOf(b).resolved).map((b) => blockKey(b.block));
      const pipes = gtPipes(target);
      return [
        `${target} ${logistics}: ${before[target]}`,
        `  → ${fmt(blocksOf(target).length)} blocks: unresolved ${fmt(unresolved.length)}, GT pipes and insulated cables with pipe `
          + `${fmt(withPipe(pipes).length)} of ${fmt(pipes.length)} (ghosts ${pipes.filter((b) => b.role === 'ghost').length}), `
          + `other pipe MTEs ${fmt(otherPipeMtes(target).length)}; RC5 ${fmt(rc5(target).length)} (with pipe ${withPipe(rc5(target)).length}), `
          + `vertical ${fmt(vertical(target).length)}${listed([...new Set(unresolved)].sort())}`,
      ];
    }));
    expect(TARGETS.map(([t]) => unresolvedBlocks(t))).toEqual([0, 0]);
    expect(TARGETS.map(([t]) => withPipe(gtPipes(t)).length)).toEqual(TARGETS.map(([t]) => gtPipes(t).length));
    expect(TARGETS.map(([t]) => withPipe(otherPipeMtes(t)).length)).toEqual([0, 0]);
    expect(gtPipes('fluid:ethylene').length).toBeGreaterThan(0);
    // rc5(t): the ProjectRed pipes, AE2 cables and ForgeMultipart ghosts, each drawn from its model sheet's crops (39 and 0 at 340dad8)
    expect(TARGETS.map(([t]) => withPipe(rc5(t)).length)).toEqual(TARGETS.map(([t]) => rc5(t).length));
    expect(rc5('IC2:itemPartCircuit@0').length).toBeGreaterThan(0);
  });

  it("the user's reports and the named rules", () => {
    const jar = (k: string) => resolveIcons(srcNoNei, [k])[0]!;
    expect(resolveIcons(src, ['IC2:itemPartCircuit@0'])[0]!.source).toBe('nei');                    // the Electronic Circuit, scaled evenly (Task 1)
    expect(jar('IC2:itemPartCircuit@0').layers).toEqual([{ path: 'ic2/textures/items/itemPartCircuit.png' }]);
    expect(jar('gregtech:gt.integrated_circuit@7').layers).toEqual([{ path: 'gregtech/textures/items/gt.integrated_circuit/7.png' }]);
    expect(jar('cropsnh:cropSticks@0').layers).toEqual([{ path: 'cropsnh/textures/blocks/cropSticks.png' }]);   // a block id: its block face
    expect(jar('ProjRed|Core:projectred.core.part@20').layers).toEqual([{ path: 'projectred/textures/items/base/illumar1.png' }]);
    expect(jar('ProjRed|Transportation:projectred.transportation.pipe@1').layers)
      .toEqual([{ path: 'projectred/textures/blocks/mechanical/pipes/routedjunc.png', region: { sheet: 16, src: [4, 0, 8, 8] } }]);
    expect(jar('gregtech:gt.metaitem.99@39').source).toBe('gt');                                    // Molten Arsenic Cell
    expect(['fluid:water', 'fluid:steam', 'fluid:ic2steam', 'fluid:glue'].map((k) => jar(k).source)).not.toContain('fallback');
    const [frame, cray, sticks] = resolveBlocks(src, [{ id: 'gregtech:gt.blockframes', meta: 305 }, { id: 'Ztones:tile.crayBlock', meta: 5 }, { id: 'cropsnh:cropSticks', meta: 0 }]);
    expect(frame!.resolved).toBe(true);                                                              // Steel Frame Box
    expect(cray!.faces.up).toEqual([{ path: 'ztones/textures/blocks/sets/cray/cray_ (5).png' }]);   // the floor under the line
    expect(sticks!.faces.up).toEqual([{ path: 'cropsnh/textures/blocks/cropSticks.png' }]);         // the crop field: a palette block without a texture name
  });

  it('the name rule on ids whose texture name is known', () => {
    // Each rule where it runs: the item rule on item texture names of ids that are not block ids, the block rule on
    // block texture names; the texture name itself is never consulted, only the domains the dump's names use.
    const names = nameIndex(index);
    const hidden = { same: 0, different: 0, none: 0 };
    const different: string[] = [];
    const tally = (what: string, truth: string, found: string | null): void => {
      if (found === null) hidden.none++;
      else if (found === truth) hidden.same++;
      else {
        hidden.different++;
        different.push(`${what}: ${found} (true: ${truth})`);
      }
    };
    let known = 0;
    let blockIdItems = 0;
    let blockIdItemsKnown = 0;
    for (const [id, name] of dump.textureNames.items) {
      const truth = iconPath(name, 'items');
      const parts = splitId(id);
      if (dump.blockIds.has(id)) blockIdItems++;
      if (parts === null || !index.has(truth)) continue;
      known++;
      if (dump.blockIds.has(id)) {
        blockIdItemsKnown++;
        continue;
      }
      tally(`item ${id}`, truth, fileByName(names, modDomains(dump, parts.mod), parts.name, 0, 'items', 'north'));
    }
    for (const [id, name] of dump.textureNames.blocks) {
      const truth = iconPath(name, 'blocks');
      const parts = splitId(id);
      if (parts === null || !index.has(truth)) continue;
      known++;
      tally(`block ${id}`, truth, facesByName(names, modDomains(dump, parts.mod), parts.name, 0)?.north ?? null);
    }
    const found = hidden.same + hidden.different;
    show('the name rule with the texture name hidden', [
      `ids whose texture name's file is extracted: ${fmt(known)} (plan: 3,777); left out: ${blockIdItems} item texture names on block ids `
        + `(${blockIdItemsKnown} with an extracted file), which never take an items/ file by name`,
      `same file ${fmt(hidden.same)}, different ${fmt(hidden.different)}, none ${fmt(hidden.none)}; `
        + `prototype: 15 of 2,112, 0.71 % → ${share(hidden.different, found)} (bound 1 %)`,
      ...different.sort(),
    ]);
    expect(hidden.different / found).toBeLessThanOrEqual(0.01);
  });

  it('items the block step drew keep its layer', () => {
    // blockStep: the block items that, without NEI, draw their block face from a block step older than this plan — the
    // dump's MTE or block row, a GT ore block, the curated table (this plan's rows included) or the file of their exact
    // block texture name — and have no GT meta item icon and no extracted file of their exact item texture name.
    const noCopy = (): TextureLayer[] => [];
    const olderBlockStep = (id: string, meta: number): boolean => {
      if (id === GT_MACHINES) {
        const mte = dump.mte.get(meta);
        return mte !== undefined && mte.error === undefined && mte.inactive !== null;
      }
      if (dump.blocks.get(id)?.get(meta)?.some((list) => list.length > 0) === true) return true;
      if (gtOreFaces(dump, index, id, meta, noCopy) !== null || curatedBlock(id, meta) !== null) return true;
      const name = dump.textureNames.blocks.get(id);
      return name !== undefined && index.has(iconPath(name, 'blocks'));
    };
    const candidates = plainKeys.filter((key) => {
      const { id, meta } = parseItemKey(key);
      if (!dump.blockIds.has(id) || gtItemIcon(dump, index, key) !== null) return false;
      const itemName = dump.textureNames.items.get(id);
      return (itemName === undefined || !index.has(iconPath(itemName, 'items'))) && olderBlockStep(id, meta);
    });
    const blockFaces = resolveBlocks(srcNoNei, candidates.map((key) => {
      const { id, meta } = parseItemKey(key);
      return blockRefOf(id, meta);
    }));
    const blockStep: Array<{ key: ItemKey; face: TextureLayer }> = [];
    candidates.forEach((key, i) => {
      const { faces } = blockFaces[i]!;
      const face = faces.north[0] ?? faces.up[0];
      if (face !== undefined) blockStep.push({ key, face });
    });
    const icons = resolveIcons(srcNoNei, blockStep.map((b) => b.key));
    const changed = blockStep.flatMap((b, i) => (isDeepStrictEqual(icons[i]!.layers[0], b.face) ? [] : [{ ...b, icon: icons[i]!.layers[0] }]))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    show('block items drawn by their block face, without NEI', [
      `${fmt(blockStep.length)} keys (prototype: 15,355); changed: the 11 reviewed keys → ${changed.length}`,
      ...changed.map((c) => `${c.key}: ${c.icon?.path ?? 'no icon'} (block: ${c.face.path})`),
    ]);
    expect(changed.map((c) => c.key)).toEqual(ITEM_NAME_OVER_BLOCK);
  });

  it('extracts the chest sheets from the real jars', async () => {
    const client = findClientJar({ flag: null, config: clientJarOf(config), home: homedir() });
    expect(client, 'the Minecraft 1.7.10 client jar').not.toBeNull();
    expect(config.serverFolder, "the config's serverFolder").not.toBeNull();
    const ironChest = (await listModJars(config.serverFolder!)).filter((jar) => /^IronChest-.+\.jar$/.test(basename(jar)));
    expect(ironChest.map((jar) => basename(jar))).toHaveLength(1);
    const dir = await mkdtemp(join(tmpdir(), 'gtnh-planner-chests-'));
    try {
      await extractAssets({ jars: [{ path: client!, kind: 'client' }, { path: ironChest[0]!, kind: 'mod' }], dataDir: dir });
      const tmpIndex = await loadAssetIndex(join(dir, 'assets'));
      const chestPaths = Object.keys(tmpIndex.file?.files ?? {}).filter((path) => CHEST_SHEET_PATH.test(path));
      const sizes = chestPaths.map((path) => `${tmpIndex.info(path)!.w}×${tmpIndex.info(path)!.h}`);
      const extracted = Object.keys(index.file?.files ?? {}).filter((path) => CHEST_SHEET_PATH.test(path)).length;
      show(`chest sheets from ${basename(client!)} and ${basename(ironChest[0]!)}`, [
        `${extracted} in the data folder's assets → ${chestPaths.length} copied by the extractor now`,
        ...chestPaths.map((path, i) => `${path} ${sizes[i]}`),
      ]);
      expect(chestPaths).toEqual([...['copper', 'crystal', 'darksteel', 'diamond', 'dirt', 'gold', 'iron', 'netherite', 'obsidian', 'silver'].map((n) => `ironchest/textures/model/${n}chest.png`),
        ...['christmas', 'christmas_double', 'ender', 'normal', 'normal_double', 'trapped', 'trapped_double'].map((n) => `minecraft/textures/entity/chest/${n}.png`)]);
      expect(sizes).toEqual(chestPaths.map((path) => (path.endsWith('_double.png') ? '128×64' : '64×64')));
      expect(curatedPaths().filter((path) => CHEST_SHEET_PATH.test(path) && !chestPaths.includes(path))).toEqual([]);   // every curated chest names a real sheet
      expect(resolveBlocks({ index: tmpIndex, dump: null, nei: null, pack: null }, [{ id: 'minecraft:chest', meta: 0 }])[0]!.faces.north.map((l) => l.region!.src))
        .toEqual([[14, 33, 14, 10], [14, 14, 14, 5], [1, 1, 2, 4]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fluid stills the dump names but nobody extracted', () => {
    const missingStillNames = raw.fluids.filter((f) => typeof f.still === 'string' && !index.has(f.still)).map((f) => f.name);
    const cracked = missingStillNames.filter((n) => CRACKED.test(n));
    show('fluids whose still file is missing', [
      `82 (66 cracked, 16 others) → ${missingStillNames.length} (${cracked.length} cracked, ${missingStillNames.length - cracked.length} others); `
        + `the loader counts ${dump.stats.missingStill}`,
    ]);
    if (dump.exporterVersion === '0.3.0') expect(dump.stats.missingStill).toBe(82);
    else expect(cracked).toEqual([]);
  });

  it('reads the 0.4.0 fields', (ctx) => {
    if (dump.exporterVersion !== '0.4.0') ctx.skip();
    const rawPipesWithUnconnected = raw.mte.filter((m) => m.unconnected !== undefined);
    const sameAsDerived = rawPipesWithUnconnected
      .filter((m) => Array.isArray(m.inactive) && isDeepStrictEqual(derivedUnconnected(m.inactive), m.unconnected)).length;
    show('the 0.4.0 fields', [
      `prefixTextures ${dump.prefixTextures.size} (frameGt ${dump.prefixTextures.get('frameGt')}, sheetmetal ${dump.prefixTextures.get('sheetmetal')}, `
        + `cellMolten ${dump.prefixTextures.get('cellMolten')}); metaItems ${dump.metaItems.size}; block rows ${dump.blocks.size}`,
      `pipes with unconnected faces: 664 → ${rawPipesWithUnconnected.length}; the same as derived: ${share(sameAsDerived, rawPipesWithUnconnected.length)}`,
    ]);
    expect([dump.prefixTextures.get('frameGt'), dump.prefixTextures.get('sheetmetal'), dump.prefixTextures.get('cellMolten')]).toEqual([83, 86, 31]);
    expect(['gregtech:gt.integrated_circuit', 'ggfab:gt.ggfab.d1'].every((id) => dump.metaItems.has(id))).toBe(true);
    expect(['gregtech:gt.blockframes', 'gregtech:gt.blockmetal1', 'gregtech:gt.sheetmetal'].every((id) => dump.blocks.has(id))).toBe(true);   // the dump's own block table
    expect(rawPipesWithUnconnected.length).toBeGreaterThanOrEqual(600);              // 664 affected types: 312 insulated cables, 352 pipes
    expect(sameAsDerived / rawPipesWithUnconnected.length).toBeGreaterThanOrEqual(0.95);   // derivedUnconnected(raw inactive) deep-equals the exported state
  });
});
