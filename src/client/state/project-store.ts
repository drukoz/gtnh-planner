// The live state of one open project (architecture §8, plan Review Focus 1). The store keeps `confirmed`, the project as
// the server last said it was, and the batches this tab sent that the server has not echoed yet. What the page shows is
// those pending ops applied on top of `confirmed` with the same `applyOp` the server runs; every op is idempotent, so
// re-applying one the server already confirmed changes nothing. Events from the server apply in rev order only: an
// older rev is ignored, a gap (or an op this client does not know) refetches the whole project, never guesses.
// A project someone deleted (its `deleted` event, this tab's own delete, or a 404 for it) is set as `deleted` once and
// the store goes quiet; the page then leaves for the project list (§11.24).
// A batch can also be deferred (`sendLater`, Phase 2 spec §12.2: a deleted note, until its toast's Undo has gone): it shows at once, laid
// over the batches sent, and is posted only when it is flushed, when the store closes, or when the page is hidden for good (`pagehide`),
// with keepalive then, so the post outlives the page. The flush lives here, not in a view: React cleans up a parent's effects first, so a
// view's cleanup would run after the store had closed. The batches are posted one at a time, in order, each once the one before has been
// answered (ledger ruling P2-R59): the server applies them in the order they reach it, so an Undo posted at once could land before what
// it undoes and be undone by it. Only a page that goes cannot wait for an answer: what still waits its turn is then sent at once.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { applyOp, validateOp } from '../../shared/project/apply-op.ts';
import type { OpEvent, OpsBody, OpsResult } from '../../shared/types/api.ts';
import type { Plan } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import { apiGet, apiPost, messageOf } from '../api/client.ts';
import { isProjectGone, openProjectEvents } from '../api/sse.ts';
import { getName } from './name.ts';

export interface ProjectViewState {
  project: Project | null; plan: Plan | null; planLoading: boolean; planError: string | null; connected: boolean; error: string | null;
  /** Set once when the project is gone: who deleted it, or null when this tab only found it missing. */
  deleted: { by: string | null } | null;
  /**
   * The plan that a plan of other settings (another `settingsHash`) replaced, for the "What changed" note (fix spec
   * §6.4); null until a settings change replans. A plan of the same settings (a refetch, a rescan) leaves it.
   */
  previousPlan: Plan | null;
}

export interface StoreDeps {
  fetchProject(id: string): Promise<Project>;
  /** Posts a batch; with `keepalive` the post outlives the page (one made as the page goes, which the browser would cancel with it). */
  postOps(id: string, ops: ProjectOp[], opts?: { keepalive?: boolean }): Promise<OpsResult>;
  fetchPlan(id: string): Promise<Plan>;
  openEvents: typeof openProjectEvents;
  /** Who this tab acts as, for ticks and notes shown before the server echoes them. */
  me(): string;
  now(): string;
  /** Calls `fn` when the page is hidden for good (a reload, a closed tab, another site) or put in the back-forward cache; returns how to stop. */
  onPageHide?(fn: () => void): () => void;
}

/** A batch shown at once and posted later (`ProjectStore.sendLater`). */
export interface DeferredSend {
  /** Takes it back: the project shows as if it had never been sent, and nothing is posted. */
  cancel(): void;
  /** Posts it now, if it is still deferred. */
  flush(): void;
}

export interface ProjectStore {
  subscribe(fn: () => void): () => void;
  getSnapshot(): ProjectViewState;
  send(ops: ProjectOp[]): void;
  /**
   * Shows `ops` at once and posts them only when flushed (Phase 2 spec §12.2): by `flush()`, when the store closes or when the page is hidden for
   * good, with keepalive then. `cancel()` takes them back unposted. `onFlush` is told once they have been flushed, however that came.
   */
  sendLater(ops: ProjectOp[], opts?: { onFlush?(): void }): DeferredSend;
  /** This tab deleted the project as `by` (the server's `deleted` event may come first or not at all). */
  markDeleted(by: string): void;
  /** Stops listening; what is deferred is posted first, and what still waits its turn is posted in it after (P2-R59). */
  close(): void;
}

/** Plan events closer together than this cause one plan fetch. */
const PLAN_COALESCE_MS = 100;

/** A batch this tab sent: its ops, who and when (so it re-applies identically), and the rev the server answered. */
interface Batch { ops: ProjectOp[]; by: string; at: string; ackRev: number | null }
/** A batch shown but not posted yet (`sendLater`), and whom to tell once it is. */
interface Deferred { batch: Batch; opts: { onFlush?(): void } }

/** What `sendLater` answers when it defers nothing (a malformed batch, a closed store, or no store yet). */
const NOTHING_DEFERRED: DeferredSend = { cancel: () => {}, flush: () => {} };

export function createProjectStore(id: string, deps: StoreDeps): ProjectStore {
  let confirmed: Project | null = null;
  /** The batches posted, or waiting their turn to be, that the server has not confirmed yet. */
  let pending: Batch[] = [];
  /** The batches shown but not posted yet, laid over `pending`. */
  let deferred: Deferred[] = [];
  /** The batches waiting their turn to be posted (P2-R59), each with whether it is to outlive the page. */
  let outbox: Array<{ batch: Batch; keepalive: boolean }> = [];
  /** How many posts are on their way: one at most, but for the page going, which sends all that waits at once. */
  let posting = 0;
  let state: ProjectViewState = {
    project: null, plan: null, planLoading: false, planError: null, connected: false, error: null, deleted: null, previousPlan: null,
  };
  const listeners = new Set<() => void>();
  let closed = false;
  let fetching = false;
  let fetchAgain = false;
  let planTimer: ReturnType<typeof setTimeout> | null = null;
  let planRequest = 0;
  /** The stream was down, so plan events may have been missed; the snapshot after the reconnect refetches the plan. */
  let missedPlanEvents = false;
  /**
   * Where the shown `error` came from: a failed project fetch is cleared by the next project the server confirms (a
   * later fetch or snapshot, Review Focus #1: a tab waking from sleep converges and must not keep a stale banner); a
   * rejected batch stays until this tab sends again.
   */
  let errorFrom: 'fetch' | 'send' | null = null;

  function showError(from: 'fetch' | 'send', message: string): void {
    errorFrom = from;
    update({ error: message });
  }

  function update(patch: Partial<ProjectViewState>): void {
    if (closed || state.deleted !== null) return;
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn();
  }

  /** The project is gone for good: stop listening and asking, and say so once. */
  function markDeleted(by: string | null): void {
    if (closed || state.deleted !== null) return;
    stopEvents();
    if (planTimer !== null) clearTimeout(planTimer);
    update({ deleted: { by } });
  }

  function visible(): Project | null {
    let project = confirmed;
    if (project === null) return null;
    for (const batch of [...pending, ...deferred.map((d) => d.batch)]) for (const op of batch.ops) project = applyOp(project, op, batch.by, batch.at);
    return project;
  }

  /** `project` is what the server has; a batch the server answered with its rev or an earlier one is already in it. */
  function confirm(project: Project): void {
    confirmed = project;
    pending = pending.filter((b) => b.ackRev === null || b.ackRev > project.rev);
    if (errorFrom === 'fetch') {
      errorFrom = null;
      update({ project: visible(), error: null });
    } else {
      update({ project: visible() });
    }
  }

  /** Loads the project; an answer older than what the events already brought is dropped (a stale tab never goes back). */
  function fetchProject(): void {
    if (fetching) {
      fetchAgain = true;   // the answer in flight may predate the event that asked for this
      return;
    }
    fetching = true;
    deps.fetchProject(id)
      .then(
        (project) => {
          if (confirmed === null || project.rev >= confirmed.rev) confirm(project);
        },
        (err: unknown) => {
          if (isProjectGone(err)) markDeleted(null);
          else showError('fetch', messageOf(err));
        },
      )
      .finally(() => {
        fetching = false;
        if (fetchAgain && !closed) {
          fetchAgain = false;
          fetchProject();
        }
      });
  }

  function onOp(e: OpEvent): void {
    if (confirmed === null) {
      fetchProject();
      return;
    }
    if (e.rev <= confirmed.rev) return;
    if (e.rev !== confirmed.rev + 1) {
      fetchProject();   // missed an op
      return;
    }
    let next: Project;
    try {
      next = applyOp(confirmed, e.op, e.by, e.at);
    } catch {
      fetchProject();   // an op this client does not know (the server is newer): take the server's project
      return;
    }
    confirm(next);
  }

  /** Fetches the plan; only the answer to the latest request is kept, and the plan it replaces when its settings differ. */
  function loadPlan(): void {
    const request = ++planRequest;
    update({ planLoading: true });
    deps.fetchPlan(id).then(
      (plan) => {
        if (request !== planRequest) return;
        const shown = state.plan;
        const previousPlan = shown !== null && shown.settingsHash !== plan.settingsHash ? shown : state.previousPlan;
        update({ plan, previousPlan, planLoading: false, planError: null });
      },
      (err: unknown) => {
        if (request === planRequest) update({ planLoading: false, planError: messageOf(err) });
      },
    );
  }

  function onPlanEvent(): void {
    if (planTimer !== null) return;
    planTimer = setTimeout(() => {
      planTimer = null;
      loadPlan();
    }, PLAN_COALESCE_MS);
  }

  /** The server takes a batch whole or not at all, so a batch with one malformed op is not sent: false, and the banner says why. */
  function wellFormed(ops: ProjectOp[]): boolean {
    for (const [i, op] of ops.entries()) {
      const problem = validateOp(op);
      if (problem !== null) {
        showError('send', `op ${i}: ${problem}`);
        return false;
      }
    }
    return true;
  }

  /** A batch of `ops` this tab makes now. */
  const batchOf = (ops: ProjectOp[]): Batch => ({ ops, by: deps.me(), at: deps.now(), ackRev: null });

  /** Posts `batch` in its turn (P2-R59): at once when nothing is on its way, else once everything before it has been answered. */
  function post(batch: Batch, keepalive: boolean): void {
    outbox = [...outbox, { batch, keepalive }];
    pump();
  }

  /** Posts the next batch that waits, once nothing is on its way; with nothing left to post, a closed store stops hearing pagehide. */
  function pump(): void {
    if (posting > 0) return;
    const next = outbox[0];
    if (next === undefined) {
      if (closed) stopHearingPageHide();
      return;
    }
    outbox = outbox.slice(1);
    start(next.batch, next.keepalive);
  }

  /** Posts `batch` now; its answer confirms it or drops it, and lets the next batch go. */
  function start(batch: Batch, keepalive: boolean): void {
    posting += 1;
    (keepalive ? deps.postOps(id, batch.ops, { keepalive: true }) : deps.postOps(id, batch.ops))
      .then(
        (result) => {
          batch.ackRev = result.rev;
          if (confirmed !== null) confirm(confirmed);
        },
        (err: unknown) => {
          pending = pending.filter((b) => b !== batch);
          errorFrom = 'send';
          update({ project: visible(), error: messageOf(err) });
        },
      )
      .finally(() => {
        posting -= 1;
        pump();
      });
  }

  function send(ops: ProjectOp[]): void {
    if (closed || ops.length === 0 || !wellFormed(ops)) return;
    const batch = batchOf(ops);
    pending = [...pending, batch];
    errorFrom = null;
    update({ project: visible(), error: null });
    post(batch, false);
  }

  function sendLater(ops: ProjectOp[], opts: { onFlush?(): void } = {}): DeferredSend {
    if (closed || ops.length === 0 || !wellFormed(ops)) return NOTHING_DEFERRED;
    const entry: Deferred = { batch: batchOf(ops), opts };
    deferred = [...deferred, entry];
    errorFrom = null;
    update({ project: visible(), error: null });
    return { cancel: () => cancel(entry), flush: () => flush(entry, false) };
  }

  /** Posts a deferred batch in its turn, `keepalive` as the page goes, and then says so; one posted already or taken back is left. */
  function flush(entry: Deferred, keepalive: boolean): void {
    if (!deferred.includes(entry)) return;
    deferred = deferred.filter((d) => d !== entry);
    pending = [...pending, entry.batch];
    update({ project: visible() });
    post(entry.batch, keepalive);
    entry.opts.onFlush?.();
  }

  function cancel(entry: Deferred): void {
    if (!deferred.includes(entry)) return;
    deferred = deferred.filter((d) => d !== entry);
    update({ project: visible() });
  }

  /** Every deferred batch, oldest first, as the page or the store goes. */
  function flushAll(): void {
    for (const entry of [...deferred]) flush(entry, true);
  }

  /**
   * The page is hidden for good (or for the back-forward cache), so nothing can wait for an answer: what is deferred is flushed, and every
   * batch still waiting its turn is posted at once, in order, with keepalive. Only these last posts may overtake one another.
   */
  function pageHidden(): void {
    flushAll();
    const waiting = outbox;
    outbox = [];
    for (const { batch } of waiting) start(batch, true);
  }
  let stopPageHide = deps.onPageHide?.(pageHidden);
  function stopHearingPageHide(): void {
    stopPageHide?.();
    stopPageHide = undefined;
  }

  const stopEvents = deps.openEvents(id, {
    snapshot: (project) => {
      confirm(project);
      if (missedPlanEvents) {
        missedPlanEvents = false;
        onPlanEvent();
      }
    },
    op: onOp,
    plan: onPlanEvent,
    connected: (ok) => {
      if (!ok) missedPlanEvents = true;
      update({ connected: ok });
    },
    deleted: (e) => markDeleted(e?.by ?? null),
  });
  fetchProject();
  loadPlan();

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    send,
    sendLater,
    markDeleted,
    close() {
      if (closed) return;
      flushAll();   // before `closed` (spec §12.2): the page is going, so with keepalive
      closed = true;
      stopEvents();
      if (planTimer !== null) clearTimeout(planTimer);
      listeners.clear();
      // pagehide is heard until the last batch waiting its turn has been posted (`pump`): a tab closed meanwhile sends it at once
      if (posting === 0 && outbox.length === 0) stopHearingPageHide();
    },
  };
}

function projectPath(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}`;
}

function liveDeps(): StoreDeps {
  return {
    fetchProject: (id) => apiGet<Project>(projectPath(id)),
    postOps: (id, ops, opts) => apiPost<OpsResult>(`${projectPath(id)}/ops`, { ops } satisfies OpsBody, opts),
    fetchPlan: (id) => apiGet<Plan>(`${projectPath(id)}/plan`),
    openEvents: openProjectEvents,
    me: () => getName() ?? '',
    now: () => new Date().toISOString(),
    onPageHide: (fn) => {
      addEventListener('pagehide', fn);
      return () => removeEventListener('pagehide', fn);
    },
  };
}

const LOADING: ProjectViewState = {
  project: null, plan: null, planLoading: true, planError: null, connected: false, error: null, deleted: null, previousPlan: null,
};
const noStore = (): (() => void) => () => {};
const loading = (): ProjectViewState => LOADING;
const ignore = (): void => {};
const deferNothing = (): DeferredSend => NOTHING_DEFERRED;

/** The live project `id` for a component: one store (and one event stream) while the component shows that project. */
export function useProject(id: string): ProjectViewState & Pick<ProjectStore, 'send' | 'sendLater' | 'markDeleted'> {
  const [open, setOpen] = useState<{ id: string; store: ProjectStore } | null>(null);
  useEffect(() => {
    // Created here, not during render, so StrictMode's second mount closes the first store and its event stream.
    const store = createProjectStore(id, liveDeps());
    setOpen({ id, store });
    return () => store.close();
  }, [id]);
  const store = open !== null && open.id === id ? open.store : null;
  const state = useSyncExternalStore(store?.subscribe ?? noStore, store?.getSnapshot ?? loading);
  return useMemo(
    () => ({ ...state, send: store?.send ?? ignore, sendLater: store?.sendLater ?? deferNothing, markDeleted: store?.markDeleted ?? ignore }),
    [state, store],
  );
}
