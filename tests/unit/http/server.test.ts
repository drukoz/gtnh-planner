import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { packFromSpec } from '../../helpers/pack-spec.ts';
import { createApp } from '../../../src/server/app.ts';
import { DEFAULT_CONFIG } from '../../../src/server/config.ts';
import { HttpError } from '../../../src/server/http/router.ts';
import { summarizeRecipe } from '../../../src/server/http/routes/pack.ts';
import { displayName } from '../../../src/server/http/server.ts';

const pack = packFromSpec({
  items: [{ key: 't:iron_ingot@0', name: 'Iron Ingot' }, { key: 't:iron_plate@0', name: 'Iron Plate' }],
  maps: [{ id: 'gt.recipe.metalbender', name: 'Bending Machine' }],
  machines: [{ mteId: 101, name: 'Basic Bending Machine', maps: ['gt.recipe.metalbender'], tier: 1 }],
  recipes: [{ id: 'bend', map: 'gt.recipe.metalbender', in: [['t:iron_ingot@0', 1]], out: [['t:iron_plate@0', 1]], eut: 24, dur: 100 }],
});
const staticDir = mkdtempSync(join(tmpdir(), 'gp-static-'));
mkdirSync(join(staticDir, 'assets'));
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>GTNH Line Planner</title>');
writeFileSync(join(staticDir, 'assets', 'app-1.js'), 'console.log(1)');

let s: TestServer;
beforeAll(async () => { s = await startTestServer({ pack, staticDir }); });
afterAll(async () => { await s.close(); });

describe('auth', () => {
  it('health is public; the API is not', async () => {
    expect((await s.request('/api/health', { cookie: null })).status).toBe(200);
    const r = await s.request('/api/pack', { cookie: null });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: 'auth' });
  });
  it('login sets a 30-day HttpOnly cookie; a wrong password is 401', async () => {
    const bad = await s.request('/api/login', { method: 'POST', body: { password: 'nope' }, cookie: null });
    expect(bad.status).toBe(401);
    const ok = await s.request('/api/login', { method: 'POST', body: { password: 'pw' }, cookie: null });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('set-cookie')).toMatch(/^gp_session=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
  });
  it('answers 429 after 5 wrong passwords from one address', async () => {
    for (let i = 0; i < 5; i++) await s.request('/api/login', { method: 'POST', body: { password: 'x' }, cookie: null });
    const r = await s.request('/api/login', { method: 'POST', body: { password: 'pw' }, cookie: null });
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: 'slow-down' });
  });
});

describe('pack routes', () => {
  it('GET /api/pack', async () => {
    expect(await (await s.request('/api/pack')).json()).toMatchObject({ recipeCount: 1, mapCount: 1, itemCount: 2,
      exclusionRules: ['recycling', 'massfab', 'replicator', 'scrap', 'lava-centrifuge', 'programmed-circuit-conversion'] });
  });
  it('GET /api/pack lists the materials an avoid entry can name, by display name then name (ruling R12)', async () => {
    const named = packFromSpec({
      items: [{ key: 't:ss@0', name: 'Stainless Steel Ingot', gt: { prefix: 'ingot', material: 'StainlessSteel' } },
              { key: 't:cu@0', name: 'Copper Ingot', gt: { prefix: 'ingot', material: 'Copper' } }, { key: 't:ash@0', name: 'Ashes' }],
      materials: ['Ash', 'AnyCopper'],
    });
    named.materials.get('StainlessSteel')!.displayName = 'Stainless Steel';
    named.materials.get('Ash')!.parts = { dust: 't:ash@0' };   // known only from the material's ore parts
    named.materials.delete('Copper');   // known only from an item's material
    const t = await startTestServer({ pack: named });
    // AnyCopper, which no item or fluid is made of, would avoid nothing (final review): it is not offered.
    expect((await (await t.request('/api/pack')).json()).materials).toEqual([
      { name: 'Ash', label: 'Ash' }, { name: 'Copper', label: 'Copper' }, { name: 'StainlessSteel', label: 'Stainless Steel' }]);
    await t.close();
  });
  it('GET /api/pack lists the machines the "Machines we have" list can name, by name, tier and id (ruling P21)', async () => {
    const machined = packFromSpec({
      maps: [{ id: 'gt.recipe.assembler' }, { id: 'gt.recipe.blastfurnace' }, { id: 'gt.recipe.steamturbinefuel' }],
      machines: [
        { mteId: 402, name: 'Boxinator', maps: ['gt.recipe.assembler'], tier: 2 },
        { mteId: 401, name: 'Boxinator', maps: ['gt.recipe.assembler'], tier: 1 },
        { mteId: 121, name: 'Basic Assembler', maps: ['gt.recipe.assembler'], tier: 1 },
        { mteId: 15512, name: 'Industrial Centrifuge', maps: ['gt.recipe.blastfurnace'], kind: 'multiblock' },
        { mteId: 790, name: 'Industrial Centrifuge', maps: ['gt.recipe.blastfurnace'], kind: 'multiblock' },
        // Never on a step (pickMachine runs singleblocks and multiblocks only), or running no recipe map: not offered.
        { mteId: 1120, name: 'Basic Steam Turbine', maps: ['gt.recipe.steamturbinefuel'], kind: 'generator', tier: 1 },
        { mteId: 1246, name: '1x Tin Cable', maps: [], kind: 'cable', tier: 1 },
        { mteId: 130, name: 'Assembler Without Recipes', maps: [], tier: 1 },
      ],
    });
    const t = await startTestServer({ pack: machined });
    // A multiblock has no tier of its own (it runs at its energy hatch's), so it has none here.
    expect((await (await t.request('/api/pack')).json()).machines).toEqual([
      { mteId: 121, name: 'Basic Assembler', tier: 1 }, { mteId: 401, name: 'Boxinator', tier: 1 }, { mteId: 402, name: 'Boxinator', tier: 2 },
      { mteId: 790, name: 'Industrial Centrifuge' }, { mteId: 15512, name: 'Industrial Centrifuge' }]);
    await t.close();
  });
  it('search and stuff', async () => {
    const hits = await (await s.request('/api/pack/search?q=iron%20pl')).json();
    expect(hits[0]).toMatchObject({ key: 't:iron_plate@0', name: 'Iron Plate' });
    const info = await (await s.request(`/api/pack/stuff/${encodeURIComponent('t:iron_plate@0')}`)).json();
    expect(info.producers).toEqual([expect.objectContaining({ id: 'bend', machineName: 'Basic Bending Machine', tier: 1, euPerTick: 24 })]);
    expect((await s.request('/api/pack/stuff/nope%400')).status).toBe(404);
  });
  it('503 with a plain message when no export is active', async () => {
    const t = await startTestServer({ pack: null });
    const r = await t.request('/api/pack');
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'no-export', message: 'No recipe export yet — run npm run export' });
    await t.close();
  });
  it('unknown API path is a JSON 404', async () => {
    expect((await s.request('/api/nope')).status).toBe(404);
  });
  it('a malformed escape in the path or the name header is a 400, not a 500', async () => {
    const r = await s.request('/api/pack/stuff/%E0%A4%A');
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'bad-path' });
    const n = await s.request('/api/pack', { headers: { 'X-Planner-Name': '%E0%A4%A' } });
    expect(n.status).toBe(400);
    expect(await n.json()).toMatchObject({ error: 'bad-name' });
  });
});

describe('static files', () => {
  it('serves index.html, hashed assets and the SPA fallback; refuses traversal', async () => {
    expect(await (await s.request('/', { cookie: null })).text()).toContain('GTNH Line Planner');
    const js = await s.request('/assets/app-1.js', { cookie: null });
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await s.request('/p/abc123', { cookie: null })).headers.get('cache-control')).toBe('no-cache');
    expect((await s.request('/assets/%2e%2e/%2e%2e/package.json', { cookie: null })).status).toBe(404);
  });
});

describe('request bodies and sessions', () => {
  it('answers 400 for a body that is not JSON or has no password, and 413 for one over the limit', async () => {
    const notJson = await fetch(`${s.url}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: 'bad-json' });
    const noPassword = await s.request('/api/login', { method: 'POST', body: { pass: 1 }, cookie: null });
    expect(noPassword.status).toBe(400);
    const big = await s.request('/api/login', { method: 'POST', body: { password: 'x'.repeat(20_000) }, cookie: null });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: 'too-large' });
  });
  it('logout clears the cookie; a forged cookie is 401', async () => {
    const out = await s.request('/api/logout', { method: 'POST', cookie: null });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toBe('gp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    expect((await s.request('/api/pack', { cookie: `gp_session=${Date.now()}.forged` })).status).toBe(401);
  });
  it('reads the display name: decoded, trimmed, at most 40 characters, null when empty', () => {
    const me = (value?: string) => displayName({ headers: value === undefined ? {} : { 'x-planner-name': value } } as IncomingMessage);
    expect(me()).toBeNull();
    expect(me('%20%20')).toBeNull();
    expect(me(encodeURIComponent('  Jörg 🙂 '))).toBe('Jörg 🙂');
    expect(me(encodeURIComponent('🙂'.repeat(50)))).toBe('🙂'.repeat(40));
    expect(() => me('%E0%A4%A')).toThrow(HttpError);
  });
});

describe('pack routes: details', () => {
  it('an empty query finds nothing; limit is clamped to 1..100', async () => {
    expect(await (await s.request('/api/pack/search?q=%20')).json()).toEqual([]);
    expect(await (await s.request('/api/pack/search')).json()).toEqual([]);
    expect(await (await s.request('/api/pack/search?q=iron&limit=0')).json()).toHaveLength(1);
    expect(await (await s.request('/api/pack/search?q=iron&limit=abc')).json()).toHaveLength(2);
  });
  it('summarizes recipes: crafting, furnace, a map without machines, every ore-dict option, fake recipes', () => {
    const p = packFromSpec({
      items: [{ key: 't:plank@0', name: 'Plank' }, { key: 't:plank@1', name: 'Birch Plank' }],
      maps: [{ id: 'gt.recipe.lathe', name: 'Lathe' }],
      recipes: [
        { id: 'stick', map: 'crafting', in: [{ any: [['t:plank@0', 2], ['t:plank@1', 2]] }], out: [['t:stick@0', 4]] },
        { id: 'char', map: 'furnace', in: [['t:plank@0', 1]], out: [['t:charcoal@0', 1]] },
        { id: 'lathe', map: 'gt.recipe.lathe', in: [['t:plank@0', 1]], out: [['t:stick@0', 2, 0.5]], eut: 100, flags: { fake: true } },
      ],
    });
    const sum = (id: string) => summarizeRecipe(p, p.recipeById.get(id)!);
    // An ore-dictionary slot shows its first option and lists all of them (controller ruling: every option stays visible).
    expect(sum('stick')).toEqual({
      id: 'stick', source: 'crafting', maps: ['crafting'], machineName: 'Crafting table', tier: 1, euPerTick: 0, durationTicks: 0,
      inputs: [{ key: 't:plank@0', name: 'Plank', amount: 2, consumed: true,
        options: [{ key: 't:plank@0', name: 'Plank', amount: 2 }, { key: 't:plank@1', name: 'Birch Plank', amount: 2 }] }],
      outputs: [{ key: 't:stick@0', name: 't:stick@0', amount: 4, chance: 1 }],
    });
    expect(sum('char').inputs).toEqual([{ key: 't:plank@0', name: 'Plank', amount: 1, consumed: true }]);
    expect(sum('char').machineName).toBe('Furnace');
    expect(sum('lathe')).toMatchObject({ machineName: 'Lathe', tier: 2, fake: true, outputs: [{ chance: 0.5 }] });
  });
  it('names the lowest-tier machine of the first map', () => {
    const p = packFromSpec({
      machines: [{ mteId: 5, name: 'Advanced Lathe', maps: ['gt.recipe.lathe'], tier: 2 }, { mteId: 9, name: 'Basic Lathe', maps: ['gt.recipe.lathe'], tier: 1 }],
      recipes: [{ id: 'l', map: 'gt.recipe.lathe', in: [['t:a@0', 1]], out: [['t:b@0', 1]], eut: 16 }],
    });
    expect(summarizeRecipe(p, p.recipeById.get('l')!).machineName).toBe('Basic Lathe');
  });
});

describe('app.pack()', () => {
  it('loads once per active export, shares a load in progress and retries a failed one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-app-'));
    const loads: string[] = [];
    let broken = true;
    const app = createApp({ ...DEFAULT_CONFIG, dataDir: dir, activeExportId: 'a' }, {
      loadPack: async (exportDir) => {
        loads.push(basename(exportDir));
        if (broken) {
          broken = false;
          throw new Error('half-written export');
        }
        return pack;
      },
    });
    await expect(app.pack()).rejects.toThrow('half-written export');
    const first = app.pack();
    expect(app.pack()).toBe(first);
    expect(await first).toBe(pack);
    await app.pack();
    expect(loads).toEqual(['a', 'a']);
    app.config.activeExportId = 'b';
    await app.pack();
    expect(loads).toEqual(['a', 'a', 'b']);
    app.config.activeExportId = null;
    await expect(app.pack()).rejects.toMatchObject({ status: 503, code: 'no-export' });
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createApp', () => {
  it('switches projects stored before supporting lines were the default to them at start, once (ruling P10)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-app-'));
    const config = { ...DEFAULT_CONFIG, dataDir: dir };
    const first = createApp(config);
    const id = first.projects.create('Old line', 'Ann').id;
    const row = first.db.getProject(id)!;
    const state = JSON.parse(row.state);
    delete state.settings.settingsVersion;
    state.settings.routeDerived = false;
    first.db.updateProject({ ...row, state: JSON.stringify(state) });
    first.db.close();
    const again = createApp(config);
    expect(again.projects.get(id)).toMatchObject({ rev: 1, settings: { routeDerived: true, settingsVersion: 2 } });
    again.db.close();
    const third = createApp(config);
    expect(third.projects.get(id)?.rev).toBe(1);
    third.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('static files: details', () => {
  it('HEAD sends headers only; other methods, missing files, NUL and backslashes are 404', async () => {
    const head = await fetch(`${s.url}/assets/app-1.js`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('14');
    expect(await head.text()).toBe('');
    expect((await s.request('/index.html', { cookie: null })).headers.get('cache-control')).toBe('no-cache');
    for (const path of ['/assets/missing.js', '/%00', '/assets/%5C..%5C..%5Cpackage.json', '/%E0%A4%A']) {
      expect((await s.request(path, { cookie: null })).status).toBe(404);
    }
    expect((await s.request('/', { method: 'POST', cookie: null })).status).toBe(404);
  });
  it('is a 404 while the client is not built', async () => {
    const t = await startTestServer({ pack });
    expect((await t.request('/', { cookie: null })).status).toBe(404);
    await t.close();
  });
});
