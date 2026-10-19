// The Connections tab (plan 11 Task 8; spec §3.8c; architecture §7.2 and "EnderIO conduits, granted change requests
// (add-on 11)"): the laid-out line as a schematic of boxes and links, from the pure model in ../connections/model.ts.
// Every placed machine, chest, interface and hookup is a box whose rows name its configured faces, and every flow is a
// link drawn in the colour of what carries it, or of its EnderIO channel. ELK lays the boxes out in its worker, as for
// the flow diagram. The picture scrolls both ways, and a click on a box, one of its face rows or a link shows its full
// configuration in the side panel.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { DYE_HEX } from '../../shared/layout/enderio.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { Plan } from '../../shared/types/plan.ts';
import { messageOf } from '../api/client.ts';
import {
  CONN_LINE_HEIGHT, CONN_TITLE_HEIGHT, connectionsElk, connectionsFromElk, connectionsGraph, pickDetails,
  type ConnEdge, type ConnGraph, type ConnLayout, type ConnPick, type ConnVia,
} from '../connections/model.ts';
import { useLayout } from '../state/use-layout.ts';
import { layoutFlow } from '../workers/elk.worker.ts';
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
const HINT_TEXT = 'Click a box, one of its face rows or a link for its full configuration.';
const loadFailed = (error: string): string => `Could not load the layout: ${error}`;
const drawFailed = (error: string): string => `Could not lay out the connections: ${error}`;

/** What carries a link, for each kind of link the picture holds, in this order; an attached link needs no entry. */
const LEGEND: ReadonlyArray<readonly [Exclude<ConnVia, 'attached'>, string]> = [
  ['gt_pipe', 'Shared GT item pipe'], ['fluid_pipe', 'GT fluid pipe'], ['routed', 'Project Red routed network'], ['ae2', 'ME network'],
  ['item_conduit', 'Item Conduit (line colour = channel)'], ['fluid_conduit', 'Ender fluid conduit (line colour = channel)'],
  ['hookup', 'Hookup to the base'],
];

/** Box text: its inset from the left, the title's baseline, and a line's or face row's baseline below the top of its row. */
const TEXT_LEFT = 8;
const TITLE_BASELINE = 19;
const ROW_BASELINE = 11;
/** The boxes' corner radius. */
const CORNER = 6;
/** A box's face rows start below a divider this far under its last line, and this far below the divider. */
const DIVIDER_GAP = 2;

/** Where a box's face rows begin: the divider under its title and lines. */
function facesTop(node: PlacedNode): number {
  return CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT * node.lines.length + DIVIDER_GAP;
}

/** The face rows' part of a box, from `top` down to its rounded bottom corners. */
function facesOutline(width: number, top: number, bottom: number): string {
  const r = CORNER;
  return `M 0 ${top} H ${width} V ${bottom - r} A ${r} ${r} 0 0 1 ${width - r} ${bottom} H ${r} A ${r} ${r} 0 0 1 0 ${bottom - r} Z`;
}

/**
 * One box: its title, its lines and, under a divider, a row per face (its title). The rect is the box above the face
 * rows (the whole box when it has none): a click on it, or on the face rows' background, picks the box, and a click on
 * a face row picks that face. Only the face rows take clicks among the texts, so the middle of the rect is always the
 * rect's own. Text wider than the box is cut off at its edge; the panel shows it in full.
 */
function NodeShape(props: { node: PlacedNode; pick: ConnPick | null; onPick(pick: ConnPick): void }): ReactElement {
  const { node, pick, onPick } = props;
  const picked = pick !== null && 'node' in pick && pick.node === node.id ? pick : null;
  const top = facesTop(node);
  const pickBox = (): void => onPick({ node: node.id });
  return (
    <g data-node={node.id} className={`conn-node conn-${node.kind}${picked === null ? '' : ' selected'}`} transform={`translate(${node.x} ${node.y})`}>
      {/* the face rows' part, drawn over the rect's rounded lower corners, gives the box one outline */}
      <rect width={node.width} height={node.faces.length === 0 ? node.height : top + CORNER} rx={CORNER} onClick={pickBox} />
      {node.faces.length > 0 && <path d={facesOutline(node.width, top, node.height)} onClick={pickBox} />}
      <svg width={node.width} height={node.height}>
        <text className="conn-title" x={TEXT_LEFT} y={TITLE_BASELINE}>{node.title}</text>
        {node.lines.map((line, i) => (
          <text key={`${i}:${line}`} className="conn-line" x={TEXT_LEFT} y={CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT * i + ROW_BASELINE}>{line}</text>
        ))}
        {node.faces.map((face, i) => (
          <text
            key={face.id}
            className={picked?.face === face.id ? 'conn-face selected' : 'conn-face'}
            data-face={face.id}
            x={TEXT_LEFT}
            y={top + DIVIDER_GAP + CONN_LINE_HEIGHT * i + ROW_BASELINE}
            onClick={() => onPick({ node: node.id, face: face.id })}
          >
            {face.title}
          </text>
        ))}
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
 * One link: its line, in its channel's colour when it has one (else its class colours it by what carries it), with an
 * arrow into the box it goes to (none for an interface attached to what it serves), and its label; a click picks it.
 */
function EdgeShape(props: { edge: PlacedEdge; selected: boolean; onPick(pick: ConnPick): void }): ReactElement | null {
  const { edge, selected, onPick } = props;
  if (edge.points.length < 2) return null;
  const [lx, ly] = edge.labelAt ?? labelPoint(edge.points);
  return (
    <g data-edge={edge.id} className={`conn-edge conn-via-${edge.via}${selected ? ' selected' : ''}`} onClick={() => onPick({ edge: edge.id })}>
      <polyline
        points={edge.points.map(([x, y]) => `${x},${y}`).join(' ')}
        {...(edge.color === null ? {} : { stroke: DYE_HEX[edge.color] })}
        {...(edge.via === 'attached' ? {} : { markerEnd: 'url(#conn-arrow)' })}
      />
      {edge.label !== '' && <text className="conn-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">{edge.label}</text>}
    </g>
  );
}

/** The picture at its own size (the box around it scrolls): the links first, then the boxes over them. */
function Picture(props: { picture: ConnLayout; pick: ConnPick | null; busy: boolean; onPick(pick: ConnPick): void }): ReactElement {
  const { picture, pick, busy, onPick } = props;
  const pickedEdge = pick !== null && 'edge' in pick ? pick.edge : null;
  return (
    <div className="connections" data-testid="connections" aria-busy={busy}>
      <svg role="img" aria-label="Connections of the line" width={Math.ceil(picture.width)} height={Math.ceil(picture.height)}>
        <defs>
          <marker id="conn-arrow" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={9} markerHeight={9} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path className="conn-arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {picture.edges.map((edge) => <EdgeShape key={edge.id} edge={edge} selected={edge.id === pickedEdge} onPick={onPick} />)}
        {picture.nodes.map((node) => <NodeShape key={node.id} node={node} pick={pick} onPick={onPick} />)}
      </svg>
    </div>
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

/** The picked box, face row or link in full: its title and every line. */
function Panel(props: { details: Details; onClose(): void }): ReactElement {
  const { details, onClose } = props;
  return (
    <aside className="conn-panel" data-testid="conn-panel" aria-label="Connection details">
      <header className="conn-panel-head">
        <h3>{details.title}</h3>
        <button type="button" className="small" aria-label="Close the panel" onClick={onClose}>Close</button>
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
 * Everything the tab shows, from its state (pure markup; tested with renderToStaticMarkup): why there is nothing to
 * draw yet, else the picture with its legend and, for a pick that names something in `graph`, the side panel. While a
 * newer layout or picture is on its way, or failed, the last picture stays up (dimmed while busy) under the reason.
 */
export function ConnectionsShell(props: ConnectionsShellProps): ReactElement {
  const { plan, layout, loading, error, graph, picture, layoutError, pick, onPick } = props;
  if (plan === null) return <p className="muted">{PLANNING_TEXT}</p>;
  if (plan.status === 'empty') return <p className="muted">{EMPTY_PLAN_TEXT}</p>;
  if (plan.status === 'infeasible') return <p className="muted">{INFEASIBLE_TEXT}</p>;
  if (layout === null) return error === null ? <p className="muted">{LAYING_OUT_TEXT}</p> : <p className="error" role="alert">{loadFailed(error)}</p>;
  if (layout.status === 'empty' || graph?.nodes.length === 0) return <p className="muted">{NOTHING_TEXT}</p>;
  if (picture === null) return layoutError === null ? <p className="muted">{DRAWING_TEXT}</p> : <p className="error" role="alert">{drawFailed(layoutError)}</p>;

  const details = pick === null || graph === null ? null : pickDetails(graph, pick);
  return (
    <div className={details === null ? 'conn-view' : 'conn-view has-panel'}>
      <div className="conn-main">
        {error !== null && <p className="error" role="alert">{loadFailed(error)}</p>}
        {layoutError !== null && <p className="error" role="alert">{drawFailed(layoutError)}</p>}
        <p className="muted small">{HINT_TEXT}</p>
        <Picture picture={picture} pick={details === null ? null : pick} busy={loading} onPick={onPick} />
        <Legend edges={picture.edges} />
      </div>
      {details !== null && <Panel details={details} onClose={() => onPick(null)} />}
    </div>
  );
}

/** Whether the plan and its layout hold a line to connect; otherwise the shell says why there is none. */
function hasLine(plan: Plan, layout: Layout): boolean {
  return plan.status !== 'empty' && plan.status !== 'infeasible' && layout.status !== 'empty';
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
