import { describe, it, expect, afterEach, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
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
const PACK_PNG = makePng(16, 16, [40, 160, 220, 255]);

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

/** A client instance laid out as Prism Launcher's: `inst/.minecraft` holds `options.txt` and the zip pack `P.zip`. */
async function instance(dir: string): Promise<string> {
  const inst = join(dir, 'inst');
  const game = join(inst, '.minecraft');
  await mkdir(game, { recursive: true });
  await writeFile(join(game, 'options.txt'), 'version:0\nresourcePacks:["P.zip"]\n');
  await makeJar(join(game, 'resourcepacks', 'P.zip'), {
    'pack.mcmeta': '{"pack":{"description":"P 1"}}',
    'assets/extra/textures/items/thing.png': PACK_PNG,
  });
  return inst;
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

  it('fails with exit 1 and keeps the previous textures when no mod jar can be read', async () => {
    const { dir, config, deps, lines } = await setup();
    expect(await main(['--no-client'], deps)).toBe(0);
    const index = join(config.dataDir, 'assets', 'index.json');
    const first = await readFile(index);
    const bad = join(dir, 'bad-srv');
    await mkdir(join(bad, 'mods'), { recursive: true });
    expect(await main(['--no-client', '--server', bad], deps)).toBe(1);   // mods/ holds no jar
    expect(lines.at(-1)).toBe('Extraction failed; the previous textures are still in place: no mod jar could be read: none was found');
    await writeFile(join(bad, 'mods', 'broken.jar'), 'this is not a zip');
    expect(await main(['--no-client', '--server', bad], deps)).toBe(1);
    expect(lines.at(-1)).toMatch(/^Extraction failed; the previous textures are still in place: no mod jar could be read: broken\.jar \(.+\)$/);
    expect((await readFile(index)).equals(first)).toBe(true);
  });

  it('extracts the enabled packs from --instance or the config, read-only', async () => {
    const { dir, config, deps, lines } = await setup();
    const inst = await instance(dir);
    const before = await snapshot(inst);
    expect(await main(['--no-client', '--instance', inst], deps)).toBe(0);
    expect(lines).toContain('Resource packs, last wins: P.zip (P 1)');
    expect(lines.find((l) => l.startsWith('Extracted '))).toMatch(/ from 2 jars and 1 resource pack into /);
    const ix = JSON.parse(await readFile(join(config.dataDir, 'assets', 'index.json'), 'utf8'));
    expect(ix.files['extra/textures/items/thing.png'].jar).toBe('P.zip');
    expect(await snapshot(inst)).toEqual(before);
    lines.length = 0;
    expect(await main(['--no-client'], { ...deps, config: { ...config, clientInstance: inst } })).toBe(0);
    expect(lines).toContain('Resource packs, last wins: P.zip (P 1)');
  });

  it('reports pack changes', async () => {   // Review Focus 5
    const { dir, deps, lines } = await setup();
    const inst = await instance(dir);
    await main(['--no-client', '--instance', inst], deps);
    expect(lines.some((l) => l.startsWith('Resource packs changed'))).toBe(false);   // nothing before it
    lines.length = 0;
    await main(['--no-client', '--instance', inst], deps);
    expect(lines.some((l) => l.startsWith('Resource packs changed'))).toBe(false);   // unchanged
    lines.length = 0;
    expect(await main(['--no-client', '--no-packs'], deps)).toBe(0);
    expect(lines).toContain('Resource packs: off (--no-packs)');
    expect(lines.find((l) => l.startsWith('Resource packs changed since the last extraction ('))).toBeDefined();
    expect(lines).toContain('  removed P.zip');
  });

  it('prints the pack lines after the summary and the skipped jars, in order, and the pack warnings last', async () => {
    const { dir, srv, config, deps, lines } = await setup();
    expect(await main(['--no-client'], deps)).toBe(0);   // a stock run: the packs run below reports its packs as added
    const { createdAt } = JSON.parse(await readFile(join(config.dataDir, 'assets', 'index.json'), 'utf8'));
    await writeFile(join(srv, 'mods', 'broken.jar'), 'not a zip');
    const game = join(await instance(dir), '.minecraft');
    await writeFile(join(game, 'options.txt'), 'resourcePacks:["P.zip","gone","Q","P.zip"]\r\n');
    await makeJar(join(game, 'resourcepacks', 'P.zip'), {
      'pack.mcmeta': '{"pack":{"description":"P 1"}}',
      'assets/extra/textures/items/thing.png': PACK_PNG,
      'assets/gregtech/textures/blocks/iconsets/machine_lv_side.png': PACK_PNG,   // a zip matches exactly: left out
      'assets/extra/textures/items/new.png': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),   // a JPEG
    });
    const q = join(game, 'resourcepacks', 'Q');   // a folder pack
    await mkdir(join(q, 'assets', 'gregtech', 'textures', 'blocks', 'iconsets'), { recursive: true });
    await writeFile(join(q, 'pack.mcmeta'), '{"pack":{}}');   // no version: named alone
    await writeFile(join(q, 'assets', 'gregtech', 'textures', 'blocks', 'iconsets', 'machine_lv_side.png'), PACK_PNG);
    lines.length = 0;
    expect(await main(['--no-client', '--instance', game], deps)).toBe(0);
    expect(lines).toEqual([
      'warning: no client jar - vanilla block and item textures will be missing',
      expect.stringMatching(/^Extracted 2 textures \(\d+\.\d MB\) from 2 jars and 2 resource packs into .*data\/assets$/),
      expect.stringMatching(/^0 identical duplicates, 0 conflicting paths \(/),
      expect.stringMatching(/^warning: skipped broken\.jar: /),
      '2 of them from resource packs (2 replace a jar\'s texture)',   // P.zip's thing.png; Q's file as the jar's MACHINE_LV_SIDE.png
      '1 files of zip packs left out: their names differ from the game\'s only in case',
      'Resource packs, last wins: Q, P.zip (P 1)',
      `Resource packs changed since the last extraction (${createdAt}):`,
      '  added P.zip (P 1)',
      '  added Q ()',
      'warning: resource pack gone skipped: not in resourcepacks/',
      'warning: resource pack P.zip skipped: listed twice',
      'warning: P.zip: extra/textures/items/new.png is not a PNG (the game may still read it); left out',
    ]);
  });

  it('says why it used no pack', async () => {
    const { dir, config, deps, lines } = await setup();
    const inst = await instance(dir);
    const options = join(inst, '.minecraft', 'options.txt');
    const afterSummary = () => lines.slice(3);   // after the no-client warning and the two summary lines
    await writeFile(options, 'resourcePacks:[]\n');
    expect(await main(['--no-client', '--instance', inst], deps)).toBe(0);
    expect(lines[1]).toMatch(/ from 2 jars into /);
    expect(afterSummary()).toEqual(['Resource packs: none enabled in options.txt']);
    lines.length = 0;
    await writeFile(options, 'resourcePacks:["gone"]\n');
    expect(await main(['--no-client', '--instance', inst], deps)).toBe(0);
    expect(afterSummary()).toEqual(['Resource packs: none usable (all skipped, see warnings)', 'warning: resource pack gone skipped: not in resourcepacks/']);
    lines.length = 0;
    expect(await main(['--no-client'], { ...deps, config: { ...config, clientInstance: ' ' } })).toBe(0);   // white space: unset
    expect(afterSummary()).toEqual([expect.stringMatching(/^No client instance set: /)]);
    lines.length = 0;
    expect(await main(['--no-client', '--no-packs'], { ...deps, config: { ...config, clientInstance: inst } })).toBe(0);
    expect(afterSummary()).toEqual(['Resource packs: off (--no-packs)']);   // over the setting
  });

  it('compares with no previous index when it cannot read the old one', async () => {
    const { dir, config, deps, lines } = await setup();
    const inst = await instance(dir);
    await mkdir(join(config.dataDir, 'assets'), { recursive: true });
    await writeFile(join(config.dataDir, 'assets', 'index.json'), '{oops');
    expect(await main(['--no-client', '--instance', inst], deps)).toBe(0);
    expect(lines.at(-1)).toBe('Resource packs, last wins: P.zip (P 1)');   // and no "changed since" line
  });

  it('needs a value for --instance', async () => {
    const { deps, lines } = await setup();
    expect(await main(['--no-client', '--instance', ' '], deps)).toBe(2);
    expect(lines).toEqual(['--instance needs a value\nUsage: npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client] [--instance <folder> | --no-packs]']);
  });

  it('explains a bad instance', async () => {
    const { dir, deps, lines } = await setup();
    expect(await main(['--no-client', '--instance', join(dir, 'nowhere')], deps)).toBe(2);
    expect(lines.at(-1)).toMatch(/^No options\.txt in .*nowhere or its \.minecraft folder$/);
    expect(await main(['--instance', 'x', '--no-packs'], deps)).toBe(2);
    expect(lines.join('\n')).toContain('--instance and --no-packs cannot be used together');
    expect(await main(['--no-client'], deps)).toBe(0);
    expect(lines.at(-1)).toBe('No client instance set: textures from the jars only (set "clientInstance" in data/config.json or pass --instance <folder>)');
  });

  it('explains an unreadable options.txt', async () => {
    const { dir, deps, lines } = await setup();
    const inst = await instance(dir);
    const options = join(inst, '.minecraft', 'options.txt');
    await chmod(options, 0o000);
    try {
      expect(await main(['--no-client', '--instance', inst], deps)).toBe(2);
      expect(lines.at(-1)).toMatch(/^Cannot read .*options\.txt: /);
    } finally {
      await chmod(options, 0o644);
    }
  });

  it('explains an instance folder it cannot look into, and extracts nothing', async () => {
    const { dir, config, deps, lines } = await setup();
    const inst = await instance(dir);
    await chmod(inst, 0o000);   // looking for inst/options.txt then fails with EACCES, not "no such file"
    try {
      expect(await main(['--no-client', '--instance', inst], deps)).toBe(2);
      expect(lines.at(-1)).toMatch(/^Cannot read .*inst: EACCES/);
    } finally {
      await chmod(inst, 0o755);
    }
    expect(await readFile(join(config.dataDir, 'assets', 'index.json')).catch(() => null)).toBeNull();
  });

  it('runs as a script', async () => {
    const r = await runCli('extract-assets', ['--help'], { cwd: (await setup()).dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: npm run extract-assets');
  });
});
