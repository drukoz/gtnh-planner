// Deleting a project (spec §3.11, architecture §11.24), on the project page and on each row of the project list: a
// button that opens an inline confirmation (never a browser dialog), whose Delete works only once the typed text is the
// project's name exactly.

import { useState, type FormEvent, type ReactElement } from 'react';
import { messageOf } from '../api/client.ts';
import { deleteProject } from '../api/projects.ts';
import { isProjectGone } from '../api/sse.ts';

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

export function DeleteConfirm(props: DeleteConfirmProps): ReactElement {
  const { name, typed, busy, error, onType, onConfirm, onCancel } = props;
  const ready = canDelete(typed, name) && !busy;
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (ready) onConfirm();
  };
  return (
    <form className="delete-confirm" aria-label="Confirm delete" onSubmit={submit}>
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
 * project the server no longer has counts as deleted already: `onGone` runs instead of the error showing.
 */
export function DeleteProject(props: { id: string; name: string; label: string; onDeleted(): void; onGone?(): void }): ReactElement {
  const { id, name, label, onDeleted, onGone } = props;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return <button type="button" className="delete-open" onClick={() => setOpen(true)}>{label}</button>;
  }
  const confirm = (): void => {
    setBusy(true);
    setError(null);
    const failed = (err: unknown): void => {
      setError(messageOf(err));
      setBusy(false);
    };
    if (onGone === undefined) deleteProject(id).then(onDeleted, failed);
    else deleteOrGone(id).then((outcome) => (outcome === 'gone' ? onGone() : onDeleted()), failed);
  };
  const cancel = (): void => {
    setOpen(false);
    setTyped('');
    setError(null);
  };
  return <DeleteConfirm name={name} typed={typed} busy={busy} error={error} onType={setTyped} onConfirm={confirm} onCancel={cancel} />;
}
