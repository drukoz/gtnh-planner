import { afterEach, describe, it, expect, vi } from 'vitest';
import { apiPost, ApiError } from '../../src/client/api/client.ts';
import {
  createProjectStore, liveDeps, POST_TIMEOUT_MS, projectPostsSettled, type PostQueues, type StoreDeps,
} from '../../src/client/state/project-store.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { OpsResult } from '../../src/shared/types/api.ts';
import type { Project, ProjectOp } from '../../src/shared/types/project.ts';

const P0: Project = { id: 'p1', name: 'Steel', createdAt: 't', createdBy: 'Ann', rev: 0, settings: defaultSettings(), world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };
/** A store of project p1; its posts queue in `queues`, a map of its own unless a test shares one between stores (M2). */
function harness(post: StoreDeps['postOps'] = async () => ({ rev: 1 }), queues: PostQueues = new Map()) {
  let on!: Parameters<StoreDeps['openEvents']>[1];
  let hide: () => void = () => {};
  const deps: StoreDeps = { fetchProject: vi.fn(async () => P0), postOps: vi.fn(post), fetchPlan: vi.fn(async () => ({ settingsHash: 'h' }) as never),
    openEvents: (_id, handlers) => { on = handlers; return () => {}; }, me: () => 'Ann', now: () => 'now',
    onPageHide: (fn) => { hide = fn; return () => {}; } };
  const store = createProjectStore('p1', deps, queues);
  return { store, deps, events: () => on, hide: () => hide() };
}

describe('project store', () => {
  afterEach(() => { vi.useRealTimers(); });   // a failed fake-timer test must not stall the next one
  it('shows my change at once and keeps it through the echo', async () => {
    const { store, events } = harness();
    events().snapshot(P0);
    store.send([{ op: 'mark', row: 'run:a', on: true }]);
    expect(store.getSnapshot().project?.marks['run:a']?.by).toBe('Ann');
    events().op({ rev: 1, op: { op: 'mark', row: 'run:a', on: true }, by: 'Ann', at: 'now' });
    await vi.waitFor(() => expect(store.getSnapshot().project?.rev).toBe(1));
    expect(store.getSnapshot().project?.marks['run:a']?.by).toBe('Ann');
  });
  it('applies other people\'s ops on top of my pending ones', () => {
    const { store, events } = harness(() => new Promise(() => {}));
    events().snapshot(P0);
    store.send([{ op: 'mark', row: 'run:a', on: true }]);
    events().op({ rev: 1, op: { op: 'mark', row: 'run:b', on: true }, by: 'Bob', at: 'now' });
    const marks = store.getSnapshot().project!.marks;
    expect([marks['run:a']?.by, marks['run:b']?.by]).toEqual(['Ann', 'Bob']);
  });
  it('refetches the project after a missed op', async () => {
    const { deps, events } = harness();
    events().snapshot({ ...P0, rev: 2 });
    events().op({ rev: 5, op: { op: 'rename', name: 'x' }, by: 'Bob', at: 'now' });
    await vi.waitFor(() => expect(deps.fetchProject).toHaveBeenCalledTimes(2));   // initial load + gap
  });
  it('drops a rejected batch and shows the reason', async () => {
    const { store, events } = harness(async () => { throw Object.assign(new Error('op 0: tier must be 0..14'), { status: 400 }); });
    events().snapshot(P0);
    store.send([{ op: 'rename', name: 'New' }]);
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe('op 0: tier must be 0..14'));
    expect(store.getSnapshot().project?.name).toBe('Steel');
  });
  it('fetches the plan once per burst of plan events', async () => {
    vi.useFakeTimers();
    const { deps, events } = harness();
    events().snapshot(P0);
    events().plan({ rev: 1 }); events().plan({ rev: 2 });
    await vi.advanceTimersByTimeAsync(150);
    expect(deps.fetchPlan).toHaveBeenCalledTimes(2);                       // first load + one coalesced refetch
    vi.useRealTimers();
  });
  it('refetches the plan after the stream was down (plan events may have been missed)', async () => {
    vi.useFakeTimers();
    const { deps, events } = harness();
    events().connected(true); events().snapshot(P0);
    await vi.advanceTimersByTimeAsync(150);
    expect(deps.fetchPlan).toHaveBeenCalledTimes(1);                       // first load only
    events().connected(false); events().connected(true); events().snapshot({ ...P0, rev: 3 });
    await vi.advanceTimersByTimeAsync(150);
    expect(deps.fetchPlan).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it('refetches instead of failing on an op it does not know', async () => {
    const { deps, store, events } = harness();
    events().snapshot(P0);
    expect(() => events().op({ rev: 1, op: { op: 'fromTheFuture' } as never, by: 'Bob', at: 'now' })).not.toThrow();
    await vi.waitFor(() => expect(deps.fetchProject).toHaveBeenCalledTimes(2));
    expect(store.getSnapshot().project?.rev).toBe(0);
  });
  it('sends nothing from a batch with a malformed op', () => {
    const { deps, store, events } = harness();
    events().snapshot(P0);
    store.send([{ op: 'mark', row: 'run:a', on: true }, { op: 'rename', name: '   ' }]);
    expect(deps.postOps).not.toHaveBeenCalled();
    expect(store.getSnapshot().error).toBe('op 1: name must be 1 to 80 characters');
    expect(store.getSnapshot().project?.marks['run:a']).toBeUndefined();
  });
  it('clears a failed fetch once the server confirms the project again', async () => {
    const { deps, store, events } = harness();
    events().snapshot({ ...P0, rev: 2 });
    deps.fetchProject = vi.fn(async () => { throw new Error('Failed to fetch'); });
    events().op({ rev: 5, op: { op: 'rename', name: 'x' }, by: 'Bob', at: 'now' });     // gap: refetch, which fails
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe('Failed to fetch'));
    events().snapshot({ ...P0, rev: 5 });                                              // the stream comes back
    expect(store.getSnapshot()).toMatchObject({ error: null, project: { rev: 5 } });
  });
  it('keeps a rejected batch\'s reason when the project is confirmed', async () => {
    const { store, events } = harness(async () => { throw new Error('op 0: name must be 1 to 80 characters'); });
    events().snapshot(P0);
    store.send([{ op: 'rename', name: 'New' }]);
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe('op 0: name must be 1 to 80 characters'));
    events().snapshot({ ...P0, rev: 1 });
    expect(store.getSnapshot().error).toBe('op 0: name must be 1 to 80 characters');
  });
  it('keeps the plan that a plan of other settings replaced, not one a refetch replaced', async () => {
    vi.useFakeTimers();
    const { deps, store, events } = harness();
    events().snapshot(P0);
    await vi.advanceTimersByTimeAsync(0);
    const first = store.getSnapshot().plan;
    expect(first).toEqual({ settingsHash: 'h' });
    expect(store.getSnapshot().previousPlan).toBeNull();
    const answer = (plan: object): void => { deps.fetchPlan = vi.fn(async () => plan as never); };
    answer({ settingsHash: 'h', n: 2 });                                     // the same settings planned again (a rescan, a replan)
    events().plan({ rev: 1 });
    await vi.advanceTimersByTimeAsync(150);
    expect(store.getSnapshot().plan).toEqual({ settingsHash: 'h', n: 2 });
    expect(store.getSnapshot().previousPlan).toBeNull();
    answer({ settingsHash: 'h2' });                                          // someone changed a setting
    events().plan({ rev: 2 });
    await vi.advanceTimersByTimeAsync(150);
    expect(store.getSnapshot().plan).toEqual({ settingsHash: 'h2' });
    expect(store.getSnapshot().previousPlan).toEqual({ settingsHash: 'h', n: 2 });
    answer({ settingsHash: 'h2', n: 3 });
    events().plan({ rev: 3 });
    await vi.advanceTimersByTimeAsync(150);
    expect(store.getSnapshot().previousPlan).toEqual({ settingsHash: 'h', n: 2 });   // a refetch keeps what changed
    vi.useRealTimers();
  });
  it('ignores an answer older than what the events already brought', async () => {
    let answer: ((p: Project) => void) | undefined;
    const { deps, store, events } = harness();
    events().snapshot({ ...P0, rev: 2 });
    deps.fetchProject = vi.fn(() => new Promise<Project>((resolve) => { answer = resolve; }));
    events().op({ rev: 4, op: { op: 'rename', name: 'x' }, by: 'Bob', at: 'now' });     // gap: refetch
    await vi.waitFor(() => expect(answer).toBeDefined());
    events().snapshot({ ...P0, name: 'Newer', rev: 6 });                                // the stream reconnected meanwhile
    answer!({ ...P0, name: 'Older', rev: 4 });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getSnapshot().project).toMatchObject({ name: 'Newer', rev: 6 });
  });
});

// ---- Task 9b: a deferred send (Phase 2 spec §12.2), and one post at a time (ledger ruling P2-R59) ----

/** A project with one note, n1 (Bob's), which a deferred delete takes away. */
const WITH_NOTE: Project = { ...P0, notes: [{ id: 'n1', text: 'tap power here', by: 'Bob', at: '2026-10-24T12:00:00.000Z' }] };
const DELETE_N1: ProjectOp = { op: 'deleteNote', id: 'n1' };
const RENAME: ProjectOp = { op: 'rename', name: 'Iron' };
const UNDO: ProjectOp = { op: 'rename', name: 'Steel' };
const MARK: ProjectOp = { op: 'mark', row: 'run:a', on: true };
const noteIds = (store: { getSnapshot(): { project: Project | null } }): string[] | undefined => store.getSnapshot().project?.notes.map((n) => n.id);
/** The posts the store made, each as [project, ops] or [project, ops, options]. */
const postsOf = (deps: StoreDeps) => vi.mocked(deps.postOps).mock.calls;
/** Posts that answer only when the test says so: `answers[i]` settles the i-th. */
function heldPosts() {
  const answers: Array<{ ok(result: OpsResult): void; fail(err: unknown): void }> = [];
  const post: StoreDeps['postOps'] = () => new Promise<OpsResult>((resolve, reject) => { answers.push({ ok: resolve, fail: reject }); });
  return { answers, post };
}
/** The harness, with a spy on how the store lets go of pagehide. */
function releasing(post: StoreDeps['postOps']) {
  const h = harness(post);
  const off = vi.fn();
  let hide: () => void = () => {};
  const deps: StoreDeps = { ...h.deps, onPageHide: (fn) => { hide = fn; return off; } };
  const store = createProjectStore('p1', deps, new Map());
  h.store.close();
  return { store, deps, off, events: h.events, hide: () => hide() };
}

describe('project store: a deferred send (spec §12.2)', () => {
  it('applies a deferred batch at once and posts it only when it is flushed, once', () => {
    const { store, deps, events } = harness();
    events().snapshot(WITH_NOTE);
    const later = store.sendLater([DELETE_N1]);
    expect(noteIds(store)).toEqual([]);
    expect(deps.postOps).not.toHaveBeenCalled();
    later.flush();
    expect(postsOf(deps)).toEqual([['p1', [DELETE_N1]]]);                   // a plain flush passes no options
    later.flush();
    expect(postsOf(deps)).toEqual([['p1', [DELETE_N1]]]);
  });
  it('cancel brings it back and posts nothing', () => {
    const { store, deps, events } = harness();
    events().snapshot(WITH_NOTE);
    const onFlush = vi.fn();
    const later = store.sendLater([DELETE_N1], { onFlush });
    expect(noteIds(store)).toEqual([]);
    later.cancel();
    expect(store.getSnapshot().project?.notes).toEqual(WITH_NOTE.notes);  // the same note: its author, time and place
    later.flush(); later.cancel(); store.close();                           // nothing left to post, not even as the page goes
    expect(deps.postOps).not.toHaveBeenCalled();
    expect(onFlush).not.toHaveBeenCalled();
  });
  it('posts what is deferred when the store closes, and on pagehide, with keepalive, and says it flushed', () => {
    const closing = harness();
    closing.events().snapshot(WITH_NOTE);
    const closed = vi.fn();
    closing.store.sendLater([DELETE_N1], { onFlush: closed });
    closing.store.close();
    expect(postsOf(closing.deps)).toEqual([['p1', [DELETE_N1], { keepalive: true }]]);
    expect(closed).toHaveBeenCalledTimes(1);
    const hiding = harness();
    hiding.events().snapshot(WITH_NOTE);
    const hidden = vi.fn();
    hiding.store.sendLater([DELETE_N1], { onFlush: hidden });
    hiding.hide();
    expect(postsOf(hiding.deps)).toEqual([['p1', [DELETE_N1], { keepalive: true }]]);
    expect(hidden).toHaveBeenCalledTimes(1);
    hiding.hide(); hiding.store.close();                                    // flushed once: nothing more to post
    expect(postsOf(hiding.deps)).toHaveLength(1);
    expect(hidden).toHaveBeenCalledTimes(1);
  });
  it('says it flushed once the batch is no longer deferred, so a flush its callback asks for again posts nothing', () => {
    const { store, deps, events } = harness();
    events().snapshot(WITH_NOTE);
    const later = store.sendLater([DELETE_N1], { onFlush: () => later.flush() });   // as the note's toast does: dismissed, it expires and flushes
    later.flush();
    expect(postsOf(deps)).toHaveLength(1);
    expect(noteIds(store)).toEqual([]);                                     // posted, and still shown deleted until the server echoes it
  });
  it('lays a deferred batch over the batches on their way and over what the server confirms meanwhile', () => {
    const { store, events } = harness(() => new Promise(() => {}));
    events().snapshot(WITH_NOTE);
    store.send([{ op: 'addNote', note: { id: 'n2', text: 'and here' } }]);   // not answered yet
    store.sendLater([{ op: 'deleteNote', id: 'n2' }]);                       // and deleted at once
    expect(noteIds(store)).toEqual(['n1']);
    store.sendLater([DELETE_N1]);
    events().op({ rev: 1, op: { op: 'editNote', id: 'n1', text: 'tap power HERE' }, by: 'Bob', at: 'now' });   // Bob edits it meanwhile
    expect(noteIds(store)).toEqual([]);
  });
  it('defers nothing from a batch with a malformed op, or once closed', () => {
    const { store, deps, events } = harness();
    events().snapshot(WITH_NOTE);
    store.sendLater([{ op: 'deleteNote', id: '' }]).flush();
    expect(store.getSnapshot().error).toBe('op 0: note id must be 1 to 64 characters');
    expect(noteIds(store)).toEqual(['n1']);
    store.close();
    store.sendLater([DELETE_N1]).flush();
    expect(deps.postOps).not.toHaveBeenCalled();
  });
});

describe('project store: one post at a time (ledger ruling P2-R59)', () => {
  it('posts a project\'s batches one at a time, in order, each once the one before has answered, a failed one too', async () => {
    const { answers, post } = heldPosts();
    const { store, deps, events } = harness(post);
    events().snapshot(WITH_NOTE);
    store.send([RENAME]);
    store.send([UNDO]);                                                      // the rename's Undo, at once
    expect(postsOf(deps)).toEqual([['p1', [RENAME]]]);                      // the Undo waits for the rename's answer
    store.sendLater([DELETE_N1]).flush();
    expect(store.getSnapshot().project).toMatchObject({ name: 'Steel', notes: [] });   // all of it shows at once
    expect(postsOf(deps)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(postsOf(deps)).toHaveLength(1);
    answers[0]!.fail(new Error('Failed to fetch'));
    await vi.waitFor(() => expect(postsOf(deps)).toHaveLength(2));
    expect(postsOf(deps)[1]).toEqual(['p1', [UNDO]]);
    answers[1]!.ok({ rev: 1 });
    await vi.waitFor(() => expect(postsOf(deps)).toHaveLength(3));
    expect(postsOf(deps)[2]).toEqual(['p1', [DELETE_N1]]);
    expect(store.getSnapshot().error).toBe('Failed to fetch');
  });
  it('sends what still waits its turn at once, as one post in order and with keepalive, when the page goes (M4)', () => {
    const { store, deps, events, hide } = harness(() => new Promise(() => {}));   // nothing answers: the page is going
    events().snapshot(WITH_NOTE);
    store.send([RENAME]);
    store.send([UNDO]);
    store.sendLater([DELETE_N1]);
    hide();
    expect(postsOf(deps)).toEqual([['p1', [RENAME]], ['p1', [UNDO, DELETE_N1], { keepalive: true }]]);
  });
  it('posts in turn what still waits once the store has closed, and hears pagehide until it has', async () => {
    const { answers, post } = heldPosts();
    const { store, deps, events, off } = releasing(post);
    events().snapshot(WITH_NOTE);
    store.send([MARK]);
    store.sendLater([DELETE_N1]);
    store.close();
    expect(postsOf(deps)).toEqual([['p1', [MARK]]]);                         // the delete waits its turn, the page gone
    expect(off).not.toHaveBeenCalled();
    answers[0]!.ok({ rev: 1 });
    await vi.waitFor(() => expect(postsOf(deps)).toHaveLength(2));
    expect(postsOf(deps)[1]).toEqual(['p1', [DELETE_N1], { keepalive: true }]);
    expect(off).not.toHaveBeenCalled();
    answers[1]!.ok({ rev: 2 });
    await vi.waitFor(() => expect(off).toHaveBeenCalledTimes(1));             // nothing waits any more
    // a tab closed while something still waited sends it at once
    const later = releasing(() => new Promise(() => {}));
    later.events().snapshot(WITH_NOTE);
    later.store.send([MARK]);
    later.store.sendLater([DELETE_N1]);
    later.store.close();
    later.hide();
    expect(postsOf(later.deps)).toEqual([['p1', [MARK]], ['p1', [DELETE_N1], { keepalive: true }]]);
  });
  it('lets go of pagehide at once when it closes with nothing to post', () => {
    const { store, off } = releasing(async () => ({ rev: 1 }));
    store.close();
    expect(off).toHaveBeenCalledTimes(1);
  });
  it('asks the browser to keep a post alive past its page only when told to (keepalive)', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ rev: 1 }));
    vi.stubGlobal('fetch', fetch);
    try {
      await apiPost('/api/projects/p1/ops', { ops: [DELETE_N1] }, { keepalive: true });
      await apiPost('/api/projects/p1/ops', { ops: [DELETE_N1] });
      expect(fetch.mock.calls.map(([, init]) => init.keepalive)).toEqual([true, undefined]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---- Task 9b fix round 1: freeze (ledger ruling P2-R63), the project's delete (M1), a queue per project (M2), a post's 60 s (P2-R64),
// what waits as the page goes (M4) ----

describe('project store: fix round 1', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('hears the page frozen as it hears it hidden for good: Chrome may discard a frozen page, and it runs no timer (P2-R63)', () => {
    const [onWindow, offWindow, onDocument, offDocument] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    vi.stubGlobal('addEventListener', onWindow); vi.stubGlobal('removeEventListener', offWindow);
    vi.stubGlobal('document', { addEventListener: onDocument, removeEventListener: offDocument });
    const fn = (): void => {};
    const stop = liveDeps().onPageHide!(fn);
    expect(onWindow).toHaveBeenCalledWith('pagehide', fn);
    expect(onDocument).toHaveBeenCalledWith('freeze', fn);
    stop();
    expect(offWindow).toHaveBeenCalledWith('pagehide', fn);
    expect(offDocument).toHaveBeenCalledWith('freeze', fn);
  });

  it('posts what is deferred, and answers once every post of the project has been answered, before the project is deleted (M1)', async () => {
    const { answers, post } = heldPosts();
    const queues: PostQueues = new Map();
    const { store, deps, events } = harness(post, queues);
    events().snapshot(WITH_NOTE);
    store.send([MARK]);                                                       // on its way
    const onFlush = vi.fn();
    store.sendLater([DELETE_N1], { onFlush });
    let settled = false;
    void store.flushDeferred().then(() => { settled = true; });
    expect(onFlush).toHaveBeenCalledTimes(1);                                 // its toast goes: the delete is posted
    answers[0]!.ok({ rev: 1 });
    await vi.waitFor(() => expect(postsOf(deps)).toEqual([['p1', [MARK]], ['p1', [DELETE_N1]]]));   // the page stays: a plain post
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    answers[1]!.ok({ rev: 2 });
    await vi.waitFor(() => expect(settled).toBe(true));
    await projectPostsSettled('p1', queues);                                  // nothing waits: at once
    await projectPostsSettled('never posted', queues);
  });

  it('queues the posts of a project, not of a store: one opened again on it waits for what the closed one still posts (M2)', async () => {
    const { answers, post } = heldPosts();
    const queues: PostQueues = new Map();
    const first = harness(post, queues);
    first.events().snapshot(WITH_NOTE);
    first.store.send([RENAME]);
    first.store.close();                                                      // its rename still on its way
    const second = harness(post, queues);
    second.events().snapshot(WITH_NOTE);
    second.store.send([UNDO]);
    await new Promise((r) => setTimeout(r, 0));
    expect(postsOf(first.deps)).toEqual([['p1', [RENAME]]]);
    expect(postsOf(second.deps)).toEqual([]);                                 // the Undo waits for the rename's answer
    answers[0]!.ok({ rev: 1 });
    await vi.waitFor(() => expect(postsOf(second.deps)).toEqual([['p1', [UNDO]]]));
    // and the page's own queues are the default: two stores of one project share one
    const held = heldPosts();
    const deps = (): StoreDeps => ({ fetchProject: vi.fn(async () => ({ ...WITH_NOTE, id: 'm2' })), postOps: vi.fn(held.post),
      fetchPlan: vi.fn(async () => ({ settingsHash: 'h' }) as never), openEvents: () => () => {}, me: () => 'Ann', now: () => 'now' });
    const [a, b] = [deps(), deps()];
    const left = createProjectStore('m2', a);
    await vi.waitFor(() => expect(left.getSnapshot().project).not.toBeNull());
    left.send([RENAME]);
    left.close();
    const again = createProjectStore('m2', b);
    await vi.waitFor(() => expect(again.getSnapshot().project).not.toBeNull());
    again.send([UNDO]);
    expect(postsOf(b)).toEqual([]);
    held.answers[0]!.ok({ rev: 1 });
    await vi.waitFor(() => expect(postsOf(b)).toEqual([['m2', [UNDO]]]));
    held.answers[1]!.ok({ rev: 2 });
    await projectPostsSettled('m2');
    again.close();
  });

  it('gives each post 60 s, then says the server did not answer (P2-R64)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_ok, fail) => {
      init.signal?.addEventListener('abort', () => fail(new DOMException('The operation was aborted.', 'AbortError')));
    })));
    let outcome: unknown = 'waiting';
    liveDeps().postOps('p1', [DELETE_N1]).then((r) => { outcome = r; }, (err: unknown) => { outcome = err; });
    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS - 1);
    expect(outcome).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome).toMatchObject({ code: 'timeout', message: 'No answer from the server in 60 s' });
    expect(POST_TIMEOUT_MS).toBe(60_000);
  });

  it('counts a post that timed out as failed, takes the project as the server has it, and lets the next go (P2-R64)', async () => {
    let posts = 0;
    const { store, deps, events } = harness(async () => {
      posts += 1;
      if (posts === 1) throw new ApiError(0, 'timeout', 'No answer from the server in 60 s');
      return { rev: 1 };
    });
    events().snapshot(WITH_NOTE);
    await vi.waitFor(() => expect(deps.fetchProject).toHaveBeenCalledTimes(1));   // the first load
    store.send([RENAME]);
    store.send([UNDO]);
    await vi.waitFor(() => expect(postsOf(deps)).toHaveLength(2));
    expect(store.getSnapshot().error).toBe('No answer from the server in 60 s');
    await vi.waitFor(() => expect(deps.fetchProject).toHaveBeenCalledTimes(2));   // and the resync
  });

  it('sends what waits as the page goes in posts of whole batches of at most 100 ops, the most the server takes (M4)', () => {
    const { store, deps, events, hide } = harness(() => new Promise(() => {}));
    events().snapshot(WITH_NOTE);
    const marks = (from: number, n: number): ProjectOp[] => Array.from({ length: n }, (_, i) => ({ op: 'mark', row: `step:s${from + i}`, on: true }));
    store.send([MARK]);                                                       // on its way
    store.send(marks(0, 60));
    store.send(marks(60, 50));
    store.sendLater([DELETE_N1]);
    hide();
    expect(postsOf(deps)).toEqual([
      ['p1', [MARK]],
      ['p1', marks(0, 60), { keepalive: true }],
      ['p1', [...marks(60, 50), DELETE_N1], { keepalive: true }],
    ]);
  });

  it('sends what waits as the page goes without keepalive when it is more than a keepalive post may carry (M4)', () => {
    const { store, deps, events, hide } = harness(() => new Promise(() => {}));
    events().snapshot(WITH_NOTE);
    const big = Array.from({ length: 16 }, (_, i): ProjectOp => ({ op: 'addNote', note: { id: `big${i}`, text: 'x'.repeat(4000) } }));
    store.send([MARK]);                                                       // on its way
    store.send(big);                                                          // 16 notes of 4,000 characters: over 60 KiB
    store.sendLater([DELETE_N1]);
    hide();
    expect(postsOf(deps)).toEqual([['p1', [MARK]], ['p1', [...big, DELETE_N1]]]);   // one post, in order: a best effort
  });
});
