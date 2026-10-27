import { afterEach, describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canDelete, DeleteConfirm, deleteOrGone } from '../../src/client/components/DeleteProject.tsx';
import { RecentlyDeleted } from '../../src/client/views/ProjectList.tsx';
import { createProjectStore, type StoreDeps } from '../../src/client/state/project-store.ts';
import { alreadyDeletedNotice, deletedNotice, leaveDeletedProject, takeDeletedNotice } from '../../src/client/state/deleted-notice.ts';
import { deleteProject, restoreProject } from '../../src/client/api/projects.ts';
import { ApiError } from '../../src/client/api/client.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { DeletedProjectSummary } from '../../src/shared/types/api.ts';
import type { Project } from '../../src/shared/types/project.ts';

const P0: Project = { id: 'p1', name: 'MV circuits', createdAt: 't', createdBy: 'Ann', rev: 0, settings: defaultSettings(), world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [] };
const GONE: DeletedProjectSummary = { id: 'p 1', name: 'MV circuits', rev: 3, target: null, updatedAt: '2026-10-18T11:00:00.000Z', deletedAt: '2026-10-18T12:00:00.000Z', deletedBy: 'Sam' };

function harness(fetchProject: StoreDeps['fetchProject'] = async () => P0) {
  let on!: Parameters<StoreDeps['openEvents']>[1];
  const stop = vi.fn();
  const deps: StoreDeps = { fetchProject: vi.fn(fetchProject), postOps: vi.fn(async () => ({ rev: 1 })), fetchPlan: vi.fn(async () => ({ settingsHash: 'h' }) as never),
    openEvents: (_id, handlers) => { on = handlers; return stop; }, me: () => 'Ann', now: () => 'now' };
  const store = createProjectStore('p1', deps);
  return { store, deps, stop, events: () => on };
}

/** Every element in `node` (a rendered tree of host elements) that `match` accepts, depth first. */
function findAll(node: ReactNode, match: (e: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => findAll(n, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

/** A fake address bar for `navigate` (node has no location or history). */
function stubAddressBar(pathname: string) {
  const loc = { pathname, search: '', hash: '', get href() { return `http://planner.test${this.pathname}${this.search}${this.hash}`; } };
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', { pushState: (_s: unknown, _t: string, path: string) => {
    const u = new URL(path, loc.href);
    Object.assign(loc, { pathname: u.pathname, search: u.search, hash: u.hash });
  } });
  return loc;
}

afterEach(() => { vi.unstubAllGlobals(); takeDeletedNotice(); });

describe('typed confirmation', () => {
  const deleteButton = (typed: string, busy = false): string => {
    const html = renderToStaticMarkup(<DeleteConfirm name="MV circuits" typed={typed} busy={busy} error={null} onType={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    const button = /<button[^>]*type="submit"[^>]*>Delete<\/button>/.exec(html)?.[0];
    expect(button, html).toBeDefined();
    return button!;
  };
  it('enables Delete only for the exact project name', () => {
    for (const typed of ['', 'mv circuits', 'MV circuits ', ' MV circuits', 'MV Circuits', 'MV  circuits']) {
      expect(deleteButton(typed), JSON.stringify(typed)).toContain('disabled');
      expect(canDelete(typed, 'MV circuits'), JSON.stringify(typed)).toBe(false);
    }
    expect(deleteButton('MV circuits')).not.toContain('disabled');
    expect(canDelete('MV circuits', 'MV circuits')).toBe(true);
    expect(deleteButton('MV circuits', true)).toContain('disabled');   // while the delete is on its way
  });
  // the final fix wave, FW-6: Escape in the form is its Cancel, one layer per press (P2-R21b): a key a layer above took is not its, and the
  // key it acts on it takes, so the drawer or a list under it does not close too
  it('takes Escape as Cancel, unless a layer above has taken it', () => {
    const onCancel = vi.fn();
    const form = DeleteConfirm({ name: 'MV circuits', typed: '', busy: false, error: null, onType: () => {}, onConfirm: () => {}, onCancel }) as ReactElement<{ onKeyDown(e: unknown): void }>;
    const press = (key: string, defaultPrevented: boolean) => {
      const preventDefault = vi.fn();
      form.props.onKeyDown({ key, nativeEvent: { defaultPrevented }, preventDefault });
      return preventDefault;
    };
    expect(press('Escape', true)).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(press('Enter', false)).not.toHaveBeenCalled();
    expect(press('Escape', false)).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it('asks inline, with no browser dialog', () => {
    const html = renderToStaticMarkup(<DeleteConfirm name="MV circuits" typed="" busy={false} error="No project p1" onType={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect(html).toContain('Type the project name to confirm');
    expect(html).toContain('MV circuits');
    expect(html).toContain('No project p1');
    expect(html).toContain('>Cancel<');
  });
  it('sends DELETE /api/projects/<id>', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(deleteProject('p 1')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/projects/p%201', expect.objectContaining({ method: 'DELETE' }));
  });
  it('counts a project someone else deleted already as gone, not as a failure (a stale list row, ruling C17)', async () => {
    const answer = (status: number, body?: unknown) => async () =>
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(answer(204)));
    await expect(deleteOrGone('p1')).resolves.toBe('deleted');
    const fetch = vi.fn(answer(404, { error: 'not-found', message: 'No project p1' }));
    vi.stubGlobal('fetch', fetch);
    await expect(deleteOrGone('p1')).resolves.toBe('gone');
    expect(fetch).toHaveBeenCalledWith('/api/projects/p1', expect.objectContaining({ method: 'DELETE' }));
    expect(alreadyDeletedNotice('MV circuits')).toBe('MV circuits was already deleted');
    // Anything else is still an error the confirmation shows.
    vi.stubGlobal('fetch', vi.fn(answer(400, { error: 'name-required', message: 'Say who you are first' })));
    await expect(deleteOrGone('p1')).rejects.toMatchObject({ status: 400, code: 'name-required' });
    vi.stubGlobal('fetch', vi.fn(answer(404)));                                   // not the planner's not-found
    await expect(deleteOrGone('p1')).rejects.toMatchObject({ status: 404, code: 'http-404' });
  });
});

describe('a deleted project', () => {
  it('stops the stream once the server says it was deleted, and leaves for the list with the notice once', async () => {
    const { store, events, stop } = harness();
    events().snapshot(P0);
    const seen = vi.fn();
    store.subscribe(seen);
    events().deleted({ id: 'p1', by: 'Sam', at: '2026-10-18T12:00:00.000Z' });
    expect(store.getSnapshot()).toMatchObject({ deleted: { by: 'Sam' }, project: { name: 'MV circuits' } });
    expect(stop).toHaveBeenCalled();
    store.markDeleted('Ann');                                              // this tab's own DELETE answered after the event
    events().deleted({ id: 'p1', by: 'Bob', at: 'later' });
    expect(store.getSnapshot().deleted).toEqual({ by: 'Sam' });
    expect(seen).toHaveBeenCalledTimes(1);                                 // the page reacts to one change only

    const loc = stubAddressBar('/p/p1');
    leaveDeletedProject('MV circuits', 'Sam');
    expect(loc.pathname).toBe('/');
    expect(takeDeletedNotice()).toBe('MV circuits was deleted by Sam');
    expect(takeDeletedNotice()).toBeNull();
  });
  it('counts a 404 for the project as deleted (a tab that missed the event)', async () => {
    const { store, stop } = harness(async () => { throw new ApiError(404, 'not-found', 'No project p1'); });
    await vi.waitFor(() => expect(store.getSnapshot().deleted).toEqual({ by: null }));
    expect(stop).toHaveBeenCalled();
    expect(store.getSnapshot().error).toBeNull();
    expect(deletedNotice('MV circuits', null)).toBe('MV circuits was deleted');
    expect(deletedNotice(null, null)).toBe('That project no longer exists');
  });
  it('keeps other failures as errors', async () => {
    const { store, stop } = harness(async () => { throw new Error('Failed to fetch'); });
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe('Failed to fetch'));
    expect(store.getSnapshot().deleted).toBeNull();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('recently deleted', () => {
  it('shows only when something was deleted, with who and when', () => {
    expect(renderToStaticMarkup(<RecentlyDeleted projects={[]} restoring={null} onRestore={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(<RecentlyDeleted projects={[GONE]} restoring={null} onRestore={() => {}} />);
    expect(html).toContain('Recently deleted');
    expect(html).toContain('MV circuits');
    expect(html).toContain('Sam');
    expect(html).toContain('dateTime="2026-10-18T12:00:00.000Z"');
    expect(html).toMatch(/<button[^>]*>Restore<\/button>/);
    expect(renderToStaticMarkup(<RecentlyDeleted projects={[GONE]} restoring="p 1" onRestore={() => {}} />)).toMatch(/<button[^>]*disabled[^>]*>Restore<\/button>/);
  });
  it('restores through POST /api/projects/<id>/restore', async () => {
    const onRestore = vi.fn();
    const [button] = findAll(RecentlyDeleted({ projects: [GONE], restoring: null, onRestore }), (e) => e.type === 'button');
    (button!.props.onClick as () => void)();
    expect(onRestore).toHaveBeenCalledWith(GONE);

    const fetch = vi.fn(async () => new Response(JSON.stringify(P0), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(restoreProject('p 1')).resolves.toEqual(P0);
    expect(fetch).toHaveBeenCalledWith('/api/projects/p%201/restore', expect.objectContaining({ method: 'POST', body: '{}' }));
  });
});
