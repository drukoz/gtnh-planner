// One layer per press, app-wide (Phase 2 spec §6.1, R15; ledger ruling P2-R21b): a key handler that acts on Escape first skips a key whose
// default a layer above it has prevented — the shared tooltip, hiding its tip, prevents it — so one press closes one thing. The client
// tests have no DOM, so this reads the sources: every Escape test in src/client reads `defaultPrevented` on the same line. tooltips.spec.ts
// shows each kind of handler in a browser.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const ROOT = new URL('../../src/client/', import.meta.url);

/** Every .ts and .tsx file under src/client, as paths relative to it. */
function sources(dir = ''): string[] {
  return readdirSync(new URL(dir, ROOT), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sources(`${rel}/`);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

/**
 * The Escape tests that act whatever a layer above did, by design: Flow's own Escape clears its highlight on the same press as the tip's
 * (P2-D22, spec §6.1), and nothing in Flow is a layer of its own.
 */
const EXEMPT = new Set(['views/FlowView.tsx']);

describe('one layer per press, app-wide', () => {
  it('lets every Escape handler skip a key whose default was prevented', () => {
    const found: string[] = [];
    const deaf: string[] = [];
    for (const file of sources()) {
      readFileSync(new URL(file, ROOT), 'utf8').split('\n').forEach((line, i) => {
        if (!/\bkey\s*[!=]==\s*'Escape'/.test(line)) return;
        found.push(`${file}:${i + 1}`);
        if (!EXEMPT.has(file) && !/\bdefaultPrevented\b/.test(line)) deaf.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(deaf).toEqual([]);
    // the scan sees them: the tip's, the two search lists', the three drafts', the project name's, the drawer's, the pin dialog's and Flow's
    expect(found.length, found.join('\n')).toBeGreaterThanOrEqual(10);
  });
});
