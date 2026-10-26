// The project's notes (spec §3.7, §3.11): anyone can add, edit or delete one, and everyone sees who wrote it and when.
// Notes with a map pin (added from Plan 4's map) show where they point. A note's Delete asks nothing first: its toast offers Undo instead
// (Phase 2 spec §12.2, §13.1), and no browser dialog is left in the client.
//
// A button pressed here that goes, or is disabled, hands the keyboard's focus on, never leaving it on the page's body (ledger rulings P2-R57,
// P2-R68): Delete before its note goes, to the next note's Delete, else the previous note's, else the field to add a note; Add note, which the
// field it clears disables, to that field; Save and Cancel, whose form goes, back to the note's Edit. A held Enter deletes one note, not the
// next one Delete hands the focus to (P2-R69).

import { useLayoutEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { MAX_NOTE_LENGTH } from '../../shared/project/apply-op.ts';
import type { Plan } from '../../shared/types/plan.ts';
import type { Note, ProjectOp } from '../../shared/types/project.ts';
import { focusLost, focusMain, focusOn, ignoreHeldEnter } from '../components/focus.ts';
import { localTime } from '../format.ts';
import { dismissToast, showToast } from '../state/toasts.ts';
import type { ProjectViewProps } from './project-tabs.ts';

/** A random UUID; crypto.randomUUID exists only on HTTPS and localhost, and friends reach the planner over plain HTTP. */
function newNoteId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pinText(pin: NonNullable<Note['pin']>, plan: Plan | null): string {
  const dim = plan?.names?.[`dimId:${pin.dim}`] ?? `DIM${pin.dim}`;
  return `Pin: ${pin.x} ${pin.y} ${pin.z} (${dim})`;
}

/** The Delete of note `li`, by its words; a note being edited has none. */
const deleteOf = (li: Element): HTMLButtonElement | undefined =>
  [...li.querySelectorAll<HTMLButtonElement>('.note-actions > button')].find((b) => b.textContent === 'Delete');

/**
 * Before note `row` goes, the focus inside it moves on: to the Delete of the nearest note after it that has one, else of the nearest before
 * it, else to the field to add a note, else to the page's main. A focus elsewhere is left where it is.
 */
function handFocusOn(row: Element): void {
  if (!row.contains(document.activeElement)) return;
  const notes = [...(row.parentElement?.children ?? [])];
  const at = notes.indexOf(row);
  for (const li of [...notes.slice(at + 1), ...notes.slice(0, at).reverse()]) if (focusOn(deleteOf(li))) return;
  if (!focusOn(row.closest('.notes')?.querySelector('.note-add textarea'))) focusMain();
}

function NoteItem(props: { note: Note; plan: Plan | null; send: ProjectViewProps['send']; sendLater: ProjectViewProps['sendLater'] }): ReactElement {
  const { note, plan, send, sendLater } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Save and Cancel take the form away with the button pressed: the focus that leaves on the body goes back to the note's Edit
  useLayoutEffect(() => {
    const was = wasEditing.current;
    wasEditing.current = draft !== null;
    if (was && draft === null && focusLost() && !focusOn(edit.current)) focusMain();
  }, [draft]);
  const save = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const text = (draft ?? '').trim();
    if (text !== '' && text !== note.text) send([{ op: 'editNote', id: note.id, text }]);
    setDraft(null);
  };
  const remove = (button: HTMLButtonElement): void => {
    const row = button.closest('li');
    if (row !== null) handFocusOn(row);
    const ops: ProjectOp[] = [{ op: 'deleteNote', id: note.id }];
    if (sendLater === undefined) {
      send(ops);
      return;
    }
    // No op brings a note back (adding it again would make whoever undoes it its author, now, last), so the delete waits in the page's store
    // while the toast offers Undo, and is posted once the toast has gone (Phase 2 spec §12.2), or as the page goes. Posted, it has no Undo
    // left, so it takes the toast away. Its toast's going posts it, so its time runs on while the page is hidden (ledger ruling P2-R63).
    const key = `note:${note.id}`;
    const later = sendLater(ops, { onFlush: () => dismissToast(key) });
    showToast('Note deleted', { key, action: { label: 'Undo', run: () => later.cancel() }, onExpire: () => later.flush(), runsHidden: true });
  };
  return (
    <li className="note" data-note-id={note.id}>
      {draft === null ? (
        <p className="note-text">{note.text}</p>
      ) : (
        <form className="note-edit" onSubmit={save}>
          <textarea aria-label="Note text" value={draft} maxLength={MAX_NOTE_LENGTH} rows={3} autoFocus onChange={(e) => setDraft(e.currentTarget.value)} />
          <div className="row">
            <button type="submit" className="primary" disabled={draft.trim() === ''}>Save</button>
            <button type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
      <p className="note-meta muted">
        <span className="note-by">{note.by}</span>
        {' · '}
        <time dateTime={note.at}>{localTime(note.at)}</time>
        {note.pin !== undefined && <span className="note-pin">{` · ${pinText(note.pin, plan)}`}</span>}
      </p>
      {draft === null && (
        <div className="row note-actions">
          <button ref={edit} type="button" onClick={() => setDraft(note.text)}>Edit</button>
          {/* a held Enter deletes one note, not the next one this hands the focus to (ledger ruling P2-R69) */}
          <button type="button" onClick={(e) => remove(e.currentTarget)} onKeyDown={ignoreHeldEnter}>Delete</button>
        </div>
      )}
    </li>
  );
}

export function NotesView(props: ProjectViewProps): ReactElement {
  const { project, plan, send, sendLater } = props;
  const [text, setText] = useState('');
  const add = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const note = text.trim();
    if (note === '') return;
    // the field it clears disables Add note, and a disabled button drops the focus it has on the body at its next frame: the field takes it first
    const form = e.currentTarget;
    if (document.activeElement === form.querySelector('button[type="submit"]') && !focusOn(form.querySelector('textarea'))) focusMain();
    send([{ op: 'addNote', note: { id: newNoteId(), text: note } }]);
    setText('');
    showToast('Note added');
  };
  return (
    <div className="notes">
      {project.notes.length === 0 ? (
        <p className="muted">No notes yet.</p>
      ) : (
        <ul className="note-list">
          {project.notes.map((note) => <NoteItem key={note.id} note={note} plan={plan} send={send} sendLater={sendLater} />)}
        </ul>
      )}
      <form className="note-add" onSubmit={add}>
        <label className="field">
          <span>Add a note</span>
          <textarea value={text} maxLength={MAX_NOTE_LENGTH} rows={3} onChange={(e) => setText(e.currentTarget.value)} />
        </label>
        <button type="submit" className="primary" disabled={text.trim() === ''}>Add note</button>
      </form>
    </div>
  );
}
