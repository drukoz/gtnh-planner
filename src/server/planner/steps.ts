// Build steps (spec §3.6, §3.10; architecture §11.14): the ordered list a group follows to build and start a line —
// gather, craft, place, power, logistics, configure, hand-craft, test. Step ids name what a step is about (a build-list
// key, a plan step id, the logistics mode), never its position, so the marks people tick survive a re-plan.

import { PSEUDO_MACHINES, tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { BuildStep, LogisticsMode, PlanSettings, PlanStep, PowerSummary } from '../../shared/types/plan.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { cleanroomMachine, stepOneOffs, stepProductName, stepTools, type Bom } from './bom.ts';
import type { HeldAvoid } from './candidates.ts';

/** The gather step names this many base materials. */
const GATHER_SHOWN = 8;
const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const RATE_UNIT: Readonly<Record<PlanSettings['per'], string>> = { min: 'min', hour: 'h' };
const PER_WORD: Readonly<Record<PlanSettings['per'], string>> = { min: 'minute', hour: 'hour' };
const PSEUDO_IDS: ReadonlySet<number> = new Set(Object.values(PSEUDO_MACHINES));

const LOGISTICS_TEXT: Readonly<Record<LogisticsMode, string>> = {
  direct: 'Connect each machine\'s output to the next one with conveyor/pump covers or short pipes; only raw inputs and the final output touch storage',
  routed: 'Give every machine an interface pipe with chips and order work from the request pipe',
  ae2: 'Give every machine an ME interface with its patterns',
};

/** Whole numbers with thousands separators (`1,440`), anything else with two decimals (as the Materials view shows them). */
function amountText(n: number): string {
  const x = Math.round(n * 1e9) / 1e9 || 0;
  return Number.isInteger(x)
    ? x.toLocaleString('en-US')
    : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isProgrammedCircuit(key: StuffKey): boolean {
  return !isFluidKey(key) && parseItemKey(key).id === PROGRAMMED_CIRCUIT_ID;
}

/** The real machines of the steps per type, in step order: how many are new and how many the group already owns. */
function machinesToPlace(steps: readonly PlanStep[], makeN: boolean): Array<{ name: string; added: number; reused: number }> {
  const types = new Map<number, { name: string; added: number; reused: number }>();
  for (const step of steps) {
    const { mteId, name } = step.machine;
    if (step.handCraft || PSEUDO_IDS.has(mteId)) continue;
    const added = Math.max(0, step.count - step.owned);
    const type = types.get(mteId);
    if (type === undefined) types.set(mteId, { name, added, reused: step.owned });
    else if (!makeN) {
      // Rate steps each have their own machines; Make N steps of one type share theirs (make-n.ts).
      type.added += added;
      type.reused += step.owned;
    }
  }
  return [...types.values()];
}

/** `Place the machines: <new ones>; reuse your <owned ones>`, or null when the line has no real machine. */
function placeText(steps: readonly PlanStep[], makeN: boolean): string | null {
  const types = machinesToPlace(steps, makeN);
  const added = types.filter((t) => t.added > 0).map((t) => `${amountText(t.added)}× ${t.name}`);
  const reused = types.filter((t) => t.reused > 0).map((t) => `${amountText(t.reused)}× ${t.name}`);
  const parts = [...(added.length > 0 ? [added.join(', ')] : []), ...(reused.length > 0 ? [`reuse your ${reused.join(', ')}`] : [])];
  return parts.length > 0 ? `Place the machines: ${parts.join('; ')}` : null;
}

/**
 * The exact setting of a step's configured parts (architecture §11.14), or null when it has none; each slot holds an
 * option a line that avoids `avoid` may use (`stepOneOffs`).
 */
function configureText(pack: Pack, step: PlanStep, avoid: HeldAvoid | undefined): string | null {
  const others = [...new Set(stepOneOffs(pack, step, avoid).map((o) => o.key))]
    .filter((key) => step.circuit === undefined || !isProgrammedCircuit(key))
    .map((key) => pack.nameOf(key));
  const where = `in the ${step.machine.name} that makes ${stepProductName(pack, step)}`;
  if (step.circuit !== undefined) {
    return `Put a Programmed Circuit set to ${step.circuit} ${where}` + (others.length > 0 ? `; also put ${others.join(', ')} in it` : '');
  }
  return others.length > 0 ? `Put ${others.join(', ')} ${where}` : null;
}

function handCraftText(
  pack: Pack, step: PlanStep, settings: PlanSettings, totalSeconds: number | undefined, avoid: HeldAvoid | undefined,
): string {
  const rate = settings.mode === 'makeN'
    ? `${amountText(step.runs ?? Math.ceil(step.runsPerSecond * (totalSeconds ?? 0)))}×`
    : `${amountText(step.runsPerSecond * SECONDS_PER[settings.per])}/${RATE_UNIT[settings.per]}`;
  const tools = stepTools(pack, step, avoid).map((key) => pack.nameOf(key));
  return `Hand-craft ${rate} ${stepProductName(pack, step)} at a crafting table` + (tools.length > 0 ? ` (tools: ${tools.join(', ')})` : '');
}

function testText(pack: Pack, settings: PlanSettings, target: StuffKey, totalSeconds: number | undefined): string {
  const name = pack.nameOf(target);
  if (settings.mode === 'makeN') {
    const time = totalSeconds === undefined ? '' : ` in about ${Math.max(1, Math.round(totalSeconds / 60))} min`;
    return `Run the batch: ${amountText(settings.amount)}× ${name}${time}`;
  }
  return `Run the line and check it makes ${amountText(settings.amount)} ${name} per ${PER_WORD[settings.per]}`;
}

/**
 * The build steps in order (`order` = position + 1): gather the build's base materials; craft each top-level build
 * line in build-list order; place the machines; connect power; hook up logistics for the project's mode; configure
 * each step with a programmed circuit or other parts that stay in the machine (hand-crafting tools are none of these,
 * Task 13 ruling); hand-craft each hand-crafting step, naming its tools; test the line. Gather is left out when the
 * build needs no base materials, place when the line has no real machine, and power when it draws no EU. `avoid` is
 * what the line avoids, as for `buildBom`: the parts and tools named are the ones the line may use.
 */
export function buildSteps(
  pack: Pack,
  input: {
    steps: PlanStep[]; bom: Bom; power: PowerSummary; settings: PlanSettings; tier: number; target: StuffKey; totalSeconds?: number;
    avoid?: HeldAvoid;
  },
): BuildStep[] {
  const { steps, bom, power, settings, target, totalSeconds, avoid } = input;
  const makeN = settings.mode === 'makeN';
  const out: Array<Omit<BuildStep, 'order'>> = [];
  const ids = new Set<string>();
  const add = (id: string, kind: BuildStep['kind'], text: string): void => {
    ids.add(id);
    out.push({ id, kind, text });
  };

  if (bom.totals.length > 0) {
    const shown = bom.totals.slice(0, GATHER_SHOWN).map((l) => `${amountText(l.amount)}× ${pack.nameOf(l.key)}`).join(', ');
    const more = bom.totals.length - GATHER_SHOWN;
    add('gather', 'gather', `Gather the base materials: ${shown}${more > 0 ? ` (and ${more} more)` : ''}`);
  }

  const roomKey = cleanroomMachine(pack)?.itemKey;
  // Task 13 ruling: a one-off that is only a hand-crafting tool (no step keeps it in a machine) is worded as a tool.
  const machineParts = new Set(steps.flatMap((s) => stepOneOffs(pack, s, avoid).map((o) => o.key)));
  const toolsOnly = new Set(steps.flatMap((s) => stepTools(pack, s, avoid)).filter((key) => !machineParts.has(key)));
  for (const line of bom.lines) {
    const group = line.group ?? 'machines';
    const name = pack.nameOf(line.key);
    // A key can only repeat in another group; that line gets the group in its id.
    const id = ids.has(`craft:${line.key}`) ? `craft:${group}:${line.key}` : `craft:${line.key}`;
    const amount = amountText(line.amount);
    if (group === 'one-off' && toolsOnly.has(line.key)) add(id, 'craft', `Make ${amount}× ${name} (a tool for hand-crafting)`);
    else if (group === 'one-off') add(id, 'craft', `Make ${amount}× ${name} (stays in the machine)`);
    else if (group === 'machines' && line.key === roomKey) add(id, 'craft', `Build a cleanroom (${name}) around the steps that need it`);
    else add(id, 'craft', `Craft ${amount}× ${name}`);
  }

  const place = placeText(steps, makeN);
  if (place !== null) add('place', 'place', place);
  if (power.peakEUt > 0) {
    add('power', 'power', `Connect power: up to ${amountText(power.peakEUt)} EU/t at ${tierName(power.voltageTier)} — never feed a machine more than its tier's voltage`);
  }
  add(`logistics:${settings.logistics}`, 'logistics', LOGISTICS_TEXT[settings.logistics]);
  for (const step of steps) {
    const text = configureText(pack, step, avoid);
    if (text !== null) add(`configure:${step.id}`, 'configure', text);
  }
  for (const step of steps) {
    if (step.handCraft) add(`handcraft:${step.id}`, 'handcraft', handCraftText(pack, step, settings, totalSeconds, avoid));
  }
  add('test', 'test', testText(pack, settings, target, totalSeconds));

  return out.map((s, i) => ({ id: s.id, order: i + 1, text: s.text, kind: s.kind }));
}
