// Figures in VT323 (Phase 2 spec §25, plan rulings `figures-vt323` and `digits-mixed`): Pixelify Sans draws 5 like S, 2 like Z and 0 like
// O, so the figures of pixel text are drawn in VT323 and its words stay Pixelify. `figureRuns` cuts a text into its figures and its words,
// and `Figs` writes each figure in a `span.fig` (a `tspan.fig` in an svg), which the stylesheet sets in VT323; the `%` and `×` round a
// figure stay with the words, whose Pixelify draws them where VT323's read as an x.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { Figs, figureRuns } from '../../src/client/components/Figs.tsx';

describe('the figures of pixel text', () => {
  it('cuts a text into its figures and its words, the signs around a figure staying with the words', () => {
    expect(figureRuns('need 80× · have 1,440 (64 reachable)')).toEqual([{ text: 'need ', fig: false }, { text: '80', fig: true },
      { text: '× · have ', fig: false }, { text: '1,440', fig: true }, { text: ' (', fig: false }, { text: '64', fig: true }, { text: ' reachable)', fig: false }]);
    expect(figureRuns('short: gets 45%')).toEqual([{ text: 'short: gets ', fig: false }, { text: '45', fig: true }, { text: '%', fig: false }]);
    expect(figureRuns('×1 shared')).toEqual([{ text: '×', fig: false }, { text: '1', fig: true }, { text: ' shared', fig: false }]);
    expect(figureRuns('1 64 10')).toEqual([{ text: '1 64 10', fig: true }]);                       // a position is one figure
    expect(figureRuns('-30 64 12')).toEqual([{ text: '-30 64 12', fig: true }]);
    expect(figureRuns('+3 more below')).toEqual([{ text: '+3', fig: true }, { text: ' more below', fig: false }]);
    expect(figureRuns('Base: Overworld base (4, 5)').filter((r) => r.fig).map((r) => r.text)).toEqual(['4', '5']);
    expect(figureRuns('✓ Ann, 10:00').at(-1)).toEqual({ text: '10:00', fig: true });
    expect(figureRuns('1–6')).toEqual([{ text: '1–6', fig: true }]); expect(figureRuns('0.0586/min in the line')[0]).toEqual({ text: '0.0586', fig: true });
    expect(figureRuns('Copper Wire')).toEqual([{ text: 'Copper Wire', fig: false }]); expect(figureRuns('')).toEqual([]);
  });

  it('signs a figure with a minus sign, leaves a sign after a digit or a letter in the words, and takes a name\'s digit as a figure', () => {
    expect(figureRuns('−5 left')).toEqual([{ text: '−5', fig: true }, { text: ' left', fig: false }]);                     // U+2212, the minus sign
    expect(figureRuns('1-2')).toEqual([{ text: '1', fig: true }, { text: '-', fig: false }, { text: '2', fig: true }]);   // a hyphen between figures
    expect(figureRuns('N-1')).toEqual([{ text: 'N-', fig: false }, { text: '1', fig: true }]);                           // after a letter: no sign
    // a digit inside a name is a figure too: Figs cannot tell them apart, which spec §25 accepts
    expect(figureRuns('1x Copper Wire')).toEqual([{ text: '1', fig: true }, { text: 'x Copper Wire', fig: false }]);
  });

  it('draws each figure in a span.fig, or a tspan.fig in an svg, and nothing else', () => {
    expect(renderToStaticMarkup(<Figs text="short: gets 45%" />)).toBe('short: gets <span class="fig">45</span>%');
    expect(renderToStaticMarkup(<Figs text="N5" />)).toBe('N<span class="fig">5</span>');
    expect(renderToStaticMarkup(<Figs text="Copper Wire" />)).toBe('Copper Wire');
    expect(renderToStaticMarkup(<svg><text><Figs text="×1 shared" svg /></text></svg>)).toBe('<svg><text>×<tspan class="fig">1</tspan> shared</text></svg>');
  });
});
