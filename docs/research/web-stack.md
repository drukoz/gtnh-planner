# Web stack for the GTNH Line Planner — verified reference

Date: 2026-10-17 · Status: research result (input for the build plan)

This document checks the proposed web stack **by running it**: a throwaway probe app was built with exactly the
pinned versions below (Node server run as TypeScript with no build step, SQLite storage, SSE live updates, HiGHS solver,
React + Vite client with an ELK flow diagram and a three.js block view, uploads, vitest + Playwright). Everything in
"Evidence" blocks was run on the host (macOS 26.4 on Apple silicon, Node v24.10.0 from Homebrew, npm 11.6.4).

- `$WS` = the probe folder (`research/webstack/` in the session scratchpad). Paths like `probes/…`, `src/server/…`
  are relative to it. The probe is **not** part of this repo (it also holds local copies of mod textures, which must
  never be committed).
- "UNVERIFIED" marks anything that could not be checked here.
- World-specific numbers (backup sizes, GPU model, local paths) are rounded or omitted here; details are in
  `docs/local/research-webstack.md` (gitignored).

---

## 0. Verdict at a glance

| Piece | Choice | Pin | Verdict |
|---|---|---|---|
| Language | TypeScript, erasable syntax only | `typescript` **6.0.3** (7.0.2 also verified) | ✅ one tsconfig set serves Node, Vite, vitest |
| Server runtime | Node 24 built-in type stripping, `node:http` | Node `>=24.10 <25` | ✅ no build step; mind `requestTimeout` |
| Routing | hand-written router (or global `URLPattern`) | — | ✅ `URLPattern` works but is Stability 1 |
| Tiny framework? | Hono + `@hono/node-server` | 4.13.12 / 2.1.3 | ✅ works, **not clearly better** → not needed |
| Storage | `node:sqlite` `DatabaseSync` (WAL) | built into Node 24.10 | ✅ with an ExperimentalWarning to silence |
| Live updates | Server-Sent Events + `EventSource` | — | ✅ ~1–2 ms localhost latency; 6-connection limit |
| Client build | Vite 8 (Rolldown) + React 19 | `vite` 8.3.2, `react` 19.3.0, `@vitejs/plugin-react` 6.1.1 | ✅ build ~0.3 s |
| 3D view | three.js r186 | `three` 0.186.1, `@types/three` 0.186.0 | ✅ atlas **or** `DataArrayTexture`, 1 draw call |
| Flow layout | elkjs (layered) in a Web Worker → SVG | `elkjs` 0.12.0 | ✅ 60 nodes in ~90 ms |
| LP solver | HiGHS WASM | `highs` 1.15.3 (HiGHS 1.15.1) | ✅ 2,000 vars in ~5 ms; run it on the server |
| Zip (server) | yauzl | `yauzl` 3.4.0 | ✅ random access, constant memory |
| Zip (browser) | zip.js (only if users pick a whole world zip) | `@zip.js/zip.js` 2.22.1 | ✅ reads only the entries it needs |
| fflate | — | 0.8.3 | ⚠️ poor fit for big archives (keeps skipped data) |
| Uploads | raw `PUT` per file (no multipart) | — | ✅ simplest; busboy only if multipart is needed |
| Multipart | busboy | 1.6.0 (last release 2022) | ✅ works; 2 gotchas |
| Unit tests | vitest 5, two projects | `vitest` 5.0.3 | ✅ server tests run on Node's own type stripping |
| E2E | Playwright, Chromium | `@playwright/test` 1.63.0 | ✅ WebGL works headless |

**Replacements recommended:** drop fflate for world zips (use yauzl on the server and zip.js in the browser).
Prefer per-file raw `PUT` uploads over multipart, which makes busboy optional. Pin TypeScript 6.0.3 rather than 7.0.2,
for editor and lint compatibility. Everything else stays as proposed.

---

## 1. Version pins

Rule: published at least 14 days before 2026-10-17, i.e. **before 2026-10-03**. The newest stable version before that
cutoff was picked with `npm view <pkg> time dist-tags --json` (script `tools/pick-versions.mjs`). The whole tree was then
installed with npm's `--before` flag, so **transitive** dependencies obey the rule too.

| Package | Pin | Published | License | Notes |
|---|---|---|---|---|
| typescript | **6.0.3** | 2026-04-16 | Apache-2.0 | 7.0.2 (2026-07-08) also passes everything, see §2.6 |
| @types/node | 24.19.1 | 2026-10-01 | MIT | match Node major 24, not the 26.x `latest` |
| vite | 8.3.2 | 2026-10-01 | MIT | Rolldown-based; engines `^20.19.0 \|\| >=22.12.0` |
| @vitejs/plugin-react | 6.1.1 | 2026-08-28 | MIT | peer `vite ^8.0.0` |
| react, react-dom | 19.3.0 | 2026-09-09 | MIT | |
| @types/react, @types/react-dom | 19.3.0 | 2026-09-09 | MIT | |
| three | 0.186.1 | 2026-09-24 | MIT | ignore the bogus `1.58.1` (2013) that sorts highest by semver |
| @types/three | 0.186.0 | 2026-09-11 | MIT | |
| elkjs | 0.12.0 | 2026-07-17 | EPL-2.0 OR GPL-3.0-or-later | only non-permissive licence in the set; used unmodified |
| highs | 1.15.3 | 2026-09-11 | MIT | embeds HiGHS 1.15.1 |
| vitest | 5.0.3 | 2026-09-30 | MIT | engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |
| @playwright/test | 1.63.0 | 2026-09-04 | Apache-2.0 | Chromium 153.0.8010.12 (revision 1243) |
| yauzl / @types/yauzl | 3.4.0 / 3.4.0 | 2026-06-07 / 06-13 | MIT | |
| @zip.js/zip.js | 2.22.1 | 2026-10-02 | BSD-3-Clause | releases are frequent; 2.22.1 clears the cutoff by minutes |
| busboy / @types/busboy | 1.6.0 / 1.5.4 | 2022-04-19 / 2024-05-02 | MIT | optional (multipart only) |
| fflate | 0.8.3 | 2026-05-16 | MIT | test fixtures only |
| hono / @hono/node-server | 4.13.12 / 2.1.3 | 2026-09-30 / 09-29 | MIT | evaluated, not recommended |
| @fastify/busboy | 3.2.2 | 2026-08-21 | MIT | evaluated; keeps the old busboy 0.x API |
| @fontsource/pixelify-sans | 5.3.0 | 2026-07-19 | OFL-1.1 | Machine GUI restyle (design spec §5): headings, tabs, buttons; weights 400/600/700, bundled by Vite, no CDN; added 2026-10-23 with `--before=2026-10-09`, no transitive dependencies |
| @fontsource/inter | 5.3.0 | 2026-07-19 | OFL-1.1 | Machine GUI restyle (design spec §5): body text; weights 400/500/600/700; installed with the line above |

Evidence:
```text
$ node tools/pick-versions.mjs typescript@6 vite @vitejs/plugin-react react three@0 elkjs highs vitest @playwright/test yauzl @zip.js/zip.js @types/node@24 …
typescript@6   PIN 6.0.3 (2026-04-16)   latest 7.0.2 (2026-07-08)
vite           PIN 8.3.2 (2026-10-01)   latest 8.3.4 (2026-10-08)   newer-than-cutoff: 7.3.7, 8.1.6, 8.2.4, 8.3.3, 8.3.4
three@0        PIN 0.186.1 (2026-09-24) latest 0.186.1 (2026-09-24)
highs          PIN 1.15.3 (2026-09-11)  latest 1.15.4 (2026-10-16)
vitest         PIN 5.0.3 (2026-09-30)   latest 5.0.5 (2026-10-15)
@zip.js/zip.js PIN 2.22.1 (2026-10-02)  latest 2.24.0 (2026-10-16)
@types/node@24 PIN 24.19.1 (2026-10-01) latest 26.6.5 (2026-10-09)
$ npm install --save-exact --ignore-scripts --before=2026-10-03T00:00:00Z <all of the above>
added 70 packages … found 0 vulnerabilities
$ npm query ':attr(scripts, [install]), :attr(scripts, [postinstall]), :attr(scripts, [preinstall])'   → (nothing: no install scripts in the tree)
$ node tools/check-tree-dates.mjs tools/tree.txt
checked 70, after-cutoff 0, newest = @zip.js/zip.js@2.22.1 @ 2026-10-02T23:51:16.391Z
```
npm's own docs for `--before` (from `@npmcli/config` definitions, npm 11.6.4): *"If passed to `npm install`, will rebuild
the npm tree such that only versions that were available **on or before** the given date are installed."* npm 11.6.4
has no `min-release-age` setting (only `before`).

**Process for the repo:** add and upgrade dependencies with
`npm install --save-exact --before="$(date -v-14d +%F)" <pkg>@<ver>` (macOS `date`). Commit `package-lock.json`. Do
**not** put `before=` in `.npmrc`, because a fixed date would freeze all future installs.

Node itself: the host runs 24.10.0. The newest 24.x is **v24.22.0 (2026-10-14, LTS "Krypton")**
(<https://nodejs.org/dist/index.json>). Moving to the newest 24.x LTS is advisable for security fixes.
UNVERIFIED: the probes were not re-run on 24.22.0. Avoid an unplanned jump to Node 25/26 (e.g. via `brew upgrade`):
`node:sqlite` is still changing (§5). Use `engines: { "node": ">=24.10.0 <25" }` and/or `brew pin node`.

---

## 2. One package: layout, tsconfig, and how Node / Vite / vitest coexist

### 2.1 Layout (verified in the probe)

```
gtnh-planner/
├─ package.json            "type": "module", "imports": {"#shared/*": "./src/shared/*"}, engines, scripts
├─ package-lock.json       committed; generated with npm install --before=<today-14d>
├─ tsconfig.json           references only (editors + `tsc -b`)
├─ tsconfig.base.json      shared strict + erasable-only flags, noEmit
├─ tsconfig.server.json    nodenext, no DOM: src/server + src/shared + tests/unit + vitest.config.ts
├─ tsconfig.client.json    bundler + DOM + JSX, NO @types/node: src/client + src/shared
├─ tsconfig.e2e.json       nodenext + DOM lib (page.evaluate callbacks): tests/e2e + playwright.config.ts
├─ tsconfig.tools.json     vite.config.ts
├─ vite.config.ts          root src/client → dist/client; dev proxy /api → Node
├─ vitest.config.ts        projects: server (native Node runner) + client (Vite runner)
├─ playwright.config.ts    webServer = the real Node server serving dist/client
├─ src/shared/             pure TS used by both sides (types, GT math, plan model) — no node:*, no DOM
├─ src/server/             node:http, routes, SSE hub, node:sqlite, uploads, solver, world scanners (+ *.worker.ts)
├─ src/client/             index.html, React app, three.js view, ELK flow, Web Workers
├─ tests/unit/  tests/client/  tests/e2e/
├─ data/                   gitignored: SQLite DB, uploads, exported recipes, textures/icons
└─ dist/                   gitignored: Vite output
```

Add `data/`, `dist/`, `test-results/`, `playwright-report/` to `.gitignore`. Game-derived assets (textures, icons,
recipe exports) must live under `data/`, never in Vite's `publicDir`, because `publicDir` is copied into `dist/`.

### 2.2 package.json (scripts verified with `node --run <name>`)

```json
{
  "type": "module",
  "imports": { "#shared/*": "./src/shared/*" },
  "engines": { "node": ">=24.10.0 <25" },
  "scripts": {
    "dev:server": "node --watch --disable-warning=ExperimentalWarning src/server/main.ts",
    "dev:client": "vite",
    "build": "vite build",
    "start": "node --disable-warning=ExperimentalWarning src/server/main.ts",
    "typecheck": "tsc -b",
    "test": "tsc -b && vitest run",
    "e2e": "vite build && playwright test"
  }
}
```
Evidence:
```text
$ node --run typecheck            → exit 0
$ node --run test                 → Test Files 4 passed (4)   Tests 7 passed (7)
$ node --run e2e                  → ✓ built in 292ms   11 passed (5.8s)
$ node --watch tmp/watch/app.ts   (then edit the imported dep.ts)
run v=1
Restarting 'tmp/watch/app.ts'
run v=2
```
Production = `npm run build` once, then `npm start`. A single Node process serves `dist/client` and `/api`, so one port
needs forwarding, as the spec requires. In development run `dev:server` and `dev:client` side by side; Vite proxies
`/api` to Node (SSE included, §4.4).

### 2.3 tsconfig files (exact files that passed)

`tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "es2024",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noUncheckedIndexedAccess": true,
    "noUncheckedSideEffectImports": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```
`tsconfig.server.json`
```json
{ "extends": "./tsconfig.base.json",
  "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "lib": ["es2024"], "types": ["node"] },
  "include": ["src/server", "src/shared", "tests/unit", "vitest.config.ts"] }
```
`tsconfig.client.json`
```json
{ "extends": "./tsconfig.base.json",
  "compilerOptions": { "module": "esnext", "moduleResolution": "bundler", "lib": ["es2024", "dom", "dom.iterable"],
                       "jsx": "react-jsx", "types": ["vite/client"] },
  "include": ["src/client", "src/shared"] }
```
`tsconfig.e2e.json`: like server, plus `"lib": ["es2024", "dom", "dom.iterable"]`, including `tests/e2e` and
`playwright.config.ts`. `tsconfig.tools.json`: like server, including `vite.config.ts`. `tsconfig.json` has
`"files": []` and `references` to all four. With `noEmit` in every project, `tsc -b` works without `composite`
(verified with TS 6.0.3 and 7.0.2).

What each flag buys, with evidence: a planted file in `src/shared/bad.ts`, checked by `tsc -p tsconfig.server.json`:
```text
bad.ts(1,10): error TS1484: 'Tier' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
bad.ts(2,25): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './gt.js'?
bad.ts(3,13): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.     ← enum
bad.ts(4,30): error TS1294: …                                                                  ← parameter property
bad.ts(5,18): error TS1294: …                                                                  ← namespace
bad.ts(6,11): error TS1294: …                                                                  ← <number>x assertion
```
- The client config (bundler resolution) does **not** report the extensionless import (only TS1484 and TS1294 appeared).
  That is why `src/shared` must also be in the nodenext server project.
- The TS2835 message suggests `./gt.js`. Ignore that: Node's type stripping needs the real `.ts` name (§3).
- TS 6 and 7 no longer pick up installed `@types/*` automatically, so `@types/node` must be listed in `"types"`. With
  `@types/node` installed but no `types` field, both 6.0.3 and 7.0.2 report
  `error TS2591: Cannot find name 'process'. … add 'node' to the types field in your tsconfig.` `tsc --init` (7.0.2)
  writes `"types": []`.

Shared code stays browser-safe automatically, because the client project has no `@types/node`:
```text
# src/shared/leak.ts: import { readFileSync } from 'node:fs'; … process.pid
$ tsc -p tsconfig.client.json
leak.ts(1,30): error TS2591: Cannot find name 'node:fs'. Do you need to install type definitions for node? …
leak.ts(2,70): error TS2591: Cannot find name 'process'. …
$ tsc -p tsconfig.server.json  → exit 0
```

### 2.4 Coding rules that follow (all verified)

1. Every relative import names the real file: `import { x } from './plan.ts'` (also `./App.tsx` inside the client).
2. Type-only imports use `import type { … }` or the inline form `import { type Item, total }`.
3. No `enum`, `namespace` with code, constructor parameter properties, `import x = require()`, `export =`, `<T>expr`
   assertions, or decorators. Enum replacement (runs on Node, type-checks, catches typos):
   ```ts
   export const LogisticsMode = { Direct: 'direct', Routed: 'routed', AE2: 'ae2' } as const;
   export type LogisticsMode = (typeof LogisticsMode)[keyof typeof LogisticsMode];
   ```
   ```text
   $ node modes-check.ts → enum replacement under node: routed -> Project Red routed
   label('routd')        → error TS2345: Argument of type '"routd"' is not assignable to parameter of type 'LogisticsMode'.
   ```
   For a class, declare the field and assign it in the constructor: `readonly status: number; constructor(s: number) { super(); this.status = s; }`.
4. `src/client` may import only from `src/shared`, never from `src/server`. Wire types such as `ProjectSnapshot` live
   in `src/shared`. Importing `src/server/db.ts` into the client would drag `node:sqlite` into the browser build.
5. JSX only in `.tsx` under `src/client`: Node cannot run `.tsx` (§3).
6. `#shared/*` subpath imports are optional sugar. They resolve in Node, in `tsc` (nodenext and bundler), in Vite build
   and in both vitest projects (all verified). Plain relative imports also work everywhere.

### 2.5 vitest: run server tests on Node's own type stripping

By default vitest transforms TS with Vite, which accepts things Node rejects. **Tests can pass for code that crashes in
production**:
```text
$ npx vitest run            (default runner)
 ✓ |client| tests/client/enum-mismatch.test.tsx > vitest happily runs an enum that Node type stripping rejects
$ node probes/enum/mode.ts
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
```
vitest 5 can import test files natively (Node's loader, hence Node's type stripping), per project:
```ts
// vitest.config.ts — verified
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    execArgv: ['--disable-warning=ExperimentalWarning'], // node:sqlite warning in workers
    projects: [
      { extends: true, test: { name: 'server', include: ['tests/unit/**/*.test.ts'], environment: 'node',
                               experimental: { viteModuleRunner: false } } },   // = production semantics
      { extends: true, test: { name: 'client', include: ['tests/client/**/*.test.tsx'], environment: 'node' } },
    ],
  },
});
```
Evidence (same enum test placed in both projects):
```text
 ✓ |client| tests/client/enum-mismatch.test.tsx > vitest happily runs an enum that Node type stripping rejects
 ✓ |server| tests/unit/mock.test.ts > vi.mock in native mode
 FAIL  |server| tests/unit/enum-mismatch.test.ts
SyntaxError: TypeScript enum is not supported in strip-only mode
```
- vitest's own doc comment (`node_modules/vitest/dist/chunks/plugin.d.*.d.ts`): *"Controls whether Vitest uses Vite's
  module runner to run the code or fallback to the native `import`."* It sits under `experimental`, so re-check it on
  vitest upgrades. `tsc -b` in `npm test` is the second safety net (TS1294).
- `vi.mock` still works in native mode (test above). vitest uses `module.registerHooks`; its source warns for Node
  < 22.15.
- `node:sqlite` loads fine inside vitest (default runner and native).
- Keep vitest's `include` away from `tests/e2e/*.spec.ts`. vitest's default glob also matches `*.spec.ts` and would try
  to run the Playwright files (`vitest/dist/config.cjs:15: defaultInclude = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"]`).
- The whole unit suite runs in ~0.1 s (`Duration 87ms … 111ms`).

### 2.6 TypeScript 6.0.3 vs 7.0.2

Both gave identical results on every config and on the planted errors (3×TS1294, TS1484, TS2835 each).

| | 6.0.3 | 7.0.2 (native Go compiler) |
|---|---|---|
| `tsc -b --force` on the probe | 0.93 s | 0.24 s |
| `tsserver.js` / JS API (`typescript.js`) in the package | yes | **no** (`lib/` has only `tsc.js`, `getExePath.js`, `version.cjs`; API only under `typescript/unstable/*`) |
| typescript-eslint 8.71.0 | ✅ peer `"typescript": ">=4.8.4 <6.1.0"` | ❌ outside peer range |

**Pin 6.0.3**: editors (`tsserver.js`) and lint tooling work with it. Switching to 7 later is a one-line change, and the
same tsconfig files pass. UNVERIFIED: how VS Code behaves with TS 7 as the workspace version.

---

## 3. Node 24 running TypeScript directly (type stripping)

Status: Node docs v24.10.0, <https://nodejs.org/docs/v24.10.0/api/typescript.html>: *"Stability: 1.2 - Release
candidate"*. History: *"v24.3.0: Type stripping no longer emits an experimental warning."*,
*"v23.6.0: Type stripping is enabled by default."*

```text
$ node ok.ts                     (types, `satisfies`, generics, `as`, `import type`, #shared import, import.meta.filename)
ok 5 LV,MV,HV 42 x true strip
$ node ok.ts 2>&1 >/dev/null     → (empty: no warning on stderr)
$ node -p "process.features.typescript"   → strip
$ node probes/meta.ts            → import.meta.main = true dirname ok: string   (false when imported)
```

Rejected syntax: every error is thrown at **load time** of the module.

| Syntax | Error on Node 24.10.0 |
|---|---|
| `enum E { A }` / `const enum` | `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode` |
| `namespace N { export const x = 1 }` | `… TypeScript namespace declaration is not supported in strip-only mode` |
| `constructor(private x: number)` | `… TypeScript parameter property is not supported in strip-only mode` |
| `import fs = require('node:fs')` | `… TypeScript import equals declaration is not supported in strip-only mode` |
| `export = 1` | `… TypeScript export assignment is not supported in strip-only mode` |
| `<number>expr` | `… The angle-bracket syntax for type assertions, <T>expr, is not supported in type strip mode. Instead, use the 'as' syntax` |
| `@dec m() {}` (decorator) | `SyntaxError: Invalid or unexpected token` |
| `declare namespace D {…}`, `abstract class` | fine (both run) |

Imports and files:

| Case | Result |
|---|---|
| `import { total } from './types'` (no extension) | `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/types'` |
| `import … from './types.js'` for a `.ts` file (tsc style) | `ERR_MODULE_NOT_FOUND` (Node does not map `.js`→`.ts`) |
| `import { Item, total }` where `Item` is an interface | `SyntaxError: The requested module './src/shared/types.ts' does not provide an export named 'Item'` |
| `import { type Item, total }` | works |
| tsconfig `paths` alias `@shared/…` | `ERR_MODULE_NOT_FOUND: Cannot find package '@shared/types.ts'`; use `package.json` `"imports"` (`#shared/*`) |
| `.ts` inside `node_modules` | `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` |
| `node x.tsx` | `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".tsx"` |
| `import p from './package.json' with { type: 'json' }` | works |
| `new Worker(new URL('./scan.worker.ts', import.meta.url))` | works (worker entry is stripped too, §5.4) |

Node docs (same page): *"Node.js ignores `tsconfig.json` files and therefore features that depend on settings within
`tsconfig.json`, such as paths or converting newer JavaScript syntax to older standards, are intentionally
unsupported."*, and *"`.tsx` files are unsupported."* Type stripping never type-checks; `tsc -b` does that.
`--experimental-transform-types` (enums etc.) exists but is not needed: stay erasable.

---

## 4. HTTP server and live updates

### 4.1 `node:http` is enough; Hono is optional

The probe server is `src/server/main.ts` (133 lines) plus `db.ts`, `sse.ts`, `uploads.ts`, `static.ts` and
`solve.ts`, about 440 lines in all. It covers cookie login with one shared password, JSON routes,
static `dist/client` with SPA fallback, SSE, raw-`PUT` and multipart uploads, and a `/api/solve` route. It runs with
`node src/server/main.ts` and with Playwright's `webServer`.

```text
$ node --disable-warning=ExperimentalWarning probes/http-probe.ts
health 200
unauthenticated project -> 401
wrong password -> 401
login -> 200 cookie attrs: HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000
sse status 200 text/event-stream; charset=utf-8 cache-control: no-cache, no-transform transfer-encoding: chunked
tick PUT -> { rev: 1, listeners: 1 }
tick frame after 1.2 ms: "event: tick\nid: 1\ndata: {\"rev\":1,\"row\":\"build/steel-furnace\",\"by\":\"Alex\",\"done\":true}"
heartbeat frame: ": ping"
listeners after client abort: 0
raw PUT 64 MiB -> 67108864 bytes in 75 ms, sha ok: true
.hidden name -> 400
multipart -> level.dat:1234, r.0.0.mca:5242880 in 13 ms
static traversal -> 403
solve -> {"status":"optimal","objective":64,"runs":{"smelt":64},"raw":{"ore":64}}
```
Routing: `URLPattern` is a global in Node 24.10, with no runtime warning:
```text
$ node -e "…new URLPattern({pathname:'/api/projects/:id/ticks/:row'}).exec({pathname:'/api/projects/p1/ticks/r%2F2'})…"
URLPattern: function   { row: 'r%2F2', id: 'p1' }        ← groups are NOT decoded: decodeURIComponent() them
```
However, the Node docs (url.html, v24.10.0) mark the `URLPattern` class *"Stability: 1 - Experimental"*. A 10-line
regex router (`'/api/projects/:id'` → `^/api/projects/([^/]+)$`) avoids depending on it. Either is fine at our ~20
routes.

**Hono 4.13.12 + @hono/node-server 2.1.3** were verified under type stripping. `streamSSE` frames are correct, and
`serve({ fetch, serverOptions: { requestTimeout: 0 } })` passes Node server options through. The raw request is
`c.env.incoming` (needed for busboy). Throughput is the same as plain `node:http`:
```text
$ node probes/hono/hono-probe.ts      hono web body stream: 256 MiB in 183–224 ms;  node body stream: 124–192 ms
$ node probes/http-baseline.ts        node:http body stream: 256 MiB in 134–182 ms
```
Verdict: **not clearly better** for one small app. Start with `node:http`, and move to Hono if routes or middleware
multiply. It is a drop-in that works with type stripping.

### 4.2 Timeouts (important for 1 GB uploads)

```text
$ node -e "…createServer()…"  → { requestTimeout: 300000, headersTimeout: 60000, keepAliveTimeout: 5000, timeout: 0 }
$ node probes/timeout-probe.ts        (upload sends 64 KiB every 0.5 s for 5 s; SSE stream held open 5 s)
requestTimeout=2000: 5 s slow upload -> HTTP 408 ; SSE after 5s -> still open, last bytes at 5.0 s
requestTimeout=0:    5 s slow upload -> HTTP 200 {...}; SSE after 5s -> still open, last bytes at 5.5 s
```
Node docs (http.html, v24.10.0): `server.requestTimeout` *"Default: `300000` … Sets the timeout value in milliseconds
for receiving the entire request from the client. If the timeout expires, the server responds with status 408 …"*.
`connectionsCheckingInterval` *"Default: `30000`"*.

- At the default 5 minutes, any upload taking longer is cut off. A 1 GB world at ~25 Mbit/s upstream needs ~5.5 min.
  Set `createServer({ requestTimeout: 0 })`, or a generous value such as 2 h. The same docs warn that a non-zero value
  protects against DoS when there is no reverse proxy; with a shared password and a handful of users, a long value
  such as 2 h is a reasonable middle ground.
- SSE streams are **not** affected by `requestTimeout`: the GET request has been fully received.
- `server.close()` waits for open SSE responses **forever**. Call `server.closeAllConnections()` (or end every SSE
  response) on shutdown:
  ```text
  $ node probes/server-edge.ts
  server.close() with open SSE, after 2 s -> still waiting
  after closeAllConnections() -> close callback fired
  ```
- When Node itself answers 408, the handler's `pipeline(req, file)` rejects with `Error: aborted` / `ECONNRESET`.
  Treat that as a client abort, not a 500, and delete the partial file. The probe stores to a `.part` file and renames
  on success.

### 4.3 SSE: server and client (verified code)

Server (`src/server/sse.ts`, trimmed):
```ts
res.writeHead(200, {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',   // no-transform: proxies must not compress/alter
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',                   // nginx-style proxies: don't buffer
});
res.write('retry: 2000\n\n');                  // reconnect delay hint
res.write(`event: snapshot\nid: ${rev}\ndata: ${JSON.stringify(snapshot)}\n\n`); // full state on every (re)connect
clients.add(res); req.on('close', () => clients.delete(res));
// on change:      res.write(`event: tick\nid: ${rev}\ndata: ${JSON.stringify(change)}\n\n`)
// every 20 s:     res.write(': ping\n\n')     // comment line keeps NAT/proxy idle timers alive
```
Client (`src/client/useProject.ts`, trimmed):
```ts
useEffect(() => {
  const es = new EventSource(`/api/projects/${encodeURIComponent(id)}/events`); // same origin → auth cookie is sent
  es.addEventListener('snapshot', (e) => setSnap(JSON.parse(e.data)));
  es.addEventListener('tick', (e) => applyIfNewer(JSON.parse(e.data)));        // ignore rev <= current
  es.addEventListener('error', () => setConnected(false));                      // EventSource retries by itself
  return () => es.close();
}, [id]);
```
Measured (Playwright, two separate browser contexts on one machine):
```text
SSE latency over 20 ticks: median 1.0 ms, max 3.5 ms        (second run: median 2.2 ms, max 9.4 ms)
reconnected 2289 ms after restart                            (server sent retry: 2000)
snapshots seen by the page: [{"rev":0,"lastEventIdSentByBrowser":null},{"rev":1,"lastEventIdSentByBrowser":"1"}]
```
- After a server restart the page reconnects on its own, sends `Last-Event-ID`, and gets a fresh snapshot. The tick
  ticked before the restart came back from SQLite (test `tests/e2e/reconnect.spec.ts`).
- Design rule: **send the full project snapshot on every connect**, then small deltas with `id: <rev>`. That makes
  `Last-Event-ID` informational and avoids replay buffers.

### 4.4 SSE gotchas

1. **6 connections per origin on HTTP/1.1, across all tabs.** Proven in Chromium:
   ```text
   connection limit {"withSix":"pending after 3000 ms","afterClose":"fetch 200","ms":1}
   ```
   With six `EventSource`s open, even a plain `fetch` to the same origin hangs until one closes. MDN
   (<https://developer.mozilla.org/en-US/docs/Web/API/EventSource>): *"When not used over HTTP/2, SSE suffers from a
   limitation to the maximum number of open connections, which can be specially painful when opening various tabs as
   the limit is per browser and set to a very low number (6). … This limit is per browser + domain …"* Keep exactly
   **one EventSource per tab** (one per open project). Consider closing it when the tab is hidden, or sharing it via
   `BroadcastChannel`. HTTP/2 would lift the limit but needs TLS in browsers, so it is not worth it for a home server.
2. **No custom headers on `EventSource`.** MDN (EventSource constructor) lists only `withCredentials`. Use cookie auth
   (verified: the stream needs the login cookie), not an `Authorization` header.
3. **Proxies.** Through Vite's dev proxy SSE streams unbuffered:
   ```text
   via vite proxy: 200 text/event-stream; charset=utf-8 content-encoding: null
   frames received: retry: 2000 | event: snapshot | event: tick | : ping | : ping | : ping
   tick arrived through proxy after 6.9 ms
   ```
   nginx (<https://nginx.org/en/docs/http/ngx_http_proxy_module.html>): *"Buffering can also be enabled or disabled by
   passing "yes" or "no" in the "X-Accel-Buffering" response header field."* Caddy's `reverse_proxy` docs say
   *"responses are flushed immediately to the client if one of the following applies"*, listing
   `Content-Type: text/event-stream`. Never put a compression middleware in front of `text/event-stream`.
   Friends reach the port directly (port forward), so no proxy is involved by default.
4. **Idle connections.** Heartbeat comments every 20 s are a convention. UNVERIFIED: the actual idle timeout of the
   router/NAT between friends and the host.
5. **Vite dev server binds to `localhost`, which resolved to IPv6 only here:** `lsof … → vite listens on [::1]:5173`.
   `fetch('http://127.0.0.1:5173/api/login')` failed with `connect ECONNREFUSED 127.0.0.1:5173`, while
   `http://localhost:5173` worked. Vite docs (`server.host`):
   default `'localhost'`, and *"browsers may use a different resolved address than the one Vite is listening to"*. Use
   `localhost` URLs in dev, or set `server.host: '127.0.0.1'`.
6. React StrictMode runs effects twice in dev. The cleanup `es.close()` handles it. UNVERIFIED in the probe, which had
   no StrictMode.

### 4.5 Uploads: raw `PUT` per file (preferred) and multipart (optional)

Preferred flow: the browser sends only the files the scanner needs, each as
`fetch('/api/uploads/<name>', { method: 'PUT', body: fileOrBlob })`. The server streams to disk with a byte limit and a
sha256, so memory stays constant. Both ways for a friend to pick their world were verified in Chromium:
```text
# whole world zip → zip.js reads the central directory with File.slice() and extracts only matching entries
zip upload {"ms":27,"zipBytes":24317622,"uploaded":["level.dat:200000","r.0.0.mca:3145728"]}
# <input type="file" webkitdirectory> → pick the world folder, filter by webkitRelativePath
folder upload {"all":["World/level.dat","World/session.lock","World/region/r.-1.0.mca"],"uploaded":["level.dat:1000","r.-1.0.mca:8192"]}
```
Server side (`src/server/uploads.ts`, trimmed):
```ts
export async function storeRawBody(req: IncomingMessage, dir: string, name: string, limit: number) {
  const finalPath = join(dir, safeName(name));           // ^[A-Za-z0-9._-]{1,128}$, basename only, no leading dot
  const tmp = join(dir, `.${randomUUID()}.part`);
  try { await pipeline(req, meter(limit, hash, counter), createWriteStream(tmp)); await rename(tmp, finalPath); }
  catch (e) { await rm(tmp, { force: true }); throw e; }
}
```
busboy 1.6.0 (only if a classic multipart form is wanted) works, with two gotchas found while testing:
- **Check `stream.truncated` after the pipeline, not only a `'limit'` listener.** A listener attached after an `await`
  missed the event, and the probe silently stored a truncated file with HTTP 200. After the fix:
  `busboy over-limit -> 413 r.0.0.mca exceeds 1000 bytes | partial file left on disk: false`. busboy's README: *"…
  `stream` will both have a boolean property `truncated` set to `true` (best checked at the end of the stream) and emit
  a `'limit'` event …"*.
- **A file stream you don't read stalls busboy forever.** Call `stream.resume()` for rejected files. busboy's README
  also warns about `filename`: *"You should almost never use this value as-is …"*.
- `@fastify/busboy` 3.2.2 is maintained but keeps the old constructor API
  (`module.exports = Busboy; … module.exports.Busboy = Busboy`), so it is not a drop-in replacement.

---

## 5. Storage: `node:sqlite` (`DatabaseSync`)

Status: Node docs (sqlite.html, v24.10.0): *"Stability: 1.1 - Active development."* and *"This module is only available
under the `node:` scheme."* Loading it prints a warning:
```text
(node:36655) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```
Silence it with `node --disable-warning=ExperimentalWarning …`. Verified as a flag and via
`NODE_OPTIONS=--disable-warning=ExperimentalWarning`; vitest uses `execArgv`, Playwright the `webServer.command`.

### 5.1 Minimal usage (verified)

```ts
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; CREATE TABLE IF NOT EXISTS …`);
const ins = db.prepare('INSERT INTO project (id, name, state) VALUES ($id, $name, $state)');
ins.run({ $id: 'p1', $name: 'Steel line', $state: JSON.stringify({ tier: 'MV' }) });
ins.run({ id: 'p2', name: 'Circuit line', state: '{}' });   // bare names OK (allowBareNamedParameters defaults to true)
const row = db.prepare("SELECT id, state ->> '$.tier' AS tier FROM project WHERE id = ?").get(id);
// no db.transaction() helper:
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
}
```
```text
$ node probes/sqlite-probe.ts
exports: DatabaseSync,Session,StatementSync,backup,constants,default
DatabaseSync methods: open,close,prepare,exec,function,createTagStore,location,aggregate,createSession,applyChangeset,enableLoadExtension,loadExtension,setAuthorizer,constructor
StatementSync methods: iterate,all,get,run,columns,setAllowBareNamedParameters,setAllowUnknownNamedParameters,setReadBigInts,setReturnArrays,constructor
journal_mode -> [Object: null prototype] { journal_mode: 'wal' }
run() -> { lastInsertRowid: 1, changes: 1 }
100k inserts in one transaction: 117 ms
OK   CREATE VIRTUAL TABLE item_fts USING fts5 …        fts5 match 'stee*' -> Steel Ingot, Stainless Steel Plate
OK   CREATE VIRTUAL TABLE rt USING rtree(…)            OK SELECT sqrt(16)
sqlite.backup pages -> 1250                            using ok, open = true
```

### 5.2 Gotchas

| Gotcha | Evidence |
|---|---|
| Rows have a **null prototype**. `toEqual` passes, but `toStrictEqual` and `assert.deepStrictEqual` fail. Spread (`{ ...row }`) before comparing or sending | `get() -> [Object: null prototype] {…} prototype is null: true`; vitest test "toStrictEqual on raw row" fails as expected |
| Booleans cannot be bound: use 0/1 | `bind boolean -> Provided value cannot be bound to SQLite parameter 4.` |
| Integers > 2^53 throw unless `stmt.setReadBigInts(true)` | `Value is too large to be represented as a JavaScript number: 9007199254740993` → `9007199254740993n` |
| No transaction helper (unlike better-sqlite3) | use `tx()` above; `db.isTransaction` → `true` inside `BEGIN` |
| API still moving: the docs call the statement cache `database.createSQLTagStore()` (*"Added in: v24.9.0"*), but 24.10.0 and `@types/node` 24.19.1 have **`createTagStore`** | `createTagStore: function \| createSQLTagStore: undefined`; `@types/node/sqlite.d.ts:664 createTagStore(maxSize?: number): SQLTagStore;` Avoid it, or wrap it behind our own `db.ts` |
| Synchronous: every query blocks the event loop | keep queries small; run long scans in `worker_threads` (§5.4) |
| The SQLite library differs by Node build: Homebrew's Node links Homebrew's shared `libsqlite3` (3.53.x here), while nodejs.org binaries bundle 3.50.4 | `otool -L $(which node)` → `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`; `select sqlite_version()` → `3.53.4`; `deps/sqlite/sqlite3.h@v24.10.0`: `#define SQLITE_VERSION "3.50.4"` |
| FTS5, RTREE, JSON (`->>`), math functions are available in both builds | runtime checks above; `deps/sqlite/sqlite.gyp@v24.10.0` defines `SQLITE_ENABLE_FTS5`, `SQLITE_ENABLE_RTREE`, `SQLITE_ENABLE_MATH_FUNCTIONS`, `SQLITE_ENABLE_SESSION`, … |

Keep all DB access in one module (`src/server/db.ts`) so API changes in later Node versions stay local. Use
`sqlite.backup(db, path)` for snapshots of the project DB: it returns a Promise of pages copied (Node docs: *"Added in:
v23.8.0"*). This serves the "never lose shared progress" anti-goal.

### 5.3 Why not better-sqlite3

Not needed. `node:sqlite` covers WAL, prepared statements, FTS5, backup and user functions with zero native build
steps. Revisit only if a later Node version breaks the API.

### 5.4 Worker threads in TypeScript (for slow world scans)

```text
$ node --disable-warning=ExperimentalWarning probes/workers/main.ts
worker (.ts entry) result: {"spun":true,"ticksSeenByWorker":140,"plan":"optimal"} | main thread: 143 SQLite writes during the 1.5 s worker job, max event-loop lag 1.6 ms
```
`new Worker(new URL('./scan.worker.ts', import.meta.url), { workerData })` works with type stripping. The worker opened
its own `DatabaseSync(file, { readOnly: true })` and saw the main thread's WAL commits; HiGHS also ran inside it. A
1.5 s CPU job in the worker left the main thread's event loop free. This is the pattern for the spec's anti-goal
"slow scans must not freeze the app".

---

## 6. LP solver: HiGHS (`highs` 1.15.3 → HiGHS 1.15.1)

`highs` README: *"The package major and minor version match the embedded HiGHS version."*; *"This WebAssembly build is
single-threaded."*; and on models: *"Garbage collection does not call `Highs_destroy`, so abandoning a model without
disposing it leaks that allocation."*

### 6.1 Import gotcha under `nodenext` (types vs runtime disagree)

`highs` ships one CommonJS-flavoured `types.d.ts` for both `import` and `require`. Under `module: nodenext` TypeScript
therefore types the default import as the module object, while Node actually loads `build/highs.mjs`, whose default
export *is* the loader:
```text
probes/highs-import/ns.ts(3,17): error TS2349: This expression is not callable.
  Type 'typeof import(".../node_modules/highs/types")' has no call signatures.
(import * as m from 'highs'; m.default() → same error; under moduleResolution "bundler" it type-checks)
```
Fix used in the probe (type-checks and runs):
```ts
import highsDefault from 'highs';
const loadHighs = highsDefault as unknown as typeof highsDefault.default;
```
The same thing happens with `elkjs` in Node (`TS2351: This expression is not constructable`, §7).

### 6.2 Minimal usage: sparse CSC model (no LP-text naming rules)

Model used for the measurements: columns = recipe runs `x_r` plus raw purchases `b_i` (cost = editable material cost);
rows = item balances `Σ out − Σ in + b_i ≥ demand_i`; minimize `Σ cost_i·b_i`.
```ts
const highs = await loadHighs();
const plan = highs.withModel({                // disposes the Wasm model even on throw
  numCols, numRows, sense: highs.constants.objectiveSense.minimize,
  colCost: Float64Array, colLower: Float64Array /*0*/, colUpper: Float64Array /*highs.infinity*/,
  rowLower: Float64Array /*demand*/, rowUpper: Float64Array /*highs.infinity*/,
  matrix: { format: 'csc', numRows, numCols, starts: Int32Array, indices: Int32Array, values: Float64Array },
}, (m) => {
  m.options.set({ output_flag: false });
  m.run();
  return { status: m.getModelStatus(), objective: m.getObjectiveValue(), x: m.getSolution().colValue };
});
// compare status with highs.constants.modelStatus.optimal / .infeasible
```

### 6.3 Performance and memory (synthetic GTNH-like graph, Node 24, main thread)

```text
$ node probes/highs-bench.ts
HiGHS version { major: 1, minor: 15, patch: 1, string: '1.15.1', gitHash: '04024d7' } memoryBytes at load 21233664
CSC model: 2000 cols x 1200 rows, nnz=6737; build 4.4 ms; first solve 30.1 ms; status=optimal …
LP text: 116 KiB, longest line 6893 chars; build 3.8 ms; highs.solve 19.3 ms; Status=Optimal obj=691818.667   (same optimum)
300 repeated solves (fresh model each, withModel): median 4.5 ms, p95 5.1 ms; memoryBytes now 21233664; rss 196 MiB
after 300 legacy highs.solve(lpText): memoryBytes 21233664; rss 239 MiB
4x model (~8000 cols): 24.6 ms status=optimal
infeasible case -> infeasible
        270991360  maximum resident set size   (whole benchmark process)
```
- ~2,000 variables is trivial: ~5 ms per solve, and Wasm memory stays flat (21 MB) over 600 solves. Re-solving on every
  edit (recipe swap, cost change) is fine, so run the solver **on the server** next to the shared project state.
  Use a worker thread only if real models get much bigger (§5.4 shows `solve()` inside a worker).
  As built (plan 12 fix wave 3, architecture §11 entry 39): one solver thread per process (`solveLpAside`, lp.ts, with
  its own HiGHS runtime) solves the leanest line's build MIP while `buildStage` solves plan 09's plan on the main thread,
  so a build-cost plan waits for the longer of the two solves, not their sum; the thread starts on first use, holds the
  process open only while a job is pending, and the main thread solves the model itself wherever the thread cannot.
- Statuses differ between the two APIs. `model.getModelStatus()` returns a number; compare it with
  `highs.constants.modelStatus.*` (`{"notSet":0,…,"optimal":7,"infeasible":8}`, and `getModelStatus() -> 7 number`).
  The legacy `highs.solve()` returns strings such as `'Optimal'` and `'Infeasible'`.
- **Lexicographic objectives** work (`passLinearObjectives`, higher `priority` first), e.g. least raw material first,
  then fewest recipe runs:
  `lexicographic (raw first, then fewest runs) -> { 'r:cheap_slow': 0, 'r:cheap_fast': 5, 'r:pricy': 0, 'b:ore': 5, 'b:gold': 0 }`.
- **Data errors become "free material".** A loop like `A → 2B`, `B → A` lets the LP make items from nothing:
  `free-lunch loop -> optimal objective 0 raw {} runs { split: 64, merge: 64 }`. Cheap guard (4 ms on the 2,000-column
  model): fix every purchase column to 0, including the free ones such as water and cobble, and solve again. If the
  demand can still be met, flag the recipe data:
  ```text
  $ node probes/free-lunch.ts
  split/merge loop -> SUSPICIOUS: demand met with zero raw input
  honest smelting -> ok (needs raw input)
  synthetic 2000-col model -> ok (needs raw input) (4.2 ms)
  ```
  UNVERIFIED: behaviour on the real exported GTNH recipe set (only synthetic graphs were used).

### 6.4 In the browser (verified, in case it is ever wanted client-side)

```ts
// src/client/solver.worker.ts (trimmed)
import highsLoader from 'highs';
import wasmUrl from 'highs/runtime?url';          // package export "./runtime" → build/highs.wasm (hashed asset)
const ready = highsLoader({ locateFile: () => wasmUrl });
self.onmessage = async (e) => { const h = await ready; self.postMessage(h.solve(e.data, { output_flag: false })); };
```
```text
solver {"status":"Optimal","objective":24,"ms":17.3,"version":"1.15.1"}          (Playwright, built app and Vite dev)
dist/client/assets/highs-*.wasm   3,531.38 kB │ gzip: 1,231.00 kB
[plugin rolldown:vite-resolve] Module "node:module" has been externalized for browser compatibility, imported by ".../highs/build/highs.mjs"
```
That warning is harmless: the import sits behind `if(ENVIRONMENT_IS_NODE){const{createRequire}=await import("node:module")…`.
Serve `.wasm` as `application/wasm` (the probe's static handler does).

Alternatives (not tested, UNVERIFIED): `yalps` 0.6.4 (pure TS LP/MIP), `glpk.js` 5.0.0 (GPL), `javascript-lp-solver`
1.0.3. None is needed given the numbers above.

---

## 7. Flow diagram: elkjs 0.12.0 → SVG

Browser, in a Web Worker (verified in the production build and in Vite dev):
```ts
import ELK from 'elkjs/lib/elk-api.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';   // copied as a plain asset; ELK starts it as a classic Worker
const elk = new ELK({ workerUrl: elkWorkerUrl });
const laid = await elk.layout({
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
                   'elk.layered.spacing.nodeNodeBetweenLayers': '60' },
  children: steps.map((s) => ({ id: s.id, width: 160, height: 56 })),
  edges: flows.map((f) => ({ id: f.id, sources: [f.from], targets: [f.to] })),
});
// render: <rect> at (child.x, child.y); <path d="M start L bend… L end"> from edge.sections[*]; arrow via <marker>
```
```text
flow {"ms":86,"nodes":60,"edges":59}            (Playwright: 60 <rect>s rendered in the SVG)
dist/client/assets/elk-worker.min-*.js   1,595.33 kB
```
- Raw materials on the left and the target on the right come from `elk.direction: RIGHT` (layered algorithm). Edge
  routes come back as `sections[]` with `startPoint`, `bendPoints`, `endPoint`.
- In Node, `new ELK()` runs the layout in-process: `main.js` uses the "fake worker" from `elk-worker.min.js` unless the
  optional `web-worker` package is installed. Timings on the main thread with port-free nodes:
  `n=30: 124 ms (first call) · n=120 nodes/181 edges: 158 ms · n=300 nodes/460 edges: 441 ms`. That is fine for tests;
  do layout in the browser worker.
- Types in Node under `nodenext`: `TS2351: This expression is not constructable`. Same cause and same cast as for
  highs (§6.1). In the client (bundler resolution) the types work as-is.
- License: EPL-2.0 OR GPL-3.0-or-later (`elkjs/package.json`). Fine to depend on unmodified from an MIT repo; no
  copying of ELK source.

### 7.1 Ports, import stubs and supporting lines (amended by plan 09, fix spec §6.2)

The flow diagram (`src/client/views/flow-model.ts` `toElk`/`fromElk`) now lays out boxes that list the goods they take
and make as rows, with these options on top of the snippet above (verified in Node with `elk.bundled.js`, 2026-10-19):
```ts
// root: the snippet's four options plus
'elk.hierarchyHandling': 'INCLUDE_CHILDREN',                  // an open supporting line is a compound node holding its boxes
'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', // children and edges are sorted by id
// every box: one port per row, fixed on the box's edge and centred on the row
{ id, width, height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
  ports: [{ id: '<node>|in|<key>', x: -2, y: rowCentre - 1, width: 2, height: 2, layoutOptions: { 'elk.port.side': 'WEST' } },
          { id: '<node>|out|<key>', x: width, y: rowCentre - 1, width: 2, height: 2, layoutOptions: { 'elk.port.side': 'EAST' } }] }
// edges run port to port; a rate label only where a port has 2+ edges, as an end label at that port
{ id, sources: [fromPort], targets: [toPort], labels: [{ text, width, height, layoutOptions: { 'elk.edgeLabels.placement': 'HEAD' } }] }
```
- **Arrows start and end on their row.** With `FIXED_POS` ports ELK ends each edge section at its port's centre (the
  y of the row exactly; x 2 px outside the box), so `fromElk` reads the good of an arrow from the row it leaves.
- **Imports beside their step.** Import stubs (one per good and consumer) get no layer constraint: the default
  network-simplex layering puts a source with one edge in the layer just before its consumer, and ELK aligns a node with
  only outgoing edges to the right of its layer. A node with edges in and out is centred in its layer, so a narrow step
  in a layer with a wide one sat 129 px from its stub; `'elk.alignment': 'LEFT'` on steps (and collapsed lines) puts
  every stub 64 px (the 60 px layer spacing plus the ports) before its step. The toolbar's "Imports in one column" puts
  `'elk.layered.layering.layerConstraint': 'FIRST'` back on the stubs; the target keeps `LAST`.
- **Labels.** A centre label (`CENTER`, the default) becomes a label dummy node in a layer of its own: the one labelled
  import edge in the probe moved its stub 458 px away. End labels (`HEAD` when the target port has the other edges, else
  `TAIL`) take no layer; the gap between two layers grows by the widest end label in it (a 40 px label: 64 → 106 px).
- **Compound nodes.** A child's `x`/`y` are relative to its parent, and an edge comes back with `container` (the lowest
  common ancestor of its ends): its sections and its labels are relative to that node, so `fromElk` adds the
  container's position. Edges may all be declared on the root.
- Timings (Node, `new ELK()`, main thread, synthetic lines with three inputs per step): 61 boxes / 88 edges / 148
  ports with 5 open lines: 110 ms (first call); 121 / 178 / 298: 72 ms; 241 / 358 / 598 with 20 open lines: 112 ms;
  the same with the lines collapsed: 32–97 ms.

---

## 8. 3D view: three.js r186 with real block textures

Probe (`src/client/View3D.tsx`): it loads 600 real GregTech block PNGs, extracted locally from the pack's jar for the
test, and draws them twice. A) Merged geometry with UVs into a **2D atlas**. B) One `InstancedMesh` whose per-instance
`layer` attribute indexes a **`DataArrayTexture`**. Result (Playwright, headless Chromium):
```text
three {"textures":600,"loadMs":129,"atlasSize":512,"webgl2":true,
       "renderer":"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) …), SwiftShader driver)",
       "maxTextureSize":8192,"maxArrayLayers":2048,"drawCalls":2,"triangles":14400,
       "nonBlankLeft":22432,"nonBlankRight":22590,"pickAtlasCube":300,"pickInstance":324,"glError":0}
colour check: avgLeft [133,122,121] vs avgRight [133,122,122]    (atlas vs array: same colours)
```
Texture facts that shape the design (all 3,058 block PNGs in the GT jar, read with `tools/png_sizes.py`):
```text
pngs 3058 with .mcmeta (animated) 739
2291 (16, 16)      ← static 16×16
191 ('anim', 16, 32)  155 ('anim', 16, 4)  111 ('anim', 16, 31) …   ← vertical strips, 16 px wide, N frames
17 (64, 64)
```
So normalise every texture to a **16×16 tile = frame 0**:
`createImageBitmap(blob, 0, 0, w, min(w, h), { resizeWidth: 16, resizeHeight: 16, resizeQuality: 'pixelated' })`.

Recommended: **`DataArrayTexture` + one `InstancedMesh` per block shape**. There is no atlas maths and no bleeding, the
layer is chosen per instance, and `raycaster.intersectObject(mesh)[0].instanceId` gives the hovered block directly.
The 2D atlas also works (1 px extruded gutters, `NearestFilter`, no mipmaps). Picking there goes through
`faceIndex / 12`.

Limits: Khronos ES 3.0 `glGet` (WebGL2 baseline,
<https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glGet.xhtml>): `GL_MAX_ARRAY_TEXTURE_LAYERS` *"must be at
least 256"*, `GL_MAX_TEXTURE_SIZE` *"must be at least 2048"*. Measured here: SwiftShader 8192 / 2048 layers; the host
GPU via ANGLE Metal 16384 / 2048. Load **only the textures the current line uses**, which is dozens to a few hundred.
Split into several array textures if a view ever needs more than 256 layers.

Gotchas found:
- **Don't set `glslVersion: THREE.GLSL3` on a `ShaderMaterial` in r186.** That flag makes three skip its
  `pc_fragColor` / `gl_FragColor` mapping, so `#include <colorspace_fragment>` fails to compile:
  ```text
  ERROR: 0:65: 'gl_FragColor' : undeclared identifier … 'linearToOutputTexel' : no matching overloaded function found
  ```
  Source, `three/src/renderers/webgl/WebGLProgram.js`: `( parameters.glslVersion === GLSL3 ) ? '' : 'layout(location = 0) out highp vec4 pc_fragColor;'`.
  Under WebGL2, three already compiles every non-raw shader as `#version 300 es`, so `sampler2DArray`, `flat` and
  `texture()` work without the flag.
- `DataArrayTexture` rows are uploaded top-down and cannot be flipped on upload, so flip V in the shader:
  `texture(map, vec3(vUv.x, 1.0 - vUv.y, layer))`.
- `Raycaster.setFromCamera()` returns `void` in r186, so it is not chainable (`TS2339: Property 'intersectObject' does
  not exist on type 'void'`).
- Pixel art: `magFilter = minFilter = THREE.NearestFilter`, `generateMipmaps = false` (atlas), and
  `colorSpace = THREE.SRGBColorSpace` on the textures.
- Render on demand (`controls.addEventListener('change', render)`), with no idle animation loop, because the host
  also runs the game. Use `preserveDrawingBuffer: true` only in tests (for `readPixels`).
- Bundle size: the main chunk with three, React and zip.js is ~918 kB min / 269 kB gzip, and Vite warns above 500 kB.
  Lazy-load the 3D view and the upload page (`React.lazy` / dynamic `import()`).
- UNVERIFIED: GT's layered textures (casing plus overlay with transparency) and animated playback were not attempted.
  The probe draws one texture per cube.

---

## 9. Zip handling

### 9.1 Server: yauzl 3.4.0 (reading backups and uploaded zips from disk)

Promise API (yauzl README): `await yauzl.openPromise(path, { lazyEntries: true, autoClose: false })`,
`for await (const e of zip.eachEntry())`, `await zip.openReadStreamPromise(e)`. It opens files read-only
(`yauzl/index.js:76: fs.open(path, "r", function(err, fd) {`).

Measured on a real GTNH 2.9 server backup (~0.7 GB zip, ~2.2k deflate entries, no ZIP64), opened read-only. World
counts are redacted here; exact figures are in the local notes:
```text
$ node probes/zip-probe.ts <backups dir>
yauzl: open 2.2 ms, list ~2.2k files in 68.0 ms; methods {"8":…} (8=deflate), zip64 extra fields: 0; … .mca files in … region folders
yauzl: level.dat … B gz -> … B NBT, first tag type 0xa (0x0a = compound) in 5.3 ms
yauzl: largest region file 10.9 MiB inflated in 43 ms (252 MiB/s)
        143851520  maximum resident set size
```
- Random access through the central directory: the cost is proportional to what you read, not to the archive size.
- **Only open a backup that has finished writing.** The server rewrites a new zip every 30 min. A half-written zip has
  no central directory yet:
  `yauzl on a half-written zip -> End of central directory record signature not found. Either not a zip file, or file is truncated.`
  The probe picks the newest zip whose mtime is more than 2 minutes old.

### 9.2 fflate 0.8.3: poor fit for world archives

fflate's streaming `Unzip` has to see every byte, and it **keeps the compressed data of every entry you don't
`start()`**. Measured on the same backup, looking only for `level.dat`:
```text
plain sequential read (no unzip):  plain read ~0.7 GB in 118 ms   141787136 maximum resident set size
fflate Unzip (streaming):          found level.dat … after reading the whole archive in 113 ms   888684544 maximum resident set size
```
Source (`fflate/esm/index.mjs`, `Unzip.prototype.push`): for each entry `var chks_3 = []; this_1.k.unshift(chks_3);`,
and data of un-started entries goes to `this.k[0].push(toAdd)`, so it is retained to allow a later `start()`. Use
fflate only for small in-memory zips; the probe uses it to build e2e test fixtures.

### 9.3 Browser: @zip.js/zip.js 2.22.1 (only if a friend picks a whole world zip)

```ts
import { BlobReader, BlobWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js';
const zr = new ZipReader(new BlobReader(file));             // File.slice() random access
const wanted = (await zr.getEntries()).filter((e: Entry): e is FileEntry => !e.directory && WANT.test(e.filename));
for (const e of wanted) await fetch(`/api/uploads/${base(e.filename)}`, { method: 'PUT', body: await e.getData(new BlobWriter()) });
```
```text
$ node probes/zipjs-probe.ts <real backup>       (Node's fs.openAsBlob = same Blob code path as a browser File)
zip.js: ~2.2k entries listed in 21 ms from a ~0.7 GB Blob
zip.js: level.dat … B extracted in 8 ms (gzip magic 1f 8b)
        115589120  maximum resident set size
```
Type gotcha: `Entry` is `DirectoryEntry | FileEntry`; narrow it before calling `getData` (`TS2339: Property 'getData'
does not exist on type 'Entry'`). The folder picker (`<input webkitdirectory>`) needs no zip library at all and
should be the first choice in the UI. Both were verified (§4.5).

---

## 10. End-to-end tests: Playwright 1.63.0 (Chromium)

```ts
// playwright.config.ts — verified
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:18787', ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning src/server/main.ts',   // the real TS server, no build
    url: 'http://127.0.0.1:18787/api/health', reuseExistingServer: false,
    env: { PORT: '18787', DB_FILE: 'tmp/e2e.db', PLANNER_PASSWORD: 'pw' },
  },
});
```
Suite run (`npm run e2e`): `11 passed (5.8s)`. It covers two users seeing each other's ticks, the solver worker, the
ELK worker, three.js, the connection limit, reconnect plus persistence, zip and folder uploads, and the colour check.

- Browser binaries: Playwright 1.63.0 expects `chromium 1243 153.0.8010.12` (`playwright-core/browsers.json`).
  Install once with `npx playwright install chromium`.
- **WebGL works headless** because Playwright adds SwiftShader on macOS (`playwright-core/lib/coreBundle.js`, lines
  43538–43539: `if (import_os12.default.platform() === "darwin") { chromeArguments.push("--enable-unsafe-swiftshader");`,
  and line 43337 pushes the same flag on another launch path). It is software rendering with smaller limits (8192). `chromium.launch({ channel: 'chromium' })` (new headless, still no window) used the real
  GPU here (`ANGLE (Apple, ANGLE Metal Renderer: …)`, 16384).
- Login once per context with `context.request.post('/api/login', …)`: the request context shares the browser
  context's cookie jar, so `EventSource` then authenticates.
- Controlled checkboxes that flip only when the SSE event arrives break `locator.check()`
  (`Error: locator.check: Clicking the checkbox did not change its state`). Use `click()` and assert on the result.
- `expect(...).toHaveText` polls with back-off and hides real latency: measured 1002 ms against a true ~1–2 ms.
  Measure with `page.waitForFunction(…, { polling: 'raf' })` or in-page timestamps.
- `setInputFiles(dir)` works for `<input webkitdirectory>`; `setInputFiles({ name, mimeType, buffer })` for synthetic
  zips.
- E2E specs contain DOM code inside `page.evaluate`, which is why they get their own tsconfig (DOM lib plus
  `@types/node`).
- UNVERIFIED: Firefox and Safari. Friends may use them; only Chromium was tested.

---

## 11. Summary of open items (UNVERIFIED)

- Firefox/Safari behaviour (EventSource, module workers, WebGL2 `DataArrayTexture`, `webkitdirectory`, zip.js).
- NAT/router idle timeouts on the friends' path (the 20 s heartbeat is a convention).
- Node 24.22 (newest 24 LTS) and any later `node:sqlite` API changes. The probes ran on 24.10.0 only.
- HiGHS on the real exported recipe graph (synthetic graphs only), and the alternatives (yalps, glpk.js).
- VS Code with TypeScript 7 as the workspace version.
- GT multi-layer textures and animations in the 3D view.
