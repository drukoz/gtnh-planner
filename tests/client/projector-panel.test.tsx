import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectorPanelView, type ProjectorPanelViewProps } from '../../src/client/views/ProjectorPanel.tsx';
import { loadCommand, urlCommand, lastUsedText, PROJECTOR_COMMANDS, COPY_HINT, revokeQuestion, copyCommand, type CopyTools } from '../../src/client/views/projector-model.ts';
import { createToken, listTokens, revokeToken } from '../../src/client/api/projector.ts';
import type { TokenInfo } from '../../src/shared/types/projector.ts';

const now = new Date('2026-10-18T12:00:00.000Z');
const tok = (over: Partial<TokenInfo> = {}): TokenInfo => ({ tokenId: 'T1aaaaaaaa', projectId: 'P1', label: 'Steve', createdAt: '2026-10-18T09:00:00.000Z',
  createdBy: 'Ann', lastUsedAt: null, hint: 'gpt_AbCd', ...over });
const props = (over: Partial<ProjectorPanelViewProps> = {}): ProjectorPanelViewProps => ({ projectId: 'P1', origin: 'http://mc.example.org:8765', now,
  tokens: [], created: null, label: '', busy: false, error: null, onLabel() {}, onCreate() {}, onRevoke() {}, onCopy() {}, ...over });

describe('projector panel', () => {
  it('builds the chat commands', () => {
    expect(loadCommand('P1', 'gpt_x')).toBe('/planner load P1 gpt_x');
    expect(urlCommand('http://mc.example.org:8765')).toBe('/planner url http://mc.example.org:8765');
    expect(PROJECTOR_COMMANDS.map(([c]) => c)).toEqual(['/planner layer <y|all>', '/planner step <n|all|next>', '/planner reload', '/planner xray on|off', '/planner clear']);
  });

  it('says when a token was last used', () => {
    expect([null, '2026-10-18T11:59:00.000Z', '2026-10-18T11:15:00.000Z', '2026-10-18T02:00:00.000Z', '2026-10-14T12:00:00.000Z'].map((t) => lastUsedText(t, now)))
      .toEqual(['never used', 'used just now', 'used 45 min ago', 'used 10 h ago', 'used 4 days ago']);
  });

  it('shows a new token once with its command, and the token list', () => {
    const html = renderToStaticMarkup(<ProjectorPanelView {...props({ created: { token: 'gpt_SECRET', tokenId: 'T1aaaaaaaa', info: tok() },
      tokens: [tok(), tok({ tokenId: 'T2bbbbbbbb', label: 'Alex', lastUsedAt: '2026-10-18T11:15:00.000Z' })] })} />);
    expect(html).toContain('<summary>In-game projector</summary>');
    expect(html).toContain('Paste this into Minecraft chat. The token is shown only now.');
    expect(html).toContain('<code>/planner load P1 gpt_SECRET</code>');
    expect(html).toContain('<code>/planner url http://mc.example.org:8765</code>');
    expect(html).toContain('Steve · gpt_AbCd… · by Ann · never used');
    expect(html).toContain('Alex · gpt_AbCd… · by Ann · used 45 min ago');
    expect(html.match(/data-token-id/g)).toHaveLength(2);
  });

  it('never shows a token it did not just create', () => {
    const html = renderToStaticMarkup(<ProjectorPanelView {...props({ tokens: [tok()] })} />);
    expect(html).not.toContain('/planner load');
    expect(html).not.toContain('shown only now');
    expect(renderToStaticMarkup(<ProjectorPanelView {...props({ tokens: null })} />)).toContain('Loading…');
    expect(renderToStaticMarkup(<ProjectorPanelView {...props()} />)).toContain('No tokens yet.');
    expect(renderToStaticMarkup(<ProjectorPanelView {...props({ error: 'A project can have at most 20 projector tokens — revoke one first' })} />))
      .toContain('<p role="alert">A project can have at most 20 projector tokens — revoke one first</p>');
  });

  it('shows an error right under the Create form, above the commands and the token list', () => {
    const html = renderToStaticMarkup(<ProjectorPanelView {...props({ error: 'boom', created: { token: 'gpt_SECRET', tokenId: 'T1aaaaaaaa', info: tok() }, tokens: [tok()] })} />);
    const at = (s: string) => html.indexOf(s);
    expect(at('<p role="alert">boom</p>')).toBeGreaterThan(at('Create token'));
    expect(at('<p role="alert">boom</p>')).toBeLessThan(at('<code>/planner load P1 gpt_SECRET</code>'));
    expect(at('<p role="alert">boom</p>')).toBeLessThan(at('<h4>Tokens</h4>'));
  });

  it('says at the clicked command what Copy did', () => {
    const created = { token: 'gpt_SECRET', tokenId: 'T1aaaaaaaa', info: tok() };
    const load = loadCommand('P1', 'gpt_SECRET'), url = urlCommand('http://mc.example.org:8765');
    const lineOf = (html: string, text: string) => html.slice(html.indexOf(`<code>${text}</code>`)).split('<div class="command-line">')[0]!;
    const copied = renderToStaticMarkup(<ProjectorPanelView {...props({ created, copied: { text: load, copied: true } })} />);
    expect(lineOf(copied, load)).toContain('>Copied</button>');
    expect(lineOf(copied, url)).toContain('>Copy</button>');
    expect(copied).not.toContain(COPY_HINT);
    const byHand = renderToStaticMarkup(<ProjectorPanelView {...props({ created, copied: { text: url, copied: false } })} />);
    expect(lineOf(byHand, url)).toContain(`<p class="small" role="status" style="margin-top:4px">${COPY_HINT}</p>`);
    expect(lineOf(byHand, load)).not.toContain(COPY_HINT);
    expect(byHand).not.toContain('>Copied</button>');
    expect(renderToStaticMarkup(<ProjectorPanelView {...props({ created })} />).match(/>Copy<\/button>/g)).toHaveLength(2);
  });
});

describe('copying a command', () => {
  const tools = (writeText: CopyTools['writeText'], copies: boolean) => {
    const copySelected = vi.fn((_text: string) => copies);
    return { writeText, copySelected };
  };

  it('copies the selection inside the click when the page has no clipboard API (plain http)', async () => {
    const t = tools(null, true);
    const done = copyCommand('/planner load P1 gpt_x', t);
    expect(t.copySelected).toHaveBeenCalledWith('/planner load P1 gpt_x');   // before anything is awaited
    await expect(done).resolves.toBe(true);
    const refused = tools(null, false);
    await expect(copyCommand('/planner url http://x', refused)).resolves.toBe(false);
  });

  it('uses the clipboard API where there is one, and the selection when it refuses', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const ok = tools(writeText, true);
    await expect(copyCommand('/planner load P1 gpt_x', ok)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('/planner load P1 gpt_x');
    expect(ok.copySelected).not.toHaveBeenCalled();
    const denied = tools(async () => { throw new DOMException('denied', 'NotAllowedError'); }, false);
    await expect(copyCommand('/planner load P1 gpt_x', denied)).resolves.toBe(false);
    expect(denied.copySelected).toHaveBeenCalledWith('/planner load P1 gpt_x');
    await expect(copyCommand('/planner load P1 gpt_x', tools(async () => { throw new Error('no'); }, true))).resolves.toBe(true);
  });
});

describe('projector panel container', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('pins the revoke question and the copy hint', () => {
    expect(revokeQuestion('Steve')).toBe('Revoke "Steve"? Anyone using it loses the ghosts until they get a new token.');
    expect(COPY_HINT).toBe('Press Ctrl+C (Cmd+C on a Mac) to copy');
  });

  it('lists, creates and revokes through the project token routes', async () => {
    const info = tok({ projectId: 'p 1' });
    const fetch = vi.fn(async (_path: string, init: RequestInit) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      const body = init.method === 'POST' ? { token: 'gpt_SECRET', tokenId: info.tokenId, info } : [info];
      return new Response(JSON.stringify(body), { status: init.method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(listTokens('p 1')).resolves.toEqual([info]);
    expect(fetch).toHaveBeenLastCalledWith('/api/projects/p%201/tokens', expect.objectContaining({ method: 'GET' }));
    await expect(createToken('p 1', 'Steve')).resolves.toEqual({ token: 'gpt_SECRET', tokenId: info.tokenId, info });
    expect(fetch).toHaveBeenLastCalledWith('/api/projects/p%201/tokens', expect.objectContaining({ method: 'POST', body: JSON.stringify({ label: 'Steve' }) }));
    await expect(revokeToken('p 1', 'T1/a')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenLastCalledWith('/api/projects/p%201/tokens/T1%2Fa', expect.objectContaining({ method: 'DELETE' }));
  });
});
