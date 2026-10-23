// The recipe swap of one good (spec §3.9, §3.10): every way the export knows to make it, the ones the group can use
// with a radio each (the one in use badged), the others greyed with why not; the first few, then pages of "more…";
// last, importing the good instead. The flow view's step panel shows it for a step's product, the Materials page for
// each made build part (architecture §11 entry 41 (3)). A pick sends one `settings` patch: the pins
// (`PlanSettings.recipeChoice`) are shared by the running line and the build list.

import { useId, useState, type ReactElement } from 'react';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanSettings, PlanStep } from '../../shared/types/plan.ts';
import { formatNumber } from '../format.ts';
import { importInsteadPatch } from '../views/flow-model.ts';

type NameOf = (key: string) => string;

export type Alternative = PlanStep['alternatives'][number];

/** Swap options shown before "more…" (the one in use and a pinned one always show). */
export const SWAP_SHOWN = 5;
/** Swap options each "more…" adds: a product can have a thousand ways (Wood Pulp), too many to list at once. */
export const SWAP_PAGE = 25;
/** What "raw/unit" means (fix spec §6.3). */
export const RAW_UNIT_TITLE = 'raw-material units per unit made (1 base item, 144 L molten metal or 1,000 L other fluid = 1)';

/** A recipe map id in words: `gt.recipe.assembler` → `Assembler`, for a plan whose names have no `map:` entry. */
function mapLabel(mapId: string): string {
  const words = mapId.replace(/^.*?recipe\./, '').replace(/[._-]+/g, ' ').trim();
  return words === '' ? mapId : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The machine a recipe map runs on, by the plan's name for the map. */
export function mapName(mapId: string, nameOf: NameOf): string {
  const name = nameOf(`map:${mapId}`);
  return name === `map:${mapId}` ? mapLabel(mapId) : name;
}

/** "72 L Molten Tin", "2× Redstone", "Redstone": an amount of a good. */
export function amountWords(key: StuffKey, amount: number, nameOf: NameOf): string {
  if (isFluidKey(key)) return `${formatNumber(amount)} L ${nameOf(key)}`;
  return amount === 1 ? nameOf(key) : `${formatNumber(amount)}× ${nameOf(key)}`;
}

/** "2× Copper Wire, 72 L Molten Soldering Alloy / 144 L Molten Tin": goods with their amounts per run, every option of a slot. */
function partsText(parts: Alternative['inputs'], nameOf: NameOf): string {
  return (parts ?? []).map((p) => (p.options !== undefined && p.options.length > 1 ? p.options : [p]).map((o) => amountWords(o.key, o.amount, nameOf)).join(' / ')).join(', ');
}

/** One swap option in words: its machine and what a run takes and makes. */
export function alternativeText(a: Alternative, nameOf: NameOf): string {
  const takes = partsText(a.inputs, nameOf);
  const makes = partsText(a.outputs, nameOf);
  const what = takes === '' && makes === '' ? '' : `: ${takes === '' ? 'nothing' : takes} → ${makes}`;
  return `${mapName(a.mapId, nameOf)}${what}`;
}

/** "raw/unit", with what it means on hover. */
export function RawUnit(): ReactElement {
  return <abbr className="unit-hint" title={RAW_UNIT_TITLE}>raw/unit</abbr>;
}

/**
 * The swap rows shown while `limit` rows are open (the server sorts them: usable ways first, each group by raw material
 * use): the first `limit`, plus the one in use and a pinned one wherever they are; "more…" raises the limit a page at a
 * time (`SWAP_SHOWN`, then `SWAP_PAGE` more), so every way can be reached however many there are.
 */
export function shownWays<T extends { recipeId: string }>(ways: readonly T[], limit: number, inUse: string, pinned: string | undefined): T[] {
  return ways.filter((a, i) => i < limit || a.recipeId === inUse || a.recipeId === pinned);
}

/** The settings patch that pins `recipeId` for `good` (null: lets the planner choose again), every other pin kept. */
export function swapPatch(choices: Readonly<Record<StuffKey, string>>, good: StuffKey, recipeId: string | null): Partial<PlanSettings> {
  const next = { ...choices };
  if (recipeId === null) delete next[good];
  else next[good] = recipeId;
  return { recipeChoice: next };
}

export interface SwapRecipeProps {
  /** The good whose recipe is pinned (`PlanSettings.recipeChoice[good]`). */
  good: StuffKey;
  /** The recipe the plan makes it with now. */
  inUse: string;
  /** Every way to make it, as the plan sorts them (`PlanStep['alternatives']`, `Plan.buildAlternatives`). */
  alternatives: readonly Alternative[];
  legend: string;
  /** How many ways the export knows and how many the group can use (`PlanStep.ways`), when the plan counts them. */
  ways?: { total: number; usable: number };
  settings: PlanSettings;
  nameOf(key: string): string;
  patch(p: Partial<PlanSettings>): void;
}

/**
 * Every way to make `good` (controller rulings of plan 09): those the group can use with a radio each, the others
 * greyed with why not; the first few, then pages of "more…"; last, importing the good instead — unless it is the line's
 * own target. A pin the plan cannot use is said so.
 */
export function SwapRecipe(props: SwapRecipeProps): ReactElement {
  const { good, inUse, alternatives, legend, ways, settings, nameOf, patch } = props;
  const group = useId();
  const [limit, setLimit] = useState(SWAP_SHOWN);
  const choices = settings.recipeChoice;
  const pinned = Object.hasOwn(choices, good) ? choices[good] : undefined;
  const choose = (recipeId: string | null): void => patch(swapPatch(choices, good, recipeId));
  const usable = alternatives.filter((a) => a.unusable === undefined);
  const pinUsable = pinned === undefined || usable.some((a) => a.recipeId === pinned);
  const shown = shownWays(alternatives, limit, inUse, pinned);
  const hidden = alternatives.length - shown.length;
  // A product the line imports is counted at the cheapest way the group can make it (the stop item's price).
  const importCost = usable.reduce((least, a) => Math.min(least, a.rawCost), Number.POSITIVE_INFINITY);
  return (
    <fieldset className="flow-panel-section" data-swap="">
      <legend className="flow-panel-title">{legend}</legend>
      {ways !== undefined && (
        <p className="muted small">{`${ways.total} ${ways.total === 1 ? 'way' : 'ways'} to make ${nameOf(good)}: ${ways.usable} you can use now`}</p>
      )}
      <label className="check">
        <input type="radio" name={group} checked={pinned === undefined} onChange={() => choose(null)} />
        Let the planner choose
      </label>
      {shown.map((a) => (a.unusable === undefined ? (
        <label key={a.recipeId} className="check swap-option" title={`recipe ${a.recipeId}`}>
          <input type="radio" name={group} checked={pinned === a.recipeId} onChange={() => choose(a.recipeId)} />
          <span className="swap-text">{`${alternativeText(a, nameOf)} · ${formatNumber(a.rawCost)} `}<RawUnit /></span>
          {a.recipeId === inUse && <span className="badge">in use</span>}
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
      {good !== settings.target && (
        <label className="check swap-option">
          <input type="radio" name={group} checked={settings.stopItems.includes(good)} onChange={() => patch(importInsteadPatch(settings, good))} />
          <span className="swap-text">
            {Number.isFinite(importCost) ? `Import it (counted at ${formatNumber(importCost)} ` : 'Import it'}
            {Number.isFinite(importCost) && <><RawUnit />)</>}
          </span>
        </label>
      )}
      {!pinUsable && <p className="muted small">{`The pinned recipe ${pinned} is not usable now, so the planner chose another.`}</p>}
      {usable.length <= 1 && <p className="muted small">{`No other recipe for ${nameOf(good)} is usable here.`}</p>}
    </fieldset>
  );
}
