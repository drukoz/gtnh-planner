// What the routed, AE2 and EnderIO lines leave to your hands (architecture §11 entry 48; Plan 5 follow-ups 7 and 8): a
// Bricked Blast Furnace, which GT lets nothing automated fill, or a Coke Oven, which GT fills only through its own Coke
// Oven Hatch, one the layout does not lay (`Unit.manual`, multiblock-rules.ts), gets a step that says what to fill it
// with and from where, and one that says where what it makes goes. In AE2 mode a steam machine's output is taken out by
// hand too: no ME interface gets it back, as GT lets no conveyor cover onto a steam machine and it never pushes out
// what it makes (`MTEBasicMachineBronze.allowCoverOnSide` takes only covers allowed on primitive blocks, and its
// `doesAutoOutput` is false), so it gets that second step and a `steam_items` warning. In the other two modes the Item
// Extractor Chip and the item conduit pull it out of the steam machine's middle-row side, which GT lets give its output
// (`MTEBasicMachine.allowPullStack`: any side but the front, through `ISidedInventory.canExtractItem`, which Project
// Red's `InvWrapper` and EnderIO's `NetworkedInventory` ask). A good comes from or goes to your storage (raw inputs,
// final outputs, byproducts), the line (its output or input chest, in AE2 mode your ME system; a fluid at the end of
// the line), another machine run by hand, or one of your machines the line does not place. Every order is fixed: steps
// in unit order, goods in the order the step lists them.

import { isFluidKey, type StuffKey } from '../../../shared/keys.ts';
import { fmtInt, joinNames } from '../../../shared/layout/format.ts';
import type { LogisticsMode, PlanFlow, PlanStep, PlanWarning } from '../../../shared/types/plan.ts';
import type { PlacedUnit } from '../arrange.ts';
import { placedStepIds, type ModeInput, type ModeResult, type StepDraft } from './mode.ts';

/** The modes whose lines run GT's primitive machines by these rules (machine to machine is add-on 15's). */
export type HandMode = Exclude<LogisticsMode, 'direct'>;

/** Where the line's own goods wait for you (`from`), and where you put the goods it takes from you (`into`). */
const LINE_PLACES: Readonly<Record<HandMode, { from: string; into: string }>> = {
  routed: { from: 'the output chest', into: 'the input chest' },
  enderio: { from: 'the output chest', into: 'the input chest' },
  ae2: { from: 'your ME system', into: 'your ME system' },
};
/** Where a fluid enters or leaves the line: its pipe's or conduit's open end at the tail. */
const LINE_END = 'the end of the line';
const STORAGE = 'your storage';

/** A plan step's units: its machine's name, how many and the first of them. */
interface StepUnits { name: string; count: number; unit: PlacedUnit }

/** A whole number with thousands separators, anything else to two decimals. */
function amountText(n: number): string {
  return Number.isInteger(n) ? fmtInt(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "A", "A or B", "A, B or C". */
function orList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)!}`;
}

/** Each key of `list` once, in the order first seen, with its amounts summed. */
function perKey(list: PlanStep['inputs']): Array<{ key: StuffKey; amount: number }> {
  const sums = new Map<StuffKey, number>();
  for (const p of list) sums.set(p.key, (sums.get(p.key) ?? 0) + p.amount);
  return [...sums].map(([key, amount]) => ({ key, amount }));
}

/**
 * `<good> <word> <place>` for each good, joined; or `<word> <place>` once when every good has the same one (`one`
 * names the goods then: `null` leaves them out).
 */
function placesText(goods: ReadonlyArray<{ name: string; places: readonly string[] }>, word: string, one: string | null, join: (parts: string[]) => string): string {
  const all = goods.map((g) => orList(g.places));
  if (all.every((p) => p === all[0])) return `${one === null ? '' : `${one} `}${word} ${all[0]!}`;
  return join(goods.map((g, i) => `${g.name} ${word} ${all[i]!}`));
}

/**
 * The hand steps and warnings of `input`'s line in `mode`: for each step run by hand, in unit order, a fill step
 * (`layout:hand:<step>:fill`, per run, with where each input comes from) and an empty step (`layout:hand:<step>:empty`,
 * with where each output goes); in AE2 mode, for each venting steam step that makes items, `steam_items` and its empty
 * step.
 */
export function handSteps(input: ModeInput, mode: HandMode): { drafts: StepDraft[]; warnings: PlanWarning[] } {
  const { pack, plan, placement } = input;
  const nameOf = (k: StuffKey): string => plan.names?.[k] ?? pack.nameOf(k);
  const placed = placedStepIds(placement);
  const steps = new Map<string, StepUnits>();
  for (const u of placement.units) {
    const seen = steps.get(u.stepId);
    if (seen === undefined) steps.set(u.stepId, { name: u.name, count: 1, unit: u });
    else seen.count += 1;
  }
  const line = LINE_PLACES[mode];
  const machineWord = (s: StepUnits): string => (s.count === 1 ? `the ${s.name}` : `each ${s.name}`);
  /** Where the far end of a flow is, for the hand-run (or steam) machine at its near end; `lineWord` for the line's goods. */
  const place = (end: string, key: StuffKey, lineWord: string): string => {
    if (end === 'raw' || end === 'out' || end === 'sink') return STORAGE;
    const other = steps.get(end);
    if (other !== undefined && other.unit.manual !== undefined) return machineWord(other);
    if (placed.has(end)) return isFluidKey(key) ? LINE_END : lineWord;
    // a step the line places no machine for: one of your machines, else crafting or smelting you do yourself
    const owned = plan.steps.find((s) => s.id === end);
    return owned === undefined || owned.handCraft || owned.machine.mteId < 0 ? STORAGE : `your ${owned.machine.name}`;
  };
  /** The places of the far ends of `flows`, each once in flow order; your storage when no flow carries the good. */
  const placesOf = (flows: readonly PlanFlow[], end: (f: PlanFlow) => string, lineWord: string): string[] => {
    const words = [...new Set(flows.map((f) => place(end(f), f.key, lineWord)))];
    return words.length === 0 ? [STORAGE] : words;
  };
  const who = (s: StepUnits): string => (s.count === 1 ? `the ${s.name}` : `each ${s.name} (${fmtInt(s.count)}×)`);

  const drafts: StepDraft[] = [];
  const warnings: PlanWarning[] = [];
  const emptyStep = (stepId: string, s: StepUnits, keys: readonly StuffKey[]): void => {
    const goods = keys.map((key) => ({ name: nameOf(key),
      places: placesOf(plan.flows.filter((f) => f.from === stepId && f.key === key), (f) => f.to, line.into) }));
    drafts.push({ id: `layout:hand:${stepId}:empty`, kind: 'logistics', pin: 'site',
      text: `Empty ${who(s)} by hand: ${placesText(goods, 'into', joinNames(goods.map((g) => g.name)), joinNames)}` });
  };
  for (const [stepId, s] of steps) {
    const planStep = plan.steps.find((x) => x.id === stepId);
    if (planStep === undefined) continue;
    if (s.unit.manual !== undefined) {
      const inputs = perKey(planStep.inputs);
      if (inputs.length > 0) {
        const amounts = inputs.map(({ key, amount }) => `${amountText(amount)}${isFluidKey(key) ? ' L' : '×'} ${nameOf(key)}`).join(' + ');
        const goods = inputs.map(({ key }) => ({ name: nameOf(key),
          places: placesOf(plan.flows.filter((f) => f.to === stepId && f.key === key), (f) => f.from, line.from) }));
        drafts.push({ id: `layout:hand:${stepId}:fill`, kind: 'logistics', pin: 'site',
          text: `Fill ${who(s)} by hand: ${amounts} a run (${placesText(goods, 'from', null, (parts) => parts.join(', '))})` });
      }
      const outputs = perKey(planStep.outputs).map((p) => p.key);
      if (outputs.length > 0) emptyStep(stepId, s, outputs);
      continue;
    }
    // AE2: a steam machine's ME interface pushes its inputs in, but nothing takes its output back
    if (mode !== 'ae2' || s.unit.vent !== true) continue;
    const made = perKey(planStep.outputs).map((p) => p.key).filter((k) => !isFluidKey(k));
    if (made.length === 0) continue;
    warnings.push({ code: 'steam_items', stepId, text: `${s.name} takes no conveyor cover (GregTech allows none on a steam machine) and never pushes `
      + `out what it makes, so no ME interface gets ${joinNames(made.map(nameOf))} back from it: take ${made.length === 1 ? 'it' : 'them'} out by hand` });
    emptyStep(stepId, s, made);
  }
  return { drafts, warnings };
}

/** `result` with the hand steps of its line appended to its drafts and their warnings to its warnings (`handSteps`). */
export function withHandSteps(input: ModeInput, mode: HandMode, result: ModeResult): ModeResult {
  const { drafts, warnings } = handSteps(input, mode);
  if (drafts.length === 0 && warnings.length === 0) return result;
  return { ...result, drafts: [...result.drafts, ...drafts], warnings: [...result.warnings, ...warnings] };
}
