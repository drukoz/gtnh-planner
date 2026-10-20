// The projector payload (spec §3.13, architecture §11.22–§11.23): a project's cached line layout boiled down to what the
// in-game mod draws and checks. Everything that needs the planner's knowledge is decided here, once, in tested
// TypeScript, so the Java side only parses and compares: the real registry name of pseudo part ids (§11.17) and every
// part of a conduit bundle, whether meta or facing mean anything for a block (a single-block machine's output side and
// its own front), the covers on each face, which build steps each block belongs to, and the checklist's numbering of the
// steps. Ghosts (blocks that already exist in the world) are not sent; the mod has nothing to draw or check for them.

import { createHash } from 'node:crypto';
import { mergeBuildSteps } from '../layout/merge.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { BlockRole, ConduitKind, Layout, LayoutBlock } from '../../shared/types/layout.ts';
import type { BlockRef, Machine, MachineKind, Pack } from '../../shared/types/pack.ts';
import type { BuildStep } from '../../shared/types/plan.ts';
import type { Project } from '../../shared/types/project.ts';
import { PROJECTOR_FORMAT, type ProjectorBlock, type ProjectorPayload, type ProjectorStep } from '../../shared/types/projector.ts';

/** What the payload reads from the pack: the names of cover items and the kinds of GT machines. */
export type PayloadPack = Pick<Pack, 'nameOf'> & { machines: ReadonlyMap<number, Pick<Machine, 'kind'>> };

/** Pseudo block id prefixes (`fmp:<part>`, `conduit:<type>`, `ae2cable:<centre>`, §11.17) → the block that holds the part in the world. */
export const CONTAINER_BLOCKS: Readonly<Record<string, string>> = {
  fmp: 'ForgeMultipart:block',
  conduit: 'EnderIO:blockConduitBundle',
  ae2cable: 'appliedenergistics2:tile.BlockCableBus',
};

/** Blocks whose meta is not what the plan chose (a vanilla chest's meta is its orientation), so meta is not compared. */
export const META_FREE_BLOCKS: ReadonlySet<string> = new Set(['minecraft:chest', 'minecraft:trapped_chest']);

/**
 * Roles whose facing the mod checks: GT's front facing (`getFrontFacing()`), which on a single-block machine is its
 * output side; a cable or pipe has no front worth comparing.
 */
export const FACING_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['machine', 'hatch', 'transformer']);

/**
 * Single-block recipe machines (GT `MTEBasicMachine`, steam ones too). Their GT front facing, which the layout turns
 * to the spine and the mod checks, is their output side: GT draws the face overlay on another side, the main facing
 * (`LayoutBlock.mainFacing`, which the layout turns along the row and the payload sends as `mainFacing`), and moves no
 * items or fluids through that one.
 */
export const OUTPUT_FACING_KINDS: ReadonlySet<MachineKind> = new Set<MachineKind>(['basic', 'steam']);

/** What the mod tells the player when the layout has nothing to project. */
export const STATUS_MESSAGES: Readonly<Record<'empty' | 'no-world', string>> = {
  'no-world': 'This project is not placed in the world yet: pick a world scan and base on its Map tab',
  empty: 'Nothing to build yet: this plan places no machines',
};

/** A fluid pipe's label is `<pipe> (<fluid name>)`. */
const FLUID_PIPE_LABEL = /^(.*) \((.*)\)$/;
const PLACED_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['machine', 'casing', 'hatch']);
const LINE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['pipe', 'interface', 'chip_pipe', 'chest']);

/** The block to look for in the world: a pseudo part id becomes its container block with the part named in `part`. */
export function containerBlock(ref: BlockRef): { id: string; part?: string } {
  const colon = ref.id.indexOf(':');
  const prefix = colon < 0 ? '' : ref.id.slice(0, colon);
  const container = Object.hasOwn(CONTAINER_BLOCKS, prefix) ? CONTAINER_BLOCKS[prefix] : undefined;
  return container === undefined ? { id: ref.id } : { id: container, part: ref.id.slice(colon + 1) };
}

/**
 * For each of `layout.blocks` (same index) the id of the build step that places it, or null. The block's own
 * `buildStep` (§11.23: Plan 5 sets it on every layout it builds) wins when that step exists. Otherwise the first rule
 * whose step exists in `layout.buildSteps` decides — the texts follow Plan 5's step texts and block labels:
 * a hookup block → its hookup's step; a machine, casing or hatch with a `stepId` → `layout:place:<stepId>`;
 * a transformer → the first `layout:power:stage:*` step whose text contains `× <label> between`; a cable → the first
 * `layout:power:wire:*` step whose text contains ` with <label> (`; a pipe labelled `<pipe> (<fluid>)` → the first
 * `layout:logistics:fluid:*` step whose text ends with `× <pipe> for <fluid>`; a pipe, interface, chip pipe or chest
 * → `layout:logistics:line`. Ghosts and blocks no rule matches get null.
 */
export function stepMembership(layout: Layout): Array<string | null> {
  const steps = layout.buildSteps;
  const ids = new Set(steps.map((s) => s.id));
  const exists = (id: string | undefined): id is string => id !== undefined && ids.has(id);
  const firstStep = (idPrefix: string, textMatches: (text: string) => boolean): string | undefined =>
    steps.find((s) => s.id.startsWith(idPrefix) && textMatches(s.text))?.id;

  const rules: ReadonlyArray<(b: LayoutBlock) => string | undefined> = [
    (b) => b.buildStep,
    (b) => {
      const kind = b.hookup === undefined ? undefined : layout.hookups[b.hookup]?.kind;
      return kind === undefined ? undefined : `layout:${kind}:hookup`;
    },
    (b) => (PLACED_ROLES.has(b.role) && b.stepId !== undefined ? `layout:place:${b.stepId}` : undefined),
    (b) => (b.role === 'transformer' ? firstStep('layout:power:stage:', (t) => t.includes(`× ${b.label} between`)) : undefined),
    (b) => (b.role === 'cable' ? firstStep('layout:power:wire:', (t) => t.includes(` with ${b.label} (`)) : undefined),
    (b) => {
      const fluidPipe = b.role === 'pipe' ? FLUID_PIPE_LABEL.exec(b.label) : null;
      return fluidPipe === null ? undefined : firstStep('layout:logistics:fluid:', (t) => t.endsWith(`× ${fluidPipe[1]} for ${fluidPipe[2]}`));
    },
    (b) => (LINE_ROLES.has(b.role) ? 'layout:logistics:line' : undefined),
  ];

  return layout.blocks.map((b) => {
    if (b.role === 'ghost') return null;
    for (const rule of rules) {
      const id = rule(b);
      if (exists(id)) return id;
    }
    return null;
  });
}

/** Names the geometry and the step membership, not the ticks, so the mod rebuilds only when blocks move or steps change. */
export function payloadVersion(p: Pick<ProjectorPayload, 'dim' | 'blocks' | 'steps'>): string {
  const text = JSON.stringify([p.dim, p.blocks, p.steps.map((s) => [s.id, s.order, s.blocks])]);
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

/** Whether GT machine `mteId` is a single-block machine, whose checked facing is its output side. */
function isSingleBlockMachine(pack: PayloadPack, mteId: number): boolean {
  const kind = pack.machines.get(mteId)?.kind;
  return kind !== undefined && OUTPUT_FACING_KINDS.has(kind);
}

/**
 * The block as the mod reads it. A single-block machine with a checked output side also sends its front
 * (`mainFacing`); a block of two or more conduits names all of them in `parts` (its `part` is the first, the conduit its
 * pseudo block shows: architecture "EnderIO conduits, granted change requests (add-on 11)").
 */
function projectorBlock(b: LayoutBlock, step: string | null, pack: PayloadPack): ProjectorBlock {
  const { id, part } = containerBlock(b.block);
  const { mteId } = b.block;
  const facing = FACING_ROLES.has(b.role) && mteId !== undefined ? b.facing : undefined;
  const outputSide = facing !== undefined && mteId !== undefined && isSingleBlockMachine(pack, mteId);
  const covers = b.covers ?? [];
  const parts = (b.conduits ?? []).map((c) => c.kind);
  return {
    pos: [...b.pos], id, ...(part === undefined ? {} : { part }), ...(parts.length < 2 ? {} : { parts }),
    // a GT machine is identified by its tile's mte id, a part by its container block, a chest by its name
    meta: mteId !== undefined || part !== undefined || META_FREE_BLOCKS.has(id) ? null : b.block.meta,
    ...(mteId === undefined ? {} : { mteId }),
    ...(facing === undefined ? {} : { facing }),
    ...(outputSide ? { facingIsOutput: true as const } : {}),
    ...(outputSide && b.mainFacing !== undefined ? { mainFacing: b.mainFacing } : {}),
    role: b.role, label: b.label, step,
    ...(covers.length === 0 ? {} : { covers: covers.map((c) => ({ face: FACES.indexOf(c.face), item: c.item, label: pack.nameOf(c.item) })) }),
  };
}

/** The step that lays each kind of conduit in the EnderIO mode: the Item Conduit with the line, ender fluid conduits with the fluids. */
function conduitStep(kind: ConduitKind): string {
  return kind === 'item' ? 'layout:logistics:line' : 'layout:logistics:fluids';
}

/**
 * The steps a block belongs to: the one that places it (`owner`), then, for a conduit bundle of the line (a hookup's
 * conduits belong to their hookup alone), the steps that lay its other conduits, where those steps exist (the audit of the
 * EnderIO In / Out fix: a bundle is laid by the line step and by the fluids step both, so `/planner step` on either shows
 * it, and neither is ticked before it stands).
 */
function blockSteps(b: LayoutBlock, owner: string | null, exists: (id: string) => boolean): string[] {
  const steps = owner === null ? [] : [owner];
  if (b.hookup !== undefined) return steps;
  for (const c of b.conduits ?? []) {
    const id = conduitStep(c.kind);
    if (exists(id) && !steps.includes(id)) steps.push(id);
  }
  return steps;
}

/** The non-ghost blocks in layout order, and for each the steps it belongs to (`blockSteps`). */
function payloadBlocks(layout: Layout, pack: PayloadPack): { blocks: ProjectorBlock[]; steps: string[][] } {
  const owners = stepMembership(layout);
  const ids = new Set(layout.buildSteps.map((s) => s.id));
  const blocks: ProjectorBlock[] = [];
  const steps: string[][] = [];
  layout.blocks.forEach((b, i) => {
    if (b.role === 'ghost') return;
    const owner = owners[i] ?? null;
    blocks.push(projectorBlock(b, owner, pack));
    steps.push(blockSteps(b, owner, (id) => ids.has(id)));
  });
  return { blocks, steps };
}

function payloadSteps(project: Project, checklist: readonly BuildStep[], blockSteps: readonly string[][]): ProjectorStep[] {
  const members = new Map<string, number[]>();
  blockSteps.forEach((ids, i) => {
    for (const id of ids) {
      const list = members.get(id);
      if (list === undefined) members.set(id, [i]);
      else list.push(i);
    }
  });
  return [...checklist].sort((a, b) => a.order - b.order).map((s): ProjectorStep => ({
    id: s.id, order: s.order, kind: s.kind, text: s.text, blocks: members.get(s.id) ?? [],
    done: project.marks[`step:${s.id}`] !== undefined,
  }));
}

/**
 * What `GET /api/projects/:id/projector` sends (spec §3.13): the project's identity, the layout's frame, the non-ghost
 * blocks in layout order, and every step of the project's checklist with the indices of its blocks (none for a step
 * that places nothing, such as gather and craft; a conduit bundle in each step that lays one of its conduits) and
 * whether the checklist shows it done. The steps are numbered as
 * the Steps view numbers them: the plan route's `planFinish` merges `planSteps` (the plan's own steps, before the
 * layout is merged in) with the layout's through `mergeBuildSteps`, so `/planner step <n>` and "Step <n> done" name
 * the number the group's checklist shows. A layout that is not `ok` (`empty`, `no-world`) sends no blocks and no
 * steps, only a `message` for the player. `pack` names the cover items and says which GT machines are single-block
 * ones (`facingIsOutput`).
 */
export function projectorPayload(project: Project, layout: Layout, pack: PayloadPack, planSteps: readonly BuildStep[] = []): ProjectorPayload {
  const status = layout.status ?? 'ok';
  const placed = status === 'ok' ? payloadBlocks(layout, pack) : { blocks: [], steps: [] };
  const { blocks } = placed;
  const steps = status === 'ok' ? payloadSteps(project, mergeBuildSteps(planSteps, layout.buildSteps), placed.steps) : [];
  return {
    format: PROJECTOR_FORMAT, projectId: project.id, name: project.name, rev: project.rev,
    version: payloadVersion({ dim: layout.dim, blocks, steps }), status,
    message: status === 'ok' ? null : STATUS_MESSAGES[status],
    dim: layout.dim, origin: [...layout.origin], size: [...layout.size], blocks, steps,
  };
}
