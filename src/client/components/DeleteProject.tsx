// Deleting a project (spec §3.11, architecture §11.24), on the project page and on each row of the project list: a
// button that opens an inline confirmation (never a browser dialog), whose Delete works only once the typed text is the
// project's name exactly. A project deleted here says so in a toast, whose Undo restores it (Phase 2 spec §12.1). Cancel, or
// Escape in the form, closes it, stops a delete still waiting for the page's posts, and gives the focus back to the button
// that opened it (the final fix wave, FW-6).

import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { ApiError, messageOf } from '../api/client.ts';
import { deleteProject, restoreProject } from '../api/projects.ts';
import { isProjectGone } from '../api/sse.ts';
import { forgetDeletedNotice } from '../state/deleted-notice.ts';
import { projectPostsSettled } from '../state/project-store.ts';
import { bumpProjectsChanged } from '../state/projects-changed.ts';
import { toasts, type ToastStore } from '../state/toasts.ts';

/**
 * Says that this tab deleted project `id` (Phase 2 spec §12.1), with Undo, which restores it: the App's region outlives the page, so the
 * project page's toast is there on the list it leaves for. A project back (or one someone else restored first: `409 not-deleted`) drops the
 * "was deleted" notice about it that the list was to show, and tells the list to load again and drop its notice about it (M5: a notice about
 * another project stays); any other failure (a project purged since: 404) says it could not. The key is the project's, so the list's own
 * Restore takes the toast away. Returns the toast's id.
 */
export function showDeletedToast(
  id: string, name: string, deps: { restore(id: string): Promise<unknown>; toasts: ToastStore } = { restore: restoreProject, toasts },
): number {
  const back = (): void => {
    forgetDeletedNotice(id);
    bumpProjectsChanged(id);
  };
  const undo = {
    label: 'Undo',
    run: () => deps.restore(id).then(back, (err: unknown) => {
      if (err instanceof ApiError && err.code === 'not-deleted') back();
      else deps.toasts.show(`Could not restore “${name}”`);
    }),
  };
  return deps.toasts.show(`Deleted “${name}”`, { key: `project:${id}`, action: undo });
}

/**
 * Deletes the project: 'deleted' once the server did, 'gone' when it answers that there is no such project any more
 * (someone else deleted it first: a list row can be stale, ruling C17); any other failure rejects.
 */
export async function deleteOrGone(id: string): Promise<'deleted' | 'gone'> {
  try {
    await deleteProject(id);
    return 'deleted';
  } catch (err) {
    if (isProjectGone(err)) return 'gone';
    throw err;
  }
}

/** Exactly the name: no trimming and no case folding (a mis-typed name never deletes). */
export function canDelete(typed: string, name: string): boolean {
  return typed === name;
}

export interface DeleteConfirmProps {
  name: string;
  typed: string;
  /** The delete is on its way. */
  busy: boolean;
  error: string | null;
  onType(text: string): void;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * The confirmation's form: the name typed, Delete and Cancel. While the delete is on its way its Delete is disabled, so a Delete that had the
 * focus hands it to Cancel first (a disabled button drops it on the page's body); Escape in it is Cancel, one layer per press (R15, P2-R21b): a
 * key a layer above has taken (a tip that hid) is not its, and it takes the key. No hooks: the tests render it as a plain function.
 */
export function DeleteConfirm(props: DeleteConfirmProps): ReactElement {
  const { name, typed, busy, error, onType, onConfirm, onCancel } = props;
  const ready = canDelete(typed, name) && !busy;
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!ready) return;
    const form = e.currentTarget;
    const at = form.ownerDocument.activeElement;
    if (at instanceof HTMLButtonElement && at.type === 'submit' && form.contains(at)) form.querySelector<HTMLButtonElement>('button[type="button"]')?.focus();
    onConfirm();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>): void => {
    if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {   // not a key a tip has hidden itself with (P2-R21b)
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <form className="delete-confirm" aria-label="Confirm delete" onSubmit={submit} onKeyDown={onKeyDown}>
      <p>
        {'Delete '}<strong>{name}</strong>{' for everyone? It can be restored from Recently deleted on the project list for 7 days.'}
      </p>
      <label className="field">
        <span>Type the project name to confirm</span>
        <input value={typed} autoFocus autoComplete="off" spellCheck={false} onChange={(e) => onType(e.currentTarget.value)} />
      </label>
      {error !== null && <p className="error small" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="danger" disabled={!ready}>Delete</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * The `label` button, then the confirmation; `onDeleted` runs once the server deleted the project. With `onGone`, a
 * project the server no longer has counts as deleted already: `onGone` runs instead of the error showing. The delete
 * is sent once what the page still has to post for the project has been answered (`beforeDelete`, by default the
 * project's posts on their way: Task 9b fix round 1, M1), for a post that reached the server after it would find the
 * project gone, and be dropped: a note deleted just before would come back with the project. Cancel meanwhile stops it:
 * a delete is sent only for the confirm the form still asks with (FW-6); one already sent completes, as before M1. Cancel
 * closes the form, ready to ask again, and gives the focus back to the button, which the form took the place of.
 */
export function DeleteProject(props: {
  id: string; name: string; label: string; onDeleted(): void; onGone?(): void; beforeDelete?(): Promise<unknown>;
}): ReactElement {
  const { id, name, label, onDeleted, onGone, beforeDelete } = props;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The confirm a waiting delete belongs to: Cancel and each new confirm make it an older one's, which sends nothing and says nothing. */
  const asking = useRef(0);
  /** The button that opens the form, and whether it takes the focus back as the form closes (Cancel), so the focus never falls to the body. */
  const opener = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    opener.current?.focus();
  }, [open]);
  if (!open) {
    return <button type="button" className="delete-open" ref={opener} onClick={() => setOpen(true)}>{label}</button>;
  }
  const confirm = (): void => {
    const mine = ++asking.current;
    setBusy(true);
    setError(null);
    const failed = (err: unknown): void => {
      if (asking.current !== mine) return;   // cancelled: the form that asked has gone
      setError(messageOf(err));
      setBusy(false);
    };
    const send = (): void => {
      if (asking.current !== mine) return;   // cancelled while it waited for the page's posts: no delete
      if (onGone === undefined) deleteProject(id).then(onDeleted, failed);
      else deleteOrGone(id).then((outcome) => (outcome === 'gone' ? onGone() : onDeleted()), failed);
    };
    void (beforeDelete?.() ?? projectPostsSettled(id)).then(send, send);
  };
  const cancel = (): void => {
    asking.current += 1;
    refocus.current = true;
    setOpen(false);
    setTyped('');
    setError(null);
    setBusy(false);
  };
  return <DeleteConfirm name={name} typed={typed} busy={busy} error={error} onType={setTyped} onConfirm={confirm} onCancel={cancel} />;
}
