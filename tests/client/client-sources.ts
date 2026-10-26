// The client's sources, as files to read as text: the client tests run in node with no DOM, so a rule that every handler or call in the client
// must keep is checked in its sources.

import { readdirSync } from 'node:fs';

/** src/client/, which `sources()` paths are relative to: `new URL(path, ROOT)` is a source's file. */
export const ROOT = new URL('../../src/client/', import.meta.url);

/** Every .ts and .tsx file under src/client, as paths relative to it. */
export function sources(dir = ''): string[] {
  return readdirSync(new URL(dir, ROOT), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sources(`${rel}/`);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}
