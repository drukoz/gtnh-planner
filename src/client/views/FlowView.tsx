// The flow diagram (spec §3.9, fix spec §6.2): base materials on the left, the target on the right, one box per recipe
// step (its machine as a readout, Phase 2 spec §7: the machine's icon, its tier and count chips, its power and a band of
// how busy it is) listing the goods it takes and makes as rows, an import stub beside each step that takes a bought good,
// a red stub where nothing supplies an input, and supporting lines as groups that collapse. Green boxes are machines the
// group owns, grey ones are new; a warning badge marks a step that uses a material
// on the avoid list as nothing at the tier avoids it (spec §3.3). Each arrow is a pipe whose contents move from the output
// toward the input, ending on the flange of its port (design spec §7); Pause pipes stops them (ruling R31). Hovering a row,
// a box or an arrow lights what it connects (the flow focus); a click pins it, and a click on a box also opens its panel;
// Esc or a click on the empty canvas clears it. Find item and the Show buttons light a good and centre the step that makes
// it. ELK lays the diagram out in its own worker (web-stack §7); drag pans and the wheel zooms, at once, while Fit, the zoom buttons, a reveal,
// a line opened or closed and a new plan's view pan there over 250 ms (Phase 2 spec §16.2, ./glide.ts; the last two only when the new layout
// glides), and a new layout glides into place from the last over 260 ms, what it drops fading out where it stood (§16.3). A good rides each
// pipe, its icon carried from the output to the input (Phase 2 spec §15), and stops with the pipe's contents.
// The panel slides in once and each new one fades in; a step picked inside a panel takes the focus to its own (Phase 2 spec §8.6), and
// its Close gives the focus back to the box head that opened it, or to the canvas once that box is gone or out of the canvas's view
// (ledger ruling P2-R36). While the plan, or its layout, is on its way the view says so beside a skeleton of a diagram (Phase 2 spec
// §11.1), which is never drawn with the diagram it stands for.

import {
  memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent,
  type ReactElement,
} from 'react';
import { TIER_NAMES } from '../../shared/gt/tiers.ts';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { PlanIndex } from '../../shared/plan/balance.ts';
import { hashColor, type Rgb } from '../../shared/types/assets.ts';
import type { LeafClass, Plan, PlanSettings } from '../../shared/types/plan.ts';
import { messageOf } from '../api/client.ts';
import { useItemIcon } from '../assets/icons.ts';
import { Figs } from '../components/Figs.tsx';
import { focusLost, focusOn } from '../components/focus.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { PipesButton } from '../components/PipesButton.tsx';
import { SHEET_KEY_HINT } from '../components/ShortcutsSheet.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { tipText } from '../components/tooltip-model.ts';
import {
  endHoverFlowFocus, getFlowFocus, hoverFlowFocus, revealFlowFocus, setFlowFocus, useFlowFocus, useFlowReveal, type Focus,
} from '../state/flow-focus.ts';
import { EASE_IN, EXIT_MS, GHOST_FALLBACK_MS, prefersReducedMotion } from '../state/motion.ts';
import { usePipesPaused } from '../state/pipes-paused.ts';
import { useSingleKeyShortcuts } from '../state/single-key-shortcuts.ts';
import { layoutFlow } from '../workers/elk.worker.ts';
import {
  BUSY_BAND, BUSY_TRACK_HEIGHT, BUSY_TRACK_TOP, CHIP_GAP, CHIP_HEIGHT, HAND_WORDS, ICON_SPACE, MACHINE_ICON, MACHINE_SLOT, NODE_LINE_HEIGHT,
  NODE_TITLE_HEIGHT, PORT_SIZE, POWER_GAP, READOUT_LEFT, ROW_HEIGHT, SLOT_TOP, STEP_HEAD_HEIGHT, TEXT_CHAR_WIDTH, TEXT_LEFT, TITLE_CHAR_WIDTH,
  TOGGLE_SPACE,
  DIM_OPACITY, busyTrack, centreOn, chipWidth, clipText, collapsedLines, edgeTag, findableGoods, flowGraph, flowIssueLines, focusAnchor, focusSets,
  fromElk, glidable, layoutChange, lineNodeId, problemId, rowCentre, rowHasIcon, rowNameRoom, rowRate, rowsTop, toElk, useOnlyPatch,
  type FlowLayout, type FlowNode, type FlowNodeKind, type FlowRow, type FocusSets, type LayoutChange, type MachineReadout,
} from './flow-model.ts';
import { fadedIn, glideLayout, glidingAt, layoutGlides, restingBox, settle, usePan, type GlideTargets, type PanView } from './glide.ts';
import { pointIn } from './pan-zoom.ts';
import { RIDER_SIZE, pathLength, pipeAnimationMode, pipeSeconds, rideRoute, riderEdges, riderPhase, riderSeconds } from './pipe-motion.ts';
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
/**
 * A press moves this far (px) before it counts as a drag instead of a click: the pointer's own move on the page, so a press stays a click
 * while the canvas moves under a still pointer (ledger ruling P2-R16).
 */
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
/** A box's title baseline. */
const TITLE_BASELINE = 19;
/** A machine readout's chip row (Phase 2 spec §7.3): its top, its chips' baseline, and the power's baseline beside them. */
const CHIP_TOP = 25;
const CHIP_BASELINE = 12.5;
const POWER_BASELINE = 37;
/** The slot's inverted bevel, 2 px strips over its face: the dark top and left, then the light bottom and right (a Minecraft slot's). */
const BEVEL = 2;
const SLOT_RIGHT = TEXT_LEFT + MACHINE_SLOT;
const SLOT_BOTTOM = SLOT_TOP + MACHINE_SLOT;
const SLOT_LO = `M ${TEXT_LEFT} ${SLOT_TOP} H ${SLOT_RIGHT} V ${SLOT_TOP + BEVEL} H ${TEXT_LEFT + BEVEL} V ${SLOT_BOTTOM} H ${TEXT_LEFT} Z`;
const SLOT_HI = `M ${SLOT_RIGHT} ${SLOT_TOP} V ${SLOT_BOTTOM} H ${TEXT_LEFT} V ${SLOT_BOTTOM - BEVEL} H ${SLOT_RIGHT - BEVEL} V ${SLOT_TOP} Z`;

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

/** A view as its pan's (./glide.ts): the zoom is the pan group's scale. */
function toPan(v: View): PanView {
  return { x: v.x, y: v.y, scale: v.zoom };
}

/** A pan's picture as a view. */
function fromPan(p: PanView): View {
  return { zoom: p.scale, x: p.x, y: p.y };
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

/** The open/collapse button of a supporting line (`data-line-toggle`), whose name is its tooltip too (Phase 2 spec §6.4). */
function LineToggle(props: { lineKey: StuffKey; title: string; open: boolean; x: number; y: number }): ReactElement {
  const { lineKey, title, open, x, y } = props;
  const label = `${open ? 'Collapse' : 'Open'} the ${title}`;
  return (
    <g
      className="flow-line-toggle" data-line-toggle={lineKey} role="button" tabIndex={0} aria-expanded={open}
      aria-label={label} transform={`translate(${x} ${y})`} data-tip={label}
    >
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
          <ItemIcon itemKey={row.key} size={ICON_SIZE} name={row.name} tip={false} />
        </foreignObject>
      )}
      {/* A nested svg clips a row wider than the box; the full text is in the box's tooltip and accessible name. */}
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
 * A step box's machine readout (Phase 2 spec §7.3), in its head: the machine's 32 px icon (a hand step's main output; none without either)
 * in a 36 px slot with the inverted bevel of a Minecraft slot; the tier chip in its tier's ink (none by hand or on a crafting table or a
 * furnace: plan ruling pseudo-tier-chip) and the count chip, each 4 px after the one before, their figures in VT323 (`Figs`, plan ruling
 * digits-mixed); the power 6 px after the last chip, or "by hand" in their place; and under the head the busy band, its track filled to how
 * busy the machines are (`high`, amber, from 90 %) and its percentage at the box's right edge. It only draws: the box's first line says it
 * all in words, the head's name and the box's tip, so it is aria-hidden and its icon shows no tip of its own.
 */
function MachineReadoutShape(props: { node: PlacedNode; machine: MachineReadout }): ReactElement {
  const { node, machine } = props;
  const icon = machine.iconKey ?? node.key;
  const chips: Array<{ part: string; className: string; text: string }> = [];
  if (machine.tier !== null) chips.push({ part: 'tier', className: `flow-chip tier-${machine.tier.slug}`, text: machine.tier.name });
  if (machine.count !== null) chips.push({ part: 'count', className: 'flow-chip', text: machine.count });
  let next = READOUT_LEFT;
  const drawn = chips.map((chip) => {
    const width = chipWidth(chip.text);
    const x = next;
    next += width + CHIP_GAP;
    return (
      <g key={chip.part} className={chip.className} transform={`translate(${x} ${CHIP_TOP})`}>
        <rect width={width} height={CHIP_HEIGHT} />
        <text x={width / 2} y={CHIP_BASELINE}><Figs text={chip.text} svg /></text>
      </g>
    );
  });
  // only a hand step has no count: it has no machine, and its chip row says so
  const power = machine.count === null ? HAND_WORDS : machine.power;
  const powerX = chips.length === 0 ? READOUT_LEFT : next - CHIP_GAP + POWER_GAP;
  const track = busyTrack(node);
  const trackY = STEP_HEAD_HEIGHT + BUSY_TRACK_TOP;
  return (
    <g className="flow-machine" aria-hidden="true">
      <rect className="flow-machine-slot" x={TEXT_LEFT} y={SLOT_TOP} width={MACHINE_SLOT} height={MACHINE_SLOT} />
      <path className="flow-slot-lo" d={SLOT_LO} />
      <path className="flow-slot-hi" d={SLOT_HI} />
      {icon !== null && (
        <foreignObject x={TEXT_LEFT + BEVEL} y={SLOT_TOP + BEVEL} width={MACHINE_ICON} height={MACHINE_ICON}>
          <ItemIcon itemKey={icon} size={MACHINE_ICON} name={machine.iconKey === null ? node.keyName : node.title} tip={false} />
        </foreignObject>
      )}
      {drawn}
      {power !== null && <text className="flow-node-power" x={powerX} y={POWER_BASELINE}>{power}</text>}
      <g className={machine.high ? 'flow-busy high' : 'flow-busy'}>
        <rect className="flow-busy-track" x={TEXT_LEFT} y={trackY} width={track} height={BUSY_TRACK_HEIGHT} />
        <rect className="flow-busy-fill" x={TEXT_LEFT} y={trackY} width={track * machine.busy} height={BUSY_TRACK_HEIGHT} />
        <text className="flow-busy-text" x={node.width - TEXT_LEFT} y={trackY + BUSY_TRACK_HEIGHT}>{machine.busyText}</text>
      </g>
    </g>
  );
}

/**
 * One box: `data-node-id` and `data-kind` on a group (and `data-step-id` on a step's only, ruling P17) holding the box,
 * a head with its item icon, title and lines (a button on a step or an import stub, whose click opens its panel), the
 * badge of avoided goods it uses (`data-avoid-badge`, whose warnings join its tooltip), and a row per good. A step's head
 * is its machine readout (`MachineReadoutShape`, Phase 2 spec §7) beside its title, which draws its first line; its other
 * lines follow under the busy band, each cut with "…" at the box's edge. Its words, one a line (its title, its lines,
 * those warnings and its rows'), are its tooltip and its accessible name (`data-tip` and `aria-label`, Phase 2 spec
 * §6.4), which a focused head or row shows at itself. Under a focus it is lit (`hl`, and `producer` or `consumer`) or
 * dimmed (`dim`).
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
  const { machine } = node;
  // a readout draws the machine's icon in its slot, so the head's 16 px icon of the main output is not drawn
  const icon = machine === undefined ? node.key : null;
  const badge = node.avoidBadge;
  const head = rowsTop(node);
  const toggle = node.kind === 'line' ? TOGGLE_SPACE : 0;
  const titleX = machine !== undefined ? READOUT_LEFT : TEXT_LEFT + (icon !== null ? ICON_SPACE : 0);
  // the lines drawn below the title, or below a readout's band, whose chips and band say the first one
  const linesTop = machine === undefined ? NODE_TITLE_HEIGHT : STEP_HEAD_HEIGHT + BUSY_BAND;
  const shown = machine === undefined ? node.lines : node.lines.slice(1);
  const described = [node.title, ...node.lines, ...(badge?.warnings ?? [])];
  const tip = tipText([...described, ...node.rows.map((r) => rowWords(node, r))]);
  const opens = node.kind === 'step' || node.kind === 'import';
  return (
    <g
      className={classes.join(' ')}
      data-node-id={node.id}
      {...(node.kind === 'step' ? { 'data-step-id': node.id } : {})}
      data-kind={node.kind}
      transform={`translate(${node.x} ${node.y})`}
      aria-label={tip}
      data-tip={tip}
    >
      <rect className="flow-node-box" width={node.width} height={node.height} />
      <g className="flow-node-head" {...(opens ? { role: 'button', tabIndex: 0, 'aria-label': described.join(', '), 'aria-pressed': selected } : {})}>
        <rect className="flow-hit" width={node.width} height={head} />
        {icon !== null && (
          <foreignObject x={TEXT_LEFT} y={ICON_TOP} width={ICON_SIZE} height={ICON_SIZE}>
            <ItemIcon itemKey={icon} size={ICON_SIZE} name={node.keyName} tip={false} />
          </foreignObject>
        )}
        {/* A nested svg clips text that is wider than the box; the full text is in the box's tooltip and accessible name. */}
        <svg width={node.width - toggle} height={head}>
          {machine !== undefined && <MachineReadoutShape node={node} machine={machine} />}
          <text className="flow-node-title" x={titleX} y={TITLE_BASELINE}>{clipText(node.title, node.width - toggle - titleX - TEXT_LEFT, TITLE_CHAR_WIDTH)}</text>
          {shown.map((line, i) => (
            <text key={`${i}:${line}`} className="flow-node-line" x={TEXT_LEFT} y={linesTop + NODE_LINE_HEIGHT * i + 11}>
              {machine === undefined ? line : clipText(line, node.width - 2 * TEXT_LEFT, TEXT_CHAR_WIDTH)}
            </text>
          ))}
          {badge !== undefined && (
            <g className="flow-avoid-badge" data-avoid-badge="" transform={`translate(${BADGE_LEFT} ${linesTop + NODE_LINE_HEIGHT * shown.length})`}>
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

/** An arrow's route as SVG path data, "M x y L x y …": its pipe's, and the path its good rides. */
function routeData(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

/**
 * One arrow, drawn as a pipe (design spec §7): a 10 px transparent path to hover and click, the casing with its head (a
 * red casing with a white head from a stub of what is missing, ruling R34, which stays white when the arrow is lit:
 * the lit yellow reads 2.95:1 on that red, ruling R41), the good moving inside it from the output toward the input
 * (`fluid` or `item`, at the speed of its rate: `--pipe-dur` from `pipeSeconds`; nothing moves from a missing source),
 * its accessible name "name · rate · From → To" and its tooltip, which says those three a line each (Phase 2 spec §6.4,
 * P2-D36), and the rate as its label where a port has other arrows. Under a focus the group alone is lit (`hl`) or
 * dimmed (`dim`). A lit arrow writes "name · rate" in its tag above the boxes instead (`EdgeTagShape`).
 */
export function FlowEdgeShape(props: { edge: PlacedEdge; lit: boolean | null; missing: boolean }): ReactElement | null {
  const { edge, lit, missing } = props;
  if (edge.points.length < 2) return null;
  const d = routeData(edge.points);
  const fluid = isFluidKey(edge.key);
  const classes = ['flow-edge', fluid ? 'fluid' : 'item'];
  if (missing) classes.push('missing');
  if (lit !== null) classes.push(lit ? 'hl' : 'dim');
  const arrow = missing ? 'flow-arrow-missing' : lit === true ? 'flow-arrow-hl' : fluid ? 'flow-arrow-fluid' : 'flow-arrow';
  return (
    <g
      className={classes.join(' ')} data-edge-id={edge.id} data-key={edge.key}
      style={{ '--pipe-dur': `${pipeSeconds(edge.perSecond, fluid)}s` } as CSSProperties}
      aria-label={edge.title} data-tip={tipText([edge.name, edge.rate, edge.route])}
    >
      <path className="flow-edge-hit" d={d} />
      <path className="flow-edge-line" d={d} markerEnd={`url(#${arrow})`} />
      {!missing && <path className="flow-edge-flow" d={d} />}
      {lit !== true && edge.label !== undefined && edge.labelAt !== undefined && (
        <text className="flow-edge-label" x={edge.labelAt[0]} y={edge.labelAt[1]} textAnchor="middle" dominantBaseline="central">{edge.label}</text>
      )}
    </g>
  );
}

/**
 * A rider's picture until its icon has come (ledger ruling P2-R96): a square of `rgb` as an SVG data URI, its quotes written %22, so the
 * rider is the same <image> before and after and only its `href` changes, which leaves its ride where it is.
 */
function swatchHref([r, g, b]: Rgb): string {
  return `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22 shape-rendering=%22crispEdges%22%3E`
    + `%3Crect width=%221%22 height=%221%22 fill=%22rgb(${r},${g},${b})%22/%3E%3C/svg%3E`;
}

/**
 * The good riding an arrow's pipe (Phase 2 spec §15.3), from the output toward the input: one 12 px <image> from its mount, which shows the
 * rows' 16 px icon of its good once that has come and a square in the good's colour until then (`placeholder`; ledger ruling P2-R96), so its
 * ride never starts over. The stylesheet carries it along the arrow's route, run on 9 px past each end into the boxes (`rideRoute`, ledger
 * ruling P2-R97: a ride starts and ends out of sight), by `offset-path` and the `pipe-ride` keyframes, once a ride (`--rider-dur`,
 * `riderSeconds`), started part-way by its edge's phase (a negative delay), so the goods of a diagram do not leave their ports together. Lit
 * (`hl`) or dimmed (`dim`) with its pipe. It only draws: nothing an arrow or a box carries for the hit test, the tooltips or the tests, and the
 * stylesheet gives it no pointer, so the arrow under it keeps its hover, its click and its tip. Memoized: a pan or a zoom draws the canvas
 * again, but no rider, whose arrow and light have not changed.
 */
export const FlowRiderShape = memo(function FlowRiderShape(props: { edge: PlacedEdge; lit: boolean | null }): ReactElement {
  const { edge, lit } = props;
  const { desc, url } = useItemIcon(edge.key, ICON_SIZE);
  const fluid = isFluidKey(edge.key);
  const route = rideRoute(edge.points);
  const seconds = riderSeconds(pathLength(route), edge.perSecond, fluid);
  const style = {
    offsetPath: `path('${routeData(route)}')`, '--rider-dur': `${seconds}s`,
    animationDelay: `-${Math.round(riderPhase(edge.id) * seconds * 100) / 100}s`,
  } as CSSProperties;
  const classes = ['flow-rider', ...(url === null ? ['placeholder'] : []), fluid ? 'fluid' : 'item', ...(lit === null ? [] : [lit ? 'hl' : 'dim'])];
  // `offset-anchor: auto` is the origin of its own coordinates, which the path moves: the square is centred on it
  const corner = -RIDER_SIZE / 2;
  return (
    <image
      className={classes.join(' ')} href={url ?? swatchHref(desc?.fallbackColor ?? hashColor(edge.key))} x={corner} y={corner}
      width={RIDER_SIZE} height={RIDER_SIZE} style={style}
    />
  );
});

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

/**
 * A box a new layout dropped (Phase 2 spec §16.3, P2-D42): its kind, how much of it the group owned and an import's kind of import, where it was
 * drawn (where it stood, or part way along the last layout's glide: ledger ruling P2-R117) and its size, and the opacity it was drawn at: whole,
 * or DIM_OPACITY for a box a focus did not light, and only as much of that as it had faded in, for a box that came with the last layout and
 * still faded in (fix round 2, P2-R109 widened).
 */
interface Ghost {
  id: string; kind: FlowNodeKind; owned: FlowNode['owned']; leaf?: LeafClass; x: number; y: number; width: number; height: number; opacity: number;
}

/**
 * A box a new layout dropped, fading out where it stood (Phase 2 spec §16.3, P2-D42): a faithful copy of its box's look (ledger ruling P2-R118),
 * its kind's fill and edge, `owned`, `partly-owned` or `new` for a step, else its stub's kind, an import's with its `leaf-<class>`. It is
 * aria-hidden and the stylesheet gives it no pointer, and it carries nothing a box carries for the hit test, the focus, the tips or the tests (no
 * id, kind or port, no role or tab stop, no light, no flange), so none of them sees it. From the moment it is drawn it fades over EXIT_MS with
 * `--ease-in`, from the opacity its box was drawn at (a dimmed box's ghost never flashes whole first) to nothing, held there until `onGone` takes
 * it away: once its fade has run or is cancelled, at once when the fade cannot start, and in any case GHOST_FALLBACK_MS after it was drawn
 * (FlowCanvas takes it away with the next new layout too).
 */
export function FlowGhostShape(props: { ghost: Ghost; onGone(ghost: Ghost): void }): ReactElement {
  const { ghost, onGone } = props;
  const ref = useRef<SVGGElement | null>(null);
  useLayoutEffect(() => {
    const gone = (): void => onGone(ghost);
    let fade: Animation | undefined;
    try {
      fade = ref.current?.animate([{ opacity: ghost.opacity }, { opacity: 0 }], { duration: EXIT_MS, easing: EASE_IN, fill: 'forwards' });
    } catch {
      fade = undefined;
    }
    if (fade === undefined) {
      gone();                                       // no fade: it goes before it is painted
      return undefined;
    }
    const running = fade;
    running.addEventListener('finish', gone);
    running.addEventListener('cancel', gone);
    const fallback = setTimeout(gone, GHOST_FALLBACK_MS);
    return () => {
      clearTimeout(fallback);
      running.removeEventListener('finish', gone);
      running.removeEventListener('cancel', gone);
      running.cancel();
    };
  }, [ghost]);   // a new ghost of the same box fades again from the start; `onGone` takes away the ghost it is given, whichever render made it
  const classes = ['flow-ghost', ghost.kind === 'step' ? OWNED_CLASS[ghost.owned] : ghost.kind, ...(ghost.leaf === undefined ? [] : [`leaf-${ghost.leaf}`])];
  return (
    <g ref={ref} className={classes.join(' ')} aria-hidden="true" transform={`translate(${ghost.x} ${ghost.y})`}>
      <rect className="flow-ghost-box" width={ghost.width} height={ghost.height} />
    </g>
  );
}

/**
 * What a new layout of the Flow diagram glides (./glide.ts): its boxes and open lines, its arrows, a lit arrow's tag with its arrow (ledger
 * ruling P2-R120), and the goods riding them.
 */
const FLOW_GLIDE: GlideTargets = { boxes: ['data-node-id', 'data-group-id'], edges: 'data-edge-id', tags: 'data-edge-tag', extra: '.flow-riders' };

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
 * Keep only goes as it sets its pin, so it hands the focus to its own line's Show first, which stays while the line says
 * "Updating…" (the final fix wave, FW-7; ledger ruling P2-R57); a replan that drops the line is FlowDiagram's to answer.
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
              <button
                type="button" className="small"
                onClick={(e) => {
                  e.currentTarget.closest('li')?.querySelector('button')?.focus();
                  send([{ op: 'settings', patch: useOnlyPatch(settings, issue.key, keepOnly.recipeId) }]);
                }}
              >
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

/** The px height the canvas's style asks for a diagram `height` tall (in its units): the diagram and the room around it (75vh at most). */
const canvasPx = (height: number): number => Math.ceil(height + 2 * PAD);

/** A computed style's length in px (`'2px'`), 0 for none. */
const stylePx = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Where the Flow canvas `svg` stands once it is as tall as its own style makes it for a diagram `height` tall (in its units), 75vh at most and
 * its min-height at least, from its top as it is now: its border box (`box`) and its inner height (`inner`, less its border). While a hold
 * keeps the canvas taller (ledger ruling P2-R121), the canvas the hold ends at, which a view is made for (`canvas()`, fix round 2) and a
 * panel's Close judges the box head against (P2-R36, fix round 3); at rest, the canvas as it is drawn.
 */
function settledCanvas(svg: SVGSVGElement, height: number): { box: DOMRect; inner: number } {
  const style = getComputedStyle(svg);
  const drawn = svg.getBoundingClientRect();
  const tall = Math.max(stylePx(style.minHeight), Math.min(canvasPx(height), innerHeight * 0.75));
  return { box: new DOMRect(drawn.left, drawn.top, drawn.width, tall), inner: tall - stylePx(style.borderTopWidth) - stylePx(style.borderBottomWidth) };
}

/**
 * The height (the diagram's, in its units) the canvas keeps once the layout `after` replaces `before`, `held` the one it keeps now, null for
 * none (ledger ruling P2-R121): a new layout that glides into place and draws the canvas shorter keeps it at the height it was drawn at, so
 * nothing gliding up from below and no ghost under the new edge is cut off, until its glides have run and its ghosts have gone (FlowCanvas
 * releases it); one that snaps (it changes more than GLIDE_LIMIT boxes, or the user asks for less motion) or that leaves the canvas as tall
 * takes its own height at once; the same layout again (every SSE refetch's) keeps what is kept. The canvas is as tall as its diagram, `room`
 * px (75vh) at most, so a hold that would draw it no taller than the new layout is none. Pure, but for the motion setting, so the canvas
 * decides it as it draws the new layout, and holding costs it no render of its own (fix round 2).
 */
export function heldHeight(
  before: FlowLayout, after: FlowLayout, held: number | null, room: number, change: LayoutChange = layoutChange(before, after),
): number | null {
  if (change.moved.length + change.entered.length + change.left.length + change.rerouted.length === 0) return held;
  if (prefersReducedMotion() || !glidable(change)) return null;
  const drawnAt = held ?? before.height;
  return Math.min(canvasPx(drawnAt), room) > Math.min(canvasPx(after.height), room) ? drawnAt : null;
}

/**
 * Whether the view a new layout brings (a new plan's, or the box of a line opened or closed, centred) is panned to over PAN_MS (Phase 2 spec
 * §16.2): only when the layout glides into place, as `glidable` decides for its glide too; a layout that snaps (it changes more than
 * GLIDE_LIMIT boxes) takes its view at once, as it draws its boxes, so no pan runs over a picture drawn anew (ledger ruling P2-R126). Where
 * the user asks for less motion, or the browser cannot glide, `usePan` takes every view at once already.
 */
export function viewPans(change: LayoutChange): boolean {
  return glidable(change);
}

/**
 * The laid-out diagram (fix spec §6.2) with pan (a drag once the pointer itself has moved, which keeps the spot it grabbed
 * under the pointer while the canvas moves on the page) and zoom (wheel, buttons, Fit), Find item and the "Imports in
 * one column" toggle; hovering lights what is under the pointer, a click pins it (a box click also calls `onOpen`),
 * Esc or a click on the empty canvas clears it. It opens on the target (or on what someone asked to see) whenever the
 * plan's steps change (`viewKey`), and centres the focus whenever a view asks (`revealFlowFocus`). Its first view is drawn at once; Fit,
 * the zoom buttons, a reveal, a line opened or closed and a later plan's view are panned to over 250 ms (Phase 2 spec §16.2, `usePan`; the
 * last two only when the new layout glides, else they are taken at once: ledger ruling P2-R126),
 * while the wheel and a drag move the view at once, from the picture on screen, where they stop a pan under way (review focus 1). A new
 * layout glides into place from the last (§16.3, `glideLayout`), and the boxes it dropped fade out where they stood, as ghosts. The
 * canvas can take the focus from a script, out of the tab order: a panel's Close gives it there once the box that opened the panel is
 * gone or panned out of its view (P2-R36), and so does a new layout that takes away what had the focus (a box a replan dropped), unless it
 * draws the same line's open/collapse button again elsewhere, which takes it back. A press focuses it too, with no ring; the keyboard's
 * ring is drawn inside it.
 */
function FlowCanvas(props: {
  layout: FlowLayout; viewKey: string; selectedId: string | null; goods: Array<{ key: StuffKey; name: string }>;
  importsInOneColumn: boolean; onImportsInOneColumn(on: boolean): void; onOpen(node: PlacedNode): void; onToggleLine(key: StuffKey): void;
}): ReactElement {
  const { layout, viewKey, selectedId, goods, importsInOneColumn, onImportsInOneColumn, onOpen, onToggleLine } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: PAD, y: PAD });
  /** The pan group (`g.flow-pan`), whose attribute is the view; `glideTo` pans to a view, `holdView` holds a pan for an instant move. */
  const { panRef, glideTo, holdView } = usePan(view, setView, toPan, fromPan);
  /** The plan steps (`viewKey`) this canvas has opened on: its first view is drawn at once, a later plan's panned to. */
  const openedOn = useRef<string | null>(null);
  /**
   * The press that may become a drag: its pointer, where it went down on the page (`cx`, `cy`: client px) and on the canvas (`sx`, `sy`:
   * `pointIn`), and the view then (the picture on screen once it is a drag, when a pan was under way).
   */
  const drag = useRef<{ pointer: number; cx: number; cy: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  /** A drag past `DRAG_THRESHOLD` is under way: the pipes stand still while it is (`dragging` on the svg). */
  const [dragging, setDragging] = useState(false);
  /** What the pointer last lit (`focusText`), so a move within one thing changes nothing. */
  const hovered = useRef('');
  /** A line just opened or closed: its box, to centre once the new layout has it. */
  const centreNext = useRef<string | null>(null);
  /**
   * The layout whose glide ran last (its effect's), whose boxes a new one drops fade out where they stood; null before the first. The new
   * layout's `change` is worked out against the same one, as it is drawn (`drawn`).
   */
  const placedBefore = useRef<FlowLayout | null>(null);
  /** The boxes the last new layout dropped, fading out where they stood (Phase 2 spec §16.3, P2-D42). */
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  /** The ghosts drawn now, as what takes them away sees them (`ghosts` is what a render draws): the two are set together. */
  const shownGhosts = useRef<Ghost[]>([]);
  /**
   * The layout drawn last, and what it changed of the one before (`layoutChange`), worked out once, as the new layout is drawn: the one result
   * its glide, the height the canvas keeps and the way its view is taken all go by (ledger rulings P2-R121, P2-R126; Task F4).
   */
  const [drawn, setDrawn] = useState(() => ({ layout, change: layoutChange(null, layout) }));
  /**
   * While a new layout that shortens the diagram glides, the height the canvas keeps (the diagram's, in its units), null at rest (ledger ruling
   * P2-R121, `heldHeight`). It is decided as each new layout is drawn, so the layout's own commit draws the canvas held, and it is released
   * once, by whichever ends last of the layout's glides and its ghosts: holding costs the canvas one render, the release's (fix round 2).
   */
  const [hold, setHold] = useState<number | null>(null);
  if (drawn.layout !== layout) {
    const next = layoutChange(drawn.layout, layout);
    setDrawn({ layout, change: next });
    setHold(heldHeight(drawn.layout, layout, hold, innerHeight * 0.75, next));
  }
  const { change } = drawn;
  /** The glides of the layout that holds the canvas, until they have run; null once they have, or when no layout holds it. */
  const holding = useRef<Promise<unknown> | null>(null);
  /** What in the canvas has the focus (its last `focusin`), until the focus has really moved from it (ledger ruling P2-R122). */
  const focusedIn = useRef<Element | null>(null);
  const focus = useFlowFocus();
  const reveal = useFlowReveal();
  const seenReveal = useRef(reveal);
  /** The pipes stand still where they are: this browser's Pause pipes (ruling R31). */
  const pipesPaused = usePipesPaused();
  /** Whether the single-key shortcuts act, so Fit and Pause pipes say their keys, and the hint the sheet's (ledger ruling P2-R85). */
  const keysOn = useSingleKeyShortcuts();
  const sets = useMemo(() => focusSets(layout, focus), [layout, focus]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  /** The arrows from a stub of what is missing: nothing moves in them, and no good rides them. */
  const missingIds = useMemo(() => new Set(layout.edges.filter((e) => byId.get(e.from)?.kind === 'missing').map((e) => e.id)), [layout, byId]);
  /** The arrows a good rides (Phase 2 spec §15.1): past 200 arrows the lit ones only, and never more than `RIDER_LIMIT`. */
  const riders = useMemo(() => riderEdges(layout.edges, sets?.edges ?? null, missingIds), [layout, sets, missingIds]);

  /**
   * The canvas's inner size in px, which Fit, the zoom buttons, a reveal and a new plan's view fit their view to. While a hold keeps it taller,
   * the height it settles at once the hold ends, as the svg's own style computes it (`settledCanvas`), so the view is made for the canvas it will
   * be shown in, never cropped or off-centre once the hold ends (fix round 2).
   */
  const canvas = (): { width: number; height: number } => {
    const svg = svgRef.current;
    if (svg === null) return { width: 0, height: 0 };
    return { width: svg.clientWidth, height: hold === null ? svg.clientHeight : settledCanvas(svg, layout.height).inner };
  };
  /**
   * Pans to the box (or open line) `id`, centred (a reveal, a line opened or closed), or moves there at once (`pans` false: the box of a line
   * whose new layout snaps, P2-R126); false when this layout has none.
   */
  const centre = (id: string, minZoom = 0, pans = true): boolean => {
    const box = byId.get(id) ?? layout.groups.find((g) => g.id === id);
    if (box === undefined) return false;
    (pans ? glideTo : setView)((v) => centreOn(box, { ...v, zoom: Math.max(v.zoom, minZoom) }, canvas()));
    return true;
  };

  // A new plan: open on what someone asked to see, else on the target (fix spec §6.2). The first plan this canvas shows opens there at once
  // (flow-focus.spec.ts measures it, and so does a reveal that mounts the diagram); a later one is panned to from the picture of the last when
  // its layout glides, and taken at once when it snaps (`viewPans`, ledger ruling P2-R126). So is the box of a line opened or closed, centred.
  useLayoutEffect(() => {
    const anchor = focusAnchor(layout, getFlowFocus());
    const box = anchor === undefined ? undefined : byId.get(anchor);
    const next = box === undefined ? initialView(layout, canvas()) : centreOn(box, { zoom: INITIAL_ZOOM, x: 0, y: 0 }, canvas());
    // StrictMode runs this twice on the first mount, for the same steps
    if (openedOn.current === null || openedOn.current === viewKey || !viewPans(change)) setView(next);
    else glideTo(next);
    openedOn.current = viewKey;
  }, [viewKey]);   // reads the current layout; only a change of the plan's steps resets the view
  useLayoutEffect(() => {
    const id = centreNext.current;
    if (id !== null && centre(id, 0, viewPans(change))) centreNext.current = null;
  }, [layout]);
  // A new layout glides into place from the last, before it is painted (Phase 2 spec §16.3): the boxes that moved, came and went, and the
  // arrows and goods that changed (`glideLayout`); while it glides, the boxes it dropped fade out as ghosts where they were drawn in the last
  // (part way along its glide, if it still glided them: ledger ruling P2-R117), each from the opacity it was drawn at under the focus, and, if it
  // still faded in, at that much of it (fix round 2). A new layout that changes anything takes the last one's ghosts away (M1); the ghosts are set
  // only when there are ghosts to add or take away, so a new layout that adds none draws the canvas once (M2). A layout whose render held the
  // canvas's height (`heldHeight`, ledger ruling P2-R121) releases it once its glides have run and its ghosts have gone, whichever is last (and
  // at once when nothing glides after all: the browser cannot, `canGlide`); an older layout's glides then release nothing. The first layout,
  // and StrictMode's second run of this effect, which finds the same one, change nothing.
  // What had the focus and is gone with the last layout gives it on, never to the body (ledger rulings P2-R36, P2-R57): to the same line's
  // open/collapse button where the new layout draws it again, else to the canvas, where nothing moves the page.
  useLayoutEffect(() => {
    const before = placedBefore.current;
    placedBefore.current = layout;
    const pan = panRef.current;
    const gone: Ghost[] = [];
    if (before !== null && change.left.length > 0 && layoutGlides(change)) {
      const left = new Set(change.left);
      const lit = focusSets(before, focus);
      for (const { id, kind, owned, leaf, x, y, width, height } of before.nodes) {
        if (!left.has(id)) continue;
        const [atX, atY] = (pan === null ? null : glidingAt(pan, id)) ?? [x, y];
        const opacity = (lit === null || lit.nodes.has(id) ? 1 : DIM_OPACITY) * ((pan === null ? null : fadedIn(pan, id)) ?? 1);
        gone.push({ id, kind, owned, ...(leaf === undefined ? {} : { leaf }), x: atX, y: atY, width, height, opacity });
      }
    }
    const started = pan === null ? [] : glideLayout(pan, change, FLOW_GLIDE);
    const changed = change.moved.length + change.entered.length + change.left.length + change.rerouted.length > 0;
    if (gone.length > 0 || (changed && shownGhosts.current.length > 0)) {
      shownGhosts.current = gone;
      setGhosts(gone);
    }
    if (changed) {
      const waits = hold !== null && (started.length > 0 || gone.length > 0);
      const glides = waits ? Promise.all(started.map((a) => a.finished.catch(() => undefined))) : null;
      holding.current = glides;
      if (hold !== null && glides === null) setHold(null);
      void glides?.then(() => {
        if (holding.current !== glides) return;
        holding.current = null;
        if (shownGhosts.current.length === 0) setHold(null);
      });
    }
    const had = focusedIn.current;
    const svg = svgRef.current;
    if (had === null || had.isConnected || svg === null || !focusLost()) return;
    const line = had.getAttribute('data-line-toggle');
    const again = line === null ? undefined : [...svg.querySelectorAll('[data-line-toggle]')].find((el) => el.getAttribute('data-line-toggle') === line);
    if (!focusOn(again, { preventScroll: true })) focusOn(svg, { preventScroll: true });
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
    // React's wheel listener is passive, so it cannot stop the page from scrolling; this one can. It zooms the picture on screen at once:
    // a pan under way stops where it is (review focus 1).
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = svg.getBoundingClientRect();
      const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PIXELS : e.deltaY;
      const held = holdView();
      setView((v) => zoomed(held ?? v, e.clientX - box.left, e.clientY - box.top, Math.exp(-pixels * WHEEL_ZOOM)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    // what in the canvas takes the focus; the focus leaving it (for another control, or for nothing: a press on the page) leaves nothing to
    // give on. A microtask later, and only once the focus has really moved: a window that loses the focus fires a focusout on what has it, which
    // keeps it (ledger ruling P2-R122), and a new layout that takes it away removes it first, and the layout's effect, which runs before the
    // microtask, gives the focus on
    const into = (e: FocusEvent): void => {
      focusedIn.current = e.target instanceof Element ? e.target : null;
    };
    const out = (e: FocusEvent): void => {
      const was = e.target;
      queueMicrotask(() => {
        if (focusedIn.current === was && document.activeElement !== was) focusedIn.current = null;
      });
    };
    svg.addEventListener('focusin', into);
    svg.addEventListener('focusout', out);
    return () => {
      svg.removeEventListener('focusin', into);
      svg.removeEventListener('focusout', out);
    };
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

  const fit = (minZoom: number): void => glideTo(fitView(layout, canvas().width, canvas().height, minZoom));
  /**
   * A ghost whose fade has run goes (that one: a newer ghost of the same box stays); the last to go releases a hold whose glides have run, in
   * the same render. It reads no render's state, as a ghost keeps the one it was drawn with.
   */
  const dropGhost = (ghost: Ghost): void => {
    const left = shownGhosts.current.filter((other) => other !== ghost);
    if (left.length === shownGhosts.current.length) return;
    shownGhosts.current = left;
    setGhosts(left);
    if (left.length === 0 && holding.current === null) setHold(null);
  };
  const zoomCentre = (factor: number): void => glideTo((v) => zoomed(v, canvas().width / 2, canvas().height / 2, factor));

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
    if (e.button === 0) {
      const [sx, sy] = pointIn(e);
      drag.current = { pointer: e.pointerId, cx: e.clientX, cy: e.clientY, sx, sy, ox: view.x, oy: view.y, moved: false };
    }
    settleDragging();
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d !== null && d.pointer === e.pointerId && (e.buttons & 1) === 0) {
      // let go outside the canvas before it was a drag, so the canvas never heard it (it captures the pointer only once a press is a drag): the
      // press is over, and the bare pointer lights what it is on, as Connections' drag does (the final fix wave, FW-11)
      onPointerEnd(e);
      hover(hitOf(e.target)?.focus ?? null);
      return;
    }
    if (d === null || d.pointer !== e.pointerId) {
      hover(hitOf(e.target)?.focus ?? null);
      return;
    }
    if (!d.moved) {
      // the pointer's own move decides: a still press stays a click while the canvas moves under it (P2-R16)
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < DRAG_THRESHOLD) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);   // only now: a plain click must still reach the box under it
      setDragging(true);
      // a pan under way stops where it is on screen, and the drag carries on from that picture, its zoom too, as the move below sets x and y
      // only (review focus 1); a click lets it run on
      const held = holdView();
      if (held !== null) {
        setView(held);
        d.ox = held.x;
        d.oy = held.y;
      }
    }
    // the drag follows the canvas: the spot it grabbed stays under the pointer while the canvas moves on the page (`pointIn`, P2-R16)
    const [px, py] = pointIn(e);
    setView((v) => ({ ...v, x: d.ox + px - d.sx, y: d.oy + py - d.sy }));
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
    // a held Enter's repeat that landed here from where its press began (a Close that gave the focus back to its box) is not a pick (P2-R69a)
    if ((e.key !== 'Enter' && e.key !== ' ') || e.nativeEvent.defaultPrevented) return;
    const hit = hitOf(e.target);
    if (hit === null) return;
    e.preventDefault();
    activate(hit);
  };
  // `focusing` under a focus, `dragging` while the view is dragged, `many-edges` when only the lit pipes move (pipe-motion.ts),
  // `pipes-paused` while this browser has the pipes paused
  const canvasClasses = ['flow-canvas'];
  if (sets !== null) canvasClasses.push('focusing');
  if (dragging) canvasClasses.push('dragging');
  if (pipeAnimationMode(layout.edges.length) === 'lit') canvasClasses.push('many-edges');
  if (pipesPaused) canvasClasses.push('pipes-paused');

  return (
    <div className="flow-diagram">
      <div className="flow-toolbar row">
        <button type="button" className="small" aria-label="Zoom in" onClick={() => zoomCentre(ZOOM_STEP)}>+</button>
        <button type="button" className="small" aria-label="Zoom out" onClick={() => zoomCentre(1 / ZOOM_STEP)}>−</button>
        <button
          type="button" className="small" aria-keyshortcuts={keysOn ? 'F' : undefined} data-tip={keysOn ? 'Fit · F' : undefined}
          onClick={() => fit(MIN_ZOOM)}
        >
          Fit
        </button>
        <PipesButton paused={pipesPaused} keys={keysOn} />
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
        <span className="muted small">
          Hover or click a good for its sources and uses, click a box for details, Esc clears. Drag moves, scroll zooms.{keysOn && SHEET_KEY_HINT}
        </span>
      </div>
      <svg
        ref={svgRef}
        className={canvasClasses.join(' ')}
        role="group"
        aria-label="Flow diagram"
        tabIndex={-1}
        style={{ height: `min(${canvasPx(Math.max(layout.height, hold ?? 0))}px, 75vh)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => hover(null)}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <FlowDefs />
        <g className="flow-pan" ref={panRef} transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {layout.groups.map((group) => (
            <FlowGroupShape key={group.id} group={group} dim={sets !== null && !group.nodes.some((id) => sets.nodes.has(id))} />
          ))}
          {layout.edges.map((edge) => (
            <FlowEdgeShape key={edge.id} edge={edge} lit={sets === null ? null : sets.edges.has(edge.id)} missing={missingIds.has(edge.id)} />
          ))}
          {/* the goods riding the pipes (Phase 2 spec §15.3): over the pipes, under the boxes, whose flanges they slip under, and the lit tags */}
          <g className="flow-riders" aria-hidden="true">
            {riders.map((edge) => <FlowRiderShape key={edge.id} edge={edge} lit={sets === null ? null : sets.edges.has(edge.id)} />)}
          </g>
          {/* the boxes new layouts dropped, fading out where they stood (Phase 2 spec §16.3): over the goods, whose rides end under the boxes */}
          {ghosts.map((ghost) => <FlowGhostShape key={ghost.id} ghost={ghost} onGone={dropGhost} />)}
          {layout.nodes.map((node) => <FlowNodeShape key={node.id} node={node} sets={sets} selected={node.id === selectedId} />)}
          {sets !== null && layout.edges.filter((edge) => sets.edges.has(edge.id)).map((edge) => <EdgeTagShape key={edge.id} edge={edge} />)}
        </g>
      </svg>
      <FlowLegend />
    </div>
  );
}

/** A box on the page (a DOMRect is one). */
interface PageBox { top: number; bottom: number; left: number; right: number }

/** True when the boxes share no area: one lies wholly above, below, left or right of the other. */
export function disjoint(a: PageBox, b: PageBox): boolean {
  return a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
}

/** True when the window (`width` × `height`) shows no part of `box`: it lies wholly above, below, left or right of it (ledger ruling P2-R35). */
export function outsideWindow(box: PageBox, width: number, height: number): boolean {
  return disjoint(box, { top: 0, bottom: height, left: 0, right: width });
}

/**
 * Where `el` stands on screen; for what the diagram draws, where it stands once a pan under way has ended, in the view the pan group's attribute
 * holds (Task 13a), and once a new layout's glide of its box has ended, where the box's attribute puts it (Task 13b): what the focus will show is
 * judged where it will be, not on the picture on its way there.
 */
function boxAtRest(el: Element): DOMRect {
  const pan = el.closest<SVGGElement>('g.flow-pan');
  return pan === null ? el.getBoundingClientRect() : restingBox(pan, el);
}

/**
 * Gives `el` the focus without moving the page, then, only when the window shows no part of `seen` (what must be in sight: a panel's head, or
 * `el` itself) where it rests (`boxAtRest`), scrolls `seen` in by the least scroll, so the focus stays in sight (ledger rulings P2-R35 and
 * P2-R36; WCAG 2.4.11). What the window shows, even in part, never moves the page. The scroll goes by where `seen` is drawn, so a pan under way,
 * and the glide of a new layout that moves its box, end at once first, where it rests.
 */
function focusInWindow(el: HTMLElement | SVGElement, seen: Element = el): void {
  el.focus({ preventScroll: true });
  if (!outsideWindow(boxAtRest(seen), innerWidth, innerHeight)) return;
  const pan = seen.closest<SVGGElement>('g.flow-pan');
  if (pan !== null) settle(pan, seen);
  seen.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  /** The side panel's wrapper: it stays mounted while a panel is open, so it slides in once (Phase 2 spec §8.6). */
  const sideRef = useRef<HTMLDivElement | null>(null);
  /** A step picked inside the panel replaced it: the new panel takes the focus, which went with the control that was picked (P2-D33). */
  const focusPanel = useRef(false);
  /** The diagram's column: its Flow canvas takes the focus when the panel's Close finds the box that opened the panel gone or out of view. */
  const mainRef = useRef<HTMLDivElement | null>(null);
  /** The panel was closed with its Close button: the box whose head takes the focus back (P2-R36), else null. */
  const refocusBox = useRef<string | null>(null);
  /** What in the side panel has the focus (its last `focusin`), until the focus leaves the panel (ledger ruling P2-R122). */
  const focusedInPanel = useRef<Element | null>(null);
  /** What in the issues above the diagram has the focus (a Show, a Keep only), until the focus leaves them (the final fix wave, FW-7). */
  const focusedInIssues = useRef<Element | null>(null);

  useEffect(() => {
    // what in the side panel, or in the issues above the diagram, takes the focus; the focus leaving it, once it has really moved (a window that
    // loses the focus keeps it there), leaves nothing to give on (as the canvas's own record, FlowCanvas)
    const into = (e: FocusEvent): void => {
      const target = e.target;
      focusedInPanel.current = target instanceof Element && sideRef.current?.contains(target) === true ? target : null;
      focusedInIssues.current = target instanceof Element && target.closest('.flow-issues') !== null && mainRef.current?.contains(target) === true ? target : null;
    };
    const out = (e: FocusEvent): void => {
      const was = e.target;
      queueMicrotask(() => {
        if (focusedInPanel.current === was && document.activeElement !== was) focusedInPanel.current = null;
        if (focusedInIssues.current === was && document.activeElement !== was) focusedInIssues.current = null;
      });
    };
    document.addEventListener('focusin', into);
    document.addEventListener('focusout', out);
    return () => {
      document.removeEventListener('focusin', into);
      document.removeEventListener('focusout', out);
    };
  }, []);

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
  // Before it paints, the focus goes to the panel of a step picked inside the old panel, and the panel's Close gives it back to the head of
  // the box that opened the panel, or to the canvas once a replan has removed that box or a pan has taken it out of the canvas's view; a
  // pick on the canvas leaves the focus where it is.
  // The new panel stands where the old one stood, so neither moves the page unless the window shows nothing of the panel's head or of the
  // box head (a plain focus would jump the page to show a panel's cut-off end): then that comes in by the least scroll (P2-R35, P2-R36).
  // While Fit, a zoom button or a reveal still pans the diagram, or a new layout glides the box, the box head is judged where it will rest
  // (`boxAtRest`, Tasks 13a and 13b), and while a hold keeps the canvas taller, against the canvas the hold ends at (`settledCanvas`, fix
  // round 3): a head in the band the hold gives up would take the focus and then be cut off.
  useLayoutEffect(() => {
    if (focusPanel.current) {
      focusPanel.current = false;
      const aside = sideRef.current?.querySelector('aside') ?? null;
      if (aside !== null) focusInWindow(aside, aside.querySelector('.flow-panel-head') ?? aside);
    }
    const box = refocusBox.current;
    if (box !== null) {
      refocusBox.current = null;
      const canvas = mainRef.current?.querySelector<SVGSVGElement>('svg.flow-canvas') ?? null;
      const node = [...(canvas?.querySelectorAll('[data-node-id]') ?? [])].find((el) => el.getAttribute('data-node-id') === box);
      const head = node?.querySelector<SVGGElement>('.flow-node-head[tabindex]') ?? null;
      // a head panned out of the canvas's own view would take the focus unseen, and scroll the page to it for nothing: the canvas takes it
      const view = canvas === null || laid === null ? null : settledCanvas(canvas, laid.layout.height).box;
      const seen = head !== null && view !== null && !disjoint(boxAtRest(head), view);
      const target = seen ? head : canvas;
      if (target !== null) focusInWindow(target);
    }
  }, [selected]);
  // What had the focus in the panel and is gone, with the focus lost, gives it on, never to the body (ledger rulings P2-R57, P2-R122): a control
  // that went while its panel stays (a "We already have a supply" giving way to its "marked supplied" line) to the panel itself, its aside, as a
  // panel takes it (ledger ruling P2-R123, P2-R35), with nothing scrolled while the window shows any of the panel, so the line that took the
  // control's place stays in sight where the press left it (the panel is not scrolled back to its head); one that went with its panel (a replan
  // took its step or its import away) to the canvas, where nothing moves the page. After the effect above, which gives it back on a Close or a
  // pick inside the panel
  useLayoutEffect(() => {
    const had = focusedInPanel.current;
    if (had === null || had.isConnected || !focusLost()) return;
    focusedInPanel.current = null;
    const aside = sideRef.current?.querySelector('aside') ?? null;
    if (aside !== null) focusInWindow(aside);
    else focusOn(mainRef.current?.querySelector('svg.flow-canvas'), { preventScroll: true });
  });
  // An issue's line that had the focus and is gone with the plan that answered it (a Keep only's pin), the focus lost with it, gives it on, never
  // to the body (the final fix wave, FW-7; ledger rulings P2-R57, P2-R112's order): to the first Show left, else to the canvas, where nothing
  // moves the page
  useLayoutEffect(() => {
    const had = focusedInIssues.current;
    if (had === null || had.isConnected || !focusLost()) return;
    focusedInIssues.current = null;
    const main = mainRef.current;
    if (!focusOn(main?.querySelector('.flow-issues li button'), { preventScroll: true })) focusOn(main?.querySelector('svg.flow-canvas'), { preventScroll: true });
  });

  if (graph.nodes.length === 0) return <p className="muted">This plan has nothing to draw.</p>;

  /**
   * A step picked in a panel (a Takes/Makes peer, a Used by step): the row hovered there is gone with its panel, and so is the control
   * that had the focus, which the new panel takes.
   */
  const selectStep = (id: string): void => {
    endHoverFlowFocus();
    focusPanel.current = true;
    setSelected({ kind: 'step', id });
  };
  /**
   * The panel's Close: the focus goes back to the head of its box, the one a pick on the canvas opened it from (for a step reached from a
   * panel, the box of that step), while it is drawn in the canvas's view (P2-R36).
   */
  const close = (): void => {
    refocusBox.current = selected === null ? null : selected.kind === 'step' ? selected.id : selected.nodeId;
    setSelected(null);
  };
  let panel: ReactElement | null = null;
  let selectedId: string | null = null;
  if (selected?.kind === 'step') {
    const step = plan.steps.find((s) => s.id === selected.id);
    // Keyed by the step, so its open "more…" pages close when another step is picked; its wrapper stays, and only the panel fades in anew.
    if (step !== undefined) {
      panel = <StepPanel key={step.id} step={step} plan={plan} settings={settings} per={per} send={send} onClose={close} onSelect={selectStep} base={props.base} />;
      selectedId = step.id;
    }
  } else if (selected?.kind === 'import' && plan.flows.some((f) => f.from === 'raw' && f.key === selected.key)) {
    // Keyed by the stub picked, as a step's panel is by its step: another import's pick fades in a new panel, at its top.
    panel = <RawPanel key={selected.nodeId} itemKey={selected.key} plan={plan} settings={settings} per={per} send={send} onClose={close} onSelect={selectStep} />;
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
      <div className="flow-main" ref={mainRef}>
        <WhatChanged previous={previousPlan} plan={plan} />
        <FlowIssues plan={plan} settings={settings} send={send} onShow={(key) => revealFlowFocus({ kind: 'item', key })} />
        {error !== null && <p className="error" role="alert">{`Could not lay out the diagram: ${error}`}</p>}
        {laid === null ? (
          error === null && <><p className="muted">Laying out the diagram…</p><Skeleton shape="diagram" /></>
        ) : (
          <FlowCanvas
            layout={laid.layout} viewKey={laid.viewKey} selectedId={selectedId} goods={goods}
            importsInOneColumn={importsInOneColumn} onImportsInOneColumn={setImportsInOneColumn} onOpen={open} onToggleLine={toggleLine}
          />
        )}
      </div>
      {panel !== null && <div className="flow-side" ref={sideRef}>{panel}</div>}
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
  if (plan === null) return <><p className="muted">Planning…</p><Skeleton shape="diagram" /></>;
  if (plan.status === 'empty') return <p className="muted">Pick something to make in the settings</p>;
  if (plan.status === 'infeasible') return <Infeasible plan={plan} />;
  const { settings } = project;
  const per = settings.mode === 'makeN' ? 'hour' : settings.per;
  return <FlowDiagram plan={plan} previousPlan={props.previousPlan} settings={settings} per={per} send={send} base={project.world.baseId !== null} />;
}
