// Curated face tables for blocks whose icons are chosen in client-only code, so a dedicated
// server cannot report them (research §2.3, §5). Paths are relative to data/assets/; each face
// lists candidates and the first extracted one wins (Task 10).
import { FACES } from '../../shared/types/assets.ts';
import type { Face, Rgb } from '../../shared/types/assets.ts';

export interface CuratedBlock { faces: Record<Face, readonly string[]>; tint?: Partial<Record<Face, Rgb>> }

type FaceSpec = Partial<Record<Face, string | readonly string[]>>;

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'big_oak'];
const LOG_WOODS = ['oak', 'spruce', 'birch', 'jungle'];
const LOG2_WOODS = ['acacia', 'big_oak'];
const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const STONEBRICK = ['stonebrick', 'stonebrick_mossy', 'stonebrick_cracked', 'stonebrick_carved'];
const CHEST_TYPES = ['iron', 'gold', 'diamond', 'copper', 'silver', 'crystal', 'obsidian', 'dirtchest9000', 'netherite', 'darksteel', 'silver'];

const GRASS_TINT: Rgb = [145, 189, 89];
const LEAVES_TINT: Rgb = [119, 171, 47];

function wood(meta: number): string { return WOODS[meta] ?? 'oak'; }

/** Build a block from a per-face spec; `others` fills every face the spec does not name. */
function build(domain: string, kind: 'blocks' | 'items', spec: FaceSpec, others: string | readonly string[], tint?: Partial<Record<Face, Rgb>>): CuratedBlock {
  const toPaths = (v: string | readonly string[]): string[] => (typeof v === 'string' ? [v] : [...v]).map((n) => `${domain}/textures/${kind}/${n}.png`);
  const faces = {} as Record<Face, readonly string[]>;
  for (const f of FACES) faces[f] = toPaths(spec[f] ?? others);
  return tint ? { faces, tint } : { faces };
}

const blocks = (domain: string, spec: FaceSpec, others: string | readonly string[], tint?: Partial<Record<Face, Rgb>>): CuratedBlock => build(domain, 'blocks', spec, others, tint);
const all = (domain: string, name: string | readonly string[], tint?: Partial<Record<Face, Rgb>>): CuratedBlock => blocks(domain, {}, name, tint);
const allFaces = (tint: Rgb): Partial<Record<Face, Rgb>> => Object.fromEntries(FACES.map((f) => [f, tint]));

const SD = 'storagedrawers';
const PR = 'projectred';
const EIO = 'enderio';
const AE = 'appliedenergistics2';

const PIPES: Record<string, string> = {
  pr_pipe: 'basic', pr_rbasic: 'routedjunc', pr_rinterface: 'routedint', pr_rcrafting: 'routedcrafting',
  pr_rrequest: 'routedrequest', pr_rextension: 'routedextension', pr_rfire: 'routedfire', pr_pt: 'pressuretube',
  pr_rpt: 'resistancetube', pr_netvalve: 'netvalve_inout', pr_netlatency: 'netlatency',
};
const CONDUITS: Record<string, string> = {
  item: 'itemConduit', liquid: 'liquidConduit', power: 'powerConduit', redstone: 'redstoneConduit',
  me: 'meConduit', gas: 'gasConduit', oc: 'ocConduit', other: 'conduitConnector',
};
const AE2_CABLES: Record<string, [string, string]> = {
  glass: ['CableGlass', 'MECable'], covered: ['CableCovered', 'MECovered'], smart: ['CableSmart', 'MESmart'],
  dense: ['CableDense', 'MEDense'], dense_covered: ['CableDenseCovered', 'MEDenseCovered'],
};

function ae2Cable(center: string): CuratedBlock | null {
  const c = Object.hasOwn(AE2_CABLES, center) ? AE2_CABLES[center] : undefined;
  if (!c) return null;
  const [part, family] = c;
  const list = [`${AE}/textures/items/ItemPart.${part}.png`, `${AE}/textures/blocks/ItemPart.${part}.png`, `${AE}/textures/blocks/${family}_Grey.png`];
  const faces = {} as Record<Face, readonly string[]>;
  for (const f of FACES) faces[f] = list;
  return { faces };
}

function drawers(w: string, n: number): CuratedBlock {
  return blocks(SD, { north: `drawers_${w}_front_${n}` }, `drawers_${w}_side`);
}

/** Meta-independent or meta-driven table lookup; null for ids the tables do not know. */
const TABLE: Record<string, (meta: number) => CuratedBlock> = {
  'StorageDrawers:fullDrawers1': (m) => drawers(wood(m), 1),
  'StorageDrawers:fullDrawers2': (m) => drawers(wood(m), 2),
  'StorageDrawers:fullDrawers4': (m) => drawers(wood(m), 4),
  'StorageDrawers:halfDrawers2': (m) => halfDrawers(wood(m), 2),
  'StorageDrawers:halfDrawers4': (m) => halfDrawers(wood(m), 4),
  'StorageDrawers:compDrawers': () => blocks(SD, { north: ['drawers_comp_front_2', 'drawers_comp_front_1', 'drawers_comp_front_0'] }, 'drawers_comp_side'),
  'StorageDrawers:controller': () => blocks(SD, { north: 'drawers_controller_front' }, 'drawers_comp_side'),
  'StorageDrawers:controllerSlave': () => all(SD, 'drawers_comp_side'),
  'StorageDrawers:trim': (m) => all(SD, `drawers_${wood(m)}_trim`),
  'JABBA:barrel': () => blocks('jabba', { north: 'barrel_label_0', up: 'barrel_top_0', down: 'barrel_top_0' }, 'barrel_side_0'),
  'IronChest:BlockIronChest': (m) => {
    const t = CHEST_TYPES[m] ?? 'iron';
    return blocks('ironchest', { north: `${t}_front`, up: `${t}_top`, down: `${t}_top` }, `${t}_side`);
  },
  'ForgeMultipart:block': () => all(PR, 'mechanical/pipes/basic'),
  'EnderIO:blockConduitBundle': () => all(EIO, 'conduitConnector'),
  'appliedenergistics2:tile.BlockController': () => all(AE, ['BlockControllerPowered', 'BlockController']),
  'appliedenergistics2:tile.BlockDrive': () => blocks(AE, { north: 'BlockDriveFront', up: 'BlockDrive', down: 'BlockDriveBottom' }, 'BlockDriveSide'),
  'appliedenergistics2:tile.BlockInterface': () => all(AE, 'BlockInterface'),
  'appliedenergistics2:tile.BlockCableBus': () => ae2Cable('glass')!,
  'minecraft:grass': () => blocks('minecraft', { up: 'grass_top', down: 'dirt' }, 'grass_side', { up: GRASS_TINT }),
  'minecraft:sand': (m) => all('minecraft', m === 1 ? 'red_sand' : 'sand'),
  'minecraft:planks': (m) => all('minecraft', `planks_${wood(m)}`),
  'minecraft:log': (m) => logBlock(LOG_WOODS[m & 3]!),
  'minecraft:log2': (m) => logBlock(LOG2_WOODS[m & 1]!),
  'minecraft:leaves': (m) => all('minecraft', `leaves_${LOG_WOODS[m & 3]}`, allFaces(LEAVES_TINT)),
  'minecraft:wool': (m) => all('minecraft', `wool_colored_${WOOL[m & 15]}`),
  'minecraft:stonebrick': (m) => all('minecraft', STONEBRICK[m & 3]!),
  'minecraft:sandstone': () => blocks('minecraft', { up: 'sandstone_top', down: 'sandstone_bottom' }, 'sandstone_normal'),
  'minecraft:quartz_block': () => blocks('minecraft', { up: 'quartz_block_top', down: 'quartz_block_bottom' }, 'quartz_block_side'),
  'minecraft:chest': () => all('minecraft', 'planks_oak'),
  'minecraft:crafting_table': () => blocks('minecraft', { north: 'crafting_table_front', up: 'crafting_table_top', down: 'planks_oak' }, 'crafting_table_side'),
  'minecraft:furnace': () => blocks('minecraft', { north: 'furnace_front_off', up: 'furnace_top', down: 'furnace_top' }, 'furnace_side'),
  'minecraft:lit_furnace': () => blocks('minecraft', { north: 'furnace_front_on', up: 'furnace_top', down: 'furnace_top' }, 'furnace_side'),
  'minecraft:hopper': () => blocks('minecraft', { up: 'hopper_top' }, 'hopper_outside'),
  'minecraft:water': () => all('minecraft', 'water_still'),
  'minecraft:flowing_water': () => all('minecraft', 'water_still'),
  'minecraft:lava': () => all('minecraft', 'lava_still'),
  'minecraft:flowing_lava': () => all('minecraft', 'lava_still'),
};

function halfDrawers(w: string, n: number): CuratedBlock {
  return blocks(SD, { north: `drawers_${w}_front_${n}`, up: `drawers_${w}_side_h`, down: `drawers_${w}_side_h`, west: `drawers_${w}_side_v`, east: `drawers_${w}_side_v` }, `drawers_${w}_side`);
}

function logBlock(w: string): CuratedBlock {
  return blocks('minecraft', { up: `log_${w}_top`, down: `log_${w}_top` }, `log_${w}`);
}

/** A pseudo id's table entry; only own keys count, so `ae2cable:constructor` or `conduit:__proto__` is unknown. */
function pseudo(id: string): CuratedBlock | null {
  if (id.startsWith('fmp:')) {
    const k = id.slice(4);
    const x = Object.hasOwn(PIPES, k) ? PIPES[k] : undefined;
    return x ? all(PR, `mechanical/pipes/${x}`) : null;
  }
  if (id.startsWith('conduit:')) {
    const k = id.slice(8);
    const x = Object.hasOwn(CONDUITS, k) ? CONDUITS[k] : undefined;
    return x ? all(EIO, x) : null;
  }
  if (id.startsWith('ae2cable:')) return ae2Cable(id.slice(9));
  return null;
}

export function curatedBlock(id: string, meta: number): CuratedBlock | null {
  const fn = Object.hasOwn(TABLE, id) ? TABLE[id] : undefined;
  return fn ? fn(meta) : pseudo(id);
}

export function curatedIds(): string[] {
  return [
    ...Object.keys(TABLE),
    ...Object.keys(PIPES).map((k) => `fmp:${k}`),
    ...Object.keys(CONDUITS).map((k) => `conduit:${k}`),
    ...Object.keys(AE2_CABLES).map((k) => `ae2cable:${k}`),
  ];
}

/** Every candidate path in the tables, over every meta value that changes the answer. */
export function curatedPaths(): string[] {
  const out = new Set<string>();
  for (const id of curatedIds()) {
    for (let meta = 0; meta < 16; meta++) {
      const b = curatedBlock(id, meta);
      if (b) for (const f of FACES) for (const p of b.faces[f]) out.add(p);
    }
  }
  return [...out].sort();
}
