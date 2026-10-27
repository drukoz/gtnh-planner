// The words of the project page's "In-game projector" panel (spec §3.13): the chat commands it hands out, how long ago a
// token was last used, the mod's other commands, what it asks or tells around revoking and copying, and how a Copy
// click copies (with the browser's copy functions handed in). No DOM, no React.

/** Pasted into Minecraft chat once: the mod keeps the token for this project and loads its line. */
export function loadCommand(projectId: string, token: string): string {
  return `/planner load ${projectId} ${token}`;
}

/** Points the mod at this planner when it is not at the Minecraft server's address on port 8765. */
export function urlCommand(origin: string): string {
  return `/planner url ${origin}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `never used`, `used just now` under 2 minutes, then minutes, hours (under 48) or days ago, each rounded down. */
export function lastUsedText(iso: string | null, now: Date): string {
  if (iso === null) return 'never used';
  const ago = now.getTime() - Date.parse(iso);
  if (ago < 2 * MINUTE_MS) return 'used just now';   // also a time a little ahead of this browser's clock
  if (ago < HOUR_MS) return `used ${Math.floor(ago / MINUTE_MS)} min ago`;
  if (ago < 48 * HOUR_MS) return `used ${Math.floor(ago / HOUR_MS)} h ago`;
  return `used ${Math.floor(ago / DAY_MS)} days ago`;
}

/** The mod's chat commands besides `load` and `url`, each with what it does. */
export const PROJECTOR_COMMANDS: ReadonlyArray<readonly [command: string, what: string]> = [
  ['/planner layer <y|all>', 'show one layer, or all'],
  ['/planner step <n|all|next>', 'show one build step, all, or the next open one'],
  ['/planner reload', 'fetch the latest layout'],
  ['/planner xray on|off', 'see ghosts through walls'],
  ['/planner clear', 'hide the ghosts'],
];

/** Asked before a token is revoked. */
export function revokeQuestion(label: string): string {
  return `Revoke "${label}"? Anyone using it loses the ghosts until they get a new token.`;
}

/** Said aloud on the panel's polite line when a revoke went through, which has no toast (Phase 2 spec §12.1; ledger ruling P2-R68). */
export const TOKEN_REVOKED = 'Token revoked';

/** Shown, with the command selected, when the browser does not let the page copy it. */
export const COPY_HINT = 'Press Ctrl+C (Cmd+C on a Mac) to copy';

/** What a Copy click did with its command: put it on the clipboard, or only selected it for a copy by hand. */
export interface CopyOutcome { text: string; copied: boolean }

/** How the page can copy a command; the panel gives the browser's, tests their own. */
export interface CopyTools {
  /**
   * `navigator.clipboard.writeText`, or null where the page has none: browsers offer it only in a secure context
   * (https or localhost), so not to a friend who opens the planner at http://<host>:8765.
   */
  writeText: ((text: string) => Promise<void>) | null;
  /**
   * Selects the shown command and copies the selection the old way (`document.execCommand('copy')`), which browsers
   * still allow on plain http while the click is being handled; false when nothing was copied (the command stays
   * selected).
   */
  copySelected(text: string): boolean;
}

/**
 * Copies `text` for a Copy click: true when it is on the clipboard, false when it is only selected, so the person
 * presses Ctrl+C. Without the clipboard API the selection is copied at once, before this returns, still inside the
 * click; when the API refuses, copying the selection is tried after all.
 */
export async function copyCommand(text: string, tools: CopyTools): Promise<boolean> {
  if (tools.writeText === null) return tools.copySelected(text);
  try {
    await tools.writeText(text);
    return true;
  } catch {
    return tools.copySelected(text);
  }
}
