// The Flow chart's cards (RUK-740, round 2): where everything stands in a step's, a supporting line's and a stub's box. Pure numbers, no
// imports, so flow-model.ts (which sizes the boxes and places their ports) and FlowView.tsx (which draws them) read the same geometry.
//
// A step card: a head band with the machine's name and its chips; the step's other lines and its avoid badge under it; the "Input" and
// "Output" captions; then three columns side by side: the input tiles (and a power tile under them), the machine (its icon in a slot, its
// count, how many are owned) and the output tiles; and a foot band with how busy the machines are. A supporting line's card has no machine
// column and no foot. A tile is one good: its icon, its rate on top and its name under it. A stub's card is a caption and one tile.

/** The room inside a card's sides and between its columns. */
export const CARD_PAD = 6;
/** The head band (the title and the chips), and the foot band (how busy). */
export const CARD_HEAD = 30;
export const CARD_FOOT = 20;
/** The line of text a card's other lines and its avoid badge take each, and its "Input" / "Output" captions. */
export const CARD_LINE = 16;
export const CARD_CAPTION = 14;
/** A tile: its size, the gap under it, its icon, and where its text starts from its icon's side (5 + 24 + 5). */
export const TILE_WIDTH = 140;
export const TILE_HEIGHT = 34;
export const TILE_GAP = 4;
export const TILE_PITCH = TILE_HEIGHT + TILE_GAP;
export const TILE_ICON = 24;
export const TILE_ICON_INSET = 5;
export const TILE_TEXT = TILE_ICON_INSET + TILE_ICON + TILE_ICON_INSET;
/** A step card's machine column, and the slot and icon at its top. */
export const MACHINE_COLUMN = 84;
export const CARD_SLOT = 44;
export const CARD_MACHINE_ICON = 40;
/** The widths of a step's card, a supporting line's and a stub's. */
export const STEP_CARD_WIDTH = 4 * CARD_PAD + 2 * TILE_WIDTH + MACHINE_COLUMN;
export const LINE_CARD_WIDTH = 3 * CARD_PAD + 2 * TILE_WIDTH;
export const STUB_WIDTH = 2 * CARD_PAD + TILE_WIDTH;
/** A stub card's caption band ("Import · mined", "Left over", "Target"), above its one tile. */
export const STUB_HEAD = 18;
export const STUB_HEIGHT = STUB_HEAD + TILE_HEIGHT + CARD_PAD;

/** What a card's geometry depends on. `extraLines`: the lines under the head band (a step's lines but its first, a line's lines, the badge). */
export interface CardShape { step: boolean; inputs: number; outputs: number; power: boolean; extraLines: number }

/** One tile: its top-left corner in the card, its column, its line in the column, and whether it is the power tile (a step's, no good). */
export interface Tile { x: number; y: number; side: 'in' | 'out'; line: number; power: boolean }

export interface CardGeometry {
  width: number; height: number;
  /** The top of the first tile line. */
  bodyTop: number;
  /** The inputs' tiles in order, then the power tile if any, then the outputs' tiles in order. */
  tiles: Tile[];
  /** A step card's machine column (from `bodyTop`, as tall as the tiles), else null. */
  machine: { x: number; y: number; width: number; height: number } | null;
  /** A step card's foot band's top, else null. */
  footTop: number | null;
}

/** The top of a card's first tile line: under its head band, its extra lines and its captions. */
export function cardBodyTop(extraLines: number): number {
  return CARD_HEAD + CARD_LINE * extraLines + CARD_CAPTION;
}

/** How many tile lines a card's body takes: the taller column (the power tile counts with the inputs), at least 2 for a step and 1 for a line. */
export function cardLines(shape: CardShape): number {
  return Math.max(shape.inputs + (shape.power ? 1 : 0), shape.outputs, shape.step ? 2 : 1);
}

/** The middle of tile line `line`, from the card's top: where the port of a good on that line sits. */
export function tileCentre(bodyTop: number, line: number): number {
  return bodyTop + line * TILE_PITCH + TILE_HEIGHT / 2;
}

/** Where everything stands in a step's or a supporting line's card. */
export function cardGeometry(shape: CardShape): CardGeometry {
  const width = shape.step ? STEP_CARD_WIDTH : LINE_CARD_WIDTH;
  const bodyTop = cardBodyTop(shape.extraLines);
  const bodyHeight = cardLines(shape) * TILE_PITCH - TILE_GAP;
  const outX = width - CARD_PAD - TILE_WIDTH;
  const tiles: Tile[] = [];
  for (let i = 0; i < shape.inputs; i++) tiles.push({ x: CARD_PAD, y: bodyTop + i * TILE_PITCH, side: 'in', line: i, power: false });
  if (shape.power) tiles.push({ x: CARD_PAD, y: bodyTop + shape.inputs * TILE_PITCH, side: 'in', line: shape.inputs, power: true });
  for (let i = 0; i < shape.outputs; i++) tiles.push({ x: outX, y: bodyTop + i * TILE_PITCH, side: 'out', line: i, power: false });
  const bodyBottom = bodyTop + bodyHeight + CARD_PAD;
  return {
    width,
    height: bodyBottom + (shape.step ? CARD_FOOT : 0),
    bodyTop,
    tiles,
    machine: shape.step ? { x: 2 * CARD_PAD + TILE_WIDTH, y: bodyTop, width: MACHINE_COLUMN, height: bodyHeight } : null,
    footTop: shape.step ? bodyBottom : null,
  };
}

/** A stub card's one tile, under its caption band. */
export const STUB_TILE: Tile = { x: CARD_PAD, y: STUB_HEAD, side: 'in', line: 0, power: false };
