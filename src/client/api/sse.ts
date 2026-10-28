// The live event stream of one open project (architecture §8): exactly one EventSource per open project, because a
// browser allows only six connections per origin across all its tabs (web-stack §4.4). The stream starts with a
// `snapshot` of the project after every (re)connect, then carries each applied `op`, a `plan` event whenever the plan
// may have changed and a `compare` event when the modes a compare was still planning are done (add-on 17, §11.45 (5)).
// The parts of the page beside the project store (the Compare card) hear the `plan` and `compare` events of that one
// stream through `listenProjectEvents`. The browser reconnects by itself after a network failure (the server sends
// `retry: 2000`). A `deleted` event (§11.24) ends it for good, as does finding the project gone when it tries to reopen.

import type { CompareEvent, DeletedEvent, OpEvent, PlanEvent } from '../../shared/types/api.ts';
import type { Project } from '../../shared/types/project.ts';
import { ApiError, apiGet } from './client.ts';

export interface ProjectEventHandlers {
  snapshot(p: Project): void;
  op(e: OpEvent): void;
  plan(e: PlanEvent): void;
  /** true once the stream is open, false while it is down and being retried. */
  connected(ok: boolean): void;
  /** The project was deleted (its `deleted` event), or null: it was gone when the stream tried to reopen. Nothing follows. */
  deleted(e: DeletedEvent | null): void;
}

/** The answer for a project that is not there (deleted, purged, or never was). */
export function isProjectGone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.code === 'not-found';
}

/** How long to wait before trying again after the browser gave up on the stream. */
const REOPEN_MS = 5000;

function dataOf<T>(e: Event): T {
  return JSON.parse((e as MessageEvent<string>).data) as T;
}

/** A `plan` or `compare` event of a project's stream, with the project revision it came with. */
export interface ProjectSignal { kind: 'plan' | 'compare'; rev: number }

/** Who hears each project's `plan` and `compare` events beside its store, by project id. */
const signalListeners = new Map<string, Set<(s: ProjectSignal) => void>>();

/**
 * Calls `fn` with each `plan` and `compare` event of project `id`'s stream, the one its store keeps open (no second
 * EventSource); the returned function stops it.
 */
export function listenProjectEvents(id: string, fn: (s: ProjectSignal) => void): () => void {
  let listeners = signalListeners.get(id);
  if (listeners === undefined) signalListeners.set(id, (listeners = new Set()));
  const own = listeners;
  own.add(fn);
  return () => {
    own.delete(fn);
    if (own.size === 0 && signalListeners.get(id) === own) signalListeners.delete(id);
  };
}

function signal(id: string, s: ProjectSignal): void {
  for (const fn of [...(signalListeners.get(id) ?? [])]) fn(s);
}

/** Opens the project's event stream; the returned function closes it for good. */
export function openProjectEvents(id: string, on: ProjectEventHandlers): () => void {
  const path = `/api/projects/${encodeURIComponent(id)}`;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stop = (): void => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    source?.close();
  };

  const open = (): void => {
    const es = new EventSource(`${path}/events`);
    es.addEventListener('open', () => on.connected(true));
    es.addEventListener('snapshot', (e) => on.snapshot(dataOf<Project>(e)));
    es.addEventListener('op', (e) => on.op(dataOf<OpEvent>(e)));
    es.addEventListener('plan', (e) => {
      const event = dataOf<PlanEvent>(e);
      on.plan(event);
      signal(id, { kind: 'plan', rev: event.rev });
    });
    es.addEventListener('compare', (e) => signal(id, { kind: 'compare', rev: dataOf<CompareEvent>(e).rev }));
    es.addEventListener('deleted', (e) => {
      stop();   // before the server ends the stream, so the browser never reconnects into a 404
      on.deleted(dataOf<DeletedEvent>(e));
    });
    es.addEventListener('error', () => {
      if (closed) return;
      on.connected(false);
      if (es.readyState === EventSource.CLOSED) reopenLater();
    });
    source = es;
  };

  // The browser stops retrying when the server answers with an HTTP error (a lost session, a proxy's 502). Ask with a
  // plain request first, which sends a lost session to the login page, and reopen once the project answers again.
  const reopenLater = (): void => {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      apiGet<Project>(path).then(
        () => {
          timer = null;
          if (!closed) open();
        },
        (err: unknown) => {
          timer = null;
          if (closed) return;
          if (isProjectGone(err)) {
            stop();   // deleted while this tab missed the event (asleep, offline): stop asking
            on.deleted(null);
          } else {
            reopenLater();
          }
        },
      );
    }, REOPEN_MS);
  };

  open();
  return stop;
}
