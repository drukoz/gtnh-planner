// The live event stream of one open project (architecture §8): exactly one EventSource per open project, because a
// browser allows only six connections per origin across all its tabs (web-stack §4.4). The stream starts with a
// `snapshot` of the project after every (re)connect, then carries each applied `op` and a `plan` event whenever the plan
// may have changed. The browser reconnects by itself after a network failure (the server sends `retry: 2000`).

import type { OpEvent, PlanEvent } from '../../shared/types/api.ts';
import type { Project } from '../../shared/types/project.ts';
import { apiGet } from './client.ts';

export interface ProjectEventHandlers {
  snapshot(p: Project): void;
  op(e: OpEvent): void;
  plan(e: PlanEvent): void;
  /** true once the stream is open, false while it is down and being retried. */
  connected(ok: boolean): void;
}

/** How long to wait before trying again after the browser gave up on the stream. */
const REOPEN_MS = 5000;

function dataOf<T>(e: Event): T {
  return JSON.parse((e as MessageEvent<string>).data) as T;
}

/** Opens the project's event stream; the returned function closes it for good. */
export function openProjectEvents(id: string, on: ProjectEventHandlers): () => void {
  const path = `/api/projects/${encodeURIComponent(id)}`;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const open = (): void => {
    const es = new EventSource(`${path}/events`);
    es.addEventListener('open', () => on.connected(true));
    es.addEventListener('snapshot', (e) => on.snapshot(dataOf<Project>(e)));
    es.addEventListener('op', (e) => on.op(dataOf<OpEvent>(e)));
    es.addEventListener('plan', (e) => on.plan(dataOf<PlanEvent>(e)));
    es.addEventListener('error', () => {
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
        () => {
          timer = null;
          reopenLater();
        },
      );
    }, REOPEN_MS);
  };

  open();
  return () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    source?.close();
  };
}
