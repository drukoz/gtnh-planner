// The project page's "In-game projector" panel under the settings (spec §3.13, architecture §11.23): a token for one
// player with the chat command that loads this line in their game (shown once, right after it is made: the planner keeps
// only its hash), the command that points the mod at this planner, the project's tokens with Revoke, and the mod's other
// commands. The token list loads when the panel is first opened. Copy works over plain http too, where browsers have no
// clipboard API, and says at the command what it did.

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { messageOf } from '../api/client.ts';
import { createToken, listTokens, revokeToken } from '../api/projector.ts';
import { showToast } from '../state/toasts.ts';
import { TOKEN_LABEL_MAX, type CreateTokenResult, type TokenInfo } from '../../shared/types/projector.ts';
import {
  COPY_HINT, PROJECTOR_COMMANDS, copyCommand, lastUsedText, loadCommand, revokeQuestion, urlCommand, type CopyOutcome, type CopyTools,
} from './projector-model.ts';

export interface ProjectorPanelViewProps {
  projectId: string; origin: string; now: Date; tokens: TokenInfo[] | null; created: CreateTokenResult | null;
  label: string; busy: boolean; error: string | null; onLabel(v: string): void; onCreate(): void; onRevoke(t: TokenInfo): void; onCopy(text: string): void;
  /** What the last Copy click did, shown at its command: "Copied" on its button, or how to copy by hand under it. */
  copied?: CopyOutcome | null;
  /** The panel was opened (true) or closed. */
  onToggle?(open: boolean): void;
}

// The panel, the form, a command (a token never fits the panel's width on one line, and one click selects the whole command) and the list
// of commands are the stylesheet's (`.projector-*`, `.command-*`); what stays here is the hint's margin, which a test pins.
const HINT_STYLE: CSSProperties = { marginTop: 4 };
/** How long a copied command's button says "Copied". */
const COPIED_MS = 2000;

/** A chat command and its Copy button, with what the last click on that button did. */
function CommandLine(props: { text: string; copied: CopyOutcome | null; onCopy(text: string): void }): ReactElement {
  const { text, copied, onCopy } = props;
  const outcome = copied?.text === text ? copied : null;
  return (
    <div className="command-line">
      <div className="command-row">
        <span className="command-text"><code>{text}</code></span>
        <button type="button" className="small" onClick={() => onCopy(text)}>{outcome?.copied === true ? 'Copied' : 'Copy'}</button>
      </div>
      {outcome?.copied === false && <p className="small" role="status" style={HINT_STYLE}>{COPY_HINT}</p>}
    </div>
  );
}

function TokenList(props: { tokens: TokenInfo[] | null; now: Date; busy: boolean; onRevoke(t: TokenInfo): void }): ReactElement {
  const { tokens, now, busy, onRevoke } = props;
  if (tokens === null) return <p className="muted small">Loading…</p>;
  if (tokens.length === 0) return <p className="muted small">No tokens yet.</p>;
  return (
    <ul className="key-list">
      {tokens.map((t) => (
        <li key={t.tokenId} data-token-id={t.tokenId}>
          {/* one string: static markup puts <!-- --> between adjacent text expressions */}
          <span className="key-name small">{`${t.label} · ${t.hint}… · by ${t.createdBy} · ${lastUsedText(t.lastUsedAt, now)}`}</span>
          <button type="button" className="small" disabled={busy} onClick={() => onRevoke(t)}>Revoke</button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectorPanelView(props: ProjectorPanelViewProps): ReactElement {
  const { projectId, origin, now, tokens, created, label, busy, error, onLabel, onCreate, onRevoke, onCopy, onToggle } = props;
  const copied = props.copied ?? null;
  return (
    <details className="settings-section projector-panel" onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary>In-game projector</summary>
      <div className="projector-body">
        <p className="muted small">
          See this line as ghost blocks in Minecraft and tick off build steps as you place them. Each player installs the GTNH
          Planner Projector mod in their own game (nothing goes on the server) and runs one command.
        </p>
        <form className="row projector-form" onSubmit={(e) => { e.preventDefault(); onCreate(); }}>
          <label className="field">
            <span>Who is it for?</span>
            <input value={label} placeholder="e.g. Steve" maxLength={TOKEN_LABEL_MAX} onChange={(e) => onLabel(e.currentTarget.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy}>Create token</button>
        </form>
        {/* right under the form, not below the token list: the panel scrolls inside the settings column */}
        {error !== null && <div className="error small"><p role="alert">{error}</p></div>}
        {created !== null && (
          <div>
            <p>Paste this into Minecraft chat. The token is shown only now.</p>
            <CommandLine text={loadCommand(projectId, created.token)} copied={copied} onCopy={onCopy} />
          </div>
        )}
        <div>
          <p className="muted small">If the planner is not at the Minecraft server's address on port 8765, also run this once:</p>
          <CommandLine text={urlCommand(origin)} copied={copied} onCopy={onCopy} />
        </div>
        <div>
          <h4>Tokens</h4>
          <TokenList tokens={tokens} now={now} busy={busy} onRevoke={onRevoke} />
        </div>
        <div>
          <h4>Commands</h4>
          <ul className="small projector-commands">
            {PROJECTOR_COMMANDS.map(([command, what]) => <li key={command}><code>{command}</code>{` — ${what}`}</li>)}
          </ul>
        </div>
      </div>
    </details>
  );
}

/** Selects the shown command `text` inside `panel`, so Ctrl+C copies it; false when it is not shown. */
function selectCommand(panel: HTMLElement | null, text: string): boolean {
  const code = Array.from(panel?.querySelectorAll('code') ?? []).find((c) => c.textContent === text);
  const selection = getSelection();
  if (code === undefined || selection === null) return false;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * The browser's copy tools for the commands in `panel`: the clipboard API only in a secure context (elsewhere
 * `navigator.clipboard` is missing), and the old copy of the selected command, which works on plain http too.
 */
function browserCopyTools(panel: HTMLElement | null): CopyTools {
  const clipboard: Clipboard | undefined = window.isSecureContext ? navigator.clipboard : undefined;
  return {
    writeText: clipboard === undefined ? null : (text) => clipboard.writeText(text),
    copySelected: (text) => {
      if (!selectCommand(panel, text)) return false;
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    },
  };
}

export function ProjectorPanel(props: { projectId: string }): ReactElement {
  const { projectId } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [created, setCreated] = useState<CreateTokenResult | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const listRequest = useRef(0);        // number of the newest list request: an older answer that comes late is dropped
  const loadingOnOpen = useRef(false);  // the list asked for on opening is on its way
  const copyClick = useRef(0);          // number of the newest Copy click: only its outcome is shown
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);
  // A failed Create or Revoke can come while the panel is scrolled to the token list: bring the alert into view.
  useEffect(() => {
    if (error !== null) panel.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  const failed = (err: unknown): void => setError(messageOf(err));
  const refresh = (): Promise<void> => {
    const request = ++listRequest.current;
    return listTokens(projectId).then((list) => {
      if (request === listRequest.current) setTokens(list);
    }, failed);
  };
  const toggled = (open: boolean): void => {
    // The first opening loads the list; a later one tries again only if that failed.
    if (!open || tokens !== null || loadingOnOpen.current) return;
    loadingOnOpen.current = true;
    void refresh().finally(() => {
      loadingOnOpen.current = false;
    });
  };
  const create = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    createToken(projectId, label)
      .then((made) => {
        setCreated(made);
        setLabel('');
        return refresh();
      }, failed)
      .finally(() => setBusy(false));
  };
  const revoke = (t: TokenInfo): void => {
    if (busy || !window.confirm(revokeQuestion(t.label))) return;
    setBusy(true);
    setError(null);
    revokeToken(projectId, t.tokenId)
      .then(() => setCreated((c) => (c?.tokenId === t.tokenId ? null : c)), failed)   // its command no longer works
      .then(refresh)                                                                    // also when someone revoked it first
      .finally(() => setBusy(false));
  };
  const copy = (text: string): void => {
    const click = ++copyClick.current;
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = null;
    // called right here in the click: without a clipboard API the selection must be copied before the click ends
    void copyCommand(text, browserCopyTools(panel.current)).then((done) => {
      if (click !== copyClick.current) return;
      setCopied({ text, copied: done });
      // "Copied" turns back into "Copy" after a moment, and a toast says so too (Phase 2 spec §12.1); the hint to copy by hand, which a copy
      // that failed shows instead, stays until the next click
      if (!done) return;
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
      showToast('Command copied');
    });
  };
  return (
    <div ref={panel}>
      <ProjectorPanelView
        projectId={projectId} origin={location.origin} now={new Date()} tokens={tokens} created={created} label={label} busy={busy}
        error={error} copied={copied} onLabel={setLabel} onCreate={create} onRevoke={revoke} onCopy={copy} onToggle={toggled}
      />
    </div>
  );
}
