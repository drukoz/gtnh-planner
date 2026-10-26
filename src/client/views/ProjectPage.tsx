// One project (spec §3.11): its name (anyone can rename it), whether this tab is live, what the plan warns about or
// needs unlocked and what it uses beyond its line (farms, other projects' surplus), the Compare card of its planning
// modes (add-on 17), which a "Compare modes" button opens, in the head on a wide window and in a bar of its own under the
// banner at 900 px and below (the stylesheet shows only one of the two), the settings panel with the in-game projector
// panel under it (§3.13) and, beside them, the project tabs. The tab follows the URL hash, so links elsewhere
// (a build step's map pin sets `#map`) switch it too. Anyone can delete the project; once it is deleted, here or
// elsewhere, the page goes back to the project list, which says so (§11.24). Below 900 px the settings panel is a drawer
// that the Settings button in the head slides in over a dimmed page (design spec §7a), a layer of its own while it is
// open (ruling R36). What to make is the first of its sections, so it is never left out of sight: a project with no target
// opens the drawer by itself, once, into the item search; the plan banner's hint to pick something to make goes there too;
// and the Settings button says what the line makes. At the top of the banners, the plan's key numbers sit in a strip of
// readouts (Phase 2 spec §10): what it makes, its peak power, its machines, and what it costs to build and to run. While a new
// plan is on its way the banner says so with the GT progress arrow, on a line that moves nothing, on the strip's top-right corner (Phase 2
// spec §11.3, ledger rulings P2-R18 and P2-R51), and the drawer, behind which the banners are inert, has a status line of its own (R43).
// A rename here says so in a toast, with Undo (Phase 2 spec §12), and so does a delete, whose Undo restores the project from the list the page
// leaves for. A deleted note waits in the page's store, which posts its delete once the note's toast has gone, or as the page goes (§12.2).

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { StuffKey } from '../../shared/keys.ts';
import { indexPlan, issueText, type PlanIssue, type PlanIssueCode } from '../../shared/plan/balance.ts';
import { validateOp } from '../../shared/project/apply-op.ts';
import type { PackInfo } from '../../shared/types/api.ts';
import type { Plan, PlanSettings, PlanWarning } from '../../shared/types/plan.ts';
import type { ProjectOp } from '../../shared/types/project.ts';
import { apiGet, messageOf } from '../api/client.ts';
import { listenProjectEvents } from '../api/sse.ts';
import { DeleteProject, showDeletedToast } from '../components/DeleteProject.tsx';
import { Figs } from '../components/Figs.tsx';
import { GtArrow } from '../components/GtArrow.tsx';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { ITEM_SEARCH_PLACEHOLDER } from '../components/ItemSearch.tsx';
import { SettingsToggle } from '../components/SettingsToggle.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { formatPercent } from '../format.ts';
import { leaveDeletedProject } from '../state/deleted-notice.ts';
import { setFlowFocus, showInFlow } from '../state/flow-focus.ts';
import { useName } from '../state/name.ts';
import { useProject } from '../state/project-store.ts';
import { dismissToast, setToastsInert, showToast } from '../state/toasts.ts';
import { CompareCard, CompareToggle, useCompare } from './CompareCard.tsx';
import { ISSUE_ORDER, problemId } from './flow-model.ts';
import { KeyNumbers } from './KeyNumbers.tsx';
import { sourceNotes } from './materials-model.ts';
import { costLine } from './plan-cost.ts';
import { PROJECT_TABS, tabFromHash } from './project-tabs.ts';
import { ProjectorPanel } from './ProjectorPanel.tsx';
import { stepChargeLabel, stepChargeOf } from './settings-model.ts';
import { SettingsPanel, usePickedNames } from './SettingsPanel.tsx';

function ProjectName(props: { name: string; onRename(name: string): void }): ReactElement {
  const { name, onRename } = props;
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(name);   // someone else renamed it, or an edit ended
  }, [name, editing]);
  const commit = (value: string): void => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = value.trim();
    if (next !== name) onRename(next);   // the store checks the name and shows why one is refused
  };
  return (
    <input
      className="project-name"
      aria-label="Project name"
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.defaultPrevented) e.currentTarget.blur();   // not a held Enter's repeat that landed here (P2-R69a)
        // one layer per press: a key a layer above has handled (the shared tooltip's, hiding its tip) is not this one's (P2-R21b)
        if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The windows the settings column is a drawer in (the stylesheet's query, `max-width: 900px`). */
const NARROW = '(max-width: 900px)';

/** The integrity issue codes (fix spec R11), to tell a server's integrity warnings from its other warnings. */
const ISSUE_CODES: ReadonlySet<string> = new Set(ISSUE_ORDER);
/** The code of the server's hint for a project with no target ("Pick something to make"). */
const NO_TARGET = 'no-target';
/** A plan uses more raw material than the least only when it does by more than this share (not by rounding). */
const COST_GAP_REL = 1e-6;

/** "2 inputs have no source": the summary's part for `n` issues of one code. */
function issueCount(code: PlanIssueCode, n: number, issues: readonly PlanIssue[]): string {
  const one = n === 1;
  switch (code) {
    case 'orphan-input': return one ? '1 input has no source' : `${n} inputs have no source`;
    case 'short-input': return one ? '1 input is supplied short' : `${n} inputs are supplied short`;
    case 'multi-producer': {
      const ways = new Set(issues.map((i) => i.stepIds?.length ?? 2));
      const how = ways.size === 1 && ways.has(2) ? 'two ways' : 'more than one way';
      return one ? `1 good is made ${how}` : `${n} goods are made ${how}`;
    }
    case 'bought-and-made': return one ? '1 good is both bought and made' : `${n} goods are both bought and made`;
  }
}

/** What the plan banner lists: the problems, the derived materials the line buys and every other warning (`bannerItems`). */
interface BannerItems { issues: PlanIssue[]; derived: StuffKey[]; others: PlanWarning[] }

/**
 * What the plan banner lists (fix spec §6.4): the integrity issues the client finds in the plan (`indexPlan`), in ISSUE_ORDER; the derived
 * materials the line buys, which stand for the server's derived-leaf warning as chips once the plan lists them; and every other server
 * warning, but a server integrity warning the client finds too (listed once, with the issues) and the derived-leaf warning its chips stand
 * for. The banner draws them, and the drawer's status counts them (R43): one reading for both.
 */
function bannerItems(plan: Plan | null): BannerItems {
  const warnings = plan?.warnings ?? [];
  const issues = plan === null ? [] : [...indexPlan(plan).issues].sort((a, b) => ISSUE_ORDER.indexOf(a.code) - ISSUE_ORDER.indexOf(b.code));
  const derivedWarning = warnings.find((w) => w.code === 'derived-leaf');
  const derived = derivedWarning === undefined ? [] : (plan?.rawInputs ?? []).filter((r) => r.leafClass === 'derived').map((r) => r.key);
  const shownIssues = new Set(issues.map(problemId));
  // Every other warning keeps its own text: a server integrity warning the client finds too is shown once (with the issues), and
  // the derived-leaf warning becomes chips when the plan lists its leaves.
  const others = warnings.filter((w) => !(ISSUE_CODES.has(w.code) && shownIssues.has(problemId(w))) && !(w === derivedWarning && derived.length > 0));
  return { issues, derived, others };
}

/**
 * What the settings drawer's own status line says (Phase 2 spec §17 R43): while the drawer is open the banners behind it are inert, so their
 * status is not announced. The planner's error; else that the plan is updating, while a new plan is on its way and the views still show the
 * old one, in other words than the banner's busy line, which drawer.spec.ts finds by its text while the drawer is open (plan ruling
 * drawer-status-words); else how many problems the banner lists, its problems and its other warnings, but the hint to pick something to make,
 * which the drawer, the item search in it focused, is there to answer (plan ruling drawer-status-count), and never their words, which other
 * specs find by text; else, for a plan that runs, that it has no problems, so an update is heard to end as it was heard to start (ledger
 * ruling P2-R52); else nothing (no plan yet, or one with nothing to make). What the plan uses beyond its line (a farm, another project's
 * surplus) is no problem.
 */
export function drawerStatus(plan: Plan | null, planError: string | null, planLoading: boolean): string {
  if (planError !== null) return planError;
  if (plan === null) return '';
  if (planLoading) return 'The plan is updating…';
  const { issues, others } = bannerItems(plan);
  const n = issues.length + others.filter((w) => w.code !== NO_TARGET).length;
  if (n > 0) return `The plan has ${n} ${n === 1 ? 'problem' : 'problems'}`;
  return plan.status === 'ok' ? 'No problems' : '';
}

/**
 * What the plan warns about (fix spec §6.4), above every project view: while a new plan is on its way, "Updating the plan…" after the GT
 * progress arrow (Phase 2 spec §11.3), on a chat box of its own that the stylesheet sets on the key-numbers strip's top-right corner, out of
 * the flow, so it moves nothing on the page (ledger rulings P2-R18 and P2-R51; with no strip it is out of sight, and a banner that says
 * nothing else draws no box); a summary of the integrity issues
 * (`indexPlan`: "This plan does not add up: …", with "Show in the flow") and each issue in the server's words, else
 * `issueText`'s (the client re-checks the plan it got); the derived materials the line buys as chips that show their
 * import in the flow, with "Plan them as supporting lines" while those are off; how much more raw material the plan
 * uses than the least to save machines (`Plan.rawCost`, Machines vs raw material); every other server warning (plan
 * 08's avoid list, missing recipes, add-on 17's `surplus-shared`, …); what the plan uses beyond its line — "This plan
 * uses a Tree Growth Simulator (Rubber Sapling)", "This plan draws Latex from Rubber line" (`sourceNotes`, ruling R18:
 * farms and other projects' surplus are on for every project, so their use is said) — and what unlocks the line. Above
 * that box, and on its own when there is nothing to warn about, what the plan costs to run and to build its new
 * machines (`costLine`, plan 12).
 *
 * The server's hint for a project with no target, "Pick something to make" (`no-target`), is a button when the page gives an
 * `onPickTarget` to answer it: the picker is in the settings, which a narrow window keeps in a drawer, so the hint is the way in.
 * Without one it stays text. This is a plain function, with no hook, which the tests call.
 *
 * Who tells the plan's cost is `cost`'s (fix round 1 of Phase 2 Task 7, M2 and M8): this sentence (the default); the key-numbers strip
 * above it, which a screen reader hears with every figure and qualifier the sentence gives, so the sentence stays on the page (the stylesheet
 * hides it from sight) but is hidden from a screen reader; or nothing, for a project with no target, which has no strip either, while the
 * plan of its old target is still on screen.
 */
export function PlanBanner(props: {
  plan: Plan | null; planError: string | null; planLoading: boolean; settings: PlanSettings; send: (ops: ProjectOp[]) => void;
  /** Takes the reader to the picker of what to make (the item search of the Make section). */
  onPickTarget?: () => void;
  /** Who tells the plan's cost: this sentence (the default), the key-numbers strip (the sentence hidden from a screen reader), or nothing. */
  cost?: 'sentence' | 'strip' | 'none';
}): ReactElement | null {
  const { plan, planError, planLoading, settings, send, onPickTarget, cost = 'sentence' } = props;
  const warnings = plan?.warnings ?? [];
  const unlocks = plan?.unlocks ?? [];
  const names = plan?.names ?? {};
  const nameOf = (key: StuffKey): string => names[key] ?? key;

  const { issues, derived, others } = bannerItems(plan);
  const served = new Map<string, PlanWarning>();
  for (const w of warnings) if (ISSUE_CODES.has(w.code)) served.set(problemId(w), w);
  const issueTexts = issues.map((issue) => served.get(problemId(issue))?.text ?? (plan === null ? '' : issueText(issue, plan)));
  const counted = ISSUE_ORDER.flatMap((code) => {
    const ofCode = issues.filter((i) => i.code === code);
    return ofCode.length === 0 ? [] : [issueCount(code, ofCode.length, ofCode)];
  });

  const rawText = rawCostText(plan?.rawCost, stepChargeLabel(stepChargeOf(settings)));
  // What the plan costs to run and to build (plan 12): on every plan that has a cost, outside the warning box, unless nothing tells it.
  const costText = plan === null || cost === 'none' ? null : costLine(plan);
  const costed = costText === null ? null : <p className="plan-cost" aria-hidden={cost === 'strip' ? true : undefined}>{costText}</p>;
  const notes = plan === null ? [] : sourceNotes(plan);

  const busy = planLoading && plan !== null;
  if (planError === null && !busy && issues.length === 0 && others.length === 0 && derived.length === 0 && rawText === null && notes.length === 0
    && unlocks.length === 0) return costed;
  const firstIssue = issues[0];
  const banner = (
    <div className="plan-banner" role="status">
      {planError !== null && <p className="error">{planError}</p>}
      {busy && <p className="muted"><GtArrow tone="chat" />Updating the plan…</p>}
      {firstIssue !== undefined && (
        <div className="banner-integrity">
          <p className="banner-heading error">
            <Figs text={`This plan does not add up: ${counted.join(', ')} `} />
            <button type="button" className="small" onClick={() => showInFlow({ kind: 'item', key: firstIssue.key })}>Show in the flow</button>
          </p>
          <ul className="warnings">
            {issues.map((issue, i) => <li key={problemId(issue)}>{issueTexts[i]}</li>)}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <ul className="warnings">
          {others.map((w, i) => (
            <li key={`${w.code}:${i}`}>
              {w.code === NO_TARGET && onPickTarget !== undefined ? <button type="button" className="link" onClick={onPickTarget}>{w.text}</button> : w.text}
            </li>
          ))}
        </ul>
      )}
      {derived.length > 0 && (
        <div className="banner-derived">
          <p>The line buys these instead of making them, as they are not mined anywhere you can reach:</p>
          <div className="banner-chips">
            {derived.map((key) => (
              <button key={key} type="button" className="banner-chip" data-key={key} title={`Show ${nameOf(key)} in the flow`} onClick={() => showInFlow({ kind: 'item', key })}>
                <ItemIcon itemKey={key} size={16} name={nameOf(key)} tip={false} />
                <span>{nameOf(key)}</span>
              </button>
            ))}
          </div>
          {!settings.routeDerived && (
            <div className="row">
              <button type="button" onClick={() => send([{ op: 'settings', patch: { routeDerived: true } }])}>Plan them as supporting lines</button>
            </div>
          )}
        </div>
      )}
      {rawText !== null && <p className="banner-cost">{rawText}</p>}
      {notes.length > 0 && (
        <ul className="banner-sources">
          {notes.map((note) => <li key={note}>{`This plan ${note}`}</li>)}
        </ul>
      )}
      {unlocks.length > 0 && (
        <>
          <p className="banner-heading">To unlock</p>
          <ul className="unlocks">
            {unlocks.map((u) => <li key={u.key}>{u.text}</li>)}
          </ul>
        </>
      )}
    </div>
  );
  return costed === null ? banner : <>{costed}{banner}</>;
}

/**
 * How much more raw material the plan uses than the least to save machines (`Plan.rawCost`, Machines vs raw material:
 * `preset`), or null when it uses the least: `Uses <x>% more …`; a line whose least raw material is 0 (a glass line
 * digging sand that rock-breaker cobblestone and forge hammers could make, plan 12) has no percentage: `Uses raw
 * material that free inputs could replace, to save machines (…)`.
 */
function rawCostText(cost: Plan['rawCost'], preset: string): string | null {
  if (cost === undefined) return null;
  if (cost.leastPerSecond === 0 && cost.perSecond > 0) return `Uses raw material that free inputs could replace, to save machines (Machines vs raw material: ${preset})`;
  if (!(cost.leastPerSecond > 0) || !(cost.perSecond > cost.leastPerSecond * (1 + COST_GAP_REL))) return null;
  return `Uses ${formatPercent(cost.perSecond / cost.leastPerSecond - 1)} more raw material than the least possible to save machines (Machines vs raw material: ${preset})`;
}

/** How many `plan` and `compare` events project `id`'s stream has brought since this page opened it. */
function useProjectEventCount(id: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => listenProjectEvents(id, () => setCount((n) => n + 1)), [id]);
  return count;
}

/** The pack's dimensions, capabilities and recipe groups for the settings panel, fetched once per page. */
function usePackInfo(): { info: PackInfo | null; error: string | null } {
  const [state, setState] = useState<{ info: PackInfo | null; error: string | null }>({ info: null, error: null });
  useEffect(() => {
    let live = true;
    apiGet<PackInfo>('/api/pack').then(
      (info) => {
        if (live) setState({ info, error: null });
      },
      (err: unknown) => {
        if (live) setState({ info: null, error: messageOf(err) });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function ProjectPage(props: { id: string }): ReactElement {
  const view = useProject(props.id);
  const pack = usePackInfo();
  const me = useName() ?? '';
  const [tab, setTab] = useState(() => tabFromHash(location.hash));
  useEffect(() => {
    const follow = (): void => setTab(tabFromHash(location.hash));
    addEventListener('hashchange', follow);
    follow();
    return () => removeEventListener('hashchange', follow);
  }, []);
  const { project, plan, send, deleted } = view;
  // The store sets `deleted` once, whether this tab deleted the project or was told, so the list says so once. The name
  // is the one this tab showed when the project went.
  useEffect(() => {
    if (deleted !== null) leaveDeletedProject(project?.name ?? null, deleted.by, props.id);
  }, [deleted]);
  // What the flow diagram lights belongs to this project: leaving it (for another project or another page) clears it.
  useEffect(() => () => setFlowFocus(null), [props.id]);
  // A rename's toast offers Undo through this page's store, which closes with the page: leaving takes the toast away, as its Undo is gone.
  useEffect(() => () => dismissToast(`rename:${props.id}`), [props.id]);
  // The settings column is a drawer below 900 px, and a layer of its own while it is open (ruling R36): opening it moves the focus to
  // its Close settings button, and the page behind it is inert (the head, the banners and the views here, and the App's top bar above
  // this page), so neither the keyboard nor a click reaches what the drawer covers. Every way out, Escape, a click on the dimmed page,
  // its Close button or the Settings button, goes through `closeSettings`, which gives the focus back to the Settings button. A window
  // that grows past 900 px closes it too, without moving the focus: the column is beside the views again and the button is not drawn.
  // The focus moves in a layout effect, after the commit: until then the page behind is still inert, and an inert button takes no focus.
  // It opens into its Close button when the Settings button opens it, and into the item search when the page opens it to pick what to make
  // (below). These hooks sit above the early return below; the listeners are removed when the drawer closes, and between StrictMode's two runs.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsToggle = useRef<HTMLButtonElement | null>(null);
  const settingsClose = useRef<HTMLButtonElement | null>(null);
  const settingsPanel = useRef<HTMLElement | null>(null);
  /** The drawer is being closed by a way out of it: the focus goes back to the Settings button. */
  const refocusToggle = useRef(false);
  /** Where the focus goes when the drawer opens: its Close button, or the item search of its Make section. */
  const focusOnOpen = useRef<'close' | 'search'>('close');
  const closeSettings = (): void => {
    refocusToggle.current = true;
    setSettingsOpen(false);
  };
  const openSettings = (focus: 'close' | 'search'): void => {
    focusOnOpen.current = focus;
    setSettingsOpen(true);
  };
  /** Moves the focus into the item search of the Make section and scrolls it into view; false when the panel has none drawn. */
  const focusSearch = (): boolean => {
    const search = settingsPanel.current?.querySelector<HTMLInputElement>(`input[role="combobox"][placeholder="${ITEM_SEARCH_PLACEHOLDER}"]`);
    if (search === null || search === undefined) return false;
    search.focus();
    search.scrollIntoView({ block: 'nearest' });
    return true;
  };
  useLayoutEffect(() => {
    if (settingsOpen) {
      const intoSearch = focusOnOpen.current === 'search';
      focusOnOpen.current = 'close';
      if (!intoSearch || !focusSearch()) settingsClose.current?.focus();
    } else if (refocusToggle.current) settingsToggle.current?.focus();
    refocusToggle.current = false;
  }, [settingsOpen]);
  // What to make is the first thing a project needs, and it is in the drawer on a narrow window: so a project with no target opens the
  // drawer by itself, into the item search, once per visit (this page is new for each visit to a project: the route keys it by the id).
  // It waits for the project, and for the name prompt, which covers the page until this browser has a name and must keep the focus it
  // asks for. It decides once, whatever happens to the project after: the reader closes the drawer, and nothing opens it again.
  const ready = project !== null && me !== '';
  const autoOpenDecided = useRef(false);
  useEffect(() => {
    if (!ready || autoOpenDecided.current) return;
    autoOpenDecided.current = true;
    if (project?.settings.target === null && matchMedia(NARROW).matches) openSettings('search');
  }, [ready]);
  /** The plan banner's "Pick something to make": the drawer opens into the item search on a narrow window; beside the views the search takes the focus. */
  const pickTarget = (): void => {
    if (!settingsOpen && matchMedia(NARROW).matches) openSettings('search');
    else focusSearch();
  };
  // The settings panel and the Settings button name the target in the same words, and what was just picked before the plan names it.
  const names = usePickedNames(plan);
  // While it is open, Escape closes it, one layer per press: a key that something inside has already handled (`defaultPrevented`) is not
  // the drawer's, and neither is the key that closes a search list open in it (the item search and the avoid box close on Escape without
  // preventing the default). React has drawn such a list closed by the time the key reaches the document, so `look` reads whether one is
  // open on the way down, before the list's own handler runs, and `closeOnEscape` decides on the way up.
  useEffect(() => {
    if (!settingsOpen) return;
    let listOpen = false;
    const look = (e: KeyboardEvent): void => {
      listOpen = e.target instanceof Element && e.target.closest('[role="combobox"][aria-expanded="true"]') !== null;
    };
    const closeOnEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || listOpen) return;
      closeSettings();
    };
    document.addEventListener('keydown', look, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', look, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [settingsOpen]);
  // What lies outside this page while the drawer is open: the top bar, which the App draws above it, and the App's toasts after it (Phase 2
  // spec §12.3: Tab would otherwise leave the drawer for a toast's Undo) go inert with the rest of the page behind the drawer, at every
  // opening, the one it makes by itself included. The toasts wait it out (ledger rulings P2-R56, P2-R56a): their time stops, one drawn
  // already stays drawn behind it ("Created", which a project with no target brings to the drawer it opens by itself), and one shown
  // meanwhile is drawn, so heard, only once the drawer closes. The drawer closes when the window grows past the width it is a drawer at (the
  // stylesheet's query). It looks once more as it starts to listen: the page's own opening (the auto-open, in an effect) is a task or two
  // older than this effect, and a window that grew in between fired its change before there was a listener. In a window still narrow that
  // look does nothing; in one that has grown it closes the drawer at once, the cleanup giving the top bar and the toasts back, and, as for
  // any widening, leaves the focus where it is (on the search, which sits beside the views then), not on a Settings button that is not drawn.
  useEffect(() => {
    if (!settingsOpen) return;
    const outside = ['.top-nav', '.toasts'].flatMap((selector) => document.querySelector<HTMLElement>(selector) ?? []);
    for (const layer of outside) layer.inert = true;
    setToastsInert(true);
    const narrow = matchMedia(NARROW);
    const onWidth = (): void => {
      if (!narrow.matches) setSettingsOpen(false);
    };
    narrow.addEventListener('change', onWidth);
    onWidth();
    return () => {
      narrow.removeEventListener('change', onWidth);
      for (const layer of outside) layer.inert = false;
      setToastsInert(false);
    };
  }, [settingsOpen]);
  // The Compare card (add-on 17), once the project makes something: its "Compare modes" button is in the head and the card it opens is
  // under the plan banner, so a closed card takes no room (the chrome's height budget). Below 900 px the head's one row is full (the
  // Settings button says what the line makes there), so the button is in a bar of its own under the banner instead: both are drawn here,
  // and the stylesheet shows the one for the window's width. The card hears every `plan` and `compare` event of the project (`rev`), so
  // an open card fetches the compare again. Its Close button gives the focus back to the button that is shown; a project that stops
  // making something, or is deleted, closes it and forgets its figures, so the card of the next target never opens on them.
  const compare = useCompare(props.id, useProjectEventCount(props.id));
  const compareHeadToggle = useRef<HTMLButtonElement | null>(null);
  const compareBarToggle = useRef<HTMLButtonElement | null>(null);
  const comparable = project !== null && deleted === null && project.settings.target !== null;
  useEffect(() => {
    if (!comparable) compare.close({ forget: true });
  }, [comparable, compare.close]);
  // What the card shows is of the target it was asked for: another target picked straight from the item search (no Clear) drops it
  // before the page is painted again, and the card says it is planning until the new target's compare comes (the same target with
  // another amount, mode or tier keeps it).
  const target = project?.settings.target ?? null;
  useLayoutEffect(() => {
    compare.target(target);
  }, [target, compare.target]);
  const toggleCompare = (): void => {
    if (compare.state.open) compare.close();
    else compare.open();
  };
  const closeCompare = (): void => {
    compare.close();
    // a button the stylesheet does not show has no box
    [compareHeadToggle.current, compareBarToggle.current].find((b) => b !== null && b.getClientRects().length > 0)?.focus();
  };

  if (project === null) {
    return (
      <main className="page">
        {view.error !== null ? <p className="banner error" role="alert">{view.error}</p> : <><p className="muted">Loading…</p><Skeleton shape="project" /></>}
      </main>
    );
  }
  const active = PROJECT_TABS.find((t) => t.id === tab) ?? PROJECT_TABS[0]!;
  const View = active.component;
  // A rename says so (Phase 2 spec §12.1), with Undo, which sends the name it had back; a newer rename's toast replaces this one. A name the
  // store refuses (empty, too long) is not sent, and says why in the banner, so it gets no toast.
  const before = project.name;
  const rename = (name: string): void => {
    send([{ op: 'rename', name }]);
    if (validateOp({ op: 'rename', name }) !== null) return;
    const undo = { label: 'Undo', run: () => send([{ op: 'rename', name: before }]) };
    showToast(`Renamed to “${name}”`, { key: `rename:${project.id}`, action: undo });
  };
  return (
    <main className="page project-page">
      <div className="project-head" inert={settingsOpen}>
        <SettingsToggle
          open={settingsOpen} onToggle={() => (settingsOpen ? closeSettings() : openSettings('close'))} ref={settingsToggle}
          targetName={project.settings.target === null ? null : names.nameOf(project.settings.target)}
        />
        <ProjectName name={project.name} onRename={rename} />
        {comparable && <CompareToggle open={compare.state.open} onToggle={toggleCompare} ref={compareHeadToggle} />}
        <span className={view.connected ? 'connection live' : 'connection'}>{view.connected ? 'live' : 'reconnecting…'}</span>
        <DeleteProject
          id={project.id} name={project.name} label="Delete project" beforeDelete={view.flushDeferred}
          onDeleted={() => {
            showDeletedToast(project.id, project.name);
            view.markDeleted(me);
          }}
        />
      </div>
      {/* The banners' own box, so the page behind an open drawer can be inert in three pieces (ruling R36); it adds no space.
          The key-numbers strip (Phase 2 spec §10) leads it, the plan's cost sentence beside it hidden from sight by a sibling rule and from a
          screen reader, which hears the strip; with no target there is neither.
          The Compare card (add-on 17) sits under the plan banner, in the same box, so it goes inert with them, and so does the bar that
          holds its button on a narrow window: both below the strip, the card the box's last child (plan ruling p2-d44-landed). */}
      <div className="project-banners" inert={settingsOpen}>
        <KeyNumbers plan={plan} settings={project.settings} />
        {view.error !== null && <p className="banner error" role="alert">{view.error}</p>}
        <PlanBanner
          plan={plan} planError={view.planError} planLoading={view.planLoading} settings={project.settings} send={send} onPickTarget={pickTarget}
          cost={project.settings.target === null ? 'none' : 'strip'}
        />
        {comparable && (
          <div className="compare-bar">
            <CompareToggle open={compare.state.open} onToggle={toggleCompare} ref={compareBarToggle} />
          </div>
        )}
        {comparable && (
          <CompareCard state={compare.state} settings={project.settings} send={send} nameOf={names.nameOf} onClose={closeCompare} />
        )}
      </div>
      <div className={settingsOpen ? 'project-body settings-open' : 'project-body'}>
        <aside className="settings-panel" id="project-settings" aria-label="Project settings" ref={settingsPanel}>
          {/* The drawer's way out, and where the focus goes when it opens; the stylesheet draws it in the drawer only. */}
          <button type="button" className="settings-close" onClick={closeSettings} ref={settingsClose}>Close settings</button>
          {/* The drawer's own status (R43): the banners behind it are inert while it is open, so their status is not announced. Always
              there, so a screen reader hears it change; empty while the drawer is closed. */}
          <p className="visually-hidden" role="status">{settingsOpen ? drawerStatus(plan, view.planError, view.planLoading) : ''}</p>
          {pack.error !== null && <p className="error small">{`Could not load the pack: ${pack.error}`}</p>}
          <SettingsPanel project={project} plan={plan} send={send} me={me} info={pack.info} names={names} />
          {deleted === null && <ProjectorPanel projectId={project.id} />}
        </aside>
        <div className="project-views" inert={settingsOpen}>
          <div className="tabs" role="tablist" aria-label="Project views">
            {PROJECT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={t.id === active.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => {
                  location.hash = `#${t.id}`;
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* The view remounts on a tab switch anyway; the key makes the section new too, so its fade-in plays again. */}
          <section key={active.id} className="tab-panel" role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
            <View project={project} plan={plan} previousPlan={view.previousPlan} send={send} sendLater={view.sendLater} me={me} />
          </section>
        </div>
      </div>
      {/* After the body, not in its grid: the dimmed page behind the drawer is not a cell. It only draws below 900 px. */}
      {settingsOpen && <div className="drawer-backdrop" onClick={closeSettings} />}
    </main>
  );
}
