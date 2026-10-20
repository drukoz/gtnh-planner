// The words for a configured part (Plan 5 Task 10; architecture §11.14): a cover's item, face, mode, rate and filter,
// and a block's own settings (programmed circuit, input filter, routing chips, AE2 patterns). Written from the block's
// `covers` and `config` by this one formatter, so the configure build steps, the 3D hover and the 3D click info say
// the same thing. The same goes for an EnderIO conduit face (architecture "EnderIO conduits, granted change requests
// (add-on 11)"): its mode, and for each side its channel colour, filter, speed upgrades, round robin, priority and
// redstone setting, written from the block's `conduits`. And for the structured feeding configuration (architecture §11
// entry 51): each routed interface pipe's chips with their filter mode and items, each ME interface's patterns and
// blocking mode, and an Auto Workbench's mode, grid and button (plan 12), written from the block's `feed`. Pure TypeScript
// shared by server and browser: nothing from node:* may be imported here.

import type { StuffKey } from '../keys.ts';
import type { Face } from '../types/assets.ts';
import type { BenchSpec, ChipKind, FeedSpec, InterfaceSpec, PatternSpec, RoutedChipSpec } from '../types/feed.ts';
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

/** `<n> <thing>` or `<n> <thing>s`. */
function counted(n: number, thing: string): string {
  return `${fmtInt(n)} ${thing}${n === 1 ? '' : 's'}`;
}

/**
 * An ME Export Bus on a cable's face (architecture §11 entry 51: the AE2 mode feeds a machine that makes only fluids
 * with one, `settings.mode` 'me_export'): the items to put in its filter slots, then its Capacity and Acceleration Cards.
 */
function meExportText(cover: CoverSpec, nameOf: (k: StuffKey) => string): string {
  const { capacityCards, accelerationCards } = cover.settings;
  const cards = [...(typeof capacityCards === 'number' && capacityCards > 0 ? [counted(capacityCards, 'Capacity Card')] : []),
    ...(typeof accelerationCards === 'number' && accelerationCards > 0 ? [counted(accelerationCards, 'Acceleration Card')] : [])];
  return `${nameOf(cover.item)} on the ${faceName(cover.face)} face: put ${joinNames((cover.filter ?? []).map(nameOf))} in its filter slots`
    + `${cards.length === 0 ? '' : `; ${cards.join(', ')}`}`;
}

/**
 * `<cover name> on the <face> face: <settings>`: the mode first, then `allow input` (only when true), then the rate
 * with its unit, then any other setting as `<key> <value>` in insertion order (`unit` goes with the rate). An ME Export
 * Bus says what goes in its filter and its cards (`meExportText`).
 */
export function coverText(cover: CoverSpec, nameOf: (k: StuffKey) => string): string {
  if (cover.settings.mode === 'me_export') return meExportText(cover, nameOf);
  const { mode, allowInput, rate, unit, ...rest } = cover.settings;
  const parts: string[] = [];
  if (mode !== undefined) parts.push(modeText(mode, (cover.filter ?? []).map(nameOf)));
  if (allowInput === true) parts.push('allow input');
  if (rate !== undefined) parts.push(unit === undefined ? valueText(rate) : `${valueText(rate)} ${valueText(unit)}`);
  for (const [key, value] of Object.entries(rest)) parts.push(`${key} ${valueText(value)}`);
  const head = `${nameOf(cover.item)} on the ${faceName(cover.face)} face`;
  return parts.length === 0 ? head : `${head}: ${parts.join(', ')}`;
}

/**
 * A GT basic machine's Input from Output Side in a builder's words, as the state to leave it in (GT 5.09.54
 * `MTEBasicMachine`): every constructor turns it on, and the GUI has no button for it; a Screwdriver right-click on the
 * output side or the front switches it whatever it was and names the new state in chat (`gt.interact.desc.
 * input_from_output_on`/`_off`), a sneaking one switches the Input Filter instead, and the click also works the cover
 * on the side clicked (`BaseMetaTileEntity.onRightclick`, on that side itself, never the wrench grid's). The words name
 * the side a builder can reach: every mode turns such a machine's output side to the middle row, and its front faces the
 * machine beside it along the row.
 */
function inputFromOutputSideText(allowed: boolean): string {
  const state = `Input from Output Side ${allowed ? 'allowed' : 'forbidden'}`;
  return `${state}: a newly crafted machine has it on; a Screwdriver right-click on its middle-row side switches it and the chat names the new `
    + `state, so leave it where the chat says "${state}" (a sneak-click switches the Input Filter instead, and the click also works a cover on `
    + 'that side)';
}

/**
 * A GT basic machine's Multi Stack Input off (GT 5.09.54 `MTEBasicMachine.mDisableMultiStack`): then an item already in
 * an input slot goes only into that slot (`allowPutStack`), so one item cannot fill every input slot and keep the
 * others out. A sneaking Soldering Iron click on the front switches it (`onSolderingToolRightClick` asks for the front
 * as the wrench-grid side) and the chat names the new state.
 */
const MULTI_STACK_OFF = 'Multi Stack Input off: sneak-right-click its front with a Soldering Iron (where a neighbour covers the front, the edge '
  + 'of the wrench grid toward it) until the chat says "Multi Stack Input Off"';

/**
 * An input bus's Limiting mode on (GT 5.09.54 `MTEHatchInputBus.disableLimited`, off when built): then an item already
 * in a slot goes only into that slot (`limitedAllowPutStack`). A sneaking Screwdriver click steps through the bus's
 * sorting and limiting modes and the chat names both.
 */
const LIMITING_ON = 'Limiting mode on: sneak-right-click it with a Screwdriver until the chat says "Limiting mode On"';

/**
 * A multiblock controller's Input Separation off (GT 5.09.54 `MTEMultiBlockBase.inputSeparation`, on when built for a
 * controller that supports it, such as the EBF): then all its input buses are checked together, so a recipe whose items
 * arrive on different buses can start. The controller window has the button; on the EBF a Screwdriver click on the
 * controller switches it too, and the chat names the new state (`GT5U.machines.separatebus.false`). Research
 * machine-feeding §1.2 and §3.7, whose words these are.
 */
const INPUT_SEPARATION_OFF = 'Input Separation off: the controller window\'s Input Separation button (on the EBF, a Screwdriver right-click on '
  + 'the controller) until the chat says "Input buses aren\'t separated"';

/** One setting of a block in a builder's words. */
function configText(key: string, v: Value): string {
  switch (key) {
    case 'circuit': return `programmed circuit ${valueText(v)}`;
    case 'inputFilter': return v === true ? 'Input Filter on' : 'Input Filter off';
    case 'inputFromOutputSide': return inputFromOutputSideText(v === true);
    case 'chips': return `chips: ${valueText(v)}`;
    case 'patterns': return typeof v === 'number' ? `${fmtInt(v)} processing pattern${v === 1 ? '' : 's'}` : `${v} processing patterns`;
    case 'pattern': return `pattern ${valueText(v)}`;
    case 'blockingMode': return `blocking mode ${v === true ? 'on' : 'off'}`;
    case 'exportFilter': return `export ${valueText(v)}`;
    case 'multiStack': return v === true ? 'Multi Stack Input on' : MULTI_STACK_OFF;
    case 'limited': return v === true ? LIMITING_ON : 'Limiting mode off';
    case 'inputSeparation': return v === false ? INPUT_SEPARATION_OFF : 'Input Separation on';
    default: return `${key}: ${valueText(v)}`;
  }
}

/** The block's settings in insertion order, one text each. */
export function configTexts(config: Readonly<Record<string, Value>>): string[] {
  return Object.entries(config).map(([key, value]) => configText(key, value));
}

// ---- Chips and patterns (architecture §11 entry 51) ----

/** Project Red's chip names (`item.projectred.transportation.routingchip|<n>.name` in ProjRed-4.12.44-GTNH). */
const CHIP_NAMES: Readonly<Record<ChipKind, string>> = {
  responder: 'Item Responder Chip', extractor: 'Item Extractor Chip', broadcaster: 'Item Broadcaster Chip', stock_keeper: 'Item Stock Keeper Chip',
  terminator: 'Item Terminator Chip', overflow: 'Item Overflow Responder Chip',
};
const REQUEST_MODES: Readonly<Record<NonNullable<RoutedChipSpec['requestMode']>, string>> = {
  when_missing: 'when missing', when_empty: 'when empty', infinite: 'infinite',
};

/**
 * One chip in a builder's words (research machine-feeding §3.7): `<chip name> (<whitelist|blacklist>: <names>)`, an empty
 * list read as nothing; a Broadcaster's whitelist adds that a new one is a blacklist (`TChipFilter`: a broadcaster
 * starts with `filterExclude` on, every other chip off); a Stock Keeper names its request mode and each item's count;
 * a preference other than 0 is named last.
 */
function chipText(chip: RoutedChipSpec, nameOf: (k: StuffKey) => string): string {
  const name = CHIP_NAMES[chip.kind];
  const preference = chip.priority === undefined || chip.priority === 0 ? '' : `, preference ${chip.priority}`;
  if (chip.kind === 'stock_keeper') {
    const stock = (chip.stock ?? []).map((s) => `${nameOf(s.key)} ${fmtInt(s.count)}`).join(', ');
    return `${name} (${REQUEST_MODES[chip.requestMode ?? 'when_missing']}${preference}): ${stock}`;
  }
  if (chip.filter === undefined) return preference === '' ? name : `${name} (${preference.slice(2)})`;
  const names = chip.filter.keys.length === 0 ? 'nothing' : joinNames(chip.filter.keys.map(nameOf));
  const switchIt = chip.kind === 'broadcaster' && chip.filter.mode === 'whitelist' ? '; a new one is a blacklist, so switch its filter to whitelist' : '';
  return `${name} (${chip.filter.mode}: ${names}${switchIt}${preference})`;
}

/** "1× A + 4× B → 1× C": a pattern's whole amounts. */
function patternText(p: PatternSpec, nameOf: (k: StuffKey) => string): string {
  const side = (list: PatternSpec['inputs']): string => list.map((s) => `${fmtInt(s.amount)}× ${nameOf(s.key)}`).join(' + ');
  return `${side(p.inputs)} → ${side(p.outputs)}`;
}

/** The states of an Auto Workbench's top-left (throughput) button, by its setting. */
const BUTTON_STATES: readonly string[] = ['first', 'second', 'third', 'fourth'];

/**
 * An Auto Workbench's settings in a builder's words (research machine-feeding §3.7): its mode, by the bottom-left button,
 * whose tooltip names it; its grid, top row first, the cells of a row by commas and the rows by slashes, each cell the
 * item to put in it or `empty`; and its top-left (throughput) button, on its first state for a bench that pushes what
 * it makes out of its back.
 */
function benchTexts(spec: BenchSpec, nameOf: (k: StuffKey) => string): string[] {
  const rows: string[] = [];
  for (let i = 0; i < spec.grid.length; i += 3) rows.push(spec.grid.slice(i, i + 3).map((k) => (k === null ? 'empty' : nameOf(k))).join(', '));
  return ['mode Normal Crafting Table (the bottom-left button; its tooltip names the mode)', `grid, top row first: ${rows.join(' / ')}`,
    `leave the top-left button on its ${BUTTON_STATES[spec.throughput] ?? 'first'} state`];
}

/** An ME interface's patterns (numbered when there are two or more), blocking mode and Locking Card. */
function interfaceTexts(spec: InterfaceSpec, nameOf: (k: StuffKey) => string): string[] {
  const n = spec.patterns.length;
  const lines = n === 0 ? [] : [`${fmtInt(n)} processing pattern${n === 1 ? '' : 's'}`];
  spec.patterns.forEach((p, i) => lines.push(n === 1 ? `pattern ${patternText(p, nameOf)}` : `pattern ${fmtInt(i + 1)}: ${patternText(p, nameOf)}`));
  lines.push(`blocking mode ${spec.blocking ? 'on' : 'off'}`);
  if (spec.smartBlocking === true) lines.push('smart blocking on');
  if (spec.lock === 'until_result') lines.push('Locking Card, Lock Crafting: Until crafting result is returned');
  return lines;
}

/**
 * The structured feeding configuration in a builder's words: a routed interface pipe's chips in chip-slot order as one
 * line (`chips: <chip> + <chip>`), then an ME interface's patterns and settings, then an Auto Workbench's mode, grid and
 * button (plan 12, `benchTexts`). An ME Export Bus's filter and cards (`exportBus`) are worded once, by its cover on the
 * same block (`coverText`).
 */
export function feedTexts(feed: FeedSpec | undefined, nameOf: (k: StuffKey) => string): string[] {
  if (feed === undefined) return [];
  const lines: string[] = [];
  if (feed.chips !== undefined && feed.chips.length > 0) lines.push(`chips: ${feed.chips.map((c) => chipText(c, nameOf)).join(' + ')}`);
  if (feed.interface !== undefined) lines.push(...interfaceTexts(feed.interface, nameOf));
  if (feed.bench !== undefined) lines.push(...benchTexts(feed.bench, nameOf));
  return lines;
}

/** Everything to set on a block: its covers' texts in order, then its settings' texts, then its chips or patterns. */
export function configuredLines(block: Pick<LayoutBlock, 'covers' | 'config' | 'feed'>, nameOf: (k: StuffKey) => string): string[] {
  return [...(block.covers ?? []).map((c) => coverText(c, nameOf)), ...configTexts(block.config ?? {}), ...feedTexts(block.feed, nameOf)];
}

// ---- EnderIO conduit faces ----

/**
 * A filter in a builder's words: `<filter name> (<whitelist|blacklist>[, <n> of <slots> slots]: <names>; <match
 * meta|ignore meta>, <match NBT|ignore NBT>[, ore dictionary][, sticky])`, the slot count when the filter knows how many
 * it has (a Basic Item Filter 5, an Advanced 10, a Big 24), so the builder sees which filter the list needs. A Limited
 * Item Filter's names carry their counts, `<name> <count>`, which count the item's cells in an Auto Workbench's crafting
 * grid too (plan 12, `ConduitFilter.limits`). An ender fluid conduit's own filter has no item and no flags: `fluid filter
 * (<whitelist|blacklist>[, <n> of 5 slots]: <names>)`. A flag the filter does not set reads as off.
 */
export function conduitFilterText(filter: ConduitFilter, nameOf: (k: StuffKey) => string): string {
  const slots = filter.slots === undefined ? '' : `, ${fmtInt(filter.keys.length)} of ${fmtInt(filter.slots)} slots`;
  const names = filter.keys.map((k, i) => (filter.limits === undefined ? nameOf(k) : `${nameOf(k)} ${fmtInt(filter.limits[i] ?? 0)}`));
  const counted = filter.limits === undefined ? '' : ', each count with its cells in the crafting grid';
  const list = `${filter.whitelist ? 'whitelist' : 'blacklist'}${slots}: ${joinNames(names)}${counted}`;
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

/**
 * What an insert side into a GT basic machine's output side reminds the builder of: the machine takes the items or
 * fluids there only while its Input from Output Side is allowed, which one Screwdriver click too many switches off (see
 * `inputFromOutputSideText`). Only the EnderIO mode sets it, so the side to click is the one the conduit touches,
 * reached beside the conduit's connector.
 */
const INTO_OUTPUT_SIDE = 'into its output side: keep its Input from Output Side allowed (a newly crafted machine has it on; a Screwdriver '
  + 'right-click on that side of the machine, beside the conduit, switches it)';

function insertText(s: ConduitInsert, nameOf: (k: StuffKey) => string): string {
  const text = [`insert on ${DYE_NAMES[s.color]}${filterClause(s.filter, nameOf)}`];
  if (s.priority !== undefined) text.push(`priority ${fmtInt(s.priority)}`);
  if (s.outputSide === true) text.push(INTO_OUTPUT_SIDE);
  return text.join(', ');
}

/**
 * One side of a conduit face: `extract on <colour>[ with a <filter>][, <n>× <upgrade name>], round robin <on|off>[, self
 * feed <on|off>], redstone <redstone name>` (self feed only when set), or `insert on <colour>[ with a <filter>][, priority
 * <n>][, into its output side: keep its Input from Output Side allowed (…)]` (the last for a side into a GT basic
 * machine's output side).
 */
export function conduitSideText(side: 'extract', s: ConduitExtract, nameOf: (k: StuffKey) => string): string;
export function conduitSideText(side: 'insert', s: ConduitInsert, nameOf: (k: StuffKey) => string): string;
export function conduitSideText(side: 'extract' | 'insert', s: ConduitExtract | ConduitInsert, nameOf: (k: StuffKey) => string): string {
  return side === 'extract' ? extractText(s as ConduitExtract, nameOf) : insertText(s as ConduitInsert, nameOf);
}

/**
 * What the face's GUI slots hold, ` (<n> filter[s][, <m> speed upgrade[s]])`: the filter items of both sides and the
 * extract side's speed upgrades; nothing for a face that holds none (an ender fluid conduit's filters are its own).
 */
function faceKitText(face: ConduitFace): string {
  const filters = [face.extract?.filter, face.insert?.filter].filter((f) => f?.item !== undefined).length;
  const speed = face.extract?.speed?.count ?? 0;
  const parts = [...(filters === 0 ? [] : [`${fmtInt(filters)} filter${filters === 1 ? '' : 's'}`]),
    ...(speed === 0 ? [] : [`${fmtInt(speed)} speed upgrade${speed === 1 ? '' : 's'}`])];
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/**
 * `<conduit name>, <face> face to <target>: <mode name>[ (<what its slots hold>)][; <extract side>][; <insert side>]`:
 * the face's filters and upgrades counted, then each side with the items its filter holds.
 */
export function conduitFaceText(kind: ConduitKind, face: ConduitFace, nameOf: (k: StuffKey) => string): string {
  const text = [`${CONDUIT_NAMES[kind]}, ${faceName(face.face)} face to ${face.target}: ${CONDUIT_MODE_NAMES[face.mode]}${faceKitText(face)}`];
  if (face.extract !== undefined) text.push(conduitSideText('extract', face.extract, nameOf));
  if (face.insert !== undefined) text.push(conduitSideText('insert', face.insert, nameOf));
  return text.join('; ');
}

/** One text per face of every conduit of the block, conduits in bundle order, faces in stored order. */
export function conduitLines(block: Pick<LayoutBlock, 'conduits'>, nameOf: (k: StuffKey) => string): Array<{ kind: ConduitKind; face: Face; text: string }> {
  return (block.conduits ?? []).flatMap((conduit) =>
    conduit.faces.map((face) => ({ kind: conduit.kind, face: face.face, text: conduitFaceText(conduit.kind, face, nameOf) })));
}
