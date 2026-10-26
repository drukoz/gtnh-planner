// The in-app confirm (Phase 2 spec §13, D15; Task 10): a question asked in the page, where the control that asks it was, never in a browser
// dialog. It is an alertdialog named by its question, the dangerous answer first and the safe one, Keep it, last; Keep it takes the focus as
// it opens, Escape takes the safe answer and Tab stays inside it, which projector.spec.ts shows in a browser (these tests have no DOM). And no
// browser dialog is left anywhere in the client: a guard reads the sources.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InlineConfirm } from '../../src/client/components/InlineConfirm.tsx';
import { ROOT, sources, withoutComments } from './client-sources.ts';

type Props = Parameters<typeof InlineConfirm>[0];
const confirmOf = (over: Partial<Props> = {}): string => renderToStaticMarkup(
  <InlineConfirm question={'Revoke "Steve"? …'} confirmLabel="Revoke token" onConfirm={() => {}} onCancel={() => {}} {...over} />,
);

describe('the in-app confirm', () => {
  it('asks its question as an alertdialog named by it, the dangerous answer first and Keep it last', () => {
    const html = confirmOf();
    const parts = new RegExp(
      '^<div class="inline-confirm" role="alertdialog" aria-labelledby="([^"]+)"><p id="([^"]+)">Revoke &quot;Steve&quot;\\? …</p>'
      + '<div class="row"><button type="button" class="small danger">Revoke token</button><button type="button" class="small">Keep it</button></div></div>$',
    ).exec(html);
    expect(parts, html).not.toBeNull();
    expect(parts![1], 'named by its own question').toBe(parts![2]);
    // two confirms on one page are each named by their own question
    const two = renderToStaticMarkup(
      <><InlineConfirm question="A" confirmLabel="B" onConfirm={() => {}} onCancel={() => {}} /><InlineConfirm question="C" confirmLabel="D" onConfirm={() => {}} onCancel={() => {}} /></>,
    );
    const ids = [...two.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('names its safe answer Keep it unless it is told another', () => {
    expect(confirmOf()).toContain('<button type="button" class="small">Keep it</button>');
    const other = confirmOf({ cancelLabel: 'Not now' });
    expect(other).toContain('<button type="button" class="small">Not now</button>');
    expect(other).not.toContain('Keep it');
  });

  it('cannot be answered again while its answer is on its way, and can still be left', () => {
    const html = confirmOf({ busy: true });
    expect(html).toContain('<button type="button" class="small danger" disabled="">Revoke token</button>');
    expect(html).toContain('<button type="button" class="small">Keep it</button>');
    expect(confirmOf({ busy: false })).not.toContain('disabled');
  });

  it('says why its answer failed in an alert under the question, and keeps asking', () => {
    const html = confirmOf({ error: 'The server is not reachable' });
    expect(html).toMatch(/<p id="[^"]+">Revoke &quot;Steve&quot;\? …<\/p><p class="error small" role="alert">The server is not reachable<\/p><div class="row"><button type="button" class="small danger">Revoke token<\/button>/);
    for (const none of [null, undefined]) expect(confirmOf({ error: none })).not.toContain('role="alert"');
  });
});

describe('no browser dialog (Phase 2 spec §13.1)', () => {
  it('reads code, not comments, and passes over strings', () => {
    expect(withoutComments('a(); // confirm(x)\n/* alert(y)\n */ b("http://x", \'//\');')).toBe('a(); \n\n b("http://x", \'//\');');
  });

  it('leaves no browser dialog anywhere in the client', () => {
    const files = sources();
    const dialogs: string[] = [];
    const excused = new Set<string>();
    for (const file of files) {
      const code = withoutComments(readFileSync(new URL(file, ROOT), 'utf8'));
      code.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\b(?:window|globalThis)\.(?:confirm|alert|prompt)\(/g)) dialogs.push(`${file}:${i + 1}: ${m[0]}`);
        for (const m of line.matchAll(/(?<![\w.$])(confirm|alert|prompt)\(/g)) {
          // a function of the file's own, as project-store.ts's `function confirm(project)`, is not a dialog
          if (new RegExp(`\\bfunction\\s+${m[1]}\\b`).test(code)) excused.add(file);
          else dialogs.push(`${file}:${i + 1}: ${m[0]}`);
        }
      });
    }
    expect(dialogs).toEqual([]);
    // the walk sees the client, and the bare test bites: the store's own confirm(…) calls are seen, and excused
    expect(files.length).toBeGreaterThan(50);
    expect([...excused]).toContain('state/project-store.ts');
  });
});
