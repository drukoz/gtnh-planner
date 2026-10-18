// The Map tab (spec §3.7, §3.4): without a world, a picker of finished scans and their bases; with one, the map of
// the project's base with what the scan found drawn over it (five overlays, each switched on or off per viewer), the
// "Found in world" panel beside it, and numbered note pins anyone can add by clicking the map. Choosing a scan or a
// base sends the `world` op, so the planner counts what that base already has. Plan 5 adds its own overlays and
// markers to the arrays built here.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { MAX_NOTE_LENGTH } from '../../shared/project/apply-op.ts';
import type { WorldScanListItem } from '../../shared/types/api.ts';
import type { Note, Project } from '../../shared/types/project.ts';
import { findBase, type WorldScan, type WorldSource } from '../../shared/types/world.ts';
import { messageOf } from '../api/client.ts';
import { localTime } from '../format.ts';
import { worldApi } from '../map/api.ts';
import { FoundPanel } from '../map/FoundPanel.tsx';
import {
  baseOutlineOverlay, cablesOverlay, logisticsOverlay, machinesOverlay, noteClickOverlay, noteMarkers, numberedPins, storageOverlay,
} from '../map/overlays.ts';
import { summarize } from '../map/summary.ts';
import { tileCache } from '../map/tile-cache.ts';
import type { MapMarker, MapOverlay, MapViewport } from '../map/types.ts';
import { followLink } from '../router.ts';
import { MapView } from './MapView.tsx';
import type { ProjectViewProps } from './project-tabs.ts';

type Send = ProjectViewProps['send'];

/** Which overlays this viewer shows, kept in this browser only. */
export const OVERLAYS_STORAGE_KEY = 'gtnh-planner:map-overlays';
const OVERLAY_TOGGLES = [
  { id: 'machines', label: 'Machines' }, { id: 'cables', label: 'Cables' }, { id: 'logistics', label: 'Logistics' }, { id: 'storage', label: 'Storage' },
  { id: 'outline', label: 'Outline' },
] as const;
type OverlayId = (typeof OVERLAY_TOGGLES)[number]['id'];
type OverlayChoice = Record<OverlayId, boolean>;
const ALL_OVERLAYS: OverlayChoice = { machines: true, cables: true, logistics: true, storage: true, outline: true };
// The panel sits beside the map while both fit, and below it on a narrow screen.
const MAP_STYLE = { flex: '3 1 420px', minWidth: 0, height: 'min(72vh, 760px)', minHeight: 420 } as const;
const PANEL_STYLE = { flex: '1 1 300px', maxWidth: 400, maxHeight: 'min(72vh, 760px)', overflowY: 'auto', paddingRight: 4 } as const;

function loadOverlayChoice(): OverlayChoice {
  const choice = { ...ALL_OVERLAYS };
  try {
    const raw = globalThis.localStorage?.getItem(OVERLAYS_STORAGE_KEY);
    const saved: unknown = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (typeof saved === 'object' && saved !== null) {
      for (const { id } of OVERLAY_TOGGLES) {
        const on = (saved as Record<string, unknown>)[id];
        if (typeof on === 'boolean') choice[id] = on;
      }
    }
  } catch {
    // storage refused or a damaged value: every overlay on
  }
  return choice;
}

function saveOverlayChoice(choice: OverlayChoice): void {
  try {
    globalThis.localStorage?.setItem(OVERLAYS_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // kept for this page only
  }
}

/**
 * A random UUID; crypto.randomUUID exists only on HTTPS and localhost, and friends reach the planner over plain HTTP.
 * The same as NotesView's private helper (a Plan 2 file this task leaves alone).
 */
function newNoteId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sourceText(source: WorldSource): string {
  return source.kind === 'server' ? 'server folder' : source.kind === 'backup' ? `backup ${source.file}` : 'upload';
}

function scanText(s: WorldScanListItem): string {
  return `${s.levelName ?? 'World'} · ${sourceText(s.source)} · ${localTime(s.finishedAt ?? s.startedAt)}`;
}

// ---- Data ----

/** The finished scans, newest first (the server's order). */
function useDoneScans(): { scans: WorldScanListItem[] | null; error: string | null } {
  const [state, setState] = useState<{ scans: WorldScanListItem[] | null; error: string | null }>({ scans: null, error: null });
  useEffect(() => {
    let live = true;
    worldApi.scans().then(
      (list) => {
        if (live) setState({ scans: list.filter((s) => s.state === 'done'), error: null });
      },
      (err: unknown) => {
        if (live) setState({ scans: [], error: messageOf(err) });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The last scan loaded on this page: a finished scan never changes, so coming back to the tab needs no new fetch. */
let lastScan: WorldScan | null = null;

/** Scan `id` (null: none), loaded from the server. */
function useScan(id: string | null): { scan: WorldScan | null; error: string | null } {
  const cachedFor = (want: string | null): WorldScan | null => (lastScan !== null && lastScan.id === want ? lastScan : null);
  const [state, setState] = useState<{ id: string; scan: WorldScan | null; error: string | null } | null>(() => {
    const cached = cachedFor(id);
    return cached === null ? null : { id: cached.id, scan: cached, error: null };
  });
  useEffect(() => {
    if (id === null) return;
    const cached = cachedFor(id);
    if (cached !== null) {
      setState((s) => (s?.scan === cached ? s : { id, scan: cached, error: null }));
      return;
    }
    let live = true;
    worldApi.scan(id).then(
      (scan) => {
        lastScan = scan;
        if (live) setState({ id, scan, error: null });
      },
      (err: unknown) => {
        if (live) setState({ id, scan: null, error: messageOf(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  return state === null || state.id !== id ? { scan: null, error: null } : { scan: state.scan, error: state.error };
}

// ---- Choosing a scan and a base ----

/**
 * A select with a label beside it rather than around it, so the label's text is exactly `label`: a wrapping label also
 * holds the options' text, and label lookups (Playwright's `getByLabel`) would match on that too.
 */
function SelectField(props: { label: string; value: string; onChange(value: string): void; children: ReactNode }): ReactElement {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>{props.children}</select>
    </div>
  );
}

/** The "World scan" select; `current` is the project's scan, listed even when it is not among the finished ones. */
function ScanSelect(props: {
  scans: WorldScanListItem[] | null; value: string; current?: { id: string; label: string }; emptyLabel: string; onChange(id: string): void;
}): ReactElement {
  const { scans, value, current, emptyLabel, onChange } = props;
  const listed = scans ?? [];
  return (
    <SelectField label="World scan" value={value} onChange={onChange}>
      <option value="">{scans === null ? 'Loading the scans…' : emptyLabel}</option>
      {current !== undefined && !listed.some((s) => s.id === current.id) && <option value={current.id}>{current.label}</option>}
      {listed.map((s) => <option key={s.id} value={s.id}>{scanText(s)}</option>)}
    </SelectField>
  );
}

function WorldLink(): ReactElement {
  return <a href="/world" onClick={(e) => followLink(e, '/world')}>Scan the world</a>;
}

/** No world yet: pick a finished scan, then one of its bases. */
function WorldPicker(props: { scans: WorldScanListItem[] | null; scansError: string | null; send: Send }): ReactElement {
  const { scans, scansError, send } = props;
  const [scanId, setScanId] = useState('');
  const [baseId, setBaseId] = useState('');
  const picked = useScan(scanId === '' ? null : scanId);
  const bases = picked.scan?.bases ?? [];
  const base = bases.find((b) => b.id === baseId) ?? bases[0] ?? null;
  return (
    <div className="map-picker" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
      <h2 style={{ margin: 0 }}>Choose a world scan</h2>
      <p className="muted" style={{ margin: 0 }}>
        Pick a finished scan and the base this line is for. The plan then counts the machines and storage already there, and the map shows them.
      </p>
      {scansError !== null && <p className="error">{`Could not list the scans: ${scansError}`}</p>}
      <ScanSelect
        scans={scans}
        value={scanId}
        emptyLabel={scans?.length === 0 ? 'No finished scans yet' : 'Choose a scan…'}
        onChange={(id) => {
          setScanId(id);
          setBaseId('');
        }}
      />
      {picked.error !== null && <p className="error">{`Could not load that scan: ${picked.error}`}</p>}
      {scanId !== '' && picked.scan === null && picked.error === null && <p className="muted">Loading the scan…</p>}
      {picked.scan !== null && (bases.length === 0 ? (
        <p className="muted">This scan found no bases; the map then shows the whole Overworld and the plan counts the whole world.</p>
      ) : (
        <SelectField label="Base" value={base?.id ?? ''} onChange={setBaseId}>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
      ))}
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <button
          type="button"
          className="primary"
          disabled={picked.scan === null}
          onClick={() => send([{ op: 'world', scanId, baseId: base?.id ?? null }])}
        >
          {picked.scan !== null && base === null ? 'Use this scan' : 'Use this base'}
        </button>
        <WorldLink />
      </div>
    </div>
  );
}

// ---- The map ----

interface Pick { dim: number; x: number; y: number; z: number }

function NoteDialog(props: { pin: Pick; onSave(text: string): void; onCancel(): void }): ReactElement {
  const { pin, onSave, onCancel } = props;
  const [text, setText] = useState('');
  const where = `${pin.x}, ${pin.y}, ${pin.z}`;
  const save = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (text.trim() !== '') onSave(text.trim());
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      {/* The accessible name avoids the word "note": the text field is the one thing labelled "Note" (ruling M-R5). */}
      <form className="modal" role="dialog" aria-modal="true" aria-label={`Pin at ${where}`} onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>{`Add note at ${where}`}</h2>
        <label className="field">
          <span>Note</span>
          <textarea autoFocus rows={3} maxLength={MAX_NOTE_LENGTH} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={text.trim() === ''}>Save note</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** A place the viewer asked to see (a note or a storage block), for one scan and base. */
interface Spot { key: string; dim: number; x: number; z: number }

function ScanMap(props: { project: Project; scan: WorldScan; scans: WorldScanListItem[] | null; send: Send }): ReactElement {
  const { project, scan, scans, send } = props;
  const { baseId } = project.world;
  const logistics = project.settings.logistics;
  const base = findBase(scan, baseId);
  const summary = useMemo(() => summarize(scan, baseId, logistics), [scan, baseId, logistics]);

  const [choice, setChoice] = useState(loadOverlayChoice);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [focusedNote, setFocusedNote] = useState<number | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const lastView = useRef<MapViewport | null>(null);

  const spotKey = `${scan.id}|${base?.id ?? ''}`;
  const shown = spot !== null && spot.key === spotKey ? spot : null;   // another scan or base starts at its centre again
  const dim = shown?.dim ?? base?.dim ?? 0;
  const focus: [number, number] | undefined = shown !== null
    ? [shown.x + 0.5, shown.z + 0.5]
    : base !== null ? [base.center[0] + 0.5, base.center[2] + 0.5] : undefined;   // the middle of a block, not its edge

  const found = useMemo(
    () => ({ machines: machinesOverlay(scan), cables: cablesOverlay(scan), logistics: logisticsOverlay(scan), storage: storageOverlay(scan) }),
    [scan],
  );
  const outline = useMemo(() => (base === null ? null : baseOutlineOverlay(base)), [base]);
  // One click overlay per scan, so a press and its release always reach the same one; it also keeps the view it was
  // last drawn in, whose Y level stands in when the surface height of the clicked column is not loaded (ruling M-R4).
  const noteClick = useMemo((): MapOverlay => {
    const click = noteClickOverlay((x, z) => {
      const v = lastView.current;
      if (v === null) return;
      setPick({ dim: v.dim, x, y: tileCache.surfaceY(scan.id, v.dim, x, z) ?? v.y, z });
    });
    return { ...click, draw: (_ctx, v) => { lastView.current = v; } };
  }, [scan.id]);
  const overlays = useMemo(() => {
    const list: MapOverlay[] = [];
    for (const { id } of OVERLAY_TOGGLES) {
      const overlay = id === 'outline' ? outline : found[id];
      if (choice[id] && overlay !== null) list.push(overlay);
    }
    list.push(noteClick);   // last: it sees a click first
    return list;
  }, [choice, found, outline, noteClick]);
  const markers: MapMarker[] = useMemo(() => noteMarkers(project.notes, dim), [project.notes, dim]);

  const toggle = (id: OverlayId, on: boolean): void => {
    const next = { ...choice, [id]: on };
    setChoice(next);
    saveOverlayChoice(next);
  };
  const focusNote = (n: number): void => {
    const pinned = numberedPins(project.notes).find((p) => p.n === n);
    if (pinned === undefined) return;
    setFocusedNote(n);
    setSpot({ key: spotKey, dim: pinned.note.pin.dim, x: pinned.note.pin.x, z: pinned.note.pin.z });
  };
  const saveNote = (text: string): void => {
    if (pick === null) return;
    const note: Omit<Note, 'by' | 'at'> = { id: newNoteId(), text, pin: { dim: pick.dim, x: pick.x, y: pick.y, z: pick.z } };
    send([{ op: 'addNote', note }]);
    setPick(null);
  };

  return (
    <div className="map-tab" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <ScanSelect
          scans={scans}
          value={scan.id}
          current={{ id: scan.id, label: `${scan.levelName} · ${sourceText(scan.source)} · ${localTime(scan.scannedAt)}` }}
          emptyLabel="None: plan without the world"
          onChange={(id) => send([{ op: 'world', scanId: id === '' ? null : id, baseId: id === '' ? null : baseId }])}
        />
        <SelectField label="Base" value={base?.id ?? ''} onChange={(id) => send([{ op: 'world', scanId: scan.id, baseId: id === '' ? null : id }])}>
          {base === null && <option value="">{scan.bases.length === 0 ? 'No bases found' : 'Choose a base…'}</option>}
          {scan.bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
        <fieldset className="row" style={{ border: 'none', margin: 0, padding: 0, gap: 12, flexWrap: 'wrap' }}>
          <legend className="visually-hidden">Map layers</legend>
          {OVERLAY_TOGGLES.map(({ id, label }) => (
            <label key={id} className="check">
              <input type="checkbox" checked={choice[id]} onChange={(e) => toggle(id, e.currentTarget.checked)} />
              {label}
            </label>
          ))}
        </fieldset>
        {shown !== null && base !== null && <button type="button" className="small" onClick={() => setSpot(null)}>Back to the base</button>}
        <WorldLink />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        <div style={MAP_STYLE}>
          <MapView scanId={scan.id} dim={dim} focus={focus} overlays={overlays} markers={markers} onMarkerClick={(m) => setFocusedNote(m.n ?? null)} />
        </div>
        <aside aria-label="Found in world" style={PANEL_STYLE}>
          <FoundPanel
            summary={summary}
            notes={project.notes}
            onFocusNote={focusNote}
            focusedNote={focusedNote}
            onShowOnMap={(pos) => setSpot({ key: spotKey, dim: base?.dim ?? dim, x: pos[0], z: pos[2] })}
          />
        </aside>
      </div>
      {pick !== null && <NoteDialog pin={pick} onSave={saveNote} onCancel={() => setPick(null)} />}
    </div>
  );
}

/** The project's world scan, loaded; while it loads or when it cannot be loaded, the scan can still be changed. */
function ProjectMap(props: { project: Project; scanId: string; scans: WorldScanListItem[] | null; send: Send }): ReactElement {
  const { project, scanId, scans, send } = props;
  const loaded = useScan(scanId);
  if (loaded.scan !== null) return <ScanMap project={project} scan={loaded.scan} scans={scans} send={send} />;
  return (
    <div className="map-tab" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
      {loaded.error === null ? <p className="muted">Loading the world scan…</p> : <p className="error">{`Could not load the world scan: ${loaded.error}`}</p>}
      {loaded.error !== null && (
        <>
          <ScanSelect
            scans={scans}
            value={scanId}
            current={{ id: scanId, label: scanId }}
            emptyLabel="None: plan without the world"
            onChange={(id) => send([{ op: 'world', scanId: id === '' ? null : id, baseId: id === '' ? null : project.world.baseId }])}
          />
          <WorldLink />
        </>
      )}
    </div>
  );
}

export function MapTab(props: ProjectViewProps): ReactElement {
  const { project, send } = props;
  const { scans, error } = useDoneScans();
  const { scanId } = project.world;
  if (scanId === null) return <WorldPicker scans={scans} scansError={error} send={send} />;
  return <ProjectMap project={project} scanId={scanId} scans={scans} send={send} />;
}
