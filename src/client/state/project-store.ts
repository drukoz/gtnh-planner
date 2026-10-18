// The live state of one open project (architecture §8, plan Review Focus 1). The store keeps `confirmed`, the project as
// the server last said it was, and the batches this tab sent that the server has not echoed yet. What the page shows is
// those pending ops applied on top of `confirmed` with the same `applyOp` the server runs; every op is idempotent, so
// re-applying one the server already confirmed changes nothing. Events from the server apply in rev order only: an
// older rev is ignored, a gap (or an op this client does not know) refetches the whole project, never guesses.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { applyOp, validateOp } from '../../shared/project/apply-op.ts';
import type { OpEvent, OpsBody, OpsResult } from '../../shared/types/api.ts';
import type { Plan } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import { apiGet, apiPost, messageOf } from '../api/client.ts';
import { openProjectEvents } from '../api/sse.ts';
import { getName } from './name.ts';

export interface ProjectViewState { project: Project | null; plan: Plan | null; planLoading: boolean; planError: string | null; connected: boolean; error: string | null }

export interface StoreDeps {
  fetchProject(id: string): Promise<Project>;
  postOps(id: string, ops: ProjectOp[]): Promise<OpsResult>;
  fetchPlan(id: string): Promise<Plan>;
  openEvents: typeof openProjectEvents;
  /** Who this tab acts as, for ticks and notes shown before the server echoes them. */
  me(): string;
  now(): string;
}

export interface ProjectStore {
  subscribe(fn: () => void): () => void;
  getSnapshot(): ProjectViewState;
  send(ops: ProjectOp[]): void;
  close(): void;
}

/** Plan events closer together than this cause one plan fetch. */
const PLAN_COALESCE_MS = 100;

/** A batch this tab sent: its ops, who and when (so it re-applies identically), and the rev the server answered. */
interface Batch { ops: ProjectOp[]; by: string; at: string; ackRev: number | null }

export function createProjectStore(id: string, deps: StoreDeps): ProjectStore {
  let confirmed: Project | null = null;
  let pending: Batch[] = [];
  let state: ProjectViewState = { project: null, plan: null, planLoading: false, planError: null, connected: false, error: null };
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
    if (closed) return;
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn();
  }

  function visible(): Project | null {
    let project = confirmed;
    if (project === null) return null;
    for (const batch of pending) for (const op of batch.ops) project = applyOp(project, op, batch.by, batch.at);
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
        (err: unknown) => showError('fetch', messageOf(err)),
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

  /** Fetches the plan; only the answer to the latest request is kept. */
  function loadPlan(): void {
    const request = ++planRequest;
    update({ planLoading: true });
    deps.fetchPlan(id).then(
      (plan) => {
        if (request === planRequest) update({ plan, planLoading: false, planError: null });
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

  function send(ops: ProjectOp[]): void {
    if (closed || ops.length === 0) return;
    // The server takes a batch whole or not at all, so a batch with one malformed op is not sent.
    for (const [i, op] of ops.entries()) {
      const problem = validateOp(op);
      if (problem !== null) {
        showError('send', `op ${i}: ${problem}`);
        return;
      }
    }
    const batch: Batch = { ops, by: deps.me(), at: deps.now(), ackRev: null };
    pending = [...pending, batch];
    errorFrom = null;
    update({ project: visible(), error: null });
    deps.postOps(id, ops).then(
      (result) => {
        batch.ackRev = result.rev;
        if (confirmed !== null) confirm(confirmed);
      },
      (err: unknown) => {
        pending = pending.filter((b) => b !== batch);
        errorFrom = 'send';
        update({ project: visible(), error: messageOf(err) });
      },
    );
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
    close() {
      if (closed) return;
      closed = true;
      stopEvents();
      if (planTimer !== null) clearTimeout(planTimer);
      listeners.clear();
    },
  };
}

function projectPath(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}`;
}

function liveDeps(): StoreDeps {
  return {
    fetchProject: (id) => apiGet<Project>(projectPath(id)),
    postOps: (id, ops) => apiPost<OpsResult>(`${projectPath(id)}/ops`, { ops } satisfies OpsBody),
    fetchPlan: (id) => apiGet<Plan>(`${projectPath(id)}/plan`),
    openEvents: openProjectEvents,
    me: () => getName() ?? '',
    now: () => new Date().toISOString(),
  };
}

const LOADING: ProjectViewState = { project: null, plan: null, planLoading: true, planError: null, connected: false, error: null };
const noStore = (): (() => void) => () => {};
const loading = (): ProjectViewState => LOADING;
const ignore = (): void => {};

/** The live project `id` for a component: one store (and one event stream) while the component shows that project. */
export function useProject(id: string): ProjectViewState & { send(ops: ProjectOp[]): void } {
  const [open, setOpen] = useState<{ id: string; store: ProjectStore } | null>(null);
  useEffect(() => {
    // Created here, not during render, so StrictMode's second mount closes the first store and its event stream.
    const store = createProjectStore(id, liveDeps());
    setOpen({ id, store });
    return () => store.close();
  }, [id]);
  const store = open !== null && open.id === id ? open.store : null;
  const state = useSyncExternalStore(store?.subscribe ?? noStore, store?.getSnapshot ?? loading);
  return useMemo(() => ({ ...state, send: store?.send ?? ignore }), [state, store]);
}
