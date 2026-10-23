// Small display formats shared by the views: the one number format of fix spec §6.1 (rates, amounts, times and shares,
// the same as the server's warning texts), the article before a machine's name (as the build steps word it) and local
// times.

export { formatDuration, formatNumber, formatPercent, formatRate, withArticle } from '../shared/format.ts';

/** An ISO time as the viewer's local date and time; anything that is not a time is shown as given. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
