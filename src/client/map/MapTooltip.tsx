// The map's hover tooltip (spec §3.7; architecture §11, Map hover): the lines `describeColumn` gives for the block under
// the pointer, in a small box beside the pointer that never covers that block and stays inside the map. It takes no
// pointer events, so the map under it keeps getting them; the map moves it (`tooltipPosition`) as the pointer moves.

import type { CSSProperties, ReactElement, Ref } from 'react';
import { Figs } from '../components/Figs.tsx';
import { alongAxis } from '../components/tooltip-model.ts';
import { worldToScreen } from './render.ts';
import type { MapViewport } from './types.ts';

/** The gap (px) between the tooltip and the pointer, or the hovered block's square when that is drawn wider. */
export const TOOLTIP_OFFSET = 12;

/**
 * Along one axis: past `end` when the tooltip fits there, else before `start` when it fits there, else inside `[0, box − size]`: the
 * shared tooltip's rule (`alongAxis`, Phase 2 spec §6.2), which began here.
 */
function along(start: number, end: number, size: number, box: number): number {
  return alongAxis(start, end, size, box, TOOLTIP_OFFSET);
}

/**
 * The tooltip's top-left corner, in CSS pixels of the map box, for column `column` under the pointer `pointer` of view
 * `v` and a tooltip of `size`: TOOLTIP_OFFSET right of and below the pointer — or, when blocks are drawn wider than
 * that, right of and below the hovered block's square, so it never covers the block (and moves with whole blocks) —
 * flipped left or up where it would leave the map box, and kept inside it.
 */
export function tooltipPosition(
  v: MapViewport, column: { x: number; z: number }, pointer: readonly [number, number], size: { width: number; height: number },
): { left: number; top: number } {
  const [px, py] = pointer;
  const [bx, by] = worldToScreen(v, column.x, column.z);
  const ppb = v.pixelsPerBlock;
  const wide = ppb > TOOLTIP_OFFSET;
  return {
    left: along(wide ? bx : px, wide ? bx + ppb : px, size.width, v.width),
    top: along(wide ? by : py, wide ? by + ppb : py, size.height, v.height),
  };
}

// No left/top here: the map sets them on the element before it is painted. Everything else is `.map-tooltip` in the stylesheet (the NEI
// look, design spec §6); what stays here is what the map and the pointer need whatever the stylesheet says.
const TOOLTIP_STYLE: CSSProperties = { position: 'absolute', pointerEvents: 'none' };

export interface MapTooltipProps { id: string; lines: readonly string[]; ref?: Ref<HTMLDivElement> }

/** The tooltip box, one line per entry of `lines`; the map points its canvas's `aria-describedby` at `id` while it shows. */
export function MapTooltip(props: MapTooltipProps): ReactElement {
  return (
    <div ref={props.ref} id={props.id} role="tooltip" className="map-tooltip" style={TOOLTIP_STYLE}>
      {props.lines.map((line, i) => <div key={i}><Figs text={line} /></div>)}
    </div>
  );
}
