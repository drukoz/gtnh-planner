// The project page's "In-game projector" panel under the settings (spec §3.13, architecture §11.23): a token for one
// player with the chat command that loads this line in their game (shown once, right after it is made: the planner keeps
// only its hash), the command that points the mod at this planner, the project's tokens with Revoke, and the mod's other
// commands. The token list loads when the panel is first opened.

import { useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { messageOf } from '../api/client.ts';
import { createToken, listTokens, revokeToken } from '../api/projector.ts';
import { TOKEN_LABEL_MAX, type CreateTokenResult, type TokenInfo } from '../../shared/types/projector.ts';
import { COPY_HINT, PROJECTOR_COMMANDS, lastUsedText, loadCommand, revokeQuestion, urlCommand } from './projector-model.ts';

export interface ProjectorPanelViewProps {
  projectId: string; origin: string; now: Date; tokens: TokenInfo[] | null; created: CreateTokenResult | null;
  label: string; busy: boolean; error: string | null; onLabel(v: string): void; onCreate(): void; onRevoke(t: TokenInfo): void; onCopy(text: string): void;
  /** The panel was opened (true) or closed. */
  onToggle?(open: boolean): void;
}

// The summary looks like the other settings sections' titles; the body sets the text back.
const PANEL_STYLE: CSSProperties = { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: '0.95rem', fontWeight: 600 };
const BODY_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, fontSize: '1rem', fontWeight: 'normal' };
// A token never fits the panel's width on one line; one click selects the whole command.
const COMMAND_STYLE: CSSProperties = {
  flex: 1, minWidth: 0, padding: '3px 8px', fontSize: '0.85rem', overflowWrap: 'anywhere', userSelect: 'all', WebkitUserSelect: 'all',
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6,
};
const LIST_STYLE: CSSProperties = { margin: 0, paddingLeft: 18 };

/** A chat command and its Copy button. */
function CommandLine(props: { text: string; onCopy(text: string): void }): ReactElement {
  const { text, onCopy } = props;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={COMMAND_STYLE}><code>{text}</code></span>
      <button type="button" className="small" onClick={() => onCopy(text)}>Copy</button>
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
  return (
    <details className="settings-section" style={PANEL_STYLE} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary>In-game projector</summary>
      <div style={BODY_STYLE}>
        <p className="muted small">
          See this line as ghost blocks in Minecraft and tick off build steps as you place them. Each player installs the GTNH
          Planner Projector mod in their own game (nothing goes on the server) and runs one command.
        </p>
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); onCreate(); }}>
          <label className="field" style={{ flex: 1, minWidth: 0 }}>
            <span>Who is it for?</span>
            <input value={label} placeholder="e.g. Steve" maxLength={TOKEN_LABEL_MAX} onChange={(e) => onLabel(e.currentTarget.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy}>Create token</button>
        </form>
        {created !== null && (
          <div>
            <p>Paste this into Minecraft chat. The token is shown only now.</p>
            <CommandLine text={loadCommand(projectId, created.token)} onCopy={onCopy} />
          </div>
        )}
        <div>
          <p className="muted small">If the planner is not at the Minecraft server's address on port 8765, also run this once:</p>
          <CommandLine text={urlCommand(origin)} onCopy={onCopy} />
        </div>
        <div>
          <h4>Tokens</h4>
          <TokenList tokens={tokens} now={now} busy={busy} onRevoke={onRevoke} />
        </div>
        <div>
          <h4>Commands</h4>
          <ul className="small" style={LIST_STYLE}>
            {PROJECTOR_COMMANDS.map(([command, what]) => <li key={command}><code>{command}</code>{` — ${what}`}</li>)}
          </ul>
        </div>
        {error !== null && <div className="error small"><p role="alert">{error}</p></div>}
      </div>
    </details>
  );
}

/** Selects the shown command `text` inside `panel`, so Ctrl+C copies it. */
function selectCommand(panel: HTMLElement | null, text: string): void {
  const code = Array.from(panel?.querySelectorAll('code') ?? []).find((c) => c.textContent === text);
  const selection = getSelection();
  if (code === undefined || selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Rejects where the page may not write the clipboard: refused, or no `navigator.clipboard` at all (plain http:// away from localhost). */
async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function ProjectorPanel(props: { projectId: string }): ReactElement {
  const { projectId } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [created, setCreated] = useState<CreateTokenResult | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequest = useRef(0);        // number of the newest list request: an older answer that comes late is dropped
  const loadingOnOpen = useRef(false);  // the list asked for on opening is on its way

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
    setError(null);
    writeClipboard(text).catch(() => {
      selectCommand(panel.current, text);
      setError(COPY_HINT);
    });
  };
  return (
    <div ref={panel}>
      <ProjectorPanelView
        projectId={projectId} origin={location.origin} now={new Date()} tokens={tokens} created={created} label={label} busy={busy}
        error={error} onLabel={setLabel} onCreate={create} onRevoke={revoke} onCopy={copy} onToggle={toggled}
      />
    </div>
  );
}
