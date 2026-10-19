// The map canvas (spec §3.4b, architecture §7.2): top-down tiles of a finished scan at a Y level, coloured from the
// block textures, with the chunk grid, the overlays and markers other views pass in, drag to pan, wheel to zoom.
// Drawing runs outside React: a MapRenderer redraws once per animation frame after any change and asks for the
// visible tiles only, at most MAX_IN_FLIGHT at a time, the newest view's tiles first. A block the pointer rests on is
// described in a tooltip (architecture §11, Map hover).

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { messageOf } from '../api/client.ts';
import { worldApi } from '../map/api.ts';
import { useItemNames } from '../map/FoundPanel.tsx';
import { buildColumnIndex, columnItemKeys, createHoverTimer, describeColumn, mteNamesOf, topBlockAt, type HoverTimer } from '../map/hover.ts';
import { MapTooltip, tooltipPosition } from '../map/MapTooltip.tsx';
import { layerPixels, resolvePaletteColors } from '../map/palette.ts';
import { chunkGridLines, dimLabel, panBy, screenToWorld, shadeTile, visibleTiles, worldToScreen, zoomAt } from '../map/render.ts';
import { lruSet, SURFACE_Y, tileCache, tileKeyId, type TileKey } from '../map/tile-cache.ts';
import type { MapMarker, MapOverlay, MapViewport, MapViewProps } from '../map/types.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { TILE_SIZE, tileOf, type MapTile, type WorldScan } from '../../shared/types/world.ts';

const START_PPB = 4;
const ZOOM_STEP = 2;
/** The wheel zooms by WHEEL_ZOOM^(−deltaY/100). */
const WHEEL_ZOOM = 1.2;
const WHEEL_LINE_PIXELS = 16;
/** A press moves this far (px) before it counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;
const MARKER_RADIUS = 9;
/** A click this close (px) to a marker's centre is a click on the marker. */
const MARKER_HIT = 10;
const MARKER_FONT = '600 11px system-ui, sans-serif';
const GRID_COLOR = 'rgba(255, 255, 255, 0.18)';
const MAX_IN_FLIGHT = 6;
/**
 * Tiles asked for per view, nearest the centre first. It stays below the tile cache's 512 so a view's tiles always fit:
 * zoomed far out on a large screen the view can cover thousands of tiles, which would otherwise be fetched, evicted
 * and fetched again without end.
 */
const WANTED_TILES = 384;
const SHADED_MAX = 512;
/** A tile that failed to load is asked for again after this long. */
const RETRY_MS = 10_000;
const NO_OVERLAYS: readonly MapOverlay[] = [];
const NO_MARKERS: readonly MapMarker[] = [];
const NO_KEYS: readonly StuffKey[] = [];
const NO_LINES: readonly string[] = [];
/** Without a scan the hover tooltip has no scan records and no base to name. */
const NO_SCAN: Pick<WorldScan, 'machines' | 'pipes' | 'storage' | 'bases'> = { machines: [], pipes: [], storage: [], bases: [] };

function markerPoint(v: MapViewport, m: MapMarker): [number, number] {
  return worldToScreen(v, m.pos[0] + 0.5, m.pos[2] + 0.5);
}

/** The marker nearest (px, py), when its centre is within MARKER_HIT px. */
function markerAt(v: MapViewport, markers: readonly MapMarker[], px: number, py: number): MapMarker | null {
  let best: MapMarker | null = null, bestDistance = MARKER_HIT;
  for (const m of markers) {
    const [x, y] = markerPoint(v, m);
    const d = Math.hypot(x - px, y - py);
    if (d <= bestDistance) {
      best = m;
      bestDistance = d;
    }
  }
  return best;
}

/** `tiles` ordered by distance from the view's centre. */
function nearestFirst(v: MapViewport, tiles: Array<[number, number]>): Array<[number, number]> {
  const cx = v.centerX / TILE_SIZE - 0.5, cz = v.centerZ / TILE_SIZE - 0.5;
  const d = ([tx, tz]: [number, number]): number => (tx - cx) ** 2 + (tz - cz) ** 2;
  return [...tiles].sort((a, b) => d(a) - d(b));
}

/** Draws the map onto its canvas and keeps the tile requests to what the current view shows. */
class MapRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private view: MapViewport;
  private scanId: string;
  private overlays: readonly MapOverlay[] = NO_OVERLAYS;
  private markers: readonly MapMarker[] = NO_MARKERS;
  private colors: Uint32Array | null = null;
  /** Bumped whenever the colours change; a shaded tile of another version is shaded again. */
  private version = 0;
  private readonly shaded = new Map<string, { version: number; image: OffscreenCanvas }>();
  private scratch: ImageData | null = null;
  private queue: TileKey[] = [];
  private readonly inFlight = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private frame = 0;
  private running = false;

  constructor(view: MapViewport, scanId: string) {
    this.view = view;
    this.scanId = scanId;
  }

  start(): void {
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.queue = [];
  }

  update(canvas: HTMLCanvasElement | null, view: MapViewport, scanId: string, overlays: readonly MapOverlay[], markers: readonly MapMarker[]): void {
    this.canvas = canvas;
    this.view = view;
    this.scanId = scanId;
    this.overlays = overlays;
    this.markers = markers;
    this.schedule();
  }

  /** Another scan: no colours until its palette arrives, and nothing of the old scan is asked for or retried. */
  newScan(): void {
    this.colors = null;
    this.version++;
    this.queue = [];
    this.failedAt.clear();
    this.shaded.clear();
    this.schedule();
  }

  setColors(colors: Uint32Array): void {
    this.colors = colors;
    this.version++;
    this.schedule();
  }

  private readonly schedule = (): void => {
    if (!this.running || this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  };

  private draw(): void {
    const canvas = this.canvas;
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas === null || ctx === null) return;
    const v = this.view;
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.round(v.width * dpr), height = Math.round(v.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (width === 0 || height === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // everything below is in CSS pixels, as MapViewport is
    ctx.imageSmoothingEnabled = false;

    const keyOf = ([tx, tz]: [number, number]): TileKey => ({ scanId: this.scanId, dim: v.dim, tx, tz, y: v.y });
    const tiles = visibleTiles(v);
    if (this.colors !== null) {
      for (const t of tiles) {
        const k = keyOf(t), tile = tileCache.get(k);
        if (tile !== undefined) this.drawTile(ctx, v, k, tile, this.colors);
      }
    }
    this.drawGrid(ctx, v);
    for (const overlay of this.overlays) {
      ctx.save();
      overlay.draw(ctx, v);
      ctx.restore();
    }
    this.drawMarkers(ctx, v);

    // Reading the wanted tiles last makes them the cache's most recently used, so loading the rest evicts others.
    const wanted = nearestFirst(v, tiles).slice(0, WANTED_TILES).map(keyOf);
    this.want(wanted.filter((k) => tileCache.get(k) === undefined));
  }

  private drawTile(ctx: CanvasRenderingContext2D, v: MapViewport, k: TileKey, tile: MapTile, colors: Uint32Array): void {
    const image = this.shadedImage(k, tile, colors);
    if (image === null) return;
    // Whole pixels on both edges, so neighbouring tiles meet without a seam.
    const [x0, y0] = worldToScreen(v, k.tx * TILE_SIZE, k.tz * TILE_SIZE).map(Math.round) as [number, number];
    const [x1, y1] = worldToScreen(v, (k.tx + 1) * TILE_SIZE, (k.tz + 1) * TILE_SIZE).map(Math.round) as [number, number];
    ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0);
  }

  /** The tile shaded with the current colours, kept per tile key and colour version. */
  private shadedImage(k: TileKey, tile: MapTile, colors: Uint32Array): OffscreenCanvas | null {
    const id = tileKeyId(k);
    let entry = this.shaded.get(id);
    if (entry === undefined || entry.version !== this.version) {
      const image = entry?.image ?? new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
      const ctx = image.getContext('2d');
      if (ctx === null) return null;
      this.scratch ??= new ImageData(TILE_SIZE, TILE_SIZE);
      shadeTile(tile, colors, this.scratch.data);
      ctx.putImageData(this.scratch, 0, 0);
      entry = { version: this.version, image };
    }
    lruSet(this.shaded, id, entry, SHADED_MAX);
    return entry.image;
  }

  private drawGrid(ctx: CanvasRenderingContext2D, v: MapViewport): void {
    const { xs, zs } = chunkGridLines(v);
    if (xs.length === 0 && zs.length === 0) return;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of xs) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, v.height);
    }
    for (const z of zs) {
      ctx.moveTo(0, Math.round(z) + 0.5);
      ctx.lineTo(v.width, Math.round(z) + 0.5);
    }
    ctx.stroke();
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, v: MapViewport): void {
    ctx.font = MARKER_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of this.markers) {
      const [x, y] = markerPoint(v, m);
      if (x < -MARKER_RADIUS || y < -MARKER_RADIUS || x > v.width + MARKER_RADIUS || y > v.height + MARKER_RADIUS) continue;
      ctx.beginPath();
      ctx.arc(x, y, MARKER_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.stroke();
      if (m.n === undefined) continue;
      // Dark digits with a light halo read on any marker colour.
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.strokeText(String(m.n), x, y + 0.5);
      ctx.fillStyle = '#111111';
      ctx.fillText(String(m.n), x, y + 0.5);
    }
  }

  /** The newest view's missing tiles replace whatever an older view still wanted. */
  private want(keys: TileKey[]): void {
    const now = Date.now();
    this.queue = keys.filter((k) => {
      const failed = this.failedAt.get(tileKeyId(k));
      return failed === undefined || now - failed >= RETRY_MS;
    });
    this.pump();
  }

  private pump(): void {
    while (this.running && this.inFlight.size < MAX_IN_FLIGHT) {
      const k = this.queue.shift();
      if (k === undefined) return;
      const id = tileKeyId(k);
      if (this.inFlight.has(id)) continue;
      this.inFlight.add(id);
      tileCache.load(k)
        .then(this.schedule, () => { this.failedAt.set(id, Date.now()); })
        .finally(() => {
          this.inFlight.delete(id);
          this.pump();
        });
    }
  }
}

/** A press on the canvas: where it started, whether an overlay took it, whether it has become a drag and panned the map. */
interface Press { pointerId: number; startX: number; startY: number; lastX: number; lastY: number; consumed: boolean; dragging: boolean; panned: boolean }

/** A scan's palette names: each entry's English name in palette order, and every GT tile entity's name by mteId. */
interface PaletteNames { blocks: readonly string[]; mte: ReadonlyMap<number, string> }

/**
 * The English names of the palette entries of scan `scanId` (`GET …/palette?names=1`), asked once per scan apart from
 * the colours' palette; null while they load or when they cannot be had (no recipe export), and the tooltip then goes
 * without block, cable and pipe names.
 */
function usePaletteNames(scanId: string): PaletteNames | null {
  const [loaded, setLoaded] = useState<{ scanId: string; names: PaletteNames } | null>(null);
  useEffect(() => {
    let current = true;
    worldApi.paletteNames(scanId).then(
      (entries) => {
        if (current) setLoaded({ scanId, names: { blocks: entries.map((e) => e.name), mte: mteNamesOf(entries) } });
      },
      () => {},   // no names: positions and what the scan found still show
    );
    return () => {
      current = false;
    };
  }, [scanId]);
  return loaded !== null && loaded.scanId === scanId ? loaded.names : null;
}

export function MapView(props: MapViewProps): ReactElement {
  const { scanId, dim, focus } = props;
  const overlays = props.overlays ?? NO_OVERLAYS;
  const markers = props.markers ?? NO_MARKERS;
  const focusX = focus?.[0], focusZ = focus?.[1];
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const press = useRef<Press | null>(null);
  const [view, setView] = useState<MapViewport>(() => ({
    dim, centerX: focusX ?? 0, centerZ: focusZ ?? 0, pixelsPerBlock: START_PPB, width: 0, height: 0, y: SURFACE_Y,
  }));
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  rendererRef.current ??= new MapRenderer(view, scanId);
  const renderer = rendererRef.current;

  useEffect(() => {
    renderer.start();
    return () => renderer.stop();
  }, [renderer]);

  useEffect(() => renderer.update(canvasRef.current, view, scanId, overlays, markers));

  useEffect(() => {
    let current = true;
    renderer.newScan();
    setPaletteError(null);
    worldApi.palette(scanId)
      .then((palette) => resolvePaletteColors(palette, { faces: worldApi.blockFaces, image: layerPixels }, (colors) => {
        if (current) renderer.setColors(colors);
      }))
      .catch((err: unknown) => {
        if (current) setPaletteError(messageOf(err));
      });
    return () => {
      current = false;
    };
  }, [renderer, scanId]);

  // Another base or dimension: start again at its focus.
  useEffect(() => {
    const centerX = focusX ?? 0, centerZ = focusZ ?? 0;
    setView((v) => (v.dim === dim && v.centerX === centerX && v.centerZ === centerZ ? v : { ...v, dim, centerX, centerZ }));
  }, [dim, focusX, focusZ]);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const measure = (): void => {
      const width = box.clientWidth, height = box.clientHeight;
      setView((v) => (v.width === width && v.height === height ? v : { ...v, width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // React's wheel listener is passive, so it cannot stop the page from scrolling; this one can.
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = canvas.getBoundingClientRect();
      const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PIXELS : e.deltaY;
      setView((v) => zoomAt(v, e.clientX - box.left, e.clientY - box.top, WHEEL_ZOOM ** (-pixels / 100)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ---- The hover tooltip (architecture §11, Map hover) ----
  // `hover` is the column the pointer has rested on. The pointer's latest point stays in a ref, so the tooltip follows
  // it within that column without a render.
  const tipId = useId();
  const tipRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<[number, number]>([0, 0]);
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const timerRef = useRef<HoverTimer | null>(null);
  timerRef.current ??= createHoverTimer(setHover);
  const hoverTimer = timerRef.current;
  const paletteNames = usePaletteNames(scanId);
  const scan = props.scan ?? NO_SCAN;
  const columns = useMemo(() => buildColumnIndex(scan, view.dim), [scan, view.dim]);
  // The column's top block comes from the tile drawn for this Y level. A tile not loaded yet gives none, and the tooltip
  // is drawn again once it lands: a tile's arrival only redraws the canvas. load() joins the renderer's request in flight.
  const hoverTileKey: TileKey | null = hover === null ? null : { scanId, dim: view.dim, tx: tileOf(hover.x), tz: tileOf(hover.z), y: view.y };
  const hoverTile = hoverTileKey === null ? undefined : tileCache.get(hoverTileKey);
  const awaitedTile = hoverTileKey !== null && hoverTile === undefined ? hoverTileKey : null;
  const awaitedTileId = awaitedTile === null ? null : tileKeyId(awaitedTile);
  const [, setTilesLanded] = useState(0);
  useEffect(() => {
    if (awaitedTile === null) return;
    let current = true;
    tileCache.load(awaitedTile).then(
      () => {
        if (current) setTilesLanded((n) => n + 1);
      },
      () => {},   // a failed tile: the renderer asks again later, and the next column the pointer rests on reads it
    );
    return () => {
      current = false;
    };
  }, [awaitedTileId]);   // the id names awaitedTile
  const hovered = hover === null ? null : { ...hover, ...topBlockAt(hoverTile, hover.x, hover.z, paletteNames?.blocks ?? null) };
  // The Found panel's page-wide item names: asked for (after render) only for the contents the tooltip shows.
  const itemNames = useItemNames(hovered === null ? NO_KEYS : columnItemKeys(columns, hovered.x, hovered.z, hovered.topY));
  const tipLines = hovered === null ? NO_LINES : describeColumn({
    ...hovered, index: columns, scan, overlays, itemName: (key) => itemNames.get(key) ?? key, mteName: (mteId) => paletteNames?.mte.get(mteId),
  });
  /** Puts the tooltip beside the pointer (it needs its own size, so once it is rendered). */
  const placeTip = (): void => {
    const el = tipRef.current;
    if (el === null || hover === null) return;
    const { left, top } = tooltipPosition(view, hover, pointer.current, { width: el.offsetWidth, height: el.offsetHeight });
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  useLayoutEffect(placeTip);
  // A new view (pan, zoom, Y level, dimension, size) or scan hides the tooltip before it is painted, as unmounting does.
  useLayoutEffect(() => () => hoverTimer.clear(), [hoverTimer, view, scanId]);

  const pointOf = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  /** Hands the event to the overlays, topmost first, until one consumes it. */
  const toOverlays = (kind: 'down' | 'move' | 'up', px: number, py: number): boolean => {
    const [wx, wz] = screenToWorld(view, px, py);
    const ev = { kind, x: Math.floor(wx), z: Math.floor(wz) };
    for (let i = overlays.length - 1; i >= 0; i--) if (overlays[i]!.onPointer?.(ev) === true) return true;
    return false;
  };
  /** The pointer is at (px, py) without a press: the column there is described once the pointer rests, but not on a marker. */
  const hoverAt = (px: number, py: number): void => {
    pointer.current = [px, py];
    if (press.current !== null || markerAt(view, markers, px, py) !== null) {
      hoverTimer.clear();   // another pointer's press; a marker shows its own label
      return;
    }
    const [wx, wz] = screenToWorld(view, px, py);
    const x = Math.floor(wx), z = Math.floor(wz);
    hoverTimer.move(x, z);
    if (hover !== null && hover.x === x && hover.z === z) placeTip();
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    hoverTimer.clear();   // a press (a click, a pan, an overlay's drag) hides the tooltip
    if (e.button !== 0) return;
    const [px, py] = pointOf(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, startX: px, startY: py, lastX: px, lastY: py, consumed: toOverlays('down', px, py), dragging: false, panned: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    const [px, py] = pointOf(e);
    const consumed = toOverlays('move', px, py);
    const p = press.current;
    if (p === null || p.pointerId !== e.pointerId) {
      const title = markerAt(view, markers, px, py)?.label ?? '';   // the marker's label as its tooltip
      if (e.currentTarget.title !== title) e.currentTarget.title = title;
      hoverAt(px, py);
      return;
    }
    if (!p.dragging && Math.hypot(px - p.startX, py - p.startY) >= DRAG_THRESHOLD) p.dragging = true;
    if (!p.dragging) return;
    if (!p.consumed && !consumed) {
      const dx = px - p.lastX, dy = py - p.lastY;
      e.currentTarget.style.cursor = 'grabbing';
      p.panned = true;
      setView((v) => panBy(v, dx, dy));
    }
    p.lastX = px;
    p.lastY = py;
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>): void => {
    const p = press.current;
    if (p === null || p.pointerId !== e.pointerId) return;
    press.current = null;
    e.currentTarget.style.cursor = 'grab';
    const [px, py] = pointOf(e);
    if (!p.consumed && !p.dragging && props.onMarkerClick !== undefined) {
      const marker = markerAt(view, markers, px, py);
      if (marker !== null) {
        props.onMarkerClick(marker);   // a click on a marker is the marker's, not the overlays'
        return;
      }
    }
    // A pan keeps the same world point under the pointer, so its release would look like a click to the overlays.
    if (p.panned) return;
    toOverlays('up', px, py);
  };
  const onPointerCancel = (e: PointerEvent<HTMLCanvasElement>): void => {
    hoverTimer.clear();
    if (press.current?.pointerId !== e.pointerId) return;
    press.current = null;   // the browser took the gesture: neither a click nor the end of a drag
    e.currentTarget.style.cursor = 'grab';
  };

  const zoomCentre = (factor: number): void => setView((v) => zoomAt(v, v.width / 2, v.height / 2, factor));
  const yLabel = view.y === SURFACE_Y ? 'surface' : `Y ≤ ${view.y}`;
  const tooWide = visibleTiles(view).length > WANTED_TILES;

  return (
    <div className="map-view" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, height: '100%' }}>
      <div className="row">
        <button type="button" className="small" aria-label="Zoom in" onClick={() => zoomCentre(ZOOM_STEP)}>+</button>
        <button type="button" className="small" aria-label="Zoom out" onClick={() => zoomCentre(1 / ZOOM_STEP)}>−</button>
        {focusX !== undefined && focusZ !== undefined && (
          <button type="button" className="small" onClick={() => setView((v) => ({ ...v, centerX: focusX, centerZ: focusZ }))}>Re-centre</button>
        )}
        <input
          type="range" min={0} max={SURFACE_Y} step={1} value={view.y} aria-label="Y level" aria-valuetext={yLabel}
          onChange={(e) => {
            const y = Number(e.currentTarget.value);
            setView((v) => ({ ...v, y }));
          }}
        />
        <span>{yLabel}</span>
        {tooWide && <span className="muted">Zoom in to load the rest of the map</span>}
        {paletteError !== null && <span className="error">Map colours could not be loaded: {paletteError}</span>}
      </div>
      <div
        ref={boxRef}
        style={{
          position: 'relative', flex: 1, minHeight: 360, overflow: 'hidden', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', background: 'var(--surface-2)',
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Map of ${dimLabel(dim)}`}
          aria-describedby={tipLines.length > 0 ? tipId : undefined}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={() => hoverTimer.clear()}
        />
        {tipLines.length > 0 && <MapTooltip ref={tipRef} id={tipId} lines={tipLines} />}
      </div>
    </div>
  );
}
