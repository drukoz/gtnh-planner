// Skeletons beside the loading lines (Phase 2 spec §11.1, D13; Task 8): a loading line stays as it is, and an aria-hidden shape of what is
// coming is drawn beside it, empty blocks with no text and no inline style (the stylesheet sizes them). Eight shapes: the project list's
// cards, a project page, the key-numbers strip, a diagram, lines, a scene, a Compare mode's six figures (`readouts`) and the Compare card's
// three modes (`compare`: three readouts frames, plan ruling compare-skeletons).

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Skeleton, type SkeletonShape } from '../../src/client/components/Skeleton.tsx';

/** Each shape and the blocks it draws with no `rows`. */
const BLOCKS: Array<[SkeletonShape, number]> = [
  ['cards', 3], ['project', 3], ['strip', 5], ['diagram', 3], ['lines', 6], ['scene', 1], ['readouts', 6], ['compare', 18],
];
const count = (html: string, cls: string): number => html.split(`<div class="${cls}">`).length - 1;

describe('skeletons', () => {
  it('draws each shape as aria-hidden empty blocks, with no text and no inline style', () => {
    for (const [shape, blocks] of BLOCKS) {
      const html = renderToStaticMarkup(<Skeleton shape={shape} />);
      expect(html.startsWith(`<div class="skeleton skeleton-${shape}" aria-hidden="true">`), html).toBe(true);
      expect(count(html, 'skeleton-block'), shape).toBe(blocks);
      expect(html.replace(/<[^>]+>/g, ''), shape).toBe('');
      expect(html, shape).not.toContain('style=');
    }
  });

  it('draws as many cards or lines as it is asked for', () => {
    expect(count(renderToStaticMarkup(<Skeleton shape="cards" rows={2} />), 'skeleton-block')).toBe(2);
    expect(count(renderToStaticMarkup(<Skeleton shape="lines" rows={3} />), 'skeleton-block')).toBe(3);
  });

  it('draws the Compare card\'s three modes as three readouts frames of six blocks each', () => {
    const html = renderToStaticMarkup(<Skeleton shape="compare" />);
    expect(html.startsWith('<div class="skeleton skeleton-compare" aria-hidden="true"><div class="skeleton-readouts"><div class="skeleton-block">')).toBe(true);
    expect(count(html, 'skeleton-readouts')).toBe(3);
    expect(html).toBe(`<div class="skeleton skeleton-compare" aria-hidden="true">${`<div class="skeleton-readouts">${'<div class="skeleton-block"></div>'.repeat(6)}</div>`.repeat(3)}</div>`);
  });
});
