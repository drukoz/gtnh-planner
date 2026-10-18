// The World page (spec §3.4, §6; architecture §11.10, §11.12): scan the server folder (its newest complete backup or
// one chosen backup), follow every scan, and upload a world from a friend's computer. A picked folder or zip is read in
// this browser; only level.dat and region files are ever sent (never the whole folder, never a zip, never a player
// file). The smart upload comes first: it sends only the chunks around players, spawn, claims and lived-in chunks, a
// few MB of a ~1 GB world; "Advanced: whole dimensions" sends whole dimensions instead.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import type { WorldScanListItem, WorldSourcesResponse } from '../../shared/types/api.ts';
import type { WorldSource } from '../../shared/types/world.ts';
import { messageOf } from '../api/client.ts';
import { localTime } from '../format.ts';
import { worldApi } from '../map/api.ts';
import { browserInflate } from '../world/inflate.ts';
import { dimLabel, pickWorldFiles, selectDims, type WorldPick } from '../world/pick-files.ts';
import { findHotspots, formatSize, planSmartUpload, plural, SMART_RADIUS, type Hotspot, type ReadFile, type SmartPlan } from '../world/smart.ts';
import { uploadWorld, type UploadItem, type UploadProgress } from '../world/upload.ts';
import { sourceText } from './MapTab.tsx';
import { SmartUploadPanel } from './SmartUploadPanel.tsx';

/** How often the scan list is asked again while a scan is queued or running. */
const POLL_MS = 1000;

function Section(props: { title: string; children: ReactNode }): ReactElement {
  const id = useId();
  return (
    <section className="card" aria-labelledby={id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 id={id} style={{ margin: 0 }}>{props.title}</h2>
      {props.children}
    </section>
  );
}

// ---- Scans ----

/** The server's scan list (newest first), asked again every POLL_MS while a scan is queued or running. */
function useScans(): { scans: WorldScanListItem[] | null; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ scans: WorldScanListItem[] | null; error: string | null; answers: number }>({ scans: null, error: null, answers: 0 });
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    worldApi.scans().then(
      (scans) => {
        if (live) setState((s) => ({ scans, error: null, answers: s.answers + 1 }));
      },
      (err: unknown) => {
        if (live) setState((s) => ({ ...s, error: messageOf(err), answers: s.answers + 1 }));
      },
    );
    return () => {
      live = false;
    };
  }, [asked]);
  const active = state.scans?.some((s) => s.state === 'queued' || s.state === 'running') ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setAsked((n) => n + 1), POLL_MS);   // armed again after every answer
    return () => clearTimeout(timer);
  }, [active, state.answers]);
  const reload = useCallback(() => setAsked((n) => n + 1), []);
  return { scans: state.scans, error: state.error, reload };
}

const STATE_TEXT: Record<WorldScanListItem['state'], string> = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed' };

function ScanRow(props: { scan: WorldScanListItem; onCancel(id: string): void }): ReactElement {
  const { scan, onCancel } = props;
  const active = scan.state === 'queued' || scan.state === 'running';
  const state = STATE_TEXT[scan.state];
  return (
    <li className="card" data-testid="scan-row" data-state={scan.state} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 12 }}>
        {!scan.message.startsWith(state) && <strong>{state}</strong>}{/* "Queued" and "Done: …" say it already */}
        <span>{localTime(scan.startedAt)}</span>
        <span className="muted">{scan.levelName === null ? sourceText(scan.source) : `${scan.levelName} · ${sourceText(scan.source)}`}</span>
        {active && <button type="button" className="small" style={{ marginLeft: 'auto' }} onClick={() => onCancel(scan.id)}>Cancel</button>}
      </div>
      <progress max={1} value={scan.progress} aria-label={`${state}, ${Math.round(scan.progress * 100)}%`} style={{ width: '100%' }} />
      <span className={scan.state === 'failed' ? 'error' : 'muted'}>{scan.message}</span>
    </li>
  );
}

export function ScanList(props: { scans: WorldScanListItem[] | null; error: string | null; onCancel(id: string): void }): ReactElement {
  const { scans, error, onCancel } = props;
  return (
    <>
      {error !== null && <p className="error" role="alert">{`Could not list the scans: ${error}`}</p>}
      {scans === null ? (
        error === null && <p className="muted">Loading the scans…</p>
      ) : scans.length === 0 ? (
        <p className="muted">No scans yet. Scan the server folder or upload a world below.</p>
      ) : (
        <ul className="cards" style={{ margin: 0 }}>
          {scans.map((s) => <ScanRow key={s.id} scan={s} onCancel={onCancel} />)}
        </ul>
      )}
    </>
  );
}

// ---- Server folder ----

function useSources(): { sources: WorldSourcesResponse | null; error: string | null } {
  const [state, setState] = useState<{ sources: WorldSourcesResponse | null; error: string | null }>({ sources: null, error: null });
  useEffect(() => {
    let live = true;
    worldApi.sources().then(
      (sources) => {
        if (live) setState({ sources, error: null });
      },
      (err: unknown) => {
        if (live) setState({ sources: null, error: messageOf(err) });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function ServerFolder(props: { onStarted(): void }): ReactElement {
  const { onStarted } = props;
  const { sources, error } = useSources();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const start = (source: WorldSource): void => {
    setStarting(true);
    setStartError(null);
    worldApi.start(source).then(
      () => {
        setStarting(false);
        onStarted();
      },
      (err: unknown) => {
        setStarting(false);
        setStartError(`Could not start the scan: ${messageOf(err)}`);
      },
    );
  };
  let body: ReactNode;
  if (error !== null) body = <p className="error">{`Could not read the server folder: ${error}`}</p>;
  else if (sources === null) body = <p className="muted">Loading…</p>;
  else if (!sources.server) {
    body = <p className="muted">No server folder configured — set <code>serverFolder</code> in <code>data/config.json</code>, or upload below.</p>;
  } else {
    const [newest] = sources.backups;
    body = (
      <>
        <div className="row" style={{ gap: 12 }}>
          <button type="button" className="primary" disabled={starting} onClick={() => start({ kind: 'server' })}>Scan newest backup</button>
          <span className="muted">
            {newest === undefined ? 'No complete backup yet: the scan copies the world folder and reads the copy.' : `Reads ${newest}, the newest complete backup.`}
          </span>
        </div>
        {sources.backups.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sources.backups.map((file) => (   // newest first, as the server lists them
              <li key={file} className="row" style={{ gap: 12 }}>
                <span>{file}</span>
                <button type="button" className="small" disabled={starting} aria-label={`Scan ${file}`} onClick={() => start({ kind: 'backup', file })}>Scan</button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return (
    <Section title="Server folder">
      {body}
      {startError !== null && <p className="error" role="alert">{startError}</p>}
    </Section>
  );
}

// ---- Upload ----

export interface UploadState { running: boolean; progress: UploadProgress | null; error: string | null; outcome: string | null }

const IDLE_UPLOAD: UploadState = { running: false, progress: null, error: null, outcome: null };

/** The running upload's progress and Stop button, or how the last one ended; nothing before the first upload. */
export function UploadStatus(props: { upload: UploadState; onStop(): void }): ReactElement | null {
  const { upload: { running, progress, error, outcome }, onStop } = props;
  if (!running && error === null && outcome === null) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {running && (progress === null ? <span className="muted">Starting the upload…</span> : (
        <>
          <progress max={progress.bytesTotal} value={progress.bytesDone} aria-label="Upload progress" style={{ width: '100%' }} />
          <span className="muted">
            {`${progress.done} of ${plural(progress.total, 'file')}, ${formatSize(progress.bytesDone)} of ${formatSize(progress.bytesTotal)} — sending ${progress.current}`}
          </span>
        </>
      ))}
      {running && <div><button type="button" className="small" onClick={onStop}>Stop upload</button></div>}
      {error !== null && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      {outcome !== null && <p role="status" style={{ margin: 0 }}>{outcome}</p>}
    </div>
  );
}

/** "Advanced: whole dimensions": level.dat plus every region file of the ticked dimensions, sent whole. */
export function WholeDimensions(props: {
  pick: WorldPick; chosen: readonly number[]; upload: UploadState; onChoose(dims: number[]): void; onUpload(): void; onStop(): void;
}): ReactElement {
  const { pick, chosen, upload, onChoose, onUpload, onStop } = props;
  const files = selectDims(pick, [...chosen]);
  const regionFiles = files.filter((f) => f.dim !== null).length;
  const bytes = files.reduce((n, f) => n + f.size, 0);
  const toggle = (dim: number, on: boolean): void => onChoose(on ? [...chosen, dim].sort((a, b) => a - b) : chosen.filter((d) => d !== dim));
  return (
    <details>
      <summary style={{ cursor: 'pointer' }}>Advanced: whole dimensions</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <p className="muted" style={{ margin: 0 }}>Sends level.dat and every region file of the dimensions you tick, unchanged. Player files are never sent.</p>
        {pick.dims.length === 0 ? <p className="muted">There are no region files next to level.dat.</p> : (
          <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <legend className="visually-hidden">Dimensions to upload</legend>
            {pick.dims.map((d) => (
              <label key={d.dim} className="check">
                <input type="checkbox" checked={chosen.includes(d.dim)} disabled={upload.running} onChange={(e) => toggle(d.dim, e.currentTarget.checked)} />
                {dimLabel(d.dim)} <span className="muted">{`${plural(d.files, 'file')}, ${formatSize(d.bytes)}`}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p style={{ margin: 0 }}>{`Total: level.dat and ${plural(regionFiles, 'region file')}, ${formatSize(bytes)}`}</p>
        <div>
          <button type="button" className="primary" disabled={upload.running || regionFiles === 0} data-testid="upload-dims-button" onClick={onUpload}>
            Upload whole dimensions and scan
          </button>
        </div>
        <UploadStatus upload={upload} onStop={onStop} />
      </div>
    </details>
  );
}

/** A picked folder or zip: what it holds and the bytes of one of its files, read only when asked. */
interface PickedWorld { label: string; pick: WorldPick; blob(path: string): Promise<Blob>; close(): Promise<void> }

const notPicked = (path: string): Error => new Error(`${path} is not in the picked files`);

function folderWorld(files: readonly File[]): PickedWorld {
  const byPath = new Map<string, File>();
  for (const f of files) byPath.set(f.webkitRelativePath === '' ? f.name : f.webkitRelativePath, f);
  const pick = pickWorldFiles([...byPath].map(([path, f]) => ({ path, size: f.size })));
  const first = byPath.keys().next().value ?? '';
  const top = first.includes('/') ? first.slice(0, first.indexOf('/')) : 'the picked folder';
  return {
    label: pick.root !== null && pick.root !== '' ? pick.root.slice(0, -1) : top,
    pick,
    blob: async (path) => byPath.get(path) ?? Promise.reject(notPicked(path)),
    close: async () => {},
  };
}

async function zipWorld(file: File): Promise<PickedWorld> {
  // zip.js is about a quarter of the page code, so it is loaded only when someone picks a zip.
  const { openZipInBrowser } = await import('../world/zip-pick.ts');
  const zip = await openZipInBrowser(file);
  const byPath = new Map(zip.entries.map((e) => [e.path, e]));
  return {
    label: file.name,
    pick: pickWorldFiles(zip.entries),
    blob: (path) => byPath.get(path)?.read() ?? Promise.reject(notPicked(path)),
    close: () => zip.close(),
  };
}

function pickText(world: PickedWorld): string {
  const regions = world.pick.files.filter((f) => f.dim !== null);
  const bytes = regions.reduce((n, f) => n + f.size, 0);
  return `${world.label}: level.dat and ${plural(regions.length, 'region file')} in ${plural(world.pick.dims.length, 'dimension')}, ${formatSize(bytes)}. `
    + 'Player files stay on this computer.';
}

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === 'AbortError';

// ---- Smart upload ----

/** A `ReadFile` over the picked world's files (`pick.files` and `pick.local`), each read only when asked. */
function readerOf(world: PickedWorld): ReadFile {
  const paths = new Map([...world.pick.files, ...world.pick.local].map((f) => [f.rel, f.path]));
  return async (rel) => {
    const path = paths.get(rel);
    return path === undefined ? null : new Uint8Array(await (await world.blob(path)).arrayBuffer());
  };
}

/** `read` keeping what it answered (a failed read is tried again next time). */
function keeping(read: ReadFile): ReadFile {
  const kept = new Map<string, Promise<Uint8Array | null>>();
  return (rel) => {
    let bytes = kept.get(rel);
    if (bytes === undefined) {
      kept.set(rel, bytes = read(rel));
      bytes.catch(() => kept.delete(rel));
    }
    return bytes;
  };
}

interface SmartState { reading: { done: number; total: number } | null; plan: SmartPlan | null; error: string | null }

/**
 * The smart upload of the picked world: its hotspots, found once per pick by reading every file through and keeping
 * none of it (a ~1 GB world must not sit in memory), then the plan for `radius`, made again on every radius from the
 * touched region files, which alone are kept. Everything is tied to the pick it was made for, so a newer pick never
 * shows an older one's reading, plan or error.
 */
function useSmartPlan(picked: PickedWorld | null, radius: number): SmartState {
  const readers = useMemo(() => {
    if (picked === null) return null;
    const read = readerOf(picked);
    return { world: picked, read, planRead: keeping(read) };
  }, [picked]);
  const [reading, setReading] = useState<{ world: PickedWorld; done: number; total: number } | null>(null);
  const [found, setFound] = useState<{ world: PickedWorld; hotspots: Hotspot[] } | null>(null);
  const [planned, setPlanned] = useState<{ hotspots: Hotspot[]; plan: SmartPlan } | null>(null);
  const [error, setError] = useState<{ world: PickedWorld; message: string } | null>(null);

  useEffect(() => {
    if (readers === null) return;
    const { world, read } = readers;
    let live = true;
    const total = world.pick.files.filter((f) => f.dim !== null).length;
    setReading({ world, done: 0, total });
    findHotspots(world.pick, read, browserInflate, (done) => {
      if (live) setReading({ world, done, total });
    }).then(
      (hotspots) => {
        if (!live) return;
        setReading(null);
        setFound({ world, hotspots });
      },
      (err: unknown) => {
        if (!live) return;
        setReading(null);
        setError({ world, message: `Could not read the world: ${messageOf(err)}` });
      },
    );
    return () => {
      live = false;
    };
  }, [readers]);

  const hotspots = found !== null && found.world === picked ? found.hotspots : null;
  useEffect(() => {
    if (readers === null || hotspots === null) return;
    const { world, planRead } = readers;
    let live = true;
    planSmartUpload(world.pick, hotspots, radius, planRead).then(
      (plan) => {
        if (!live) return;
        setPlanned({ hotspots, plan });
        setError(null);
      },
      (err: unknown) => {
        if (live) setError({ world, message: `Could not work out what to send: ${messageOf(err)}` });
      },
    );
    return () => {
      live = false;
    };
  }, [readers, hotspots, radius]);

  return {
    reading: reading !== null && reading.world === picked ? { done: reading.done, total: reading.total } : null,
    plan: planned !== null && hotspots !== null && planned.hotspots === hotspots ? planned.plan : null,
    error: error !== null && error.world === picked ? error.message : null,
  };
}

function UploadSection(props: { onUploaded(): void }): ReactElement {
  const { onUploaded } = props;
  const [picked, setPicked] = useState<PickedWorld | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [radius, setRadius] = useState<number>(SMART_RADIUS.default);
  const [upload, setUpload] = useState<UploadState>(IDLE_UPLOAD);
  /** Which button started the upload, so its progress shows beside that button. */
  const [via, setVia] = useState<'smart' | 'dims'>('smart');
  const smart = useSmartPlan(picked, radius);
  const current = useRef<PickedWorld | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const pickSeq = useRef(0);   // a newer pick (or leaving the page) discards a zip still being read

  useEffect(() => () => {
    pickSeq.current += 1;
    stopper.current?.abort();
    void current.current?.close().catch(() => {});
  }, []);

  const choose = (world: PickedWorld | null, error: string | null): void => {
    const old = current.current;
    current.current = world;
    if (old !== null && old !== world) void old.close().catch(() => {});
    setPicked(world);
    setPickError(error);
    setChosen(world?.pick.dims.some((d) => d.dim === 0) === true ? [0] : []);
    setRadius(SMART_RADIUS.default);
    setUpload(IDLE_UPLOAD);
  };

  const accept = (world: PickedWorld): void => {
    if (world.pick.root !== null) return choose(world, null);
    void world.close().catch(() => {});
    choose(null, `There is no level.dat in ${world.label}. Pick the world folder itself (the one holding level.dat and the region folder), or a zip of it.`);
  };

  const onFolder = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (files.length === 0) return;
    pickSeq.current += 1;
    setReading(null);
    accept(folderWorld(files));
  };

  const onZip = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file === undefined) return;
    const seq = ++pickSeq.current;
    setReading(`Reading ${file.name}…`);
    setPickError(null);
    zipWorld(file).then(
      (world) => {
        if (seq !== pickSeq.current) return void world.close().catch(() => {});
        setReading(null);
        accept(world);
      },
      (err: unknown) => {
        if (seq !== pickSeq.current) return;
        setReading(null);
        choose(null, `Could not read ${file.name} as a zip: ${messageOf(err)}`);
      },
    );
  };

  /** Uploads `items` with the progress and Stop button below the button `from`; the new scan then shows under "Scans". */
  const send = (items: UploadItem[], from: 'smart' | 'dims'): void => {
    const ac = new AbortController();
    stopper.current = ac;
    setVia(from);
    setUpload({ ...IDLE_UPLOAD, running: true });
    uploadWorld(items, worldApi, (progress) => setUpload((u) => ({ ...u, progress })), ac.signal).then(
      () => {
        setUpload({ ...IDLE_UPLOAD, outcome: `Sent ${plural(items.length, 'file')}. The scan is listed under Scans.` });
        onUploaded();
      },
      (err: unknown) => {
        setUpload({ ...IDLE_UPLOAD, error: isAbort(err) ? 'Upload stopped. Nothing was scanned.' : `The upload failed: ${messageOf(err)}` });
      },
    ).finally(() => {
      if (stopper.current === ac) stopper.current = null;
    });
  };

  const uploadDims = (): void => {
    if (picked === null) return;
    send(selectDims(picked.pick, chosen).map((f): UploadItem => ({ rel: f.rel, size: f.size, blob: () => picked.blob(f.path) })), 'dims');
  };

  const uploadSmart = (): void => {
    if (smart.plan !== null) send(smart.plan.items, 'smart');   // exactly what the preview shows
  };
  const stop = (): void => stopper.current?.abort();

  return (
    <Section title="Upload a world">
      <p className="muted" style={{ margin: 0 }}>
        For a world that is not in the server folder. Pick the world folder (the one holding level.dat) or a zip of it: this browser reads it and
        sends only what a scan needs. Your browser may say it is uploading the folder; nothing is sent until you press an upload button.
      </p>
      <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}>
        <label className="field">
          <span>World folder (recommended)</span>
          <input type="file" {...{ webkitdirectory: '' }} multiple data-testid="world-folder-input" disabled={upload.running} onChange={onFolder} />
        </label>
        <label className="field">
          <span>Or a zip of the world folder</span>
          <input type="file" accept=".zip" data-testid="world-zip-input" disabled={upload.running} onChange={onZip} />
        </label>
      </div>
      {reading !== null && <p className="muted" role="status" style={{ margin: 0 }}>{reading}</p>}
      {pickError !== null && <p className="error" role="alert" style={{ margin: 0 }}>{pickError}</p>}
      {picked !== null && (
        <>
          <p style={{ margin: 0 }}>{pickText(picked)}</p>
          <SmartUploadPanel reading={smart.reading} plan={smart.plan} radius={radius} busy={upload.running} onRadius={setRadius} onUpload={uploadSmart} />
          {smart.error !== null && <p className="error" role="alert" style={{ margin: 0 }}>{smart.error}</p>}
          {via === 'smart' && <UploadStatus upload={upload} onStop={stop} />}
          <WholeDimensions
            pick={picked.pick}
            chosen={chosen}
            upload={via === 'dims' ? upload : { ...IDLE_UPLOAD, running: upload.running }}
            onChoose={setChosen}
            onUpload={uploadDims}
            onStop={stop}
          />
        </>
      )}
    </Section>
  );
}

// ---- The page ----

export function WorldPage(): ReactElement {
  const { scans, error, reload } = useScans();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancel = (id: string): void => {
    setCancelError(null);
    worldApi.cancel(id).then(reload, (err: unknown) => {
      setCancelError(`Could not cancel the scan: ${messageOf(err)}`);
      reload();
    });
  };
  return (
    <main className="page world-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>World</h1>
      <ServerFolder onStarted={reload} />
      <Section title="Scans">
        {cancelError !== null && <p className="error" role="alert" style={{ margin: 0 }}>{cancelError}</p>}
        <ScanList scans={scans} error={error} onCancel={cancel} />
      </Section>
      <UploadSection onUploaded={reload} />
      <footer className="muted">
        Scans never touch the live server: they read its newest complete backup or a copy of its world folder, or the files you upload, and nothing is
        written to the server folder. A project chooses its scan and base on its Map tab.
      </footer>
    </main>
  );
}
