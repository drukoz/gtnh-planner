// The Connections tab (plan 11 Task 8; spec §3.8c; architecture §7.2 and "EnderIO conduits, granted change requests
// (add-on 11)"): the laid-out line as a schematic of boxes and links, from the pure model in ../connections/model.ts.
// Every placed machine, chest, interface and hookup is a box whose rows name its configured faces (a conduit face with
// its mode and channels under it), and every flow is a pipe whose contents move toward the box it enters, in the colour
// of what carries it or of its EnderIO channel (design spec §7). ELK lays the boxes out in its worker, and a drag moves
// the picture, the wheel zooms it and Fit shows all of it (./pan-zoom.ts), as for the flow diagram; a click on a box, one
// of its face rows or a link shows its full configuration in the side panel, and a picked link marks the face rows it
// leaves and enters. When the panel opens or closes beside it, the picture is fitted again if it still is the fitted one,
// else keeps its middle (the review of 401d0ca). The Fit button pans the picture there over 250 ms (Phase 2 spec §16.2, P2-D20), and a
// new picture glides into place from the last over 260 ms (§16.3).

import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement,
} from 'react';
import { isFluidKey } from '../../shared/keys.ts';
import { DYE_HEX } from '../../shared/layout/enderio.ts';
import type { DyeColor, Layout } from '../../shared/types/layout.ts';
import type { Plan } from '../../shared/types/plan.ts';
import { messageOf } from '../api/client.ts';
import { Figs } from '../components/Figs.tsx';
import { focusMain, focusOn } from '../components/focus.ts';
import { PipesButton } from '../components/PipesButton.tsx';
import { SHEET_KEY_HINT } from '../components/ShortcutsSheet.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { tipText } from '../components/tooltip-model.ts';
import {
  CONN_LINE_HEIGHT, CONN_TITLE_HEIGHT, connectionsElk, connectionsFromElk, connectionsGraph, faceLines, faceModeText, hasLine, pickDetails,
  type ConnEdge, type ConnFace, type ConnGraph, type ConnLayout, type ConnPick, type ConnVia,
} from '../connections/model.ts';
import { usePipesPaused } from '../state/pipes-paused.ts';
import { useSingleKeyShortcuts } from '../state/single-key-shortcuts.ts';
import { useLayout } from '../state/use-layout.ts';
import { layoutFlow } from '../workers/elk.worker.ts';
import { layoutChange } from './flow-model.ts';
import { glideLayout, usePan, type GlideTargets, type PanView } from './glide.ts';
import { DRAG_THRESHOLD, fitView, pointIn, resizeView, sameView, wheelFactor, zoomAround, type Size, type View } from './pan-zoom.ts';
import { pipeAnimationMode, pipeSeconds } from './pipe-motion.ts';
import type { ProjectViewProps } from './project-tabs.ts';

export interface ConnectionsShellProps {
  plan: Plan | null; layout: Layout | null; loading: boolean; error: string | null /* layout fetch */;
  graph: ConnGraph | null; picture: ConnLayout | null; layoutError: string | null /* ELK */; pick: ConnPick | null; onPick(pick: ConnPick | null): void;
}

type PlacedNode = ConnLayout['nodes'][number];
type PlacedEdge = ConnLayout['edges'][number];
type Details = NonNullable<ReturnType<typeof pickDetails>>;

const PLANNING_TEXT = 'Planning…';
const EMPTY_PLAN_TEXT = 'Pick something to make in the settings';
const INFEASIBLE_TEXT = 'This line cannot be planned yet, so there is nothing to connect';
const LAYING_OUT_TEXT = 'Laying out the line…';
const NOTHING_TEXT = 'Nothing to connect yet: the line places no new machines';
const DRAWING_TEXT = 'Drawing the connections…';
const HINT_TEXT = 'Drag or use the arrow keys to move, scroll to zoom; click a box, a face row or a link for its full configuration.';
const loadFailed = (error: string): string => `Could not load the layout: ${error}`;
const drawFailed = (error: string): string => `Could not lay out the connections: ${error}`;

/** What carries a link, for each kind of link the picture holds, in this order; an attached link needs no entry. */
const LEGEND: ReadonlyArray<readonly [Exclude<ConnVia, 'attached'>, string]> = [
  ['gt_pipe', 'Shared GT item pipe'], ['fluid_pipe', 'GT fluid pipe'], ['routed', 'Project Red routed network'], ['ae2', 'ME network'],
  ['item_conduit', 'Item Conduit (line colour = channel)'], ['fluid_conduit', 'Ender fluid conduit (line colour = channel)'],
  ['hand', 'By hand (a machine the line runs by hand)'], ['hookup', 'Hookup to the base'],
];

/** Box text: its inset from the left, the title's baseline, and a line's or face row's baseline below the top of its row. */
const TEXT_LEFT = 8;
const TITLE_BASELINE = 19;
const ROW_BASELINE = 11;
/** The boxes' corner radius: none, as every Machine GUI box (design spec §4). */
const CORNER = 0;
/** A box's face rows start below a divider this far under its last line, and this far below the divider. */
const DIVIDER_GAP = 2;
/**
 * A box text longer than this many characters shows its first that many and '…' (plan 11, Task 8's review ruling): a
 * title (13 px bold) and a line or face row (11.5 px). Measured for a box `CONN_NODE_WIDTH` (260 px) wide: cut there,
 * every title and face row of the pack's machines and hatches fits with 8 px to spare on each side. The box's tooltip
 * and accessible name, and the panel, hold the whole text.
 */
const TITLE_CHARS = 32;
const ROW_CHARS = 38;
/** A conduit face's mode line (10.5 px): the longest, `In / Out · in Light Blue · out Light Gray`, has 41 characters. */
const MODE_CHARS = 42;
/** Room around the fitted picture, in screen pixels, as in the flow diagram. */
const PAD = 16;
/** An arrow key moves the picture this far (px), the way it scrolls a page: → shows more of its right. */
const KEY_PAN = 40;
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
/**
 * The channel dyes too dark to read on a pipe's dark casing (under 3:1 on #1b1b1b; Red, the line's first channel, is
 * 2.8:1): their pipes get a panel-grey casing instead, on which each reads at 3.6:1 or more (design spec §7).
 */
const DARK_DYES: ReadonlySet<DyeColor> = new Set(['black', 'brown', 'blue', 'gray', 'green', 'purple', 'red']);

/** What a new picture glides (./glide.ts): its boxes and its links. */
const CONN_GLIDE: GlideTargets = { boxes: ['data-node'], edges: 'data-edge' };

/** A view as its pan's (./glide.ts): the zoom `k` is the pan group's scale. */
function toPan(v: View): PanView {
  return { x: v.x, y: v.y, scale: v.k };
}

/** A pan's picture as a view. */
function fromPan(p: PanView): View {
  return { x: p.x, y: p.y, k: p.scale };
}

/** `text`, or its first `max` characters and '…' when it is longer, so the box shows where its text is cut. */
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

/** Where a box's face rows begin: the divider under its title and lines. */
function facesTop(node: PlacedNode): number {
  return CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT * node.lines.length + DIVIDER_GAP;
}

/** The face rows' part of a box, from `top` down to its bottom corners (rounded by CORNER, square while it is 0). */
function facesOutline(width: number, top: number, bottom: number): string {
  const r = CORNER;
  return `M 0 ${top} H ${width} V ${bottom - r} A ${r} ${r} 0 0 1 ${width - r} ${bottom} H ${r} A ${r} ${r} 0 0 1 0 ${bottom - r} Z`;
}

/** A face row in the box's tooltip and accessible name: its title, and a conduit face's mode after a dash. */
function faceTip(face: ConnFace): string {
  return face.mode === undefined ? face.title : `${face.title} — ${faceModeText(face.mode)}`;
}

/**
 * One box: its title, its lines and, under a divider, a row per face: its title, and under it a conduit face's mode
 * and channels (`faceModeText`). The rect is the box above the face rows (the whole box when it has none): a click on
 * it, or on the face rows' background, picks the box, and a click on either line of a face row picks that face. Only the
 * face rows take clicks among the texts, so the middle of the rect is always the rect's own. A face row is `selected`
 * when picked and `linked` when the picked link leaves or enters through it (`linked` holds those faces). A text too
 * long for the box ends in '…' (`cut`), and the box's tooltip and accessible name (its `data-tip` and `aria-label`, as
 * in the flow diagram: Phase 2 spec §6.4) hold every text in full, one per line of the tooltip; the panel shows a picked
 * one in full too. The nested svg still clips anything wider than the box.
 */
function NodeShape(props: { node: PlacedNode; pick: ConnPick | null; linked: ReadonlySet<string>; onPick(pick: ConnPick): void }): ReactElement {
  const { node, pick, linked, onPick } = props;
  const picked = pick !== null && 'node' in pick && pick.node === node.id ? pick : null;
  const top = facesTop(node);
  const tip = tipText([node.title, ...node.lines, ...node.faces.map(faceTip)]);
  const pickBox = (): void => onPick({ node: node.id });
  /** Each face row's first line, counted from the divider. */
  let lines = 0;
  const rowStart = node.faces.map((face) => {
    const at = lines;
    lines += faceLines(face);
    return at;
  });
  return (
    <g
      data-node={node.id} className={`conn-node conn-${node.kind}${picked === null ? '' : ' selected'}`} transform={`translate(${node.x} ${node.y})`}
      aria-label={tip} data-tip={tip}
    >
      {/* the face rows' part, drawn over the rect's lower edge (and its corners, were they rounded), gives the box one outline */}
      <rect width={node.width} height={node.faces.length === 0 ? node.height : top + CORNER} rx={CORNER} onClick={pickBox} />
      {node.faces.length > 0 && <path d={facesOutline(node.width, top, node.height)} onClick={pickBox} />}
      <svg width={node.width} height={node.height}>
        <text className="conn-title" x={TEXT_LEFT} y={TITLE_BASELINE}>{cut(node.title, TITLE_CHARS)}</text>
        {node.lines.map((line, i) => (
          <text key={`${i}:${line}`} className="conn-line" x={TEXT_LEFT} y={CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT * i + ROW_BASELINE}>{cut(line, ROW_CHARS)}</text>
        ))}
        {node.faces.map((face, i) => {
          const state = picked?.face === face.id ? ' selected' : linked.has(face.id) ? ' linked' : '';
          const y = top + DIVIDER_GAP + CONN_LINE_HEIGHT * rowStart[i]! + ROW_BASELINE;
          const pickFace = (): void => onPick({ node: node.id, face: face.id });
          return (
            <Fragment key={face.id}>
              <text className={`conn-face${state}`} data-face={face.id} x={TEXT_LEFT} y={y} onClick={pickFace}>{cut(face.title, ROW_CHARS)}</text>
              {face.mode !== undefined && (
                <text className={`conn-face-mode${state}`} data-face={face.id} x={TEXT_LEFT} y={y + CONN_LINE_HEIGHT} onClick={pickFace}>
                  {cut(faceModeText(face.mode), MODE_CHARS)}
                </text>
              )}
            </Fragment>
          );
        })}
      </svg>
    </g>
  );
}

/** Where a link's label goes when ELK placed none (no route came back): halfway along its middle segment. */
function labelPoint(points: ReadonlyArray<[number, number]>): [number, number] {
  const i = Math.floor((points.length - 2) / 2);
  const [ax, ay] = points[i]!;
  const [bx, by] = points[i + 1]!;
  return [(ax + bx) / 2, (ay + by) / 2];
}

/**
 * One link, drawn as a pipe (design spec §7): the rim a hovered or picked link shows round it, the casing, and what the
 * link carries moving inside from the box it leaves toward the box it enters (the points run that way), at the speed of
 * its rate (`--pipe-dur` from `pipeSeconds`), in its channel's colour when it has one (else its class colours it by what
 * carries it), ending in the arrow head into that box; then its label. A channel too dark for the dark casing gets a
 * panel-grey one (`--pipe-casing`). A link that carries nothing (an interface attached to what it serves, a hookup) is
 * its casing alone, a thin still line, which ends in the arrow head but for an interface's. A click picks it.
 */
function EdgeShape(props: { edge: PlacedEdge; selected: boolean; onPick(pick: ConnPick): void }): ReactElement | null {
  const { edge, selected, onPick } = props;
  if (edge.points.length < 2) return null;
  const [lx, ly] = edge.labelAt ?? labelPoint(edge.points);
  const points = edge.points.map(([x, y]) => `${x},${y}`).join(' ');
  const moving = edge.perSecond > 0;
  const arrow = edge.via === 'attached' ? {} : { markerEnd: 'url(#conn-arrow)' };
  const pipeVars = {
    ...(moving ? { '--pipe-dur': `${pipeSeconds(edge.perSecond, edge.key !== null && isFluidKey(edge.key))}s` } : {}),
    ...(edge.color !== null && DARK_DYES.has(edge.color) ? { '--pipe-casing': 'var(--dye-casing)' } : {}),
  } as CSSProperties;
  return (
    <g data-edge={edge.id} className={`conn-edge conn-via-${edge.via}${selected ? ' selected' : ''}`} style={pipeVars} onClick={() => onPick({ edge: edge.id })}>
      <polyline className="conn-edge-rim" points={points} />
      <polyline className="conn-edge-line" points={points} {...(moving ? {} : arrow)} />
      {moving && <polyline className="conn-edge-flow" points={points} {...(edge.color === null ? {} : { stroke: DYE_HEX[edge.color] })} {...arrow} />}
      {edge.label !== '' && <text className="conn-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">{edge.label}</text>}
    </g>
  );
}

/**
 * The picture, under a Fit button and the Pause pipes button (ruling R31: paused, the area's `data-pipes` is `paused` and no pipe
 * moves), in an area as tall as the picture at its own size (at most 75vh) that moves and
 * zooms it as the flow diagram does: a press becomes a drag once the pointer itself has moved DRAG_THRESHOLD px on the
 * page, from a box too, and the drag moves the picture by what the pointer moved over the area (so the spot it grabbed
 * stays under the pointer while the area moves on the page; ledger ruling P2-R16). A press the area moves under stays a
 * click: a plain click still picks, and the click that ends a drag picks nothing. The wheel or a pinch zooms around the
 * pointer, and the arrow keys move it while the area has focus. Fit, also when the picture first shows and whenever its
 * boxes change, shows all of it. When the area changes size (the side panel opening or closing beside it), the view is
 * fitted again while nothing has moved or zoomed it since it was fitted, else it keeps the spot in its middle
 * (`resizeView`). The links come first, then the boxes over them. A group, not an image, so assistive technology reads
 * the boxes, rows and links inside it, as for the flow diagram (plan 11, Task 8's review ruling). The Fit button pans the
 * picture over 250 ms (Phase 2 spec §16.2, P2-D20: `usePan`), its attribute the fitted view at once; every other move is
 * instant and ends a pan under way, the wheel, the drag and the arrow keys from the picture on screen (review focus 1),
 * a refit from the view it was going to, the fitted one. A new picture glides into place from the last (§16.3, `glideLayout`),
 * inside the view it is drawn in, which a new picture of other boxes fits at once first: one motion a box at a time.
 */
function Picture(props: { picture: ConnLayout; pick: ConnPick | null; busy: boolean; onPick(pick: ConnPick): void }): ReactElement {
  const { picture, pick, busy, onPick } = props;
  const pickedEdge = pick !== null && 'edge' in pick ? pick.edge : null;
  // the face rows the picked link leaves and enters through
  const linked = useMemo(() => {
    const edge = pickedEdge === null ? undefined : picture.edges.find((e) => e.id === pickedEdge);
    return new Set([edge?.fromFace, edge?.toFace].filter((f): f is string => f !== null && f !== undefined));
  }, [picture, pickedEdge]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
  /** The pan group (`g.conn-pan`), whose attribute is the view; Fit pans there (`glideTo`), `holdView` holds a pan for an instant move. */
  const { panRef, glideTo, holdView } = usePan(view, setView, toPan, fromPan);
  const [dragging, setDragging] = useState(false);
  /** The pipes stand still where they are: this browser's Pause pipes (ruling R31). */
  const pipesPaused = usePipesPaused();
  /** Whether the single-key shortcuts act, so Fit and Pause pipes say their keys, and the hint the sheet's (ledger ruling P2-R85). */
  const keysOn = useSingleKeyShortcuts();
  /**
   * The press that may become a drag: its pointer, where it went down on the page (`cx`, `cy`: client px) and in the area (`sx`, `sy`:
   * `pointIn`), and the view then (the picture on screen once it is a drag, when a pan was under way).
   */
  const drag = useRef<{ pointer: number; cx: number; cy: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  // The view is fitted again only when the boxes change, not when someone else's change only moves a rate.
  const shape = useMemo(() => picture.nodes.map((n) => n.id).join('\n'), [picture]);
  /** The picture drawn before, which a new one glides from (`layoutChange`); null before the first. */
  const placedBefore = useRef<ConnLayout | null>(null);
  /** The view the last fit gave, the area's size then (or at its last change), and the latest view and picture. */
  const fitted = useRef<View | null>(null);
  const area = useRef<Size>({ width: 0, height: 0 });
  const latest = useRef({ view, picture });
  useEffect(() => {
    latest.current = { view, picture };
  }, [view, picture]);

  /** Fits the picture: panned to by the Fit button (`glide`), at once when it first shows and when its boxes change. */
  const fit = (glide = false): void => {
    const svg = svgRef.current;
    const size = { width: svg?.clientWidth ?? 0, height: svg?.clientHeight ?? 0 };
    const next = fitView(picture, size, PAD);
    area.current = size;
    fitted.current = next;
    latest.current.view = next;
    if (glide) glideTo(next);
    else setView(next);
  };
  useLayoutEffect(() => fit(), [shape]);   // reads the current picture; only a change of boxes refits
  // A new picture glides into place from the last, before it is painted (Phase 2 spec §16.3): its boxes that moved, came and went, and its
  // links that changed (no ghosts here: Flow's). One of other boxes was fitted at once just above, so its view is drawn as it lands, in this
  // frame, and the boxes glide inside that view: no pan runs with them (the refit is never panned), so a box moves along one path only. The
  // first picture, and StrictMode's second run of this effect, which finds the same one, change nothing.
  useLayoutEffect(() => {
    const change = layoutChange(placedBefore.current, picture);
    placedBefore.current = picture;
    const pan = panRef.current;
    if (pan !== null) glideLayout(pan, change, CONN_GLIDE);
  }, [picture]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null || typeof ResizeObserver === 'undefined') return undefined;
    const resized = new ResizeObserver(() => {
      const before = area.current;
      const after = { width: svg.clientWidth, height: svg.clientHeight };
      if (after.width === before.width && after.height === before.height) return;
      area.current = after;
      // while Fit pans, the view is the fitted one it is going to, so a fitted view is fitted again; the view set ends the pan
      const { view: was, picture: shown } = latest.current;
      const refit = fitted.current !== null && sameView(was, fitted.current);
      const next = resizeView(was, fitted.current, shown, before, after, PAD);
      if (refit) fitted.current = next;   // a view fitted again is still the fitted one
      latest.current.view = next;
      setView(next);
    });
    resized.observe(svg);
    return () => resized.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    // React's wheel listener is passive, so it cannot stop the page from scrolling (or zooming, on a pinch); this can. It zooms the picture
    // on screen at once: a pan under way stops where it is (review focus 1).
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = svg.getBoundingClientRect();
      const factor = wheelFactor(e.deltaY, e.deltaMode === WheelEvent.DOM_DELTA_LINE);
      const held = holdView();
      setView((v) => zoomAround(held ?? v, e.clientX - box.left, e.clientY - box.top, factor));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 || drag.current !== null) return;   // one pointer at a time moves the picture
    const [sx, sy] = pointIn(e);
    drag.current = { pointer: e.pointerId, cx: e.clientX, cy: e.clientY, sx, sy, ox: view.x, oy: view.y, moved: false };
  };
  const onPointerEnd = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    setDragging(false);
    dragged.current = true;   // the click that ends a drag picks nothing
    setTimeout(() => {
      dragged.current = false;
    }, 0);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      onPointerEnd(e);   // released outside the picture before the drag began, so the svg never heard it
      return;
    }
    if (!d.moved) {
      // the pointer's own move decides: a still press stays a click while the area moves under it (P2-R16)
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);   // only now: a plain click must still reach the box under it
      // a pan under way stops where it is on screen, and the drag carries on from that picture, its zoom too, as the move below sets x and y
      // only (review focus 1); a click lets it run on
      const held = holdView();
      if (held !== null) {
        setView(held);
        d.ox = held.x;
        d.oy = held.y;
      }
    }
    // the drag follows the area: the spot it grabbed stays under the pointer while the area moves on the page (`pointIn`, P2-R16)
    const [px, py] = pointIn(e);
    setView((v) => ({ ...v, x: d.ox + px - d.sx, y: d.oy + py - d.sy }));
  };
  const pickUnlessDragged = (p: ConnPick): void => {
    if (!dragged.current) onPick(p);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>): void => {
    const step = PAN_KEYS[e.key];
    if (step === undefined || e.altKey || e.ctrlKey || e.metaKey) return;   // Alt+← is the browser's Back
    e.preventDefault();   // the page does not scroll too
    const held = holdView();   // from the picture on screen, where a pan under way stops
    setView((v) => {
      const from = held ?? v;
      return { ...from, x: from.x + step[0] * KEY_PAN, y: from.y + step[1] * KEY_PAN };
    });
  };

  return (
    <>
      <div className="conn-toolbar row">
        <button
          type="button" className="small" aria-keyshortcuts={keysOn ? 'F' : undefined} data-tip={keysOn ? 'Fit · F' : undefined}
          onClick={() => fit(true)}
        >
          Fit
        </button>
        <PipesButton paused={pipesPaused} keys={keysOn} />
        <span className="muted small">{HINT_TEXT}{keysOn && SHEET_KEY_HINT}</span>
      </div>
      {/* above PIPE_ANIMATION_LIMIT links only the picked link's pipe moves, so a huge line still pans smoothly (pipe-motion.ts);
          while this browser has the pipes paused, none moves */}
      <div className="connections" data-testid="connections" aria-busy={busy} data-pipes={pipesPaused ? 'paused' : pipeAnimationMode(picture.edges.length)}>
        <svg
          ref={svgRef}
          role="group"
          aria-label="Connections of the line"
          className={dragging ? 'dragging' : undefined}
          tabIndex={0}
          style={{ height: `min(${Math.ceil(picture.height + 2 * PAD)}px, 75vh)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          {/* the arrow head: a fixed 8 x 8 in the picture's units (in user space, so a 6 px casing does not scale it up), its
              tip (10, 5) on the end of the pipe, on the box's edge; the stylesheet fills it in the colour of what it sits on */}
          <defs>
            <marker id="conn-arrow" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={8} markerHeight={8} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path className="conn-arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <g className="conn-pan" ref={panRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {picture.edges.map((edge) => <EdgeShape key={edge.id} edge={edge} selected={edge.id === pickedEdge} onPick={pickUnlessDragged} />)}
            {picture.nodes.map((node) => <NodeShape key={node.id} node={node} pick={pick} linked={linked} onPick={pickUnlessDragged} />)}
          </g>
        </svg>
      </div>
    </>
  );
}

function Legend(props: { edges: readonly ConnEdge[] }): ReactElement | null {
  const present = new Set(props.edges.map((e) => e.via));
  const items = LEGEND.filter(([via]) => present.has(via));
  if (items.length === 0) return null;
  return (
    <ul className="conn-legend" aria-label="Legend">
      {items.map(([via, text]) => <li key={via}><span className={`conn-swatch conn-via-${via}`} />{text}</li>)}
    </ul>
  );
}

/**
 * The picked box, face row or link in full: its title and every line. Its Close gives the focus back before the panel goes (ledger ruling
 * P2-R77), as Flow's does (P2-R36): a box here takes no focus (the diagram is one focus stop, which the arrow keys pan, and a box is picked
 * by the pointer), so the diagram takes it, else the page's main. A focus elsewhere is left where it is.
 */
function Panel(props: { details: Details; onClose(): void }): ReactElement {
  const { details, onClose } = props;
  const close = (button: HTMLButtonElement): void => {
    if (document.activeElement === button && !focusOn(button.closest('.conn-view')?.querySelector('.connections > svg'))) focusMain();
    onClose();
  };
  return (
    <aside className="conn-panel" data-testid="conn-panel" aria-label="Connection details">
      <header className="conn-panel-head">
        <h3><Figs text={details.title} /></h3>
        <button type="button" className="small" aria-label="Close the panel" onClick={(e) => close(e.currentTarget)}>Close</button>
      </header>
      {details.lines.length > 0 && (
        <ul className="conn-panel-lines">
          {details.lines.map((line, i) => <li key={`${i}:${line}`}>{line}</li>)}
        </ul>
      )}
    </aside>
  );
}

/**
 * A loading line of the tab, and beside it a skeleton of a diagram (Phase 2 spec §11.1): only while there is no picture yet, never over one,
 * whose busy state keeps it up, dimmed (connections.spec.ts asks the page what is under a point of it).
 */
function Waiting(props: { text: string }): ReactElement {
  return <><p className="muted">{props.text}</p><Skeleton shape="diagram" /></>;
}

/**
 * Everything the tab shows, from its state (markup but for the picture's own view, which it moves and zooms; tested
 * with renderToStaticMarkup): why there is nothing to draw yet, beside a skeleton while it is on its way, else the picture with its
 * legend and, for a pick that names something in `graph`, the side panel. While a newer layout or picture is on its way, or failed,
 * the last picture stays up (dimmed while busy) under the reason.
 */
export function ConnectionsShell(props: ConnectionsShellProps): ReactElement {
  const { plan, layout, loading, error, graph, picture, layoutError, pick, onPick } = props;
  if (plan === null) return <Waiting text={PLANNING_TEXT} />;
  if (plan.status === 'empty') return <p className="muted">{EMPTY_PLAN_TEXT}</p>;
  if (plan.status === 'infeasible') return <p className="muted">{INFEASIBLE_TEXT}</p>;
  if (layout === null) return error === null ? <Waiting text={LAYING_OUT_TEXT} /> : <p className="error" role="alert">{loadFailed(error)}</p>;
  if (layout.status === 'empty' || graph?.nodes.length === 0) return <p className="muted">{NOTHING_TEXT}</p>;
  if (picture === null) return layoutError === null ? <Waiting text={DRAWING_TEXT} /> : <p className="error" role="alert">{drawFailed(layoutError)}</p>;

  const details = pick === null || graph === null ? null : pickDetails(graph, pick);
  return (
    <div className={details === null ? 'conn-view' : 'conn-view has-panel'}>
      <div className="conn-main">
        {error !== null && <p className="error" role="alert">{loadFailed(error)}</p>}
        {layoutError !== null && <p className="error" role="alert">{drawFailed(layoutError)}</p>}
        <Picture picture={picture} pick={details === null ? null : pick} busy={loading} onPick={onPick} />
        <Legend edges={picture.edges} />
      </div>
      {details !== null && <Panel details={details} onClose={() => onPick(null)} />}
    </div>
  );
}

/**
 * The tab: the project's layout (Plan 5's `useLayout`), its Connections graph (rates per hour in Make N mode, else per
 * the settings' unit), laid out by ELK (the previous picture stays up until the new one is laid out, and an answer
 * for an older graph is dropped, as in the flow diagram) and the pick, dropped once it names nothing in the graph.
 */
export function ConnectionsView(props: ProjectViewProps): ReactElement {
  const { project, plan } = props;
  const { layout, loading, error } = useLayout(project.id, plan, project);
  const { settings } = project;
  const per = settings.mode === 'makeN' ? 'hour' : settings.per;
  const graph = useMemo(
    () => (plan === null || layout === null || !hasLine(plan, layout) ? null : connectionsGraph(layout, plan, per)),
    [layout, plan, per],
  );
  const [drawn, setDrawn] = useState<{ picture: ConnLayout | null; error: string | null }>({ picture: null, error: null });
  const [pick, setPick] = useState<ConnPick | null>(null);

  useEffect(() => {
    if (graph === null || graph.nodes.length === 0) return undefined;
    let live = true;
    layoutFlow(connectionsElk(graph)).then(
      (laid) => {
        if (live) setDrawn({ picture: connectionsFromElk(graph, laid), error: null });
      },
      (err: unknown) => {
        if (live) setDrawn((d) => ({ picture: d.picture, error: messageOf(err) }));
      },
    );
    return () => {
      live = false;
    };
  }, [graph]);

  const resolves = pick !== null && graph !== null && pickDetails(graph, pick) !== null;
  useEffect(() => {
    if (pick !== null && !resolves) setPick(null);
  }, [pick, resolves]);

  return (
    <ConnectionsShell
      plan={plan}
      layout={layout}
      loading={loading}
      error={error}
      graph={graph}
      picture={drawn.picture}
      layoutError={drawn.error}
      pick={resolves ? pick : null}
      onPick={setPick}
    />
  );
}
