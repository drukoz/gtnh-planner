// The recipe browser's popup for one good (RUK-740), as pure functions: the cards an NEI-style popup shows — the recipes
// that make a good (a plan step's alternatives when the line makes it, the pack's producers when it does not) and the
// recipes that use it (the pack's consumers) — in the server's order, with the marks the popup draws (in use, pinned,
// unusable, fake, kept, partial, slot options), the note line above the cards, which button the cards get (pin a recipe,
// make a bought good with it, none) and the settings patch that button sends, and the good a flow-chart focus stands on.
// RUK-T8 draws the popup from this; no React, no fetch and no DOM here.

import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { RecipeSummary, StuffInfo } from '../../shared/types/api.ts';
import type { Plan, PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import { mapName, swapPatch } from '../components/SwapRecipe.tsx';
import { formatNumber } from '../format.ts';
import { importInsteadPatch, tierText, type FlowEdge, type FlowNode, type Focus } from './flow-model.ts';
import { toggleList } from './settings-model.ts';

/** What the popup shows for one good: the recipes that make it, or the recipes that use it. */
export type BrowserMode = 'recipes' | 'uses';

/**
 * One input or output of a card: its key, its name, its amount per run, whether it is a fluid, the names of the
 * slot's other options (an ore-dictionary slot), whether the run keeps (does not consume) it, and its chance when
 * that is below 1.
 */
export interface BrowserSlot {
  key: StuffKey; name: string; amount: number; fluid: boolean;
  others?: string[]; kept?: boolean; chance?: number;
}

/**
 * One recipe as a card: its id, the machine's name, the facts line (the plan's "<raw> raw/unit" or the pack's
 * "<tier> · <EU/t> EU/t · <s> s"), its slots, whether a step of the line runs it, whether the settings pin it,
 * why it cannot be picked (the plan's `unusable`, in words), and whether it is display-only (the pack's `fake`).
 */
export interface BrowserCard {
  recipeId: string; machine: string; facts: string;
  inputs: BrowserSlot[]; outputs: BrowserSlot[];
  inUse: boolean; pinned: boolean; unusable?: string[]; fake?: boolean;
}

/** The button every card of a list gets: pin the recipe, make the bought good with it, or none (read-only). */
export type BrowserAction = 'pin' | 'make' | 'none';

/** One popup: the good, its name, the mode, the cards in the server's order, and the note and button above them. */
export interface BrowserList {
  mode: BrowserMode; good: StuffKey; name: string; action: BrowserAction; cards: BrowserCard[];
  /** A line of words above the cards, or null. */
  note: string | null;
  /** Whether "Import it instead" is offered. */
  canImport: boolean;
}

type Alternative = PlanStep['alternatives'][number];

/** A plan's name for a key, the key itself when the plan does not name it (the same fallback as every panel). */
function planNameOf(plan: Plan): (key: string) => string {
  return (key) => plan.names?.[key] ?? key;
}

/** The names of an ore-dictionary slot's options after the first; absent for a one-option slot. */
function othersAfterFirst<T extends { key: StuffKey }>(options: T[] | undefined, name: (key: StuffKey) => string): string[] | undefined {
  return options !== undefined && options.length > 1 ? options.slice(1).map((o) => name(o.key)) : undefined;
}

/** A plan alternative as a card, without the `inUse` and `pinned` marks the list adds. */
function planCard(a: Alternative, nameOf: (key: string) => string): Omit<BrowserCard, 'inUse' | 'pinned'> {
  return {
    recipeId: a.recipeId,
    machine: mapName(a.mapId, nameOf),
    facts: `${formatNumber(a.rawCost)} raw/unit`,
    inputs: (a.inputs ?? []).map((p) => {
      const others = othersAfterFirst(p.options, (k) => nameOf(k));
      return { key: p.key, name: nameOf(p.key), amount: p.amount, fluid: isFluidKey(p.key), ...(others === undefined ? {} : { others }) };
    }),
    outputs: (a.outputs ?? []).map((p) => ({ key: p.key, name: nameOf(p.key), amount: p.amount, fluid: isFluidKey(p.key) })),
    ...(a.unusable === undefined ? {} : { unusable: [...a.unusable] }),
  };
}

/**
 * The ways the line makes `good` when a step has it as its main output: one card per alternative of the first such
 * step, in the server's order, `inUse` on a recipe some step of that good runs and `pinned` on the recipe the
 * settings pin; `note` null, `action` 'pin', "Import it instead" offered for every good but the line's own target.
 * Null when no step makes it, in which case the popup shows the pack's producers (`needsPack`).
 */
export function planList(plan: Plan, settings: PlanSettings, good: StuffKey): BrowserList | null {
  const first = plan.steps.find((st) => st.mainOutput === good);
  if (first === undefined) return null;
  const nameOf = planNameOf(plan);
  const pinnedRecipe = Object.hasOwn(settings.recipeChoice, good) ? settings.recipeChoice[good] : undefined;
  const cards: BrowserCard[] = first.alternatives.map((a) => ({
    ...planCard(a, nameOf),
    inUse: plan.steps.some((st) => st.mainOutput === good && st.recipeId === a.recipeId),
    pinned: pinnedRecipe !== undefined && pinnedRecipe === a.recipeId,
  }));
  return { mode: 'recipes', good, name: nameOf(good), action: 'pin', cards, note: null, canImport: good !== settings.target };
}

/**
 * Whether the popup must fetch `GET /api/pack/stuff/:key` for `good`: always for 'uses', and for 'recipes' when no
 * step of the line has `good` as its main output (the plan's alternatives cover a made good).
 */
export function needsPack(plan: Plan, good: StuffKey, mode: BrowserMode): boolean {
  return mode === 'uses' || !plan.steps.some((st) => st.mainOutput === good);
}

/**
 * A pack recipe as a card: its facts are the machine's tier, power and run time (`tierText`, EU/t, seconds; a
 * crafting recipe's are empty), its slots keep what the pack says (kept inputs, partial outputs, slot options by
 * their own names), and `inUse`, `pinned` and the display-only `fake` mark come as the popup draws them.
 */
function packCard(s: RecipeSummary, plan: Plan, settings: PlanSettings, good: StuffKey): BrowserCard {
  const facts = [
    ...(s.euPerTick > 0 || s.durationTicks > 0 ? [tierText(s.tier)] : []),
    ...(s.euPerTick > 0 ? [`${formatNumber(s.euPerTick)} EU/t`] : []),
    ...(s.durationTicks > 0 ? [`${formatNumber(s.durationTicks / 20)} s`] : []),
  ].join(' · ');
  return {
    recipeId: s.id,
    machine: s.machineName,
    facts,
    inputs: s.inputs.map((p) => ({
      key: p.key, name: p.name, amount: p.amount, fluid: isFluidKey(p.key),
      ...(p.consumed ? {} : { kept: true }),
      ...(p.options === undefined || p.options.length <= 1 ? {} : { others: p.options.slice(1).map((o) => o.name) }),
    })),
    outputs: s.outputs.map((p) => ({
      key: p.key, name: p.name, amount: p.amount, fluid: isFluidKey(p.key),
      ...(p.chance < 1 ? { chance: p.chance } : {}),
    })),
    inUse: plan.steps.some((st) => st.recipeId === s.id),
    pinned: Object.hasOwn(settings.recipeChoice, good) && settings.recipeChoice[good] === s.id,
    ...(s.fake === true ? { fake: true } : {}),
  };
}

/**
 * The pack's recipes for `info.key` as the popup shows them: its producers for 'recipes' and its consumers for
 * 'uses', in the server's order, and the note saying what the list is. A 'recipes' popup of a good the line buys
 * (a raw input of the plan, not one capped by a surplus) gets `action` 'make' — every card offers making the bought
 * good with that recipe instead — and every other list is read-only ('none'). "Import it instead" is not offered:
 * the popup's own good, not this pack entry's, decides it, and RUK-T8 keeps the plan list's.
 */
export function packList(info: StuffInfo, plan: Plan, settings: PlanSettings, mode: BrowserMode): BrowserList {
  const name = info.name;
  const summaries = mode === 'recipes' ? info.producers : info.consumers;
  const cards = summaries.map((s) => packCard(s, plan, settings, info.key));
  const bought = plan.rawInputs.some((r) => r.key === info.key && r.from === undefined);
  const action: BrowserAction = mode === 'recipes' && bought ? 'make' : 'none';
  let note: string;
  if (cards.length === 0) note = mode === 'uses' ? `Nothing in this pack uses ${name}.` : `Nothing in this pack makes ${name}.`;
  else if (mode === 'uses') note = `What uses ${name}`;
  else if (action === 'make') note = `The line buys ${name}. Make it with one of these recipes instead:`;
  else note = `Nothing in this line makes ${name} on purpose. The pack's recipes for it:`;
  if (cards.length === 50) note += ' (the first 50)';
  return { mode, good: info.key, name, action, cards, note, canImport: false };
}

/** The patch a card's button sends: `swapPatch` pinning it ('pin'), `makeWithPatch` ('make'), null for a read-only card ('none'). */
export function cardPatch(list: BrowserList, settings: PlanSettings, recipeId: string): Partial<PlanSettings> | null {
  if (list.action === 'pin') return swapPatch(settings.recipeChoice, list.good, recipeId);
  if (list.action === 'make') return makeWithPatch(settings, list.good, recipeId);
  return null;
}

/** "Let the planner choose": drop `good`'s pin, every other pin kept. */
export function plannerChoosesPatch(settings: PlanSettings, good: StuffKey): Partial<PlanSettings> {
  return swapPatch(settings.recipeChoice, good, null);
}

/** "Import it instead": `good` in `stopItems`, so the planner buys it and stops expanding it. */
export function importPatch(settings: PlanSettings, good: StuffKey): Partial<PlanSettings> {
  return importInsteadPatch(settings, good);
}

/**
 * "Make it with this recipe" for a bought good: `good` into `expandItems`, out of `stopItems`, and pinned to
 * `recipeId` — the three settings of "make this here, with this recipe" — every other entry kept.
 */
export function makeWithPatch(settings: PlanSettings, good: StuffKey, recipeId: string): Partial<PlanSettings> {
  return {
    expandItems: toggleList(settings.expandItems, good, true),
    stopItems: toggleList(settings.stopItems, good, false),
    recipeChoice: { ...settings.recipeChoice, [good]: recipeId },
  };
}

/** The good a flow-chart focus stands on: an item's key, a node's or an edge's good; null for no focus, a missing id, or a stub with no good. */
export function focusGood(graph: { nodes: readonly FlowNode[]; edges: readonly FlowEdge[] }, focus: Focus): StuffKey | null {
  if (focus === null) return null;
  if (focus.kind === 'item') return focus.key;
  if (focus.kind === 'node') return graph.nodes.find((n) => n.id === focus.id)?.key ?? null;
  return graph.edges.find((e) => e.id === focus.id)?.key ?? null;
}
