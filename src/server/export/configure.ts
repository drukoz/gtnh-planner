// Turns a clone of the server folder into a private export server (export-mod.md §5.2, §5.7), and reads what the
// orchestrator needs from the pack's own files: the world name and the java arguments of its start script.
// Every write goes into the clone; a file is replaced, never written through, so a symbolic link copied from the
// server folder cannot carry a write back into it.

import { constants, statSync } from 'node:fs';
import { copyFile, lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

/**
 * The clone's `server.properties` overrides (export-mod.md §5.2): its own port on 127.0.0.1 only, a fresh FLAT world
 * nobody can join, nothing to generate or tick. `max-tick-time=0` keeps ServerUtilities' hang watchdog off during the
 * long export tick.
 */
export const EXPORT_PROPERTIES: Readonly<Record<string, string>> = Object.freeze({
  'server-port': '25566',
  'server-ip': '127.0.0.1',
  'level-name': 'export-world',
  'level-type': 'FLAT',
  'online-mode': 'false',
  'white-list': 'true',
  'max-tick-time': '0',
  'generate-structures': 'false',
  'spawn-animals': 'false',
  'spawn-monsters': 'false',
  'spawn-npcs': 'false',
  'snooper-enabled': 'false',
  'enable-query': 'false',
  'enable-rcon': 'false',
  'view-distance': '3',
});

/** Start scripts in the order they are tried: the pack's Java 17+ script first. */
const START_SCRIPTS = ['startserver-java9.sh', 'startserver.sh'] as const;
/** Exporter jars an earlier run (or the server owner) left in `mods/`. */
const EXPORTER_JAR = /^gtnhplannerexport-.*\.jar$/i;

/** The server folder has no start script, or its start script has no line that runs java. */
export class StartScriptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StartScriptError';
  }
}

/** The server's `eula.txt` does not say `eula=true`. */
export class EulaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EulaError';
  }
}

/** A `key=value`, `key: value` or `key value` line of a Java properties file; comments (`#`, `!`) and blanks don't match. */
const PROPERTY_LINE = /^[ \t\f]*([^\s=:#!][^\s=:]*)(?:[ \t\f]*[=:][ \t\f]*|[ \t\f]+|$)(.*)$/;

function propertyKey(line: string): string | null {
  return PROPERTY_LINE.exec(line)?.[1] ?? null;
}

/** A properties value with its escapes (`\:`, `\=`, `\uXXXX`, …) removed, as `java.util.Properties` reads it. */
function unescapeValue(raw: string): string {
  const named: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) =>
    c.length === 5 ? String.fromCharCode(Number.parseInt(c.slice(1), 16)) : named[c] ?? c);
}

/** The value of the last `key` line (Java's rule for a repeated key), or null when there is none. */
function readProperty(text: string, key: string): string | null {
  let value: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = PROPERTY_LINE.exec(line);
    if (m?.[1] === key) value = unescapeValue(m[2] ?? '');
  }
  return value;
}

/**
 * `text` with the value of every key in `overrides` replaced in place; comments, blank lines and other keys stay as they
 * are, keys `text` lacks are appended in `overrides` order. Line ends become `\n`, and the result ends with one.
 */
export function rewriteProperties(text: string, overrides: Readonly<Record<string, string>>): string {
  const wanted = new Map(Object.entries(overrides));
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const present = new Set<string>();
  const out = lines.map((line) => {
    const key = propertyKey(line);
    const value = key === null ? undefined : wanted.get(key);
    if (key === null || value === undefined) return line;
    present.add(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of wanted) if (!present.has(key)) out.push(`${key}=${value}`);
  return `${out.join('\n')}\n`;
}

/** The world folder the server uses: `level-name`, `World` (the pack's value) when it is missing or empty. */
export function readLevelName(propertiesText: string): string {
  return readProperty(propertiesText, 'level-name') || 'World';
}

/** The absolute path of the server's `startserver-java9.sh`, else its `startserver.sh`. */
export function findStartScript(source: string): string {
  for (const name of START_SCRIPTS) {
    const file = resolve(source, name);
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  }
  throw new StartScriptError(`${resolve(source)} has no ${START_SCRIPTS.join(' or ')} to take the java arguments from`);
}

type ShellToken = { kind: 'word'; text: string } | { kind: 'operator'; text: string };

/** At a token start: `&&`, `||`, `;`, `|`, `&`, `<`, `>`, `>>` and `2>&1` (any digits before a redirection). */
const SHELL_OPERATOR = /^(?:&&|\|\||\d*(?:>>|>&\d*|<&\d*|>|<)|[;|&])/;

/**
 * One line of a POSIX shell script as words (quotes and backslashes removed, nothing expanded) and operators, up to a
 * `#` comment. `unterminated` is set when a quote is still open at the end of the line.
 */
function shellTokens(line: string): { tokens: ShellToken[]; unterminated: boolean } {
  const tokens: ShellToken[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (c === '#') break;
    const op = SHELL_OPERATOR.exec(line.slice(i));
    if (op) {
      tokens.push({ kind: 'operator', text: op[0] });
      i += op[0].length;
      continue;
    }
    let word = '';
    while (i < line.length) {
      const ch = line[i]!;
      if (ch === ' ' || ch === '\t' || ';&|<>'.includes(ch)) break;
      if (ch === "'") {
        const end = line.indexOf("'", i + 1);
        if (end < 0) return { tokens, unterminated: true };
        word += line.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '"') {
        i += 1;
        for (;;) {
          if (i >= line.length) return { tokens, unterminated: true };
          const d = line[i]!;
          if (d === '"') break;
          const next = line[i + 1];
          if (d === '\\' && next !== undefined && '"\\$`'.includes(next)) {
            word += next;
            i += 2;
          } else {
            word += d;
            i += 1;
          }
        }
        i += 1;
      } else if (ch === '\\') {
        word += line[i + 1] ?? '';
        i += 2;
      } else {
        word += ch;
        i += 1;
      }
    }
    tokens.push({ kind: 'word', text: word });
  }
  return { tokens, unterminated: false };
}

/**
 * The arguments the start script passes to java: on the first line (not a comment) whose command is `java` or a path
 * ending in `/java`, quoted or not, the words after it with their quoting removed, up to the first shell operator
 * (`&&`, `||`, `;`, `|`, `>`, `>>`, `<`, `2>&1`, `&`). Backslash-newline continuations are joined first.
 */
export function readStartArgs(scriptText: string): string[] {
  const lines = scriptText.replace(/\\\r?\n/g, '').split(/\r?\n/);
  for (const line of lines) {
    const { tokens, unterminated } = shellTokens(line);
    const [command, ...rest] = tokens;
    if (command?.kind !== 'word' || basename(command.text) !== 'java') continue;
    const end = rest.findIndex((t) => t.kind === 'operator');
    if (end < 0 && unterminated) {
      throw new StartScriptError(`the start script's java line has a quote that is never closed: ${line.trim()}`);
    }
    return (end < 0 ? rest : rest.slice(0, end)).map((t) => t.text);
  }
  throw new StartScriptError('the start script has no line that runs java, so its java arguments are unknown');
}

/** Writes `file` as a new file: whatever is there (also a symbolic link) is removed first, never written through. */
async function replaceFile(file: string, text: string): Promise<void> {
  await rm(file, { force: true });
  await writeFile(file, text, { flag: 'wx' });
}

async function assertEulaAccepted(clone: string): Promise<void> {
  const file = join(clone, 'eula.txt');
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (readProperty(text, 'eula')?.toLowerCase() !== 'true') {
    throw new EulaError('The server folder\'s eula.txt does not say eula=true. Accept the Minecraft EULA in the server '
      + 'folder first (set eula=true in its eula.txt); this tool never accepts it for you.');
  }
}

/**
 * Makes the clone at `clone` a private export server: refuses it unless its `eula.txt` says `eula=true` (copied from the
 * server folder, `EulaError`), rewrites `server.properties` with `EXPORT_PROPERTIES`, writes an empty `whitelist.json`,
 * replaces every `mods/gtnhplannerexport-*.jar` with `opts.jar` (under its own file name) and removes a leftover
 * `export-world/`.
 */
export async function configureClone(clone: string, opts: { jar: string }): Promise<void> {
  const dir = resolve(clone);
  await assertEulaAccepted(dir);
  const properties = join(dir, 'server.properties');
  await replaceFile(properties, rewriteProperties(await readFile(properties, 'utf8'), EXPORT_PROPERTIES));
  await replaceFile(join(dir, 'whitelist.json'), '[]\n');
  const mods = join(dir, 'mods');
  if (!(await lstat(mods)).isDirectory()) {
    throw new Error(`${mods} is not a folder of the clone (a symbolic link?), so the exporter jar cannot be installed there`);
  }
  for (const name of await readdir(mods)) {
    if (EXPORTER_JAR.test(name)) await rm(join(mods, name), { recursive: true, force: true });
  }
  const installed = join(mods, basename(opts.jar));
  await rm(installed, { recursive: true, force: true });
  await copyFile(opts.jar, installed, constants.COPYFILE_EXCL);
  await rm(join(dir, 'export-world'), { recursive: true, force: true });
}
