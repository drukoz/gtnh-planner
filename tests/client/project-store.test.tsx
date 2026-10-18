import { afterEach, describe, it, expect, vi } from 'vitest';
import { createProjectStore, type StoreDeps } from '../../src/client/state/project-store.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { Project } from '../../src/shared/types/project.ts';

const P0: Project = { id: 'p1', name: 'Steel', createdAt: 't', createdBy: 'Ann', rev: 0, settings: defaultSettings(), world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };
function harness(post: StoreDeps['postOps'] = async () => ({ rev: 1 })) {
  let on!: Parameters<StoreDeps['openEvents']>[1];
  const deps: StoreDeps = { fetchProject: vi.fn(async () => P0), postOps: vi.fn(post), fetchPlan: vi.fn(async () => ({ settingsHash: 'h' }) as never),
    openEvents: (_id, handlers) => { on = handlers; return () => {}; }, me: () => 'Ann', now: () => 'now' };
  const store = createProjectStore('p1', deps);
  return { store, deps, events: () => on };
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
