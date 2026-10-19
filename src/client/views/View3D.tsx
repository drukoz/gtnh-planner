// The 3D tab (Plan 5 Task 15; spec §3.8): only the new line and its hookups, in the pack's own textures (plain colours
// where a texture cannot be had), with existing base blocks as faint ghosts where the line meets them. Drag turns it,
// the wheel zooms, the layer slider cuts it from the top, hovering names a block with its covers and settings, and a
// click shows a machine's recipe and facing. Beside it the side list — blocks to place, hookups, overall size — and the
// layout's warnings, drawn from the same layout as the map, so the two always agree. The tab's code, three.js
// included, is its own chunk (View3DTab.tsx).

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Layout } from '../../shared/types/layout.ts';
import { messageOf } from '../api/client.ts';
import { useLayout } from '../state/use-layout.ts';
import { loadSceneInputs, realTextureDeps, tilesFor } from '../three/load-textures.ts';
import { createViewer, type Viewer } from '../three/renderer.ts';
import { blockList, buildScene, hoverText, pickInfo } from '../three/scene-data.ts';
import type { ProjectViewProps } from './project-tabs.ts';

type Show = { ghosts: boolean; hookups: boolean };
type Info = { title: string; lines: string[] };

export interface View3DShellProps {
  layout: Layout | null; loading: boolean; error: string | null;
  /** Whether this browser has WebGL2; without it only the side list shows. */
  webgl: boolean;
  /** The highest layer shown (0 = the bottom one), `null` for all. */
  maxLayer: number | null; onLayer(n: number | null): void;
  show: Show; onShow(next: Show): void;
  /** What hovering shows for the block under the pointer. */
  hover: string | null;
  /** What a click on a block shows. */
  info: Info | null;
  /** The viewer's canvas. */
  canvas: ReactNode;
  /** Item names (the plan's), for the side list's cover rows. */
  names?: Readonly<Record<string, string>>;
  /**
   * The plan has no steps (no target yet, or none it can make): an `empty` layout then says so instead of claiming
   * every step runs on owned machines, as the Map tab's line panel does.
   */
  noSteps?: boolean;
}

const LOADING_TEXT = 'Laying out the line…';
const NO_WEBGL_TEXT = 'The 3D view needs WebGL2 — the block list below still works';
const ALL_OWNED_TEXT = 'Nothing new to build — every step runs on machines you own';
const NO_STEPS_TEXT = 'Nothing to lay out yet — the plan makes nothing';
/** Set to '1' (by the end-to-end test) to keep the canvas readable with readPixels. */
const PRESERVE_BUFFER_KEY = 'gp.test.preserveDrawingBuffer';
/** A pointer that moved further than this between press and release was turning the view, not clicking a block. */
const CLICK_SLOP_PX = 4;

// The view sits beside the side list while both fit, and above it on a narrow screen (like the Map tab).
const MAIN_STYLE: CSSProperties = { flex: '3 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const VIEWPORT_STYLE: CSSProperties = {
  position: 'relative', height: 'min(64vh, 680px)', minHeight: 360, overflow: 'hidden',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-2)',
};
const HOVER_STYLE: CSSProperties = {
  position: 'absolute', top: 8, left: 8, right: 8, margin: 0, width: 'fit-content', maxWidth: 'calc(100% - 16px)', padding: '4px 8px',
  borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', pointerEvents: 'none', overflowWrap: 'anywhere',
};
const SIDE_STYLE: CSSProperties = { flex: '1 1 260px', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 12 };
const BOX_STYLE: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--surface)',
};
const HEADING_STYLE: CSSProperties = { margin: 0, fontSize: '0.95rem' };
const SUBHEAD_STYLE: CSSProperties = { margin: '4px 0 0', fontSize: '0.85rem' };
const LIST_STYLE: CSSProperties = { margin: 0, paddingLeft: 18 };

/** Whether this browser can draw the view; the test canvas's context is let go at once. */
export function webgl2Available(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The slider's words: `All layers`, or `Layers 1–<k+1> of <H>` while it shows layers 0 … k. */
function layerText(maxLayer: number | null, height: number): string {
  return maxLayer === null ? 'All layers' : `Layers 1–${maxLayer + 1} of ${height}`;
}

function Controls(props: Pick<View3DShellProps, 'maxLayer' | 'onLayer' | 'show' | 'onShow'> & { height: number }): ReactElement {
  const { maxLayer, onLayer, show, onShow, height } = props;
  return (
    <div className="row" style={{ gap: 16 }}>
      <label className="check">
        <input
          type="range"
          aria-label="Layer"
          min="0"
          max={height}
          step="1"
          value={maxLayer ?? height}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            onLayer(n >= height ? null : n);   // the top position shows every layer
          }}
        />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{layerText(maxLayer, height)}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={show.ghosts} onChange={(e) => onShow({ ...show, ghosts: e.currentTarget.checked })} />
        Ghosts
      </label>
      <label className="check">
        <input type="checkbox" checked={show.hookups} onChange={(e) => onShow({ ...show, hookups: e.currentTarget.checked })} />
        Hookups
      </label>
    </div>
  );
}

function BlockInfo(props: { info: Info }): ReactElement {
  const { title, lines } = props.info;
  return (
    <section data-testid="view3d-info" aria-live="polite" style={BOX_STYLE}>
      <h3 style={HEADING_STYLE}>{title}</h3>
      {lines.length > 0 && (
        <ul className="small" style={LIST_STYLE}>
          {lines.map((line, i) => <li key={`${i}|${line}`}>{line}</li>)}
        </ul>
      )}
    </section>
  );
}

/** Spec §3.8's side list: what to place with counts (cover items included), the hookups and the overall size. */
function BlockList(props: { layout: Layout; names: Readonly<Record<string, string>> | undefined }): ReactElement {
  const { place, hookups, size } = blockList(props.layout, props.names);
  const headingId = useId();
  return (
    <section data-testid="block-list" aria-labelledby={headingId} style={BOX_STYLE}>
      <h3 id={headingId} style={HEADING_STYLE}>Blocks to place</h3>
      <ul className="small" style={LIST_STYLE}>
        {place.map((row, i) => <li key={`${i}|${row.label}`}>{`${row.label} ×${row.count}`}</li>)}
      </ul>
      {hookups.length > 0 && (
        <>
          <h4 style={SUBHEAD_STYLE}>Hookups</h4>
          <ul className="small" style={LIST_STYLE}>
            {hookups.map((text, i) => <li key={`${i}|${text}`}>{text}</li>)}
          </ul>
        </>
      )}
      <p className="small" style={{ margin: '4px 0 0' }}>{`Size: ${size}`} <span className="muted">(W×L×H)</span></p>
    </section>
  );
}

function Warnings(props: { layout: Layout }): ReactElement | null {
  const { warnings } = props.layout;
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Warnings" style={BOX_STYLE}>
      <h3 style={HEADING_STYLE}>Warnings</h3>
      <ul className="small" style={LIST_STYLE}>
        {warnings.map((w, i) => <li key={`${w.code}:${i}`}>{w.text}</li>)}
      </ul>
    </section>
  );
}

/**
 * The tab without the viewer: what is happening (an error, laying out, no WebGL2, nothing to build), the canvas with
 * the hover label over it, the layer slider and the Ghosts and Hookups toggles, and beside them the clicked block's
 * details (where they show without scrolling), the side list and the layout's warnings below it. Without WebGL2 only
 * the side list and the warnings show.
 */
export function View3DShell(props: View3DShellProps): ReactElement {
  const { layout, loading, error, webgl, hover, info, canvas, names } = props;
  const blocks = layout !== null && layout.blocks.length > 0;
  const warned = layout !== null && layout.warnings.length > 0;
  return (
    <div className="view3d" data-testid="view3d" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error !== null && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {loading && <p className="muted" style={{ margin: 0 }}>{LOADING_TEXT}</p>}
      {!webgl && <p className="muted" style={{ margin: 0 }}>{NO_WEBGL_TEXT}</p>}
      {layout?.status === 'empty' && <p className="muted" style={{ margin: 0 }}>{props.noSteps === true ? NO_STEPS_TEXT : ALL_OWNED_TEXT}</p>}
      {layout !== null && (blocks || warned) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
          {blocks && webgl && (
            <div style={MAIN_STYLE}>
              <div data-testid="view3d-canvas" style={VIEWPORT_STYLE}>
                {canvas}
                {hover !== null && <p data-testid="view3d-hover" className="small" style={HOVER_STYLE}>{hover}</p>}
              </div>
              <Controls maxLayer={props.maxLayer} onLayer={props.onLayer} show={props.show} onShow={props.onShow} height={layout.size[1]} />
              <p className="muted small" style={{ margin: 0 }}>Drag to turn, right-drag to pan, scroll to zoom; click a block for its details.</p>
            </div>
          )}
          <div style={SIDE_STYLE}>
            {info !== null && <BlockInfo info={info} />}
            {blocks && <BlockList layout={layout} names={names} />}
            <Warnings layout={layout} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Whether the end-to-end test asked for a canvas it can read back; false when storage is refused. */
function preserveDrawingBuffer(): boolean {
  try {
    return globalThis.localStorage?.getItem(PRESERVE_BUFFER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The 3D tab: the project's layout (Task 13's `useLayout`); for a layout with blocks, its textures loaded and a viewer
 * made on the canvas, then kept in step with the slider, the toggles and the canvas's size. A new layout disposes the
 * previous viewer first, and clears the hover label and the details, which named its blocks.
 */
export default function View3D(props: ProjectViewProps): ReactElement {
  const { project, plan } = props;
  const line = useLayout(project.id, plan, project);
  const { layout } = line;
  const [webgl] = useState(webgl2Available);
  const [maxLayer, setMaxLayer] = useState<number | null>(null);
  const [show, setShow] = useState<Show>({ ghosts: true, hookups: true });
  const [hover, setHover] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The viewer on the canvas and the layout it draws (block indices from `pick` refer to it). */
  const built = useRef<{ viewer: Viewer; layout: Layout } | null>(null);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  // A slider position at or above a new, lower layout's height shows all of it.
  const shownLayer = maxLayer !== null && layout !== null && maxLayer < layout.size[1] ? maxLayer : null;
  const latest = useRef({ shownLayer, show });

  useEffect(() => {
    setHover(null);
    setInfo(null);
    setViewError(null);
    const canvas = canvasRef.current;
    if (!webgl || layout === null || layout.blocks.length === 0 || canvas === null) return;
    let live = true;
    let viewer: Viewer | null = null;
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => viewer?.resize());
    void (async () => {
      try {
        const { faces, icons, covers } = await loadSceneInputs(layout, realTextureDeps);
        if (!live) return;
        const scene = buildScene(layout, faces, icons, covers);
        const tiles = await tilesFor(scene, realTextureDeps);
        if (!live) return;
        viewer = createViewer(canvas, layout, scene, tiles, { preserveDrawingBuffer: preserveDrawingBuffer() });
        viewer.setShow(latest.current.show);
        viewer.setMaxLayer(latest.current.shownLayer);
        built.current = { viewer, layout };
        resizes?.observe(canvas);
      } catch (err) {
        if (live) setViewError(`The 3D view could not be drawn: ${messageOf(err)}`);
      }
    })();
    return () => {
      live = false;
      resizes?.disconnect();
      viewer?.dispose();
      built.current = null;
    };
  }, [layout, webgl]);

  useEffect(() => {
    latest.current.shownLayer = shownLayer;
    built.current?.viewer.setMaxLayer(shownLayer);
  }, [shownLayer]);
  useEffect(() => {
    latest.current.show = show;
    built.current?.viewer.setShow(show);
  }, [show]);

  const canvas = (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="The new line in 3D"
      style={{ display: 'block', width: '100%', height: '100%', cursor: hover === null ? 'grab' : 'pointer' }}
      onPointerDown={(e) => {
        pressedAt.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const view = built.current;
        if (view === null) return;
        const block = view.viewer.pick(e.clientX, e.clientY);
        setHover(block === null ? null : hoverText(view.layout, plan, block));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const from = pressedAt.current;
        pressedAt.current = null;
        if (from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP_PX) return;   // the end of a drag
        const view = built.current;
        if (view === null) return;
        const block = view.viewer.pick(e.clientX, e.clientY);
        setInfo(block === null ? null : pickInfo(view.layout, plan, block));
      }}
    />
  );

  return (
    <View3DShell
      layout={layout}
      loading={line.loading}
      error={line.error ?? viewError}
      webgl={webgl}
      maxLayer={shownLayer}
      onLayer={setMaxLayer}
      show={show}
      onShow={setShow}
      hover={hover}
      info={info}
      canvas={canvas}
      names={plan?.names}
      noSteps={plan !== null && plan.steps.length === 0}
    />
  );
}
