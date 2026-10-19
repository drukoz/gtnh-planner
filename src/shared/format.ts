// The one number format (fix spec §6.1) for every rate, amount, time and share people read, so the server's warning
// texts (`issueText`) and the client print numbers the same way: a positive rate never reads 0 (a tiny one reads
// "1 every 526 days"), fluids carry their litres, a running machine is never "0% busy" and a part never "100%".
// Pure TypeScript shared by server and browser: nothing from node:* and no DOM.

/** Under this many per minute or hour, a rate is written as how often one unit comes. */
const SMALLEST_PER_UNIT = 0.01;
const SECONDS_PER: Readonly<Record<'min' | 'hour', number>> = { min: 60, hour: 3600 };
const UNIT: Readonly<Record<'min' | 'hour', string>> = { min: 'min', hour: 'h' };
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const YEAR = 365 * DAY;

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const SIG3 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3, useGrouping: false });

/**
 * `0` for 0; from 1,000 a whole number with separators (`13,050,000`); else at most 3 significant digits (`0.0625`,
 * `71.9`, `816`, `0.000000123`). Never an exponent, never `-0`.
 */
export function formatNumber(x: number): string {
  if (x === 0) return '0';
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? '∞' : '-∞';
  if (Math.abs(x) >= 1000) return WHOLE.format(x);
  const rounded = Number(x.toPrecision(3));
  // 999.6 rounds to 1,000, which is written whole.
  return Math.abs(rounded) >= 1000 ? WHOLE.format(rounded) : SIG3.format(x);
}

/** A length of time in the largest unit that keeps it readable, 3 significant digits: `40 s`, `9.6 min`, `3.5 h`, `526 days`, `2 years`. */
export function formatDuration(seconds: number): string {
  if (seconds < MINUTE) return `${formatNumber(seconds)} s`;
  if (seconds < HOUR) return `${formatNumber(seconds / MINUTE)} min`;
  if (seconds < 48 * HOUR) return `${formatNumber(seconds / HOUR)} h`;
  if (seconds < 730 * DAY) return `${formatNumber(seconds / DAY)} days`;
  return `${formatNumber(seconds / YEAR)} years`;
}

/**
 * A rate in the project's unit: `0.5/h`, `71.9 L/h` (`fluid`), `1,440/min`, `0.11 runs/h` (`noun`, singular and
 * plural); under 0.01 per that unit, how often one unit comes: `1 every 526 days`, `1 L every 12.1 days`,
 * `1 run every 373 days`; nothing at all reads `0/h` (`0/min`).
 */
export function formatRate(perSecond: number, per: 'min' | 'hour', opts: { fluid?: boolean; noun?: [string, string] } = {}): string {
  const litres = opts.fluid === true ? ' L' : '';
  if (!(perSecond > 0)) return `0/${UNIT[per]}`;
  const amount = perSecond * SECONDS_PER[per];
  if (amount >= SMALLEST_PER_UNIT) return `${formatNumber(amount)}${litres}${opts.noun === undefined ? '' : ` ${opts.noun[1]}`}/${UNIT[per]}`;
  return `1${litres}${opts.noun === undefined ? '' : ` ${opts.noun[0]}`} every ${formatDuration(1 / perSecond)}`;
}

/**
 * A share as a percentage: `0%` for nothing, `<0.1%` for a sliver, one decimal under 1 % and above 99 % (`0.7%`,
 * `99.2%`), `>99.9%` for nearly all, else whole (`83%`, `100%`, `121%`): a share below 1 never reads `100%`.
 */
export function formatPercent(f: number): string {
  if (f === 0 || Number.isNaN(f)) return '0%';
  if (f < 0) return `-${formatPercent(-f)}`;
  if (f < 0.001) return '<0.1%';
  if (f < 0.01) return `${(f * 100).toFixed(1)}%`;
  if (f > 0.999 && f < 1) return '>99.9%';
  if (f > 0.99 && f < 1) return `${(f * 100).toFixed(1)}%`;
  return `${Math.round(f * 100)}%`;
}
