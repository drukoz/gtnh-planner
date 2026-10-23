// The panel beside the flow diagram (spec §3.9, fix spec §6.3). A step's panel: what it takes and makes and from or to
// which step (hovering a row lights the item in the diagram, clicking a step selects it), the machine it shares with
// other steps (plan 12), a farm step's farm (add-on 17: what it plants and holds; its recipe is a synthetic one the
// export does not have, and the panel asks the pack nothing about it), who else makes its product, why it uses the
// ingredient option it does (pin another), the free input it supplies or the supporting line it belongs to, the group's
// machines it reuses and where they stand (those of other tiers, and the steps a machine is shared with, included), the
// machine tier it runs at (pin another, plan 12), its overclock math, every way to make its product (swap its
// recipe, or import the product instead) and its warnings. A raw material's panel: what kind of import it is and what
// the line takes of it from a farm the group runs or another project (add-on 17), which steps use it, what a bought one
// stands for, and making it in the line instead. Every choice sends one `settings` op with whole field values.

import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { tierName } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { indexPlan, ORPHAN_REL, SHORT_INPUT_SHARE, type PlanIndex } from '../../shared/plan/balance.ts';
import { stepNameIn } from '../../shared/plan/pools.ts';
import {
  FREE_KEYS, type LeafClass, type MachineWhere, type Plan, type PlanFlow, type PlanSettings, type PlanStep, type RawInput, type SourceInfo, type StepOption,
  type StepTier,
} from '../../shared/types/plan.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { formatNumber, formatPercent, formatRate } from '../format.ts';
import { endHoverFlowFocus, hoverFlowFocus } from '../state/flow-focus.ts';
import {
  flowEdgeId, haveSupplyPatch, importInsteadPatch, importWords, LEAF_WORD, makeHerePatch, ocLines, optionPatch, optionSlotKey, reusePatch, tierText,
  useOnlyPatch,
} from './flow-model.ts';
import type { ProjectViewProps } from './project-tabs.ts';

type Send = ProjectViewProps['send'];
type NameOf = (key: string) => string;
type Per = 'min' | 'hour';
type Patch = (p: Partial<PlanSettings>) => void;

/** Found spots listed per source before the rest is summed up. */
const MAX_FOUND_AT = 3;
/** Where reused machines stand: the positions listed before the rest is summed up. */
const MAX_REUSED_AT = 3;
/** The overworld's Minecraft dimension id: a reused machine there is given by its position alone. */
const OVERWORLD_ID = 0;
/** Swap options shown before "more…" (the one in use and a pinned one always show). */
const SWAP_SHOWN = 5;
/** Swap options each "more…" adds: a product can have a thousand ways (Wood Pulp), too many to list at once. */
const SWAP_PAGE = 25;
const PORT_ICON_SIZE = 16;
const RAW = 'raw';
const OUT = 'out';
const SINK = 'sink';
/** What "raw/unit" means (fix spec §6.3). */
export const RAW_UNIT_TITLE = 'raw-material units per unit made (1 base item, 144 L molten metal or 1,000 L other fluid = 1)';

const LEAF_TEXT: Record<LeafClass, string> = {
  free: 'Free: water, air, cobblestone and lava cost nothing',
  direct: 'Base material: mined directly',
  byproduct: 'Base material: an ore-processing byproduct',
  derived: 'Base material: made from other materials, counted as bought',
  natural: 'Gathered from the world',
  stop: 'We already make this: counted at its cost',
  unavailable: 'Not reachable at this tier with these dimensions',
};

/** The leaf kinds that are base materials, which the group may choose to make in the line instead. */
const BASE_MATERIALS: ReadonlySet<LeafClass> = new Set<LeafClass>(['direct', 'byproduct', 'derived']);

const SOURCE_TEXT: Record<SourceInfo['kind'], string> = {
  vein: 'Ore vein', small_ore: 'Small ore', byproduct: 'Byproduct', fluid: 'Fluid', capability: 'Capability',
  craft: 'Crafted', natural: 'Natural', derived: 'Derived', unknown: 'Unknown',
};

function namesOf(plan: Plan): NameOf {
  return (key) => plan.names?.[key] ?? key;
}

function settingsSender(send: Send): Patch {
  return (patch) => send([{ op: 'settings', patch }]);
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) as string}`;
}

/** A recipe map id in words: `gt.recipe.assembler` → `Assembler`, for a plan whose names have no `map:` entry. */
function mapLabel(mapId: string): string {
  const words = mapId.replace(/^.*?recipe\./, '').replace(/[._-]+/g, ' ').trim();
  return words === '' ? mapId : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The machine a recipe map runs on, by the plan's name for the map. */
function mapName(mapId: string, nameOf: NameOf): string {
  const name = nameOf(`map:${mapId}`);
  return name === `map:${mapId}` ? mapLabel(mapId) : name;
}

/** "Wiremill (1x Copper Wire)": a step by its machine and what it makes. */
function stepWords(step: PlanStep, nameOf: NameOf): string {
  return step.mainOutput === undefined ? step.machine.name : `${step.machine.name} (${nameOf(step.mainOutput)})`;
}

/** "72 L Molten Tin", "2× Redstone", "Redstone": an amount of a good. */
function amountWords(key: StuffKey, amount: number, nameOf: NameOf): string {
  if (isFluidKey(key)) return `${formatNumber(amount)} L ${nameOf(key)}`;
  return amount === 1 ? nameOf(key) : `${formatNumber(amount)}× ${nameOf(key)}`;
}

function rateOf(perSecond: number, per: Per, key: StuffKey): string {
  return formatRate(perSecond, per, { fluid: isFluidKey(key) });
}

/** A raw-material cost to two decimals, so choices line up ("0.50 vs 1.00"); a sliver keeps its own digits. */
function rawText(x: number): string {
  if (x === 0) return '0';
  return Math.abs(x) < 0.01 || Math.abs(x) >= 1000 ? formatNumber(x) : x.toFixed(2);
}

/** "circuit" for Electronic Circuit, "wire" for 1x Copper Wire, "PE" for Molten PE: the unit a product is counted in. */
function unitWord(name: string): string {
  const words = name.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/);
  const last = words.at(-1) ?? '';
  if (last === '') return 'unit';
  return /^[A-Z0-9]+$/.test(last) ? last : last.toLowerCase();
}

type Alternative = PlanStep['alternatives'][number];

/** "2× Copper Wire, 72 L Molten Soldering Alloy / 144 L Molten Tin": goods with their amounts per run, every option of a slot. */
function partsText(parts: Alternative['inputs'], nameOf: NameOf): string {
  return (parts ?? []).map((p) => (p.options !== undefined && p.options.length > 1 ? p.options : [p]).map((o) => amountWords(o.key, o.amount, nameOf)).join(' / ')).join(', ');
}

/** One swap option in words: its machine and what a run takes and makes. */
function alternativeText(a: Alternative, nameOf: NameOf): string {
  const takes = partsText(a.inputs, nameOf);
  const makes = partsText(a.outputs, nameOf);
  const what = takes === '' && makes === '' ? '' : `: ${takes === '' ? 'nothing' : takes} → ${makes}`;
  return `${mapName(a.mapId, nameOf)}${what}`;
}

/** "raw/unit", with what it means on hover. */
function RawUnit(): ReactElement {
  return <abbr className="unit-hint" title={RAW_UNIT_TITLE}>raw/unit</abbr>;
}

function PanelHead(props: { itemKey: StuffKey | null; itemName?: string; title: string; onClose(): void }): ReactElement {
  const { itemKey, itemName, title, onClose } = props;
  return (
    <header className="flow-panel-head">
      {itemKey !== null && <ItemIcon itemKey={itemKey} size={24} name={itemName} />}
      <h3>{title}</h3>
      <button type="button" className="small" aria-label="Close the panel" onClick={onClose}>Close</button>
    </header>
  );
}

/**
 * What a step takes and makes (fix spec §6.3): per good its icon, name and rate (an input supplied short in red), and
 * the steps it comes from or goes to with their rates. Hovering a row lights the item in the diagram; clicking a step
 * (when `onSelect` is given) selects it.
 */
export function PortsSection(props: { step: PlanStep; plan: Plan; per: Per; onSelect?(stepId: string): void; index?: PlanIndex }): ReactElement | null {
  const { step, plan, per, onSelect } = props;
  const index = props.index ?? indexPlan(plan);
  const nameOf = namesOf(plan);
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const imports = importWords(plan);
  // Flows carry net amounts (balance.ts), so a step makes of a good what it makes per run less what it takes of it; a
  // good it takes and hands back in full (a cell, a catalyst) has neither a Takes nor a Makes row.
  const perRun = (products: PlanStep['inputs']): Map<StuffKey, number> => {
    const amounts = new Map<StuffKey, number>();
    for (const p of products) amounts.set(p.key, (amounts.get(p.key) ?? 0) + p.amount);
    return amounts;
  };
  const takes = perRun(step.inputs);
  const made = new Map([...perRun(step.outputs)].map(([key, amount]) => [key, Math.max(0, amount - (takes.get(key) ?? 0)) * step.runsPerSecond]));
  const ins = [...(index.inputs.get(step.id) ?? [])].filter(([, port]) => port.needPerSecond > 0 || port.perSecond > 0);
  const main = step.mainOutput;
  const outs = [...(index.outputs.get(step.id) ?? [])].filter(([key, port]) => (made.get(key) ?? 0) > 0 || port.perSecond > 0)
    .sort(([a], [b]) => Number(b === main) - Number(a === main));
  if (ins.length === 0 && outs.length === 0) return null;

  const peerOf = (node: string, key: StuffKey, perSecond: number): ReactNode => {
    const rate = rateOf(perSecond, per, key);
    const other = steps.get(node);
    if (other !== undefined) {
      if (onSelect === undefined) return `${stepWords(other, nameOf)} ${rate}`;
      return (
        <>
          <button type="button" className="link" onClick={() => onSelect(node)}>{stepWords(other, nameOf)}</button>
          {` ${rate}`}
        </>
      );
    }
    if (node === RAW) {
      const words = imports.get(key);
      return `import${words === undefined ? '' : ` (${words})`} ${rate}`;
    }
    if (node === OUT) return `the target ${rate}`;
    if (node === SINK) return `left over ${rate}`;
    return `${node} ${rate}`;
  };
  const peers = (word: string, key: StuffKey, list: ReadonlyArray<{ node: string; perSecond: number }>): ReactNode => (
    list.length === 0 ? null : (
      <span className="port-peers muted small">
        {`${word} `}
        {list.map((p, i) => <span key={p.node}>{i > 0 && ' · '}{peerOf(p.node, key, p.perSecond)}</span>)}
      </span>
    )
  );
  const row = (key: StuffKey, body: ReactNode, short: boolean): ReactElement => (
    <li
      key={key}
      className={short ? 'port-row port-short' : 'port-row'}
      data-port-key={key}
      onMouseEnter={() => hoverFlowFocus({ kind: 'item', key })}
      onMouseLeave={endHoverFlowFocus}
    >
      <ItemIcon itemKey={key} size={PORT_ICON_SIZE} name={nameOf(key)} />
      {body}
    </li>
  );

  return (
    <section className="flow-panel-section">
      {ins.length > 0 && (
        <>
          <h4 className="flow-panel-title">Takes</h4>
          <ul className="ports">
            {ins.map(([key, port]) => {
              const need = port.needPerSecond;
              const orphan = need > 0 && port.perSecond <= ORPHAN_REL * need;
              const short = need > 0 && port.perSecond < SHORT_INPUT_SHARE * need;
              return row(key, (
                <>
                  <span className="port-name">{nameOf(key)}</span>
                  <span className="port-rate">{rateOf(need > 0 ? need : port.perSecond, per, key)}</span>
                  {short && <span className="port-warn">{orphan ? 'nothing supplies it' : `gets only ${formatPercent(port.perSecond / need)}`}</span>}
                  {peers('from', key, port.peers)}
                </>
              ), short);
            })}
          </ul>
        </>
      )}
      {outs.length > 0 && (
        <>
          <h4 className="flow-panel-title">Makes</h4>
          <ul className="ports">
            {outs.map(([key, port]) => {
              const makes = made.get(key) ?? 0;
              return row(key, (
                <>
                  <span className={key === main ? 'port-name port-main' : 'port-name'}>{nameOf(key)}</span>
                  <span className="port-rate">{rateOf(makes > 0 ? makes : port.perSecond, per, key)}</span>
                  {peers('to', key, port.peers)}
                </>
              ), false);
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** For a step that shares making its product with others (`multi-producer`): who else makes how much, and "use only this recipe". */
function AlsoMadeBySection(props: { step: PlanStep; plan: Plan; index: PlanIndex; settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement | null {
  const { step, plan, index, settings, nameOf, patch } = props;
  const main = step.mainOutput;
  if (main === undefined) return null;
  const makers = (index.producers.get(main) ?? []).filter((p) => p.main);
  const mine = makers.find((p) => p.stepId === step.id);
  if (makers.length < 2 || mine === undefined) return null;
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  /** "imported PE Bar, Molten PE": what another maker takes, the goods it imports said so. */
  const fromWords = (stepId: string): string => {
    const goods = [...(index.inputs.get(stepId) ?? [])].filter(([, port]) => port.needPerSecond > 0 || port.perSecond > 0)
      .map(([key, port]) => (port.peers.some((p) => p.node === RAW) ? `imported ${nameOf(key)}` : nameOf(key)));
    return goods.length === 0 ? '' : ` (from ${listed(goods)})`;
  };
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Also made by</h4>
      <ul className="also-made">
        {makers.filter((p) => p.stepId !== step.id).map((p) => {
          const other = steps.get(p.stepId);
          return <li key={p.stepId}>{`${other?.machine.name ?? p.stepId} makes ${formatPercent(p.share)} of ${nameOf(main)}${fromWords(p.stepId)}`}</li>;
        })}
      </ul>
      <p className="muted small">{`This step makes ${formatPercent(mine.share)}.`}</p>
      <div className="row">
        <button type="button" onClick={() => patch(useOnlyPatch(settings, main, step.recipeId))}>{`Use only this recipe for ${nameOf(main)}`}</button>
      </div>
    </section>
  );
}

function stepsWords(n: number): string {
  return n === 0 ? 'no extra steps' : n === 1 ? '1 extra step' : `${n} extra steps`;
}

/** One multi-option slot: why the line takes the option it does, every option with its cost and chain, and the pin. */
function OptionSlot(props: { step: PlanStep; slot: StepOption; settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement {
  const { step, slot, settings, nameOf, patch } = props;
  const group = useId();
  const pins = settings.optionChoice ?? {};
  const pinKey = optionSlotKey(step.recipeId, slot.slot);
  const pin = Object.hasOwn(pins, pinKey) ? pins[pinKey] : undefined;
  const choose = (key: StuffKey | null): void => patch(optionPatch(settings, step.recipeId, slot.slot, key));
  const main = step.mainOutput;
  const mainPerRun = main === undefined ? 0 : step.outputs.filter((p) => p.key === main).reduce((sum, p) => sum + p.amount, 0);
  const divisor = mainPerRun > 0 ? mainPerRun : 1;
  const unit = mainPerRun > 0 && main !== undefined ? unitWord(nameOf(main)) : 'run';
  const usable = slot.choices.filter((c) => c.unusable === undefined);
  // As the swap list's pin: one the slot no longer offers (on the avoid list) or the group cannot get here is not
  // usable. A pin the plan does not honour yet (`slot.pinned` comes with the next plan; the setting applies at once)
  // is just waiting for that plan.
  const pinUsable = pin === undefined || usable.some((c) => c.key === pin);
  const chosen = [...slot.choices].sort((a, b) => b.share - a.share)[0];
  let why: string | null = null;
  if (chosen !== undefined && chosen.share > 0) {
    const rival = usable.filter((c) => c.key !== chosen.key).sort((a, b) => a.rawPerRun - b.rawPerRun)[0];
    const vs = rival === undefined ? '' : ` vs ${rawText(rival.rawPerRun / divisor)} for ${nameOf(rival.key)}`;
    const needs = chosen.via !== undefined && chosen.via.length > 0 ? `; needs ${chosen.via.join(' + ')}` : '';
    why = `${nameOf(chosen.key)} ${slot.pinned === chosen.key ? 'pinned' : 'chosen'}: ${rawText(chosen.rawPerRun / divisor)} raw per ${unit}${vs}${needs}`;
  }
  const choiceText = (c: StepOption['choices'][number]): string => {
    const via = c.via !== undefined && c.via.length > 0 ? ` (via ${c.via.join(', ')})` : '';
    return `${amountWords(c.key, c.amount, nameOf)} · ${rawText(c.rawPerRun)} raw per run, ${stepsWords(c.steps)}${via}`;
  };
  const use = (share: number): string => (share >= 1 ? 'in use' : share > 0 ? `in use (${formatPercent(share)})` : 'not used by this plan');
  return (
    <fieldset className="option-slot" data-slot={slot.slot}>
      <legend className="option-slot-title">{slot.choices.map((c) => nameOf(c.key)).join(' / ')}</legend>
      {why !== null && <p className="option-why small">{why}</p>}
      <label className="check">
        <input type="radio" name={group} checked={pin === undefined} onChange={() => choose(null)} />
        Let the planner choose
      </label>
      {slot.choices.map((c) => (c.unusable === undefined ? (
        <label key={c.key} className="check option-choice" title="Pin this option">
          <input type="radio" name={group} checked={pin === c.key} onChange={() => choose(c.key)} />
          <span className="choice-text">
            {`${choiceText(c)} `}
            <span className={c.share > 0 ? 'badge' : 'badge muted'}>{use(c.share)}</span>
          </span>
        </label>
      ) : (
        <div key={c.key} className="option-choice unusable">{`${choiceText(c)} — ${c.unusable.join('; ')}`}</div>
      )))}
      {pin !== undefined && !pinUsable && (
        <p className="muted small">{`The pinned option ${nameOf(pin)} is not usable now, so the planner chose another.`}</p>
      )}
    </fieldset>
  );
}

/** The step's multi-option ingredient slots (fix spec R9, §6.3). */
function OptionsSection(props: { step: PlanStep; settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement | null {
  const { step, settings, nameOf, patch } = props;
  const slots = step.options ?? [];
  if (slots.length === 0) return null;
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Ingredient options</h4>
      {slots.map((slot) => <OptionSlot key={slot.slot} step={step} slot={slot} settings={settings} nameOf={nameOf} patch={patch} />)}
    </section>
  );
}

/** A supply step (fix spec R2): the free input it makes, and counting that input as supplied when the line consumes it. */
function SupplySection(props: { step: PlanStep; plan: Plan; settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement | null {
  const { step, plan, settings, nameOf, patch } = props;
  const good = step.supply;
  if (good === undefined) return null;
  const steps = new Set(plan.steps.map((s) => s.id));
  // Only a free input the line takes can be supplied instead (Task 3's review: a stone breaker's Stone, or air the
  // compressor fills into cells the line itself makes, would change nothing).
  const offer = FREE_KEYS.includes(good) && plan.flows.some((f) => f.key === good && steps.has(f.to));
  const name = nameOf(good);
  let action: ReactElement | null = null;
  if (offer) {
    action = (settings.haveSupply ?? []).includes(good)
      ? <p className="muted small">{`${name} is marked supplied already; the plan is catching up.`}</p>
      : (
        <>
          <p className="muted small">{`The line then takes ${name} free and plans no machine for it.`}</p>
          <div className="row">
            <button type="button" onClick={() => patch(haveSupplyPatch(settings, good, true))}>{`We already have a supply of ${name}`}</button>
          </div>
        </>
      );
  }
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Supply</h4>
      <p>{`Supplies ${name} for this line`}</p>
      {action}
    </section>
  );
}

/** A step of a supporting line (fix spec R6): which line, and "we already make" its material. */
function LineSection(props: { step: PlanStep; settings: PlanSettings; patch: Patch }): ReactElement | null {
  const { step, settings, patch } = props;
  const line = step.line;
  if (line === undefined) return null;
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Supporting line</h4>
      <p>{`Part of the ${line.name} line`}</p>
      {settings.stopItems.includes(line.key) ? (
        <p className="muted small">{`${line.name} is marked already; the plan is catching up.`}</p>
      ) : (
        <div className="row">
          <button type="button" onClick={() => patch(importInsteadPatch(settings, line.key))}>{`We already make ${line.name}`}</button>
        </div>
      )}
    </section>
  );
}

/** Owned machines of one type in words, and where they stand (`reusedText`'s form, without what they are shared with). */
function reuseLine(machine: { count: number; name: string; tier: number; where: readonly MachineWhere[] | undefined }, opts: { base?: boolean; names?: Plan['names'] }): string {
  const { count, where } = machine;
  const machines = `${formatNumber(count)}× ${machine.name} (${tierText(machine.tier)}) reused`;
  if (where === undefined) return machines;
  if (where.length === 0) return `${machines} — from your list`;
  const more = where.length > MAX_REUSED_AT ? ` and ${where.length - MAX_REUSED_AT} more` : '';
  const at = ({ dim, pos }: MachineWhere): string => (dim === OVERWORLD_ID ? pos.join(' ') : `${pos.join(' ')} (${opts.names?.[`dimId:${dim}`] ?? `DIM${dim}`})`);
  const spots = `at ${opts.base === true ? 'your base ' : ''}${where.slice(0, MAX_REUSED_AT).map(at).join(', ')}${more}`;
  const listed = count - where.length;
  return listed > 0 ? `${machines} — ${formatNumber(where.length)} ${spots}; ${formatNumber(listed)} from your list` : `${machines} — ${spots}`;
}

/** A step of `plan` by what it makes (`stepNameIn`), in the plan's names. */
function stepName(plan: Plan, id: string): string {
  return stepNameIn(plan, id, namesOf(plan));
}

/**
 * Which owned machines a step runs on and where they stand (architecture §11.29): "2× Basic Assembler (LV) reused — at
 * your base 1 64 2, 3 64 2" for machines a world scan found (the first few positions; "at 1 64 2" when the project links
 * no base, as the scan's whole world counts then, `base`), each in a dimension other than the overworld named ("8 40 8
 * (Nether)", `dimId:<n>` in `names`, else `DIM<n>`), "— from your list" for those of the "Machines we have" list, both
 * for a mix; just "… reused" for a plan that does not say where; and, with the plan, " — shared with Gear, Kit" for
 * machines other steps run on too (`reused.sharedWith`, plan 12: what those steps make). Null for none.
 */
export function reusedText(step: PlanStep, opts: { base?: boolean; names?: Plan['names']; plan?: Plan } = {}): string | null {
  const count = step.reused?.count ?? step.owned;
  if (count <= 0) return null;
  const line = reuseLine({ count, name: step.machine.name, tier: step.machine.tier, where: step.reused?.where }, opts);
  const shared = step.reused?.sharedWith ?? [];
  const { plan } = opts;
  return plan === undefined || shared.length === 0 ? line : `${line} — shared with ${shared.map((id) => stepName(plan, id)).join(', ')}`;
}

function ReuseSection(props: { step: PlanStep; plan: Plan; settings: PlanSettings; base: boolean; patch: Patch }): ReactElement | null {
  const { step, plan, settings, patch } = props;
  const { mteId, name } = step.machine;
  const declined = (settings.declineReuse ?? []).includes(mteId);
  const others = step.reused?.others ?? [];
  // With "Reuse machines we have" off nothing is reused, whatever a machine type's own switch says.
  if (settings.reuseOwned === false || (step.owned <= 0 && others.length === 0 && !declined)) return null;
  const opts = { base: props.base, names: plan.names, plan };
  const reused = reusedText(step, opts);
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Reuse</h4>
      {reused !== null && <p>{reused}</p>}
      {/* Owned machines of the step's other tiers that run it beside its own (plan 12). */}
      {others.map((o) => <p key={`${o.mteId}:${o.tier}`}>{reuseLine(o, opts)}</p>)}
      {(step.owned > 0 || declined) && (
        <label className="check">
          <input type="checkbox" name="reuse" checked={!declined} onChange={(e) => patch(reusePatch(settings, mteId, e.currentTarget.checked))} />
          {declined ? `Reuse your ${name} machines` : `Reuse your ${step.owned}× ${name}`}
        </label>
      )}
    </section>
  );
}

/** `<tier>: <machines>× <name>[, <owned> yours] — <its build cost, why it cannot be built here, or that its price is unknown>`. */
function tierChoiceText(t: StepTier): string {
  const yours = t.owned > 0 ? `, ${formatNumber(t.owned)} yours` : '';
  const build = t.build !== null ? `${formatNumber(t.build)} raw to build`
    : t.unbuildable !== undefined ? `cannot be built here (${t.unbuildable})` : 'build cost unknown';
  return `${tierText(t.tier)}: ${formatNumber(t.machines)}× ${t.name}${yours} — ${build}`;
}

/**
 * "Machine tier" (plan 12, architecture §11.39): Auto (checked unless one of `step.tiers` is pinned), then every tier the
 * step can run at with the machines it would take there, the group's among them, and what building the rest costs (or
 * why that machine cannot be built here); the pinned one checked. Picking a tier pins it for the step's recipe
 * (`machineTier`); Auto takes the pin out. Shown where there is a choice: two tiers or more, or a pin.
 */
export function MachineTierSection(props: { step: PlanStep; settings: PlanSettings; patch: Patch }): ReactElement | null {
  const { step, settings, patch } = props;
  const tiers = step.tiers ?? [];
  const pinned = tiers.some((t) => t.pinned === true);
  if (tiers.length < 2 && !pinned) return null;
  const name = `machine-tier-${step.id}`;
  const choose = (tier: number | null): void => {
    const next = { ...settings.machineTier };
    if (tier === null) delete next[step.recipeId];
    else next[step.recipeId] = tier;
    patch({ machineTier: next });
  };
  return (
    <fieldset className="flow-panel-section" data-machine-tier="">
      <legend className="flow-panel-title">Machine tier</legend>
      <label className="check">
        <input type="radio" name={name} checked={!pinned} onChange={() => choose(null)} />
        Auto
      </label>
      {tiers.map((t) => (
        <label key={t.tier} className="check">
          <input type="radio" name={name} checked={t.pinned === true} onChange={() => choose(t.tier)} />
          {tierChoiceText(t)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A step whose machines a sharing pool shares with other steps (`PlanStep.pool`, plan 12) and that are not all the
 * group's: `Shares <count>× <machine> with <what the pool's other steps make> — <how busy the pool's steps keep them> busy
 * together`; null otherwise (a pool of owned machines only is said by its reuse text).
 */
export function sharedMachineText(step: PlanStep, plan: Plan): string | null {
  const pool = step.pool;
  if (pool === undefined || !(step.count > step.owned)) return null;
  const others = pool.steps.filter((id) => id !== step.id);
  let busy = 0;
  for (const id of pool.steps) busy += plan.steps.find((s) => s.id === id)?.utilization ?? 0;
  return `Shares ${formatNumber(step.count)}× ${step.machine.name} with ${others.map((id) => stepName(plan, id)).join(', ')} — ${formatPercent(busy)} busy together`;
}

/**
 * The swap rows shown while `limit` rows are open (the server sorts them: usable ways first, each group by raw material
 * use): the first `limit`, plus the one in use and a pinned one wherever they are; "more…" raises the limit a page at a
 * time (`SWAP_SHOWN`, then `SWAP_PAGE` more), so every way can be reached however many there are.
 */
export function shownWays<T extends { recipeId: string }>(ways: readonly T[], limit: number, inUse: string, pinned: string | undefined): T[] {
  return ways.filter((a, i) => i < limit || a.recipeId === inUse || a.recipeId === pinned);
}

/**
 * Every way the export knows to make the step's product (controller rulings of plan 09): those the group can use with a
 * radio each, the others greyed with why not; the first few, then pages of "more…"; last, importing the product instead.
 */
function SwapSection(props: { step: PlanStep; settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement {
  const { step, settings, nameOf, patch } = props;
  const group = useId();
  const [limit, setLimit] = useState(SWAP_SHOWN);
  const main = step.mainOutput;
  if (main === undefined) {
    return (
      <section className="flow-panel-section">
        <h4 className="flow-panel-title">Swap recipe</h4>
        <p className="muted">This step has no main product to pin a recipe for.</p>
      </section>
    );
  }
  const choices = settings.recipeChoice;
  const pinned = Object.hasOwn(choices, main) ? choices[main] : undefined;
  const choose = (recipeId: string | null): void => {
    const next = { ...choices };
    if (recipeId === null) delete next[main];
    else next[main] = recipeId;
    patch({ recipeChoice: next });
  };
  const alternatives = step.alternatives;
  const usable = alternatives.filter((a) => a.unusable === undefined);
  const pinUsable = pinned === undefined || usable.some((a) => a.recipeId === pinned);
  const shown = shownWays(alternatives, limit, step.recipeId, pinned);
  const hidden = alternatives.length - shown.length;
  // A product the line imports is counted at the cheapest way the group can make it (the stop item's price).
  const importCost = usable.reduce((least, a) => Math.min(least, a.rawCost), Number.POSITIVE_INFINITY);
  const ways = step.ways;
  return (
    <fieldset className="flow-panel-section" data-swap="">
      <legend className="flow-panel-title">Swap recipe</legend>
      {ways !== undefined && (
        <p className="muted small">{`${ways.total} ${ways.total === 1 ? 'way' : 'ways'} to make ${nameOf(main)}: ${ways.usable} you can use now`}</p>
      )}
      <label className="check">
        <input type="radio" name={group} checked={pinned === undefined} onChange={() => choose(null)} />
        Let the planner choose
      </label>
      {shown.map((a) => (a.unusable === undefined ? (
        <label key={a.recipeId} className="check swap-option" title={`recipe ${a.recipeId}`}>
          <input type="radio" name={group} checked={pinned === a.recipeId} onChange={() => choose(a.recipeId)} />
          <span className="swap-text">{`${alternativeText(a, nameOf)} · ${formatNumber(a.rawCost)} `}<RawUnit /></span>
          {a.recipeId === step.recipeId && <span className="badge">in use</span>}
        </label>
      ) : (
        <div key={a.recipeId} className="swap-option unusable" title={`recipe ${a.recipeId}`}>
          <span className="swap-text">{`${alternativeText(a, nameOf)} · ${formatNumber(a.rawCost)} `}<RawUnit />{` — ${a.unusable.join('; ')}`}</span>
        </div>
      )))}
      {hidden > 0 && (
        <div className="row">
          <button type="button" className="small" onClick={() => setLimit((n) => n + SWAP_PAGE)}>
            {hidden <= SWAP_PAGE ? `${hidden} more…` : `${SWAP_PAGE} more… (${hidden} not shown)`}
          </button>
        </div>
      )}
      {main !== settings.target && (
        <label className="check swap-option">
          <input type="radio" name={group} checked={settings.stopItems.includes(main)} onChange={() => patch(importInsteadPatch(settings, main))} />
          <span className="swap-text">
            {Number.isFinite(importCost) ? `Import it (counted at ${formatNumber(importCost)} ` : 'Import it'}
            {Number.isFinite(importCost) && <><RawUnit />)</>}
          </span>
        </label>
      )}
      {!pinUsable && <p className="muted small">{`The pinned recipe ${pinned} is not usable now, so the planner chose another.`}</p>}
      {usable.length <= 1 && <p className="muted small">{`No other recipe for ${nameOf(main)} is usable here.`}</p>}
    </fieldset>
  );
}

/** Stopping the chain at the step's product: the group supplies it from outside the line (`stopItems`). */
function StopSection(props: { step: PlanStep; settings: PlanSettings; nameOf: NameOf; patch: Patch }): ReactElement {
  const { step, settings, nameOf, patch } = props;
  const main = step.mainOutput;
  let body: ReactElement;
  if (main === undefined) body = <p className="muted">This step has no main product to import.</p>;
  else if (main === settings.target) body = <p className="muted">This step makes the target itself.</p>;
  else if (settings.stopItems.includes(main)) body = <p className="muted">{`${nameOf(main)} is marked already; the plan is catching up.`}</p>;
  else {
    body = (
      <>
        <p className="muted small">{`Stops the chain here: ${nameOf(main)} becomes an input of the line, counted at its cost.`}</p>
        <div className="row">
          <button type="button" onClick={() => patch(importInsteadPatch(settings, main))}>{`Import ${nameOf(main)} instead`}</button>
        </div>
      </>
    );
  }
  return (
    <section className="flow-panel-section">
      <h4 className="flow-panel-title">Supply it from outside</h4>
      {body}
    </section>
  );
}

export function StepPanel(props: {
  step: PlanStep; plan: Plan; settings: PlanSettings; send: Send; onClose(): void;
  /** The project's rate unit (default per hour). */
  per?: Per;
  /** Selects another step of the diagram (a Takes/Makes peer). */
  onSelect?(stepId: string): void;
  /** The project links a world base, so the machines a scan found and the step reuses stand in it (default: none). */
  base?: boolean;
}): ReactElement {
  const { step, plan, settings, send, onClose, onSelect } = props;
  const per = props.per ?? 'hour';
  const nameOf = namesOf(plan);
  const patch = settingsSender(send);
  const index = indexPlan(plan);
  const warnings = [...new Set([...step.warnings, ...plan.warnings.filter((w) => w.stepId === step.id).map((w) => w.text)])];
  const machines = step.count === 1 ? '1 machine' : `${step.count} machines`;
  const shared = sharedMachineText(step, plan);
  return (
    <aside className="flow-panel" aria-label={`Step: ${step.machine.name}`}>
      <PanelHead
        itemKey={step.mainOutput ?? null} title={step.machine.name} onClose={onClose}
        itemName={step.mainOutput === undefined ? undefined : nameOf(step.mainOutput)}
      />
      <p className="muted">
        {[machines, ...(step.mainOutput === undefined ? [] : [`makes ${nameOf(step.mainOutput)}`]), ...(step.handCraft ? ['by hand'] : [])].join(' · ')}
      </p>
      {shared !== null && <p>{shared}</p>}
      <PortsSection step={step} plan={plan} per={per} index={index} onSelect={onSelect} />
      {step.farm !== undefined && (
        <section className="flow-panel-section">
          <h4 className="flow-panel-title">Farm</h4>
          <p>{step.farm.text}</p>
        </section>
      )}
      <AlsoMadeBySection step={step} plan={plan} index={index} settings={settings} nameOf={nameOf} patch={patch} />
      <SupplySection step={step} plan={plan} settings={settings} nameOf={nameOf} patch={patch} />
      <LineSection step={step} settings={settings} patch={patch} />
      <OptionsSection step={step} settings={settings} nameOf={nameOf} patch={patch} />
      <ReuseSection step={step} plan={plan} settings={settings} base={props.base === true} patch={patch} />
      <MachineTierSection step={step} settings={settings} patch={patch} />
      <section className="flow-panel-section">
        <h4 className="flow-panel-title">Overclock</h4>
        <ul className="oc-lines">
          {ocLines(step).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <SwapSection step={step} settings={settings} nameOf={nameOf} patch={patch} />
      <StopSection step={step} settings={settings} nameOf={nameOf} patch={patch} />
      {warnings.length > 0 && (
        <section className="flow-panel-section">
          <h4 className="flow-panel-title">Warnings</h4>
          <ul className="warnings">
            {warnings.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** `Ore vein: <detail> — Moon, Mars`; dimensions by name (`dim:<key>` in Plan.names), else by key. */
function sourceText(source: SourceInfo, names: Plan['names']): string {
  const dims = source.dims.map((key) => names?.[`dim:${key}`] ?? key);
  const detail = source.detail === '' ? SOURCE_TEXT[source.kind] : `${SOURCE_TEXT[source.kind]}: ${source.detail}`;
  return dims.length > 0 ? `${detail} — ${dims.join(', ')}` : detail;
}

/** Where the group found it: the first few spots, their dimension by name (`dimId:<n>` in Plan.names) else `DIM<n>`. */
function foundText(spots: NonNullable<SourceInfo['foundAt']>, names: Plan['names']): string {
  const listedSpots = spots.slice(0, MAX_FOUND_AT).map((s) => `found at ${s.x} ${s.z} (${names?.[`dimId:${s.dim}`] ?? `DIM${s.dim}`})`);
  const more = spots.length > MAX_FOUND_AT ? ` and ${spots.length - MAX_FOUND_AT} more` : '';
  return `${listedSpots.join('; ')}${more}`;
}

/** "Bought: usually made by Alloy Smelter from Copper Ingot, Redstone (1 recipe)": what buying a derived material stands for. */
function pricedViaText(input: RawInput, nameOf: NameOf): string | null {
  const via = input.pricedVia;
  if (via === undefined || (input.leafClass !== 'derived' && input.leafClass !== 'stop')) return null;
  const from = via.inputs.length > 0 ? ` from ${via.inputs.map(nameOf).join(', ')}` : '';
  const head = input.leafClass === 'derived' ? 'Bought' : 'Supplied from outside';
  return `${head}: usually made by ${mapName(via.mapId, nameOf)}${from} (${via.steps} ${via.steps === 1 ? 'recipe' : 'recipes'})`;
}

/** Where a raw input taken from beyond the line comes from, in words (add-on 17). */
const TAKEN_FROM: Record<NonNullable<RawInput['from']>['kind'], string> = { project: "another project's surplus", farm: 'a farm the group runs' };

/**
 * The panel of a raw-material box (fix spec §6.3): what kind of import it is and how much, and how much the line takes
 * of it from a farm the group runs or another project (add-on 17: "From Rubber line, another project's surplus · 15/min"),
 * which steps use it (hovering one lights its arrow, clicking selects the step), what a bought one stands for, where it
 * comes from (when the line buys some) and what is in storage; for a base material "Make it here instead" (greyed when
 * nothing at the tier makes it), for a free input the group said it supplies "Plan its generator again".
 */
export function RawPanel(props: {
  itemKey: StuffKey; plan: Plan; settings: PlanSettings; per: Per; send: Send; onClose(): void; onSelect?(stepId: string): void;
}): ReactElement {
  const { itemKey, plan, settings, per, send, onClose, onSelect } = props;
  const nameOf = namesOf(plan);
  const patch = settingsSender(send);
  const name = nameOf(itemKey);
  const fluid = isFluidKey(itemKey);
  const rows = plan.rawInputs.filter((r) => r.key === itemKey);
  // What the line buys of it (its row without `from`), and what it takes from farms the group runs or other projects.
  const input: RawInput | undefined = rows.find((r) => r.from === undefined);
  const takenFrom = rows.flatMap((r) => (r.from === undefined ? [] : [{ from: r.from, perSecond: r.perSecond }]));
  const sources = input?.sources ?? [];
  const leaf = input?.leafClass;
  const steps = new Map(plan.steps.map((s) => [s.id, s]));
  const users: PlanFlow[] = plan.flows.filter((f) => f.from === RAW && f.key === itemKey && steps.has(f.to));
  const canExpand = leaf !== undefined && BASE_MATERIALS.has(leaf) && !settings.expandItems.includes(itemKey);
  const cannotMake = input?.canMake === false;
  const supplied = leaf === 'free' && (settings.haveSupply ?? []).includes(itemKey);
  const kind = leaf !== undefined ? LEAF_WORD[leaf] : input === undefined || input.available ? 'base material' : LEAF_WORD.unavailable;
  const via = input === undefined ? null : pricedViaText(input, nameOf);
  return (
    <aside className="flow-panel" aria-label={`Import: ${name}`}>
      <PanelHead itemKey={itemKey} itemName={name} title={name} onClose={onClose} />
      {input !== undefined && (
        <p className="muted">
          {`Import · ${kind} · ${formatRate(input.perSecond, per, { fluid })}`}
          {input.total !== undefined && ` · ${formatNumber(input.total)}${fluid ? ' L' : ''} for the whole batch`}
        </p>
      )}
      {takenFrom.map(({ from, perSecond }) => (
        <p key={`${from.kind}:${from.id}`} className="muted">{`From ${from.name}, ${TAKEN_FROM[from.kind]} · ${formatRate(perSecond, per, { fluid })}`}</p>
      ))}
      {leaf !== undefined && <p>{LEAF_TEXT[leaf]}</p>}
      {input !== undefined && !input.available && leaf !== 'unavailable' && <p className="error">{LEAF_TEXT.unavailable}</p>}
      {via !== null && <p>{via}</p>}
      {input?.have !== undefined && (
        <p className="muted">{`In storage: ${formatNumber(input.have.total)} (${formatNumber(input.have.reachable)} reachable by the line)`}</p>
      )}
      {users.length > 0 && (
        <section className="flow-panel-section">
          <h4 className="flow-panel-title">Used by</h4>
          <ul className="used-by">
            {users.map((f) => {
              const user = steps.get(f.to) as PlanStep;
              return (
                <li key={f.to} onMouseEnter={() => hoverFlowFocus({ kind: 'edge', id: flowEdgeId(f) })} onMouseLeave={endHoverFlowFocus}>
                  {onSelect === undefined
                    ? stepWords(user, nameOf)
                    : <button type="button" className="link" onClick={() => onSelect(f.to)}>{stepWords(user, nameOf)}</button>}
                  {` ${formatRate(f.perSecond, per, { fluid })}`}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {/* Where a bought good comes from: nothing to say of one the line only takes from a farm or another project. */}
      {(input !== undefined || takenFrom.length === 0) && (
        <section className="flow-panel-section">
          <h4 className="flow-panel-title">Sources</h4>
          {sources.length === 0 ? (
            <p className="muted">No known source in the pack.</p>
          ) : (
            <ul className="sources">
              {sources.map((source, i) => (
                <li key={`${source.kind}:${i}`}>
                  {sourceText(source, plan.names)}
                  {source.foundAt !== undefined && source.foundAt.length > 0 && (
                    <span className="muted small">{` · ${foundText(source.foundAt, plan.names)}`}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {canExpand && (
        <section className="flow-panel-section">
          <p className="muted small">Plan its own recipe in this line instead of importing it.</p>
          <div className="row">
            <button type="button" disabled={cannotMake} onClick={() => patch(makeHerePatch(settings, itemKey))}>Make it here instead</button>
          </div>
          {cannotMake && <p className="muted small">{`Nothing at ${tierName(plan.tier)} makes ${name}`}</p>}
        </section>
      )}
      {supplied && (
        <section className="flow-panel-section">
          <p className="muted small">{`You said the group already has a supply of ${name}, so the line takes it free.`}</p>
          <div className="row">
            <button type="button" onClick={() => patch(haveSupplyPatch(settings, itemKey, false))}>Plan its generator again</button>
          </div>
        </section>
      )}
    </aside>
  );
}
