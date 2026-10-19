// The layout's build steps and parts list (Plan 5 Task 10; spec §3.7, §3.10, architecture §11.13–§11.14, §11.23):
// clear the site, roof it, place the machines, power them through the transformer banks and cable trees, hook up the
// tap, lay the logistics, configure every covered or set block with its exact settings, reuse owned machines, test.
// Steps link to the numbered pins and keep stable ids, so ticks survive re-plans. The parts list counts every placed
// part and cover by key in its group. Every order and tie-break is fixed, so the same inputs give the same steps.

import { tierName } from '../../shared/gt/tiers.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { configuredLines } from '../../shared/layout/configure-text.ts';
import { fmtInt } from '../../shared/layout/format.ts';
import { posKey, type Vec3 } from '../../shared/layout/geometry.ts';
import type { BlockRole, Hookup, LayoutBlock, LayoutStatus, Pin } from '../../shared/types/layout.ts';
import type { BomLine, BuildStep } from '../../shared/types/plan.ts';
import type { HatchKind, PlacedUnit } from './arrange.ts';
import type { StepDraft } from './modes/mode.ts';
import { pinNumber, reuseText, type ReuseFind } from './pins.ts';
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
  blocks: readonly LayoutBlock[] /* world, sorted */; origin: Vec3; nameOf: (k: StuffKey) => string;
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

/** " at pin <n>", or nothing without that pin. */
function atPin(n: number | undefined): string {
  return n === undefined ? '' : ` at pin ${n}`;
}

function draft(id: string, kind: BuildStep['kind'], pin: number | undefined, text: string): Draft {
  return { id, text, ...(pin === undefined ? {} : { pin }), kind };
}

// ---- Placing ----

/** The order a multiblock's hatches are listed in. */
const HATCH_ORDER: readonly HatchKind[] = ['input_bus', 'output_bus', 'energy', 'maintenance', 'input_hatch', 'output_hatch'];

/**
 * The unit's hatch labels: the hatches chosen for it in `HATCH_ORDER` (fluid hatches in the canonical z, x order they
 * were given their fluids), then any hatch the exported structure itself holds, in cell order.
 */
function hatchLabels(u: PlacedUnit): string[] {
  const chosen = u.cells
    .filter((c) => c.hatch !== undefined)
    .sort((a, b) => HATCH_ORDER.indexOf(a.hatch!) - HATCH_ORDER.indexOf(b.hatch!) || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0]);
  const exported = u.cells.filter((c) => c.role === 'hatch' && c.hatch === undefined);
  return [...chosen, ...exported].map((c) => c.label);
}

/** One step per placed plan step, in unit order: how many to place and, for a multiblock, its size and hatches. */
function placeSteps(units: readonly PlacedUnit[], sitePin: number | undefined): Draft[] {
  const byStep = new Map<string, { first: PlacedUnit; n: number }>();
  for (const u of units) {
    const seen = byStep.get(u.stepId);
    if (seen === undefined) byStep.set(u.stepId, { first: u, n: 1 });
    else seen.n += 1;
  }
  return [...byStep].map(([stepId, { first: u, n }]) => {
    if (!u.multiblock) return draft(`layout:place:${stepId}`, 'place', sitePin, `Place ${fmtInt(n)}× ${u.name} facing the middle row`);
    const labels = hatchLabels(u);
    const hatches = labels.length === 0 ? '' : `; hatches: ${labels.join(', ')}`;
    return draft(`layout:place:${stepId}`, 'place', sitePin,
      `Build ${fmtInt(n)}× ${u.name} (${u.size.map(fmtInt).join('×')}) with the controller facing the middle row${hatches}`);
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
  for (const c of input.cables) {
    out.push(draft(`layout:power:wire:${c.tier}`, 'power', sitePin, `Wire the ${tierName(c.tier)} machines with ${c.cable} (${fmtInt(c.cells)} blocks)`));
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

// ---- Steps ----

/** The pin of a reuse find: the reuse pin `makePins` put at its nearest machine. */
function reusePin(pins: readonly Pin[], find: ReuseFind): number | undefined {
  const at = find.positions[0];
  if (at === undefined) return undefined;
  const text = reuseText(find);
  return pins.find((p) => p.kind === 'reuse' && samePos(p.pos, at) && p.text === text)?.n;
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
    // gt-mechanics §3.4
    steps.push(draft('layout:roof', 'place', sitePin, 'Roof the line: GT machines left in the rain can catch fire or explode'));
    steps.push(...placeSteps(input.units, sitePin));
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
    // settings on blocks the line does not place (e.g. the EnderIO extract face)
    for (const d of input.drafts) if (d.kind === 'configure') steps.push(draft(d.id, d.kind, kindPin(d.pin), d.text));
  }
  for (const r of input.reuse) {
    const pin = reusePin(pins, r);
    steps.push(draft(`layout:reuse:${r.stepId}`, 'logistics', pin, `Hook your ${fmtInt(r.count)}× ${r.name}${atPin(pin)} into the line's logistics`));
  }
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
 * (`<pipe> (<fluid name>)`) its fluid's step; a pipe, interface, chip pipe or chest the `layout:logistics:line` step.
 * Ghosts and blocks no rule matches get none. The input blocks are not changed.
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
 * Spec §3.10: every cable, transformer, hatch, pipe, interface, chip pipe and chest the layout places (machines and
 * casings are on Plan 2's build list; ghosts are there already) and one per cover of every non-ghost block, plus
 * `extra`, by key: amounts summed, the distinct whys sorted and joined with "; ", the first group set; sorted by key.
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
    if (part !== undefined && b.item !== undefined) add(b.item, 1, b.hookup !== undefined ? part.hookupWhy ?? part.why : part.why, part.group);
    if (b.role !== 'ghost') for (const c of b.covers ?? []) add(c.item, 1, 'covers', 'logistics');
  }
  for (const l of extra) add(l.key, l.amount, l.why, l.group);
  return [...lines]
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, l]): BomLine => ({ key, amount: l.amount, why: [...l.whys].sort(compareText).join('; '), ...(l.group === undefined ? {} : { group: l.group }) }));
}
