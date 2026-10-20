// The 3D view's scene as plain data (Plan 5 Task 14; spec §3.8, architecture §11.14, web-stack §8): the blocks of a
// layout as instances of five shapes, the face textures they share as tile sources for one array texture, which
// instances the layer slider and the ghost and hookup toggles show, the side list of blocks to place, and the texts
// for hover and click. An EnderIO conduit bundle (architecture "EnderIO conduits, granted change requests (add-on
// 11)") draws every connection of its conduits as EnderIO draws it (the user's requirements of 2026-10-19, item 3
// (a)): an arm toward each linked neighbour, the conduits that go one way side by side, and a connector arm on every
// face that is set: the plate, then the mode's arrows in the face's channel colours (an In / Out face shows both);
// where its conduits part, they meet in EnderIO's connector box. A pipe with pipe layers (architecture §11.43 (c))
// draws its core, arms and arm tips from them, over its role's colour; a machine facing up or down keeps its hull's
// top, bottom and sides where GT draws them (§11.43 (j)). Pure TypeScript — no DOM, no three.js — so it is tested
// without a browser; the viewer turns these lists into meshes and the loader turns the tile sources into pixels.

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import { conduitLines, configuredLines } from '../../shared/layout/configure-text.ts';
import { CONDUIT_NAMES, dyeRgb } from '../../shared/layout/enderio.ts';
import { fmtInt, fmtRate } from '../../shared/layout/format.ts';
import { SIDE_NAMES, posKey, step, type Vec3 } from '../../shared/layout/geometry.ts';
import {
  FACES, KIND_COLORS, conduitBlockRef, orientFaces, rotateFaces,
  type BlockFaces, type CoverLayers, type Face, type IconDescriptor, type Rgb, type TextureLayer,
} from '../../shared/types/assets.ts';
import type { BlockRole, ConduitFace, ConduitMode, ConduitSpec, Layout, LayoutBlock } from '../../shared/types/layout.ts';
import type { BlockRef, Product } from '../../shared/types/pack.ts';
import type { Plan, PlanStep } from '../../shared/types/plan.ts';

/**
 * `cube`: a whole block. `core` and `arm`: a cable, pipe or conduit, its middle and one arm per connected side. `plate`:
 * a cover on one face. `hub`: the connector box a conduit bundle's conduits meet in where they part, a box of its own
 * `size`.
 */
export type ShapeKind = 'cube' | 'core' | 'arm' | 'plate' | 'hub';

/** The plain colour of a face that has no texture (spec §3.8): by machine kind where Plan 3 has one, else one of this view's own. */
export const ROLE_FALLBACK: Readonly<Record<BlockRole, Rgb>> = {
  machine: [...KIND_COLORS.basic], hatch: [...KIND_COLORS.hatch], casing: [...KIND_COLORS.casing], transformer: [...KIND_COLORS.transformer],
  cable: [...KIND_COLORS.cable], pipe: [...KIND_COLORS.item_pipe],
  cover: [220, 220, 220], interface: [126, 87, 194], chip_pipe: [255, 112, 67], chest: [160, 110, 50], ghost: [200, 200, 200],
};

/** The roles drawn as a core with arms instead of a cube. */
const PIPE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['cable', 'pipe', 'chip_pipe']);
/** Tile 0, which the viewer draws for every tile index the GPU has no array layer for. */
const FALLBACK_KEY = 'fallback';
const FALLBACK_COLOR: Rgb = [128, 128, 128];
/** A machine with no facing looks north, like the canonical textures. */
const DEFAULT_FACING = 2;
/** How far apart (blocks) the conduits of a bundle that go one way are drawn, side by side: a conduit is 6 px across. */
const BUNDLE_SPACING = 6 / 16;
/** Half a conduit core's width (blocks). */
const CORE_HALF = 3 / 16;
/** How much bigger than the cores it holds EnderIO draws a bundle's connector box (`TileConduitBundle.addConnectors`). */
const HUB_SCALE = 1.05;

/** `${id}@${meta}`, plus `#${mteId}` for a GregTech machine: how the scene names a block to the asset routes. */
export function blockKey(ref: BlockRef): string {
  return `${ref.id}@${ref.meta}${ref.mteId === undefined ? '' : `#${ref.mteId}`}`;
}

const IDENTITY: Readonly<Record<Face, Face>> = { down: 'down', up: 'up', north: 'north', south: 'south', west: 'west', east: 'east' };

/**
 * Which canonical face (front on north) shows on world side `worldSide` of a block that faces `facing`: Plan 3's
 * rotation read the other way round, so the front texture ends up where the machine faces. This is the whole-cube
 * turn; `buildScene` orients a cube with `orientFaces`, which keeps a vertical machine's hull by world side.
 */
export function canonicalFaceFor(facing: number, worldSide: number): Face {
  const face = FACES[worldSide];
  if (face === undefined) throw new RangeError(`a side is a ForgeDirection 0..5, got ${worldSide}`);
  return rotateFaces(IDENTITY, facing)[face];
}

/**
 * The side a block's front texture goes on: its facing; for a GT basic machine with a front of its own (`mainFacing`)
 * that front, unless it faces up or down — then GT draws the front on the output side (`facing`, research
 * textures-icons §3.3 "Which face gets what").
 */
export function frontOf(b: Pick<Layout['blocks'][number], 'facing' | 'mainFacing'>): number {
  return b.mainFacing !== undefined && b.mainFacing > 1 ? b.mainFacing : b.facing ?? DEFAULT_FACING;
}

/** One layer of the array texture: the texture layers to blend, or a plain colour when there are none. */
export interface TileSource {
  /**
   * `fallback`, `color:<r>,<g>,<b>` for a plain colour, `under:<r>,<g>,<b>|` and the JSON of `layers` for layers drawn
   * over a plain colour, else the JSON of `layers`: tiles with the same key are one tile.
   */
  key: string;
  layers: TextureLayer[];
  /** The plain colour this tile shows when no layer can be drawn (the first colour any instance gave it). */
  color: Rgb;
  /** The plain colour the layers are drawn over, so none of the tile's pixels is transparent; only on a tile with layers. */
  under?: Rgb;
}

/** One drawn shape of one block. */
export interface SceneInstance {
  /** Index into `layout.blocks` of the block it belongs to (a plate belongs to its host), for hover and click. */
  block: number;
  shape: ShapeKind;
  /** The cell, relative to `layout.origin`. */
  pos: Vec3;
  /** The side an arm or plate points to (ForgeDirection), else −1. */
  side: number;
  /** Index into `SceneData.tiles` per world side, in ForgeDirection order (down, up, north, south, west, east). */
  tiles: [number, number, number, number, number, number];
  ghost: boolean;
  /** Shift from the cell centre, in blocks: conduits of one bundle side by side, the centre of a bundle's connector box. */
  offset?: Vec3;
  // optional additions (the user's requirements of 2026-10-19, item 3 (a))
  /** The conduit of the block's bundle a `core` or `arm` draws (index into `conduits`). */
  conduit?: number;
  /** A `hub`'s size in blocks along x, y and z. */
  size?: Vec3;
}

/** Where an instance sits: its cell centre plus `offset`. */
export function instanceTranslation(inst: SceneInstance): Vec3 {
  const [dx, dy, dz] = inst.offset ?? [0, 0, 0];
  return [inst.pos[0] + 0.5 + dx, inst.pos[1] + 0.5 + dy, inst.pos[2] + 0.5 + dz];
}

/** A face that is set: Extract, Insert or In / Out. */
type SetMode = Exclude<ConduitMode, 'disabled'>;

/**
 * The connector a conduit face set to each mode shows on its arm, bottom first, as EnderIO 2.10.46 draws it
 * (`ItemConduitRenderer` and `EnderLiquidConduitRenderer.renderEntity`): the plate (`itemConduitIoConnector`, a solid
 * square) under every mode, then the mode's arrows, each tinted with the channel colour of the side named
 * (`Tessellator.setColorOpaque_I(DyeColor.getColor())`): Extract's arrow in its extract colour, Insert's in its insert
 * colour, In / Out's In half in the extract colour and its Out half in the insert colour. Each part is Plan 3's
 * curated pseudo block `conduit:connector_<part>`.
 */
const CONNECTOR_PARTS: Readonly<Record<SetMode, ReadonlyArray<{ part: string; side: 'extract' | 'insert' | null }>>> = {
  extract: [{ part: 'background', side: null }, { part: 'extract', side: 'extract' }],
  insert: [{ part: 'background', side: null }, { part: 'insert', side: 'insert' }],
  in_out: [{ part: 'background', side: null }, { part: 'in_out_in', side: 'extract' }, { part: 'in_out_out', side: 'insert' }],
};

/** EnderIO's internal connector (`BlockConduitBundle.connectorIcon`, `conduitConnector`): Plan 3's curated `conduit:other`. */
const HUB_REF: BlockRef = conduitBlockRef('other');

function connectorRef(part: string): BlockRef {
  return conduitBlockRef(`connector_${part}`);
}

function isSet(face: ConduitFace): face is ConduitFace & { mode: SetMode } {
  return face.mode !== 'disabled';
}

/** One arm of a conduit: its side, its shift from the cell centre, and the set face it ends in (its connector), else null (a link). */
interface ArmPlan { side: number; offset: Vec3; face: (ConduitFace & { mode: SetMode }) | null }
/** How a bundle is drawn: per conduit its cores and arms (in side order), and the connector box when its conduits part. */
interface BundlePlan { cores: Vec3[][]; arms: ArmPlan[][]; hub: { offset: Vec3; size: Vec3 } | null }

/**
 * How EnderIO 2.10.46 lays a bundle's conduits out (`TileConduitBundle.getOffset`, `getConnectionCount`, `addConnectors`):
 * each conduit has an arm toward each side it is linked or has a set face on (the face wins); toward a side that two or
 * more of the bundle's conduits go, their arms are drawn side by side in bundle order, BUNDLE_SPACING apart across the
 * arm (along y for the four sides, along x up and down), and toward a side a conduit goes alone, on the cell's centre
 * line. Linked neighbours have the same conduits going between them, so their arms meet, and every arm reaches its face.
 * A conduit's core is at each place its arms leave from, or at its place in the bundle (along y) when it has none.
 * Where a conduit has cores in two places, or two conduits' cores overlap, EnderIO draws its connector box around all
 * of the bundle's cores, 1.05 times their size, and they are not drawn inside it.
 */
function bundlePlan(conduits: readonly ConduitSpec[]): BundlePlan {
  const n = conduits.length;
  const ends = conduits.map((c) => {
    const out: Array<{ side: number; face: (ConduitFace & { mode: SetMode }) | null }> = [];
    for (let side = 0; side < 6; side++) {
      const face = c.faces.find((f) => f.face === FACES[side]);
      if (face !== undefined && isSet(face)) out.push({ side, face });
      else if (c.connections & (1 << side)) out.push({ side, face: null });
    }
    return out;
  });
  const going = FACES.map((_, side) => ends.flatMap((list, i) => (list.some((e) => e.side === side) ? [i] : [])));
  const arms = ends.map((list, i) => list.map(({ side, face }): ArmPlan => {
    const together = going[side]!;
    const lane = together.length < 2 ? 0 : (together.indexOf(i) - (together.length - 1) / 2) * BUNDLE_SPACING;
    return { side, offset: side < 2 ? [lane, 0, 0] : [0, lane, 0], face };
  }));
  const cores = arms.map((list, i): Vec3[] => {
    const places = new Map(list.map((a) => [posKey(a.offset), a.offset]));
    return places.size > 0 ? [...places.values()] : [[0, n < 2 ? 0 : (i - (n - 1) / 2) * BUNDLE_SPACING, 0]];
  });
  const all = cores.flatMap((list, i) => list.map((p) => ({ i, p })));
  const overlap = (a: Vec3, b: Vec3): boolean => a.every((v, k) => Math.abs(v - b[k]!) < 2 * CORE_HALF - 1e-9);
  const parts = n >= 2 && (cores.some((list) => list.length > 1) || all.some((a, x) => all.some((b, y) => y > x && a.i !== b.i && overlap(a.p, b.p))));
  if (!parts) return { cores, arms, hub: null };
  const low = [0, 1, 2].map((k) => Math.min(...all.map(({ p }) => p[k]! - CORE_HALF)));
  const high = [0, 1, 2].map((k) => Math.max(...all.map(({ p }) => p[k]! + CORE_HALF)));
  const mid = (k: number): number => (low[k]! + high[k]!) / 2;
  const across = (k: number): number => (high[k]! - low[k]!) * HUB_SCALE;
  return { cores, arms, hub: { offset: [mid(0), mid(1), mid(2)], size: [across(0), across(1), across(2)] } };
}

/**
 * The refs a block is drawn with: its own, then per conduit `conduit:<kind>` and the connector parts of each
 * non-disabled face (`CONNECTOR_PARTS`), then the connector box (`conduit:other`) of a bundle whose conduits part
 * (`bundlePlan`); each once, in that order.
 */
export function sceneBlockRefs(b: LayoutBlock): BlockRef[] {
  const refs = new Map<string, BlockRef>();
  const add = (ref: BlockRef): void => {
    const key = blockKey(ref);
    if (!refs.has(key)) refs.set(key, ref);
  };
  add({ ...b.block });
  for (const conduit of b.conduits ?? []) {
    add(conduitBlockRef(conduit.kind));
    for (const face of conduit.faces) if (isSet(face)) for (const { part } of CONNECTOR_PARTS[face.mode]) add(connectorRef(part));
  }
  if ((b.conduits ?? []).length > 0 && bundlePlan(b.conduits!).hub !== null) add({ ...HUB_REF });
  return [...refs.values()];
}

export interface SceneData {
  /** `tiles[0]` is always the fallback tile. */
  tiles: TileSource[];
  instances: SceneInstance[];
  size: Vec3;
}

/** The same tile on all six sides (a fresh array each time). */
function onAllSides(tile: number): SceneInstance['tiles'] {
  return [tile, tile, tile, tile, tile, tile];
}

/**
 * The scene of a layout, instances in block order. A block holding EnderIO conduits draws them as `bundlePlan` lays
 * them out: the connector box (a `hub` of its `size` and `offset`, all faces the `north` texture of `conduit:other`)
 * when its conduits part, then per conduit in bundle order its `core` at each of its places unless the box holds them,
 * and an `arm` per side (ascending) that is one of its links (all faces the conduit's `north` texture) or one of its
 * faces that is not Disabled (all faces that face's connector: the `north` textures of its `CONNECTOR_PARTS`, each arrow
 * tinted with its side's channel colour), each with its `conduit` index and its `offset` when it is off the centre. Any
 * other
 * cable, pipe or chip pipe is a `core` plus an `arm` per connected side (ascending), and so is a ghost whose faces carry
 * `pipe`, its connected sides those whose neighbour is one of the line's cables or pipes (never a ghost): with `pipe`
 * (architecture §11.43 (c)) the core shows `pipe.core` on all six sides and an arm `pipe.end` on the side it points to,
 * its tip, and `pipe.arm` on the other five; without it every side is the `north` texture. The textured tiles of these
 * cores and arms, a conduit's and its connectors' included, are drawn over the block role's colour (`under`; a ghost's
 * is the ghost grey), so no pixel of a model sheet is see-through. Any other block is one `cube` whose world sides
 * show its faces oriented to its front (`frontOf`) by `orientFaces` (architecture §11.43 (j)): turned whole, except
 * that a block facing up or down whose four sides share their hull keeps each world side's own layers, as GT draws it,
 * and only its front's overlays move. After a block's own shapes come its covers, one `plate` per cover in `covers`
 * order, on the cover's face and carrying the cover's in-world overlay — else its item icon, else a plain colour — on
 * all six tiles. A face with no layers, or a block with no faces, is a plain colour, and a tile is shared by
 * everything that draws the same layers (and tints) over the same colour. Every tile's `color` is what it falls back
 * to: the block's own fallback colour (a conduit's own), a connector's channel colour (its extract side's, or an Insert
 * face's insert side's), the cover item's, or the role's.
 */
export function buildScene(
  layout: Layout, faces: ReadonlyMap<string, BlockFaces>, icons: ReadonlyMap<StuffKey, IconDescriptor>, covers: ReadonlyMap<StuffKey, CoverLayers>,
): SceneData {
  const tiles: TileSource[] = [{ key: FALLBACK_KEY, layers: [], color: [...FALLBACK_COLOR] }];
  const tileOf = new Map<string, number>([[FALLBACK_KEY, 0]]);
  /**
   * The tile for `layers`, drawn over the plain `under` when it is given, or for the plain `color` when there are no
   * layers; the colour of the first request for a tile stays.
   */
  const tile = (layers: readonly TextureLayer[], color: Rgb, under?: Rgb): number => {
    const over = layers.length === 0 ? undefined : under;   // a plain colour is never drawn over another
    const key = layers.length === 0 ? `color:${color[0]},${color[1]},${color[2]}`
      : over === undefined ? JSON.stringify(layers) : `under:${over[0]},${over[1]},${over[2]}|${JSON.stringify(layers)}`;
    const known = tileOf.get(key);
    if (known !== undefined) return known;
    tiles.push({ key, layers: [...layers], color: [...color], ...(over === undefined ? {} : { under: [...over] }) });
    tileOf.set(key, tiles.length - 1);
    return tiles.length - 1;
  };
  /** The cells of the line's cables, pipes and chip pipes, which a ghost pipe reaches its arms toward. */
  const pipeCells = new Set(layout.blocks.filter((b) => PIPE_ROLES.has(b.role)).map((b) => posKey(b.pos)));
  /** The connection bits of the sides of `at` (a world cell) whose neighbour is in `pipeCells`. */
  const linksToPipes = (at: Vec3): number => {
    let bits = 0;
    for (let side = 0; side < 6; side++) if (pipeCells.has(posKey(step(at, side)))) bits |= 1 << side;
    return bits;
  };

  const instances: SceneInstance[] = [];
  const [ox, oy, oz] = layout.origin;
  layout.blocks.forEach((b, block) => {
    const pos: Vec3 = [b.pos[0] - ox, b.pos[1] - oy, b.pos[2] - oz];
    const ghost = b.role === 'ghost';
    const add = (shape: ShapeKind, side: number, sides: SceneInstance['tiles'], offset?: Vec3, more?: { conduit?: number; size?: Vec3 }): void => {
      const shifted = offset !== undefined && offset.some((v) => v !== 0);
      instances.push({ block, shape, pos: [...pos], side, tiles: sides, ghost, ...(shifted ? { offset: [...offset] } : {}),
        ...(more?.conduit === undefined ? {} : { conduit: more.conduit }), ...(more?.size === undefined ? {} : { size: [...more.size] }) });
    };
    const found = faces.get(blockKey(b.block));
    /** What the textured tiles of a core or an arm are drawn over. */
    const under = ROLE_FALLBACK[b.role];

    if (b.conduits !== undefined && b.conduits.length > 0) {
      const plan = bundlePlan(b.conduits);
      /** The `north` face of a conduit's pseudo block, drawn over the role's colour, else the block role's plain colour. */
      const northTile = (ref: BlockRef): number => {
        const own = faces.get(blockKey(ref));
        return tile(own?.faces.north ?? [], own?.fallbackColor ?? ROLE_FALLBACK[b.role], under);
      };
      /**
       * A set face's connector (`CONNECTOR_PARTS`): the `north` layers of each part's pseudo block, an arrow's tinted with
       * its side's channel colour (`dyeRgb`), drawn over the role's colour like the conduit's own tiles; with no layers at
       * all, the plain colour of the face's first side's channel.
       */
      const connectorTile = (face: ConduitFace & { mode: SetMode }): number => {
        const layers = CONNECTOR_PARTS[face.mode].flatMap(({ part, side }): TextureLayer[] => {
          const own = faces.get(blockKey(connectorRef(part)))?.faces.north ?? [];
          const color = side === null ? undefined : face[side]?.color;
          return own.map((l) => (color === undefined ? { ...l } : { ...l, tint: dyeRgb(color) }));
        });
        const first = face.mode === 'insert' ? face.insert : face.extract;
        return tile(layers, first === undefined ? ROLE_FALLBACK[b.role] : dyeRgb(first.color), under);
      };
      if (plan.hub !== null) add('hub', -1, onAllSides(northTile(HUB_REF)), plan.hub.offset, { size: plan.hub.size });
      b.conduits.forEach((conduit, i) => {
        const t = northTile(conduitBlockRef(conduit.kind));
        if (plan.hub === null) for (const place of plan.cores[i]!) add('core', -1, onAllSides(t), place, { conduit: i });
        for (const arm of plan.arms[i]!) add('arm', arm.side, onAllSides(arm.face === null ? t : connectorTile(arm.face)), arm.offset, { conduit: i });
      });
    } else if (PIPE_ROLES.has(b.role) || (ghost && found?.pipe !== undefined)) {
      const connections = ghost ? linksToPipes(b.pos) : b.connections ?? 0;
      const north = found?.faces.north ?? [];
      const layers = found?.pipe ?? { core: north, arm: north, end: north };
      const pipeTile = (list: readonly TextureLayer[]): number => tile(list, found?.fallbackColor ?? ROLE_FALLBACK[b.role], under);
      const core = pipeTile(layers.core), arm = pipeTile(layers.arm), end = pipeTile(layers.end);
      add('core', -1, onAllSides(core));
      for (let side = 0; side < 6; side++) {
        if ((connections & (1 << side)) === 0) continue;
        const sides = onAllSides(arm);
        sides[side] = end;   // the arm's tip, on the side it points to
        add('arm', side, sides);
      }
    } else {
      const oriented = found === undefined ? undefined : orientFaces(found.faces, frontOf(b));
      const at = (face: Face): number => tile(oriented?.[face] ?? [], found?.fallbackColor ?? ROLE_FALLBACK[b.role]);
      add('cube', -1, [at('down'), at('up'), at('north'), at('south'), at('west'), at('east')]);   // ForgeDirection order, as FACES
    }

    for (const cover of b.covers ?? []) {
      const icon = icons.get(cover.item);
      const overlay = covers.get(cover.item)?.layers ?? [];
      const t = tile(overlay.length > 0 ? overlay : icon?.layers ?? [], icon?.fallbackColor ?? ROLE_FALLBACK.cover);
      add('plate', FACES.indexOf(cover.face), onAllSides(t));
    }
  });
  return { tiles, instances, size: [...layout.size] };
}

/**
 * Whether the viewer draws `inst`: not a ghost while ghosts are off, not a block of a hookup while hookups are off,
 * and not above the layer slider (`maxLayer` shows layers 0 … k; `null` shows all).
 */
export function visible(inst: SceneInstance, maxLayer: number | null, show: { ghosts: boolean; hookups: boolean }, layout: Layout): boolean {
  if (inst.ghost && !show.ghosts) return false;
  if (!show.hookups && layout.blocks[inst.block]?.hookup !== undefined) return false;
  return maxLayer === null || inst.pos[1] <= maxLayer;
}

/** A row of the side list: what to place and how many. */
export interface BlockListRow { label: string; role: BlockRole; count: number }

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What a block adds to the side list: a row under its label, or a `pipe` row per conduit it holds, under the conduit's name. */
function placedRows(b: LayoutBlock): Array<Pick<BlockListRow, 'label' | 'role'>> {
  const conduits = b.conduits ?? [];
  if (conduits.length === 0) return [{ label: b.label, role: b.role }];
  return conduits.map((c): Pick<BlockListRow, 'label' | 'role'> => ({ label: CONDUIT_NAMES[c.kind], role: 'pipe' }));
}

/** The filters and speed upgrades on a block's conduit faces: each side's filter item once, each upgrade `count` times. */
function conduitFaceParts(b: LayoutBlock): Array<{ item: StuffKey; count: number }> {
  const parts: Array<{ item: StuffKey; count: number }> = [];
  for (const conduit of b.conduits ?? []) {
    for (const face of conduit.faces) {
      for (const side of [face.extract, face.insert]) {
        const item = side?.filter?.item;
        if (item !== undefined) parts.push({ item, count: 1 });
      }
      if (face.extract?.speed !== undefined) parts.push({ item: face.extract.speed.item, count: face.extract.speed.count });
    }
  }
  return parts;
}

/**
 * The side list (spec §3.8): the blocks to place, grouped by label (a block holding conduits counts each conduit under
 * its name instead), with one row per cover item (`<name> cover`, counted over every block's covers) and one per filter
 * or speed upgrade on a conduit face (`<name>`, role `cover`), the most numerous first and by label among equals; one
 * line per hookup, naming how many of its blocks the line lays and the pin that marks its tap; and the footprint as
 * W×L×H. Ghosts are not placed, so they are not listed.
 */
export function blockList(layout: Layout, names?: Readonly<Record<string, string>>): { place: BlockListRow[]; hookups: string[]; size: string } {
  const blocks = new Map<string, BlockListRow>();
  const coverItems = new Map<StuffKey, number>();
  const faceParts = new Map<StuffKey, number>();
  const hookupBlocks = new Map<number, number>();
  for (const b of layout.blocks) {
    if (b.role === 'ghost') continue;
    for (const { label, role } of placedRows(b)) {
      const row = blocks.get(label);
      if (row === undefined) blocks.set(label, { label, role, count: 1 });
      else row.count++;
    }
    for (const cover of b.covers ?? []) coverItems.set(cover.item, (coverItems.get(cover.item) ?? 0) + 1);
    for (const { item, count } of conduitFaceParts(b)) faceParts.set(item, (faceParts.get(item) ?? 0) + count);
    if (b.hookup !== undefined) hookupBlocks.set(b.hookup, (hookupBlocks.get(b.hookup) ?? 0) + 1);
  }
  const place = [...blocks.values(), ...[...coverItems].map(([item, count]): BlockListRow => ({ label: `${names?.[item] ?? item} cover`, role: 'cover', count })),
    ...[...faceParts].map(([item, count]): BlockListRow => ({ label: names?.[item] ?? item, role: 'cover', count }))];
  place.sort((a, b) => b.count - a.count || byText(a.label, b.label));

  const hookups = layout.hookups.map((h, index) => {
    const count = hookupBlocks.get(index) ?? 0;
    const tap = posKey(h.from.pos);
    const pin = layout.pins.find((p) => p.kind === h.kind && posKey(p.pos) === tap);
    return `${h.kind === 'power' ? 'Power' : 'Logistics'}: ${count} block${count === 1 ? '' : 's'} ${pin === undefined ? 'from the tap' : `from pin ${pin.n}`}`;
  });
  const [w, h, l] = layout.size;
  return { place, hookups, size: `${w}×${l}×${h}` };
}

/** The name of a good in a plan's words, else its key. */
function nameIn(plan: Plan | null): (k: StuffKey) => string {
  return (k) => plan?.names?.[k] ?? k;
}

/**
 * An amount per run (an expected value after chances): `fmtRate`'s words from 1 up, and below 1 two significant digits,
 * so a rare byproduct reads 0.04 instead of 0.
 */
function amountText(n: number): string {
  return n > 0 && n < 1 ? String(Number(n.toPrecision(2))) : fmtRate(n);
}

/**
 * What the step does per run — `Makes 2× Iron Dust from 1× Iron Ore`, a fluid in litres (`1,000 L Water`), without the
 * `from` part for a step that takes nothing (a pump) — and the tier and power of its machine.
 */
function stepLines(step: PlanStep, nameOf: (k: StuffKey) => string): string[] {
  const list = (products: readonly Product[]): string => products.map((p) => `${amountText(p.amount)}${isFluidKey(p.key) ? ' L' : '×'} ${nameOf(p.key)}`).join(', ');
  const lines: string[] = [];
  if (step.outputs.length > 0) lines.push(`Makes ${list(step.outputs)}${step.inputs.length > 0 ? ` from ${list(step.inputs)}` : ''}`);
  lines.push(`${TIER_NAMES[step.machine.tier] ?? `tier ${step.machine.tier}`} · ${fmtInt(step.euPerTick)} EU/t`);
  return lines;
}

/**
 * What a click on a block shows (spec §3.8, §11.14): its label as the title, then where it faces; for a block of a
 * plan step what the step makes from what, and its tier and power; every cover's item, face, settings and filter and
 * the block's own settings, then every conduit face's mode and settings, in the words of its configure step; that it
 * belongs to a hookup; that it is a ghost. A block index outside the layout (a stale pick) gives an empty title and no
 * lines.
 */
export function pickInfo(layout: Layout, plan: Plan | null, blockIndex: number): { title: string; lines: string[] } {
  const block = layout.blocks[blockIndex];
  if (block === undefined) return { title: '', lines: [] };
  const nameOf = nameIn(plan);
  const lines: string[] = [];
  const facing = block.facing === undefined ? undefined : SIDE_NAMES[block.facing];
  const front = block.mainFacing === undefined ? undefined : SIDE_NAMES[block.mainFacing];
  // a GT basic machine keeps its front and its output side apart: name both
  if (front !== undefined) lines.push(`Front facing ${front}`, ...(facing === undefined ? [] : [`Output side ${facing}`]));
  else if (facing !== undefined) lines.push(`Facing ${facing}`);
  const step = block.stepId === undefined ? undefined : plan?.steps.find((s) => s.id === block.stepId);
  if (step !== undefined) lines.push(...stepLines(step, nameOf));
  lines.push(...configuredLines(block, nameOf));
  lines.push(...conduitLines(block, nameOf).map((l) => l.text));
  const hookup = block.hookup === undefined ? undefined : layout.hookups[block.hookup];
  if (hookup !== undefined) lines.push(`Part of the ${hookup.kind} hookup`);
  if (block.role === 'ghost') lines.push('Already in your base');
  return { title: block.label, lines };
}

/**
 * What hovering a block shows: its label, then each cover's and setting's text, then each conduit face's, joined with
 * a dash; empty for a block outside the layout.
 */
export function hoverText(layout: Layout, plan: Plan | null, blockIndex: number): string {
  const block = layout.blocks[blockIndex];
  if (block === undefined) return '';
  const nameOf = nameIn(plan);
  return [block.label, ...configuredLines(block, nameOf), ...conduitLines(block, nameOf).map((l) => l.text)].join(' — ');
}
