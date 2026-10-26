// The avoid list of the settings panel (spec §3.3 "Materials to avoid", plan 2026-10-18-08 ruling R12): one chip per
// entry with a remove button, a box that suggests the pack's other materials by name or display name as you type
// (Enter takes the highlighted one; other text is added as the material it spells, else as typed, and the plan says
// when it matches nothing), and the item search for a single item or fluid. Every change sends one `settings` op with
// the whole new list.

import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import { MAX_AVOID_ENTRIES } from '../../shared/project/apply-op.ts';
import type { SearchHit } from '../../shared/types/pack.ts';
import type { ProjectOp } from '../../shared/types/project.ts';
import {
  avoidLabel, avoidWith, avoidWithout, isStuffKey, materialFor, materialSuggestions, type AvoidMaterial,
} from '../views/settings-model.ts';
import { ItemIcon } from './ItemIcon.tsx';
import { ItemSearch } from './ItemSearch.tsx';

const CHIP_ICON_SIZE = 16;

export interface AvoidPickerProps {
  /** The project's avoid list, in its order. */
  avoid: readonly string[];
  /** What the material box suggests (`PackInfo.materials`). */
  materials: readonly AvoidMaterial[];
  nameOf(key: string): string;
  send(ops: ProjectOp[]): void;
  /** Keeps the name of an item picked here until the plan names it. */
  remember(hit: SearchHit): void;
}

export function AvoidPicker(props: AvoidPickerProps): ReactElement {
  const { avoid, materials, nameOf, send, remember } = props;
  const set = (next: string[]): void => send([{ op: 'settings', patch: { avoid: next } }]);
  /**
   * Sends the list with `entry` added, a material by its exact name however it was typed (`materialFor`); false when
   * there is nothing to send (`avoidWith`).
   */
  const add = (entry: string): boolean => {
    const next = avoidWith(avoid, materialFor(materials, entry)?.name ?? entry);
    if (next !== null) set(next);
    return next !== null;
  };
  const listed = new Set(avoid);
  return (
    <div className="avoid-picker">
      {avoid.length > 0 && (
        <ul className="avoid-chips">
          {avoid.map((entry) => {
            const label = avoidLabel(entry, materials, nameOf);
            return (
              <li key={entry} className="avoid-chip" data-avoid-entry={entry} title={entry}>
                {isStuffKey(entry) && <ItemIcon itemKey={entry} size={CHIP_ICON_SIZE} name={label} tip={false} />}
                <span className="avoid-chip-name">{label}</span>
                <button type="button" className="avoid-chip-remove" aria-label={`Remove ${label}`} onClick={() => set(avoidWithout(avoid, entry))}>×</button>
              </li>
            );
          })}
        </ul>
      )}
      <MaterialBox materials={materials.filter((m) => !listed.has(m.name))} onAdd={add} />
      <ItemSearch
        placeholder="…or avoid one item or fluid"
        onPick={(hit) => {
          remember(hit);
          add(hit.key);
        }}
      />
      {avoid.length >= MAX_AVOID_ENTRIES && <p className="muted small">{`The list is full (${MAX_AVOID_ENTRIES} entries).`}</p>}
    </div>
  );
}

/** A combobox over the materials not on the list yet; `onAdd` gets the picked material's name, or the text as typed. */
function MaterialBox(props: { materials: readonly AvoidMaterial[]; onAdd(entry: string): boolean }): ReactElement {
  const { materials, onAdd } = props;
  const listId = useId();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const hits = materialSuggestions(materials, text);
  const showList = open && hits.length > 0;
  const current = Math.min(active, hits.length - 1);
  const optionId = (i: number): string => `${listId}-option-${i}`;

  useEffect(() => {
    if (showList && current >= 0) document.getElementById(`${listId}-option-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [showList, current, listId]);

  const commit = (entry: string): void => {
    if (!onAdd(entry)) return;
    setText('');
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (hits.length > 0) setActive(e.key === 'ArrowDown' ? Math.min(current + 1, hits.length - 1) : Math.max(current - 1, 0));
    } else if (e.key === 'Enter' && text.trim() !== '' && !e.nativeEvent.defaultPrevented) {   // not a held Enter's repeat (P2-R69a)
      e.preventDefault();
      // The highlighted material while the list shows, else the text as typed.
      commit((showList ? hits[current]?.name : undefined) ?? text);
    } else if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {
      // a key something has already handled (the shared tooltip's, hiding its tip) is not the list's: one layer per press (R15, P2-R21)
      setOpen(false);
    }
  };

  return (
    <div className="item-search">
      <input
        type="search"
        role="combobox"
        aria-label="Avoid a material"
        placeholder="Avoid a material, e.g. Silver"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? optionId(current) : undefined}
        value={text}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="search-results" role="listbox" id={listId} aria-label="Materials">
          {hits.map((m, i) => (
            <li
              key={m.name}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'search-hit active' : 'search-hit'}
              onMouseDown={(e) => e.preventDefault()}   // keep the focus in the box, so the click still lands here
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(m.name)}
            >
              <span className="search-name">{m.label}</span>
              {m.label !== m.name && <span className="muted small">{m.name}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && text.trim() !== '' && hits.length === 0 && (
        <p className="search-note muted">No material is called that; Enter adds it as typed</p>
      )}
    </div>
  );
}
