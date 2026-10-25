// The 3D tab (Plan 5 Task 15; spec §3.8): only the new line and its hookups, in the pack's own textures (plain colours
// where a texture cannot be had), with existing base blocks as faint ghosts where the line meets them. Drag turns it,
// the wheel zooms, the layer slider cuts it from the top, hovering names a block with its covers and settings, and a
// click shows a machine's recipe and facing. Show connections (the user's requirements of 2026-10-19, item 3 (b);
// off until this browser turns it on, and remembered in it) draws the Connections tab's links over the line, from
// the shared model: hovering one names it as the Connections tab does, draws it thicker and fades the others, and a
// click marks its two faces and shows its details; Focus (remembered too) shows only the links of the block under
// the pointer, or of the block clicked. The note under the view says what the links' colours mean, with a legend.
// Beside it the side list — blocks to place, hookups, overall size — and the layout's warnings, drawn from the same
// layout as the map, so the two always agree. The tab's code, three.js included, is its own chunk (View3DTab.tsx).

import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { DYE_NAMES } from '../../shared/layout/enderio.ts';
import { fmtInt } from '../../shared/layout/format.ts';
import type { Rgb } from '../../shared/types/assets.ts';
import type { DyeColor, Layout } from '../../shared/types/layout.ts';
import type { LogisticsMode } from '../../shared/types/plan.ts';
import { messageOf } from '../api/client.ts';
import { Figs } from '../components/Figs.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { SPANS_PER_LINK, connectionPieces, connectionsGraph, hasLine, pickDetails, spanDetails } from '../connections/model.ts';
import { useLayout } from '../state/use-layout.ts';
import {
  linkColors, linkGeometry, linkStates, linksLegend, linksOfBlock, linksSummary, solidColumns, spansShown, type LinkGeometry, type LinksSummary,
} from '../three/link-geometry.ts';
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
  /** Whether the Connections tab's links are drawn over the line (Show connections). */
  showLinks: boolean; onShowLinks(on: boolean): void;
  /** What the drawn links are, under the view while they show. */
  linksNote?: string | null;
  // optional additions (the review of f82c98c)
  /** What each colour of the drawn links means, shown as swatches under the note. */
  linksLegend?: ReadonlyArray<{ rgb: Rgb; label: string }>;
  /** Whether Focus shows only the links of the block under the pointer or clicked; its toggle shows while the links do. */
  focus?: boolean; onFocus?(on: boolean): void;
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
/** A line whose only new machines are farms (add-on 17): they have no blocks to draw, only areas kept for them. */
const FARMS_ONLY_TEXT = 'Nothing to draw here — the new machines are farms: build each in the area its build step names';
/** Set to '1' (by the end-to-end test) to keep the canvas readable with readPixels. */
const PRESERVE_BUFFER_KEY = 'gp.test.preserveDrawingBuffer';
/** A pointer that moved further than this between press and release was turning the view, not clicking a block. */
const CLICK_SLOP_PX = 4;
/** Whether this browser draws the Connections links in the 3D view: kept in this browser only, off until turned on. */
export const LINKS_STORAGE_KEY = 'gtnh-planner:3d-connections';
/** Whether this browser's Show connections shows only the links of one block (Focus): kept like the toggle above. */
export const FOCUS_STORAGE_KEY = 'gtnh-planner:3d-connections-focus';

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

/** Whether this browser asked for Show connections (or, with `key`, for Focus); off when storage is refused or holds anything else. */
export function loadShowLinks(key: string = LINKS_STORAGE_KEY): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function saveShowLinks(on: boolean, key: string = LINKS_STORAGE_KEY): void {
  try {
    globalThis.localStorage?.setItem(key, on ? '1' : '0');
  } catch {
    // kept for this page only
  }
}

function Controls(props: Pick<View3DShellProps, 'maxLayer' | 'onLayer' | 'show' | 'onShow' | 'showLinks' | 'onShowLinks' | 'focus' | 'onFocus'> & { height: number }): ReactElement {
  const { maxLayer, onLayer, show, onShow, showLinks, onShowLinks, height } = props;
  return (
    <div className="row view3d-controls">
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
        <span className="view3d-layer-text">{layerText(maxLayer, height)}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={show.ghosts} onChange={(e) => onShow({ ...show, ghosts: e.currentTarget.checked })} />
        Ghosts
      </label>
      <label className="check">
        <input type="checkbox" checked={show.hookups} onChange={(e) => onShow({ ...show, hookups: e.currentTarget.checked })} />
        Hookups
      </label>
      <label className="check">
        <input type="checkbox" checked={showLinks} onChange={(e) => onShowLinks(e.currentTarget.checked)} />
        Show connections
      </label>
      {showLinks && props.onFocus !== undefined && (
        <label className="check" title="Only the links of the block under the pointer, or of the block you click">
          <input type="checkbox" checked={props.focus === true} onChange={(e) => props.onFocus?.(e.currentTarget.checked)} />
          Focus
        </label>
      )}
    </div>
  );
}

/** The drawn links' colours, each a swatch with what it means. */
function LinksLegend(props: { legend: ReadonlyArray<{ rgb: Rgb; label: string }> }): ReactElement {
  return (
    <ul data-testid="view3d-links-legend" className="muted small view3d-legend">
      {props.legend.map(({ rgb, label }) => (
        <li key={`${rgb.join()}|${label}`}>
          <span aria-hidden="true" style={{ background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

function BlockInfo(props: { info: Info }): ReactElement {
  const { title, lines } = props.info;
  return (
    <section data-testid="view3d-info" aria-live="polite" className="view3d-box view3d-details">
      {/* a picked link is titled with its rate ("Titanium Dust 60/min · Red"): its figures are VT323 (Phase 2 spec §25, ruling P2-R15) */}
      <h3><Figs text={title} /></h3>
      {lines.length > 0 && (
        <ul className="small">
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
    <section data-testid="block-list" aria-labelledby={headingId} className="view3d-box">
      <h3 id={headingId}>Blocks to place</h3>
      <ul className="small">
        {place.map((row, i) => <li key={`${i}|${row.label}`}>{`${row.label} ×${row.count}`}</li>)}
      </ul>
      {hookups.length > 0 && (
        <>
          <h4>Hookups</h4>
          <ul className="small">
            {hookups.map((text, i) => <li key={`${i}|${text}`}>{text}</li>)}
          </ul>
        </>
      )}
      <p className="small view3d-size">{`Size: ${size}`} <span className="muted">(W×L×H)</span></p>
    </section>
  );
}

function Warnings(props: { layout: Layout }): ReactElement | null {
  const { warnings } = props.layout;
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Warnings" className="view3d-box view3d-warnings">
      <h3>Warnings</h3>
      <ul className="small">
        {warnings.map((w, i) => <li key={`${w.code}:${i}`}>{w.text}</li>)}
      </ul>
    </section>
  );
}

/**
 * The tab without the viewer: what is happening (an error, laying out, beside a skeleton of the scene while the first layout is on its way,
 * no WebGL2, nothing to build, only farms to build, which have no blocks), the canvas with
 * the hover label over it, the layer slider and the Ghosts, Hookups and Show connections toggles (with what the drawn
 * links are while they show), and beside them the clicked block's or link's details (where they show without
 * scrolling), the side list and the layout's warnings below it. Without WebGL2 only the side list and the warnings show.
 */
export function View3DShell(props: View3DShellProps): ReactElement {
  const { layout, loading, error, webgl, hover, info, canvas, names } = props;
  const blocks = layout !== null && layout.blocks.length > 0;
  const warned = layout !== null && layout.warnings.length > 0;
  const farmsOnly = layout !== null && layout.status !== 'empty' && !blocks && (layout.reserved?.length ?? 0) > 0;
  return (
    <div className="view3d" data-testid="view3d">
      {error !== null && <p className="error">{error}</p>}
      {loading && <p className="muted">{LOADING_TEXT}</p>}
      {loading && layout === null && <Skeleton shape="scene" />}
      {!webgl && <p className="muted">{NO_WEBGL_TEXT}</p>}
      {layout?.status === 'empty' && <p className="muted">{props.noSteps === true ? NO_STEPS_TEXT : ALL_OWNED_TEXT}</p>}
      {farmsOnly && <p className="muted">{FARMS_ONLY_TEXT}</p>}
      {layout !== null && (blocks || warned) && (
        <div className="view3d-body">
          {blocks && webgl && (
            <div className="view3d-main">
              <div data-testid="view3d-canvas" className="view3d-viewport">
                {canvas}
                {hover !== null && <p data-testid="view3d-hover" className="view3d-hover"><Figs text={hover} /></p>}
              </div>
              <Controls maxLayer={props.maxLayer} onLayer={props.onLayer} show={props.show} onShow={props.onShow} showLinks={props.showLinks}
                onShowLinks={props.onShowLinks} height={layout.size[1]} {...(props.onFocus === undefined ? {} : { focus: props.focus === true, onFocus: props.onFocus })} />
              <p className="muted small">Drag to turn, right-drag to pan, scroll to zoom; click a block for its details.</p>
              {props.showLinks && props.linksNote != null && (
                <p data-testid="view3d-links" className="muted small">{props.linksNote}</p>
              )}
              {props.showLinks && props.linksLegend !== undefined && props.linksLegend.length > 0 && <LinksLegend legend={props.linksLegend} />}
            </div>
          )}
          <div className="view3d-side">
            {info !== null && <BlockInfo info={info} />}
            {blocks && <BlockList layout={layout} names={names} />}
            <Warnings layout={layout} />
          </div>
        </div>
      )}
    </div>
  );
}

/** How many of the links the note names one by one before it counts the rest. */
const UNPLACED_NAMED = 3;

/** How the drawn links are coloured and shown: the line's logistics mode, the one channel every flow rides when goods get colours of their own, and Focus. */
export interface LinksNoteHow { mode: LogisticsMode; byGood: DyeColor | null; focus: boolean }

/** What the colours of the drawn links mean, in a mode's words (the legend under the note shows each colour). */
function coloursText(how: LinksNoteHow): string {
  if (how.byGood !== null) return `Every flow rides the ${DYE_NAMES[how.byGood]} channel, so each good has a colour of its own; hovering a link names its good and channel.`;
  return how.mode === 'enderio' ? "Each is in its EnderIO channel's colour, as on the Connections tab."
    : 'Each is in the colour of what carries it, as on the Connections tab.';
}

/** The first few of `names`, then how many more. */
function someOf(names: readonly string[]): string {
  const more = names.length - UNPLACED_NAMED;
  return [...names.slice(0, UNPLACED_NAMED), ...(more > 0 ? [`and ${fmtInt(more)} more`] : [])].join('; ');
}

/**
 * What the drawn links are, under the view: how many links, and in how many pieces when that is more (a flow drawn from
 * each face that gives to each that takes), what their arrows and colours say (in the line's logistics mode's words,
 * the legend beside it) and what hovering, clicking and Focus do; then how many pieces of links between big steps are
 * left out, how many links hide with the hookups, an AE2 line's raw inputs and final outputs that have no ME network to
 * come from or go to, and the links of the Connections tab it has nowhere in the line to draw, the first few by name.
 */
export function linksNoteText(drawn: LinksSummary | null, how: LinksNoteHow = { mode: 'enderio', byGood: null, focus: false }): string {
  if (drawn === null) return 'Nothing to connect yet: the plan has no line to lay out';
  const { pieces, links, unplaced, noNetwork, more, hidden } = drawn;
  const what = `${pieces === links ? '' : `${fmtInt(pieces)} pieces of `}${fmtInt(links)} connection${links === 1 ? '' : 's'}`;
  const told = links === 0 ? ['No connections to draw'] : [
    `${what} drawn, each from the face that gives to the face that takes, the arrow pointing the way. ${coloursText(how)}`,
    `Hover one for what it carries; click it to mark its two faces.${how.focus ? ' Focus shows only the links of the block under the pointer, or of the block you click.' : ''}`,
  ];
  const rest = [
    ...(more > 0 ? [`Links between big steps are drawn with at most ${SPANS_PER_LINK} pieces each: ${fmtInt(more)} more piece${more === 1 ? ' is' : 's are'} not drawn`] : []),
    ...(hidden > 0 ? [`${fmtInt(hidden)} more connection${hidden === 1 ? ' is' : 's are'} hidden with the hookups`] : []),
    ...(noNetwork.length > 0 ? [`Raw inputs and final outputs are not drawn, as the base has no ME network to hook into: ${someOf(noNetwork)}`] : []),
    ...(unplaced.length > 0 ? [`Not drawn, with nowhere in the line to draw ${unplaced.length === 1 ? 'it' : 'them'}: ${someOf(unplaced)}`] : []),
  ];
  return rest.length === 0 && links === 0 ? told[0]! : [...told, ...rest].map((t) => (t.endsWith('.') ? t : `${t}.`)).join(' ');
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
 * previous viewer first, and clears the hover label and the details, which named its blocks. While Show connections is
 * on, the Connections tab's graph of the layout (rates per hour in Make N mode, else per the settings' unit) gives the
 * links the viewer draws (clear of the line's solid blocks, a single-channel EnderIO line's coloured by good), a
 * hookup's left out while hookups are hidden, and the note and legend under the view (`linksSummary`); new links let a
 * picked one go. The link under the pointer is drawn thicker and the others fade; with Focus on, only the links of the
 * block under the pointer show, or of the block last clicked until a click elsewhere.
 */
export default function View3D(props: ProjectViewProps): ReactElement {
  const { project, plan } = props;
  const line = useLayout(project.id, plan, project);
  const { layout } = line;
  const [webgl] = useState(webgl2Available);
  const [maxLayer, setMaxLayer] = useState<number | null>(null);
  const [show, setShow] = useState<Show>({ ghosts: true, hookups: true });
  const [showLinks, setShowLinks] = useState(() => loadShowLinks());
  const [focus, setFocus] = useState(() => loadShowLinks(FOCUS_STORAGE_KEY));
  const [hover, setHover] = useState<string | null>(null);
  /** The drawn link under the pointer, the block under it, and the block Focus keeps after a click. */
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const [hoverBlock, setHoverBlock] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  /** The clicked block's or link's details; `link` when they are a link's. */
  const [info, setInfo] = useState<(Info & { link?: true }) | null>(null);
  const [pickedLink, setPickedLink] = useState<number | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The viewer on the canvas and the layout it draws (block indices from `pick` refer to it). */
  const built = useRef<{ viewer: Viewer; layout: Layout } | null>(null);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  // A slider position at or above a new, lower layout's height shows all of it.
  const shownLayer = maxLayer !== null && layout !== null && maxLayer < layout.size[1] ? maxLayer : null;
  const per = project.settings.mode === 'makeN' ? 'hour' : project.settings.per;
  const graph = useMemo(
    () => (showLinks && plan !== null && layout !== null && hasLine(plan, layout) ? connectionsGraph(layout, plan, per) : null),
    [showLinks, plan, layout, per],
  );
  const drawnLinks = useMemo((): { geometry: LinkGeometry; summary: LinksSummary; legend: Array<{ rgb: Rgb; label: string }>; byGood: DyeColor | null } | null => {
    if (graph === null || layout === null) return null;
    const all = connectionPieces(layout, graph);
    const colours = linkColors(graph);
    const geometry = linkGeometry(spansShown(all.spans, graph, layout, show.hookups), new Map(graph.edges.map((e) => [e.id, e])), layout.origin,
      { solid: solidColumns(layout), color: colours.color });
    return { geometry, summary: linksSummary(graph, all, geometry.links, show.hookups, layout), legend: linksLegend(graph, geometry.links, colours.byGood !== null),
      byGood: colours.byGood };
  }, [graph, layout, show.hookups]);
  const links = drawnLinks?.geometry ?? null;
  // Focus: the links of the block clicked last, else of the block under the pointer
  const focusBlock = focus ? pinned ?? hoverBlock : null;
  const states = useMemo(() => {
    const hovered = hoverLink !== null && hoverLink < (links?.links.length ?? 0) ? hoverLink : null;   // not one of links before these
    if (links === null || graph === null || layout === null || (hovered === null && focusBlock === null)) return null;
    return linkStates(links.links, hovered, focusBlock === null ? null : linksOfBlock(graph, layout, focusBlock));
  }, [links, graph, layout, hoverLink, focusBlock]);
  const latest = useRef<{ shownLayer: number | null; show: Show; links: LinkGeometry | null; states: Float32Array | null; hoverLink: number | null }>(
    { shownLayer, show, links, states, hoverLink });

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
        viewer.setLinks(latest.current.links);
        viewer.setLinkStates(latest.current.states);
        viewer.setHoveredLink(latest.current.hoverLink);
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
  useEffect(() => {
    latest.current.links = links;
    built.current?.viewer.setLinks(links);
    setPickedLink(null);
    setHoverLink(null);
    setInfo((was) => (was?.link === true ? null : was));
  }, [links]);
  useEffect(() => {
    built.current?.viewer.setSelectedLink(pickedLink);
  }, [pickedLink]);
  useEffect(() => {
    latest.current.hoverLink = hoverLink;
    latest.current.states = states;
    built.current?.viewer.setLinkStates(states);
    built.current?.viewer.setHoveredLink(hoverLink);
  }, [states, hoverLink]);
  useEffect(() => setPinned(null), [layout, focus]);
  const onShowLinks = (on: boolean): void => {
    saveShowLinks(on);
    setShowLinks(on);
  };
  const onFocus = (on: boolean): void => {
    saveShowLinks(on, FOCUS_STORAGE_KEY);
    setFocus(on);
  };

  // The canvas's size and its lack of an edge are the stylesheet's (`.view3d-scene`); its cursor follows what is under the pointer.
  const canvas = (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="The new line in 3D"
      className="view3d-scene"
      style={{ cursor: hover === null ? 'grab' : 'pointer' }}
      onPointerDown={(e) => {
        pressedAt.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const view = built.current;
        if (view === null) return;
        const hit = view.viewer.pick(e.clientX, e.clientY);
        // a link says what the Connections tab writes on it
        if (hit?.kind === 'link') setHover(graph === null ? null : pickDetails(graph, { edge: hit.link.span.edge })?.title ?? null);
        else setHover(hit === null ? null : hoverText(view.layout, plan, hit.block));
        setHoverLink(hit?.kind === 'link' ? hit.index : null);
        // Focus follows the block under the pointer; over a link or nothing it stays on the last one
        if (hit?.kind === 'block') setHoverBlock(hit.block);
      }}
      onPointerLeave={() => {
        setHover(null);
        setHoverLink(null);
        setHoverBlock(null);
      }}
      onClick={(e) => {
        const from = pressedAt.current;
        pressedAt.current = null;
        if (from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP_PX) return;   // the end of a drag
        const view = built.current;
        if (view === null) return;
        const hit = view.viewer.pick(e.clientX, e.clientY);
        const details = hit?.kind === 'link' && graph !== null ? spanDetails(graph, hit.link.span) : null;
        setPickedLink(hit?.kind === 'link' && details !== null ? hit.index : null);
        if (hit?.kind === 'link') setInfo(details === null ? null : { ...details, link: true });
        else setInfo(hit === null ? null : pickInfo(view.layout, plan, hit.block));
        // Focus keeps the block clicked; a click on nothing lets it go
        if (hit?.kind !== 'link') setPinned(hit === null ? null : hit.block);
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
      showLinks={showLinks}
      onShowLinks={onShowLinks}
      linksNote={showLinks ? linksNoteText(drawnLinks === null ? null : drawnLinks.summary, { mode: layout?.mode ?? 'direct', byGood: drawnLinks?.byGood ?? null, focus }) : null}
      linksLegend={drawnLinks?.legend ?? []}
      focus={focus}
      onFocus={onFocus}
    />
  );
}
