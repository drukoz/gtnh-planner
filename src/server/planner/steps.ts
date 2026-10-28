// Build steps (spec §3.6, §3.10; architecture §11.14, §11 entry 41 (5)): the ordered list a group follows to build and
// start a line — gather, make or craft each build part, place, power, logistics, configure, hand-craft, test. Step ids
// name what a step is about (a build-list key, a plan step id, the logistics mode), never its position, so the marks
// people tick survive a re-plan.

import { withArticle } from '../../shared/format.ts';
import { tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, parseItemKey, type StuffKey } from '../../shared/keys.ts';
import { joinNames } from '../../shared/layout/format.ts';
import { isPseudoMachineId, machineIdOfLegacy, type MachineId } from '../../shared/ids.ts';
import { machineGroups } from '../../shared/plan/pools.ts';
import type { Pack } from '../../shared/types/pack.ts';
import type { BomLine, BuildStep, LogisticsMode, PlanSettings, PlanStep, PowerSummary } from '../../shared/types/plan.ts';
import { machineByMteId } from '../pack/lookup.ts';
import { PROGRAMMED_CIRCUIT_ID } from '../pack/recipes.ts';
import { cleanroomMachine, partName, stepOneOffs, stepProductName, stepTools, type Bom, type BomMake } from './bom.ts';
import { structureParts } from './build-cost.ts';
import type { HeldAvoid } from './candidates.ts';
import { plantingParts, soilWork, type PlantingPart } from './farms/recipes.ts';
import { orderJobs, type OrderJob } from './howto.ts';

/** The gather step names this many base materials. */
const GATHER_SHOWN = 8;
const SECONDS_PER: Readonly<Record<PlanSettings['per'], number>> = { min: 60, hour: 3600 };
const RATE_UNIT: Readonly<Record<PlanSettings['per'], string>> = { min: 'min', hour: 'h' };
const PER_WORD: Readonly<Record<PlanSettings['per'], string>> = { min: 'minute', hour: 'hour' };
const LAVA: StuffKey = 'fluid:lava';

const LOGISTICS_TEXT: Readonly<Record<LogisticsMode, string>> = {
  direct: 'Connect each machine\'s output to the next one with conveyor/pump covers or short pipes; only raw inputs and the final output touch storage',
  routed: 'Give every machine an interface pipe with chips and order work from the request pipe',
  ae2: 'Give every machine an ME interface with its patterns',
  enderio: 'Connect every machine to an EnderIO conduit face set to Extract, Insert or In / Out, with its channel colours and filters; only raw inputs and the final outputs touch storage',
};

/** Whole numbers with thousands separators (`1,440`), anything else with two decimals (as the Materials view shows them). */
function amountText(n: number): string {
  const x = Math.round(n * 1e9) / 1e9 || 0;
  return Number.isInteger(x)
    ? x.toLocaleString('en-US')
    : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "3× Iron Ingot", "1,000 L Water": an amount of a good, items counted and fluids in litres (spec §6.1), named as a build part. */
function amountOf(pack: Pack, key: StuffKey, amount: number): string {
  return isFluidKey(key) ? `${amountText(amount)} L ${partName(pack, key)}` : `${amountText(amount)}× ${partName(pack, key)}`;
}

function isProgrammedCircuit(key: StuffKey): boolean {
  return !isFluidKey(key) && parseItemKey(key).id === PROGRAMMED_CIRCUIT_ID;
}

/**
 * The real machines of the steps per type, in step order: how many are new and how many the group already owns. New
 * machines: rate steps each have their own, a sharing pool's once (`machineGroups`, from its first step); Make N steps
 * of one type share theirs (make-n.ts), counted at its first step. Owned ones (plan 12): a type's distinct owned units
 * (`reused.units`, and those of `reused.others`, so an owned machine of another tier is named too), plus `owned` of the
 * steps that list no units (rate: each such step's; Make N: the type's first step's).
 */
function machinesToPlace(steps: readonly PlanStep[], makeN: boolean): Array<{ name: string; added: number; reused: number }> {
  const types = new Map<MachineId, { name: string; added: number; owned: number; units: Set<number> }>();
  const typeOf = (id: MachineId, name: string): { name: string; added: number; owned: number; units: Set<number> } => {
    let type = types.get(id);
    if (type === undefined) types.set(id, (type = { name, added: 0, owned: 0, units: new Set() }));
    return type;
  };
  const counting = new Set(machineGroups(steps).map((group) => group[0]));
  const seen = new Set<MachineId>();
  for (const step of steps) {
    const id = machineIdOfLegacy(step.machine.mteId);
    const { name } = step.machine;
    if (step.handCraft || isPseudoMachineId(id)) continue;
    const first = !seen.has(id);
    seen.add(id);
    const type = typeOf(id, name);
    if (makeN ? first : counting.has(step)) type.added += Math.max(0, step.count - step.owned);
    const units = step.reused?.units;
    if (units !== undefined) for (const u of units) type.units.add(u);
    else if (!makeN || first) type.owned += step.owned;
    for (const o of step.reused?.others ?? []) {
      const other = typeOf(machineIdOfLegacy(o.mteId), o.name);
      if (o.units !== undefined) for (const u of o.units) other.units.add(u);
      else other.owned += o.count;
    }
  }
  return [...types.values()].map((t) => ({ name: t.name, added: t.added, reused: t.units.size + t.owned }));
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
 * The exact setting of a group's configured parts (architecture §11.14), or null when it has none; each slot holds an
 * option a line that avoids `avoid` may use (`stepOneOffs`). `group` is a step, or a sharing pool's steps (plan 12:
 * `machineGroups`), whose circuit and held parts are the same (its sharing key) and whose products it names.
 */
function configureText(pack: Pack, group: readonly PlanStep[], avoid: HeldAvoid | undefined): string | null {
  const step = group[0] as PlanStep;
  const others = [...new Set(stepOneOffs(pack, step, avoid).map((o) => o.key))]
    .filter((key) => step.circuit === undefined || !isProgrammedCircuit(key))
    .map((key) => pack.nameOf(key));
  const where = `in the ${step.machine.name} that makes ${group.map((s) => stepProductName(pack, s)).join(', ')}`;
  if (step.circuit !== undefined) {
    return `Put a Programmed Circuit set to ${step.circuit} ${where}` + (others.length > 0 ? `; also put ${others.join(', ')} in it` : '');
  }
  return others.length > 0 ? `Put ${others.join(', ')} ${where}` : null;
}

/**
 * Where a supply step's machine must stand to make its free input (fix spec R2), or null: a rock breaker needs water
 * and lava beside it, a pump an infinite water source or a lava pool under it; the compressor needs nothing. A sharing
 * pool's machine names what each of its supply steps makes.
 */
function supplyText(pack: Pack, group: readonly PlanStep[]): string | null {
  const step = group[0] as PlanStep;
  const supply = step.supply;
  if (supply === undefined) return null;
  const kind = pack.recipeById.get(step.recipeId)?.meta.supply;
  const machine = step.machine.name;
  const made = [...new Set(group.flatMap((s) => (s.supply === undefined ? [] : [pack.nameOf(s.supply)])))].join(', ');
  if (kind === 'rock-breaker') return `Place water and lava next to the ${machine} that makes ${made}`;
  if (kind === 'pump') return supply === LAVA ? `Put the ${machine} over a lava pool` : `Put the ${machine} over an infinite water source (a 2×2 pool)`;
  return null;
}

/** The `configure` text of a step or sharing pool: its supply setting-up, then the parts it holds, as one instruction; null for none. */
function configureStepText(pack: Pack, group: readonly PlanStep[], avoid: HeldAvoid | undefined): string | null {
  const parts = [supplyText(pack, group), configureText(pack, group, avoid)].filter((t): t is string => t !== null);
  return parts.length === 0 ? null : parts.map((t, i) => (i === 0 ? t : t[0]!.toLowerCase() + t.slice(1))).join('; ');
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

/** A part the line's crop farms plant (add-on 17): which part, and the farms that plant it. */
interface Planted { part: PlantingPart['part']; farms: string[] }

/**
 * What the line's crop farm steps plant (`plantingParts`; a farm pack's recipes say it), by key: which part, and each
 * farm that plants it, in step order, as `the <crop> farm`, followed for a soil placed as another block by what to do to
 * it (` (hoe it into Farmland)`).
 */
function farmPlantings(pack: Pack, steps: readonly PlanStep[]): Map<StuffKey, Planted> {
  const out = new Map<StuffKey, Planted>();
  for (const step of steps) {
    const farm = (step.farm?.sticks ?? 0) > 0 ? pack.recipeById.get(step.recipeId)?.meta.farm : undefined;
    if (farm?.kind !== 'crop' || farm.crop === undefined) continue;
    for (const p of plantingParts(farm)) {
      const work = p.soil === undefined ? undefined : soilWork(p.soil);
      const name = `the ${farm.crop.name} farm${work === undefined ? '' : ` (${work})`}`;
      const planted = out.get(p.key);
      if (planted === undefined) out.set(p.key, { part: p.part, farms: [name] });
      else if (!planted.farms.includes(name)) planted.farms.push(name);
    }
  }
  return out;
}

/**
 * The craft step of a one-off only crop farms plant (the final review of add-on 17): its crop sticks are made and planted
 * round the Crop Manager, its soil laid under them, its seeds taken from the group's seed bank — never "stays in the
 * machine".
 */
function plantingText(amount: string, planted: Planted): string {
  const farms = joinNames(planted.farms);
  if (planted.part === 'sticks') return `Make ${amount} to plant in ${farms}`;
  if (planted.part === 'soil') return `Get ${amount} as soil for ${farms}`;
  return `Take ${amount} from your seed bank for ${farms}`;
}

/**
 * What a crop farm's part that the build list makes is for (add-on 14 × 17), as its make step's note in one bracket: its
 * crop sticks or seeds `to plant in the <crop> farm`, its soil `as soil for the <crop> farm; hoe it into Farmland`.
 */
function plantedFor(planted: Planted): string {
  // a farm's name may end with what to do to its soil, " (hoe it into Farmland)": in a bracket of its own it goes after "; "
  const farms = joinNames(planted.farms.map((farm) => farm.replace(/ \((.+)\)$/, '; $1')));
  return planted.part === 'soil' ? `as soil for ${farms}` : `to plant in ${farms}`;
}

function testText(pack: Pack, settings: PlanSettings, target: StuffKey, totalSeconds: number | undefined): string {
  if (settings.mode === 'makeN') {
    const time = totalSeconds === undefined ? '' : ` in about ${Math.max(1, Math.round(totalSeconds / 60))} min`;
    return `Run the batch: ${amountOf(pack, target, settings.amount)}${time}`;
  }
  const amount = `${amountText(settings.amount)}${isFluidKey(target) ? ' L' : ''}`;
  return `Run the line and check it makes ${amount} ${pack.nameOf(target)} per ${PER_WORD[settings.per]}`;
}

/**
 * The build steps of the build list's parts (architecture §11 entry 41 (5), the copy table of add-on 14's Task 5): the
 * gather step for the totals that are not unmade, then one step per part — every make, every unmade total, every other
 * top-level line (a key's first top-level line carries its step and id) — in Kahn's order of their waits (`BomMake.after`),
 * batched by machine (`orderJobs`). Each job is worded by its `made`, as the build list words it: the breakdown breaks a
 * cycle through machines this line builds where `made` is set (`expandWith`), so a caller's own cycle is broken for the
 * order alone. The cleanroom line's own step, made or not, says to build it around the steps that need it. A top-level
 * one-off says what it is for: a hand-crafting tool, what a crop farm plants (add-on 17: a made one says
 * `(to plant in the <crop> farm)`, one not made is worded as `plantingText` words it), else that it stays in the machine;
 * what the breakdown marked `seedBank` (bom.ts `seedBankParts`: a crop's seeds, a new tree farm's sapling) is no import:
 * its total is gathered with the others, and its top-level line, made nowhere here, reads `Take <n>× <seeds> from your seed
 * bank for the <crop> farm` or `Take <n>× <sapling> (stays in the machine) from your seed bank for the <sapling> farm`
 * (the controller's ruling after the merge of main).
 */
export function partSteps(
  pack: Pack, input: { steps: readonly PlanStep[]; bom: { lines: BomLine[]; totals: BomLine[]; makes?: readonly BomMake[] }; tier: number; avoid?: HeldAvoid },
): Array<Omit<BuildStep, 'order'>> {
  const { steps, bom, tier, avoid } = input;
  const qty = (key: StuffKey, n: number): string => amountOf(pack, key, n);
  const out: Array<Omit<BuildStep, 'order'>> = [];
  const gathered = bom.totals.filter((t) => t.unmade === undefined);
  if (gathered.length > 0) {
    const shown = gathered.slice(0, GATHER_SHOWN).map((l) => qty(l.key, l.amount)).join(', ');
    const more = gathered.length - GATHER_SHOWN;
    out.push({ id: 'gather', kind: 'gather', text: `Gather the base materials: ${shown}${more > 0 ? ` (and ${more} more)` : ''}` });
  }
  const roomKey = cleanroomMachine(pack)?.itemKey;
  // Task 13 ruling: a one-off that is only a hand-crafting tool (no step keeps it in a machine) is worded as a tool.
  const machineParts = new Set(steps.flatMap((s) => stepOneOffs(pack, s, avoid).map((o) => o.key)));
  const tools = new Set(steps.flatMap((s) => stepTools(pack, s, avoid)));
  const toolsOnly = new Set([...tools].filter((key) => !machineParts.has(key)));
  // Add-on 17: one that only crop farms plant (no step keeps it in a machine or crafts with it) is worded as planting.
  const plantings = farmPlantings(pack, steps);
  const plantedOf = (key: StuffKey): Planted | undefined => (machineParts.has(key) || tools.has(key) ? undefined : plantings.get(key));
  const firstTop = new Map<StuffKey, BomLine>();
  /** What all the top-level lines of a key ask for: a bought part's one step names every group's amount. */
  const topAmount = new Map<StuffKey, number>();
  for (const l of bom.lines) {
    if (!firstTop.has(l.key)) firstTop.set(l.key, l);
    topAmount.set(l.key, (topAmount.get(l.key) ?? 0) + l.amount);
  }
  const suffix = (key: StuffKey): string => {
    const top = firstTop.get(key);
    if (top === undefined || (top.group ?? 'machines') !== 'one-off') return '';
    if (toolsOnly.has(key)) return ' (a tool for hand-crafting)';
    const planted = plantedOf(key);
    return planted === undefined ? ' (stays in the machine)' : ` (${plantedFor(planted)})`;
  };
  const idOf = (key: StuffKey): string => (firstTop.has(key) ? `craft:${key}` : `make:${key}`);
  /** The cleanroom line's own step, made or not, says where it goes (the copy table's last row). */
  const roomHint = (key: StuffKey): string => {
    const top = firstTop.get(key);
    return key === roomKey && top !== undefined && (top.group ?? 'machines') === 'machines' ? '; build it around the steps that need it' : '';
  };
  type Node = OrderJob & { id: string; kind: BuildStep['kind']; text(): string };
  const nodes = new Map<StuffKey, Node>();
  for (const m of bom.makes ?? []) {
    const machine = m.made.machine;
    const name = partName(pack, m.key);
    const what = `${qty(m.key, m.amount)}${suffix(m.key)}`;
    const from = m.inputs.length === 0 ? '' : ` from ${m.inputs.map((i) => qty(i.key, i.amount)).join(', ')}`;
    const held = (m.made.nonConsumed ?? []).map((k) => partName(pack, k));
    const machineWaits: StuffKey[] = [];
    if (typeof machine === 'object' && machine.source === 'line') {
      const own = machineByMteId(pack, machine.mteId);
      if (own !== undefined) for (const k of [own.itemKey, ...structureParts(pack, own).keys()]) if (m.after.includes(k)) machineWaits.push(k);
    }
    const text = (): string => {
      if (machine === 'crafting table') return `Craft ${what}${from} at a crafting table${held.length > 0 ? ` (tools: ${held.join(', ')})` : ''}${roomHint(m.key)}`;
      const { source } = machine;
      const where = source === 'owned' ? `your ${machine.name}` : source === 'line' ? `the ${machine.name} this line builds` : withArticle(machine.name);
      const config: string[] = [];
      if (m.made.circuit !== undefined) config.push(`circuit ${m.made.circuit}`);
      if (held.length > 0) config.push(`with ${held.join(', ')} in it`);
      if (m.made.cleanroom === true) config.push('in a cleanroom');
      if (source === 'line') config.push('place and power it first');
      if (source === 'new') config.push(`you have none and this line builds none: build one, or import the ${name}`);
      if (source === 'first') config.push(`the one this line builds needs it first: use another one, or import the ${name}`);
      return `Make ${what}${from} in ${where}${config.length > 0 ? ` (${config.join('; ')})` : ''}${roomHint(m.key)}`;
    };
    nodes.set(m.key, {
      key: m.key, id: idOf(m.key), kind: machine === 'crafting table' ? 'craft' : 'make',
      machineKey: machine === 'crafting table' ? 'crafting table' : machine.name, name, waits: m.after, machineWaits, text,
    });
  }
  for (const t of bom.totals) {
    if (t.unmade === undefined || nodes.has(t.key)) continue;
    const what = `${qty(t.key, t.amount)}${suffix(t.key)}`;
    const text = (t.unmade === 'own-chain'
      ? `Get ${what}: every recipe for it here needs a part of its own chain, so swap the recipe of a part it goes into, or import it (mark it "we already make this")`
      : `Get ${what}: nothing at ${tierName(tier)} can make it, so import it (mark it "we already make this")`) + roomHint(t.key);
    nodes.set(t.key, { key: t.key, id: idOf(t.key), kind: 'gather', machineKey: '', name: partName(pack, t.key), waits: [], machineWaits: [], text: () => text });
  }
  for (const l of firstTop.values()) {
    if (nodes.has(l.key)) continue;
    const group = l.group ?? 'machines';
    const amount = qty(l.key, topAmount.get(l.key) ?? l.amount);
    const planted = plantedOf(l.key);
    const text = group === 'one-off' && toolsOnly.has(l.key) ? `Make ${amount} (a tool for hand-crafting)`
      : group === 'one-off' && planted !== undefined ? plantingText(amount, planted)
      : group === 'one-off' && l.seedBank === true ? `Take ${amount} (stays in the machine) from your seed bank for the ${partName(pack, l.key)} farm`
      : group === 'one-off' ? `Make ${amount} (stays in the machine)`
      : group === 'machines' && l.key === roomKey ? `Build a cleanroom (${partName(pack, l.key)}) around the steps that need it`
      : `Craft ${amount}`;
    nodes.set(l.key, { key: l.key, id: `craft:${l.key}`, kind: 'craft', machineKey: '', name: partName(pack, l.key), waits: [], machineWaits: [], text: () => text });
  }
  for (const key of orderJobs([...nodes.values()]).order) {
    const n = nodes.get(key) as Node;
    out.push({ id: n.id, kind: n.kind, text: n.text() });
  }
  return out;
}

/**
 * The build steps in order (`order` = position + 1): gather the build's base materials and make each build part in
 * order (`partSteps`: a one-off that stays in a machine, a hand-crafting tool, or what a crop farm plants, as
 * `Make <n>× Crop Sticks to plant in the <crop> farm`, `Get <n>× Dirt as soil for the <crop> farm (hoe it into
 * Farmland)`, `Take <n>× <seeds> from your seed bank for the <crop> farm`, add-on 17); place the machines; connect
 * power; hook up logistics for the project's mode; configure
 * each step with a programmed circuit or other parts that stay in the machine (hand-crafting tools are none of these,
 * Task 13 ruling), and each supply step where its machine must stand (`supplyText`) — a sharing pool once, by its first
 * step, naming every product of the pool (plan 12); hand-craft each hand-crafting step,
 * naming its tools; test the line. Amounts count items ("3×") and give fluids in litres ("1,000 L"). Gather is left
 * out when the build needs no base materials, place when the line has no real machine, and power when it draws no EU.
 * `avoid` is what the line avoids, as for `buildBom`: the parts and tools named are the ones the line may use.
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
  const add = (id: string, kind: BuildStep['kind'], text: string): void => {
    out.push({ id, kind, text });
  };

  // The build's parts (architecture §11 entry 41 (5)): gather, then one step per part, inputs first, batched by machine.
  for (const s of partSteps(pack, { steps, bom, tier: input.tier, ...(avoid === undefined ? {} : { avoid }) })) add(s.id, s.kind, s.text);

  const place = placeText(steps, makeN);
  if (place !== null) add('place', 'place', place);
  if (power.peakEUt > 0) {
    add('power', 'power', `Connect power: up to ${amountText(power.peakEUt)} EU/t at ${tierName(power.voltageTier)} — never feed a machine more than its tier's voltage`);
  }
  add(`logistics:${settings.logistics}`, 'logistics', LOGISTICS_TEXT[settings.logistics]);
  // A sharing pool's machines are set up once, by its first step (plan 12).
  for (const group of machineGroups(steps)) {
    const text = configureStepText(pack, group, avoid);
    if (text !== null) add(`configure:${(group[0] as PlanStep).id}`, 'configure', text);
  }
  for (const step of steps) {
    if (step.handCraft) add(`handcraft:${step.id}`, 'handcraft', handCraftText(pack, step, settings, totalSeconds, avoid));
  }
  add('test', 'test', testText(pack, settings, target, totalSeconds));

  return out.map((s, i) => ({ id: s.id, order: i + 1, text: s.text, kind: s.kind }));
}
