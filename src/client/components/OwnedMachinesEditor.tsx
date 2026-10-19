// The "Machines we have" list of the settings panel (design spec §3.3, architecture §11.29, plan 09 Task 9): one row per
// machine type the group owns outside the linked world's base (or with no world linked), by name and tier with how many
// and a remove button, and a form that picks a machine of the pack (by tier, multiblocks last) and how many of it; a
// machine already listed adds to its count. Every change sends the whole new list.

import { useState, type FormEvent, type ReactElement } from 'react';
import { formatNumber } from '../format.ts';
import {
  ownableMachineGroups, ownedMachineLabel, ownedWith, ownedWithout, parseOwnedCount, type OwnableMachine, type OwnedEntry,
} from '../views/settings-model.ts';

export interface OwnedMachinesEditorProps {
  /** The project's "Machines we have" list (`PlanSettings.ownedManual`), in its order. */
  owned: readonly OwnedEntry[];
  /** The machines it can name (`PackInfo.machines`); undefined while the pack is not loaded. */
  machines: readonly OwnableMachine[] | undefined;
  /** Sends the whole new list. */
  onChange(owned: OwnedEntry[]): void;
}

export function OwnedMachinesEditor(props: OwnedMachinesEditorProps): ReactElement {
  const { owned, machines, onChange } = props;
  const byId = new Map((machines ?? []).map((m) => [m.mteId, m]));
  /** Sends the list with `count` more of `mteId`: null once sent, else why it cannot be (`ownedWith`). */
  const add = (mteId: number, count: number): string | null => {
    const next = ownedWith(owned, mteId, count);
    if ('error' in next) return next.error;
    onChange(next.owned);
    return null;
  };
  return (
    <div className="owned-machines">
      {owned.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="key-list">
          {owned.map(({ mteId, count }) => {
            const label = ownedMachineLabel(byId.get(mteId), mteId);
            return (
              <li key={mteId} data-owned-machine={mteId}>
                <span className="key-name">{`${formatNumber(count)}× ${label}`}</span>
                <button type="button" className="small" aria-label={`Remove ${label}`} onClick={() => onChange(ownedWithout(owned, mteId))}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}
      {machines === undefined ? <p className="muted">The pack is not loaded yet.</p> : <AddOwnedMachine machines={machines} onAdd={add} />}
    </div>
  );
}

/** Picks one of `machines` and how many of it; `onAdd` sends it and says why it could not (null once sent). */
function AddOwnedMachine(props: { machines: readonly OwnableMachine[]; onAdd(mteId: number, count: number): string | null }): ReactElement {
  const { machines, onAdd } = props;
  const [machine, setMachine] = useState('');   // the picked mteId, '' for none
  const [count, setCount] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const parsed = parseOwnedCount(count);
    const problem = machine === '' ? 'Pick a machine' : 'error' in parsed ? parsed.error : onAdd(Number(machine), parsed.count);
    setError(problem);
    if (problem === null) {
      setMachine('');
      setCount('1');
    }
  };
  return (
    <form className="owned-add" onSubmit={submit}>
      <label className="field">
        <span>Machine</span>
        <select value={machine} onChange={(e) => setMachine(e.currentTarget.value)}>
          <option value="">Pick a machine…</option>
          {ownableMachineGroups(machines).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.machines.map((m) => <option key={m.mteId} value={String(m.mteId)}>{ownedMachineLabel(m, m.mteId)}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="row">
        <label className="field cost-field">
          <span>How many</span>
          <input type="text" inputMode="numeric" autoComplete="off" value={count} onChange={(e) => setCount(e.currentTarget.value)} />
        </label>
        <button type="submit">Add</button>
      </div>
      {error !== null && <p className="field-error error" role="alert">{error}</p>}
    </form>
  );
}
