// The project page's "In-game projector" panel under the settings (spec §3.13, architecture §11.23): a token for one
// player with the chat command that loads this line in their game (shown once, right after it is made: the planner keeps
// only its hash), the command that points the mod at this planner, the project's tokens with Revoke, and the mod's other
// commands. The token list loads when the panel is first opened. Copy works over plain http too, where browsers have no
// clipboard API, and says at the command what it did; a toast says it too, but inside the open drawer, where a toast would only wait
// behind it, a polite line of the panel's own says it aloud instead (ledger ruling P2-R56).
//
// Revoke asks first, in the panel (Phase 2 spec §13): the confirm is drawn in the token's row in place of its Revoke button, and takes the
// focus. Keep it (or Escape) gives the focus back to that Revoke; a revoke that went through, the row gone, to the "Who is it for?" field; a
// revoke that failed leaves the confirm asking, says why in it, and leaves the focus on Keep it. A row that goes while it is asked about
// (someone revoked the token first) takes its question with it, and why the revoke failed is said under the form. The focus is never left on
// the page's body: a row's Revoke that cannot take it (the panel is busy) passes it to the field, and the field to the page's main.
//
// Ledger ruling P2-R68: Create token, disabled while the token is made, hands the focus to the field first, and once the token is made to its
// command's Copy. A revoke that went through, which has no toast, is said on the panel's polite line, and a copy's 2 s never take it off. Why
// a revoke failed is said once: in the confirm while its row is still listed after the refresh, else under the form, and a list that failed in
// the same words (the server out of reach) is not said too (P2-R70).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { messageOf } from '../api/client.ts';
import { createToken, listTokens, revokeToken } from '../api/projector.ts';
import { InlineConfirm } from '../components/InlineConfirm.tsx';
import { focusLost, focusMain, focusOn } from '../components/focus.ts';
import { showToast, toastsInert } from '../state/toasts.ts';
import { TOKEN_LABEL_MAX, type CreateTokenResult, type TokenInfo } from '../../shared/types/projector.ts';
import {
  COPY_HINT, PROJECTOR_COMMANDS, TOKEN_REVOKED, copyCommand, lastUsedText, loadCommand, revokeQuestion, urlCommand, type CopyOutcome, type CopyTools,
} from './projector-model.ts';

export interface ProjectorPanelViewProps {
  projectId: string; origin: string; now: Date; tokens: TokenInfo[] | null; created: CreateTokenResult | null;
  label: string; busy: boolean; error: string | null; onLabel(v: string): void; onCreate(): void; onRevoke(t: TokenInfo): void; onCopy(text: string): void;
  /** What the last Copy click did, shown at its command: "Copied" on its button, or how to copy by hand under it. */
  copied?: CopyOutcome | null;
  /** The panel was opened (true) or closed. */
  onToggle?(open: boolean): void;
  /** The token whose Revoke is asking, in its row (Phase 2 spec §13), or null when none is. */
  asking?: string | null;
  /** Revoke was pressed: ask, in its row. Without it, Revoke revokes at once. */
  onAskRevoke?(t: TokenInfo): void;
  /** The question was answered Keep it, or Escape. */
  onCancelRevoke?(): void;
  /** Why the revoke that was asked for failed, said in its confirm. */
  revokeError?: string | null;
  /** What the panel says aloud on its polite line ("Copied" inside the drawer, "Token revoked"): a new key each time, so each is heard. */
  said?: { key: number; text: string } | null;
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

function TokenList(props: {
  tokens: TokenInfo[] | null; now: Date; busy: boolean; asking: string | null; revokeError: string | null;
  onRevoke(t: TokenInfo): void; onAskRevoke?(t: TokenInfo): void; onCancelRevoke?(): void;
}): ReactElement {
  const { tokens, now, busy, asking, revokeError, onRevoke, onAskRevoke, onCancelRevoke } = props;
  if (tokens === null) return <p className="muted small">Loading…</p>;
  if (tokens.length === 0) return <p className="muted small">No tokens yet.</p>;
  return (
    <ul className="key-list">
      {tokens.map((t) => (
        <li key={t.tokenId} data-token-id={t.tokenId}>
          {/* one string: static markup puts <!-- --> between adjacent text expressions */}
          <span className="key-name small">{`${t.label} · ${t.hint}… · by ${t.createdBy} · ${lastUsedText(t.lastUsedAt, now)}`}</span>
          {/* asking, the question takes the place of Revoke, so no second button in the row is named with it but "Revoke token" (§3.8) */}
          {asking === t.tokenId ? (
            <InlineConfirm
              question={revokeQuestion(t.label)} confirmLabel="Revoke token" busy={busy} error={revokeError}
              onConfirm={() => onRevoke(t)} onCancel={() => onCancelRevoke?.()}
            />
          ) : (
            <button type="button" className="small" disabled={busy} onClick={() => (onAskRevoke ?? onRevoke)(t)}>Revoke</button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProjectorPanelView(props: ProjectorPanelViewProps): ReactElement {
  const { projectId, origin, now, tokens, created, label, busy, error, onLabel, onCreate, onRevoke, onCopy, onToggle } = props;
  const { onAskRevoke, onCancelRevoke } = props;
  const copied = props.copied ?? null;
  const asking = props.asking ?? null;
  const revokeError = props.revokeError ?? null;
  const said = props.said ?? null;
  const panel = (
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
          <TokenList
            tokens={tokens} now={now} busy={busy} asking={asking} revokeError={revokeError}
            onRevoke={onRevoke} onAskRevoke={onAskRevoke} onCancelRevoke={onCancelRevoke}
          />
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
  return (
    <>
      {panel}
      {/* always there, so a screen reader hears what is put in it: a new span for each saying, so the same words twice are heard twice */}
      <p className="visually-hidden" aria-live="polite">{said !== null && <span key={said.key}>{said.text}</span>}</p>
    </>
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
  const [said, setSaid] = useState<{ key: number; text: string } | null>(null);   // what the panel says aloud on its polite line
  const sayings = useRef(0);                                                          // the key of the last saying
  const copySaying = useRef<number | null>(null);    // the key of the last copy's "Copied", the one saying a copy may take back
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [asking, setAsking] = useState<string | null>(null);              // the token whose Revoke asks, in its row (Phase 2 spec §13)
  const [revokeError, setRevokeError] = useState<string | null>(null);    // why the revoke it asked for failed
  const askingNow = useRef<string | null>(null);  // `asking` as last set: a revoke's answer can come once a Keep it has closed its question
  const askedIn = useRef<string | null>(null);    // the row the question was drawn in at the last commit

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);
  // A failed Create or Revoke can come while the panel is scrolled to the token list: bring the alert into view.
  useEffect(() => {
    if (error !== null) panel.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  const failed = (err: unknown): void => setError(messageOf(err));
  /** Says `text` aloud on the panel's polite line, as a new saying; returns its key. */
  const say = (text: string): number => {
    const key = ++sayings.current;
    setSaid({ key, text });
    return key;
  };
  /** Takes the saying `key` off the polite line, if it is still the one there: never a later one (a revoke's said meanwhile). */
  const unsay = (key: number | null): void => setSaid((now) => (now !== null && now.key === key ? null : now));
  /** Asks in the row of token `tokenId`, or in none, with no reason from an earlier answer. */
  const ask = (tokenId: string | null): void => {
    askingNow.current = tokenId;
    setAsking(tokenId);
    setRevokeError(null);
  };
  // Once the rows are drawn. A row that has gone takes its question with it: revoked here, or by someone else first (`revoke` says why under
  // the form). And a question that has gone and taken the focus with it gives it back: to its row's Revoke (Keep it, Escape), else (the row
  // gone, or its Revoke disabled while the panel is busy) to the "Who is it for?" field, else to the page's main, never to the body. A focus
  // moved elsewhere meanwhile stays where it is.
  useLayoutEffect(() => {
    const drawn = asking !== null && tokens?.some((t) => t.tokenId === asking) === true ? asking : null;
    const was = askedIn.current;
    askedIn.current = drawn;
    if (asking !== null && drawn === null) ask(null);
    if (was === null || drawn !== null) return;   // nothing was asked, or a question is still drawn (in another row: it took the focus)
    if (!focusLost()) return;
    const back = panel.current?.querySelector(`li[data-token-id="${CSS.escape(was)}"] > button`);
    if (!focusOn(back) && !focusOn(panel.current?.querySelector('.projector-form input'))) focusMain();
  }, [asking, tokens]);
  /**
   * Loads the token list again; resolves with it, or with null when that failed, which is said under the form unless in the words of `unsaid`,
   * a reason said already: a revoke and its list failing alike (the server out of reach) say it once (ledger ruling P2-R70).
   */
  const refresh = (unsaid: string | null = null): Promise<TokenInfo[] | null> => {
    const request = ++listRequest.current;
    return listTokens(projectId).then((list) => {
      if (request === listRequest.current) setTokens(list);
      return list;
    }, (err: unknown) => {
      const why = messageOf(err);
      if (why !== unsaid) setError(why);
      return null;
    });
  };
  // Once a made token's command is drawn, its Copy takes the focus, the next thing to do with the token, if the focus is still where the create
  // left it (the form) or has been lost; else (no such button) the field does, else the page's main.
  useLayoutEffect(() => {
    if (created === null) return;
    const form = panel.current?.querySelector('.projector-form');
    if (!focusLost() && form?.contains(document.activeElement) !== true) return;
    const text = loadCommand(projectId, created.token);
    const command = [...(panel.current?.querySelectorAll('.command-line code') ?? [])].find((c) => c.textContent === text);
    if (focusOn(command?.closest('.command-line')?.querySelector('button'))) return;
    if (focusLost() && !focusOn(form?.querySelector('input'))) focusMain();
  }, [created]);
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
    // Create token is disabled while the token is made, and a disabled button drops the focus it has on the body at its next frame: the field
    // takes it first (the confirm's Revoke token hands its focus to Keep it the same way)
    const form = panel.current?.querySelector('.projector-form');
    if (document.activeElement === form?.querySelector('button[type="submit"]') && !focusOn(form?.querySelector('input'))) focusMain();
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
  const askRevoke = (t: TokenInfo): void => {
    if (!busy) ask(t.tokenId);
  };
  const cancelRevoke = (): void => ask(null);
  /** The confirm's Revoke token: no browser dialog asks first any more, the confirm has. */
  const revoke = (t: TokenInfo): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRevokeError(null);
    let reason: string | null = null;                                                   // why it failed, said once the list is back
    revokeToken(projectId, t.tokenId)
      .then(() => {
        setCreated((c) => (c?.tokenId === t.tokenId ? null : c));                       // its command no longer works
        setTokens((list) => list?.filter((x) => x.tokenId !== t.tokenId) ?? list);       // its row goes at once, the list's answer or not
        say(TOKEN_REVOKED);                                                             // no toast says it (spec §12.1)
      }, (err: unknown) => {
        reason = messageOf(err);
      })
      .then(() => refresh(reason))                                                      // also when someone revoked it first: its row goes
      .then((list) => {
        if (reason === null) return;
        // Said once (P2-R68; a list that failed in the same words is not said too, P2-R70). The row still listed (the server refused it, a 503
        // say; a list that failed to come keeps the rows), its question still asks: in the confirm, where the focus is on Keep it. Its row gone
        // (someone revoked it first), its question has gone with it, or a question closed while the revoke was on its way: under the form.
        const listed = list?.some((x) => x.tokenId === t.tokenId) ?? true;
        if (listed && askingNow.current === t.tokenId) setRevokeError(reason);
        else setError(reason);
      })
      .finally(() => setBusy(false));
  };
  const copy = (text: string): void => {
    const click = ++copyClick.current;
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = null;
    unsay(copySaying.current);                                                         // the last copy's own "Copied", and no other saying
    copySaying.current = null;
    // called right here in the click: without a clipboard API the selection must be copied before the click ends
    void copyCommand(text, browserCopyTools(panel.current)).then((done) => {
      if (click !== copyClick.current) return;
      setCopied({ text, copied: done });
      // "Copied" turns back into "Copy" after a moment, and a toast says so too (Phase 2 spec §12.1); the hint to copy by hand, which a copy
      // that failed shows instead, stays until the next click. Inside the open drawer a toast would only wait behind it, so there is none: the
      // button's "Copied" is the feedback, and the panel's polite line says it aloud (ledger ruling P2-R56)
      if (!done) return;
      const mine = toastsInert() ? say('Copied') : null;
      copySaying.current = mine;
      copiedTimer.current = setTimeout(() => {
        setCopied(null);
        unsay(mine);                                                                    // its own saying: a revoke's said since stays said
      }, COPIED_MS);
      if (mine === null) showToast('Command copied');
    });
  };
  return (
    <div ref={panel}>
      <ProjectorPanelView
        projectId={projectId} origin={location.origin} now={new Date()} tokens={tokens} created={created} label={label} busy={busy}
        error={error} copied={copied} onLabel={setLabel} onCreate={create} onRevoke={revoke} onCopy={copy} onToggle={toggled}
        asking={asking} revokeError={revokeError} onAskRevoke={askRevoke} onCancelRevoke={cancelRevoke} said={said}
      />
    </div>
  );
}
