// The flow diagram (spec §3.9): base materials on the left, the target on the right, one box per recipe step (machine,
// tier, count, EU/t, how busy) and arrows with rates. Green boxes are machines the group owns, blue ones are new; a
// warning badge marks a step that uses a material on the avoid list as nothing at the tier avoids it (spec §3.3). ELK
// lays it out in its own worker (web-stack §7); drag pans, the wheel zooms, and clicking a box opens its panel.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import { messageOf } from '../api/client.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { layoutFlow } from '../workers/elk.worker.ts';
import { NODE_LINE_HEIGHT, NODE_TITLE_HEIGHT, flowGraph, fromElk, toElk, type FlowLayout, type FlowNode } from './flow-model.ts';
import type { ProjectViewProps } from './project-tabs.ts';
import { RawPanel, StepPanel } from './StepPanel.tsx';
import { WhatChanged } from './WhatChanged.tsx';

type PlacedNode = FlowNode & { x: number; y: number };
type PlacedEdge = FlowLayout['edges'][number];
interface View { x: number; y: number; k: number }

/** Room around the diagram, in screen pixels. */
const PAD = 16;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
/** A new diagram opens no smaller than this, so its text stays readable; Fit goes smaller to show all of it. */
const READABLE_ZOOM = 0.6;
const ZOOM_STEP = 1.25;
/** Wheel zoom per pixel of scroll. */
const WHEEL_ZOOM = 0.0015;
const WHEEL_LINE_PIXELS = 16;
/** A press moves this far (px) before it counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;
const ICON_SIZE = 16;
const TEXT_LEFT = 8;
const ICON_TOP = 6;
/** The title moves right by this much when the box shows an item icon. */
const ICON_SHIFT = 20;
/** The avoid badge's background starts this far in from the box's sides. */
const BADGE_LEFT = 4;

const OWNED_CLASS: Record<FlowNode['owned'], string> = { all: 'owned', some: 'partly-owned', none: 'new' };

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** The view zoomed by `factor` around the screen point (px, py) of the svg, which stays where it is. */
function zoomed(v: View, px: number, py: number, factor: number): View {
  const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
  const r = k / v.k;
  return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
}

/**
 * The view that shows as much of the layout as fits in a cw × ch svg at a zoom of at least `minZoom` (never above 1):
 * centred where it fits, else from the top left, where the raw materials are.
 */
function fitView(layout: FlowLayout, cw: number, ch: number, minZoom: number): View {
  if (cw <= 0 || ch <= 0 || layout.width <= 0 || layout.height <= 0) return { x: PAD, y: PAD, k: 1 };
  const k = clamp(Math.min((cw - 2 * PAD) / layout.width, (ch - 2 * PAD) / layout.height), minZoom, 1);
  return { k, x: Math.max(PAD, (cw - layout.width * k) / 2), y: Math.max(PAD, (ch - layout.height * k) / 2) };
}

function isClickable(node: FlowNode): boolean {
  return node.kind === 'step' || node.kind === 'raw';
}

/**
 * One box: `data-node-id` (and `data-step-id` for a step) on a group holding the box, its item icon, title and lines,
 * and below them the badge of avoided goods it uses (`data-avoid-badge`), whose warnings join its tooltip.
 */
export function FlowNodeShape(props: { node: PlacedNode; selected?: boolean }): ReactElement {
  const { node, selected = false } = props;
  const icon = node.key !== null && node.kind !== 'sink' ? node.key : null;
  const classes = ['flow-node', node.kind];
  if (node.kind === 'step') classes.push(OWNED_CLASS[node.owned]);
  if (selected) classes.push('selected');
  const clickable = isClickable(node);
  const badge = node.avoidBadge;
  const text = [node.title, ...node.lines, ...(badge?.warnings ?? [])];
  return (
    <g
      className={classes.join(' ')}
      data-node-id={node.id}
      {...(node.kind === 'step' ? { 'data-step-id': node.id } : {})}
      transform={`translate(${node.x} ${node.y})`}
      {...(clickable ? { role: 'button', tabIndex: 0, 'aria-label': text.join(', '), 'aria-pressed': selected } : {})}
    >
      <title>{text.join('\n')}</title>
      <rect width={node.width} height={node.height} rx={6} />
      {icon !== null && (
        <foreignObject x={TEXT_LEFT} y={ICON_TOP} width={ICON_SIZE} height={ICON_SIZE}>
          <ItemIcon itemKey={icon} size={ICON_SIZE} name={node.keyName} />
        </foreignObject>
      )}
      {/* A nested svg clips text that is wider than the box; the full text is in the title. */}
      <svg width={node.width} height={node.height}>
        <text className="flow-node-title" x={TEXT_LEFT + (icon !== null ? ICON_SHIFT : 0)} y={19}>{node.title}</text>
        {node.lines.map((line, i) => (
          <text key={`${i}:${line}`} className="flow-node-line" x={TEXT_LEFT} y={NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * i + 11}>{line}</text>
        ))}
        {badge !== undefined && (
          <g className="flow-avoid-badge" data-avoid-badge="" transform={`translate(${BADGE_LEFT} ${NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * node.lines.length})`}>
            <rect width={node.width - 2 * BADGE_LEFT} height={NODE_LINE_HEIGHT - 2} rx={4} />
            <text x={TEXT_LEFT - BADGE_LEFT} y={11}>{badge.text}</text>
          </g>
        )}
      </svg>
    </g>
  );
}

function FlowEdgeShape(props: { edge: PlacedEdge }): ReactElement | null {
  const { edge } = props;
  if (edge.points.length < 2) return null;
  const d = edge.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  return (
    <g className="flow-edge" data-edge-id={edge.id}>
      <path d={d} markerEnd="url(#flow-arrow)" />
      {edge.labelAt !== undefined && (
        <text className="flow-edge-label" x={edge.labelAt[0]} y={edge.labelAt[1]} textAnchor="middle" dominantBaseline="central">{edge.label}</text>
      )}
    </g>
  );
}

function Legend(): ReactElement {
  return (
    <ul className="flow-legend" aria-label="Legend">
      <li><span className="swatch owned" />Owned machines</li>
      <li><span className="swatch partly-owned" />Partly owned</li>
      <li><span className="swatch new" />New machines</li>
      <li><span className="swatch raw" />Raw material</li>
      <li><span className="swatch out" />Target</li>
    </ul>
  );
}

/** The laid-out diagram with pan (drag) and zoom (wheel, buttons); `onPick` gets the step or raw box clicked. */
function FlowCanvas(props: { layout: FlowLayout; selectedId: string | null; onPick(node: PlacedNode): void }): ReactElement {
  const { layout, selectedId, onPick } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
  const drag = useRef<{ pointer: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  // The view is fitted again only when the boxes change, not when someone else's change only moves a rate.
  const shape = useMemo(() => layout.nodes.map((n) => n.id).join('\n'), [layout]);

  const fit = (minZoom: number): void => {
    const svg = svgRef.current;
    setView(fitView(layout, svg?.clientWidth ?? 0, svg?.clientHeight ?? 0, minZoom));
  };
  useLayoutEffect(() => fit(READABLE_ZOOM), [shape]);   // reads the current layout; only a change of boxes refits

  const zoomCentre = (factor: number): void => {
    const svg = svgRef.current;
    setView((v) => zoomed(v, (svg?.clientWidth ?? 0) / 2, (svg?.clientHeight ?? 0) / 2, factor));
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
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

  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    drag.current = { pointer: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);   // only now: a plain click must still reach the box under it
    }
    setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerEnd = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    dragged.current = true;   // the click that ends a drag picks nothing
    setTimeout(() => {
      dragged.current = false;
    }, 0);
  };
  const nodeOf = (target: EventTarget): PlacedNode | undefined => {
    const id = target instanceof Element ? target.closest('[data-node-id]')?.getAttribute('data-node-id') : null;
    return id === null || id === undefined ? undefined : byId.get(id);
  };
  const onClick = (e: MouseEvent<SVGSVGElement>): void => {
    if (dragged.current) return;
    const node = nodeOf(e.target);
    if (node !== undefined && isClickable(node)) onPick(node);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const node = nodeOf(e.target);
    if (node === undefined || !isClickable(node)) return;
    e.preventDefault();
    onPick(node);
  };

  return (
    <div className="flow-diagram">
      <div className="flow-toolbar row">
        <button type="button" className="small" aria-label="Zoom in" onClick={() => zoomCentre(ZOOM_STEP)}>+</button>
        <button type="button" className="small" aria-label="Zoom out" onClick={() => zoomCentre(1 / ZOOM_STEP)}>−</button>
        <button type="button" className="small" onClick={() => fit(MIN_ZOOM)}>Fit</button>
        <span className="muted small">Drag to move, scroll to zoom, click a box for details.</span>
      </div>
      <svg
        ref={svgRef}
        className="flow-canvas"
        role="group"
        aria-label="Flow diagram"
        style={{ height: `min(${Math.ceil(layout.height + 2 * PAD)}px, 75vh)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path className="flow-arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <linearGradient id="flow-partly" x1="0" x2="1" y1="0" y2="0">
            <stop className="flow-stop-owned" offset="0.5" />
            <stop className="flow-stop-new" offset="0.5" />
          </linearGradient>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.edges.map((edge) => <FlowEdgeShape key={edge.id} edge={edge} />)}
          {layout.nodes.map((node) => <FlowNodeShape key={node.id} node={node} selected={node.id === selectedId} />)}
        </g>
      </svg>
      <Legend />
    </div>
  );
}

/** Plans the diagram, lays it out and shows the panel of the clicked box, below what the last settings change did. */
function FlowDiagram(props: {
  plan: Plan; previousPlan: Plan | null | undefined; settings: PlanSettings; per: 'min' | 'hour'; send: ProjectViewProps['send'];
}): ReactElement {
  const { plan, previousPlan, settings, per, send } = props;
  const graph = useMemo(() => flowGraph(plan, per), [plan, per]);
  const [layout, setLayout] = useState<FlowLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (graph.nodes.length === 0) return undefined;
    let live = true;
    // The previous picture stays up until the new one is laid out, so a replan does not flash.
    layoutFlow(toElk(graph)).then(
      (laid) => {
        if (!live) return;
        setLayout(fromElk(graph, laid));
        setError(null);
      },
      (err: unknown) => {
        if (live) setError(messageOf(err));
      },
    );
    return () => {
      live = false;
    };
  }, [graph]);

  if (graph.nodes.length === 0) return <p className="muted">This plan has nothing to draw.</p>;

  const picked = graph.nodes.find((n) => n.id === selectedId);
  const close = (): void => setSelectedId(null);
  let panel: ReactElement | null = null;
  if (picked?.kind === 'step') {
    const step = plan.steps.find((s) => s.id === picked.id);
    // Keyed by the step, so its open "more…" pages close when another step is picked.
    if (step !== undefined) panel = <StepPanel key={step.id} step={step} plan={plan} settings={settings} per={per} send={send} onClose={close} onSelect={setSelectedId} />;
  } else if (picked?.kind === 'raw' && picked.key !== null) {
    panel = <RawPanel itemKey={picked.key} plan={plan} settings={settings} per={per} send={send} onClose={close} onSelect={setSelectedId} />;
  }

  return (
    <div className={panel === null ? 'flow' : 'flow has-panel'}>
      <div className="flow-main">
        <WhatChanged previous={previousPlan} plan={plan} />
        {error !== null && <p className="error" role="alert">{`Could not lay out the diagram: ${error}`}</p>}
        {layout === null ? (
          error === null && <p className="muted">Laying out the diagram…</p>
        ) : (
          <FlowCanvas layout={layout} selectedId={picked === undefined ? null : picked.id} onPick={(node) => setSelectedId(node.id)} />
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
  return <FlowDiagram plan={plan} previousPlan={props.previousPlan} settings={settings} per={per} send={send} />;
}
