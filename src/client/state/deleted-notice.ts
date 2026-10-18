// "<name> was deleted by <by>" (§11.24): a tab whose project was deleted goes back to the project list, which shows
// this notice once. It is one value for the page, set when leaving the project and taken by the list that opens next.

import { navigate } from '../router.ts';

let pending: string | null = null;

/** The notice for a project that is gone; the name or who deleted it may be unknown to this tab. */
export function deletedNotice(name: string | null, by: string | null): string {
  if (name === null) return 'That project no longer exists';
  return by === null ? `${name} was deleted` : `${name} was deleted by ${by}`;
}

/** The notice for a project someone else had deleted by the time this tab asked to delete it. */
export function alreadyDeletedNotice(name: string): string {
  return `${name} was already deleted`;
}

/** Opens the project list, which then shows the notice for `name`. */
export function leaveDeletedProject(name: string | null, by: string | null): void {
  pending = deletedNotice(name, by);
  navigate('/');
}

/** The notice waiting to be shown, once: the next call answers null. */
export function takeDeletedNotice(): string | null {
  const notice = pending;
  pending = null;
  return notice;
}
