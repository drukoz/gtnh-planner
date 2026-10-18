// The words for a configured part (Plan 5 Task 10; architecture §11.14): a cover's item, face, mode, rate and filter,
// and a block's own settings (programmed circuit, input filter, routing chips, AE2 patterns). Written from the block's
// `covers` and `config` by this one formatter, so the configure build steps, the 3D hover and the 3D click info say
// the same thing. Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Face } from '../types/assets.ts';
import type { CoverSpec, LayoutBlock } from '../types/layout.ts';
import { fmtInt, fmtRate, joinNames } from './format.ts';

type Value = string | number | boolean;

/** How a builder names a face: down is the bottom, up the top, the sides keep their compass names. */
export function faceName(face: Face): string {
  return face === 'down' ? 'bottom' : face === 'up' ? 'top' : face;
}

/** A number in words: thousands separators, at most one decimal place. */
function valueText(v: Value): string {
  return typeof v === 'number' ? fmtRate(v) : String(v);
}

/** The cover's mode: Export or Import, or the whitelist / blacklist with the filter's item names. */
function modeText(mode: Value, filter: readonly string[]): string {
  switch (mode) {
    case 'export': return 'Export';
    case 'import': return 'Import';
    case 'whitelist': case 'blacklist': return filter.length === 0 ? mode : `${mode} ${joinNames(filter)}`;
    default: return `mode ${valueText(mode)}`;
  }
}

/**
 * `<cover name> on the <face> face: <settings>`: the mode first, then `allow input` (only when true), then the rate
 * with its unit, then any other setting as `<key> <value>` in insertion order (`unit` goes with the rate).
 */
export function coverText(cover: CoverSpec, nameOf: (k: StuffKey) => string): string {
  const { mode, allowInput, rate, unit, ...rest } = cover.settings;
  const parts: string[] = [];
  if (mode !== undefined) parts.push(modeText(mode, (cover.filter ?? []).map(nameOf)));
  if (allowInput === true) parts.push('allow input');
  if (rate !== undefined) parts.push(unit === undefined ? valueText(rate) : `${valueText(rate)} ${valueText(unit)}`);
  for (const [key, value] of Object.entries(rest)) parts.push(`${key} ${valueText(value)}`);
  const head = `${nameOf(cover.item)} on the ${faceName(cover.face)} face`;
  return parts.length === 0 ? head : `${head}: ${parts.join(', ')}`;
}

/** One setting of a block in a builder's words. */
function configText(key: string, v: Value): string {
  switch (key) {
    case 'circuit': return `programmed circuit ${valueText(v)}`;
    case 'inputFilter': return v === true ? 'Input Filter on' : 'Input Filter off';
    case 'inputFromOutputSide': return v === true ? 'allow input from the output side' : 'no input from the output side';
    case 'chips': return `chips: ${valueText(v)}`;
    case 'patterns': return typeof v === 'number' ? `${fmtInt(v)} processing pattern${v === 1 ? '' : 's'}` : `${v} processing patterns`;
    case 'pattern': return `pattern ${valueText(v)}`;
    case 'blockingMode': return `blocking mode ${v === true ? 'on' : 'off'}`;
    case 'exportFilter': return `export ${valueText(v)}`;
    default: return `${key}: ${valueText(v)}`;
  }
}

/** The block's settings in insertion order, one text each. */
export function configTexts(config: Readonly<Record<string, Value>>): string[] {
  return Object.entries(config).map(([key, value]) => configText(key, value));
}

/** Everything to set on a block: its covers' texts in order, then its settings' texts. */
export function configuredLines(block: Pick<LayoutBlock, 'covers' | 'config'>, nameOf: (k: StuffKey) => string): string[] {
  return [...(block.covers ?? []).map((c) => coverText(c, nameOf)), ...configTexts(block.config ?? {})];
}
