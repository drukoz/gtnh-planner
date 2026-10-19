// The Map tab's side panel (spec §3.7, §3.4, §3.5): what the scan found at the base, the world's dimensions, the
// prospected veins near it and the numbered note pins. Every section is optional and says "None found" when empty;
// "Scan notes" (what the scan could not read or work out) comes first and only when there is something to say.
// Items show their pack name once `GET /api/pack/stuff/:key` answers (asked once per key per page), the key until then.

import { useEffect, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import type { StuffKey } from '../../shared/keys.ts';
import { tierName } from '../../shared/gt/tiers.ts';
import type { StuffInfo } from '../../shared/types/api.ts';
import type { Note } from '../../shared/types/project.ts';
import type { LogisticsNetwork, StorageBlock } from '../../shared/types/world.ts';
import { apiGet } from '../api/client.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { numberedPins } from './overlays.ts';
import { dimLabel } from './render.ts';
import type { FoundSummary } from './summary.ts';

/** Item rows shown before "Show all <n> items". */
export const ITEMS_PAGE = 10;
const ICON_SIZE = 20;
const NONE = 'None found';
const RAIN_CAVEAT = 'Estimates from what is built; solar boilers stop ≈7 min into rain.';

const LOGISTICS_LABELS: Readonly<Record<LogisticsNetwork['kind'], string>> = {
  routed: 'Routed network', enderio: 'EnderIO conduits', gtpipe: 'GT pipes', ae2: 'AE2 network',
};
const STORAGE_LABELS: Readonly<Record<StorageBlock['kind'], string>> = {
  drawer_controller: 'drawer controller', drawer: 'drawer', barrel: 'JABBA barrel', chest: 'chest', iron_chest: 'iron chest', gt_chest: 'GT chest',
  gt_tank: 'GT tank', ae2_drive: 'AE2 drive',
};

const int = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
/** EU/t to 0.1, without a "-0". */
const eut = (n: number): string => `${n.toLocaleString('en-US', { maximumFractionDigits: 1, signDisplay: 'negative' })} EU/t`;
const plural = (n: number, word: string): string => `${int(n)} ${word}${n === 1 ? '' : 's'}`;
const posText = (p: readonly number[]): string => p.join(' ');

// ---- Item names, shared by every panel on the page ----

const itemNames = new Map<StuffKey, string>();
const askedNames = new Set<StuffKey>();
const nameListeners = new Set<() => void>();
let namesVersion = 0;

function subscribeNames(fn: () => void): () => void {
  nameListeners.add(fn);
  return () => nameListeners.delete(fn);
}

const namesSnapshot = (): number => namesVersion;

function askName(key: StuffKey): void {
  if (askedNames.has(key)) return;
  askedNames.add(key);
  apiGet<StuffInfo>(`/api/pack/stuff/${encodeURIComponent(key)}`).then(
    (info) => {
      itemNames.set(key, info.name);
      namesVersion++;
      for (const fn of [...nameListeners]) fn();
    },
    () => {},   // a key the pack cannot name (or no export) keeps showing the key
  );
}

/** The pack names known so far; asks for the names of `keys` it does not have yet (also the map's hover tooltip). */
export function useItemNames(keys: readonly StuffKey[]): ReadonlyMap<StuffKey, string> {
  useSyncExternalStore(subscribeNames, namesSnapshot, namesSnapshot);
  const wanted = keys.join('\n');
  useEffect(() => {
    for (const key of wanted === '' ? [] : wanted.split('\n')) askName(key);
  }, [wanted]);
  return itemNames;
}

// ---- Sections ----

/** A titled section; when `empty`, "None found" (and `hint`) instead of its content. */
function Section(props: { title: string; empty: boolean; hint?: string; children?: ReactNode }): ReactElement {
  return (
    <section className="found-section" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{props.title}</h3>
      {props.empty ? <p className="muted small" style={{ margin: 0 }}>{props.hint === undefined ? NONE : `${NONE}. ${props.hint}`}</p> : props.children}
    </section>
  );
}

const LIST_STYLE = { margin: 0, paddingLeft: 18 } as const;

/**
 * What the scan could not read or work out, so the counts and the power estimate below are read with it in mind
 * (spec §3.5). Nothing when there is nothing to say. Plain text only, no accessible label: the note dialog's text
 * field is the one thing on the Map tab labelled "Note" (ruling M-R5).
 */
function ScanNotes(props: { notes: readonly string[] }): ReactElement | null {
  if (props.notes.length === 0) return null;
  return (
    <Section title="Scan notes" empty={false}>
      <ul className="small" data-testid="scan-notes" style={LIST_STYLE}>
        {props.notes.map((note, i) => <li key={`${i}|${note}`}>{note}</li>)}
      </ul>
    </Section>
  );
}

function Machines(props: { summary: FoundSummary }): ReactElement {
  const { machineCount, topTier, machines } = props.summary;
  return (
    <Section title="Machines" empty={machineCount === 0}>
      <p style={{ margin: 0 }}>
        <span data-testid="machine-count">{int(machineCount)}</span>
        {` ${machineCount === 1 ? 'machine' : 'machines'}`}
        {` · Top tier: ${topTier === null ? 'unknown' : tierName(topTier)}`}
      </p>
      <ul className="small" style={LIST_STYLE}>
        {machines.map((m) => <li key={`${m.tier}|${m.name}`}>{`${int(m.count)} × ${m.name}${m.tier === null ? '' : ` (${tierName(m.tier)})`}`}</li>)}
      </ul>
    </Section>
  );
}

function Power(props: { power: FoundSummary['power'] }): ReactElement {
  const { power } = props;
  return (
    <Section title="Power" empty={power.length === 0}>
      <ul className="small" style={LIST_STYLE}>
        {power.map((p) => (
          <li key={p.id}>
            <strong>{`${tierName(p.voltageTier)} network`}</strong>
            <div>{`Clear ${eut(p.clear)} · Rain ${eut(p.rain)} · Average ${eut(p.average)}`}</div>
            <div>{`Stored ${int(p.storedEU)} of ${int(p.capacityEU)} EU · Spare ${eut(p.spare)}`}</div>
          </li>
        ))}
      </ul>
      <p className="muted small" style={{ margin: 0 }}>{RAIN_CAVEAT}</p>
    </Section>
  );
}

function Logistics(props: { logistics: FoundSummary['logistics'] }): ReactElement {
  const { logistics } = props;
  return (
    <Section title="Logistics" empty={logistics.length === 0}>
      <ul className="small" style={LIST_STYLE}>
        {logistics.map((n) => (
          <li key={n.id}>
            <strong>{LOGISTICS_LABELS[n.kind]}</strong>
            {`: ${plural(n.nodes, 'block')}${n.channels === null ? '' : ` · channels ${n.channels}`}`}
            {n.parts !== null && <div className="muted">{n.parts}</div>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ItemRow(props: { item: FoundSummary['storage']['items'][number]; name: string; onShowOnMap?: (pos: [number, number, number]) => void }): ReactElement {
  const { item, name, onShowOnMap } = props;
  return (
    <li data-key={item.key}>
      <details>
        <summary style={{ cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
            <ItemIcon itemKey={item.key} size={ICON_SIZE} name={name} />
            <span style={{ overflowWrap: 'anywhere' }}>{name}</span>
          </span>
          {` · ${int(item.total)} · `}
          <span className="muted">{`${int(item.reachable)} reachable`}</span>
        </summary>
        <ul style={LIST_STYLE}>
          {item.where.map((w) => (
            <li key={posText(w.pos)}>
              {`${int(w.count)} in ${STORAGE_LABELS[w.kind]} at ${posText(w.pos)}${w.reachable ? '' : ' (not reachable)'}`}
              {onShowOnMap !== undefined && (
                <>
                  {' '}
                  <button type="button" className="small" onClick={() => onShowOnMap(w.pos)}>show on map</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function Storage(props: { storage: FoundSummary['storage']; showAll: boolean; onShowAll: () => void; onShowOnMap?: (pos: [number, number, number]) => void }): ReactElement {
  const { storage, showAll, onShowAll, onShowOnMap } = props;
  const items = showAll ? storage.items : storage.items.slice(0, ITEMS_PAGE);
  const names = useItemNames(items.map((i) => i.key));
  return (
    <Section title="Storage" empty={storage.blocks.length === 0 && storage.items.length === 0}>
      {storage.blocks.length > 0 && (
        <ul className="small" style={LIST_STYLE}>
          {storage.blocks.map((b) => (
            <li key={b.kind}>{`${plural(b.count, STORAGE_LABELS[b.kind])}${b.unknown === 0 ? '' : ` (${int(b.unknown)} with contents unknown)`}`}</li>
          ))}
          {storage.barrelBanks.map((bank) => (
            <li key={posText(bank.pos)}>{`JABBA bank: ${plural(bank.barrels, 'barrel')} at ${posText(bank.pos)}`}</li>
          ))}
        </ul>
      )}
      {storage.items.length > 0 && (
        <ul className="small" style={{ ...LIST_STYLE, listStyle: 'none', paddingLeft: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((item) => <ItemRow key={item.key} item={item} name={names.get(item.key) ?? item.key} onShowOnMap={onShowOnMap} />)}
        </ul>
      )}
      {!showAll && storage.items.length > ITEMS_PAGE && (
        <button type="button" className="small" style={{ alignSelf: 'flex-start' }} onClick={onShowAll}>{`Show all ${int(storage.items.length)} items`}</button>
      )}
    </Section>
  );
}

function Dimensions(props: { dims: FoundSummary['dims'] }): ReactElement {
  const { dims } = props;
  return (
    <Section title="Dimensions" empty={dims.length === 0}>
      <ul className="small" style={LIST_STYLE}>
        {dims.map((d) => (
          <li key={d.name}>{`${d.name}: ${d.visited ? 'visited' : 'not visited'}${d.evidence.length === 0 ? '' : ` (${d.evidence.join(', ')})`}`}</li>
        ))}
      </ul>
    </Section>
  );
}

function Veins(props: { prospected: FoundSummary['prospected'] }): ReactElement {
  const { prospected } = props;
  return (
    <Section title="Prospected veins" empty={prospected.length === 0}>
      <ul className="small" style={LIST_STYLE}>
        {prospected.map((v) => <li key={`${v.vein}|${v.x}|${v.z}`}>{`${v.vein} at ${v.x} ${v.z} · ${plural(v.distance, 'block')} away`}</li>)}
      </ul>
    </Section>
  );
}

function Notes(props: { notes: readonly Note[]; focusedNote: number | null; onFocusNote: (n: number) => void }): ReactElement {
  const pins = numberedPins(props.notes);
  const { focusedNote, onFocusNote } = props;
  useEffect(() => {
    if (focusedNote !== null) document.getElementById(`found-note-${focusedNote}`)?.scrollIntoView({ block: 'nearest' });
  }, [focusedNote]);
  return (
    <Section title="Notes" empty={pins.length === 0} hint="Click the map to pin a note there.">
      <ol className="small" style={{ ...LIST_STYLE, listStyle: 'none', paddingLeft: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {pins.map(({ n, note }) => (
          <li key={note.id} id={`found-note-${n}`} data-testid={`note-${n}`} aria-current={n === focusedNote ? 'true' : undefined}>
            <button
              type="button"
              className="small"
              style={{ width: '100%', textAlign: 'left', ...(n === focusedNote ? { borderColor: 'var(--accent)', background: 'var(--surface-2)' } : {}) }}
              onClick={() => onFocusNote(n)}
            >
              {/* N<n>, as the map draws note pins: a plain number is a layout pin (a build step's "pin 1") */}
              <span className="badge">{`N${n}`}</span>
              {` ${note.text} `}
              <span className="muted">{`at ${note.pin.x} ${note.pin.y} ${note.pin.z} (${dimLabel(note.pin.dim)})`}</span>
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export interface FoundPanelProps {
  summary: FoundSummary; notes: Note[]; onFocusNote: (n: number) => void;
  /** The note pin to highlight (a marker the map was clicked on). */
  focusedNote?: number | null;
  /** Shows a "show on map" button on each place an item sits. */
  onShowOnMap?: (pos: [number, number, number]) => void;
}

export function FoundPanel(props: FoundPanelProps): ReactElement {
  const { summary, notes, onFocusNote, onShowOnMap } = props;
  const [showAllItems, setShowAllItems] = useState(false);
  return (
    <div className="found-panel" data-testid="found-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScanNotes notes={summary.scanNotes} />
      <Machines summary={summary} />
      <Power power={summary.power} />
      <Logistics logistics={summary.logistics} />
      <Storage storage={summary.storage} showAll={showAllItems} onShowAll={() => setShowAllItems(true)} onShowOnMap={onShowOnMap} />
      <Dimensions dims={summary.dims} />
      <Veins prospected={summary.prospected} />
      <Notes notes={notes} focusedNote={props.focusedNote ?? null} onFocusNote={onFocusNote} />
    </div>
  );
}
