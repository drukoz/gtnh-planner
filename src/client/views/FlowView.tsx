// The flow diagram (spec §3.9, fix spec §6.2): base materials on the left, the target on the right, one box per recipe
// step (machine; tier, EU/t, machines, how busy) listing the goods it takes and makes as rows, an import stub beside each
// step that takes a bought good, a red stub where nothing supplies an input, and supporting lines as groups that
// collapse. Green boxes are machines the group owns, grey ones are new; a warning badge marks a step that uses a material
// on the avoid list as nothing at the tier avoids it (spec §3.3). Each arrow is a pipe whose contents move from the output
// toward the input, ending on the flange of its port (design spec §7). Hovering a row, a box or an arrow lights what it
// connects (the flow focus); a click pins it, and a click on a box also opens its panel; Esc or a click on the empty
// canvas clears it. Find item and the Show buttons light a good and centre the step that makes it. ELK lays the diagram
// out in its own worker (web-stack §7); drag pans and the wheel zooms.

import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement,
} from 'react';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanIndex } from '../../shared/plan/balance.ts';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import { messageOf } from '../api/client.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import {
  endHoverFlowFocus, getFlowFocus, hoverFlowFocus, revealFlowFocus, setFlowFocus, useFlowFocus, useFlowReveal, type Focus,
} from '../state/flow-focus.ts';
import { layoutFlow } from '../workers/elk.worker.ts';
import {
  ICON_SPACE, NODE_LINE_HEIGHT, NODE_TITLE_HEIGHT, PORT_SIZE, ROW_HEIGHT, TEXT_CHAR_WIDTH, TEXT_LEFT, TITLE_CHAR_WIDTH, TOGGLE_SPACE,
  centreOn, clipText, collapsedLines, edgeTag, findableGoods, flowGraph, flowIssueLines, focusAnchor, focusSets, fromElk, lineNodeId,
  problemId, rowCentre, rowHasIcon, rowNameRoom, rowRate, rowsTop, toElk, useOnlyPatch,
  type FlowLayout, type FlowNode, type FlowRow, type FocusSets,
} from './flow-model.ts';
import { pipeAnimationMode, pipeSeconds } from './pipe-motion.ts';
import type { ProjectViewProps } from './project-tabs.ts';
import { RawPanel, StepPanel } from './StepPanel.tsx';
import { WhatChanged } from './WhatChanged.tsx';

type PlacedNode = FlowLayout['nodes'][number];
type PlacedEdge = FlowLayout['edges'][number];
type PlacedGroup = FlowLayout['groups'][number];
interface View { zoom: number; x: number; y: number }

/** Room around the diagram, in screen pixels. */
const PAD = 16;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
/** A new diagram opens at this zoom, on the target (fix spec §6.2); Fit goes smaller to show all of it. */
const INITIAL_ZOOM = 0.9;
const ZOOM_STEP = 1.25;
/** Wheel zoom per pixel of scroll. */
const WHEEL_ZOOM = 0.0015;
const WHEEL_LINE_PIXELS = 16;
/** A press moves this far (px) before it counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;
const ICON_SIZE = 16;
const ICON_TOP = 6;
/** The avoid badge's background starts this far in from the box's sides. */
const BADGE_LEFT = 4;
/**
 * A port is a pipe flange centred on the box's edge (design spec §7): as deep as ELK's port box on each side of that edge, so
 * its outer face is where ELK ends an arrow and a pipe meets it at any zoom; taller than the 6 px pipe, so no notch shows.
 */
const FLANGE_DEPTH = 2 * PORT_SIZE;
const FLANGE_HEIGHT = 10;
/** The open/collapse button of a supporting line, and its room from the top right corner of its box. */
const TOGGLE_SIZE = 20;
const TOGGLE_MARGIN = 8;

const OWNED_CLASS: Record<FlowNode['owned'], string> = { all: 'owned', some: 'partly-owned', none: 'new' };

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** The view zoomed by `factor` around the screen point (px, py) of the svg, which stays where it is. */
function zoomed(v: View, px: number, py: number, factor: number): View {
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const r = zoom / v.zoom;
  return { zoom, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
}

/**
 * The view that shows as much of the layout as fits in a cw × ch svg at a zoom of at least `minZoom` (never above 1):
 * centred where it fits, else from the top left, where the raw materials are.
 */
function fitView(layout: FlowLayout, cw: number, ch: number, minZoom: number): View {
  if (cw <= 0 || ch <= 0 || layout.width <= 0 || layout.height <= 0) return { zoom: 1, x: PAD, y: PAD };
  const zoom = clamp(Math.min((cw - 2 * PAD) / layout.width, (ch - 2 * PAD) / layout.height), minZoom, 1);
  return { zoom, x: Math.max(PAD, (cw - layout.width * zoom) / 2), y: Math.max(PAD, (ch - layout.height * zoom) / 2) };
}

/** Along one axis: the diagram centred when it fits the room, else kept so no blank band shows beyond either end. */
function keepOnScreen(pos: number, size: number, room: number): number {
  if (size + 2 * PAD <= room) return (room - size) / 2;
  return clamp(pos, room - PAD - size, PAD);
}

/** The view a new diagram opens with (fix spec §6.2): zoom 0.9, centred on the target as far as the diagram reaches. */
function initialView(layout: FlowLayout, canvas: { width: number; height: number }): View {
  const out = layout.nodes.find((n) => n.kind === 'out');
  const centred = out === undefined ? { zoom: INITIAL_ZOOM, x: PAD, y: PAD } : centreOn(out, { zoom: INITIAL_ZOOM, x: 0, y: 0 }, canvas);
  return {
    zoom: INITIAL_ZOOM,
    x: keepOnScreen(centred.x, layout.width * INITIAL_ZOOM, canvas.width),
    y: keepOnScreen(centred.y, layout.height * INITIAL_ZOOM, canvas.height),
  };
}

/** A focus as text, to tell whether a hover moved to something else. */
function focusText(f: Focus): string {
  if (f === null) return '';
  return f.kind === 'item' ? `item:${f.key}` : `${f.kind}:${f.id}`;
}

/** What hovering or clicking a box (not one of its rows) lights: a step or a line with what it connects, a stub its good. */
function boxFocus(node: FlowNode): Focus {
  if (node.kind === 'step' || node.kind === 'line' || node.key === null) return { kind: 'node', id: node.id };
  return { kind: 'item', key: node.key };
}

/** A row in words: "takes Copper Ingot 1/h" on a box, "Copper Ingot: mined 1/h" on a stub. */
function rowWords(node: FlowNode, row: FlowRow): string {
  if (!rowHasIcon(node)) return `${node.title}: ${row.name} ${rowRate(row)}`;
  return `${row.side === 'in' ? 'takes' : 'makes'} ${row.name} ${rowRate(row)}`;
}

/** The open/collapse button of a supporting line (`data-line-toggle`). */
function LineToggle(props: { lineKey: StuffKey; title: string; open: boolean; x: number; y: number }): ReactElement {
  const { lineKey, title, open, x, y } = props;
  return (
    <g
      className="flow-line-toggle" data-line-toggle={lineKey} role="button" tabIndex={0} aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Open'} the ${title}`} transform={`translate(${x} ${y})`}
    >
      <title>{`${open ? 'Collapse' : 'Open'} the ${title}`}</title>
      <rect width={TOGGLE_SIZE} height={TOGGLE_SIZE} />
      <text x={TOGGLE_SIZE / 2} y={15} textAnchor="middle">{open ? '−' : '+'}</text>
    </g>
  );
}

/**
 * One row of a box (fix spec §6.2): the good's icon (steps and lines), its name and rate, the port's flange on the box's
 * edge (last, so it is painted over the end of the pipe), lit or dimmed under a focus. A button: hovering lights the good, a
 * click or Enter pins it.
 */
function FlowRowShape(props: { node: PlacedNode; row: FlowRow; index: number; sets: FocusSets | null }): ReactElement {
  const { node, row, index, sets } = props;
  const y = rowCentre(node, index);
  const icon = rowHasIcon(node);
  const left = row.side === 'in';
  const classes = ['flow-row', row.side];
  if (row.main === true) classes.push('main');
  if (row.issue !== undefined) classes.push(`issue-${row.issue}`);
  if (sets !== null) classes.push(sets.ports.has(row.port) ? 'hl' : 'dim');
  const rate = rowRate(row);
  const room = rowNameRoom(node, row);
  const textX = left ? TEXT_LEFT + (icon ? ICON_SPACE : 0) : node.width - TEXT_LEFT - (icon ? ICON_SPACE : 0);
  const where = left ? 'comes from' : 'goes';
  const label = icon ? `${row.side === 'in' ? 'takes' : 'makes'} ${row.name} ${rate}: show where it ${where}` : `${node.title}, ${row.name} ${rate}: show where it ${where}`;
  return (
    <g className={classes.join(' ')} data-port={row.port} data-key={row.key} role="button" tabIndex={0} aria-label={label}>
      <rect className="flow-hit" x={0} y={y - ROW_HEIGHT / 2} width={node.width} height={ROW_HEIGHT} />
      {icon && (
        <foreignObject x={left ? TEXT_LEFT : node.width - TEXT_LEFT - ICON_SIZE} y={y - ICON_SIZE / 2} width={ICON_SIZE} height={ICON_SIZE}>
          <ItemIcon itemKey={row.key} size={ICON_SIZE} name={row.name} />
        </foreignObject>
      )}
      {/* A nested svg clips a row wider than the box; the full text is in the box's title. */}
      <svg x={0} y={y - ROW_HEIGHT / 2} width={node.width} height={ROW_HEIGHT}>
        <text className="flow-row-text" x={textX} y={ROW_HEIGHT / 2 + 4} {...(left ? {} : { textAnchor: 'end' })}>
          {`${clipText(row.name, room, TEXT_CHAR_WIDTH)} `}
          <tspan className="flow-row-rate">{rate}</tspan>
        </text>
      </svg>
      <rect className="flow-port" x={(left ? 0 : node.width) - FLANGE_DEPTH / 2} y={y - FLANGE_HEIGHT / 2} width={FLANGE_DEPTH} height={FLANGE_HEIGHT} />
    </g>
  );
}

/**
 * One box: `data-node-id` and `data-kind` on a group (and `data-step-id` on a step's only, ruling P17) holding the box,
 * a head with its item icon, title and lines (a button on a step or an import stub, whose click opens its panel), the
 * badge of avoided goods it uses (`data-avoid-badge`, whose warnings join its tooltip), and a row per good. Under a
 * focus it is lit (`hl`, and `producer` or `consumer`) or dimmed (`dim`).
 */
export function FlowNodeShape(props: { node: PlacedNode; selected?: boolean; sets?: FocusSets | null }): ReactElement {
  const { node, selected = false } = props;
  const sets = props.sets ?? null;
  const classes = ['flow-node', node.kind];
  if (node.kind === 'step') classes.push(OWNED_CLASS[node.owned]);
  if (node.leaf !== undefined) classes.push(`leaf-${node.leaf}`);
  if (sets !== null) {
    classes.push(sets.nodes.has(node.id) ? 'hl' : 'dim');
    if (sets.producers.has(node.id)) classes.push('producer');
    if (sets.consumers.has(node.id)) classes.push('consumer');
  }
  if (selected) classes.push('selected');
  const icon = node.key;
  const badge = node.avoidBadge;
  const head = rowsTop(node);
  const toggle = node.kind === 'line' ? TOGGLE_SPACE : 0;
  const titleX = TEXT_LEFT + (icon !== null ? ICON_SPACE : 0);
  const described = [node.title, ...node.lines, ...(badge?.warnings ?? [])];
  const opens = node.kind === 'step' || node.kind === 'import';
  return (
    <g
      className={classes.join(' ')}
      data-node-id={node.id}
      {...(node.kind === 'step' ? { 'data-step-id': node.id } : {})}
      data-kind={node.kind}
      transform={`translate(${node.x} ${node.y})`}
    >
      <title>{[...described, ...node.rows.map((r) => rowWords(node, r))].join('\n')}</title>
      <rect className="flow-node-box" width={node.width} height={node.height} />
      <g className="flow-node-head" {...(opens ? { role: 'button', tabIndex: 0, 'aria-label': described.join(', '), 'aria-pressed': selected } : {})}>
        <rect className="flow-hit" width={node.width} height={head} />
        {icon !== null && (
          <foreignObject x={TEXT_LEFT} y={ICON_TOP} width={ICON_SIZE} height={ICON_SIZE}>
            <ItemIcon itemKey={icon} size={ICON_SIZE} name={node.keyName} />
          </foreignObject>
        )}
        {/* A nested svg clips text that is wider than the box; the full text is in the title. */}
        <svg width={node.width - toggle} height={head}>
          <text className="flow-node-title" x={titleX} y={19}>{clipText(node.title, node.width - toggle - titleX - TEXT_LEFT, TITLE_CHAR_WIDTH)}</text>
          {node.lines.map((line, i) => (
            <text key={`${i}:${line}`} className="flow-node-line" x={TEXT_LEFT} y={NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * i + 11}>{line}</text>
          ))}
          {badge !== undefined && (
            <g className="flow-avoid-badge" data-avoid-badge="" transform={`translate(${BADGE_LEFT} ${NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * node.lines.length})`}>
              <rect width={node.width - 2 * BADGE_LEFT} height={NODE_LINE_HEIGHT - 2} />
              <text x={TEXT_LEFT - BADGE_LEFT} y={11}>{badge.text}</text>
            </g>
          )}
        </svg>
      </g>
      {node.kind === 'line' && node.key !== null && (
        <LineToggle lineKey={node.key} title={node.title} open={false} x={node.width - TOGGLE_SIZE - TOGGLE_MARGIN} y={ICON_TOP - 1} />
      )}
      {node.rows.map((row, i) => <FlowRowShape key={row.port} node={node} row={row} index={i} sets={sets} />)}
    </g>
  );
}

/**
 * One arrow, drawn as a pipe (design spec §7): a 10 px transparent path to hover and click, the casing with its head (red
 * from a stub of what is missing), the good moving inside it from the output toward the input (`fluid` or `item`, at the
 * speed of its rate: `--pipe-dur` from `pipeSeconds`; nothing moves from a missing source), its tooltip "name · rate ·
 * From → To", and the rate as its label where a port has other arrows. Under a focus the group alone is lit (`hl`) or
 * dimmed (`dim`). A lit arrow writes "name · rate" in its tag above the boxes instead (`EdgeTagShape`).
 */
export function FlowEdgeShape(props: { edge: PlacedEdge; lit: boolean | null; missing: boolean }): ReactElement | null {
  const { edge, lit, missing } = props;
  if (edge.points.length < 2) return null;
  const d = edge.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const fluid = isFluidKey(edge.key);
  const classes = ['flow-edge', fluid ? 'fluid' : 'item'];
  if (missing) classes.push('missing');
  if (lit !== null) classes.push(lit ? 'hl' : 'dim');
  const arrow = lit === true ? 'flow-arrow-hl' : missing ? 'flow-arrow-missing' : fluid ? 'flow-arrow-fluid' : 'flow-arrow';
  return (
    <g
      className={classes.join(' ')} data-edge-id={edge.id} data-key={edge.key}
      style={{ '--pipe-dur': `${pipeSeconds(edge.perSecond, fluid)}s` } as CSSProperties}
    >
      <title>{edge.title}</title>
      <path className="flow-edge-hit" d={d} />
      <path className="flow-edge-line" d={d} markerEnd={`url(#${arrow})`} />
      {!missing && <path className="flow-edge-flow" d={d} />}
      {lit !== true && edge.label !== undefined && edge.labelAt !== undefined && (
        <text className="flow-edge-label" x={edge.labelAt[0]} y={edge.labelAt[1]} textAnchor="middle" dominantBaseline="central">{edge.label}</text>
      )}
    </g>
  );
}

/** A lit arrow's "name · rate" on an opaque tag, above the boxes so a short arrow's text stays readable. */
function EdgeTagShape(props: { edge: PlacedEdge }): ReactElement | null {
  const tag = edgeTag(props.edge);
  if (tag === undefined) return null;
  return (
    <g className="flow-edge-tag" data-edge-tag={props.edge.id}>
      <rect x={tag.x} y={tag.y} width={tag.width} height={tag.height} />
      <text x={tag.x + tag.width / 2} y={tag.y + tag.height / 2} textAnchor="middle" dominantBaseline="central">{tag.text}</text>
    </g>
  );
}

/** Each arrow head, `[marker id, head class]`: one per colour, since CSS cannot pass an arrow's colour into its marker. */
const ARROW_HEADS: Array<[string, string]> = [
  ['flow-arrow', 'flow-arrow-head'], ['flow-arrow-fluid', 'flow-arrow-head-fluid'], ['flow-arrow-hl', 'flow-arrow-head-hl'],
  ['flow-arrow-missing', 'flow-arrow-head-missing'],
];

/**
 * What the arrows and boxes refer to: the arrow heads, a fixed 8 × 8 triangle in the diagram's units (in user space, so a
 * 6 px casing does not scale it up) whose tip is the end of the pipe, on the port's flange; and the half-and-half fill of a
 * partly owned box.
 */
export function FlowDefs(): ReactElement {
  return (
    <defs>
      {ARROW_HEADS.map(([id, head]) => (
        <marker key={id} id={id} viewBox="0 0 10 10" refX={10} refY={5} markerWidth={8} markerHeight={8} markerUnits="userSpaceOnUse" orient="auto">
          <path className={head} d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      ))}
      <linearGradient id="flow-partly" x1="0" x2="1" y1="0" y2="0">
        <stop className="flow-stop-owned" offset="0.5" />
        <stop className="flow-stop-new" offset="0.5" />
      </linearGradient>
    </defs>
  );
}

/** An open supporting line: a frame around its boxes, titled "<name> line", with its collapse button. */
function FlowGroupShape(props: { group: PlacedGroup; dim: boolean }): ReactElement {
  const { group, dim } = props;
  return (
    <g className={dim ? 'flow-group dim' : 'flow-group'} data-group-id={group.id} transform={`translate(${group.x} ${group.y})`}>
      <rect className="flow-group-box" width={group.width} height={group.height} />
      <svg width={Math.max(0, group.width - TOGGLE_SIZE - 2 * TOGGLE_MARGIN)} height={32}>
        <text className="flow-group-title" x={12} y={22}>{group.title}</text>
      </svg>
      <LineToggle lineKey={group.key} title={group.title} open x={group.width - TOGGLE_SIZE - TOGGLE_MARGIN} y={TOGGLE_MARGIN} />
    </g>
  );
}

/** What each kind of box means (fix spec §6.2). */
export function FlowLegend(): ReactElement {
  return (
    <ul className="flow-legend" aria-label="Legend">
      <li><span className="swatch owned" />Owned machines</li>
      <li><span className="swatch partly-owned" />Partly owned</li>
      <li><span className="swatch new" />New machines</li>
      <li><span className="swatch import" />Import (mined, gathered, bought)</li>
      <li><span className="swatch free" />Free import</li>
      <li><span className="swatch missing" />No source in the plan</li>
      <li><span className="swatch sink" />Left over</li>
      <li><span className="swatch line" />Supporting line</li>
      <li><span className="swatch out" />Target</li>
    </ul>
  );
}

/**
 * What does not add up, above the diagram (fix spec §6.2 "Issues"): red with an input nothing supplies, amber
 * otherwise; one line per issue with **Show** (lights the good and centres its first producer) and, for a good made two
 * ways, **Keep only <the bigger maker>** (pins its recipe for the good) until `settings` pin it, with a note on what the
 * pin may leave or, once in place, leaves (`FlowIssueLine.stays`; "Updating…" until the plan of the pin is on screen).
 * No hooks, so tests can call it.
 */
export function FlowIssues(props: {
  plan: Plan; settings: PlanSettings; send: ProjectViewProps['send']; onShow(key: StuffKey): void; index?: PlanIndex;
}): ReactElement | null {
  const { plan, settings, send, onShow } = props;
  const lines = flowIssueLines(plan, props.index, settings);
  if (lines.length === 0) return null;
  const red = lines.some((l) => l.issue.code === 'orphan-input');
  return (
    <section className={red ? 'flow-issues error' : 'flow-issues'} aria-label="What does not add up">
      <ul>
        {lines.map(({ issue, text, keepOnly, stays }) => (
          <li key={problemId(issue)} data-issue={issue.code}>
            <span>{text}</span>
            {stays !== undefined && <span className="muted">{` ${stays}`}</span>}
            <button type="button" className="small" onClick={() => onShow(issue.key)}>Show</button>
            {keepOnly !== undefined && (
              <button type="button" className="small" onClick={() => send([{ op: 'settings', patch: useOnlyPatch(settings, issue.key, keepOnly.recipeId) }])}>
                {`Keep only ${keepOnly.machine}`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What a pointer or key is on: a line's open/collapse button, a row (its good), an arrow, a box, or nothing. */
interface Hit { focus: Focus; node?: PlacedNode; toggle?: StuffKey }

/**
 * The laid-out diagram (fix spec §6.2) with pan (drag) and zoom (wheel, buttons, Fit), Find item and the "Imports in
 * one column" toggle; hovering lights what is under the pointer, a click pins it (a box click also calls `onOpen`),
 * Esc or a click on the empty canvas clears it. It opens on the target (or on what someone asked to see) whenever the
 * plan's steps change (`viewKey`), and centres the focus whenever a view asks (`revealFlowFocus`).
 */
function FlowCanvas(props: {
  layout: FlowLayout; viewKey: string; selectedId: string | null; goods: Array<{ key: StuffKey; name: string }>;
  importsInOneColumn: boolean; onImportsInOneColumn(on: boolean): void; onOpen(node: PlacedNode): void; onToggleLine(key: StuffKey): void;
}): ReactElement {
  const { layout, viewKey, selectedId, goods, importsInOneColumn, onImportsInOneColumn, onOpen, onToggleLine } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: PAD, y: PAD });
  const drag = useRef<{ pointer: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  /** A drag past `DRAG_THRESHOLD` is under way: the pipes stand still while it is (`dragging` on the svg). */
  const [dragging, setDragging] = useState(false);
  /** What the pointer last lit (`focusText`), so a move within one thing changes nothing. */
  const hovered = useRef('');
  /** A line just opened or closed: its box, to centre once the new layout has it. */
  const centreNext = useRef<string | null>(null);
  const focus = useFlowFocus();
  const reveal = useFlowReveal();
  const seenReveal = useRef(reveal);
  const sets = useMemo(() => focusSets(layout, focus), [layout, focus]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const canvas = (): { width: number; height: number } => ({ width: svgRef.current?.clientWidth ?? 0, height: svgRef.current?.clientHeight ?? 0 });
  /** Centres the box (or open line) `id`; false when this layout has none. */
  const centre = (id: string, minZoom = 0): boolean => {
    const box = byId.get(id) ?? layout.groups.find((g) => g.id === id);
    if (box === undefined) return false;
    setView((v) => centreOn(box, { ...v, zoom: Math.max(v.zoom, minZoom) }, canvas()));
    return true;
  };

  // A new plan: open on what someone asked to see, else on the target (fix spec §6.2).
  useLayoutEffect(() => {
    const anchor = focusAnchor(layout, getFlowFocus());
    const box = anchor === undefined ? undefined : byId.get(anchor);
    setView(box === undefined ? initialView(layout, canvas()) : centreOn(box, { zoom: INITIAL_ZOOM, x: 0, y: 0 }, canvas()));
  }, [viewKey]);   // reads the current layout; only a change of the plan's steps resets the view
  useLayoutEffect(() => {
    const id = centreNext.current;
    if (id !== null && centre(id)) centreNext.current = null;
  }, [layout]);
  useEffect(() => {
    if (reveal === seenReveal.current) return;
    seenReveal.current = reveal;
    const anchor = focusAnchor(layout, getFlowFocus());
    if (anchor !== undefined) centre(anchor, INITIAL_ZOOM);
  }, [reveal, layout]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    // React's wheel listener is passive, so it cannot stop the page from scrolling; this one can.
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = svg.getBoundingClientRect();
      const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PIXELS : e.deltaY;
      setView((v) => zoomed(v, e.clientX - box.left, e.clientY - box.top, Math.exp(-pixels * WHEEL_ZOOM)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    // Esc clears the focus wherever the keyboard is; a hover still lit when the diagram goes away is put back.
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      hovered.current = '';
      setFlowFocus(null);
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      endHoverFlowFocus();
    };
  }, []);

  const fit = (minZoom: number): void => setView(fitView(layout, canvas().width, canvas().height, minZoom));
  const zoomCentre = (factor: number): void => setView((v) => zoomed(v, canvas().width / 2, canvas().height / 2, factor));

  const hitOf = (target: EventTarget | null): Hit | null => {
    if (!(target instanceof Element)) return null;
    const toggle = target.closest('[data-line-toggle]')?.getAttribute('data-line-toggle');
    if (toggle !== null && toggle !== undefined) return { focus: null, toggle };
    const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id');
    const node = nodeId === null || nodeId === undefined ? undefined : byId.get(nodeId);
    const key = target.closest('[data-port]')?.getAttribute('data-key');
    if (key !== null && key !== undefined) return node === undefined ? { focus: { kind: 'item', key } } : { focus: { kind: 'item', key }, node };
    const edge = target.closest('[data-edge-id]')?.getAttribute('data-edge-id');
    if (edge !== null && edge !== undefined) return { focus: { kind: 'edge', id: edge } };
    return node === undefined ? null : { focus: boxFocus(node), node };
  };
  const hover = (f: Focus): void => {
    const text = focusText(f);
    if (text === hovered.current) return;
    hovered.current = text;
    if (f === null) endHoverFlowFocus();
    else hoverFlowFocus(f);
  };
  /** A click or Enter: open or collapse a line; pin what is under it and open its box's panel; on nothing, clear. */
  const activate = (hit: Hit | null): void => {
    if (hit?.toggle !== undefined) {
      centreNext.current = lineNodeId(hit.toggle);
      onToggleLine(hit.toggle);
      return;
    }
    hovered.current = focusText(hit?.focus ?? null);
    setFlowFocus(hit?.focus ?? null);
    if (hit?.node !== undefined) onOpen(hit.node);
  };

  /**
   * After any press or release, by whatever pointer: `dragging` while the drag under way has passed the threshold, else not.
   * A second pointer that takes the drag over, a release that is not the drag's, or a press that never moves would otherwise
   * leave every pipe stopped until some later drag ended.
   */
  const settleDragging = (): void => setDragging(drag.current?.moved === true);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.button === 0) drag.current = { pointer: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    settleDragging();
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) {
      hover(hitOf(e.target)?.focus ?? null);
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);   // only now: a plain click must still reach the box under it
      setDragging(true);
    }
    setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerEnd = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d !== null && d.pointer === e.pointerId) {
      drag.current = null;
      if (d.moved) {
        dragged.current = true;   // the click that ends a drag picks nothing
        setTimeout(() => {
          dragged.current = false;
        }, 0);
      }
    }
    settleDragging();
  };
  const onClick = (e: MouseEvent<SVGSVGElement>): void => {
    if (!dragged.current) activate(hitOf(e.target));
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const hit = hitOf(e.target);
    if (hit === null) return;
    e.preventDefault();
    activate(hit);
  };
  // `focusing` under a focus, `dragging` while the view is dragged, `many-edges` when only the lit pipes move (pipe-motion.ts)
  const canvasClasses = ['flow-canvas'];
  if (sets !== null) canvasClasses.push('focusing');
  if (dragging) canvasClasses.push('dragging');
  if (pipeAnimationMode(layout.edges.length) === 'lit') canvasClasses.push('many-edges');

  return (
    <div className="flow-diagram">
      <div className="flow-toolbar row">
        <button type="button" className="small" aria-label="Zoom in" onClick={() => zoomCentre(ZOOM_STEP)}>+</button>
        <button type="button" className="small" aria-label="Zoom out" onClick={() => zoomCentre(1 / ZOOM_STEP)}>−</button>
        <button type="button" className="small" onClick={() => fit(MIN_ZOOM)}>Fit</button>
        <select
          className="flow-find small" aria-label="Find item" value=""
          onChange={(e) => {
            const key = e.currentTarget.value;
            if (key !== '') revealFlowFocus({ kind: 'item', key });
          }}
        >
          <option value="">Find item…</option>
          {goods.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
        <label className="check small">
          <input type="checkbox" checked={importsInOneColumn} onChange={(e) => onImportsInOneColumn(e.currentTarget.checked)} />
          Imports in one column
        </label>
        <span className="muted small">Hover or click a good to see where it comes from and goes, click a box for details, Esc clears. Drag to move, scroll to zoom.</span>
      </div>
      <svg
        ref={svgRef}
        className={canvasClasses.join(' ')}
        role="group"
        aria-label="Flow diagram"
        style={{ height: `min(${Math.ceil(layout.height + 2 * PAD)}px, 75vh)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => hover(null)}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <FlowDefs />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {layout.groups.map((group) => (
            <FlowGroupShape key={group.id} group={group} dim={sets !== null && !group.nodes.some((id) => sets.nodes.has(id))} />
          ))}
          {layout.edges.map((edge) => (
            <FlowEdgeShape key={edge.id} edge={edge} lit={sets === null ? null : sets.edges.has(edge.id)} missing={byId.get(edge.from)?.kind === 'missing'} />
          ))}
          {layout.nodes.map((node) => <FlowNodeShape key={node.id} node={node} sets={sets} selected={node.id === selectedId} />)}
          {sets !== null && layout.edges.filter((edge) => sets.edges.has(edge.id)).map((edge) => <EdgeTagShape key={edge.id} edge={edge} />)}
        </g>
      </svg>
      <FlowLegend />
    </div>
  );
}

/** The box whose panel is open: a step, or an import stub (its panel is about its good). */
type Selected = { kind: 'step'; id: string } | { kind: 'import'; key: StuffKey; nodeId: string } | null;

/**
 * Plans the diagram, lays it out and shows the panel of the clicked box, below what the last settings change did and
 * what does not add up. Supporting lines start collapsed in a plan of more than 25 steps; the group opens and closes
 * them one by one (kept across replans), and can put every import in one column.
 */
function FlowDiagram(props: {
  plan: Plan; previousPlan: Plan | null | undefined; settings: PlanSettings; per: 'min' | 'hour'; send: ProjectViewProps['send'];
  /** The project links a world base (the step panel says the machines it reuses stand there). */
  base: boolean;
}): ReactElement {
  const { plan, previousPlan, settings, per, send } = props;
  const [lineToggles, setLineToggles] = useState<ReadonlyMap<StuffKey, boolean>>(() => new Map());
  const [importsInOneColumn, setImportsInOneColumn] = useState(false);
  const closed = useMemo(() => collapsedLines(plan, lineToggles), [plan, lineToggles]);
  const graph = useMemo(() => flowGraph(plan, per, { collapsedLines: closed, importsInOneColumn }), [plan, per, closed, importsInOneColumn]);
  const goods = useMemo(() => findableGoods(graph, plan), [graph, plan]);
  // The view starts over only when the plan's steps change, not when a line opens or a rate moves.
  const viewKey = useMemo(() => plan.steps.map((s) => s.id).sort().join('\n'), [plan]);
  const [laid, setLaid] = useState<{ layout: FlowLayout; viewKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  useEffect(() => {
    if (graph.nodes.length === 0) return undefined;
    let live = true;
    // The previous picture stays up until the new one is laid out, so a replan does not flash.
    layoutFlow(toElk(graph)).then(
      (result) => {
        if (!live) return;
        setLaid({ layout: fromElk(graph, result), viewKey });
        setError(null);
      },
      (err: unknown) => {
        if (live) setError(messageOf(err));
      },
    );
    return () => {
      live = false;
    };
  }, [graph, viewKey]);

  if (graph.nodes.length === 0) return <p className="muted">This plan has nothing to draw.</p>;

  /** A step picked in a panel (a Takes/Makes peer, a Used by step): the row hovered there is gone with its panel. */
  const selectStep = (id: string): void => {
    endHoverFlowFocus();
    setSelected({ kind: 'step', id });
  };
  const close = (): void => setSelected(null);
  let panel: ReactElement | null = null;
  let selectedId: string | null = null;
  if (selected?.kind === 'step') {
    const step = plan.steps.find((s) => s.id === selected.id);
    // Keyed by the step, so its open "more…" pages close when another step is picked.
    if (step !== undefined) {
      panel = <StepPanel key={step.id} step={step} plan={plan} settings={settings} per={per} send={send} onClose={close} onSelect={selectStep} base={props.base} />;
      selectedId = step.id;
    }
  } else if (selected?.kind === 'import' && plan.flows.some((f) => f.from === 'raw' && f.key === selected.key)) {
    panel = <RawPanel itemKey={selected.key} plan={plan} settings={settings} per={per} send={send} onClose={close} onSelect={selectStep} />;
    selectedId = selected.nodeId;
  }
  const open = (node: PlacedNode): void => {
    if (node.kind === 'step') setSelected({ kind: 'step', id: node.id });
    else if (node.kind === 'import' && node.key !== null) setSelected({ kind: 'import', key: node.key, nodeId: node.id });
  };
  const toggleLine = (key: StuffKey): void => {
    setLineToggles((toggles) => new Map(toggles).set(key, collapsedLines(plan, toggles).has(key)));
  };

  return (
    <div className={panel === null ? 'flow' : 'flow has-panel'}>
      <div className="flow-main">
        <WhatChanged previous={previousPlan} plan={plan} />
        <FlowIssues plan={plan} settings={settings} send={send} onShow={(key) => revealFlowFocus({ kind: 'item', key })} />
        {error !== null && <p className="error" role="alert">{`Could not lay out the diagram: ${error}`}</p>}
        {laid === null ? (
          error === null && <p className="muted">Laying out the diagram…</p>
        ) : (
          <FlowCanvas
            layout={laid.layout} viewKey={laid.viewKey} selectedId={selectedId} goods={goods}
            importsInOneColumn={importsInOneColumn} onImportsInOneColumn={setImportsInOneColumn} onOpen={open} onToggleLine={toggleLine}
          />
        )}
      </div>
      {panel}
    </div>
  );
}

/** Why nothing can be planned: the plan's warnings and what unlocks the line, as one list. */
function Infeasible(props: { plan: Plan }): ReactElement {
  const { plan } = props;
  const texts = [...new Set([...plan.warnings.map((w) => w.text), ...plan.unlocks.map((u) => u.text)])];
  const tier = TIER_NAMES[plan.tier];
  return (
    <div className="flow-infeasible" role="status">
      <p>{tier === undefined ? 'This line cannot be planned yet:' : `This line cannot be planned at ${tier} yet:`}</p>
      <ul className="warnings">
        {texts.map((text) => <li key={text}>{text}</li>)}
      </ul>
    </div>
  );
}

export function FlowView(props: ProjectViewProps): ReactElement {
  const { project, plan, send } = props;
  if (plan === null) return <p className="muted">Planning…</p>;
  if (plan.status === 'empty') return <p className="muted">Pick something to make in the settings</p>;
  if (plan.status === 'infeasible') return <Infeasible plan={plan} />;
  const { settings } = project;
  const per = settings.mode === 'makeN' ? 'hour' : settings.per;
  return <FlowDiagram plan={plan} previousPlan={props.previousPlan} settings={settings} per={per} send={send} base={project.world.baseId !== null} />;
}
