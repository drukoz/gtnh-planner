import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJar } from '../../helpers/jar.ts';
import { makePng } from '../../helpers/png.ts';
import { snapshot } from '../../helpers/fake-server.ts';
import { runCli } from '../../helpers/run-cli.ts';
import {
  main, listModJars, findClientJar, sha1File, clientJarOf, CLIENT_JAR_CANDIDATES, type ClientJarConfig,
} from '../../../src/server/cli/extract-assets.ts';
import { DEFAULT_CONFIG, configPath, loadConfig, saveConfig, type AppConfig } from '../../../src/server/config.ts';

const PNG = makePng(16, 16, [90, 90, 90, 255]);

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'gp-xa-'));
  const srv = join(dir, 'srv');
  await mkdir(join(srv, 'mods', '1.7.10'), { recursive: true });
  await makeJar(join(srv, 'mods', 'gregtech-5.09.54.183.jar'), { 'assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png': PNG });
  await makeJar(join(srv, 'mods', '1.7.10', 'Extra.jar'), { 'assets/extra/textures/items/thing.png': PNG });
  await writeFile(join(srv, 'mods', 'notes.txt'), 'not a jar');
  const client = await makeJar(join(dir, 'client.jar'), { 'assets/minecraft/textures/blocks/stone.png': PNG });
  const config: AppConfig = { ...DEFAULT_CONFIG, dataDir: join(dir, 'data'), serverFolder: srv };
  const lines: string[] = [];
  return { dir, srv, client, config, lines, deps: { config, home: join(dir, 'home'), out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

describe('extract-assets CLI', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('lists mod jars, including mods/1.7.10, by name', async () => {
    const { srv } = await setup();
    expect((await listModJars(srv)).map((p) => p.slice(srv.length + 1))).toEqual(['mods/1.7.10/Extra.jar', 'mods/gregtech-5.09.54.183.jar']);
  });

  it('finds the client jar from the flag, the config, then the launcher folders', async () => {
    const { dir, client } = await setup();
    const home = join(dir, 'home');
    expect(findClientJar({ flag: client, config: '/nope.jar', home })).toBe(client);
    expect(findClientJar({ flag: null, config: client, home })).toBe(client);
    expect(findClientJar({ flag: null, config: null, home })).toBeNull();
    await makeJar(join(home, CLIENT_JAR_CANDIDATES[0]!), {});
    expect(findClientJar({ flag: null, config: null, home })).toBe(join(home, CLIENT_JAR_CANDIDATES[0]!));
  });

  it('finds the client jar from a saved config', async () => {
    const { dir, client } = await setup();
    const file = join(dir, 'config.json');
    vi.stubEnv('GTNH_PLANNER_CONFIG', file);
    expect(configPath()).toBe(file);   // never touch the real data/config.json
    await writeFile(file, JSON.stringify({ dataDir: 'data', serverFolder: null, activeExportId: null }));   // saved before this task: no clientJar key
    expect(clientJarOf(loadConfig())).toBeNull();
    const withJar: ClientJarConfig = { ...loadConfig(), clientJar: client };
    saveConfig(withJar);
    expect(findClientJar({ flag: null, config: clientJarOf(loadConfig()), home: join(dir, 'home') })).toBe(client);
  });

  it('refuses a client jar that is not the official one', async () => {
    const { client, deps, lines } = await setup();
    expect(await main(['--client-jar', client], deps)).toBe(2);
    expect(lines.join('\n')).toContain('is not the official Minecraft 1.7.10 client jar');
  });

  it('extracts mods and the client jar without touching the server folder', async () => {
    const { srv, client, config, deps, lines } = await setup();
    const before = await snapshot(srv);
    expect(await main(['--client-jar', client], { ...deps, clientSha1: await sha1File(client) })).toBe(0);
    expect(lines[0]).toMatch(/^Extracted 3 textures \(\d+\.\d MB\) from 3 jars into .*data\/assets$/);
    const ix = JSON.parse(await readFile(join(config.dataDir, 'assets', 'index.json'), 'utf8'));
    expect(Object.keys(ix.files).sort()).toEqual(['extra/textures/items/thing.png', 'gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png', 'minecraft/textures/blocks/stone.png']);
    expect(await snapshot(srv)).toEqual(before);
  });

  it('explains what is missing', async () => {
    const { deps, lines } = await setup();
    expect(await main([], { ...deps, config: { ...deps.config, serverFolder: null } })).toBe(2);
    expect(lines.at(-1)).toContain('No server folder');
    expect(await main([], deps)).toBe(2);
    expect(lines.at(-1)).toContain('No Minecraft 1.7.10 client jar found');
    expect(await main(['--no-client'], deps)).toBe(0);
    expect(lines.join('\n')).toContain('warning: no client jar');
  });

  it('runs as a script', async () => {
    const r = await runCli('extract-assets', ['--help'], { cwd: (await setup()).dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: npm run extract-assets');
  });
});
