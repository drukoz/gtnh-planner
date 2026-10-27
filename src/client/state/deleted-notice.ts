// "<name> was deleted by <by>" (§11.24): a tab whose project was deleted goes back to the project list, which shows
// this notice once. It is one value for the page, set when leaving the project and taken by the list that opens next,
// with the project it is about, so a restore of that project (its toast's Undo) drops it, and only it (Task 9b, M5).

import { navigate } from '../router.ts';

/** A notice for the project list, and the project it is about (null when the page that left did not know it). */
export interface ListNotice { text: string; about: string | null }

let pending: ListNotice | null = null;

/** The notice for a project that is gone; the name or who deleted it may be unknown to this tab. */
export function deletedNotice(name: string | null, by: string | null): string {
  if (name === null) return 'That project no longer exists';
  return by === null ? `${name} was deleted` : `${name} was deleted by ${by}`;
}

/** The notice for a project someone else had deleted by the time this tab asked to delete it. */
export function alreadyDeletedNotice(name: string): string {
  return `${name} was already deleted`;
}

/** Opens the project list, which then shows the notice for `name` (project `about`, when known). */
export function leaveDeletedProject(name: string | null, by: string | null, about: string | null = null): void {
  pending = { text: deletedNotice(name, by), about };
  navigate('/');
}

/** The notice waiting to be shown, once: the next call answers null. */
export function takeDeletedNotice(): string | null {
  return takeListNotice()?.text ?? null;
}

/** The notice waiting to be shown and the project it is about, once. */
export function takeListNotice(): ListNotice | null {
  const notice = pending;
  pending = null;
  return notice;
}

/** Drops the notice waiting to be shown if it is about project `id`, which is back (M5). */
export function forgetDeletedNotice(id: string): void {
  if (pending?.about === id) pending = null;
}
