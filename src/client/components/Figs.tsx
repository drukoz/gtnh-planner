// The figures of pixel text (Phase 2 spec §25, plan ruling digits-mixed): Pixelify Sans draws 5 like S, 2 like Z and 0 like O, so pixel
// text that shows a figure among words writes it through `Figs`, in a `span.fig` (a `tspan.fig` in an svg) that the stylesheet sets in
// VT323 as tall as the Pixelify digits round it. The words stay Pixelify, and so do the `%` and `×` round a figure, which VT323 draws
// like an x. A figure is a run of digits with what joins them (`1,440`, `0.0586`, `10:00`, a position `1 64 10`, a range `1–6`) and a
// sign right before it that follows no letter or digit (`+3`, `-30`). `Figs` cannot tell a name's digit from a figure, so a name that
// stands alone (a step's or an item's title, a tab, a button that names an item) is written without it. It holds no hooks.

import type { ReactElement } from 'react';

/** A piece of a text: one figure, or the words between two. */
export interface FigureRun { text: string; fig: boolean }

/**
 * A figure: digits joined by `,` `.` or `:`, or by one space or en dash (U+2013) between digit groups, and a `+`, minus sign (U+2212) or
 * hyphen right before it that follows no letter or digit.
 */
const FIGURE = /(?:(?<![\p{L}\p{N}])[+−-])?\d+(?:(?:[.,:]|[ –])\d+)*/gu;

/** `text` cut into its figures and the words between them, in order; no run is empty. */
export function figureRuns(text: string): FigureRun[] {
  const runs: FigureRun[] = [];
  let at = 0;
  for (const match of text.matchAll(FIGURE)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index), fig: false });
    runs.push({ text: match[0], fig: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), fig: false });
  return runs;
}

/** `text` with each figure in a `span.fig` (with `svg`, a `tspan.fig`), and its words as plain text. */
export function Figs(props: { text: string; svg?: boolean }): ReactElement {
  const { text, svg = false } = props;
  return (
    <>
      {figureRuns(text).map((run, i) => {
        if (!run.fig) return run.text;
        return svg ? <tspan key={i} className="fig">{run.text}</tspan> : <span key={i} className="fig">{run.text}</span>;
      })}
    </>
  );
}
