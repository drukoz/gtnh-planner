// Search box over every item and fluid in the pack (spec §3.2, "works like NEI search"): typing waits 200 ms, then asks
// the server; the answers are a listbox picked with the mouse or with the arrow keys and Enter. Only the answer to the
// latest text is shown.

import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { SearchHit } from '../../shared/types/pack.ts';
import { apiGet, messageOf } from '../api/client.ts';
import { ItemIcon } from './ItemIcon.tsx';

const SEARCH_DELAY_MS = 200;
const SEARCH_LIMIT = 20;
/** The placeholder, and so the name, of a search box that asks for none: the Make section's, which the page finds the picker of what to make by. */
export const ITEM_SEARCH_PLACEHOLDER = 'Search items and fluids';

export function ItemSearch(props: { onPick(hit: SearchHit): void; placeholder?: string }): ReactElement {
  const { onPick } = props;
  const placeholder = props.placeholder ?? ITEM_SEARCH_PLACEHOLDER;
  const listId = useId();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const wanted = query.trim();

  useEffect(() => {
    if (wanted === '') {
      setResult(null);
      setError(null);
      return;
    }
    let live = true;   // false once the text changed again: a slower, older answer is dropped
    const timer = setTimeout(() => {
      apiGet<SearchHit[]>(`/api/pack/search?q=${encodeURIComponent(wanted)}&limit=${SEARCH_LIMIT}`).then(
        (hits) => {
          if (!live) return;
          setResult({ query: wanted, hits });
          setActive(hits.length > 0 ? 0 : -1);
          setError(null);
        },
        (err: unknown) => {
          if (live) setError(messageOf(err));
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wanted]);

  // The previous answer stays on screen while the next one is on its way; Enter waits for the answer to this text.
  const hits = wanted === '' ? [] : result?.hits ?? [];
  const fresh = result?.query === wanted;
  const showList = open && hits.length > 0;
  const optionId = (i: number): string => `${listId}-option-${i}`;

  useEffect(() => {
    if (showList && active >= 0) document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [showList, active, listId]);

  const pick = (hit: SearchHit): void => {
    setQuery('');
    setResult(null);
    setActive(-1);
    onPick(hit);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (hits.length > 0) setActive((i) => (e.key === 'ArrowDown' ? Math.min(i + 1, hits.length - 1) : Math.max(i - 1, 0)));
    } else if (e.key === 'Enter' && !e.nativeEvent.defaultPrevented) {   // a held Enter's repeat that landed here is not a pick (P2-R69a)
      const hit = showList && fresh ? hits[Math.max(active, 0)] : undefined;
      if (hit !== undefined) {
        e.preventDefault();
        pick(hit);
      }
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
        aria-label={placeholder}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="search-results" role="listbox" id={listId} aria-label="Matches">
          {hits.map((hit, i) => (
            <li
              key={hit.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'search-hit active' : 'search-hit'}
              onMouseDown={(e) => e.preventDefault()}   // keep the focus in the box, so the click still lands here
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(hit)}
            >
              <ItemIcon itemKey={hit.key} size={20} name={hit.name} />
              <span className="search-name">{hit.name}</span>
              {hit.kind === 'fluid' && <span className="badge">fluid</span>}
              {!hit.produced && <span className="badge muted">nothing makes this</span>}
            </li>
          ))}
        </ul>
      )}
      {open && fresh && hits.length === 0 && error === null && (
        <p className="search-note muted">No item or fluid matches</p>
      )}
      {error !== null && wanted !== '' && <p className="search-note error">{error}</p>}
    </div>
  );
}
