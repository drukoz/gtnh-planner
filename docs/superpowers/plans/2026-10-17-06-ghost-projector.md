# In-game Ghost Projector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player see the planned line in the game: a client-side Forge 1.7.10 mod loads a project's layout from the planner with a revocable per-project token, draws translucent ghost blocks where the layout puts them, colours each one by what is really there, and ticks off a build step in the shared checklist when every block of it is placed correctly.

**Architecture:** The server gains a hashed per-project token store (a new table in Plan 2's SQLite file), bearer-token auth that the HTTP core accepts only on routes flagged `bearer: true` and only for the token's own project (`GET /api/projects/:id`, `GET /api/projects/:id/layout`, the new `GET /api/projects/:id/projector`, and `POST /api/projects/:id/ops` limited to `mark` ops on `step:` rows), token routes, and a projector route that turns Plan 5's cached `Layout` into a compact payload: real registry names (pseudo part ids resolved to their container block), which meta/mteId/facing to check, covers, and which build step each block belongs to — decided once in TypeScript so the Java side stays small. The project page gets an "In-game projector" panel. The mod (`projector-mod/`, same GTNH template and toolchain as `exporter-mod/`) keeps all logic that can be tested — config, URL defaults, JSON parsing, HTTP client, facing and quad math, view filters, world-vs-plan matching, step completion, HUD text, command parsing, the session state machine — in pure-Java packages with JUnit tests, and a thin `client` package wires it to Minecraft: a client tick handler that checks the world every N ticks, a `RenderWorldLastEvent` renderer that compiles Tessellator quads into display lists, a HUD line, and `/planner` client commands.

**Tech Stack:** TypeScript 6.0.3 on Node 24 (type stripping), `node:sqlite`, `node:crypto`, React 19.3.0, vitest 5.0.3, @playwright/test 1.63.0; Java 8 bytecode (Jabel) on the GTNH ExampleMod1.7.10 template (GTNHGradle 2.0.33, Gradle 9.7.1, Forge 10.13.4.1614), GT5-Unofficial 5.09.54.183 `:dev` (compileOnly), Gson 2.2.4 (ships with Minecraft), JUnit 5.11.4, `HttpURLConnection`, `com.sun.net.httpserver` (tests only).

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` (§3.13; also §3.6–§3.8 for what the layout holds, §3.11 for shared ticks). Contracts: `docs/superpowers/plans/2026-10-17-00-architecture.md` (§2, §3, §6.4, §6.7, §7, §7.1, §10, §11.14, §11.17, §11.22 — §11 wins over earlier sections). Builds on Plan 2 (`2026-10-17-02-planner-app.md`: router, auth, db, project routes, client scaffold, test server) and Plan 5 (`2026-10-17-05-line-layout-3d.md`: `Layout`, `LayoutBlock`, `CoverSpec`, build step ids, `layoutService`). Facts: `docs/research/export-mod.md` §1.4 (build), §3.1 (MTE registry, prototypes); `docs/research/textures-icons.md` §2.3–§2.4, §3.5 (GT `ITexture` tree); `docs/research/world-format.md` §6.9–§6.11 (container blocks of multipart, conduit and ME cable parts).

## Global Constraints

- Never touch the live server or the game (architecture §2.1, spec §4–§5): the mod only reads the world the client already has loaded and talks HTTP to the planner; nothing is installed on the server. The executor never copies files into, launches or edits the Prism instance — the in-game task is done by the user.
- Nothing private is committed (architecture §2.2, spec §5): no server address, player names, UUIDs, coordinates or home paths from `docs/local/` in code, tests, fixtures or docs. Examples use `mc.example.org`, `Steve`, and coordinates near `100 64 200`.
- TypeScript: Node `>=24.10.0 <25`, erasable syntax only (no `enum`, `namespace`, parameter properties, decorators, `<T>x`), relative imports name the real `.ts`/`.tsx` file, `import type` for types, `src/shared/` has no `node:*` and no DOM. No new npm dependency.
- Java: `projector-mod/` only, Java 8 APIs (`--release 8` via Jabel), mod id `gtnhplannerprojector`, package `io.github.drukoz.gtnhplanner.projector`, `acceptableRemoteVersions = "*"`, `dependencies = "after:gregtech"`, client-only through `@SidedProxy` (FML 1.7.10's `@Mod` has no client-only flag; the common proxy does nothing, so the jar is harmless on a server). Build `VERSION=<v> ./gradlew assemble` with `GRADLE_USER_HOME=.local/gradle-home`; every jar passes `exporter-mod/scripts/check-reobf.sh`.
- Pure Java packages `config`, `net`, `model`, `geom`, `view`, `check`, `session` import nothing from `net.minecraft`, `net.minecraftforge`, `cpw.mods` or `gregtech` (a JUnit test enforces it); only `client` touches the game.
- Token rules (architecture §11.22): token = `gpt_` + 43 base64url characters (32 random bytes); stored only as `sha256` hex plus its first 8 characters (`hint`); shown once at creation; at most 20 per project; revoking deletes the row. Bearer auth: header `Authorization: Bearer <token>`, accepted only on routes flagged `bearer: true` and only when the route's `:id` is the token's project; a valid session cookie always wins. Through a token, `POST /api/projects/:id/ops` accepts only `{ op: 'mark', row: 'step:…' }` ops (else 403 `token-scope`) and still needs `X-Planner-Name` (the player's name).
- Default planner address (spec §3.13): `http://<host of the Minecraft server the client is connected to>:8765` (`http://127.0.0.1:8765` in single player); `plannerUrl` in the mod config (or `/planner url <url>`) overrides it.
- Facing numbers are ForgeDirection everywhere: down 0, up 1, north 2 (−z), south 3 (+z), west 4 (−x), east 5 (+x) — the same as `LayoutBlock.facing` and Plan 3's `FACES` order.
- Build check (spec §3.13): correct block → green, wrong block or wrong facing → red, not yet placed → faint ghost; a block whose planned registry name the client does not know is "can't be checked" and its step is never auto-ticked; a block in a chunk the client has not loaded is neither right nor wrong.
- Step marks: a step is ticked (`{ op: 'mark', row: 'step:<buildStepId>', on: true }`, name = the player's session name) only when it has at least one block, every block is correct for `STABLE_CHECKS` (2) checks in a row, the planner does not already show it ticked, and this session has not sent it before; the mod never unticks; a failed send is retried no sooner than 60 s later.
- Mod work on the game thread is bounded: HTTP runs on one daemon thread; the world check runs every `checkIntervalTicks` (default 20); geometry is rebuilt only when the data, the filter or a block state changes; blocks farther than `maxDistance` (default 96) from the camera are not drawn.
- Commits use a conventional prefix and the message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The planner is off, on another port, or the token was revoked** (planner restarted, a friend copied an old command, the host's port forward is missing): the game never freezes, the ghosts already loaded stay, chat says in plain words what to do (new token, `/planner url`), and the mod does not retry in a loop. Tests: Task 7 `PlannerClientTest` "maps a revoked token, an unknown project and a dead address to plain messages"; Task 10 `ProjectorSessionTest` "keeps the loaded ghosts when a refresh fails"; Task 4 "a revoked token gets 401".
2. **The player is in another dimension, or the line's chunks are not loaded yet** (just logged in, far away, line in the Nether): nothing is drawn in the wrong dimension, unloaded blocks are not shown as missing or wrong, and no step is ticked or counted from them. Tests: Task 9 `MatcherTest` "an unloaded block is neither right nor wrong", `StepTrackerTest` "never completes a step with unloaded blocks"; Task 10 `ProjectorSessionTest` "draws nothing in another dimension".
3. **Placing and turning a machine** (place it, then wrench the front; a GT tile entity whose data has not reached the client yet): a step is never ticked from a single lucky check, never twice, never unticked, and a just-placed GT machine without synced data is not flashed red. Tests: Task 9 "waits for two correct checks", "sends a step once per session", "a GT machine whose tile data is not synced counts as unloaded".
4. **Blocks the client cannot check** (a multiblock with no exported structure drawn as unknown casings, a registry name from another pack version, a Project Red pipe part): drawn in a neutral colour, counted as "can't be checked" in the HUD, and their step is never auto-ticked. Tests: Task 9 "never completes a step with an unchecked block"; Task 3 "resolves pseudo part ids to their container block"; Task 8 `HudTextTest` "mentions blocks that can't be checked".
5. **The line is re-planned or moved in the browser while a player has it loaded**: the next refresh (or `/planner reload`) swaps to the new layout, a mark is never sent for a step id the new layout no longer has, and a step someone ticked by hand is never sent again. Tests: Task 10 "replaces the layout when the version changes and drops marks for vanished steps", Task 9 "does not send a step the planner already shows done".

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/types/projector.ts` | `TokenInfo`, `CreateTokenBody`, `CreateTokenResult`, projector payload types, `PROJECTOR_FORMAT`, `TOKEN_PREFIX` |
| `src/server/db/db.ts` (Plan 2, modified) | schema v2: `project_token` table and its typed statements |
| `src/server/projector/tokens.ts` | `newToken`, `hashToken`, `TokenStore` (create, list, verify, revoke), `TokenLimitError` |
| `src/server/http/router.ts`, `auth.ts`, `server.ts` (Plan 2, modified) | `Route.bearer`, `RequestContext.bearer`, `TokenVerifier`, `bearerToken()`, bearer check in the auth step |
| `src/server/http/routes/projects.ts` (Plan 2, modified), `layout.ts` (Plan 5, modified) | `bearer: true` on project read, ops and layout; token scope check in the ops handler |
| `src/server/projector/payload.ts` | `stepMembership`, `containerBlock`, `projectorPayload`, `payloadVersion` |
| `src/server/http/routes/projector.ts`, `routes/index.ts` (modified) | token routes, projector route; registers `app.services.verifyToken` |
| `src/client/api/client.ts` (Plan 2, modified), `src/client/api/projector.ts` | `apiDelete`; token and projector API calls |
| `src/client/views/projector-model.ts`, `ProjectorPanel.tsx`, `ProjectPage.tsx` (modified) | panel text and commands, panel view and container, mounted under the settings |
| `tests/helpers/projector-fixtures.ts` | synthetic `Layout` covering every membership rule |
| `projector-mod/` | GTNH template project (copied like `exporter-mod/`), `dependencies.gradle`, `addon.gradle` |
| `projector-mod/src/main/java/io/github/drukoz/gtnhplanner/projector/` | `ProjectorMod`, `CommonProxy`; pure packages `config`, `net`, `model`, `geom`, `view`, `check`, `session`; game glue `client` |
| `projector-mod/src/test/java/io/github/drukoz/gtnhplanner/projector/` | JUnit tests of the pure packages |
| `projector-mod/src/test/resources/projector-sample.json` | the payload of `projectorLayout()`, written by the TS test — the contract both sides test against |
| `tests/unit/projector/*.test.ts`, `tests/client/projector-panel.test.tsx`, `tests/e2e/projector.spec.ts` | server, client and browser tests |
| `README.md` | "In-game ghost projector" section for players |

## Decisions this plan makes

- **A new route, not the layout route.** `GET /api/projects/:id/projector` is built from the same cached `Layout` (`layoutService(app).layoutFor(project)`, Plan 5), so ghosts always match the 3D view, but it is its own route because (1) the mod needs things the `Layout` does not say directly — which build step owns each block (Plan 5 links machines to plan steps by `stepId` and cables, pipes and transformers only through step text and labels), the real container block of pseudo part ids (`fmp:`, `conduit:`, `ae2cable:`, architecture §11.17), and whether meta or facing should be compared at all; deciding that once in tested TypeScript keeps the Java side to parsing and checking; (2) it drops what the mod never uses (hookup paths, pins, BOM, warnings, ghosts of existing blocks) and adds what it does (`done` per step, the project name and rev, a content `version` for cheap refreshes); (3) the layout route stays exactly Plan 5's JSON for the browser. The layout route still accepts tokens because architecture §11.22 lists it.
- **Which build step owns a block** (`stepMembership`, first matching rule; a rule only matches when a build step with that id exists in `layout.buildSteps`, otherwise the next rule is tried): ghosts are left out of the payload; `hookup` set → `layout:power:hookup` or `layout:logistics:hookup` by `layout.hookups[hookup].kind`; role `machine`/`casing`/`hatch` with `stepId` → `layout:place:<stepId>`; `transformer` → the first `layout:power:stage:*` step whose text contains `× <label> between`; `cable` → the first `layout:power:wire:*` step whose text contains ` with <label> (`; `pipe` whose label is `<pipe> (<fluid>)` → the first `layout:logistics:fluid:*` step whose text ends with `× <pipe> for <fluid>`; `pipe`/`interface`/`chip_pipe`/`chest` → `layout:logistics:line`; else none. These follow Plan 5 Task 10's step texts and Task 6's labels; Task 3's fixture pins them.
- **What is compared.** Registry name always; `meta` except for GT machine blocks (the tile's `mID` is compared instead), vanilla chests (meta is the orientation) and pseudo parts (only the container block is checked: the part type is not readable client-side without the multipart APIs); `facing` only for roles `machine`, `hatch` and `transformer` (GT `getFrontFacing()`). Covers are drawn on their face (with the cover item's icon) but never checked: cover settings cannot be read reliably client-side, so `configure` steps stay ticked by hand.
- **Rendering.** Our own quads from icons, not GT's renderer: GT 5.09.54's `ITexture.renderXPos(ISBRContext)` needs GT's internal block-rendering context, so the mod flattens the MTE prototype's `ITexture` tree to `IIcon`s (the same tree Plan 3 reads, research textures-icons §3.5) and draws them with `Tessellator` and vertex colours into two GL display lists (blocks on the block atlas, cover icons on the item atlas). Display lists are what vanilla 1.7.10 chunk rendering uses and Angelica 2.2.19 (present in the pack, `glsm/DisplayListManager`) records them, so no VBOs of our own; GL state is set outside the list. `useDisplayLists=false` in the config draws the same quads every frame instead.
- **Config file.** `config/gtnhplannerprojector.properties` (plain `java.util.Properties`, so it is unit-testable): `plannerUrl` (empty = automatic), `token.<projectId>`, `maxDistance` 96, `checkIntervalTicks` 20, `refreshSeconds` 60, `ghostAlpha` 0.4, `seeThrough` false, `useDisplayLists` true. Two small commands beyond the spec's list make the overrides usable without editing files: `/planner url <url|auto>` and `/planner xray [on|off]` (the depth option).

## Task outline

1. Projector shared types and the hashed token store — `src/shared/types/projector.ts`, `src/server/db/db.ts`, `src/server/projector/tokens.ts`
2. Bearer-token auth in the HTTP core, scope check on ops — `router.ts`, `auth.ts`, `server.ts`, `routes/projects.ts`, `routes/layout.ts`
3. Projector payload: blocks, containers, checks, build-step membership, shared sample — `src/server/projector/payload.ts`
4. Token and projector routes — `src/server/http/routes/projector.ts`, appended to `ROUTE_MODULES`
5. Project page "In-game projector" panel — `src/client/api/projector.ts`, `src/client/views/{projector-model.ts,ProjectorPanel.tsx}`
6. `projector-mod/` scaffold: template, client-only mod, config, planner URL, purity test
7. Payload model and parser, HTTP client, main-thread queue — `model/*`, `net/*`
8. Facing and quad math, view filter, HUD text — `geom/*`, `view/*`
9. Build check: matcher, per-block states, step completion and marks — `check/*`
10. Session and command parser: load, refresh, check cadence, marks, filters, HUD lines (pure, tested) — `session/*`
11. Minecraft glue: world probe, block and GT machine icons, ghost renderer, HUD, `/planner` command, tick and connection events — `client/*`
12. In-game checklist (GTNH_LOCAL, done by the user)
13. End-to-end check (server side automated, browser spec) and README section for players

## What this plan uses from Plans 1–5

- Plan 2: `Db`, `openDb` (`src/server/db/db.ts`); `ProjectStore` (`src/server/projects/store.ts`); `Route`, `RequestContext`, `Handler`, `HttpError`, `sendJson`, `readJson`, `matchRoute` (`src/server/http/router.ts`); `verifySession`, `readCookie`, `SESSION_COOKIE` (`src/server/http/auth.ts`); `startServer` (`src/server/http/server.ts`); `projectRoutes` (`src/server/http/routes/projects.ts`); `ROUTE_MODULES`; `AppContext`; `NAME_HEADER`, `OpsResult` (`src/shared/types/api.ts`); `Project`, `ProjectOp`, `Mark`; `apiGet`, `apiPost`, `ApiError` (`src/client/api/client.ts`); `ProjectPage.tsx`, `ProjectViewProps`; test helpers `startTestServer`, `TestServer` (`tests/helpers/test-server.ts`), `packFromSpec` (`tests/helpers/pack-spec.ts`), `openSse` (`tests/helpers/sse-client.ts`); e2e `login`, `createProject` (`tests/e2e/helpers.ts`).
- Plan 3: `Face`, `FACES` (`src/shared/types/assets.ts`; `FACES` = `['down', 'up', 'north', 'south', 'west', 'east']`).
- Plan 5: `Layout`, `LayoutBlock`, `LayoutStatus`, `BlockRole`, `CoverSpec`, `Hookup` (`src/shared/types/layout.ts`); `BuildStep` (Plan 2 `src/shared/types/plan.ts`); `layoutService(app)` returning `LayoutService { layoutFor(project): Promise<Layout>; finishPlan(plan, project): Promise<Plan>; readonly computations: number }` (`src/server/layout/service.ts`) — looked up per request, so tests replace `app.services.layout`; `layoutRoutes` (`src/server/http/routes/layout.ts`).
- Plan 1 / Plan 3 Java toolchain: `.local/examplemod-template` at `6453dec5f5f534e604887d3505ddf7125889c6f9`, `exporter-mod/scripts/check-reobf.sh`, Plan 3's JUnit setup (`dependencies.gradle` test lines and `addon.gradle`), `$GTDEV` (Plan 1 "Conventions").

---

### Task 1: Projector shared types and the hashed token store

**Files:**
- Create: `src/shared/types/projector.ts`, `src/server/projector/tokens.ts`
- Modify: `src/server/db/db.ts` (Plan 2) — schema v2 and the token statements; nothing else in the file changes
- Test: `tests/unit/projector/tokens.test.ts`

**Interfaces:**
- Consumes: `Db`, `openDb` (Plan 2 `src/server/db/db.ts`); `ProjectStore` (Plan 2); `BlockRole`, `LayoutStatus` (Plan 5 `src/shared/types/layout.ts`); `BuildStep` (Plan 2 `src/shared/types/plan.ts`); `StuffKey` (Plan 1).
- Produces:
  - `src/shared/types/projector.ts`:
    ```ts
    export const TOKEN_PREFIX = 'gpt_';
    export const MAX_TOKENS_PER_PROJECT = 20;
    export const TOKEN_LABEL_MAX = 40;
    export const DEFAULT_TOKEN_LABEL = 'Projector token';
    export interface TokenInfo { tokenId: string; projectId: string; label: string; createdAt: string; createdBy: string; lastUsedAt: string | null; hint: string /* first 8 characters of the token */ }
    export interface CreateTokenBody { label?: string }
    export interface CreateTokenResult { token: string; tokenId: string; info: TokenInfo }
    export const PROJECTOR_FORMAT = 'gtnh-planner-projector/1' as const;
    export interface ProjectorCover { face: number /* ForgeDirection */; item: StuffKey; label: string }
    export interface ProjectorBlock { pos: [number, number, number]; id: string /* real registry name */; meta: number | null /* null = do not compare */;
      mteId?: number; facing?: number /* only when the front is checked */; part?: string /* multipart / conduit / ME cable part */;
      role: BlockRole; label: string; step: string | null /* build step id */; covers?: ProjectorCover[] }
    export interface ProjectorStep { id: string; order: number; kind: BuildStep['kind']; text: string; blocks: number[] /* indices into blocks */; done: boolean }
    export interface ProjectorPayload { format: typeof PROJECTOR_FORMAT; projectId: string; name: string; rev: number; version: string; status: LayoutStatus;
      message: string | null; dim: number; origin: [number, number, number]; size: [number, number, number]; blocks: ProjectorBlock[]; steps: ProjectorStep[] }
    ```
  - `src/server/db/db.ts` additions:
    ```ts
    export interface TokenRow { id: string; projectId: string; hash: string; hint: string; label: string; createdAt: string; createdBy: string; lastUsedAt: string | null }
    // Db gains:
    insertToken(row: TokenRow): void;
    listTokens(projectId: string): TokenRow[];              // created_at asc, then insertion order (rowid)
    tokenByHash(hash: string): TokenRow | undefined;
    deleteToken(projectId: string, id: string): boolean;     // true when a row was deleted
    touchToken(id: string, at: string): void;                // sets last_used_at
    countTokens(projectId: string): number;
    ```
  - `src/server/projector/tokens.ts`:
    ```ts
    export const TOUCH_INTERVAL_MS = 60_000;
    export function newToken(): string;                        // TOKEN_PREFIX + randomBytes(32).toString('base64url')
    export function hashToken(token: string): string;          // sha256, hex
    export function cleanLabel(label: unknown): string;        // trimmed, cut to 40; empty or not a string → DEFAULT_TOKEN_LABEL
    export class TokenLimitError extends Error {}               // 'A project can have at most 20 projector tokens — revoke one first'
    export class TokenStore {
      constructor(db: Db, deps?: { now?: () => Date; newId?: () => string });
      create(projectId: string, label: unknown, by: string): CreateTokenResult;
      list(projectId: string): TokenInfo[];
      verify(token: string, projectId: string): TokenInfo | null;
      revoke(projectId: string, tokenId: string): boolean;
    }
    ```

Rules:
- Schema v2: `openDb` reads `meta.schema_version` after creating the v1 tables; when it is `1`, in one transaction it runs `CREATE TABLE project_token(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id), hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, last_used_at TEXT)`, `CREATE INDEX project_token_project ON project_token(project_id)` and sets `schema_version = 2`. A version above 2 throws `Error('planner.sqlite has schema <n>; this planner knows up to 2 — update the planner')`. Rows are spread into plain objects before they leave the module (Plan 2's null-prototype rule).
- Token ids are 10 characters of `randomBytes(8).toString('base64url')` (like project ids); `list` keeps creation order (same-millisecond tokens by rowid). `create` throws `TokenLimitError` when `countTokens(projectId) ≥ 20`; the caller checks that the project exists (the foreign key rejects unknown ids).
- `verify`: a token that does not start with `gpt_` or is longer than 100 characters → `null` without a query; row by `hashToken(token)`; a row of another project → `null`; `last_used_at` is written when it is null or at least `TOUCH_INTERVAL_MS` old, and the returned `TokenInfo` carries the value now stored. `TokenInfo` never carries the hash.

- [ ] **Step 1: Write the failing test** `tests/unit/projector/tokens.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb, type Db } from '../../../src/server/db/db.ts';
import { ProjectStore } from '../../../src/server/projects/store.ts';
import { TokenStore, TokenLimitError, newToken, hashToken, cleanLabel } from '../../../src/server/projector/tokens.ts';

let dir: string; let db: Db; let pid: string; let other: string; let clock: number;
const now = () => new Date(clock);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gp-tokens-'));
  db = openDb(join(dir, 'planner.sqlite'));
  const projects = new ProjectStore(db);
  pid = projects.create('Steel line', 'Ann').id;
  other = projects.create('Circuits', 'Ann').id;
  clock = Date.UTC(2026, 9, 18, 12, 0, 0);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('projector tokens', () => {
  it('makes 256-bit tokens and hashes them with sha256', () => {
    const t = newToken();
    expect(t).toMatch(/^gpt_[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(hashToken('gpt_x')).toBe(createHash('sha256').update('gpt_x').digest('hex'));
    expect([cleanLabel('  Steve '), cleanLabel(''), cleanLabel(42), cleanLabel('x'.repeat(50)).length]).toEqual(['Steve', 'Projector token', 'Projector token', 40]);
  });

  it('shows a new token once and stores only its hash and hint', () => {
    const store = new TokenStore(db, { now });
    const r = store.create(pid, 'Steve', 'Ann');
    expect(r.tokenId).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(r.info).toEqual({ tokenId: r.tokenId, projectId: pid, label: 'Steve', createdAt: '2026-10-18T12:00:00.000Z', createdBy: 'Ann', lastUsedAt: null, hint: r.token.slice(0, 8) });
    const rows = db.listTokens(pid);
    expect(rows.map((x) => x.hash)).toEqual([hashToken(r.token)]);
    expect(JSON.stringify(rows)).not.toContain(r.token);
    expect(store.list(pid)).toEqual([r.info]);
    expect(JSON.stringify(store.list(pid))).not.toContain(hashToken(r.token));
  });

  it('verifies a token only for its own project and records use at most once a minute', () => {
    const store = new TokenStore(db, { now });
    const { token, tokenId } = store.create(pid, 'Steve', 'Ann');
    clock += 1_000;
    expect(store.verify(token, pid)).toMatchObject({ tokenId, lastUsedAt: '2026-10-18T12:00:01.000Z' });
    clock += 30_000;
    expect(store.verify(token, pid)?.lastUsedAt).toBe('2026-10-18T12:00:01.000Z');
    clock += 31_000;
    expect(store.verify(token, pid)?.lastUsedAt).toBe('2026-10-18T12:01:02.000Z');
    expect(store.verify(token, other)).toBeNull();
    expect(store.verify(`${token}x`, pid)).toBeNull();
    expect(store.verify('not-a-token', pid)).toBeNull();
    expect(store.verify(`gpt_${'a'.repeat(200)}`, pid)).toBeNull();
  });

  it('revokes a token for good, and only through its own project', () => {
    const store = new TokenStore(db, { now });
    const { token, tokenId } = store.create(pid, 'Steve', 'Ann');
    expect(store.revoke(other, tokenId)).toBe(false);
    expect(store.verify(token, pid)).not.toBeNull();
    expect(store.revoke(pid, tokenId)).toBe(true);
    expect(store.revoke(pid, tokenId)).toBe(false);
    expect(store.verify(token, pid)).toBeNull();
    expect(store.list(pid)).toEqual([]);
  });

  it('allows at most 20 tokens per project', () => {
    const store = new TokenStore(db, { now });
    for (let i = 0; i < 20; i++) store.create(pid, `p${i}`, 'Ann');
    expect(() => store.create(pid, 'one more', 'Ann')).toThrow(TokenLimitError);
    expect(store.create(other, 'fine', 'Ann').info.projectId).toBe(other);
    expect(store.list(pid).map((t) => t.label).slice(0, 2)).toEqual(['p0', 'p1']);
  });

  it('upgrades a version-1 database in place', () => {
    const file = join(dir, 'v1.sqlite');
    const raw = new DatabaseSync(file);
    raw.exec(`CREATE TABLE project(id TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE project_op(project_id TEXT NOT NULL REFERENCES project(id), rev INTEGER NOT NULL, op TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project_id, rev));
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');`);
    raw.close();
    const old = openDb(file);
    const p = new ProjectStore(old).create('Old', 'Ann');
    expect(new TokenStore(old, { now }).create(p.id, 'Steve', 'Ann').info.projectId).toBe(p.id);
    old.close();
    const check = new DatabaseSync(file);
    expect({ ...(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }).toEqual({ value: '2' });
    check.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/projector/tokens.test.ts`
Expected: FAIL — `Cannot find module '../../../src/server/projector/tokens.ts'`.

- [ ] **Step 3: Implement** `src/shared/types/projector.ts`, the `db.ts` migration and statements, and `src/server/projector/tokens.ts` as specified (`node:crypto` `randomBytes`, `createHash`).

- [ ] **Step 4: Run the new test and Plan 2's store test**

Run: `npx vitest run tests/unit/projector/tokens.test.ts tests/unit/projects/store.test.ts`
Expected: PASS (`Test Files  2 passed`).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/projector.ts src/server/db/db.ts src/server/projector/tokens.ts tests/unit/projector/tokens.test.ts
git commit -m "feat(projector): hashed per-project tokens in schema v2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Bearer-token auth in the HTTP core, scope check on ops

**Files:**
- Modify: `src/server/http/router.ts`, `src/server/http/auth.ts`, `src/server/http/server.ts` (Plan 2) — the auth step only
- Modify: `src/server/http/routes/projects.ts` (Plan 2) — `bearer: true` on `GET /api/projects/:id` and `POST /api/projects/:id/ops`, and the scope check
- Modify: `src/server/http/routes/layout.ts` (Plan 5) — `bearer: true` on `GET /api/projects/:id/layout`
- Test: `tests/unit/projector/bearer.test.ts`

**Interfaces:**
- Consumes: `startTestServer`, `TestServer` (Plan 2 `tests/helpers/test-server.ts`; `request(path, { method, body, name, cookie: null, headers })`); `packFromSpec` (Plan 2); `ProjectOp` (Plan 2).
- Produces (later tasks rely on these exact names):
  ```ts
  // src/server/http/router.ts
  export interface Route { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; handler: Handler; public?: boolean;
    bearer?: boolean /* also accept a project token for params.id instead of the session cookie */ }
  export interface RequestContext { me: string | null; authed: boolean; bearer?: { projectId: string; tokenId: string } }
  export type TokenVerifier = (token: string, projectId: string) => { tokenId: string } | null;   // registered as app.services.verifyToken
  // src/server/http/auth.ts
  export function bearerToken(header: string | undefined): string | null;   // "Bearer <t>": scheme case-insensitive, then 1+ spaces, then t without spaces; else null
  // src/server/http/routes/projects.ts
  export function tokenMayApply(ops: readonly ProjectOp[]): boolean;          // every op is { op: 'mark' } with row starting 'step:'
  ```

Rules (the auth step of `startServer`, after `matchRoute`):
1. `route.public` → handle.
2. `verifySession(config.sessionSecret, cookie, now)` → `ctx.authed = true`, no `ctx.bearer` (a valid cookie always wins over any `Authorization` header).
3. Else, when `route.bearer`, `params.id` is set, `t = bearerToken(req.headers.authorization)` is not null and `hit = (app.services.verifyToken as TokenVerifier | undefined)?.(t, params.id)` is not null → `ctx.authed = true`, `ctx.bearer = { projectId: params.id, tokenId: hit.tokenId }`. The verifier is looked up per request.
4. Else 401 `{ error: 'auth' }` (unchanged body).
- Ops handler order: the existing `name-required` check, then — when `ctx.bearer` is set and `!tokenMayApply(body.ops)` — `throw new HttpError(403, 'token-scope', 'A projector token can only tick build steps')`, then the existing validation and apply. Nothing else in Plan 2's or Plan 5's handlers changes.

- [ ] **Step 1: Write the failing test** `tests/unit/projector/bearer.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { bearerToken } from '../../../src/server/http/auth.ts';
import { tokenMayApply } from '../../../src/server/http/routes/projects.ts';
import type { TokenVerifier } from '../../../src/server/http/router.ts';

let s: TestServer; let id: string; let other: string;
const create = async (name: string) => (await (await s.request('/api/projects', { method: 'POST', body: { name }, name: 'Ann' })).json()).id as string;
beforeAll(async () => {
  s = await startTestServer({ pack: packFromSpec({}) });
  id = await create('Steel line');
  other = await create('Circuits');
  const verify: TokenVerifier = (token, projectId) => (token === 'gpt_good' && projectId === id ? { tokenId: 't1' } : null);
  s.app.services.verifyToken = verify;
});
afterAll(async () => { await s.close(); });
const withToken = (path: string, init: { method?: string; body?: unknown; name?: string; token?: string } = {}) => {
  const { token = 'gpt_good', ...rest } = init;
  return s.request(path, { ...rest, cookie: null, headers: { authorization: `Bearer ${token}` } });
};
const mark = (row: string) => ({ ops: [{ op: 'mark', row, on: true }] });

describe('bearer tokens', () => {
  it('parses only the Bearer scheme', () => {
    expect([bearerToken('Bearer gpt_a'), bearerToken('bearer   gpt_a'), bearerToken('Basic gpt_a'), bearerToken('Bearer'), bearerToken('Bearer a b'), bearerToken(undefined)])
      .toEqual(['gpt_a', 'gpt_a', null, null, null, null]);
    expect(tokenMayApply([{ op: 'mark', row: 'step:layout:site', on: true }])).toBe(true);
    expect(tokenMayApply([{ op: 'mark', row: 'build:x@0', on: true }])).toBe(false);
    expect(tokenMayApply([{ op: 'rename', name: 'x' }])).toBe(false);
  });

  it('reads its own project and layout and nothing else', async () => {
    expect((await withToken(`/api/projects/${id}`)).status).toBe(200);
    expect((await withToken(`/api/projects/${id}/layout`)).status).toBe(200);
    for (const path of ['/api/projects', `/api/projects/${id}/plan`, `/api/projects/${id}/events`, `/api/projects/${other}`, `/api/projects/${other}/layout`, '/api/pack'])
      expect((await withToken(path)).status, path).toBe(401);
    expect((await withToken(`/api/projects/${id}`, { token: 'gpt_bad' })).status).toBe(401);
    expect((await s.request(`/api/projects/${id}`, { cookie: null, headers: { authorization: 'Basic gpt_good' } })).status).toBe(401);
  });

  it('ticks build steps in the player\'s name and refuses every other change', async () => {
    const ok = await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mark('step:layout:place:s1'), name: 'Steve' });
    expect(ok.status).toBe(200);
    const p = await (await s.request(`/api/projects/${id}`)).json();
    expect(p.marks['step:layout:place:s1']).toMatchObject({ by: 'Steve' });
    const rename = await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: { ops: [{ op: 'rename', name: 'x' }] }, name: 'Steve' });
    expect([rename.status, (await rename.json()).error]).toEqual([403, 'token-scope']);
    expect((await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mark('build:x@0'), name: 'Steve' })).status).toBe(403);
    expect((await withToken(`/api/projects/${id}/ops`, { method: 'POST', body: mark('step:layout:site') })).status).toBe(400);
    expect((await withToken(`/api/projects/${other}/ops`, { method: 'POST', body: mark('step:layout:site'), name: 'Steve' })).status).toBe(401);
  });

  it('keeps full rights for a valid cookie even with a bad Authorization header', async () => {
    const r = await s.request(`/api/projects/${id}/ops`, { method: 'POST', body: { ops: [{ op: 'rename', name: 'Steel line 2' }] }, name: 'Ann', headers: { authorization: 'Bearer gpt_bad' } });
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/projector/bearer.test.ts`
Expected: FAIL — `bearerToken` is not exported from `auth.ts` (and the token requests get 401).

- [ ] **Step 3: Implement** the four changes in `router.ts`, `auth.ts`, `server.ts`, `projects.ts` and the one-flag change in `routes/layout.ts` exactly as the rules say.

- [ ] **Step 4: Run the new test and Plan 2's / Plan 5's HTTP tests**

Run: `npx vitest run tests/unit/projector/bearer.test.ts tests/unit/http tests/unit/layout/route.test.ts`
Expected: PASS. (`GET …/layout` answers 200 for a project without a target — Plan 5 Review Focus 1; if it does not, that is Plan 5's bug to fix, not a reason to loosen this test.)

- [ ] **Step 5: Commit**

```bash
git add src/server/http/router.ts src/server/http/auth.ts src/server/http/server.ts src/server/http/routes/projects.ts src/server/http/routes/layout.ts tests/unit/projector/bearer.test.ts
git commit -m "feat(projector): bearer tokens for project read, layout and step ticks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Projector payload — blocks, containers, checks, build-step membership, shared sample

**Files:**
- Create: `src/server/projector/payload.ts`, `tests/helpers/projector-fixtures.ts`
- Create (generated by the test in Step 4, then committed): `projector-mod/src/test/resources/projector-sample.json`
- Test: `tests/unit/projector/payload.test.ts`

**Interfaces:**
- Consumes: `ProjectorPayload`, `ProjectorBlock`, `ProjectorStep`, `PROJECTOR_FORMAT` (Task 1); `Layout`, `LayoutBlock`, `BlockRole` (Plan 5); `BlockRef` (Plan 1); `FACES` (Plan 3); `Project`, `defaultSettings` (Plan 2).
- Produces:
  - `src/server/projector/payload.ts`:
    ```ts
    export const CONTAINER_BLOCKS: Readonly<Record<string, string>>;   // { fmp: 'ForgeMultipart:block', conduit: 'EnderIO:blockConduitBundle', ae2cable: 'appliedenergistics2:tile.BlockCableBus' }
    export const META_FREE_BLOCKS: ReadonlySet<string>;                 // 'minecraft:chest', 'minecraft:trapped_chest' (meta = orientation)
    export const FACING_ROLES: ReadonlySet<BlockRole>;                  // 'machine', 'hatch', 'transformer'
    export const STATUS_MESSAGES: Readonly<Record<'empty' | 'no-world', string>>;
    export function containerBlock(ref: BlockRef): { id: string; part?: string };
    export function stepMembership(layout: Layout): Array<string | null>;   // one entry per layout.blocks index; ghosts → null
    export function payloadVersion(p: Pick<ProjectorPayload, 'dim' | 'blocks' | 'steps'>): string;
    export function projectorPayload(project: Project, layout: Layout, nameOf: (k: StuffKey) => string): ProjectorPayload;
    ```
  - `tests/helpers/projector-fixtures.ts`: `projectorLayout(): Layout`, `projectorProject(): Project`, `CONVEYOR = 'gregtech:gt.metaitem.01@32630'` — exactly as in Step 1 (Tasks 4, 9–10 and 13 reuse them).

Rules (see "Decisions this plan makes" for why):
- `containerBlock`: an id `<prefix>:<rest>` whose prefix is a `CONTAINER_BLOCKS` key → `{ id: CONTAINER_BLOCKS[prefix], part: rest }`; anything else → `{ id: ref.id }`.
- `stepMembership`: the rule list in "Decisions this plan makes", in that order; text matches are plain substring / suffix tests (`includes`, `endsWith`), the fluid-pipe label split is `/^(.*) \((.*)\)$/`.
- `projectorPayload`: `status = layout.status ?? 'ok'`. When it is not `ok`: `blocks: []`, `steps: []`, `message = STATUS_MESSAGES[status]` — `no-world` → `'This project is not placed in the world yet: pick a world scan and base on its Map tab'`, `empty` → `'Nothing to build yet: this plan places no machines'`. When `ok`, `message: null` and:
  - `blocks` = the non-ghost layout blocks in layout order, each `{ pos, id, part?, meta, mteId?, facing?, role, label, step, covers? }` with `id`/`part` from `containerBlock`; `meta = null` when the block has an `mteId`, a `part`, or an id in `META_FREE_BLOCKS`, else `block.meta`; `facing` only when the role is in `FACING_ROLES`, the block has an `mteId` and `facing` is set; `covers` only when non-empty, each `{ face: FACES.indexOf(c.face), item: c.item, label: nameOf(c.item) }`.
  - `steps` = `layout.buildSteps` sorted by `order`, each with `blocks` = indices of payload blocks whose `step` is its id, and `done = project.marks['step:' + id] !== undefined`.
- `projectId`, `name`, `rev` from the project; `dim`, `origin`, `size` from the layout; `version = payloadVersion(…)` = the first 16 hex characters of `sha1(JSON.stringify([dim, blocks, steps.map((s) => [s.id, s.order, s.blocks])]))` — ticks and names do not change it, so the mod rebuilds geometry only when blocks move.

- [ ] **Step 1: Write the fixture** `tests/helpers/projector-fixtures.ts`

```ts
import type { Layout } from '../../src/shared/types/layout.ts';
import type { Project } from '../../src/shared/types/project.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';

export const CONVEYOR = 'gregtech:gt.metaitem.01@32630';
const GT = (mteId: number) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId });

// One block per membership rule; texts follow Plan 5 Task 10, labels Plan 5 Tasks 5-8. Coordinates are synthetic.
export function projectorLayout(): Layout {
  return {
    status: 'ok', dim: 0, origin: [99, 64, 200], size: [7, 2, 4], rotation: 0, mode: 'direct',
    blocks: [
      { pos: [100, 64, 201], block: GT(1180), role: 'cable', label: '1x Tin Cable', hookup: 0 },
      { pos: [101, 64, 201], block: GT(1180), role: 'cable', label: '1x Tin Cable' },
      { pos: [101, 64, 202], block: GT(21), role: 'transformer', label: 'Low Voltage Transformer', facing: 4 },
      { pos: [102, 64, 201], block: GT(201), role: 'machine', label: 'Basic Macerator', facing: 3, stepId: 's1',
        covers: [{ face: 'south', item: CONVEYOR, settings: { mode: 'export', rate: 1, unit: 'stacks/s' } }] },
      { pos: [103, 64, 201], block: GT(201), role: 'machine', label: 'Basic Macerator', facing: 3, stepId: 's1' },
      { pos: [102, 64, 202], block: GT(5110), role: 'pipe', label: 'Tin Item Pipe' },
      { pos: [104, 64, 202], block: { id: 'minecraft:chest', meta: 0 }, role: 'chest', label: 'Chest (input)' },
      { pos: [102, 65, 201], block: GT(5131), role: 'pipe', label: 'Bronze Fluid Pipe (Water)' },
      { pos: [105, 64, 202], block: { id: 'fmp:pr_rinterface', meta: 0 }, role: 'chip_pipe', label: 'Routed Interface Pipe (input chest)' },
      { pos: [99, 64, 201], block: { id: 'minecraft:stone', meta: 0 }, role: 'ghost', label: 'existing Stone' },
      { pos: [103, 65, 203], block: { id: 'gregtech:gt.blockcasings', meta: 11 }, role: 'casing', label: 'Heat Proof Machine Casing', stepId: 's2' },
    ],
    hookups: [{ kind: 'power', from: { pos: [99, 64, 201], dim: 0, kind: 'power', voltageTier: 1, networkId: 'p1' }, path: [[100, 64, 201]], parts: [] }],
    pins: [], bom: [], warnings: [],
    buildSteps: [
      { id: 'layout:site', order: 1, kind: 'place', text: 'Clear a 7×4 spot (2 high) and keep a 1-block path around it' },
      { id: 'layout:place:s1', order: 2, kind: 'place', text: 'Place 2× Basic Macerator facing the middle row' },
      { id: 'layout:place:s2', order: 3, kind: 'place', text: 'Build 1× Electric Blast Furnace (3×4×3) with the controller facing the middle row; hatches: LV Input Bus' },
      { id: 'layout:power:stage:1', order: 4, kind: 'power', text: 'Place 1× Low Voltage Transformer between the MV and LV cables, front (input) toward MV' },
      { id: 'layout:power:wire:1', order: 5, kind: 'power', text: 'Wire the LV machines with 1x Tin Cable (1 blocks)' },
      { id: 'layout:power:hookup', order: 6, kind: 'power', text: 'Run 1× 1x Tin Cable from the tap to the line: up to 1 A at LV, arriving at 32 V' },
      { id: 'layout:logistics:line', order: 7, kind: 'logistics', text: "Lay 1× Tin Item Pipe along the middle row so it touches every machine's front, with an input chest at the end" },
      { id: 'layout:logistics:fluid:fluid:water', order: 8, kind: 'logistics', text: 'Lay 1× Bronze Fluid Pipe for Water' },
      { id: 'layout:configure:s1', order: 9, kind: 'configure', text: 'Basic Macerator: Conveyor Module (LV) on the south face: Export, 1 stacks/s' },
      { id: 'layout:test', order: 10, kind: 'test', text: 'Switch on and check: every machine has power, none is fed above its tier, items reach the output' },
    ],
  };
}

export function projectorProject(): Project {
  return { id: 'Pr0jectAb1', name: 'Steel line', createdAt: '2026-10-18T09:00:00.000Z', createdBy: 'Ann', rev: 7, settings: defaultSettings(),
    world: { scanId: 'S1', baseId: '0:0:0' }, placement: null, notes: [],
    marks: { 'step:layout:place:s2': { by: 'Ann', at: '2026-10-18T10:00:00.000Z' }, 'build:x@0': { by: 'Ann', at: '2026-10-18T10:00:00.000Z' } } };
}
```

- [ ] **Step 2: Write the failing test** `tests/unit/projector/payload.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { containerBlock, stepMembership, projectorPayload, payloadVersion } from '../../../src/server/projector/payload.ts';
import { projectorLayout, projectorProject, CONVEYOR } from '../../helpers/projector-fixtures.ts';

const nameOf = (k: string) => (k === CONVEYOR ? 'Conveyor Module (LV)' : k);
const SAMPLE = 'projector-mod/src/test/resources/projector-sample.json';

describe('projector payload', () => {
  it('assigns every block to the build step that places it', () => {
    expect(stepMembership(projectorLayout())).toEqual([
      'layout:power:hookup', 'layout:power:wire:1', 'layout:power:stage:1', 'layout:place:s1', 'layout:place:s1',
      'layout:logistics:line', 'layout:logistics:line', 'layout:logistics:fluid:fluid:water', 'layout:logistics:line', null, 'layout:place:s2']);
  });

  it('falls through to the next rule when a step does not exist', () => {
    const l = projectorLayout();
    l.buildSteps = l.buildSteps.filter((s) => !['layout:power:wire:1', 'layout:logistics:fluid:fluid:water', 'layout:place:s2'].includes(s.id));
    const m = stepMembership(l);
    expect([m[1], m[7], m[10]]).toEqual([null, 'layout:logistics:line', null]);
  });

  it('resolves pseudo part ids to their container block', () => {
    expect(containerBlock({ id: 'fmp:pr_rinterface', meta: 0 })).toEqual({ id: 'ForgeMultipart:block', part: 'pr_rinterface' });
    expect(containerBlock({ id: 'conduit:item', meta: 0 })).toEqual({ id: 'EnderIO:blockConduitBundle', part: 'item' });
    expect(containerBlock({ id: 'ae2cable:glass', meta: 0 })).toEqual({ id: 'appliedenergistics2:tile.BlockCableBus', part: 'glass' });
    expect(containerBlock({ id: 'gregtech:gt.blockcasings', meta: 11 })).toEqual({ id: 'gregtech:gt.blockcasings' });
  });

  it('compares meta and facing only where they mean something', () => {
    const p = projectorPayload(projectorProject(), projectorLayout(), nameOf);
    expect(p.blocks).toHaveLength(10);
    expect(p.blocks[0]).toEqual({ pos: [100, 64, 201], id: 'gregtech:gt.blockmachines', meta: null, mteId: 1180, role: 'cable', label: '1x Tin Cable', step: 'layout:power:hookup' });
    expect(p.blocks[2]).toMatchObject({ mteId: 21, facing: 4, meta: null });
    expect(p.blocks[3]).toEqual({ pos: [102, 64, 201], id: 'gregtech:gt.blockmachines', meta: null, mteId: 201, facing: 3, role: 'machine', label: 'Basic Macerator',
      step: 'layout:place:s1', covers: [{ face: 3, item: CONVEYOR, label: 'Conveyor Module (LV)' }] });
    expect('covers' in p.blocks[4]).toBe(false);
    expect(p.blocks[6]).toEqual({ pos: [104, 64, 202], id: 'minecraft:chest', meta: null, role: 'chest', label: 'Chest (input)', step: 'layout:logistics:line' });
    expect(p.blocks[8]).toMatchObject({ id: 'ForgeMultipart:block', part: 'pr_rinterface', meta: null });
    expect('facing' in p.blocks[8]).toBe(false);
    expect(p.blocks[9]).toEqual({ pos: [103, 65, 203], id: 'gregtech:gt.blockcasings', meta: 11, role: 'casing', label: 'Heat Proof Machine Casing', step: 'layout:place:s2' });
  });

  it('lists each step\'s blocks and which steps are done', () => {
    const p = projectorPayload(projectorProject(), projectorLayout(), nameOf);
    expect(p.steps.map((s) => [s.order, s.id, s.blocks, s.done])).toEqual([
      [1, 'layout:site', [], false], [2, 'layout:place:s1', [3, 4], false], [3, 'layout:place:s2', [9], true],
      [4, 'layout:power:stage:1', [2], false], [5, 'layout:power:wire:1', [1], false], [6, 'layout:power:hookup', [0], false],
      [7, 'layout:logistics:line', [5, 6, 8], false], [8, 'layout:logistics:fluid:fluid:water', [7], false],
      [9, 'layout:configure:s1', [], false], [10, 'layout:test', [], false]]);
    expect([p.format, p.projectId, p.name, p.rev, p.status, p.message, p.dim, p.origin, p.size])
      .toEqual(['gtnh-planner-projector/1', 'Pr0jectAb1', 'Steel line', 7, 'ok', null, 0, [99, 64, 200], [7, 2, 4]]);
  });

  it('sends no blocks for an unplaced or empty layout', () => {
    const p = projectorPayload(projectorProject(), { ...projectorLayout(), status: 'no-world' }, nameOf);
    expect([p.status, p.blocks, p.steps, p.message]).toEqual(['no-world', [], [], 'This project is not placed in the world yet: pick a world scan and base on its Map tab']);
    expect(projectorPayload(projectorProject(), { ...projectorLayout(), status: 'empty' }, nameOf).message).toBe('Nothing to build yet: this plan places no machines');
  });

  it('keeps its version when only ticks change, and changes it when a block moves', () => {
    const a = projectorPayload(projectorProject(), projectorLayout(), nameOf);
    const ticked = projectorPayload({ ...projectorProject(), marks: {} }, projectorLayout(), nameOf);
    const moved = projectorLayout(); moved.blocks[4].pos = [103, 64, 199];
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(ticked.version).toBe(a.version);
    expect(projectorPayload(projectorProject(), moved, nameOf).version).not.toBe(a.version);
    expect(payloadVersion(a)).toBe(a.version);
  });

  it('matches the shared sample the mod tests against', () => {
    const json = `${JSON.stringify(projectorPayload(projectorProject(), projectorLayout(), nameOf), null, 2)}\n`;
    if (process.env.UPDATE_PROJECTOR_SAMPLE === '1') { mkdirSync('projector-mod/src/test/resources', { recursive: true }); writeFileSync(SAMPLE, json); }
    expect(readFileSync(SAMPLE, 'utf8')).toBe(json);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/projector/payload.test.ts`
Expected: FAIL — `Cannot find module '../../../src/server/projector/payload.ts'`.

- [ ] **Step 4: Implement `payload.ts`, then write the shared sample once**

Run: `UPDATE_PROJECTOR_SAMPLE=1 npx vitest run tests/unit/projector/payload.test.ts && npx vitest run tests/unit/projector/payload.test.ts && head -c 120 projector-mod/src/test/resources/projector-sample.json`
Expected: PASS twice; the file starts with `{\n  "format": "gtnh-planner-projector/1",`. From now on the sample changes only when this fixture or the payload shape changes; then rerun with `UPDATE_PROJECTOR_SAMPLE=1` and rerun the mod's `PayloadParserTest` (Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/server/projector/payload.ts tests/helpers/projector-fixtures.ts tests/unit/projector/payload.test.ts projector-mod/src/test/resources/projector-sample.json
git commit -m "feat(projector): compact projector payload with build-step membership

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Token and projector routes

**Files:**
- Create: `src/server/http/routes/projector.ts`
- Modify: `src/server/http/routes/index.ts` (append `projectorRoutes` to `ROUTE_MODULES`, after Plan 5's `layoutRoutes`)
- Test: `tests/unit/projector/routes.test.ts`

**Interfaces:**
- Consumes: `TokenStore`, `TokenLimitError`, `cleanLabel` (Task 1); `TokenVerifier`, `Route.bearer`, `HttpError`, `sendJson`, `readJson` (Task 2, Plan 2); `projectorPayload` (Task 3); `layoutService` (Plan 5, looked up per request); `AppContext` (`app.db`, `app.projects.get(id)`, `app.pack()`); test fixtures `projectorLayout` (Task 3).
- Produces:
  ```ts
  export function tokenStore(app: AppContext): TokenStore;       // get-or-create app.services.tokens
  export function projectorRoutes(app: AppContext): Route[];     // also sets app.services.verifyToken
  ```

Routes (all JSON; the token routes need the session cookie, only the projector route is `bearer: true`):

| Method + path | Answer |
|---|---|
| `POST /api/projects/:id/tokens` `{ label? }` + `X-Planner-Name` | 201 `CreateTokenResult`; 404 `not-found`; 400 `name-required` `'Tell us your name first'`; 409 `too-many-tokens` with the `TokenLimitError` message |
| `GET /api/projects/:id/tokens` | 200 `TokenInfo[]` (oldest first); 404 `not-found` |
| `DELETE /api/projects/:id/tokens/:tokenId` | 204; 404 `not-found` when that project has no such token |
| `GET /api/projects/:id/projector` (bearer) | 200 `ProjectorPayload` from `projectorPayload(project, await layoutService(app).layoutFor(project), (k) => pack.nameOf(k))`; 404 `not-found`; an `HttpError` (e.g. 503 `no-export`) passes through; anything else → 500 `{ error: 'layout-failed', message: 'The line layout failed: <message>' }` |

`projectorRoutes(app)` sets `app.services.verifyToken = ((t, pid) => { const i = tokenStore(app).verify(t, pid); return i ? { tokenId: i.tokenId } : null; }) satisfies TokenVerifier`.

- [ ] **Step 1: Write the failing test** `tests/unit/projector/routes.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { projectorLayout, CONVEYOR } from '../../helpers/projector-fixtures.ts';
import type { CreateTokenResult, ProjectorPayload, TokenInfo } from '../../../src/shared/types/projector.ts';

let s: TestServer; let id: string; let fail: Error | null = null;
beforeAll(async () => {
  s = await startTestServer({ pack: packFromSpec({ items: [{ key: CONVEYOR, name: 'Conveyor Module (LV)' }] }) });
  id = (await (await s.request('/api/projects', { method: 'POST', body: { name: 'Steel line' }, name: 'Ann' })).json()).id;
  s.app.services.layout = { layoutFor: async () => { if (fail) throw fail; return projectorLayout(); }, finishPlan: async (p: unknown) => p, computations: 0 };
});
afterAll(async () => { await s.close(); });
const newToken = async (label = 'Steve'): Promise<CreateTokenResult> => (await s.request(`/api/projects/${id}/tokens`, { method: 'POST', body: { label }, name: 'Ann' })).json();
const projector = (token: string) => s.request(`/api/projects/${id}/projector`, { cookie: null, headers: { authorization: `Bearer ${token}` } });

describe('projector routes', () => {
  it('creates a token, shows it once and lists it without the secret', async () => {
    const r = await s.request(`/api/projects/${id}/tokens`, { method: 'POST', body: { label: 'Steve' }, name: 'Ann' });
    expect(r.status).toBe(201);
    const made = (await r.json()) as CreateTokenResult;
    expect(made.token).toMatch(/^gpt_[A-Za-z0-9_-]{43}$/);
    expect(made.info).toMatchObject({ label: 'Steve', createdBy: 'Ann', lastUsedAt: null, projectId: id });
    const listed = await (await s.request(`/api/projects/${id}/tokens`)).text();
    expect(listed).not.toContain(made.token);
    expect((JSON.parse(listed) as TokenInfo[]).map((t) => t.tokenId)).toContain(made.tokenId);
  });

  it('refuses token changes without a name, a cookie or a known project', async () => {
    expect((await s.request(`/api/projects/${id}/tokens`, { method: 'POST', body: {} })).status).toBe(400);
    expect((await s.request(`/api/projects/nope/tokens`, { method: 'POST', body: {}, name: 'Ann' })).status).toBe(404);
    const { token } = await newToken();
    expect((await s.request(`/api/projects/${id}/tokens`, { cookie: null, headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('serves the projector payload to a token', async () => {
    const { token } = await newToken();
    const r = await projector(token);
    expect(r.status).toBe(200);
    const p = (await r.json()) as ProjectorPayload;
    expect([p.projectId, p.name, p.blocks.length, p.blocks[3].covers?.[0].label]).toEqual([id, 'Steel line', 10, 'Conveyor Module (LV)']);
    expect((await s.request(`/api/projects/${id}/tokens`)).ok).toBe(true);
  });

  it('a revoked token gets 401', async () => {
    const { token, tokenId } = await newToken('old');
    expect((await s.request(`/api/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await projector(token)).status).toBe(401);
    expect((await s.request(`/api/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('says when the layout fails', async () => {
    const { token } = await newToken();
    fail = new Error('boom');
    const r = await projector(token);
    fail = null;
    expect([r.status, await r.json()]).toEqual([500, { error: 'layout-failed', message: 'The line layout failed: boom' }]);
  });

  it('caps tokens per project', async () => {
    const pid = (await (await s.request('/api/projects', { method: 'POST', body: { name: 'Many' }, name: 'Ann' })).json()).id;
    for (let i = 0; i < 20; i++) await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body: {}, name: 'Ann' });
    const r = await s.request(`/api/projects/${pid}/tokens`, { method: 'POST', body: {}, name: 'Ann' });
    expect([r.status, (await r.json()).error]).toEqual([409, 'too-many-tokens']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/projector/routes.test.ts`
Expected: FAIL — the token routes answer 404 `not-found`.

- [ ] **Step 3: Implement** `routes/projector.ts` and append it in `routes/index.ts`.

- [ ] **Step 4: Run the projector and HTTP tests**

Run: `npx vitest run tests/unit/projector tests/unit/http`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/http/routes/projector.ts src/server/http/routes/index.ts tests/unit/projector/routes.test.ts
git commit -m "feat(projector): token routes and the projector payload route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Project page "In-game projector" panel

**Files:**
- Modify: `src/client/api/client.ts` (Plan 2) — add `apiDelete`
- Create: `src/client/api/projector.ts`, `src/client/views/projector-model.ts`, `src/client/views/ProjectorPanel.tsx`
- Modify: `src/client/views/ProjectPage.tsx` (Plan 2) — render `<ProjectorPanel projectId={project.id} />` directly below `SettingsPanel`
- Test: `tests/client/projector-panel.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `ApiError` (Plan 2); `TokenInfo`, `CreateTokenResult` (Task 1); the routes of Task 4.
- Produces:
  ```ts
  // src/client/api/client.ts
  export function apiDelete(path: string): Promise<void>;     // same headers, 401 redirect and ApiError as apiPost; resolves on 204
  // src/client/api/projector.ts
  export function listTokens(projectId: string): Promise<TokenInfo[]>;
  export function createToken(projectId: string, label: string): Promise<CreateTokenResult>;
  export function revokeToken(projectId: string, tokenId: string): Promise<void>;
  // src/client/views/projector-model.ts
  export function loadCommand(projectId: string, token: string): string;   // `/planner load ${projectId} ${token}`
  export function urlCommand(origin: string): string;                       // `/planner url ${origin}`
  export function lastUsedText(iso: string | null, now: Date): string;
  export const PROJECTOR_COMMANDS: ReadonlyArray<readonly [command: string, what: string]>;
  // src/client/views/ProjectorPanel.tsx
  export interface ProjectorPanelViewProps { projectId: string; origin: string; now: Date; tokens: TokenInfo[] | null; created: CreateTokenResult | null;
    label: string; busy: boolean; error: string | null; onLabel(v: string): void; onCreate(): void; onRevoke(t: TokenInfo): void; onCopy(text: string): void }
  export function ProjectorPanelView(props: ProjectorPanelViewProps): ReactElement;
  export function ProjectorPanel(props: { projectId: string }): ReactElement;
  ```

Rules and exact copy:
- `lastUsedText`: `null` → `never used`; under 2 minutes → `used just now`; under 60 minutes → `used <n> min ago`; under 48 hours → `used <n> h ago`; else `used <n> days ago` (n rounded down).
- `PROJECTOR_COMMANDS`: `['/planner layer <y|all>', 'show one layer, or all']`, `['/planner step <n|all|next>', 'show one build step, all, or the next open one']`, `['/planner reload', 'fetch the latest layout']`, `['/planner xray on|off', 'see ghosts through walls']`, `['/planner clear', 'hide the ghosts']`.
- `ProjectorPanelView` renders a `<details>` whose `<summary>` is `In-game projector`, then in order: the paragraph `See this line as ghost blocks in Minecraft and tick off build steps as you place them. Each player installs the GTNH Planner Projector mod in their own game (nothing goes on the server) and runs one command.`; a text input labelled `Who is it for?` (placeholder `e.g. Steve`) and a `Create token` button (disabled while `busy`); when `created` is set: `Paste this into Minecraft chat. The token is shown only now.`, a `<code>` with `loadCommand(projectId, created.token)` and a `Copy` button; always: `If the planner is not at the Minecraft server's address on port 8765, also run this once:`, a `<code>` with `urlCommand(origin)` and a `Copy` button; heading `Tokens`, then `Loading…` (tokens `null`), `No tokens yet.` (empty), or one `<li data-token-id>` per token: a `<span>` holding the single template string `<label> · <hint>… · by <createdBy> · <lastUsedText>` (one string, because static markup puts `<!-- -->` between adjacent text expressions) and a `Revoke` button; heading `Commands` with one `<li>` per `PROJECTOR_COMMANDS` row (`<code>command</code> — what`); `error` as `<p role="alert">`.
- `ProjectorPanel` keeps the state, loads the list the first time the `<details>` opens (`onToggle`), passes `origin = location.origin`, refreshes the list after create and revoke, asks `window.confirm('Revoke "<label>"? Anyone using it loses the ghosts until they get a new token.')` before revoking, copies with `navigator.clipboard.writeText` (on failure it selects the code text and shows `Press Ctrl+C (Cmd+C on a Mac) to copy`), and shows `ApiError.message` as `error`.

- [ ] **Step 1: Write the failing test** `tests/client/projector-panel.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectorPanelView, type ProjectorPanelViewProps } from '../../src/client/views/ProjectorPanel.tsx';
import { loadCommand, urlCommand, lastUsedText, PROJECTOR_COMMANDS } from '../../src/client/views/projector-model.ts';
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/client/projector-panel.test.tsx`
Expected: FAIL — `Cannot find module '../../src/client/views/ProjectorPanel.tsx'`.

- [ ] **Step 3: Implement** `apiDelete`, `api/projector.ts`, `projector-model.ts`, `ProjectorPanel.tsx`, and mount the panel in `ProjectPage.tsx`.

- [ ] **Step 4: Run the client tests and the typecheck**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS; `tsc -b` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/client/api/client.ts src/client/api/projector.ts src/client/views/projector-model.ts src/client/views/ProjectorPanel.tsx src/client/views/ProjectPage.tsx tests/client/projector-panel.test.tsx
git commit -m "feat(projector): in-game projector panel with token create, copy and revoke

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `projector-mod/` scaffold — template, client-only mod, config, planner URL, purity test

**Files:**
- Create from the template (`.local/examplemod-template` at `6453dec5f5f534e604887d3505ddf7125889c6f9`, the same files Plan 1 Task 9 copies, unchanged unless noted): `projector-mod/.gitignore`, `build.gradle.kts`, `settings.gradle.kts`, `gradle.properties` (edited), `repositories.gradle`, `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties`, `gradle/gradle-daemon-jvm.properties`, `src/main/resources/mcmod.info`
- Create: `projector-mod/dependencies.gradle`, `projector-mod/addon.gradle`
- Create (under `projector-mod/src/main/java/io/github/drukoz/gtnhplanner/projector/`): `ProjectorMod.java`, `CommonProxy.java`, `client/ClientProxy.java` (empty `init` for now), `config/ProjectorConfig.java`, `net/PlannerUrl.java`
- Create (under `projector-mod/src/test/java/io/github/drukoz/gtnhplanner/projector/`): `PurePackagesTest.java`, `config/ProjectorConfigTest.java`, `net/PlannerUrlTest.java`
- Modify: `.gitignore` (add `projector-mod/build/ projector-mod/.gradle/ projector-mod/run/`)

**Interfaces:**
- Produces:
  ```java
  @Mod(modid = ProjectorMod.MODID, name = "GTNH Planner Projector", version = Tags.VERSION, acceptableRemoteVersions = "*", dependencies = "after:gregtech")
  public class ProjectorMod {
      public static final String MODID = "gtnhplannerprojector";
      @SidedProxy(clientSide = "io.github.drukoz.gtnhplanner.projector.client.ClientProxy", serverSide = "io.github.drukoz.gtnhplanner.projector.CommonProxy")
      public static CommonProxy proxy;
      @Mod.EventHandler public void init(FMLInitializationEvent e) { proxy.init(e); }
  }
  public class CommonProxy { public void init(FMLInitializationEvent e) {} }          // a dedicated server does nothing
  public class ClientProxy extends CommonProxy { @Override public void init(FMLInitializationEvent e) {} }   // Task 11 fills it

  public final class ProjectorConfig {                         // package ...projector.config
      public static final String FILE_NAME = "gtnhplannerprojector.properties";
      public static ProjectorConfig load(File file);           // missing or unreadable → defaults
      public void save() throws IOException;                   // <file>.tmp, then move over the file
      public String plannerUrl(); public void setPlannerUrl(String urlOrEmpty);   // "" = automatic
      public String token(String projectId); public void setToken(String projectId, String token);   // key "token.<projectId>"; null when absent
      public int maxDistance(); public int checkIntervalTicks(); public int refreshSeconds(); public float ghostAlpha();
      public boolean seeThrough(); public void setSeeThrough(boolean on); public boolean useDisplayLists();
  }
  public final class PlannerUrl {                              // package ...projector.net
      public static final int PLANNER_PORT = 8765;
      public static String hostOf(String serverAddress);
      public static String defaultFor(String serverAddress);   // "http://" + hostOf(a) + ":8765"
      public static String effective(String override, String serverAddress);   // normalize(override) when not blank, else defaultFor
      public static String normalize(String url);              // adds "http://" without a scheme, drops trailing '/'; IllegalArgumentException("Not a planner address: <url>")
      public static String projectPath(String base, String projectId, String tail);   // base + "/api/projects/" + encode(projectId) + tail
      public static String encode(String s);                   // encodeURIComponent: URLEncoder UTF-8 with "+" → "%20"
  }
  ```

Rules:
- Config defaults and ranges (an unparseable value → default, a value out of range → clamped): `maxDistance` 96 (16…512), `checkIntervalTicks` 20 (5…200), `refreshSeconds` 60 (15…3600), `ghostAlpha` 0.4 (0.1…0.9), `seeThrough` false, `useDisplayLists` true. `save` writes every key with the header comment `GTNH Planner Projector. Each token gives access to one planner project: keep this file private.`
- `hostOf`: blank or null → `127.0.0.1`; starting with `[` → up to and including `]`; exactly one `:` → the part before it; otherwise the whole string, wrapped in `[ ]` when it contains `:` (a bare IPv6 address).
- `normalize` accepts only `http` and `https` with a non-empty host (`java.net.URI`), keeps any port and path.

- [ ] **Step 1: Copy the template, set the mod identity and the dependencies**

```bash
test -d .local/examplemod-template || git clone --quiet https://github.com/GTNewHorizons/ExampleMod1.7.10 .local/examplemod-template
git -C .local/examplemod-template checkout --quiet 6453dec5f5f534e604887d3505ddf7125889c6f9
for f in .gitignore build.gradle.kts settings.gradle.kts gradle.properties repositories.gradle gradlew gradlew.bat \
         gradle/wrapper/gradle-wrapper.jar gradle/wrapper/gradle-wrapper.properties gradle/gradle-daemon-jvm.properties \
         src/main/resources/mcmod.info; do
  mkdir -p "projector-mod/$(dirname "$f")" && cp ".local/examplemod-template/$f" "projector-mod/$f"
done
```
In `projector-mod/gradle.properties` change only `modName = GTNH Planner Projector`, `modId = gtnhplannerprojector`, `modGroup = io.github.drukoz.gtnhplanner.projector`, `generateGradleTokenClass = io.github.drukoz.gtnhplanner.projector.Tags`, `usesMavenPublishing = false`. Write `projector-mod/dependencies.gradle`:
```groovy
// GT5-Unofficial exactly as shipped in GTNH 2.9.0-RC-1 (":dev" = MCP names for compiling); the pack provides it at run time.
// Gson 2.2.4 is Minecraft 1.7.10's own copy: on the compile classpath through Minecraft, declared again for tests.
dependencies {
    compileOnly("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.183:dev")
    testImplementation("com.google.code.gson:gson:2.2.4")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.4")
}
```
and `projector-mod/addon.gradle`: `tasks.named('test') { useJUnitPlatform() }` (Plan 3's setup).

Run: `grep -h -E 'gtnhsettingsconvention|distributionUrl|toolchainVersion|^enableModernJavaSyntax|^modId' projector-mod/settings.gradle.kts projector-mod/gradle/wrapper/gradle-wrapper.properties projector-mod/gradle/gradle-daemon-jvm.properties projector-mod/gradle.properties && shasum -a 256 projector-mod/gradle/wrapper/gradle-wrapper.jar`
Expected: `version("2.0.33")`, `gradle-9.7.1-bin.zip`, `toolchainVersion=25`, `enableModernJavaSyntax = jabel`, `modId = gtnhplannerprojector`, and a wrapper hash starting `7a9ce74c` (export-mod.md §1.4).

- [ ] **Step 2: Write the failing tests**

`PurePackagesTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class PurePackagesTest {
    @Test void purePackagesDoNotTouchTheGame() throws IOException {
        Path root = Paths.get("src/main/java/io/github/drukoz/gtnhplanner/projector");
        List<String> bad = new ArrayList<>();
        for (String pkg : new String[] {"config", "net", "model", "geom", "view", "check", "session"}) {
            Path dir = root.resolve(pkg);
            if (!Files.isDirectory(dir)) continue;
            try (Stream<Path> files = Files.walk(dir)) {
                for (Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java"))::iterator)
                    for (String line : Files.readAllLines(f, StandardCharsets.UTF_8))
                        if (line.matches("^import (static )?(net\\.minecraft|net\\.minecraftforge|cpw\\.mods|gregtech)\\..*")) bad.add(f.getFileName() + ": " + line);
            }
        }
        assertEquals(Collections.emptyList(), bad);
    }
}
```

`config/ProjectorConfigTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.config;

import static org.junit.jupiter.api.Assertions.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProjectorConfigTest {
    @TempDir Path dir;

    @Test void defaultsWhenTheFileIsMissing() {
        ProjectorConfig c = ProjectorConfig.load(dir.resolve("none.properties").toFile());
        assertEquals("", c.plannerUrl());
        assertNull(c.token("P1"));
        assertEquals(96, c.maxDistance()); assertEquals(20, c.checkIntervalTicks()); assertEquals(60, c.refreshSeconds());
        assertEquals(0.4f, c.ghostAlpha(), 1e-6); assertFalse(c.seeThrough()); assertTrue(c.useDisplayLists());
    }

    @Test void savesAndLoadsTokensPerProject() throws IOException {
        File f = dir.resolve(ProjectorConfig.FILE_NAME).toFile();
        ProjectorConfig c = ProjectorConfig.load(f);
        c.setToken("P1", "gpt_one"); c.setToken("P2", "gpt_two"); c.setPlannerUrl("https://planner.example.org"); c.setSeeThrough(true);
        c.save();
        ProjectorConfig back = ProjectorConfig.load(f);
        assertEquals("gpt_one", back.token("P1")); assertEquals("gpt_two", back.token("P2"));
        assertEquals("https://planner.example.org", back.plannerUrl()); assertTrue(back.seeThrough());
        assertFalse(new File(f.getPath() + ".tmp").exists());
        assertTrue(new String(Files.readAllBytes(f.toPath()), StandardCharsets.ISO_8859_1).contains("keep this file private"));
    }

    @Test void badNumbersFallBackAndOutOfRangeValuesAreClamped() throws IOException {
        File f = dir.resolve("c.properties").toFile();
        Files.write(f.toPath(), Arrays.asList("maxDistance=lots", "checkIntervalTicks=1", "refreshSeconds=99999", "ghostAlpha=2"), StandardCharsets.ISO_8859_1);
        ProjectorConfig c = ProjectorConfig.load(f);
        assertEquals(96, c.maxDistance()); assertEquals(5, c.checkIntervalTicks()); assertEquals(3600, c.refreshSeconds());
        assertEquals(0.9f, c.ghostAlpha(), 1e-6);
    }
}
```

`net/PlannerUrlTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.net;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class PlannerUrlTest {
    @Test void defaultIsTheMinecraftServerHostOnPort8765() {
        assertEquals("http://mc.example.org:8765", PlannerUrl.defaultFor("mc.example.org:25565"));
        assertEquals("http://mc.example.org:8765", PlannerUrl.defaultFor("mc.example.org"));
        assertEquals("http://192.0.2.10:8765", PlannerUrl.defaultFor("192.0.2.10:25566"));
        assertEquals("http://[2001:db8::1]:8765", PlannerUrl.defaultFor("[2001:db8::1]:25565"));
        assertEquals("http://[2001:db8::1]:8765", PlannerUrl.defaultFor("2001:db8::1"));
        assertEquals("http://127.0.0.1:8765", PlannerUrl.defaultFor(null));
        assertEquals("http://127.0.0.1:8765", PlannerUrl.defaultFor("  "));
    }

    @Test void anOverrideWins() {
        assertEquals("https://planner.example.org/gp", PlannerUrl.effective(" https://planner.example.org/gp/ ", "mc.example.org"));
        assertEquals("http://mc.example.org:8765", PlannerUrl.effective("", "mc.example.org"));
    }

    @Test void normalizesTypedAddresses() {
        assertEquals("http://192.0.2.10:9000", PlannerUrl.normalize("192.0.2.10:9000"));
        assertEquals("https://planner.example.org", PlannerUrl.normalize("https://planner.example.org/"));
        assertEquals("Not a planner address: ftp://x", assertThrows(IllegalArgumentException.class, () -> PlannerUrl.normalize("ftp://x")).getMessage());
        assertThrows(IllegalArgumentException.class, () -> PlannerUrl.normalize("http://"));
    }

    @Test void buildsProjectPaths() {
        assertEquals("http://h:8765/api/projects/P%20x/projector", PlannerUrl.projectPath("http://h:8765", "P x", "/projector"));
        assertEquals("A%20B%C3%A9", PlannerUrl.encode("A Bé"));
    }
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test)`
Expected: FAIL — compilation errors `cannot find symbol: class ProjectorConfig` / `PlannerUrl` (the first run downloads the toolchain into `.local/gradle-home` if Plan 1 has not).

- [ ] **Step 4: Write `ProjectorMod`, `CommonProxy`, `ClientProxy`, `ProjectorConfig`, `PlannerUrl`**

- [ ] **Step 5: Run the tests, build, check reobfuscation and metadata**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test && VERSION=0.1.0 ./gradlew assemble) && exporter-mod/scripts/check-reobf.sh projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar && unzip -p projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar mcmod.info | grep -c gtnhplannerprojector && ls projector-mod/build/test-results/test/`
Expected: `BUILD SUCCESSFUL` twice, `reobf OK: <n> classes`, a count ≥ 1, and `TEST-…PurePackagesTest.xml`, `TEST-…config.ProjectorConfigTest.xml`, `TEST-…net.PlannerUrlTest.xml` (if Gradle reports no tests, move the `useJUnitPlatform()` line to the end of `dependencies.gradle`, as Plan 3 says).

- [ ] **Step 6: Commit**

```bash
git add .gitignore projector-mod
git status --short projector-mod | grep -E '/(build|\.gradle|run)/' && echo "build output staged - unstage it" || true
git commit -m "feat(projector-mod): client-only mod scaffold with config and planner address

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Payload model and parser, HTTP client, main-thread queue

**Files:**
- Create (main, package `io.github.drukoz.gtnhplanner.projector`): `model/PlannedCover.java`, `model/PlannedBlock.java`, `model/PlannedStep.java`, `model/ProjectorData.java`, `model/PayloadException.java`, `model/PayloadParser.java`, `net/Callback.java`, `net/MainThreadQueue.java`, `net/PlannerClient.java`
- Test: `model/PayloadParserTest.java`, `net/PlannerClientTest.java` (both read `projector-sample.json` from Task 3)

**Interfaces:**
- Consumes: `PlannerUrl.projectPath`, `PlannerUrl.encode` (Task 6); the payload shape (Task 1, Task 3 sample).
- Produces:
  ```java
  public final class PlannedCover { public final int face; public final String item; public final String label; }
  public final class PlannedBlock {
      public final int x, y, z; public final String id;
      public final int meta;      // -1 = do not compare
      public final int mteId;     // -1 = none
      public final int facing;    // -1 = do not compare
      public final String part;   // null unless a multipart / conduit / ME cable part
      public final String role, label;
      public final int step;      // index into ProjectorData.steps, -1 = none
      public final List<PlannedCover> covers;   // never null
  }
  public final class PlannedStep { public final String id; public final int order; public final String kind; public final String text; public final int[] blocks; public final boolean done; }
  public final class ProjectorData {
      public final String projectId, name, version, status, message; public final int rev, dim; public final int[] origin, size;
      public final List<PlannedBlock> blocks; public final List<PlannedStep> steps;
      public boolean placed();                 // "ok".equals(status)
      public int stepByOrder(int order);       // index in steps, -1 when absent
      public Set<String> doneStepIds();
  }
  public final class PayloadException extends Exception { public PayloadException(String message); }
  public final class PayloadParser { public static final String FORMAT = "gtnh-planner-projector/1"; public static ProjectorData parse(Reader json) throws PayloadException; }

  public interface Callback<T> { void done(T value); void failed(String message); }
  public final class MainThreadQueue { public void post(Runnable r); public int drain(); }   // drain runs what is queued now, returns how many
  public final class PlannerClient {
      public static final int CONNECT_TIMEOUT_MS = 5000, READ_TIMEOUT_MS = 15000, MAX_BODY_BYTES = 8 << 20;
      public PlannerClient(Executor io, MainThreadQueue main, String userAgent);
      public void fetchProjector(String base, String projectId, String token, String player, Callback<ProjectorData> cb);
      public void markStep(String base, String projectId, String token, String player, String stepId, Callback<Integer> cb);   // value = new rev
  }
  ```

Rules:
- `PayloadParser` reads with Gson 2.2.4 into private field-for-field classes, then builds the immutable model: `meta` null → −1, absent `mteId`/`facing` → −1, absent `covers` → empty list, `step` null → −1 (else its index in `steps`), absent `part` → null. Errors (exact text): not JSON or wrong types → `The planner sent something that is not a projector layout (<Gson message>)`; another `format` → `The planner sends layout format <f>; this mod reads gtnh-planner-projector/1 — update the projector mod`; then, per block `i`: `pos` not 3 numbers → `Bad projector layout: pos at block <i>`; a missing `id`, `role` or `label` → `Bad projector layout: <field> at block <i>`; `facing` or a cover `face` outside 0…5 → `Bad projector layout: facing <n> at block <i>` / `face <n> at block <i>`; a `step` id not in `steps` → `Bad projector layout: unknown step <id> at block <i>`; per step: an index outside `blocks` → `Bad projector layout: block <n> at step <id>`.
- `PlannerClient` runs each request on `io` and posts the callback to `main` (the game thread drains it each tick). Headers on every request: `Authorization: Bearer <token>`, `X-Planner-Name: <PlannerUrl.encode(player)>`, `Accept: application/json`, `User-Agent: <userAgent>`; timeouts as the constants; a body above `MAX_BODY_BYTES` → `The planner's answer is larger than 8 MiB`. `GET <base>/api/projects/<id>/projector`; `POST <base>/api/projects/<id>/ops` with `Content-Type: application/json; charset=utf-8` and body `{"ops":[{"op":"mark","row":"step:<stepId>","on":true}]}` (Gson with `disableHtmlEscaping()`, keys in that order), answer `{"rev":n}`. For a status ≥ 400 the body is read from `getErrorStream()` (it may be null).
- Error messages (`<msg>` = the server's `message` when the error body is `{error, message}`, else the first 200 characters of the body): 401 → `The planner refused this token for project <id>. Create a new one in the project's In-game projector panel and run /planner load <id> <token>`; 403 → `<msg>`; 404 → `Project <id> was not found at <base>`; 503 → `The planner is not ready: <msg>`; other non-2xx → `The planner answered HTTP <status>: <msg>`; any `IOException` → `Cannot reach the planner at <base> (<exception simple name>: <exception message>). Is it running? Set its address with /planner url <url>`; a `PayloadException` → its message.
- `MainThreadQueue.drain` takes what is queued when it starts (tasks posted while draining wait for the next drain); a task that throws `RuntimeException` is printed with `printStackTrace()` and the rest still run.

- [ ] **Step 1: Write the failing tests**

`model/PayloadParserTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.model;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

public class PayloadParserTest {
    public static String sampleText() throws IOException {
        try (InputStream in = PayloadParserTest.class.getResourceAsStream("/projector-sample.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    public static ProjectorData sample() throws Exception { return PayloadParser.parse(new StringReader(sampleText())); }
    public static String mutate(Consumer<JsonObject> f) throws IOException { JsonObject o = new JsonParser().parse(sampleText()).getAsJsonObject(); f.accept(o); return o.toString(); }
    private static String error(String json) { return assertThrows(PayloadException.class, () -> PayloadParser.parse(new StringReader(json))).getMessage(); }
    public static JsonObject block(JsonObject o, int i) { return o.getAsJsonArray("blocks").get(i).getAsJsonObject(); }

    @Test void readsTheSharedSample() throws Exception {
        ProjectorData d = sample();
        assertEquals("Pr0jectAb1", d.projectId); assertEquals("Steel line", d.name); assertEquals(7, d.rev); assertEquals(0, d.dim);
        assertTrue(d.placed()); assertNull(d.message); assertTrue(d.version.matches("[0-9a-f]{16}"));
        assertArrayEquals(new int[] {99, 64, 200}, d.origin);
        assertEquals(10, d.blocks.size()); assertEquals(10, d.steps.size());
        PlannedBlock mac = d.blocks.get(3);
        assertArrayEquals(new int[] {102, 64, 201}, new int[] {mac.x, mac.y, mac.z});
        assertEquals("gregtech:gt.blockmachines", mac.id); assertEquals(-1, mac.meta); assertEquals(201, mac.mteId); assertEquals(3, mac.facing);
        assertEquals("machine", mac.role); assertEquals("Basic Macerator", mac.label); assertEquals("layout:place:s1", d.steps.get(mac.step).id);
        assertEquals(1, mac.covers.size()); assertEquals(3, mac.covers.get(0).face); assertEquals("Conveyor Module (LV)", mac.covers.get(0).label);
        assertEquals(-1, d.blocks.get(0).facing); assertEquals(11, d.blocks.get(9).meta);
        assertEquals("ForgeMultipart:block", d.blocks.get(8).id); assertEquals("pr_rinterface", d.blocks.get(8).part);
        assertNull(d.blocks.get(4).part); assertTrue(d.blocks.get(4).covers.isEmpty());
        assertEquals(1, d.stepByOrder(2)); assertEquals(-1, d.stepByOrder(11));
        assertArrayEquals(new int[] {5, 6, 8}, d.steps.get(6).blocks);
        assertEquals(Collections.singleton("layout:place:s2"), d.doneStepIds());
    }

    @Test void readsAProjectThatIsNotPlacedYet() throws Exception {
        ProjectorData d = PayloadParser.parse(new StringReader(mutate(o -> { o.addProperty("status", "no-world"); o.addProperty("message", "Not placed"); o.add("blocks", new JsonArray()); o.add("steps", new JsonArray()); })));
        assertFalse(d.placed()); assertEquals("Not placed", d.message); assertTrue(d.blocks.isEmpty());
    }

    @Test void rejectsBrokenLayoutsInPlainWords() throws Exception {
        assertTrue(error("{").startsWith("The planner sent something that is not a projector layout ("));
        assertEquals("The planner sends layout format gtnh-planner-projector/2; this mod reads gtnh-planner-projector/1 — update the projector mod",
            error(mutate(o -> o.addProperty("format", "gtnh-planner-projector/2"))));
        assertEquals("Bad projector layout: facing 7 at block 2", error(mutate(o -> block(o, 2).addProperty("facing", 7))));
        assertEquals("Bad projector layout: pos at block 1", error(mutate(o -> { JsonArray p = new JsonArray(); p.add(new JsonPrimitive(1)); block(o, 1).add("pos", p); })));
        assertEquals("Bad projector layout: label at block 0", error(mutate(o -> block(o, 0).remove("label"))));
        assertEquals("Bad projector layout: unknown step layout:nope at block 0", error(mutate(o -> block(o, 0).addProperty("step", "layout:nope"))));
        assertEquals("Bad projector layout: block 42 at step layout:place:s2",
            error(mutate(o -> o.getAsJsonArray("steps").get(2).getAsJsonObject().getAsJsonArray("blocks").add(new JsonPrimitive(42)))));
    }
}
```

`net/PlannerClientTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.net;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.io.*;
import java.net.*;
import java.util.*;
import org.junit.jupiter.api.*;

class PlannerClientTest {
    static final class Result<T> implements Callback<T> { T value; String error; public void done(T v) { value = v; } public void failed(String m) { error = m; } }
    HttpServer server; String base; final List<String> seen = new ArrayList<>();
    final MainThreadQueue main = new MainThreadQueue();
    final PlannerClient client = new PlannerClient(Runnable::run, main, "gtnhplannerprojector/test");
    volatile int status = 200; volatile String body;

    @BeforeEach void start() throws IOException {
        body = PayloadParserTest.sampleText();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            ByteArrayOutputStream in = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n;
            while ((n = ex.getRequestBody().read(b)) > 0) in.write(b, 0, n);
            seen.add(ex.getRequestMethod() + " " + ex.getRequestURI() + " auth=" + ex.getRequestHeaders().getFirst("Authorization")
                + " name=" + ex.getRequestHeaders().getFirst("X-Planner-Name") + " type=" + ex.getRequestHeaders().getFirst("Content-Type")
                + " body=" + new String(in.toByteArray(), UTF_8));
            byte[] out = body.getBytes(UTF_8);
            ex.sendResponseHeaders(status, out.length); ex.getResponseBody().write(out); ex.close();
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
    }
    @AfterEach void stop() { server.stop(0); }
    private String fetchError(String b, String id) { Result<ProjectorData> r = new Result<>(); client.fetchProjector(b, id, "gpt_abc", "Steve", r); main.drain(); return r.error; }

    @Test void fetchesTheLayoutWithTheTokenAndAnswersOnTheGameThread() {
        Result<ProjectorData> r = new Result<>();
        client.fetchProjector(base, "Pr0jectAb1", "gpt_abc", "Steve", r);
        assertNull(r.value);
        assertEquals(1, main.drain());
        assertEquals("Steel line", r.value.name);
        assertEquals("GET /api/projects/Pr0jectAb1/projector auth=Bearer gpt_abc name=Steve type=null body=", seen.get(0));
    }

    @Test void ticksAStepWithOneMarkOp() {
        body = "{\"rev\":8}";
        Result<Integer> r = new Result<>();
        client.markStep(base, "Pr0jectAb1", "gpt_abc", "Steve Two", "layout:place:s1", r);
        main.drain();
        assertEquals(Integer.valueOf(8), r.value);
        assertEquals("POST /api/projects/Pr0jectAb1/ops auth=Bearer gpt_abc name=Steve%20Two type=application/json; charset=utf-8 "
            + "body={\"ops\":[{\"op\":\"mark\",\"row\":\"step:layout:place:s1\",\"on\":true}]}", seen.get(0));
    }

    @Test void mapsARevokedTokenAnUnknownProjectAndADeadAddressToPlainMessages() throws IOException {
        status = 401; body = "{\"error\":\"auth\"}";
        assertEquals("The planner refused this token for project P1. Create a new one in the project's In-game projector panel and run /planner load P1 <token>", fetchError(base, "P1"));
        status = 404; body = "{\"error\":\"not-found\",\"message\":\"x\"}";
        assertEquals("Project P1 was not found at " + base, fetchError(base, "P1"));
        status = 503; body = "{\"error\":\"no-export\",\"message\":\"No recipe export yet — run npm run export\"}";
        assertEquals("The planner is not ready: No recipe export yet — run npm run export", fetchError(base, "P1"));
        status = 500; body = "{\"error\":\"layout-failed\",\"message\":\"The line layout failed: boom\"}";
        assertEquals("The planner answered HTTP 500: The line layout failed: boom", fetchError(base, "P1"));
        int dead; try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) { dead = s.getLocalPort(); }
        String deadBase = "http://127.0.0.1:" + dead, e = fetchError(deadBase, "P1");
        assertTrue(e.startsWith("Cannot reach the planner at " + deadBase + " (ConnectException: "), e);
        assertTrue(e.endsWith("). Is it running? Set its address with /planner url <url>"), e);
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test --tests '*.model.*' --tests '*.net.PlannerClientTest')`
Expected: FAIL — `cannot find symbol: class PayloadParser` / `PlannerClient`.

- [ ] **Step 3: Write the model, parser, queue and client** as specified.

- [ ] **Step 4: Run all mod tests**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test)`
Expected: `BUILD SUCCESSFUL`; `build/test-results/test/` also holds `TEST-…model.PayloadParserTest.xml` and `TEST-…net.PlannerClientTest.xml`.

- [ ] **Step 5: Commit**

```bash
git add projector-mod/src
git commit -m "feat(projector-mod): payload parser and async planner client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Facing and quad math, view filter, HUD text

**Files:**
- Create (main): `geom/Facing.java`, `geom/Quads.java`, `view/ViewFilter.java`, `view/HudText.java`, `check/BlockState.java`
- Test: `geom/QuadsTest.java`, `view/ViewFilterTest.java`, `view/HudTextTest.java`

**Interfaces:**
- Consumes: `ProjectorData`, `PlannedBlock`, `PlannedStep` (Task 7); `PayloadParserTest.sample()` (Task 7, test helper).
- Produces:
  ```java
  public enum BlockState { MISSING, CORRECT, WRONG_BLOCK, WRONG_FACING, UNCHECKED, UNLOADED;
      public boolean wrong() { return this == WRONG_BLOCK || this == WRONG_FACING; } }
  public final class Facing {
      public static final String[] NAMES = {"down", "up", "north", "south", "west", "east"};
      public static boolean valid(int side); public static int opposite(int side) /* side ^ 1 */;
      public static String name(int side) /* "unknown" when not valid */; public static int[] offset(int side) /* {dx, dy, dz} */;
  }
  public final class Quads {
      public static double[] face(int side, double grow);                       // 4 corners × (x, y, z, u, v) = 20 values
      public static double[] marker(int side, double lo, double hi, double out); // a square on a face: in-plane 0 → lo, 1 → hi
  }
  public final class ViewFilter {
      public static final ViewFilter ALL;                                        // no layer, no step
      public final Integer layerY; public final int stepIndex;                   // null / -1 = all
      public ViewFilter(Integer layerY, int stepIndex);
      public ViewFilter withLayer(Integer y); public ViewFilter withStep(int stepIndex); public boolean isAll();
      public boolean shows(PlannedBlock b);
      public static boolean within(PlannedBlock b, double px, double py, double pz, double maxDistance);   // block centre
      public String describe(ProjectorData d);   // "layer y=<y>", "step <order>: <shorten(text, 40)>", both joined ", "; "" for ALL
      // equals and hashCode by value (the renderer's cache key)
  }
  public final class HudText {
      public static String shorten(String s, int max);                          // s, or its first max-1 characters + "…"
      public static String summary(ProjectorData d, BlockState[] states, ViewFilter f);
      public static String lookingAt(PlannedBlock b, BlockState s);             // null for UNLOADED
      public static String otherDimension(ProjectorData d);                     // "Planner: <name> — the line is in dimension <dim>"
  }
  ```

Rules:
- `Quads.face` uses vanilla `RenderBlocks`' corner order and texture corners (u, v: 0 = icon min, 1 = icon max). For the unit cube (`grow` = 0) the corners are:

| side | corner 1 | corner 2 | corner 3 | corner 4 |
|---|---|---|---|---|
| 0 down | 0,0,1 · 0,1 | 0,0,0 · 0,0 | 1,0,0 · 1,0 | 1,0,1 · 1,1 |
| 1 up | 1,1,1 · 1,1 | 1,1,0 · 1,0 | 0,1,0 · 0,0 | 0,1,1 · 0,1 |
| 2 north | 0,1,0 · 1,0 | 1,1,0 · 0,0 | 1,0,0 · 0,1 | 0,0,0 · 1,1 |
| 3 south | 0,1,1 · 0,0 | 0,0,1 · 0,1 | 1,0,1 · 1,1 | 1,1,1 · 1,0 |
| 4 west | 0,1,1 · 1,0 | 0,1,0 · 0,0 | 0,0,0 · 0,1 | 0,0,1 · 1,1 |
| 5 east | 1,0,1 · 0,1 | 1,0,0 · 1,1 | 1,1,0 · 1,0 | 1,1,1 · 0,0 |

  `grow` moves every 0 to `−grow` and every 1 to `1 + grow`. `marker` maps the two in-plane coordinates 0 → `lo`, 1 → `hi` and the face's own coordinate as `face` does with `grow = out`.
- `summary` counts the blocks `f.shows(b)` (distance ignored): `Planner: <name> — <correct>/<total> placed, <wrong> wrong`, then `, <n> can't be checked` when n > 0, then ` · showing <describe>` unless `f.isAll()`. `UNLOADED` blocks count only in the total.
- `lookingAt`: `<label>: ` + `placed correctly` / `wrong block here` / `wrong facing, its front should face <Facing.name(facing)>` / `not placed yet` / `can't be checked by the mod`, then `; cover: <label> on the <face name> face` per cover.

- [ ] **Step 1: Write the failing tests**

`geom/QuadsTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.geom;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class QuadsTest {
    @Test void topFaceUsesVanillaCornerOrder() {
        assertArrayEquals(new double[] {1, 1, 1, 1, 1,  1, 1, 0, 1, 0,  0, 1, 0, 0, 0,  0, 1, 1, 0, 1}, Quads.face(1, 0), 1e-9);
    }
    @Test void grownNorthFaceSitsJustOutsideTheBlock() {
        assertArrayEquals(new double[] {-0.01, 1.01, -0.01, 1, 0,  1.01, 1.01, -0.01, 0, 0,  1.01, -0.01, -0.01, 0, 1,  -0.01, -0.01, -0.01, 1, 1}, Quads.face(2, 0.01), 1e-9);
    }
    @Test void coverMarkerIsASquareOnItsFace() {
        assertArrayEquals(new double[] {0.25, 0.75, 1.02, 0, 0,  0.25, 0.25, 1.02, 0, 1,  0.75, 0.25, 1.02, 1, 1,  0.75, 0.75, 1.02, 1, 0}, Quads.marker(3, 0.25, 0.75, 0.02), 1e-9);
    }
    @Test void facingHelpers() {
        assertEquals("south", Facing.name(3)); assertEquals("unknown", Facing.name(6));
        assertEquals(2, Facing.opposite(3)); assertArrayEquals(new int[] {1, 0, 0}, Facing.offset(5));
        assertFalse(Facing.valid(-1));
    }
}
```

`view/ViewFilterTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.view;

import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ViewFilterTest {
    private static List<Integer> shown(ProjectorData d, ViewFilter f) { List<Integer> r = new ArrayList<>(); for (int i = 0; i < d.blocks.size(); i++) if (f.shows(d.blocks.get(i))) r.add(i); return r; }

    @Test void filtersByLayerAndStep() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals(10, shown(d, ViewFilter.ALL).size());
        assertEquals(Arrays.asList(7, 9), shown(d, ViewFilter.ALL.withLayer(65)));
        assertEquals(Arrays.asList(3, 4), shown(d, ViewFilter.ALL.withStep(1)));
        assertEquals(Collections.emptyList(), shown(d, ViewFilter.ALL.withLayer(65).withStep(1)));
        assertEquals("layer y=64, step 7: Lay 1× Tin Item Pipe along the middle r…", ViewFilter.ALL.withLayer(64).withStep(6).describe(d));
        assertEquals(ViewFilter.ALL.withLayer(64), new ViewFilter(64, -1));
        assertTrue(ViewFilter.ALL.withLayer(64).withLayer(null).isAll());
    }

    @Test void culledByDistanceFromTheBlockCentre() throws Exception {
        PlannedBlock b = PayloadParserTest.sample().blocks.get(3);   // 102 64 201
        assertTrue(ViewFilter.within(b, 102.5, 64.5, 297.5, 96));
        assertFalse(ViewFilter.within(b, 102.5, 64.5, 297.6, 96));
    }
}
```

`view/HudTextTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.view;

import static io.github.drukoz.gtnhplanner.projector.check.BlockState.*;
import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.model.*;
import org.junit.jupiter.api.Test;

class HudTextTest {
    static final BlockState[] STATES = {CORRECT, CORRECT, WRONG_BLOCK, CORRECT, WRONG_FACING, MISSING, MISSING, UNLOADED, UNCHECKED, MISSING};

    @Test void summarizesWhatIsShown() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals("Planner: Steel line — 3/10 placed, 2 wrong, 1 can't be checked", HudText.summary(d, STATES, ViewFilter.ALL));
        assertEquals("Planner: Steel line — 1/2 placed, 1 wrong · showing step 2: Place 2× Basic Macerator facing the mid…", HudText.summary(d, STATES, ViewFilter.ALL.withStep(1)));
        assertEquals("Planner: Steel line — 0/2 placed, 0 wrong · showing layer y=65", HudText.summary(d, STATES, ViewFilter.ALL.withLayer(65)));
        assertEquals("Planner: Steel line — the line is in dimension 0", HudText.otherDimension(d));
    }

    @Test void mentionsBlocksThatCantBeChecked() throws Exception {
        assertTrue(HudText.summary(PayloadParserTest.sample(), STATES, ViewFilter.ALL.withStep(6)).contains("0/3 placed, 0 wrong, 1 can't be checked"));
    }

    @Test void explainsTheBlockUnderTheCrosshair() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        PlannedBlock plain = d.blocks.get(4), covered = d.blocks.get(3);
        assertEquals("Basic Macerator: placed correctly", HudText.lookingAt(plain, CORRECT));
        assertEquals("Basic Macerator: wrong block here", HudText.lookingAt(plain, WRONG_BLOCK));
        assertEquals("Basic Macerator: wrong facing, its front should face south", HudText.lookingAt(plain, WRONG_FACING));
        assertEquals("Basic Macerator: can't be checked by the mod", HudText.lookingAt(plain, UNCHECKED));
        assertNull(HudText.lookingAt(plain, UNLOADED));
        assertEquals("Basic Macerator: not placed yet; cover: Conveyor Module (LV) on the south face", HudText.lookingAt(covered, MISSING));
        assertEquals("Place 2× Basic Macerator facing the mid…", HudText.shorten("Place 2× Basic Macerator facing the middle row", 40));
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test --tests '*.geom.*' --tests '*.view.*')`
Expected: FAIL — `cannot find symbol: class Quads` / `ViewFilter` / `HudText` / `BlockState`.

- [ ] **Step 3: Write `BlockState`, `Facing`, `Quads`, `ViewFilter`, `HudText`** as specified.

- [ ] **Step 4: Run all mod tests**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test)`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add projector-mod/src
git commit -m "feat(projector-mod): face quads, view filter and HUD text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Build check — matcher, per-block states, step completion and marks

**Files:**
- Create (main): `check/WorldProbe.java`, `check/Matcher.java`, `check/BuildCheck.java`, `check/StepTracker.java`
- Create (test): `check/FakeWorld.java` (test helper, used again in Task 10)
- Test: `check/MatcherTest.java`, `check/StepTrackerTest.java`

**Interfaces:**
- Consumes: `ProjectorData`, `PlannedBlock`, `PlannedStep` (Task 7); `BlockState` (Task 8); `PayloadParserTest.sample()`.
- Produces:
  ```java
  public interface WorldProbe {
      int NO_TILE = -1, NOT_SYNCED = -2;
      boolean isLoaded(int x, int y, int z);          // the client has this chunk (and 0 ≤ y < 256)
      boolean isKnownBlock(String registryName);       // the client's block registry has this name
      String blockAt(int x, int y, int z);             // registry name; null for air and replaceable blocks (tall grass, snow layer, water)
      int metaAt(int x, int y, int z);
      int mteIdAt(int x, int y, int z);                // GT MetaTileEntity id; NO_TILE when not a GT tile; NOT_SYNCED when the GT tile has no data yet
      int facingAt(int x, int y, int z);               // GT front 0..5; -1 when unknown
  }
  public final class Matcher { public static BlockState check(PlannedBlock b, WorldProbe w); }
  public final class BuildCheck {
      public BuildCheck(ProjectorData data);            // every block starts UNLOADED
      public boolean run(WorldProbe w);                 // checks every block; true when any state changed
      public BlockState state(int block); public BlockState[] states() /* the live array, do not modify */; public int version();   // version +1 per changing run
  }
  public final class StepTracker {
      public static final int STABLE_CHECKS = 2; public static final long RETRY_MS = 60_000;
      public StepTracker(ProjectorData data, Set<String> sentThisSession);   // the set outlives reloads (owned by the session)
      public boolean complete(int stepIndex, BlockState[] states);           // at least one block and all CORRECT
      public List<String> due(BlockState[] states, long nowMs);              // call once per check; returned ids are in flight
      public void sent(String stepId);                                       // the planner accepted the mark
      public void failed(String stepId, long nowMs);                         // try again no sooner than nowMs + RETRY_MS
      public void serverDone(Set<String> doneIds);                           // ticks seen in a refresh
      public boolean isDone(String stepId);                                  // planner shows it done, or sent this session
  }
  ```

Rules:
- `Matcher.check`, first match wins: not loaded → `UNLOADED`; `!isKnownBlock(b.id)` → `UNCHECKED`; `blockAt` null → `MISSING`; another registry name → `WRONG_BLOCK`; `b.meta ≥ 0` and another meta → `WRONG_BLOCK`; `b.mteId ≥ 0`: `NOT_SYNCED` → `UNLOADED`, another id (or `NO_TILE`) → `WRONG_BLOCK`; `b.facing ≥ 0` and `facingAt ≥ 0` and different → `WRONG_FACING`; else `CORRECT`. A pseudo part (`b.part != null`) is therefore checked by its container block only.
- `StepTracker.due`, per step in list order: skip it when it is done, in flight, or has no blocks; otherwise its stable count goes up by one when `complete` and back to 0 when not, and the step is returned (and marked in flight) when the count is at least `STABLE_CHECKS` and its retry time, if any, has come. `sent` adds the id to `sentThisSession`; `failed` clears in flight and sets the retry time. Ids that are not steps of this tracker's data are ignored by `sent`, `failed` and `serverDone`. Nothing ever unticks.

- [ ] **Step 1: Write the test helper and the failing tests**

`check/FakeWorld.java` (test sources):
```java
package io.github.drukoz.gtnhplanner.projector.check;

import java.util.*;

public final class FakeWorld implements WorldProbe {
    private final Map<String, Object[]> blocks = new HashMap<>();
    private final Set<String> unloaded = new HashSet<>();
    public final Set<String> known = new HashSet<>(Arrays.asList("gregtech:gt.blockmachines", "minecraft:chest", "ForgeMultipart:block", "minecraft:stone"));
    public int probes;
    private static String k(int x, int y, int z) { return x + "," + y + "," + z; }
    public FakeWorld put(int x, int y, int z, String id, int meta, int mte, int facing) { blocks.put(k(x, y, z), new Object[] {id, meta, mte, facing}); return this; }
    public FakeWorld remove(int x, int y, int z) { blocks.remove(k(x, y, z)); return this; }
    public FakeWorld unload(int x, int y, int z) { unloaded.add(k(x, y, z)); return this; }
    public boolean isLoaded(int x, int y, int z) { probes++; return !unloaded.contains(k(x, y, z)); }
    public boolean isKnownBlock(String id) { return known.contains(id); }
    public String blockAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? null : (String) b[0]; }
    public int metaAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? 0 : (Integer) b[1]; }
    public int mteIdAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? NO_TILE : (Integer) b[2]; }
    public int facingAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? -1 : (Integer) b[3]; }
    /** both Basic Macerators of step "layout:place:s1" (blocks 3 and 4 of the sample), placed right */
    public FakeWorld placeStepS1() { return put(102, 64, 201, "gregtech:gt.blockmachines", 0, 201, 3).put(103, 64, 201, "gregtech:gt.blockmachines", 0, 201, 3); }
}
```

`check/MatcherTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.check;

import static io.github.drukoz.gtnhplanner.projector.check.BlockState.*;
import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.model.*;
import org.junit.jupiter.api.Test;

class MatcherTest {
    static final String GT = "gregtech:gt.blockmachines";
    private static PlannedBlock b(int i) throws Exception { return PayloadParserTest.sample().blocks.get(i); }

    @Test void gtMachinesAreCheckedByIdAndFront() throws Exception {
        PlannedBlock mac = b(3);   // 102 64 201, mteId 201, facing 3
        assertEquals(CORRECT, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 5, 201, 3)));        // block meta is not compared
        assertEquals(WRONG_BLOCK, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 202, 3)));
        assertEquals(WRONG_FACING, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, 2)));
        assertEquals(CORRECT, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, -1)));
        assertEquals(WRONG_BLOCK, Matcher.check(mac, new FakeWorld().put(102, 64, 201, "minecraft:stone", 0, WorldProbe.NO_TILE, -1)));
        assertEquals(MISSING, Matcher.check(mac, new FakeWorld()));
    }

    @Test void aGtMachineWhoseTileDataIsNotSyncedCountsAsUnloaded() throws Exception {
        assertEquals(UNLOADED, Matcher.check(b(3), new FakeWorld().put(102, 64, 201, GT, 0, WorldProbe.NOT_SYNCED, -1)));
    }

    @Test void anUnloadedBlockIsNeitherRightNorWrong() throws Exception {
        assertEquals(UNLOADED, Matcher.check(b(3), new FakeWorld().put(102, 64, 201, "minecraft:stone", 0, -1, -1).unload(102, 64, 201)));
    }

    @Test void metaCountsOnlyWhereThePlannerAsks() throws Exception {
        FakeWorld w = new FakeWorld(); w.known.add("gregtech:gt.blockcasings");
        assertEquals(CORRECT, Matcher.check(b(9), w.put(103, 65, 203, "gregtech:gt.blockcasings", 11, -1, -1)));
        assertEquals(WRONG_BLOCK, Matcher.check(b(9), w.put(103, 65, 203, "gregtech:gt.blockcasings", 12, -1, -1)));
        assertEquals(CORRECT, Matcher.check(b(6), new FakeWorld().put(104, 64, 202, "minecraft:chest", 3, -1, -1)));
        assertEquals(CORRECT, Matcher.check(b(8), new FakeWorld().put(105, 64, 202, "ForgeMultipart:block", 0, -1, -1)));
    }

    @Test void aBlockTheClientDoesNotKnowCantBeChecked() throws Exception {
        assertEquals(UNCHECKED, Matcher.check(b(9), new FakeWorld().put(103, 65, 203, "minecraft:stone", 0, -1, -1)));
    }

    @Test void buildCheckReportsChanges() throws Exception {
        BuildCheck c = new BuildCheck(PayloadParserTest.sample());
        assertEquals(UNLOADED, c.state(0));
        FakeWorld w = new FakeWorld().placeStepS1();
        assertTrue(c.run(w)); assertEquals(1, c.version()); assertEquals(CORRECT, c.state(3)); assertEquals(MISSING, c.state(0));
        assertFalse(c.run(w)); assertEquals(1, c.version());
        assertTrue(c.run(w.remove(103, 64, 201))); assertEquals(MISSING, c.state(4)); assertEquals(2, c.version());
    }
}
```

`check/StepTrackerTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.check;

import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class StepTrackerTest {
    static final String S1 = "layout:place:s1";
    private static BlockState[] states(ProjectorData d, FakeWorld w) { BuildCheck c = new BuildCheck(d); c.run(w); return c.states(); }

    @Test void waitsForTwoCorrectChecks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] ok = states(d, new FakeWorld().placeStepS1());
        assertTrue(t.complete(1, ok));
        assertEquals(Collections.emptyList(), t.due(ok, 0));
        assertEquals(Collections.singletonList(S1), t.due(ok, 1000));
        assertEquals(Collections.emptyList(), t.due(ok, 2000));            // in flight
    }

    @Test void sendsAStepOncePerSession() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        Set<String> sent = new HashSet<>();
        StepTracker t = new StepTracker(d, sent);
        BlockState[] ok = states(d, new FakeWorld().placeStepS1());
        t.due(ok, 0); t.due(ok, 1); t.sent(S1);
        assertTrue(t.isDone(S1)); assertEquals(Collections.singleton(S1), sent);
        StepTracker again = new StepTracker(d, sent);                       // after a reload
        again.due(ok, 2); assertEquals(Collections.emptyList(), again.due(ok, 3));
    }

    @Test void resetsWhenABlockBreaksBetweenChecks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        FakeWorld w = new FakeWorld().placeStepS1();
        t.due(states(d, w), 0);
        t.due(states(d, w.remove(103, 64, 201)), 1);
        w.placeStepS1();
        assertEquals(Collections.emptyList(), t.due(states(d, w), 2));
        assertEquals(Collections.singletonList(S1), t.due(states(d, w), 3));
    }

    @Test void neverCompletesAStepWithUnloadedBlocks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertFalse(new StepTracker(d, new HashSet<>()).complete(1, states(d, new FakeWorld().placeStepS1().unload(103, 64, 201))));
        assertFalse(new StepTracker(d, new HashSet<>()).complete(0, states(d, new FakeWorld())));   // layout:site has no blocks
    }

    @Test void neverCompletesAStepWithAnUncheckedBlock() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        FakeWorld w = new FakeWorld().put(103, 65, 203, "gregtech:gt.blockcasings", 11, -1, -1);   // block 9: a name this client does not know
        assertFalse(new StepTracker(d, new HashSet<>()).complete(2, states(d, w)));
        BlockState[] s = states(d, new FakeWorld().placeStepS1());
        s[4] = BlockState.UNCHECKED;
        assertFalse(new StepTracker(d, new HashSet<>()).complete(1, s));
    }

    @Test void doesNotSendAStepThePlannerAlreadyShowsDone() throws Exception {
        ProjectorData d = PayloadParserTest.sample();                        // layout:place:s2 is done in the sample
        FakeWorld w = new FakeWorld(); w.known.add("gregtech:gt.blockcasings"); w.put(103, 65, 203, "gregtech:gt.blockcasings", 11, -1, -1).placeStepS1();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] s = states(d, w);
        t.due(s, 0);
        assertEquals(Collections.singletonList(S1), t.due(s, 1));
        t.serverDone(new HashSet<>(Arrays.asList(S1, "layout:gone")));
        assertTrue(t.isDone(S1));
    }

    @Test void retriesAFailedSendAfterAMinute() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] ok = states(d, new FakeWorld().placeStepS1());
        t.due(ok, 0); t.due(ok, 1_000); t.failed(S1, 1_000);
        assertEquals(Collections.emptyList(), t.due(ok, 60_999));
        assertEquals(Collections.singletonList(S1), t.due(ok, 61_000));
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test --tests '*.check.*')`
Expected: FAIL — `cannot find symbol: class Matcher` / `BuildCheck` / `StepTracker`.

- [ ] **Step 3: Write `WorldProbe`, `Matcher`, `BuildCheck`, `StepTracker`** as specified.

- [ ] **Step 4: Run all mod tests**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test)`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add projector-mod/src
git commit -m "feat(projector-mod): world-vs-plan matcher and step completion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Session and command parser — load, refresh, check cadence, marks, filters, HUD lines

**Files:**
- Create (main): `net/PlannerApi.java`, `session/Command.java`, `session/CommandException.java`, `session/CommandParser.java`, `session/ProjectorSession.java`
- Modify: `net/PlannerClient.java` (Task 7) — `implements PlannerApi`, nothing else
- Test: `session/CommandParserTest.java`, `session/ProjectorSessionTest.java`

**Interfaces:**
- Consumes: `ProjectorConfig`, `PlannerUrl` (Task 6); `Callback`, `PlannerClient`, `ProjectorData`, `PayloadParser` (Task 7); `ViewFilter`, `HudText`, `BlockState` (Task 8); `WorldProbe`, `BuildCheck`, `StepTracker` (Task 9); test helpers `PayloadParserTest.sample()/mutate()/block()`, `FakeWorld`.
- Produces:
  ```java
  public interface PlannerApi {                                   // package ...projector.net
      void fetchProjector(String base, String projectId, String token, String player, Callback<ProjectorData> cb);
      void markStep(String base, String projectId, String token, String player, String stepId, Callback<Integer> cb);
  }
  public final class Command {
      public enum Kind { LOAD, CLEAR, LAYER, STEP, RELOAD, URL, XRAY, HELP }
      public final Kind kind; public final String projectId, token, step, url; public final Integer layer; public final Boolean on;
      public static Command load(String projectId, String tokenOrNull); public static Command clear(); public static Command layer(Integer yOrNull);
      public static Command step(String nAllOrNext); public static Command reload(); public static Command url(String urlOrAuto);
      public static Command xray(Boolean onOrNullToToggle); public static Command help();
  }
  public final class CommandException extends Exception { public CommandException(String message); }
  public final class CommandParser {
      public static final String USAGE = "/planner load <project> [token] | clear | layer <y|all> | step <n|all|next> | reload | url <url|auto> | xray [on|off]";
      public static Command parse(String[] args) throws CommandException;
  }
  public final class ProjectorSession {
      public interface Env { String serverAddress(); String playerName(); int dimension(); long nowMs(); void chat(String message); }
      public static final String PREFIX = "[Planner] ";
      public ProjectorSession(ProjectorConfig config, PlannerApi api, Env env);
      public void run(Command c);                       // chat answers are PREFIX + text
      public void tick(WorldProbe probe, long tick);    // every client tick (END phase)
      public void disconnected();                       // forget the loaded line, keep config and the sent-steps set
      public ProjectorData data(); public BlockState[] states(); public ViewFilter filter(); public boolean seeThrough();
      public boolean visibleHere();                     // a placed line in the player's dimension
      public int renderVersion();                       // +1 whenever data, filter, a block state or see-through changes
      public List<String> hudLines();                   // [] when nothing is loaded
      public String lookingAt(int x, int y, int z);     // HudText.lookingAt for a shown planned block there, else null
      public String lastError();
      public void setRenderError(String messageOrNull); // the renderer's failure text (Task 11), shown on the HUD
  }
  ```

Rules:
- `CommandParser` (sub-command case-insensitive): no argument or `help` → HELP; `load <project> [token]` (project `[A-Za-z0-9_-]{1,40}`, else `That does not look like a project id: <x>`; a token not starting `gpt_` → `That does not look like a planner token (they start with gpt_)`); `clear`; `layer <y|all>` (0…255, else `Layer must be a number from 0 to 255, or all`); `step <n|all|next>` (n ≥ 1, else `Step must be a number, all or next`); `reload`; `url <url|auto>`; `xray [on|off]`. A wrong number of arguments → `Usage: /planner load <project> [token]` (and likewise `layer <y|all>`, `step <n|all|next>`, `url <url|auto>`, `xray [on|off]`); unknown → `Unknown /planner command "<x>". Usage: <USAGE>`.
- Chat texts (each sent as `PREFIX + text`):

| When | Text |
|---|---|
| load, no token given or saved | `No token saved for project <id>. Copy the /planner load command from the project's In-game projector panel.` |
| load starts (token saved to config first) | `Loading project <id> from <base>…` (`base = PlannerUrl.effective(config.plannerUrl(), env.serverAddress())`) |
| loaded, placed | `Loaded "<name>": <n> blocks in <k> build steps. Showing all layers.` (+ ` The line is in dimension <dim>; you are in <cur>.` when they differ; k = steps with blocks) |
| loaded, not placed | `"<name>": <message>` |
| any fetch or command failure | the error message itself |
| reload / layer / step with nothing loaded | `Nothing loaded. Use /planner load <project>.` |
| reload | `Reloading "<name>"…`, then `No changes.` (same version) or `Updated "<name>": <n> blocks in <k> build steps.` |
| clear | `Ghosts cleared.` |
| layer | `Showing layer y=<y> (<n> blocks).` (n = blocks the new filter shows) / `Showing all layers.` |
| step | `Showing step <n>: <text>` / `Showing all steps.` / `There is no step <n> (the steps are numbered 1 to <max order>).` / `Step <n> has no blocks to show: <text>` (filter unchanged) / for `next` with none open: `Every build step with blocks is done.` |
| url | `Planner address: <effective>` |
| xray | `See-through ghosts on.` / `See-through ghosts off.` |
| a mark accepted | `Step <order> done: <HudText.shorten(text, 60)> (ticked as <player>)` |
| a mark failed | `Could not tick step <order>: <message>` (once per distinct message) |
| a refresh brought a new version | `The line changed in the planner: reloaded "<name>".` |
| config save failed | `Could not save the projector config: <message>` |

- Installing data (load, or a refresh/reload with another `version`): new `BuildCheck`, new `StepTracker(data, sentThisSession)` (the set lives as long as the session), a position → block index map, `lastError = null`, `renderVersion + 1`; the filter becomes `ViewFilter.ALL` on load and keeps only its layer on a refresh (step indices change). A refresh with the same version only calls `tracker.serverDone(data.doneStepIds())`.
- `tick(probe, tick)`, in order: nothing loaded → return; when no fetch is running and `now − lastFetchStart ≥ refreshSeconds × 1000` → a quiet refresh (a failure sets `lastError`, chats nothing, keeps the data; the next try waits another `refreshSeconds`); not placed or another dimension → return; `tick % checkIntervalTicks != 0` → return; `if (check.run(probe)) renderVersion++`; for each `tracker.due(states, now)` → `api.markStep(...)`, whose answer calls `sent` or `failed` on the tracker that asked (a late answer for a replaced layout touches only that old tracker and the shared sent set).
- `next` = the lowest-order step with blocks that `tracker.isDone` says is not done.
- `hudLines`: `[]` when nothing is loaded; not placed → `Planner: <name> — <message>`; another dimension → `HudText.otherDimension(d)`; else `HudText.summary(d, states, filter)`; then, when `lastError` is set, `Planner: ` + `HudText.shorten(lastError, 90)`; then, when a render error is set, `Planner: <render error>`.

- [ ] **Step 1: Write the failing tests**

`session/CommandParserTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.session;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class CommandParserTest {
    private static Command p(String... a) throws CommandException { return CommandParser.parse(a); }
    private static String err(String... a) { return assertThrows(CommandException.class, () -> CommandParser.parse(a)).getMessage(); }

    @Test void parsesEverySubcommand() throws Exception {
        Command c = p("load", "Pr0jectAb1", "gpt_abc");
        assertEquals(Command.Kind.LOAD, c.kind); assertEquals("Pr0jectAb1", c.projectId); assertEquals("gpt_abc", c.token);
        assertNull(p("LOAD", "P1").token);
        assertEquals(Integer.valueOf(65), p("layer", "65").layer);
        assertEquals(Command.Kind.LAYER, p("layer", "all").kind); assertNull(p("layer", "all").layer);
        assertEquals("next", p("step", "next").step); assertEquals("3", p("step", "3").step);
        assertEquals(Command.Kind.HELP, p().kind); assertEquals(Command.Kind.RELOAD, p("reload").kind);
        assertEquals(Boolean.FALSE, p("xray", "off").on); assertNull(p("xray").on);
        assertEquals("auto", p("url", "auto").url);
    }

    @Test void explainsMistakes() {
        assertEquals("That does not look like a planner token (they start with gpt_)", err("load", "P1", "abc"));
        assertEquals("That does not look like a project id: ../x", err("load", "../x"));
        assertEquals("Layer must be a number from 0 to 255, or all", err("layer", "300"));
        assertEquals("Step must be a number, all or next", err("step", "0"));
        assertEquals("Usage: /planner load <project> [token]", err("load"));
        assertEquals("Unknown /planner command \"fly\". Usage: " + CommandParser.USAGE, err("fly"));
    }
}
```

`session/ProjectorSessionTest.java`:
```java
package io.github.drukoz.gtnhplanner.projector.session;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.JsonNull;
import io.github.drukoz.gtnhplanner.projector.check.FakeWorld;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.model.*;
import io.github.drukoz.gtnhplanner.projector.net.*;
import java.io.StringReader;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class ProjectorSessionTest {
    static final class FakeApi implements PlannerApi {
        final List<String> calls = new ArrayList<>(); final Deque<Callback<ProjectorData>> fetches = new ArrayDeque<>(); final Deque<Callback<Integer>> marks = new ArrayDeque<>();
        public void fetchProjector(String base, String id, String token, String player, Callback<ProjectorData> cb) { calls.add("fetch " + base + " " + id + " " + token + " " + player); fetches.add(cb); }
        public void markStep(String base, String id, String token, String player, String stepId, Callback<Integer> cb) { calls.add("mark " + id + " " + stepId + " " + player); marks.add(cb); }
        long markCalls() { return calls.stream().filter(c -> c.startsWith("mark ")).count(); }
    }
    @TempDir Path dir;
    final List<String> chat = new ArrayList<>(); final FakeApi api = new FakeApi();
    int dim = 0; long now = 1_000_000;
    ProjectorSession s;
    final ProjectorSession.Env env = new ProjectorSession.Env() {
        public String serverAddress() { return "mc.example.org:25565"; } public String playerName() { return "Steve"; }
        public int dimension() { return dim; } public long nowMs() { return now; } public void chat(String m) { chat.add(m); } };

    @BeforeEach void setUp() { s = new ProjectorSession(ProjectorConfig.load(dir.resolve("c.properties").toFile()), api, env); }
    private void loadSample() throws Exception { s.run(Command.load("Pr0jectAb1", "gpt_abc")); api.fetches.poll().done(PayloadParserTest.sample()); }
    private String last() { return chat.get(chat.size() - 1); }
    private void placeAndCheck(FakeWorld w) { s.tick(w, 0); s.tick(w, 20); }

    @Test void loadSavesTheTokenAndShowsTheLine() throws Exception {
        loadSample();
        assertEquals("gpt_abc", ProjectorConfig.load(dir.resolve("c.properties").toFile()).token("Pr0jectAb1"));
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(0));
        assertEquals(Arrays.asList("[Planner] Loading project Pr0jectAb1 from http://mc.example.org:8765…",
            "[Planner] Loaded \"Steel line\": 10 blocks in 7 build steps. Showing all layers."), chat);
        assertTrue(s.visibleHere());
        assertEquals(Collections.singletonList("Planner: Steel line — 0/10 placed, 0 wrong"), s.hudLines());
        s.run(Command.load("Pr0jectAb1", null));
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(1));   // the saved token
    }

    @Test void loadWithoutATokenSaysWhereToGetOne() {
        s.run(Command.load("P9", null));
        assertEquals("[Planner] No token saved for project P9. Copy the /planner load command from the project's In-game projector panel.", last());
        assertTrue(api.calls.isEmpty());
    }

    @Test void drawsNothingInAnotherDimension() throws Exception {
        dim = 7;
        loadSample();
        assertTrue(last().endsWith(" The line is in dimension 0; you are in 7."));
        assertFalse(s.visibleHere());
        FakeWorld w = new FakeWorld();
        placeAndCheck(w);
        assertEquals(0, w.probes);
        assertEquals(Collections.singletonList("Planner: Steel line — the line is in dimension 0"), s.hudLines());
    }

    @Test void ticksAStepAfterTwoChecksAndTellsThePlayer() throws Exception {
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        s.tick(w, 0); s.tick(w, 10);
        assertEquals(0, api.markCalls());
        s.tick(w, 20);
        assertEquals("mark Pr0jectAb1 layout:place:s1 Steve", api.calls.get(1));
        api.marks.poll().done(8);
        assertEquals("[Planner] Step 2 done: Place 2× Basic Macerator facing the middle row (ticked as Steve)", last());
        s.tick(w, 40); s.tick(w, 60);
        assertEquals(1, api.markCalls());
        assertTrue(s.hudLines().get(0).startsWith("Planner: Steel line — 2/10 placed"));
        assertEquals("Basic Macerator: placed correctly; cover: Conveyor Module (LV) on the south face", s.lookingAt(102, 64, 201));
        assertNull(s.lookingAt(0, 0, 0));
    }

    @Test void keepsTheLoadedGhostsWhenARefreshFails() throws Exception {
        loadSample();
        now += 60_000;
        s.tick(new FakeWorld(), 1);
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(1));
        api.fetches.poll().failed("Cannot reach the planner at http://mc.example.org:8765 (ConnectException: Connection refused). Is it running? Set its address with /planner url <url>");
        assertTrue(s.visibleHere());
        assertTrue(s.hudLines().get(1).startsWith("Planner: Cannot reach the planner at http://mc.example.org:8765"));
        int chatted = chat.size();
        now += 1_000; s.tick(new FakeWorld(), 2);
        assertEquals(2, api.calls.size());                          // no retry loop
        assertEquals(chatted, chat.size());                         // a background refresh never spams chat
    }

    @Test void replacesTheLayoutWhenTheVersionChangesAndDropsMarksForVanishedSteps() throws Exception {
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        placeAndCheck(w);                                           // the mark for layout:place:s1 is in flight
        ProjectorData changed = PayloadParser.parse(new StringReader(PayloadParserTest.mutate(o -> {
            o.addProperty("version", "ffffffffffffffff");
            o.getAsJsonArray("steps").remove(1);
            PayloadParserTest.block(o, 3).add("step", JsonNull.INSTANCE);
            PayloadParserTest.block(o, 4).add("step", JsonNull.INSTANCE);
        })));
        now += 60_000;
        s.tick(w, 21);
        api.fetches.poll().done(changed);
        assertEquals("[Planner] The line changed in the planner: reloaded \"Steel line\".", last());
        api.marks.poll().done(9);                                   // the old answer arrives late: nothing breaks
        s.tick(w, 40); s.tick(w, 60); s.tick(w, 80);
        assertEquals(1, api.markCalls());
        assertEquals(-1, s.data().stepByOrder(2));
    }

    @Test void stepAndLayerFilters() throws Exception {
        loadSample();
        s.run(Command.step("next"));
        assertEquals("[Planner] Showing step 2: Place 2× Basic Macerator facing the middle row", last());
        assertEquals(1, s.filter().stepIndex);
        placeAndCheck(new FakeWorld().placeStepS1()); api.marks.poll().done(8);
        s.run(Command.step("next"));                                // step 3 is done in the sample, step 2 now too
        assertEquals("[Planner] Showing step 4: Place 1× Low Voltage Transformer between the MV and LV cables, front (input) toward MV", last());
        s.run(Command.step("1"));
        assertEquals("[Planner] Step 1 has no blocks to show: Clear a 7×4 spot (2 high) and keep a 1-block path around it", last());
        s.run(Command.step("12"));
        assertEquals("[Planner] There is no step 12 (the steps are numbered 1 to 10).", last());
        s.run(Command.step("all")); s.run(Command.layer(65));
        assertEquals("[Planner] Showing layer y=65 (2 blocks).", last());
    }

    @Test void showsARenderFailureOnTheHud() throws Exception {
        loadSample();
        s.setRenderError("Ghost drawing failed: boom");
        assertEquals("Planner: Ghost drawing failed: boom", s.hudLines().get(s.hudLines().size() - 1));
        s.setRenderError(null);
        assertEquals(1, s.hudLines().size());
    }

    @Test void urlXrayReloadAndClear() throws Exception {
        s.run(Command.reload());
        assertEquals("[Planner] Nothing loaded. Use /planner load <project>.", last());
        s.run(Command.url("192.0.2.10:9000"));
        assertEquals("[Planner] Planner address: http://192.0.2.10:9000", last());
        assertEquals("http://192.0.2.10:9000", ProjectorConfig.load(dir.resolve("c.properties").toFile()).plannerUrl());
        s.run(Command.url("auto"));
        assertEquals("[Planner] Planner address: http://mc.example.org:8765", last());
        int v = s.renderVersion();
        s.run(Command.xray(null));
        assertEquals("[Planner] See-through ghosts on.", last());
        assertTrue(s.seeThrough()); assertTrue(s.renderVersion() > v);
        loadSample();
        s.run(Command.reload());
        assertEquals("[Planner] Reloading \"Steel line\"…", last());
        api.fetches.poll().done(PayloadParserTest.sample());
        assertEquals("[Planner] No changes.", last());
        s.run(Command.clear());
        assertEquals("[Planner] Ghosts cleared.", last());
        assertNull(s.data()); assertEquals(Collections.emptyList(), s.hudLines());
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test --tests '*.session.*')`
Expected: FAIL — `cannot find symbol: class CommandParser` / `ProjectorSession` / `PlannerApi`.

- [ ] **Step 3: Write `PlannerApi`, `Command`, `CommandException`, `CommandParser`, `ProjectorSession`; make `PlannerClient` implement `PlannerApi`.**

- [ ] **Step 4: Run all mod tests**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test)`
Expected: `BUILD SUCCESSFUL`; `PurePackagesTest` still passes (nothing in `session` imports the game).

- [ ] **Step 5: Commit**

```bash
git add projector-mod/src
git commit -m "feat(projector-mod): projector session and /planner command parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Minecraft glue — world probe, block and GT machine icons, ghost renderer, HUD, `/planner` command, events

**Files:**
- Modify: `client/ClientProxy.java` (Task 6)
- Create (main, package `…projector.client`): `ClientEvents.java`, `McEnv.java`, `McWorldProbe.java`, `FaceIcons.java`, `BlockIcons.java`, `GtMachineIcons.java`, `GhostRenderer.java`, `HudOverlay.java`, `PlannerCommand.java`
- No unit tests (this package needs a running client); proven by the `javap` checks, the build, `check-reobf.sh`, `PurePackagesTest` and Task 12.

**Interfaces:**
- Consumes: everything in Tasks 6–10: `ProjectorConfig`, `PlannerUrl`, `PlannerClient`, `MainThreadQueue`, `ProjectorSession` (+ `Env`), `CommandParser`, `CommandException`, `WorldProbe`, `BlockState`, `ViewFilter`, `Quads`, `PlannedBlock`, `PlannedCover`, `ProjectorData`.
- Produces (nothing later code calls; the names are for the reviewer):
  ```java
  public class ClientProxy extends CommonProxy { @Override public void init(FMLInitializationEvent e); }
  public final class ClientEvents { @SubscribeEvent public void onTick(TickEvent.ClientTickEvent e); @SubscribeEvent public void onDisconnect(FMLNetworkEvent.ClientDisconnectionFromServerEvent e); }
  public final class McEnv implements ProjectorSession.Env { }
  public final class McWorldProbe implements WorldProbe { public McWorldProbe(World world); }
  public final class FaceIcons { public final IIcon[][] layers /* [side][layer], never empty */; public final float r, g, b /* tint, 1 = none */; }
  public final class BlockIcons { public FaceIcons forBlock(PlannedBlock b); public void clear(); }
  final class GtMachineIcons { static IIcon[][] faces(int mteId, int facing); }   // null when GT cannot draw it
  public final class GhostRenderer { @SubscribeEvent public void onRenderLast(RenderWorldLastEvent e); }
  public final class HudOverlay { @SubscribeEvent public void onText(RenderGameOverlayEvent.Text e); }
  public final class PlannerCommand extends CommandBase { }   // "planner", permission level 0, always usable
  ```

Rules:
- **Wiring** (`ClientProxy.init`, client side only): `config = ProjectorConfig.load(new File(Loader.instance().getConfigDir(), ProjectorConfig.FILE_NAME))`; one daemon thread `Executors.newSingleThreadExecutor` named `GTNH Planner projector HTTP`; `client = new PlannerClient(io, queue, "gtnhplannerprojector/" + Tags.VERSION)`; `session = new ProjectorSession(config, client, new McEnv())`; `ClientCommandHandler.instance.registerCommand(new PlannerCommand(session))`; `GhostRenderer` and `HudOverlay` on `MinecraftForge.EVENT_BUS`; `ClientEvents` on `FMLCommonHandler.instance().bus()` (FML's bus carries tick and network events). Nothing else runs on a dedicated server (`CommonProxy` is empty).
- **ClientEvents**: on `ClientTickEvent` phase `END`: `queue.drain()`; then, when `mc.theWorld` and `mc.thePlayer` are set, `session.tick(probeFor(mc.theWorld), tickCounter++)` (one `McWorldProbe` per world instance, so a dimension change gets a new one). `ClientDisconnectionFromServerEvent` fires on the network thread, so it only does `queue.post(session::disconnected)` (and `icons.clear()`).
- **McEnv**: `serverAddress` = `mc.func_147104_D()` (`getCurrentServerData`) `.serverIP`, or null in single player; `playerName` = `mc.getSession().getUsername()`; `dimension` = `mc.theWorld.provider.dimensionId` (`Integer.MIN_VALUE` without a world); `nowMs` = `System.currentTimeMillis()`; `chat` = `mc.thePlayer.addChatMessage(new ChatComponentText(...))` with the `[Planner] ` prefix in `EnumChatFormatting.GOLD` (dropped when there is no player).
- **McWorldProbe**: `isLoaded` = `0 ≤ y < 256` and `!world.getChunkFromChunkCoords(x >> 4, z >> 4).isEmpty()` (the client's chunk provider answers `chunkExists` with true for every chunk, so the empty-chunk test is the real one); `blockAt` = null when `block.isAir(world, x, y, z)` or `block.getMaterial().isReplaceable()`, else `GameData.getBlockRegistry().getNameForObject(block)`; `isKnownBlock` = `GameData.getBlockRegistry().containsKey(name)`; `mteIdAt`: a tile that is an `IGregTechTileEntity` → `getMetaTileEntity() == null ? NOT_SYNCED : getMetaTileID()`; no tile on a `gregtech:gt.blockmachines` block → `NOT_SYNCED`; else `NO_TILE`; `facingAt`: a `BaseMetaTileEntity` → `getFrontFacing().ordinal()` when 0…5, else −1. Every method catches `Throwable` and answers as for an unloaded block (`isLoaded` false; the others `null`/`NO_TILE`/−1).
- **BlockIcons** (cache by `id@meta@mteId@facing`, cleared on disconnect): a GT machine block (`mteId ≥ 0`) → `GtMachineIcons.faces(mteId, facing < 0 ? 3 : facing)`; a `part` block or an id the registry does not have → the fallback; any other block → per side `block.getIcon(side, max(meta, 0))`. Missing or null icons → the fallback: every face = `Blocks.stained_hardened_clay.getIcon(0, 0)` (white) tinted by role — machine (70, 130, 180), hatch (150, 150, 90), casing (120, 120, 120), transformer (200, 140, 40), cable (60, 60, 60), pipe (140, 140, 160), interface (126, 87, 194), chip_pipe (255, 112, 67), chest (160, 110, 50), anything else (200, 200, 200) — the spec's "plain colour by kind" (§3.8).
- **GtMachineIcons** (research textures-icons §3.5): `proto = GregTechAPI.METATILEENTITIES[mteId]` (null → null); `te = new BaseMetaTileEntity(); te.setInitialValuesAsNBT(null, (short) mteId); mte = te.getMetaTileEntity()`; per side `s`: `mte.getTexture(te, ForgeDirection.getOrientation(s), ForgeDirection.getOrientation(facing), -1, false, false)` flattened to icons: `GTMultiTextureRender` → each of `mTextures` in order; `GTSidedTextureRender` → `mTextures[s]`; `GTRenderedTexture` → `mIconContainer.getIcon()` then `mIconContainer.getOverlayIcon()` when not null; `GTCopiedBlockTextureRender` / `GTCopiedCTMBlockTexture` → `mBlock.getIcon(mSide, mMeta)`; anything else → nothing. Fields are read by reflection (`getDeclaredField` + `setAccessible(true)`, looked up once). Any `Throwable` → null (the prototype is never put into a world; GT's own renderer, which needs `ISBRContext`, is never called).
- **GhostRenderer** (`RenderWorldLastEvent`): return unless `session.visibleHere()`. Camera = `mc.renderViewEntity` interpolated with `e.partialTicks`. Rebuild the geometry when any of `session.renderVersion()`, the camera's 8-block cell (`floor(pos / 8)`), `ghostAlpha` changes; geometry = for every block with `filter.shows(b)` and `ViewFilter.within(b, camera, maxDistance)`, quads at `block − data.origin` from `Quads` with per-quad `setColorRGBA_F`: `MISSING`/`UNLOADED` → its icons, tint × 1, alpha `ghostAlpha`, `grow` 0; `UNCHECKED` → tint × (0.6, 0.75, 1), alpha `ghostAlpha`; `CORRECT` → (0.3, 1, 0.3), alpha 0.45, `grow` 0.004; `WRONG_BLOCK`/`WRONG_FACING` → (1, 0.25, 0.25), alpha 0.65, `grow` 0.004; then the covers (spec §3.13 "covers on their faces"): one `Quads.marker(face, 0.15, 0.85, 0.012)` per cover, textured with the cover item's own icon — item key `registry@meta` (a `#…` suffix dropped) → `GameData.getItemRegistry().getObject(registry)` → `item.getIconFromDamage(meta)` — in a second batch on the items atlas, colour (1, 1, 1, 0.85); a cover whose item or icon cannot be resolved becomes a (0.55, 0.75, 1, 0.8) marker with the white fallback icon in the block batch. With `useDisplayLists` each batch goes between `glNewList(list, GL_COMPILE)` and `glEndList()` (two lists from `GLAllocation.generateDisplayLists(2)`, reused: blocks, covers) and contains only Tessellator geometry and colour — no GL state changes — so Angelica's display-list recorder can replay them; without it, the same quads are emitted every frame. Drawing: save `glIsEnabled` of `GL_BLEND`, `GL_LIGHTING`, `GL_CULL_FACE`, `GL_DEPTH_TEST`, `GL_ALPHA_TEST`; `mc.entityRenderer.disableLightmap(e.partialTicks)`; enable blend with `OpenGlHelper.glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, 1, 0)`; disable lighting and culling; `glDepthMask(false)`; disable the depth test when `session.seeThrough()`; `glPushMatrix(); glTranslated(origin − camera)`; bind `TextureMap.locationBlocksTexture` and call the block list (or emit); bind `TextureMap.locationItemsTexture` and call the cover list (or emit); `glPopMatrix()`; restore every saved flag, `glDepthMask(true)`, `glColor4f(1, 1, 1, 1)`, `enableLightmap`. Any `Throwable` while building disables the projector's drawing for the session and calls `session.setRenderError("Ghost drawing failed: <message> — try useDisplayLists=false in config/gtnhplannerprojector.properties")`.
- **HudOverlay** (`RenderGameOverlayEvent.Text`): add `session.hudLines()` to `e.left`; when `mc.objectMouseOver` is a block hit, add `session.lookingAt` of that block, else of the block in front of the hit face (where a missing block would go), when either is not null.
- **PlannerCommand**: `getCommandName` `planner`; `getCommandUsage` `CommandParser.USAGE`; `processCommand` → `session.run(CommandParser.parse(args))`, a `CommandException` → chat `[Planner] <message>`; `canCommandSenderUseCommand` true; `getRequiredPermissionLevel` 0; tab completion: first word from `load clear layer step reload url xray`, then `all`/`next` after `step`, `all` after `layer`, `on`/`off` after `xray`.

- [ ] **Step 1: Check the GT members this task uses**

Run (repo root, `$GTDEV` from Plan 1 "Conventions"):
```bash
export GRADLE_USER_HOME="$PWD/.local/gradle-home"
GTDEV=$(find "$GRADLE_USER_HOME/caches/modules-2" -name 'GT5-Unofficial-5.09.54.183-dev.jar' | head -1)
javap -cp "$GTDEV" gregtech.api.metatileentity.BaseMetaTileEntity | grep -E 'BaseMetaTileEntity\(\);|setInitialValuesAsNBT|getFrontFacing\(\)|IMetaTileEntity getMetaTileEntity\(\)'
javap -cp "$GTDEV" gregtech.api.interfaces.metatileentity.IMetaTileEntity | grep ' getTexture('
javap -cp "$GTDEV" gregtech.api.interfaces.tileentity.IGregTechTileEntity | grep -E 'getMetaTileID|getMetaTileEntity'
javap -p -cp "$GTDEV" gregtech.common.render.GTMultiTextureRender gregtech.common.render.GTSidedTextureRender gregtech.common.render.GTRenderedTexture gregtech.common.render.GTCopiedBlockTextureRender gregtech.common.render.GTCopiedCTMBlockTexture | grep -E ' (mTextures|mIconContainer|mBlock|mSide|mMeta);'
javap -cp "$GTDEV" gregtech.api.interfaces.IIconContainer | grep -E 'getIcon\(\)|getOverlayIcon\(\)'
javap -cp "$GTDEV" gregtech.api.GregTechAPI | grep METATILEENTITIES
```
Expected (checked against the 5.09.54.183 jar while writing this plan): `public gregtech.api.metatileentity.BaseMetaTileEntity();`, `public void setInitialValuesAsNBT(net.minecraft.nbt.NBTTagCompound, short);`, `public net.minecraftforge.common.util.ForgeDirection getFrontFacing();`, `public final gregtech.api.interfaces.metatileentity.IMetaTileEntity getMetaTileEntity();`; `getTexture(gregtech.api.interfaces.tileentity.IGregTechTileEntity, net.minecraftforge.common.util.ForgeDirection, net.minecraftforge.common.util.ForgeDirection, int, boolean, boolean)`; `getMetaTileID()` and `getMetaTileEntity()`; `protected final gregtech.api.interfaces.ITexture[] mTextures;` (twice), `protected final gregtech.api.interfaces.IIconContainer mIconContainer;`, `private final net.minecraft.block.Block mBlock;`, `private final byte mSide;`, `private final int mMeta;` (twice each); `getIcon()` and `getOverlayIcon()`; `public static final gregtech.api.interfaces.metatileentity.IMetaTileEntity[] METATILEENTITIES;`. A missing line means GT moved a member: adapt `GtMachineIcons` to what `javap -p` shows and note it in the commit message.

- [ ] **Step 2: Write the `client` classes** as specified.

- [ ] **Step 3: Test, build and check reobfuscation**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test && VERSION=0.1.0 ./gradlew assemble) && exporter-mod/scripts/check-reobf.sh projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar && unzip -l projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar | grep -c -E 'com/google/gson|gregtech/'`
Expected: `BUILD SUCCESSFUL` twice, `reobf OK: <n> classes`, and `0` (neither Gson nor GT is bundled). Also sanity-check that the reobf jar calls SRG names: `javap -c -p -cp projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar io.github.drukoz.gtnhplanner.projector.client.McEnv | grep -c 'func_147104_D'` → at least 1.

- [ ] **Step 4: Commit**

```bash
git add projector-mod/src
git commit -m "feat(projector-mod): ghost renderer, world probe, HUD and /planner command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: In-game checklist (GTNH_LOCAL, done by the user)

**Files:**
- Create (local only, gitignored): `docs/local/projector-check.md` — the results, one line per check below (never committed: it will contain the user's coordinates and names)

**Interfaces:**
- Consumes: the jar from Task 11, the running planner with a real export and a world scan (Plans 1, 4, 5), the panel from Task 5.

This task is a script for the user, not for the executor. The executor builds the jar, prints the checklist below, and waits; it never copies the jar into the game, never starts or edits Minecraft, the Prism instance or the server (Global Constraints). The test uses a **throwaway project** and a **creative single-player world**, so the shared projects' checklists and the live server stay untouched until the last, read-only check.

- [ ] **Step 1: Build the jar** — `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && VERSION=0.1.0 ./gradlew assemble)`; expected `projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar`. Tell the user its path.

- [ ] **Step 2: The user runs the checklist** (`GTNH_LOCAL=1` conditions: the real pack, the real planner on this Mac). Expected results in brackets.

1. Close Minecraft. Copy `gtnhplannerprojector-0.1.0.jar` into the client instance's `.minecraft/mods/` (the client only — never the server's `mods/`). Start the GTNH 2.9 client. [The mod list shows "GTNH Planner Projector 0.1.0"; no crash; `logs/latest.log` has no `gtnhplannerprojector` errors.]
2. In the planner, create a project named `Projector test`, pick a target that needs two or three machines, pick the world scan and base on the Map tab. [The Map and 3D tabs show the line; note the site pin's x y z.]
3. Open **In-game projector**, type your name, press **Create token**, press **Copy**. [`/planner load <id> gpt_…` is shown once; the token list shows your label, "never used".]
4. Create a new creative single-player world, fly to the site pin's x y z (`/tp`), and paste the command in chat. [`[Planner] Loading project <id> from http://127.0.0.1:8765…`, then `[Planner] Loaded "Projector test": N blocks in K build steps. Showing all layers.`; the token list in the browser now says "used just now".]
5. Look at the ghosts. [Translucent blocks exactly where the 3D view puts them, sitting on the terrain like the 3D view shows; GT machines show their casing on five sides and the front overlay on the side the 3D view's front faces; cables and pipes show as textured cubes; covers show as their item's icon on the face they go on (a light-blue square when the icon is unknown); the HUD's top-left line reads `Planner: Projector test — 0/N placed, 0 wrong` (plus `, n can't be checked` for unknown casings).]
6. `/planner layer <a y of the line>`, then `/planner layer all`; `/planner step next`, then `/planner step all`. [Only that layer / only that step's blocks are drawn; chat confirms each.]
7. Place one planned machine with the wrong front, then turn it with a wrench; place a stone where a cable should go. [Wrong front → red, after the wrench → green within about 1 s; stone → red; looking at a block shows e.g. `Basic Macerator: wrong facing, its front should face south` under the HUD line.]
8. Place every block of one `place` step correctly. [Within about 2 s: `[Planner] Step <n> done: … (ticked as <your name>)`; the browser's Steps view shows the tick with your name without a reload; placing more blocks never sends it again; breaking one does not untick it.]
9. `/planner xray on`, walk behind a wall; `/planner xray off`. [Ghosts visible through the wall, then hidden again.]
10. Revoke the token in the browser, then `/planner reload`. [`[Planner] The planner refused this token for project <id>. …`; the ghosts stay.] Create a new token and paste the new command. [Loads again.]
11. Stop the planner (or block its port), wait a minute. [The HUD's second line says `Planner: Cannot reach the planner at …`; no chat spam, no stutter.] Start it again; `/planner reload`. [`No changes.`]
12. With F3 open, compare FPS with and without ghosts (`/planner clear`). [No visible drop for a line of a few hundred blocks.] If no ghosts were visible at step 5 while the HUD line was there, set `useDisplayLists=false` in `config/gtnhplannerprojector.properties`, restart, and repeat step 5; record which setting works (Angelica 2.2.19 records display lists; this is the fallback).
13. Read-only check on the real server: join it, create a token for a real project, `/planner load <id> <token>`. [The default address is the server's host on port 8765 (or set `/planner url`); ghosts appear at the base when you are in that dimension; do not build anything for this check.] Then `/planner clear`.
14. Delete the `Projector test` project's tokens; leave the project or rename it `old test`.

- [ ] **Step 3: Record and fix** — the user writes the results into `docs/local/projector-check.md`. Every failed check becomes a fix with a unit test in the pure packages where the cause is logic (Tasks 7–10), or a change in `client/` with the check repeated. No commit for this task unless a fix was made (then `fix(projector-mod): …` with the trailer).

---

### Task 13: End-to-end check (server side automated, browser spec) and README section for players

**Files:**
- Create: `tests/unit/projector/flow.test.ts`, `tests/e2e/projector.spec.ts`
- Modify: `README.md` (section "In-game ghost projector")

**Interfaces:**
- Consumes: the routes of Tasks 2–4; `openSse` (Plan 2 `tests/helpers/sse-client.ts`); e2e `login`, `createProject` (Plan 2 `tests/e2e/helpers.ts`, architecture §11.7); `projectorLayout` (Task 3).

- [ ] **Step 1: Write the server-side end-to-end test** `tests/unit/projector/flow.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { openSse } from '../../helpers/sse-client.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { projectorLayout } from '../../helpers/projector-fixtures.ts';
import type { CreateTokenResult, ProjectorPayload, TokenInfo } from '../../../src/shared/types/projector.ts';

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer({ pack: packFromSpec({}) });
  s.app.services.layout = { layoutFor: async () => projectorLayout(), finishPlan: async (p: unknown) => p, computations: 0 };
});
afterAll(async () => { await s.close(); });

describe('projector end to end (server side)', () => {
  it('a player loads the line, ticks a step in their name, the browser sees it live, and revoking ends access', async () => {
    const project = await (await s.request('/api/projects', { method: 'POST', body: { name: 'Steel line' }, name: 'Ann' })).json();
    const made = (await (await s.request(`/api/projects/${project.id}/tokens`, { method: 'POST', body: { label: 'Steve' }, name: 'Ann' })).json()) as CreateTokenResult;
    const mod = (path: string, init: { method?: string; body?: unknown } = {}) =>
      s.request(`/api/projects/${project.id}${path}`, { ...init, name: 'Steve', cookie: null, headers: { authorization: `Bearer ${made.token}` } });

    const before = (await (await mod('/projector')).json()) as ProjectorPayload;
    expect(before.steps.find((x) => x.id === 'layout:place:s1')).toMatchObject({ order: 2, blocks: [3, 4], done: false });

    const sse = await openSse(`${s.url}/api/projects/${project.id}/events`, s.cookie);
    await sse.next('snapshot');
    expect((await mod('/ops', { method: 'POST', body: { ops: [{ op: 'mark', row: 'step:layout:place:s1', on: true }] } })).status).toBe(200);
    expect((await sse.next('op')).data).toMatchObject({ op: { op: 'mark', row: 'step:layout:place:s1', on: true }, by: 'Steve' });
    sse.close();

    const after = (await (await mod('/projector')).json()) as ProjectorPayload;
    expect(after.steps.find((x) => x.id === 'layout:place:s1')?.done).toBe(true);
    expect(after.version).toBe(before.version);
    const tokens = (await (await s.request(`/api/projects/${project.id}/tokens`)).json()) as TokenInfo[];
    expect(tokens[0].lastUsedAt).not.toBeNull();

    expect((await s.request(`/api/projects/${project.id}/tokens/${made.tokenId}`, { method: 'DELETE' })).status).toBe(204);
    for (const path of ['/projector', '/layout', '']) expect((await mod(path)).status, path).toBe(401);
  });
});
```

- [ ] **Step 2: Write the browser spec** `tests/e2e/projector.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { login, createProject } from './helpers.ts';

test('create, copy and revoke a projector token', async ({ page }) => {
  await login(page);
  const id = await createProject(page, 'Projector e2e');
  await page.getByText('In-game projector').click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await page.getByLabel('Who is it for?').fill('Steve');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.locator('code', { hasText: `/planner load ${id} gpt_` })).toBeVisible();
  await expect(page.getByText(/^Steve · gpt_/)).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await page.reload();
  await page.getByText('In-game projector').click();
  await expect(page.locator('code', { hasText: '/planner load' })).toHaveCount(0);
});
```

- [ ] **Step 3: Run both** — they pass against Tasks 1–5 as written (they guard the whole chain).

Run: `npx vitest run tests/unit/projector/flow.test.ts && npx playwright test tests/e2e/projector.spec.ts`
Expected: `Test Files  1 passed` and `1 passed` from Playwright.

- [ ] **Step 4: Write the README section** — append to `README.md` a section `## In-game ghost projector` (for players) with, in this order:
  1. What it does (one paragraph): ghosts of the planned line in your own game, green / red / faint, build steps ticked in your name; a client-side mod, nothing on the server; only you need it if only you want ghosts.
  2. Install: get `gtnhplannerprojector-<version>.jar` from the person who runs the planner (or build it: `cd projector-mod && VERSION=0.1.0 ./gradlew assemble`, jar in `projector-mod/build/libs/`), put it into **your client's** `mods` folder (in Prism Launcher: right-click the instance → Folder → `.minecraft/mods`), never into the server's.
  3. Connect: on the project page open **In-game projector**, type who it is for, **Create token**, **Copy**, paste into Minecraft chat. The mod looks for the planner at the Minecraft server's address on port 8765; if yours is elsewhere, run the `/planner url …` line the panel shows.
  4. Commands: the `CommandParser.USAGE` line, then one line each for `load`, `layer`, `step` (`next` = the first build step not ticked yet), `reload`, `url`, `xray`, `clear`.
  5. Colours: faint = not placed yet, green = right block (and right front), red = wrong block or wrong front, bluish = the mod can't check this block (its step is never ticked automatically); covers show as their item's icon on the face they go on — covers and settings (`configure` steps) are ticked by hand.
  6. Troubleshooting: "Cannot reach the planner" → is it running, is the port forwarded, `/planner url`; "refused this token" → it was revoked: create a new one; nothing drawn → wrong dimension, `/planner layer all`, `/planner step all`, `maxDistance` in the config; ghosts invisible but HUD present → `useDisplayLists=false` in `config/gtnhplannerprojector.properties`.
  7. Privacy: a token lets its holder read that one project and tick its build steps, nothing else; it is stored in your `config/gtnhplannerprojector.properties` — keep that file private; revoke tokens you no longer use. Tokens travel over plain HTTP unless the planner is behind HTTPS.
  No server address, player name or coordinates of the group appear in it (examples use `mc.example.org` and `Steve`).

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm test && npx playwright test && (export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew test && VERSION=0.1.0 ./gradlew assemble) && exporter-mod/scripts/check-reobf.sh projector-mod/build/libs/gtnhplannerprojector-0.1.0.jar && git grep -n -E '/Users/|Application Support/PrismLauncher/instances' -- src tests projector-mod README.md`
Expected: typecheck silent; vitest all files passed; Playwright all passed; `BUILD SUCCESSFUL` twice; `reobf OK: <n> classes`; the final `git grep` prints nothing (exit code 1 is the success case here — run it on its own if the chain stops there).

- [ ] **Step 6: Commit**

```bash
git add tests/unit/projector/flow.test.ts tests/e2e/projector.spec.ts README.md
git commit -m "docs: in-game ghost projector for players; projector end-to-end checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Architecture change requests

Plan 6 is built after Plan 5 and changes Plan 2's and Plan 5's code only where listed here; architecture §11.22 already grants the feature, these make its contracts exact.

1. **Repo layout and rules (§2.3, §3).** Java also lives in `projector-mod/` (same toolchain pins as `exporter-mod/`, §4; mod id `gtnhplannerprojector`, package `io.github.drukoz.gtnhplanner.projector`, jar `gtnhplannerprojector-<v>.jar`, reobf checked with `exporter-mod/scripts/check-reobf.sh`). New TS modules: `src/shared/types/projector.ts`, `src/server/projector/{tokens,payload}.ts`, `src/server/http/routes/projector.ts`, `src/client/api/projector.ts`, `src/client/views/{projector-model.ts,ProjectorPanel.tsx}`. `.gitignore` gains `projector-mod/build/ projector-mod/.gradle/ projector-mod/run/`.
2. **HTTP API (§7, amends §11.22).** New routes: `POST /api/projects/:id/tokens` `{label?}` → 201 `{token, tokenId, info}` (a superset of §11.22's `{token}`), `GET /api/projects/:id/tokens` → `TokenInfo[]`, `DELETE /api/projects/:id/tokens/:tokenId` → 204, `GET /api/projects/:id/projector` → `ProjectorPayload`. The token-accepting routes are `GET /api/projects/:id`, `GET /api/projects/:id/layout`, `GET /api/projects/:id/projector` (added to §11.22's list) and `POST /api/projects/:id/ops`, where a token may only send `mark` ops whose row starts with `step:` (tighter than "mark ops only": a token cannot tick materials) — else 403 `token-scope`.
3. **Server composition (§7.1).** `Route` gains `bearer?: boolean`; `RequestContext` gains `bearer?: { projectId: string; tokenId: string }`; `src/server/http/router.ts` exports `type TokenVerifier = (token: string, projectId: string) => { tokenId: string } | null`, registered by Plan 6 as `app.services.verifyToken` and read per request by `server.ts`'s auth step (cookie first, then a bearer token for `params.id` on `bearer` routes, else 401); `src/server/http/auth.ts` exports `bearerToken(header)`; `src/server/http/routes/projects.ts` exports `tokenMayApply(ops)`. Task 2 makes these edits in Plan 2's files and the one-flag edit in Plan 5's `routes/layout.ts`.
4. **Database (Plan 2 `db.ts`, still the only `node:sqlite` module).** Schema v2: table `project_token(id, project_id → project, hash UNIQUE, hint, label, created_at, created_by, last_used_at)` + index on `project_id`, migrated in place from v1; `Db` gains `insertToken`, `listTokens`, `tokenByHash`, `deleteToken`, `touchToken`, `countTokens` and `TokenRow`. Token hashes never leave the server and never enter `Project` (which every browser receives over SSE).
5. **Client (§7.2, Plan 2 files).** `src/client/api/client.ts` gains `apiDelete(path)`; `ProjectPage.tsx` renders `ProjectorPanel` below `SettingsPanel`. No new project tab (the `ProjectTab.id` union stays as it is).
6. **Layout contract used by the projector (Plan 5).** `stepMembership` relies on Plan 5's build step ids (`layout:place:<stepId>`, `layout:power:stage:<toTier>`, `layout:power:wire:<tier>`, `layout:power:hookup`, `layout:logistics:hookup`, `layout:logistics:line`, `layout:logistics:fluid:<key>`), on `LayoutBlock.stepId` / `hookup`, and on three text shapes (`Place <n>× <transformer> between …`, `Wire the <TIER> machines with <cable> (<cells> blocks)`, fluid pipe label `<pipe> (<fluid>)` with step text `Lay <n>× <pipe> for <fluid>`). Request: treat these as a contract — a change to them updates `tests/helpers/projector-fixtures.ts` and the shared sample in the same commit. Suggested follow-up (not needed now): an optional `LayoutBlock.buildStep?: string` set by Plan 5's `layoutSteps` would replace the text matching.
7. **Testing (§10).** `projector-mod/src/test/resources/projector-sample.json` is committed: it is generated from the synthetic `projectorLayout()` fixture (no game data) by `UPDATE_PROJECTOR_SAMPLE=1 npx vitest run tests/unit/projector/payload.test.ts`, and both the TS test and the mod's JUnit tests read it, so the two sides cannot drift apart silently. Java unit tests (JUnit 5.11.4, Gson 2.2.4 test-only) cover the mod's pure packages, as Plan 3 established for `exporter-mod/`.
