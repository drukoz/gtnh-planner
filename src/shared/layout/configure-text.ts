// The words for a configured part (Plan 5 Task 10; architecture §11.14): a cover's item, face, mode, rate and filter,
// and a block's own settings (programmed circuit, input filter, routing chips, AE2 patterns). Written from the block's
// `covers` and `config` by this one formatter, so the configure build steps, the 3D hover and the 3D click info say
// the same thing. The same goes for an EnderIO conduit face (architecture "EnderIO conduits, granted change requests
// (add-on 11)"): its mode, and for each side its channel colour, filter, speed upgrades, round robin, priority and
// redstone setting, written from the block's `conduits`. Pure TypeScript shared by server and browser: nothing from
// node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Face } from '../types/assets.ts';
import type { ConduitExtract, ConduitFace, ConduitFilter, ConduitInsert, ConduitKind, CoverSpec, LayoutBlock } from '../types/layout.ts';
import { CONDUIT_MODE_NAMES, CONDUIT_NAMES, DYE_NAMES, REDSTONE_NAMES } from './enderio.ts';
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

// ---- EnderIO conduit faces ----

/**
 * A filter in a builder's words: `<filter name> (<whitelist|blacklist>: <names>; <match meta|ignore meta>,
 * <match NBT|ignore NBT>[, ore dictionary][, sticky])`. An ender fluid conduit's own filter has no item and no flags:
 * `fluid filter (<whitelist|blacklist>: <names>)`. A flag the filter does not set reads as off.
 */
export function conduitFilterText(filter: ConduitFilter, nameOf: (k: StuffKey) => string): string {
  const list = `${filter.whitelist ? 'whitelist' : 'blacklist'}: ${joinNames(filter.keys.map((k) => nameOf(k)))}`;
  if (filter.item === undefined) return `fluid filter (${list})`;
  const flags = [filter.matchMeta === true ? 'match meta' : 'ignore meta', filter.matchNbt === true ? 'match NBT' : 'ignore NBT'];
  if (filter.oreDict === true) flags.push('ore dictionary');
  if (filter.sticky === true) flags.push('sticky');
  return `${nameOf(filter.item)} (${list}; ${flags.join(', ')})`;
}

/** ` with a Basic Item Filter (…)`, ` with an Advanced Item Filter (…)` (an before a vowel), or nothing for a side without a filter. */
function filterClause(filter: ConduitFilter | null, nameOf: (k: StuffKey) => string): string {
  if (filter === null) return '';
  const text = conduitFilterText(filter, nameOf);
  return ` with ${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;
}

function extractText(s: ConduitExtract, nameOf: (k: StuffKey) => string): string {
  const text = [`extract on ${DYE_NAMES[s.color]}${filterClause(s.filter, nameOf)}`];
  if (s.speed !== undefined) text.push(`${fmtInt(s.speed.count)}× ${nameOf(s.speed.item)}`);
  text.push(`round robin ${s.roundRobin ? 'on' : 'off'}`);
  if (s.selfFeed !== undefined) text.push(`self feed ${s.selfFeed ? 'on' : 'off'}`);
  text.push(`redstone ${REDSTONE_NAMES[s.redstone]}`);
  return text.join(', ');
}

function insertText(s: ConduitInsert, nameOf: (k: StuffKey) => string): string {
  const head = `insert on ${DYE_NAMES[s.color]}${filterClause(s.filter, nameOf)}`;
  return s.priority === undefined ? head : `${head}, priority ${fmtInt(s.priority)}`;
}

/**
 * One side of a conduit face: `extract on <colour>[ with a <filter>][, <n>× <upgrade name>], round robin <on|off>[, self
 * feed <on|off>], redstone <redstone name>` (self feed only when set), or `insert on <colour>[ with a <filter>][, priority <n>]`.
 */
export function conduitSideText(side: 'extract', s: ConduitExtract, nameOf: (k: StuffKey) => string): string;
export function conduitSideText(side: 'insert', s: ConduitInsert, nameOf: (k: StuffKey) => string): string;
export function conduitSideText(side: 'extract' | 'insert', s: ConduitExtract | ConduitInsert, nameOf: (k: StuffKey) => string): string {
  return side === 'extract' ? extractText(s as ConduitExtract, nameOf) : insertText(s as ConduitInsert, nameOf);
}

/** `<conduit name>, <face> face to <target>: <mode name>[; <extract side>][; <insert side>]`. */
export function conduitFaceText(kind: ConduitKind, face: ConduitFace, nameOf: (k: StuffKey) => string): string {
  const text = [`${CONDUIT_NAMES[kind]}, ${faceName(face.face)} face to ${face.target}: ${CONDUIT_MODE_NAMES[face.mode]}`];
  if (face.extract !== undefined) text.push(conduitSideText('extract', face.extract, nameOf));
  if (face.insert !== undefined) text.push(conduitSideText('insert', face.insert, nameOf));
  return text.join('; ');
}

/** One text per face of every conduit of the block, conduits in bundle order, faces in stored order. */
export function conduitLines(block: Pick<LayoutBlock, 'conduits'>, nameOf: (k: StuffKey) => string): Array<{ kind: ConduitKind; face: Face; text: string }> {
  return (block.conduits ?? []).flatMap((conduit) =>
    conduit.faces.map((face) => ({ kind: conduit.kind, face: face.face, text: conduitFaceText(conduit.kind, face, nameOf) })));
}
