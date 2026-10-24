// The Compare card (add-on 17 Task 9; design spec §3.3, architecture §11.45 (5)): the three planning modes of a project
// side by side, fetched only while the card is open and again on the project's `plan` and `compare` events, each with
// "Use this mode".

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createRef, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareColumns, compareKeys } from '../../src/client/views/compare-model.ts';
import { CompareCardView, CompareToggle, compareLoader, type CompareState } from '../../src/client/views/CompareCard.tsx';
import { objectivePatch } from '../../src/client/views/settings-model.ts';
import { listenProjectEvents, openProjectEvents, type ProjectEventHandlers } from '../../src/client/api/sse.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { CompareMode, CompareResult } from '../../src/shared/types/api.ts';
import type { PlanSettings } from '../../src/shared/types/plan.ts';

/** What a reader sees: the markup without its tags and comments, entities decoded, runs of white space as one space. */
function text(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Every element in `node` (a tree of unrendered elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

const summary = { rawPerHour: 12.5, rawBuild: 40, newMachines: 4, rawSources: 3, steps: 6, peakEUt: 96 };
const RESULT: CompareResult = {
  rev: 3, current: 'cheapest',
  modes: [
    { objective: 'least-raw', status: 'ok', summary: { ...summary, rawPerHour: 10, rawBuild: 900 }, avoids: ['t:a@0', 't:b@0'], adds: [] },
    { objective: 'cheapest', status: 'ok', summary, avoids: [], adds: ['t:a@0'] },
    { objective: 'multi-output', status: 'pending' },
  ],
};
const NAMES: Record<string, string> = { 't:a@0': 'A', 't:b@0': 'B', 't:y@0': 'Y' };
const nameOf = (key: string): string => NAMES[key] ?? key;
const open = (result: CompareResult | null, p: Partial<CompareState> = {}): CompareState => ({ open: true, result, error: null, loading: false, ...p });
const CLOSED: CompareState = { open: false, result: null, error: null, loading: false };
type ViewProps = Parameters<typeof CompareCardView>[0];
/** The card's props around `state`: the project's default settings, no-op handlers unless given. */
const props = (state: CompareState, p: Partial<ViewProps> = {}): ViewProps =>
  ({ state, settings: defaultSettings(), send: () => {}, nameOf, onClose: () => {}, ...p });
const markup = (state: CompareState, p: Partial<ViewProps> = {}): string => renderToStaticMarkup(<CompareCardView {...props(state, p)} />);

/** A `fetch` that answers every request with `body` as JSON. */
function answering(body: unknown) {
  return vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

/** Waits until the promises the loader started have settled. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => { vi.unstubAllGlobals(); });

describe('compare columns', () => {
  it('sums up each mode in six rows, with what it avoids, adds and makes for other projects', () => {
    const columns = compareColumns({ ...RESULT, modes: [{ objective: 'multi-output', status: 'ok', summary, avoids: ['t:a@0', 't:b@0'], adds: [], credited: ['t:y@0'] }] }, nameOf);
    expect(columns).toEqual([{
      objective: 'multi-output', label: 'Best multi-output', current: false, status: 'ok', note: null,
      rows: [
        { label: 'Raw per hour', value: '12.5' }, { label: 'Raw to build', value: '40' }, { label: 'New machines', value: '4' },
        { label: 'Different raw materials', value: '3' }, { label: 'Steps', value: '6' }, { label: 'Peak EU/t', value: '96' },
      ],
      avoids: 'A, B', adds: '', credited: 'Y',
    }]);
    expect(compareColumns({ ...RESULT, modes: [{ objective: 'cheapest', status: 'ok', summary: { ...summary, rawPerHour: 54_000.4 } }] }, nameOf)[0]?.rows[0])
      .toEqual({ label: 'Raw per hour', value: '54,000' });   // formatNumber's texts
  });

  it('says which mode is in use, which one is still planning and why one failed', () => {
    const failed: CompareMode = { objective: 'multi-output', status: 'failed', error: 'No recipe makes Glue' };
    const columns = compareColumns(RESULT, nameOf);
    expect(columns.map((c) => [c.label, c.current, c.status, c.note, c.rows.length])).toEqual([
      ['Least raw material', false, 'ok', null, 6], ['Cheapest', true, 'ok', null, 6], ['Best multi-output', false, 'pending', 'Still planning…', 0]]);
    expect(compareColumns({ ...RESULT, modes: [RESULT.modes[0]!, RESULT.modes[1]!, failed] }, nameOf)[2]).toMatchObject({ status: 'failed', note: 'No recipe makes Glue', rows: [] });
    // In the modes' order, whatever order the answer lists them in.
    expect(compareColumns({ ...RESULT, modes: [...RESULT.modes].reverse() }, nameOf).map((c) => c.objective)).toEqual(['least-raw', 'cheapest', 'multi-output']);
  });

  it('lists every good the modes name, once', () => {
    expect(compareKeys({ ...RESULT, modes: [...RESULT.modes, { objective: 'multi-output', status: 'ok', credited: ['t:y@0', 't:a@0'] }] }))
      .toEqual(['t:a@0', 't:b@0', 't:y@0']);
  });
});

describe('compare card', () => {
  it('asks nothing while closed, and the compare once it opens', async () => {
    const fetch = answering(RESULT);
    vi.stubGlobal('fetch', fetch);
    const loader = compareLoader('p1');
    loader.refresh();                                                            // a plan event while closed
    expect(fetch).not.toHaveBeenCalled();
    expect(loader.getSnapshot()).toEqual({ open: false, result: null, error: null, loading: false });
    loader.open();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/p1/compare');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'GET' });
    expect(loader.getSnapshot()).toMatchObject({ open: true, loading: true });
    await settle();
    expect(loader.getSnapshot()).toEqual({ open: true, result: RESULT, error: null, loading: false });
    loader.close();
    loader.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(compareLoader('p 1')).toBeDefined();
  });

  it('fetches again on each plan or compare event of the project while open, one request at a time', async () => {
    const fetch = answering(RESULT);
    vi.stubGlobal('fetch', fetch);
    const loader = compareLoader('p1');
    loader.open();
    loader.refresh();
    loader.refresh();                                                            // a burst while the first answer is on its way
    expect(fetch).toHaveBeenCalledTimes(1);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);                                      // the burst is asked once, after it
    await settle();
    loader.refresh();
    expect(fetch).toHaveBeenCalledTimes(3);
    await settle();
    expect(loader.getSnapshot().loading).toBe(false);
  });

  it('keeps the last answer and says why a compare failed', async () => {
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => (fail
      ? new Response(JSON.stringify({ error: 'plan-failed', message: 'The planner failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(RESULT), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    const loader = compareLoader('p1');
    loader.open();
    await settle();
    fail = true;
    loader.refresh();
    await settle();
    expect(loader.getSnapshot()).toEqual({ open: true, result: RESULT, error: 'The planner failed', loading: false });
    expect(text(markup(loader.getSnapshot()))).toContain('Could not compare the modes: The planner failed');
  });

  it('forgets its answer when it closes because the project makes nothing, so a new target never shows the old figures', async () => {
    vi.stubGlobal('fetch', answering(RESULT));
    const loader = compareLoader('p1');
    loader.open();
    await settle();
    expect(loader.getSnapshot().result).toEqual(RESULT);
    // the target is cleared (or the project deleted): the card closes and drops what it showed, and an answer on its way too
    loader.close({ forget: true });
    expect(loader.getSnapshot()).toEqual({ open: false, result: null, error: null, loading: false });
    // a new target, the card opened again: while its compare is on its way it shows no column, only that it is planning
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    loader.open();
    expect(loader.getSnapshot()).toEqual({ open: true, result: null, error: null, loading: true });
    expect(markup(loader.getSnapshot())).not.toContain('data-objective');
    expect(text(markup(loader.getSnapshot()))).toContain('Planning the three modes…');
    // forgotten while that answer was on its way: it is dropped
    loader.close({ forget: true });
    answer(new Response(JSON.stringify(RESULT), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(loader.getSnapshot()).toEqual({ open: false, result: null, error: null, loading: false });
    // a plain close keeps the answer, so the card reopens on it while it fetches again
    vi.stubGlobal('fetch', answering(RESULT));
    loader.open();
    await settle();
    loader.close();
    expect(loader.getSnapshot()).toMatchObject({ open: false, result: RESULT });
  });

  it('drops the old target\'s answer when another target is picked, staying open on its planning line until the new one comes', async () => {
    // the review of the merge, T1: a target picked straight from the item search, with no Clear, keeps the card open
    vi.stubGlobal('fetch', answering(RESULT));
    const loader = compareLoader('p1');
    loader.target('t:a@0');
    loader.open();
    await settle();
    expect(loader.getSnapshot().result).toEqual(RESULT);
    // another target, its compare held on its way: no column, only that it is planning
    let answer: (r: Response) => void = () => {};
    const held = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', held);
    loader.target('t:b@0');
    expect(loader.getSnapshot()).toEqual({ open: true, result: null, error: null, loading: true });
    expect(held).toHaveBeenCalledTimes(1);
    expect(markup(loader.getSnapshot())).not.toContain('data-objective');
    expect(text(markup(loader.getSnapshot()))).toContain('Planning the three modes…');
    const NEW: CompareResult = { ...RESULT, rev: 4 };
    answer(new Response(JSON.stringify(NEW), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(loader.getSnapshot()).toEqual({ open: true, result: NEW, error: null, loading: false });

    // an answer for the old target still on its way when the target changes is dropped, and the new target's comes after it
    const answers: Array<(r: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answers.push(resolve); })));
    const late = compareLoader('p1');
    late.target('t:a@0');
    late.open();                                                                   // the old target's compare, on its way
    late.target('t:b@0');
    const json = (body: CompareResult) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    answers[0]!(json(RESULT));
    await settle();
    expect(late.getSnapshot()).toEqual({ open: true, result: null, error: null, loading: true });
    expect(answers).toHaveLength(2);                                               // asked again for the new target
    answers[1]!(json(NEW));
    await settle();
    expect(late.getSnapshot()).toEqual({ open: true, result: NEW, error: null, loading: false });

    // closed, the old target's answer is dropped too, so the next open starts fresh
    vi.stubGlobal('fetch', answering(RESULT));
    const closed = compareLoader('p1');
    closed.target('t:a@0');
    closed.open();
    await settle();
    closed.close();
    closed.target('t:b@0');
    expect(closed.getSnapshot()).toEqual({ open: false, result: null, error: null, loading: false });
  });

  it('keeps the answer when the same target\'s other settings change: the old figures stay beside "Updating…"', async () => {
    vi.stubGlobal('fetch', answering(RESULT));
    const loader = compareLoader('p1');
    loader.target('t:a@0');
    loader.open();
    await settle();
    // the amount, mode or tier changes: the page tells the loader the same target, and the plan event asks for the compare again
    loader.target('t:a@0');
    expect(loader.getSnapshot()).toEqual({ open: true, result: RESULT, error: null, loading: false });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    loader.refresh();
    expect(loader.getSnapshot()).toEqual({ open: true, result: RESULT, error: null, loading: true });
    expect(text(markup(loader.getSnapshot()))).toContain('Updating…');
    expect(markup(loader.getSnapshot())).toContain('data-objective');
    // a first target (none before it) and a cleared one drop nothing here: Clear closes the card with `forget` instead
    const fresh = compareLoader('p1');
    vi.stubGlobal('fetch', answering(RESULT));
    fresh.target(null);
    fresh.open();
    await settle();
    fresh.target('t:a@0');
    fresh.target(null);
    expect(fresh.getSnapshot().result).toEqual(RESULT);
  });

  it('hears the compare event of the project stream the page has open', () => {
    // One EventSource per open project (architecture §8): the store's stream tells the card's page of `plan` and `compare`.
    const sources: FakeEventSource[] = [];
    class FakeEventSource {
      static readonly CLOSED = 2;
      readonly url: string;
      readyState = 1;
      private readonly listeners = new Map<string, Array<(e: { data: string }) => void>>();
      constructor(url: string) {
        this.url = url;
        sources.push(this);
      }
      addEventListener(type: string, fn: (e: { data: string }) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
      }
      close(): void { this.readyState = FakeEventSource.CLOSED; }
      emit(type: string, data: unknown): void {
        for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const handlers: ProjectEventHandlers = { snapshot: vi.fn(), op: vi.fn(), plan: vi.fn(), connected: vi.fn(), deleted: vi.fn() };
    const stop = openProjectEvents('p1', handlers);
    const heard = vi.fn();
    const other = vi.fn();
    const off = listenProjectEvents('p1', heard);
    listenProjectEvents('p2', other);
    expect(sources.map((s) => s.url)).toEqual(['/api/projects/p1/events']);
    sources[0]!.emit('compare', { rev: 3 });
    sources[0]!.emit('plan', { rev: 4 });
    expect(heard.mock.calls).toEqual([[{ kind: 'compare', rev: 3 }], [{ kind: 'plan', rev: 4 }]]);
    expect(handlers.plan).toHaveBeenCalledWith({ rev: 4 });                      // the store still gets its plan event
    expect(other).not.toHaveBeenCalled();
    off();
    sources[0]!.emit('compare', { rev: 4 });
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('shows a button while closed, three columns once open, the mode in use disabled and a mode still planning', () => {
    // the button is the page's, not the card's (the Machine GUI restyle moved it out, so a closed card takes no room): the page draws it
    // twice, in the project head and in a bar under the banner at 900 px and below, and the stylesheet shows one. It names the card it
    // controls and says whether it is open, and the closed card draws nothing at all
    expect(renderToStaticMarkup(<CompareToggle open={false} onToggle={() => {}} />)).toBe(
      '<button type="button" class="small compare-toggle" aria-expanded="false" aria-controls="compare-card">Compare modes</button>',
    );
    expect(renderToStaticMarkup(<CompareToggle open onToggle={() => {}} />)).toContain('aria-expanded="true"');
    expect(markup(CLOSED)).toBe('');
    expect(markup(open(RESULT))).toContain('<section class="compare-card" id="compare-card" aria-labelledby="compare-title">');
    expect(text(markup(open(null, { loading: true })))).toContain('Planning the three modes…');
    const html = markup(open(RESULT));
    const columns = [...html.matchAll(/<section[^>]*data-objective="([^"]*)"[^>]*>(.*?)<\/section>/gs)].map((m) => [m[1], m[2] ?? '']);
    expect(columns.map(([objective, body]) => [objective, /<h4>([^<]*)<\/h4>/.exec(body!)?.[1]])).toEqual([
      ['least-raw', 'Least raw material'], ['cheapest', 'Cheapest'], ['multi-output', 'Best multi-output']]);
    const [least, cheapest, multi] = columns.map(([, body]) => body!);
    expect(cheapest).toMatch(/<button[^>]*disabled=""[^>]*>In use<\/button>/);
    expect(least).toMatch(/<button type="button">Use this mode<\/button>/);
    expect(text(least!)).toContain('Raw per hour 10');
    // each figure carries its length in glyphs, by which the stylesheet fits a long one to its tile (the review of the merge, C4)
    expect(least).toContain('<dd style="--glyphs:2">10</dd>');
    expect(least).toContain('<dd style="--glyphs:3">900</dd>');
    expect(text(least!)).toContain('Avoids: A, B');
    expect(text(cheapest!)).toContain('Adds: A');
    expect(text(multi!)).toContain('Still planning…');
    expect(multi).toMatch(/<button type="button">Use this mode<\/button>/);
    const credited = markup(open({ ...RESULT, modes: [{ objective: 'multi-output', status: 'ok', summary, credited: ['t:y@0'] }] }));
    expect(text(credited)).toContain('Also makes for other projects: Y');
    expect(text(markup(open(RESULT, { loading: true })))).toContain('Updating…');
  });

  it('uses a mode: "Use this mode" sends its settings patch', () => {
    for (const settings of [defaultSettings(), { ...defaultSettings(), objective: 'least-raw', buildHorizonHours: null } satisfies PlanSettings]) {
      const send = vi.fn();
      const tree = CompareCardView(props(open({ ...RESULT, current: settings.objective ?? 'cheapest' }), { settings, send }));
      const [column] = findAll(tree, (e) => e.props['data-objective'] === 'multi-output');
      const [use] = findAll(column!.props.children as ReactNode, (e) => e.type === 'button');
      (use!.props.onClick as () => void)();
      expect(send).toHaveBeenCalledWith([{ op: 'settings', patch: objectivePatch('multi-output', settings) }]);
    }
    const onToggle = vi.fn();
    const onClose = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const [openButton] = findAll(CompareToggle({ open: false, onToggle, ref }), (e) => e.type === 'button');
    (openButton!.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalled();
    expect(openButton!.props.ref).toBe(ref);                                   // the page's, which the card's Close gives the focus back to
    const [closeButton] = findAll(CompareCardView(props(open(RESULT), { onClose })), (e) => e.type === 'button' && e.props.children === 'Close');
    (closeButton!.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalled();
  });
});
