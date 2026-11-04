// The project's line layout for a view (spec §3.7–§3.8, architecture §7.1, §8). It is fetched again whenever the plan
// changes or one of the layout's own inputs changes in this tab (placement, logistics mode, scan, base), once per burst
// of changes 100 ms apart, and checked again, with no loading line, after every other answer to the store's plan fetches
// (`ProjectViewState.planAnswers`): the store fetches the plan after every SSE `plan` event, which also means "the
// layout may have changed" (architecture §11.16: a placement batch hits the plan cache but still tells the tabs), and
// keeps the shown plan object when the answer is the same plan (RUK-529). Only the answer to the latest fetch is kept,
// and an answer equal to the shown layout keeps the shown object (RUK-529); a failed fetch keeps the last layout and
// says why.

import { useEffect, useRef, useState } from 'react';
import type { Layout } from '../../shared/types/layout.ts';
import type { Plan } from '../../shared/types/plan.ts';
import type { Project } from '../../shared/types/project.ts';
import { messageOf } from '../api/client.ts';
import { fetchLayout } from '../api/layout.ts';
import { sameJson } from './same-json.ts';

/** Changes closer together than this cause one layout fetch. */
const LAYOUT_COALESCE_MS = 100;

/** What the layout depends on besides the plan, as JSON in a fixed key order. */
export function layoutInputKey(project: Project): string {
  const { placement, settings, world } = project;
  return JSON.stringify({ placement, logistics: settings.logistics, scanId: world.scanId, baseId: world.baseId });
}

export interface LayoutState { layout: Layout | null; loading: boolean; error: string | null }

export interface LayoutLoader { request(id: string, plan: Plan | null, key: string, answers?: number): void; state(): LayoutState; close(): void }

/**
 * Fetches project `id`'s layout through `fetch` when `request` names another project, plan (by identity) or key than
 * the request before, and checks it again with no loading line when only the count of plan answers (`answers`) is
 * another; requests within LAYOUT_COALESCE_MS of the first of a burst cause one fetch. `onChange` gets every new
 * state. After `close` nothing is fetched or reported.
 */
export function createLayoutLoader(fetch: (id: string) => Promise<Layout>, onChange: (s: LayoutState) => void): LayoutLoader {
  let state: LayoutState = { layout: null, loading: false, error: null };
  let last: { id: string; plan: Plan | null; key: string; answers: number | undefined } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every fetch; only the answer to the newest one is kept. */
  let latest = 0;
  let closed = false;

  function update(patch: Partial<LayoutState>): void {
    if (closed) return;
    state = { ...state, ...patch };
    onChange(state);
  }

  function load(id: string): void {
    const fetchNo = ++latest;
    fetch(id).then(
      (layout) => {
        if (fetchNo !== latest) return;
        // RUK-529: the same layout again keeps the shown object, so the 3D view is not rebuilt
        const shown = state.layout;
        update({ layout: shown !== null && sameJson(shown, layout) ? shown : layout, loading: timer !== null, error: null });
      },
      (err: unknown) => {
        if (fetchNo === latest) update({ loading: timer !== null, error: messageOf(err) });
      },
    );
  }

  return {
    request(id, plan, key, answers) {
      if (closed) return;
      const before = last;
      // the same project, plan and inputs, answered again (§11.16): checked again quietly, with no loading line
      const quiet = before !== null && before.id === id && before.plan === plan && before.key === key;
      if (quiet && before.answers === answers) return;
      last = { id, plan, key, answers };
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (last !== null) load(last.id);
        }, LAYOUT_COALESCE_MS);
      }
      if (!quiet && !state.loading) update({ loading: true });
    },
    state: () => state,
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

const STARTING: LayoutState = { layout: null, loading: true, error: null };

/** The layout of project `projectId`, refetched as `plan` and the project's layout inputs change, and checked again after every plan answer (`planAnswers`). */
export function useLayout(projectId: string, plan: Plan | null, project: Project, planAnswers?: number): LayoutState {
  const key = layoutInputKey(project);
  const [state, setState] = useState<LayoutState>(STARTING);
  const loader = useRef<LayoutLoader | null>(null);
  useEffect(() => {
    // Created here, not during render, so StrictMode's second mount closes the first loader.
    const own = createLayoutLoader(fetchLayout, setState);
    loader.current = own;
    return () => {
      own.close();
      if (loader.current === own) loader.current = null;
    };
  }, []);
  useEffect(() => {
    loader.current?.request(projectId, plan, key, planAnswers);
  }, [projectId, plan, key, planAnswers]);
  return state;
}
