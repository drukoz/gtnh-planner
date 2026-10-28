// A skeleton beside a loading line (Phase 2 spec §11.1, D13): the line stays as it is, and the shape of what is coming is drawn beside it in
// empty blocks, which the stylesheet sizes and passes a sheen over three times. It is decoration, so it is hidden from assistive technology
// and holds no text and no inline style; the loading line is what a screen reader hears, and what the tests find. Eight shapes: the project
// list's cards; a project page (its head, its strip and its views); the key-numbers strip, whose blocks take the strip's own grid (ledger
// ruling P2-R48); a diagram and a scene, set into a well; lines; a Compare mode's six figures (`readouts`); and the Compare card's three
// modes, three readouts frames framed as its columns are (`compare`, plan ruling compare-skeletons). It holds no hooks.

import type { ReactElement } from 'react';

export type SkeletonShape = 'cards' | 'project' | 'strip' | 'diagram' | 'lines' | 'scene' | 'compare' | 'readouts';

/** How many blocks a shape draws when it is not told (`rows` tells cards and lines). */
const BLOCKS: Readonly<Record<Exclude<SkeletonShape, 'compare'>, number>> = { cards: 3, project: 3, strip: 5, diagram: 3, lines: 6, scene: 1, readouts: 6 };
/** The Compare card's modes, each a frame of a mode's six figures. */
const MODES = 3;

/** `n` empty blocks. */
function blocks(n: number): ReactElement[] {
  return Array.from({ length: n }, (_, i) => <div key={i} className="skeleton-block" />);
}

export function Skeleton(props: { shape: SkeletonShape; rows?: number }): ReactElement {
  const { shape, rows } = props;
  if (shape === 'compare') {
    return (
      <div className="skeleton skeleton-compare" aria-hidden="true">
        {Array.from({ length: MODES }, (_, i) => <div key={i} className="skeleton-readouts">{blocks(BLOCKS.readouts)}</div>)}
      </div>
    );
  }
  const n = shape === 'cards' || shape === 'lines' ? rows ?? BLOCKS[shape] : BLOCKS[shape];
  return <div className={`skeleton skeleton-${shape}`} aria-hidden="true">{blocks(n)}</div>;
}
