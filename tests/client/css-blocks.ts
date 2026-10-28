// The stylesheet scanner of the client tests (Phase 2 Task 1a): styles.css is read as text, in node, and cut into blocks here, so the
// stylesheet contract (styles-contract.test.tsx) and the contrast test (contrast.test.tsx) read the same blocks; and a look's tokens,
// for the contrast test to measure each pair at the colours that look draws.

/** One `prelude { inner }` block of the stylesheet; `nested` when it sits inside an `@media`-like block. */
export interface Block { prelude: string; inner: string; nested: boolean }

/** The index of the `}` that closes the `{` at `open`; quoted text is skipped. */
export function closingBrace(src: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i);
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('styles.css has a block that is never closed');
}

/**
 * Every block of `src` in source order, the blocks inside an `@media` (or similar) right after it. The steps of a
 * `@keyframes` are not rules, so they stay inside it.
 */
export function scan(src: string, nested: boolean, into: Block[]): Block[] {
  for (let at = 0; at < src.length;) {
    const open = src.indexOf('{', at);
    if (open < 0) break;
    const close = closingBrace(src, open);
    const prelude = src.slice(at, open).replace(/\s+/g, ' ').trim();
    const inner = src.slice(open + 1, close);
    into.push({ prelude, inner: inner.replace(/\s+/g, ' ').trim(), nested });
    if (/^@(media|supports|layer|container)\b/.test(prelude)) scan(inner, true, into);
    at = close + 1;
  }
  return into;
}

/** Every block of a stylesheet's text, its comments left out. */
export function cssBlocks(src: string): Block[] {
  return scan(src.replace(/\/\*[\s\S]*?\*\//g, ''), false, []);
}

/** The `[name, value]` pairs of a block body; a `;` inside quotes or parentheses (a data URI) does not end a declaration. */
export function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let start = 0;
  let parens = 0;
  let quote = '';
  for (let i = 0; i <= body.length; i++) {
    const c = body.charAt(i);
    if (quote !== '') {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if ((c === ';' && parens === 0) || i === body.length) {
      const declaration = body.slice(start, i).trim();
      start = i + 1;
      const colon = declaration.indexOf(':');
      if (colon > 0) out.push([declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]);
    }
  }
  return out;
}

/** The two looks of the page (Phase 2 spec §4): the light one of Phase 1, and the dark one. */
export type Look = 'light' | 'dark';

/** The prelude of the block that holds the dark look's values (spec §4.2). */
const DARK_ROOT = ":root[data-theme='dark']";

/**
 * The tokens of a look: the declarations of every `:root` block that applies always, later ones replacing earlier ones as in
 * the cascade, and for the dark look then those of the `:root[data-theme='dark']` block, which redefines existing names. A block
 * inside an `@media` (the reduced-motion `--dur-*`, the OS-dark copy of the dark block) is conditional, so it is left out.
 */
export function themeTokens(blocks: readonly Block[], look: Look): Map<string, string> {
  const tokens = new Map<string, string>();
  const take = (prelude: string): void => {
    for (const block of blocks) {
      if (block.prelude !== prelude || block.nested) continue;
      for (const [name, value] of declarations(block.inner)) tokens.set(name, value);
    }
  };
  take(':root');
  if (look === 'dark') take(DARK_ROOT);
  return tokens;
}

/**
 * `value` with each `var(--x)` replaced by the token's value, else by the fallback of `var(--x, fallback)`, again and again until
 * no `var()` is left. A name that is not a token and has no fallback throws, and so does a token that reads itself.
 */
export function resolveToken(tokens: ReadonlyMap<string, string>, value: string): string {
  const resolve = (text: string, reading: readonly string[]): string => {
    let out = '';
    let at = 0;
    for (let start = text.indexOf('var(', at); start >= 0; start = text.indexOf('var(', at)) {
      if (start > 0 && /[\w-]/.test(text.charAt(start - 1))) {                       // a name that ends in "var", not a var()
        out += text.slice(at, start + 4);
        at = start + 4;
        continue;
      }
      let depth = 0;
      let comma = -1;
      let close = -1;
      for (let i = start + 3; i < text.length && close < 0; i++) {
        const c = text.charAt(i);
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) close = i;
        else if (c === ',' && depth === 1 && comma < 0) comma = i;
      }
      if (close < 0) throw new Error(`"${text}" has a var() that is never closed`);
      const name = text.slice(start + 4, comma < 0 ? close : comma).trim();
      const own = tokens.get(name);
      let replacement: string;
      if (own !== undefined) {
        if (reading.includes(name)) throw new Error(`${name} reads itself: ${[...reading, name].join(' → ')}`);
        replacement = resolve(own, [...reading, name]);
      } else if (comma >= 0) {
        replacement = resolve(text.slice(comma + 1, close).trim(), reading);
      } else {
        throw new Error(`${name} is not a token, and var(${name}) has no fallback`);
      }
      out += text.slice(at, start) + replacement;
      at = close + 1;
    }
    return out + text.slice(at);
  };
  return resolve(value, []);
}
