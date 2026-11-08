// The recipe browser's popup for one good (RUK-740 task 8): an NEI-style modal listing the recipes that make a material (R) or use it (U),
// drawn from `recipe-browser-model.ts` — the plan's alternatives when the line makes the good, the pack's producers and consumers when it does
// not. Each card shows the machine, its facts and marks, and what a run takes and makes as slots with their stack counts and chance tags, the
// GT arrow between. Its buttons send the settings patch the model computes (pin a recipe, make a bought good with one, import it, let the
// planner choose). It is the top layer while open, as the shortcuts sheet is; nothing opens it yet (task 9 wires it to the R/U keys).

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { formatPercent } from '../../shared/format.ts';
import type { StuffKey } from '../../shared/keys.ts';
import type { StuffInfo } from '../../shared/types/api.ts';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import { apiGet, messageOf } from '../api/client.ts';
import { RecipeMode } from '../state/recipe-request.ts';
import { setToastsInert } from '../state/toasts.ts';
import { chanceTag, stackText } from '../views/flow-model.ts';
import {
  BrowserAction, cardPatch, importPatch, needsPack, packList, planList, plannerChoosesPatch,
  type BrowserCard, type BrowserList, type BrowserSlot,
} from '../views/recipe-browser-model.ts';
import { Figs } from './Figs.tsx';
import { GtArrow } from './GtArrow.tsx';
import { ItemIcon } from './ItemIcon.tsx';
import { amountWords, SWAP_PAGE, SWAP_SHOWN } from './SwapRecipe.tsx';

/** Where the popup's list stands: being fetched, ready, or failed. Numbers never change; a new member takes the next. */
export const BrowserLoad = { Loading: 0, Ready: 1, Failed: 2 } as const;
export type BrowserLoad = (typeof BrowserLoad)[keyof typeof BrowserLoad];

/** The popup's list: the cards being fetched, ready with the model's list, or failed with the error's words. */
export type BrowserState =
  | { load: typeof BrowserLoad.Loading }
  | { load: typeof BrowserLoad.Ready; list: BrowserList }
  | { load: typeof BrowserLoad.Failed; message: string };

/**
 * The popup's dialog: a title, the R/U tabs, and the list — the note, the row of whole-list buttons ('Let the planner choose', 'Import it
 * instead') when its cards can be pinned, and the cards as NEI draws a run: machine, facts and badges, then the slots a run takes, the GT arrow,
 * the slots it makes. `SWAP_SHOWN` cards show, a page more per 'more…', the in-use and pinned ones always. A card's button sends `cardPatch`
 * through `onPatch` and closes. It fetches nothing, so tests render it whole; Escape and Tab stay in it and R/U switch the mode (no key gets
 * past the modal top layer, as in `ShortcutsDialog`, P2-D22).
 */
export function RecipeBrowserDialog(props: {
  good: StuffKey; name: string; mode: RecipeMode; state: BrowserState; settings: PlanSettings;
  onMode(m: RecipeMode): void; onPatch(p: Partial<PlanSettings>): void; onClose(): void; closeRef?: Ref<HTMLButtonElement>;
}): ReactElement {
  const { name, mode, state, settings, onMode, onPatch, onClose, closeRef } = props;
  const titleId = useId();
  const [limit, setLimit] = useState(SWAP_SHOWN);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape: the modal top layer stops it, and closes on one nobody above took (P2-D22, P2-R21b). R and U are the page's shortcuts (the Flow
    // view's), and inside the popup they are the tabs: the page's listener must not hear them too.
    if (e.key === 'Escape') { e.stopPropagation(); if (!e.nativeEvent.defaultPrevented) { e.preventDefault(); onClose(); } return; }
    if (e.key === 'Tab') {
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button')];
      const [first, last] = [controls[0], controls.at(-1)];
      const at = document.activeElement;
      if (first === undefined || last === undefined) return;
      const inside = controls.some((control) => control === at);
      if (e.shiftKey ? inside && at !== first : inside && at !== last) return;   // the browser's own step, to the next control
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation(); e.preventDefault(); onMode(RecipeMode.Recipes); return;
    }
    if ((e.key === 'u' || e.key === 'U') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation(); e.preventDefault(); onMode(RecipeMode.Uses); return;
    }
  };
  const list = state.load === BrowserLoad.Ready ? state.list : null;
  const cards = list === null ? [] : list.cards;
  // the first `limit`, and the in-use and pinned cards wherever the server put them (the same rule as the swap's `shownWays`)
  const shown = cards.filter((c, i) => i < limit || c.inUse || c.pinned);
  const hidden = cards.length - shown.length;
  const slot = (s: BrowserSlot, i: number): ReactElement => {
    const extra = [
      ...(s.kept === true ? ['not used up'] : []),
      ...(s.chance === undefined ? [] : [`${formatPercent(s.chance)} chance`]),
      ...(s.others ?? []).map((o) => `or ${o}`),
    ];
    const words = [amountWords(s.key, s.amount, () => s.name), ...extra].join(', ');
    const tip = [`${amountWords(s.key, s.amount, () => s.name)} per run`, ...extra];
    const count = stackText(s.key, s.amount);
    return (
      <li key={`${i}:${s.key}`} className="recipe-slot" data-recipe-key={s.key}>
        <ItemIcon itemKey={s.key} size={32} name={s.name} label={words} tip={tip} />
        {count !== '' && <span className="stack-count" aria-hidden="true">{count}</span>}
        {s.chance !== undefined && <span className="slot-chance" aria-hidden="true"><Figs text={chanceTag(s.chance)} /></span>}
      </li>
    );
  };
  const cardButton = (c: BrowserCard): ReactElement | null => {
    if (list === null) return null;
    const label = list.action === BrowserAction.Pin && c.unusable === undefined && c.fake !== true ? 'Use this recipe'
      : list.action === BrowserAction.Make && c.fake !== true ? 'Make it with this recipe'
        : null;
    if (label === null) return null;
    return (
      <button type="button" onClick={() => {
        const p = cardPatch(list, settings, c.recipeId);
        if (p !== null) onPatch(p);
        onClose();
      }}>{label}</button>
    );
  };
  return (
    <div className="modal recipe-browser" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <h2 id={titleId}>{mode === RecipeMode.Recipes ? `Recipes for ${name}` : `Uses of ${name}`}</h2>
      <div className="row browser-modes">
        <button type="button" aria-pressed={mode === RecipeMode.Recipes} onClick={() => onMode(RecipeMode.Recipes)}>Recipes (R)</button>
        <button type="button" aria-pressed={mode === RecipeMode.Uses} onClick={() => onMode(RecipeMode.Uses)}>Uses (U)</button>
      </div>
      {state.load === BrowserLoad.Loading && <p className="muted">Loading recipes…</p>}
      {state.load === BrowserLoad.Failed && <p className="error" role="alert">{`Could not load the recipes: ${state.message}`}</p>}
      {list !== null && (
        <>
          {list.note !== null && <p className="muted">{list.note}</p>}
          {list.action === BrowserAction.Pin && (
            <div className="row">
              <button type="button" className="small" onClick={() => { onPatch(plannerChoosesPatch(settings, list.good)); onClose(); }}>
                Let the planner choose
              </button>
              {list.canImport && (
                <button type="button" className="small" onClick={() => { onPatch(importPatch(settings, list.good)); onClose(); }}>
                  Import it instead
                </button>
              )}
            </div>
          )}
          <ul className="browser-cards">
            {shown.map((c) => (
              <li key={c.recipeId} className={c.unusable === undefined ? 'browser-card' : 'browser-card unusable'} data-recipe-id={c.recipeId}>
                <div className="browser-card-head">
                  <span className="browser-machine">{c.machine}</span>
                  {c.facts !== '' && <span className="muted small"><Figs text={c.facts} /></span>}
                  {c.inUse && <span className="badge">in use</span>}
                  {c.pinned && <span className="badge">pinned</span>}
                  {c.fake === true && <span className="badge">display only</span>}
                </div>
                <div className="recipe-strip">
                  {c.inputs.length > 0 && <ul className="recipe-slots" aria-label="Takes per run">{c.inputs.map(slot)}</ul>}
                  <GtArrow tone="panel" still />
                  {c.outputs.length > 0 && <ul className="recipe-slots" aria-label="Makes per run">{c.outputs.map(slot)}</ul>}
                </div>
                {c.unusable !== undefined && <p className="muted small">{`Not usable: ${c.unusable.join('; ')}`}</p>}
                {cardButton(c)}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <div className="row">
              <button type="button" className="small" onClick={(e) => {
                // the button goes as the rest comes: the dialog takes its focus first, so it never falls to the inert page
                e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
                setLimit((n) => n + SWAP_PAGE);
              }}>
                <Figs text={hidden <= SWAP_PAGE ? `${hidden} more…` : `${SWAP_PAGE} more… (${hidden} not shown)`} />
              </button>
            </div>
          )}
        </>
      )}
      <button type="button" ref={closeRef} onClick={onClose}>Close</button>
    </div>
  );
}

/**
 * The popup over the page: the list's data and the modal layer. The plan's own alternatives answer a made good's recipes tab (no fetch); anything
 * else — every uses tab, and a good the line does not make — is fetched from the pack once per good, so switching R/U reuses it and a late answer
 * is dropped. As `ShortcutsSheet` is, it is a portal on <body> with #root inert and the toasts held while open; Close takes the focus as it
 * opens, a press on the dimmed page closes, and the page takes the focus back.
 */
export function RecipeBrowser(props: {
  good: StuffKey; mode: RecipeMode; plan: Plan; settings: PlanSettings;
  patch(p: Partial<PlanSettings>): void; onMode(m: RecipeMode): void; onClose(): void;
}): ReactElement {
  const { good, mode, plan, settings, patch, onMode, onClose } = props;
  const local = needsPack(plan, good, mode) ? null : planList(plan, settings, good);
  const [stuff, setStuff] = useState<{ good: StuffKey; info: StuffInfo } | null>(null);
  const [failure, setFailure] = useState<{ good: StuffKey; message: string } | null>(null);
  // the effect reads the latest fetch and the plan's own list without re-fetching on every render they cause
  const localRef = useRef(local);
  localRef.current = local;
  const stuffRef = useRef(stuff);
  stuffRef.current = stuff;
  useEffect(() => {
    if (localRef.current !== null) return;
    if (stuffRef.current !== null && stuffRef.current.good === good) return;   // this good is already in hand: R/U switch costs no fetch
    let alive = true;
    apiGet<StuffInfo>('/api/pack/stuff/' + encodeURIComponent(good)).then(
      (info) => { if (alive) { setStuff({ good, info }); setFailure(null); } },
      (err: unknown) => { if (alive) setFailure({ good, message: messageOf(err) }); },
    );
    return () => { alive = false; };
  }, [good, mode, plan]);
  const state: BrowserState = local !== null ? { load: BrowserLoad.Ready, list: local }
    : stuff !== null && stuff.good === good ? { load: BrowserLoad.Ready, list: packList(stuff.info, plan, settings, mode) }
      : failure !== null && failure.good === good ? { load: BrowserLoad.Failed, message: failure.message }
        : { load: BrowserLoad.Loading };
  const name = state.load === BrowserLoad.Ready ? state.list.name : plan.names?.[good] ?? good;
  const close = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const prev = document.activeElement;
    const root = document.getElementById('root');
    if (root !== null) root.inert = true;
    setToastsInert(true, 'sheet');
    close.current?.focus();
    return () => {
      if (root !== null) root.inert = false;
      setToastsInert(false, 'sheet');
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();   // no focus moves to the dimmed page: the page gives it back as the popup closes
        onClose();
      }}
    >
      <RecipeBrowserDialog
        good={good} name={name} mode={mode} state={state} settings={settings}
        onMode={onMode} onPatch={patch} onClose={onClose} closeRef={close}
      />
    </div>,
    document.body,
  );
}
