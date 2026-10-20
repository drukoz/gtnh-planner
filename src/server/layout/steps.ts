// The layout's build steps and parts list (Plan 5 Task 10; spec §3.7, §3.10, architecture §11.13–§11.14, §11.23):
// clear the site, roof it, place the machines, power them through the transformer banks and cable trees, hook up the
// tap, lay the logistics, configure every covered or set block and every EnderIO conduit face with its exact settings,
// reuse owned machines, test.
// Steps link to the numbered pins and keep stable ids, so ticks survive re-plans. The parts list counts every placed
// part and cover by key in its group. Every order and tie-break is fixed, so the same inputs give the same steps.

import { tierName } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { conduitLines, configuredLines } from '../../shared/layout/configure-text.ts';
import { fmtInt, joinNames } from '../../shared/layout/format.ts';
import { SIDE_NAMES, posKey, rotateFacing, step, type Rotation, type Vec3 } from '../../shared/layout/geometry.ts';
import { FACES } from '../../shared/types/assets.ts';
import type { BlockRole, Hookup, LayoutBlock, LayoutStatus, Pin } from '../../shared/types/layout.ts';
import type { BomLine, BuildStep } from '../../shared/types/plan.ts';
import type { HatchKind, PlacedUnit } from './arrange.ts';
import type { StepDraft } from './modes/mode.ts';
import { groupSteps, pinNumber, reuseGroups, type ReuseFind } from './pins.ts';
import type { Stage } from './power.ts';

// ---- Types ----

export interface StepsInput {
  status: LayoutStatus; pins: readonly Pin[]; size: Vec3 /* world */; site: { dig: number; fill: number } | null;
  units: readonly PlacedUnit[]; stages: readonly Stage[]; transformerName: (toTier: number) => string;
  cables: ReadonlyArray<{ tier: number; cable: string; cells: number }>;
  power: { cable: string; blocks: number; amps: number; tier: number; arrivingVolts: number; upgrade?: { cable: string } /* Task 9 `blocked` */ } | null;
  supplyTier: number | null;
  drafts: readonly StepDraft[]; fluids: ReadonlyArray<{ key: StuffKey; name: string; pipe: string; cells: number }>;
  logistics: { kindName: string; part: string; blocks: number } | null; reuse: readonly ReuseFind[];
  blocks: readonly LayoutBlock[] /* world, sorted */; origin: Vec3;
  /** The line's turn into the world: `units` are in its local frame, so a step that names a compass side turns it. */
  rotation: Rotation;
  nameOf: (k: StuffKey) => string;
  // optional addition (plan 12)
  /** A plan step by what it makes (its main output's name), for the place step of a machine several steps share. */
  stepName?: (stepId: string) => string;
}

type Group = NonNullable<BomLine['group']>;
type Draft = Omit<BuildStep, 'order'>;

// ---- Small helpers ----

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function samePos(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** "A", "A or B", "A, B or C". */
function orNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)!}`;
}

/** " at pin <n>", or nothing without that pin. */
function atPin(n: number | undefined): string {
  return n === undefined ? '' : ` at pin ${n}`;
}

function draft(id: string, kind: BuildStep['kind'], pin: number | undefined, text: string): Draft {
  return { id, text, ...(pin === undefined ? {} : { pin }), kind };
}

// ---- Placing ----

/** The order a multiblock's hatches are listed in. */
const HATCH_ORDER: readonly HatchKind[] = ['input_bus', 'output_bus', 'energy', 'steam', 'maintenance', 'input_hatch', 'output_hatch', 'muffler'];

/**
 * The unit's hatch labels: the hatches chosen for it in `HATCH_ORDER` (fluid hatches in the order of the step's fluids
 * they take, one with no fluid of the step last; others in canonical z, x order), then any hatch the exported structure
 * itself holds, in cell order.
 */
function hatchLabels(u: PlacedUnit): string[] {
  const fluids = [...u.io.fluidIn, ...u.io.fluidOut];
  const fluidRank = (c: PlacedUnit['cells'][number]): number => {
    const i = c.fluid === undefined ? -1 : fluids.indexOf(c.fluid);
    return i === -1 ? fluids.length : i;
  };
  const chosen = u.cells
    .filter((c) => c.hatch !== undefined)
    .sort((a, b) => HATCH_ORDER.indexOf(a.hatch!) - HATCH_ORDER.indexOf(b.hatch!) || fluidRank(a) - fluidRank(b)
      || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1]);
  const exported = u.cells.filter((c) => c.role === 'hatch' && c.hatch === undefined);
  return [...chosen, ...exported].map((c) => c.label);
}

/** A singleblock's front when its unit has none: local west, along the row (`singleblockMainFacing` in arrange.ts). */
const WEST = 4;
const UP = 1;

/** Whether the unit holds a Muffler Hatch. */
function hasMuffler(u: PlacedUnit): boolean {
  return u.cells.some((c) => c.hatch === 'muffler');
}

/**
 * What a multiblock's place step adds for its mufflers: GT stops the machine when a muffler finds no air in the cell
 * its front faces (`MTEHatchMuffler.polluteEnvironment`, `POLLUTION_FAIL`). The layout keeps that cell free and counts
 * it in the line's height, but the Layout does not carry it, so the step names it.
 */
function mufflerWords(u: PlacedUnit): string {
  const mufflers = u.cells.filter((c) => c.hatch === 'muffler');
  if (mufflers.length === 0) return '';
  const each = mufflers.length === 1 ? 'its Muffler Hatch' : 'each Muffler Hatch';
  const where = mufflers.every((c) => c.face === UP) ? `the block above ${each}` : `the block ${each} faces`;
  return `; keep ${where} empty, or GregTech stops the machine (a muffler needs air to vent)`;
}

/**
 * How a singleblock gets its two faces (`PlacedUnit.mainFacing`, along the row, and its output side toward the middle
 * row) in GT 5.09.54: a sneaking Wrench click makes the side the wrench grid picks the front
 * (`MTEBasicMachine.setMainFacing`, which turns the output side away when it was there), a plain one makes it the output
 * side (anywhere but the front), and a click on an edge of the grid picks the side beyond that edge
 * (`GTUtility.determineWrenchingSide`), so a side a neighbour covers can be picked too. The front is named by the
 * compass (`front`, already turned into the world): the place steps come before the power steps, so nothing built yet,
 * such as the power head it points along the row to, can name it.
 */
function singleblockFaces(front: string): string {
  return `with its output side facing the middle row and its front facing ${front}: with a Wrench, sneak-right-click its ${front} side to `
    + 'make that the front (where a neighbour covers that side, click the edge of the wrench grid toward it), then right-click its middle-row '
    + 'side to make that the output side';
}

/**
 * What a singleblock that takes `what` (its items, its fluids, or both) through its output side adds to its place step:
 * that side takes them only while GT's Input from Output Side is allowed (`MTEBasicMachine.allowPutStack` for items,
 * `isLiquidInput` for fluids). Every `MTEBasicMachine` constructor turns it on, but a machine broken and placed again
 * may have it off (its item's NBT has no `mAllowInputFromOutputSide`, which `loadNBTData` reads as false). A Screwdriver
 * switches it only on the output side or the front, on the side clicked itself (`BaseMetaTileEntity.onRightclick`
 * passes no wrench-grid side), and also works the cover on that side; the front faces the machine beside it along the
 * row. So the check is on the middle-row side while nothing stands in the middle row yet, before any pipe, conduit or
 * interface there and before its configure step puts a cover on that side.
 */
function checkInputSide(what: string): string {
  return `; it takes its ${what} through that side, which needs Input from Output Side allowed: a newly crafted machine has it, `
    + "but one broken and placed again may not, so while the middle row is still empty right-click such a machine's middle-row side with a "
    + 'Screwdriver, not sneaking (a sneak-click switches the Input Filter), and once more if the chat says "Input from Output Side forbidden"';
}

/** Up: a venting steam singleblock's output side (`PlacedUnit.outputSide`). */
const OUTPUT_UP = 1;

/**
 * An Auto Workbench's place step (plan 12 Task 6, research machine-feeding §1.3.5 and §3.7): GT++'s bench pushes what it
 * makes out of its back, the face with the pipe overlay, and takes EU on every other face; a Wrench click makes the face
 * clicked its front; its tank fills from any fluid that reaches it, which it puts in its input slots. So its back meets
 * the middle row, its front faces away from it, where the power cable comes in, and no fluid pipe touches it.
 */
function benchPlaceText(u: PlacedUnit, n: number): string {
  return `Place ${fmtInt(n)}× ${u.name} with its back, the face with the pipe opening (the front shows a crafting grid), toward the middle row: `
    + 'with a Wrench, right-click its side away from the middle row to make that its front; run its power cable to the front or a side, never the '
    + 'back, and keep fluid pipes off it';
}

/**
 * A venting steam singleblock's place step (architecture §11 entry 48; worded as add-on 15's machine-to-machine one):
 * GT vents its steam through its output side after every run and starts the next only once it could
 * (`MTEBasicMachineBronze.allowToCheckRecipe`: no cover there and no block with a hit box in front of it), so that side
 * faces up over an empty block. A basic machine's wrench clicks set both sides; its steam goes in at its back, which
 * the layout keeps free (GT takes steam on every side but the front: `MTEBasicMachineBronze.isLiquidInput`).
 */
function steamPlaceText(u: PlacedUnit, n: number, front: string): string {
  return `Place ${fmtInt(n)}× ${u.name} with its output side facing up and nothing above it (GregTech vents its steam there after every run, `
    + `and waits while that side is covered or blocked) and its front facing ${front}: with a Wrench, sneak-right-click its ${front} side to make `
    + 'that the front (where a neighbour covers that side, click the edge of the wrench grid toward it), then right-click its top to make that the '
    + 'output side; pipe its steam into its back, the side away from the middle row';
}

/**
 * The roof step (gt-mechanics §3.4: GT machines left in the rain can catch fire or explode). The line's height `h`
 * counts the cells a roof must leave open (layout.ts): the block a Muffler Hatch faces and the block above each venting
 * steam machine (`PlacedUnit.outputSide` up), where GT vents its steam after every run and waits while it is blocked
 * (`MTEBasicMachineBronze.allowToCheckRecipe`); so with either the step names that height and says to keep them open.
 */
function roofText(units: readonly PlacedUnit[], h: number): string {
  const muffler = units.some(hasMuffler);
  const vent = units.some((u) => u.outputSide === OUTPUT_UP);
  if (!muffler && !vent) return 'Roof the line: GT machines left in the rain can catch fire or explode';
  const why = [...(muffler ? ['a Muffler Hatch needs the block it faces kept empty'] : []),
    ...(vent ? ['each steam machine vents its steam through its top: keep the block above it open and roof above it'] : [])];
  return `Roof the line over its ${fmtInt(h)}-high space: GT machines left in the rain can catch fire or explode, `
    + `${why.length === 1 ? `and ${why[0]!}` : `${why[0]!}, and ${why[1]!}`}`;
}

/**
 * What a multiblock run by hand (`PlacedUnit.manual`: a Bricked Blast Furnace or a Coke Oven) adds to its place step:
 * it stands one block back from the middle row, its front row kept free, so you reach its controller and nothing of
 * the line touches it.
 */
const MANUAL_PLACE = ', one block back from it, and keep the blocks in front of it free: it gets no hatches, covers, pipes or power, as you '
  + 'fill and empty it by hand through its controller';

/**
 * The plan steps whose machines take fluids through their output side: those an ender fluid conduit face inserts into
 * with `outputSide` (the EnderIO mode meets a GT basic machine's fluids there; every other mode pipes them in on top).
 */
function fluidsThroughOutputSide(blocks: readonly LayoutBlock[]): Set<string> {
  const machineAt = new Map(blocks.filter((b) => b.role === 'machine' && b.stepId !== undefined).map((b) => [posKey(b.pos), b.stepId!]));
  const steps = new Set<string>();
  for (const b of blocks) {
    if (b.role === 'ghost') continue;
    for (const c of b.conduits ?? []) {
      if (c.kind === 'item') continue;
      for (const f of c.faces) {
        const stepId = f.insert?.outputSide === true ? machineAt.get(posKey(step(b.pos, FACES.indexOf(f.face)))) : undefined;
        if (stepId !== undefined) steps.add(stepId);
      }
    }
  }
  return steps;
}

/**
 * One step per placed plan step, in unit order: how many to place and which way they face — a singleblock's output
 * side and its front, which GT keeps apart, how to set both and, when it takes items, or fluids through its output side
 * (`fluidSteps`), how to check Input from Output Side (a venting steam machine's output side faces up instead:
 * `steamPlaceText`); a multiblock's size, controller and hatches and the block each of its mufflers needs empty
 * (`mufflerWords`), or for one run by hand where it stands (`MANUAL_PLACE`). The front's compass side is turned by
 * `rotation`.
 */
function placeSteps(units: readonly PlacedUnit[], sitePin: number | undefined, rotation: Rotation, fluidSteps: ReadonlySet<string>,
  stepName: (stepId: string) => string): Draft[] {
  const byStep = new Map<string, { first: PlacedUnit; n: number }>();
  for (const u of units) {
    const seen = byStep.get(u.stepId);
    if (seen === undefined) byStep.set(u.stepId, { first: u, n: 1 });
    else seen.n += 1;
  }
  return [...byStep].map(([stepId, { first: u, n }]) => {
    // a machine several steps share (plan 12) says which it runs
    const runs = u.stepIds === undefined ? '' : `; it runs ${joinNames(u.stepIds.map(stepName))}`;
    if (u.bench !== undefined) return draft(`layout:place:${stepId}`, 'place', sitePin, benchPlaceText(u, n));
    if (!u.multiblock) {
      const front = SIDE_NAMES[rotateFacing(u.mainFacing ?? WEST, rotation)]!;
      if (u.outputSide === OUTPUT_UP) return draft(`layout:place:${stepId}`, 'place', sitePin, `${steamPlaceText(u, n, front)}${runs}`);
      const fluids = fluidSteps.has(stepId);
      const what = u.io.itemIn && fluids ? 'items and fluids' : u.io.itemIn ? 'items' : fluids ? 'fluids' : null;
      return draft(`layout:place:${stepId}`, 'place', sitePin,
        `Place ${fmtInt(n)}× ${u.name} ${singleblockFaces(front)}${what === null ? '' : checkInputSide(what)}${runs}`);
    }
    const labels = hatchLabels(u);
    const hatches = labels.length === 0 ? '' : `; hatches: ${labels.join(', ')}`;
    return draft(`layout:place:${stepId}`, 'place', sitePin,
      `Build ${fmtInt(n)}× ${u.name} (${u.size.map(fmtInt).join('×')}) with the controller facing the middle row`
        + `${u.manual === undefined ? `${hatches}${mufflerWords(u)}` : MANUAL_PLACE}${runs}`);
  });
}

// ---- Power ----

function powerSteps(input: StepsInput, sitePin: number | undefined, powerPin: number | undefined): Draft[] {
  const out: Draft[] = [];
  // from the supply down
  for (const s of [...input.stages].sort((a, b) => b.fromTier - a.fromTier)) {
    const from = tierName(s.fromTier), to = tierName(s.toTier);
    out.push(draft(`layout:power:stage:${s.toTier}`, 'power', powerPin,
      `Place ${fmtInt(s.count)}× ${input.transformerName(s.toTier)} between the ${from} and ${to} cables, front (input) toward ${from}`));
  }
  // GT joins a cable to the block it is placed against, so two tiers must never touch (spec §3.5)
  const tiers = input.cables.map((c) => c.tier);
  for (const c of input.cables) {
    const lower = tiers.filter((t) => t < c.tier), higher = tiers.filter((t) => t > c.tier);
    const apart = tiers.length < 2 ? '' : lower.length > 0
      ? `; connect only the drawn sides, and never let the ${tierName(c.tier)} cables touch the ${orNames(lower.map(tierName))} cables`
      : `; connect only the drawn sides, and never let the ${orNames(higher.map(tierName))} cables touch the ${tierName(c.tier)} cables`;
    out.push(draft(`layout:power:wire:${c.tier}`, 'power', sitePin, `Wire the ${tierName(c.tier)} machines with ${c.cable} (${fmtInt(c.cells)} blocks)${apart}`));
  }
  if (input.supplyTier !== null) {
    const p = input.power;
    const text = p === null
      ? `No power network found: feed the line from your own ${tierName(input.supplyTier)} supply (see the power suggestions)`
      : p.upgrade !== undefined
        ? `Upgrade the ${p.upgrade.cable} from the tap${atPin(powerPin)} to carry ${fmtInt(p.amps)} A, then connect the line`
        : `Run ${fmtInt(p.blocks)}× ${p.cable} from the tap${atPin(powerPin)} to the line: up to ${fmtInt(p.amps)} A at ${tierName(p.tier)}, `
          + `arriving at ${fmtInt(p.arrivingVolts)} V`;
    out.push(draft('layout:power:hookup', 'power', powerPin, text));
  }
  return out;
}

// ---- Configure ----

/**
 * Architecture §11.14: one step per configured block (non-ghost, with covers or settings), in block order, written by
 * the shared formatter. Blocks of one plan step with the same label and settings share a step
 * (`layout:configure:<stepId>`, then `:2`, `:3`, …); any other block is its own step, named by its position
 * relative to `origin`. Hookup blocks point at the logistics pin, the others at the site pin.
 */
function configureSteps(input: StepsInput, sitePin: number | undefined, logisticsPin: number | undefined): Draft[] {
  interface Entry { id: string; label: string; lines: string[]; n: number; pin: number | undefined }
  const entries: Entry[] = [];
  const shared = new Map<string, Entry>();
  const perStep = new Map<string, number>();
  for (const b of input.blocks) {
    if (b.role === 'ghost') continue;
    const lines = configuredLines(b, input.nameOf);
    if (lines.length === 0) continue;
    const pin = b.hookup === undefined ? sitePin : logisticsPin;
    if (b.stepId === undefined) {
      const rel: Vec3 = [b.pos[0] - input.origin[0], b.pos[1] - input.origin[1], b.pos[2] - input.origin[2]];
      entries.push({ id: `layout:configure:${posKey(rel)}`, label: b.label, lines, n: 1, pin });
      continue;
    }
    const key = JSON.stringify([b.stepId, b.label, b.hookup !== undefined, lines]);
    const same = shared.get(key);
    if (same !== undefined) {
      same.n += 1;
      continue;
    }
    const k = (perStep.get(b.stepId) ?? 0) + 1;
    perStep.set(b.stepId, k);
    const entry: Entry = { id: k === 1 ? `layout:configure:${b.stepId}` : `layout:configure:${b.stepId}:${k}`, label: b.label, lines, n: 1, pin };
    shared.set(key, entry);
    entries.push(entry);
  }
  return entries.map((e) => draft(e.id, 'configure', e.pin, `${e.label}${e.n > 1 ? ` ×${fmtInt(e.n)}` : ''}: ${e.lines.join('; ')}`));
}

/**
 * Architecture "EnderIO conduits, granted change requests (add-on 11)": one step per face of every conduit of every
 * non-ghost block, in block, bundle and face order, written by the shared formatter
 * (`layout:conduit:<position relative to origin>:<conduit kind>:<face>`). Hookup blocks point at the logistics pin, the
 * others at the site pin.
 */
function conduitSteps(input: StepsInput, sitePin: number | undefined, logisticsPin: number | undefined): Draft[] {
  return input.blocks.flatMap((b) => {
    if (b.role === 'ghost') return [];
    const rel: Vec3 = [b.pos[0] - input.origin[0], b.pos[1] - input.origin[1], b.pos[2] - input.origin[2]];
    const pin = b.hookup === undefined ? sitePin : logisticsPin;
    return conduitLines(b, input.nameOf).map((l) => draft(`layout:conduit:${posKey(rel)}:${l.kind}:${l.face}`, 'configure', pin, l.text));
  });
}

// ---- Steps ----

/**
 * The pin of a reuse find: the reuse pin `makePins` put at its nearest machine, found by kind and position (a pin of a
 * machine several steps share says so in its text, plan 12).
 */
function reusePin(pins: readonly Pin[], find: ReuseFind): number | undefined {
  const at = find.positions[0];
  if (at === undefined) return undefined;
  return pins.find((p) => p.kind === 'reuse' && samePos(p.pos, at))?.n;
}

/**
 * One hook step per reuse pin (`reuseGroups`; a find without a machine found its own), id `layout:reuse:<step>` of its
 * first find (`:<mteId>` added for an owned machine of another option, `ReuseFind.otherMteId`, so ids stay unique): hook
 * the machines into the line's logistics; for a machine several steps share (plan 12), which steps it serves, by what
 * they make, in find order.
 */
function reuseSteps(finds: readonly ReuseFind[], pins: readonly Pin[]): Draft[] {
  return reuseGroups(finds).map(({ finds: group }) => {
    const first = group[0]!;
    const pin = reusePin(pins, first);
    const steps = groupSteps(group);
    const products = steps.map((id) => group.find((f) => f.stepId === id)?.product ?? id);
    const serves = steps.length > 1 ? `; it serves ${fmtInt(steps.length)} steps: ${products.join(', ')}` : '';
    return draft(`layout:reuse:${first.stepId}${first.otherMteId === undefined ? '' : `:${first.otherMteId}`}`, 'logistics', pin,
      `Hook your ${fmtInt(first.count)}× ${first.name}${atPin(pin)} into the line's logistics${serves}`);
  });
}

/**
 * Spec §3.10: the layout's build steps in building order, linked to the pins (no pins, no pin numbers). A layout with
 * nothing to place (`empty`) only asks to hook up the owned machines.
 */
export function layoutSteps(input: StepsInput): BuildStep[] {
  const { pins } = input;
  const sitePin = pinNumber(pins, 'site'), powerPin = pinNumber(pins, 'power'), logisticsPin = pinNumber(pins, 'logistics');
  const kindPin = (kind: StepDraft['pin']): number | undefined => (kind === null ? undefined : pinNumber(pins, kind));
  const steps: Draft[] = [];
  const placing = input.status !== 'empty';

  if (placing) {
    const [w, h, l] = input.size;
    const level = input.site !== null && (input.site.dig > 0 || input.site.fill > 0)
      ? `; dig ${fmtInt(input.site.dig)} and fill ${fmtInt(input.site.fill)} blocks to level it` : '';
    steps.push(draft('layout:site', 'place', sitePin,
      `Clear a ${fmtInt(w)}×${fmtInt(l)} spot${atPin(sitePin)} (${fmtInt(h)} high) and keep a 1-block path around it${level}`));
    steps.push(draft('layout:roof', 'place', sitePin, roofText(input.units, h)));
    steps.push(...placeSteps(input.units, sitePin, input.rotation, fluidsThroughOutputSide(input.blocks), input.stepName ?? ((id) => id)));
    steps.push(...powerSteps(input, sitePin, powerPin));
    for (const d of input.drafts) if (d.kind === 'logistics') steps.push(draft(d.id, d.kind, kindPin(d.pin), d.text));
    for (const f of input.fluids) {
      // the pump covers get their own configure steps
      steps.push(draft(`layout:logistics:fluid:${f.key}`, 'logistics', sitePin, `Lay ${fmtInt(f.cells)}× ${f.pipe} for ${f.name}`));
    }
    if (input.logistics !== null) {
      const g = input.logistics;
      steps.push(draft('layout:logistics:hookup', 'logistics', logisticsPin,
        `Connect the line to your ${g.kindName} network${atPin(logisticsPin)}: ${fmtInt(g.blocks)}× ${g.part}`));
    }
    steps.push(...configureSteps(input, sitePin, logisticsPin));
    steps.push(...conduitSteps(input, sitePin, logisticsPin));
    // settings on blocks the line does not place (e.g. the EnderIO extract face)
    for (const d of input.drafts) if (d.kind === 'configure') steps.push(draft(d.id, d.kind, kindPin(d.pin), d.text));
  }
  steps.push(...reuseSteps(input.reuse, pins));
  if (placing) {
    steps.push(draft('layout:test', 'test', sitePin, 'Switch on and check: every machine has power, none is fed above its tier, items reach the output'));
  }
  return steps.map((s, i): BuildStep => ({ id: s.id, order: i + 1, text: s.text, ...(s.pin === undefined ? {} : { pin: s.pin }), kind: s.kind }));
}

// ---- Owning steps (ruling R7, architecture §11.23) ----

const LINE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['pipe', 'interface', 'chip_pipe', 'chest']);
const PLACED_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(['machine', 'casing', 'hatch']);

/**
 * Each block with `buildStep` = the id of the step that places it, for the in-game projector: the first rule whose
 * step exists wins — a hookup block its hookup's step; a machine, casing or hatch its `layout:place:<stepId>`; a
 * transformer the stage whose transformer has its label; a cable the wire step whose cable has its label; a fluid pipe
 * (`<pipe> (<fluid name>)`) its fluid's step; a block whose conduits are all fluid conduits `layout:logistics:fluids`
 * (architecture "EnderIO conduits, granted change requests (add-on 11)"); a pipe, interface, chip pipe or chest the
 * `layout:logistics:line` step. Ghosts and blocks no rule matches get none. The input blocks are not changed.
 */
export function assignBuildSteps(blocks: readonly LayoutBlock[], steps: readonly BuildStep[],
  input: Pick<StepsInput, 'cables' | 'stages' | 'transformerName' | 'fluids'>, hookups: readonly Hookup[]): LayoutBlock[] {
  const ids = new Set(steps.map((s) => s.id));
  const has = (id: string | undefined): id is string => id !== undefined && ids.has(id);
  const owner = (b: LayoutBlock): string | undefined => {
    if (b.role === 'ghost') return undefined;
    const candidates: Array<string | undefined> = [];
    if (b.hookup !== undefined) {
      const kind = hookups[b.hookup]?.kind;
      candidates.push(kind === undefined ? undefined : `layout:${kind}:hookup`);
    }
    if (PLACED_ROLES.has(b.role) && b.stepId !== undefined) candidates.push(`layout:place:${b.stepId}`);
    if (b.role === 'transformer') {
      const stage = input.stages.find((s) => input.transformerName(s.toTier) === b.label);
      candidates.push(stage === undefined ? undefined : `layout:power:stage:${stage.toTier}`);
    }
    if (b.role === 'cable') {
      const run = input.cables.find((c) => c.cable === b.label);
      candidates.push(run === undefined ? undefined : `layout:power:wire:${run.tier}`);
    }
    if (b.role === 'pipe') {
      const fluid = input.fluids.find((f) => `${f.pipe} (${f.name})` === b.label);
      candidates.push(fluid === undefined ? undefined : `layout:logistics:fluid:${fluid.key}`);
    }
    if (b.conduits !== undefined && b.conduits.length > 0 && b.conduits.every((c) => c.kind !== 'item')) candidates.push('layout:logistics:fluids');
    if (LINE_ROLES.has(b.role)) candidates.push('layout:logistics:line');
    return candidates.find(has);
  };
  return blocks.map((b): LayoutBlock => {
    const { buildStep: _old, ...rest } = b;
    const id = owner(b);
    return id === undefined ? rest : { ...rest, buildStep: id };
  });
}

// ---- Parts ----

/** Why a placed part is on the list and its group (architecture §11.13); `hookupWhy` for a part of a hookup. */
const BLOCK_PARTS: Partial<Readonly<Record<BlockRole, { why: string; hookupWhy?: string; group: Group }>>> = {
  cable: { why: 'line wiring', hookupWhy: 'power hookup', group: 'power' },
  transformer: { why: 'transformers', group: 'power' },
  hatch: { why: 'hatches (replace casings)', group: 'machines' },
  pipe: { why: 'pipes in the line', hookupWhy: 'logistics hookup', group: 'logistics' },
  interface: { why: 'logistics parts', hookupWhy: 'logistics hookup', group: 'logistics' },
  chip_pipe: { why: 'logistics parts', hookupWhy: 'logistics hookup', group: 'logistics' },
  chest: { why: 'chests', group: 'logistics' },
};

/**
 * The parts of a block's conduits (architecture "EnderIO conduits, granted change requests (add-on 11)"): each conduit
 * once, the filter upgrade of every side of their faces once (an ender fluid conduit's own filter is no part), and the
 * speed upgrades of every extract side.
 */
function conduitParts(b: LayoutBlock): Array<{ key: StuffKey; amount: number; why: string }> {
  return (b.conduits ?? []).flatMap((c) => [
    { key: c.item, amount: 1, why: b.hookup === undefined ? 'conduits' : 'logistics hookup' },
    ...c.faces.flatMap((f) => [
      ...[f.extract?.filter, f.insert?.filter].flatMap((filter) => (filter?.item === undefined ? [] : [{ key: filter.item, amount: 1, why: 'conduit filters' }])),
      ...(f.extract?.speed === undefined ? [] : [{ key: f.extract.speed.item, amount: f.extract.speed.count, why: 'conduit speed upgrades' }]),
    ]),
  ]);
}

/**
 * Spec §3.10: every cable, transformer, hatch the line chose (`LayoutBlock.hatch`), pipe, interface, chip pipe and chest
 * the layout places (machines, casings and the hatches an exported structure holds are on Plan 2's build list, which
 * lists those at the lowest tier of their class, plan 12; ghosts are there already) and one per cover of every non-ghost
 * block, plus `extra`, by key: amounts summed, the distinct whys sorted and joined with "; ", the first group set; sorted
 * by key. A non-ghost block with conduits lists its `conduitParts` (group `logistics`) instead of its item.
 */
export function bomFromBlocks(blocks: readonly LayoutBlock[], extra: readonly BomLine[]): BomLine[] {
  const lines = new Map<StuffKey, { amount: number; whys: Set<string>; group: Group | undefined }>();
  const add = (key: StuffKey, amount: number, why: string, group: Group | undefined): void => {
    let line = lines.get(key);
    if (line === undefined) {
      line = { amount: 0, whys: new Set(), group };
      lines.set(key, line);
    }
    line.amount += amount;
    if (why !== '') line.whys.add(why);
    line.group ??= group;
  };
  for (const b of blocks) {
    const part = BLOCK_PARTS[b.role];
    // a conduit block's item is its first conduit's, which its conduit parts already count
    if (b.role !== 'ghost' && b.conduits !== undefined) {
      for (const l of conduitParts(b)) add(l.key, l.amount, l.why, 'logistics');
    } else if (part !== undefined && b.item !== undefined && (b.role !== 'hatch' || b.hatch !== undefined)) {
      add(b.item, 1, b.hookup !== undefined ? part.hookupWhy ?? part.why : part.why, part.group);
    }
    if (b.role !== 'ghost') for (const c of b.covers ?? []) add(c.item, 1, 'covers', 'logistics');
  }
  for (const l of extra) add(l.key, l.amount, l.why, l.group);
  return [...lines]
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, l]): BomLine => ({ key, amount: l.amount, why: [...l.whys].sort(compareText).join('; '), ...(l.group === undefined ? {} : { group: l.group }) }));
}
