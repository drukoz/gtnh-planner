// Small display formats shared by the views.

/** An ISO time as the viewer's local date and time; anything that is not a time is shown as given. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
