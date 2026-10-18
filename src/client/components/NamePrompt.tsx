// Asks once for the name shown next to this person's ticks and notes (spec §3.11: no accounts). It covers the page
// while no name is set and goes away for good once one is saved in this browser.

import { useState, type FormEvent, type ReactElement } from 'react';
import { setName, useName } from '../state/name.ts';

export function NamePrompt(): ReactElement | null {
  const name = useName();
  const [draft, setDraft] = useState('');
  if (name !== null) return null;
  const save = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setName(draft);
  };
  return (
    <div className="modal-backdrop">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="name-prompt-title" onSubmit={save}>
        <h2 id="name-prompt-title">What should we call you?</h2>
        <p className="muted">Your name shows next to your ticks and notes. It is kept in this browser only.</p>
        <label className="field">
          <span>Your name</span>
          <input autoFocus autoComplete="nickname" value={draft} onChange={(e) => setDraft(e.currentTarget.value)} />
        </label>
        <button type="submit" className="primary" disabled={draft.trim() === ''}>Save</button>
      </form>
    </div>
  );
}
