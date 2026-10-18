import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneServer } from '../../../src/server/export/clone.ts';
import {
  EXPORT_PROPERTIES, EulaError, StartScriptError, configureClone, findStartScript, readLevelName, readStartArgs, rewriteProperties,
} from '../../../src/server/export/configure.ts';
import { makeFakeServer } from '../../helpers/fake-server.ts';

describe('server.properties', () => {
  it('rewrites values, keeps comments and unknown keys, appends missing keys', () => {
    const out = rewriteProperties('#Minecraft server properties\nserver-port=25565\nlevel-name=World\nmotd=Our Server\n', EXPORT_PROPERTIES);
    const lines = out.split('\n');
    expect(lines[0]).toBe('#Minecraft server properties');
    expect(lines).toContain('server-port=25566');
    expect(lines).toContain('level-name=export-world');
    expect(lines).toContain('motd=Our Server');
    expect(lines).toContain('max-tick-time=0');
    expect(lines).toContain('server-ip=127.0.0.1');
    expect(out.endsWith('\n')).toBe(true);
    expect(readLevelName('level-name=MyWorld\n')).toBe('MyWorld');
    expect(readLevelName('motd=x\n')).toBe('World');
  });
});

describe('start script', () => {
  it('takes the java arguments of the pack script', () => {
    const script = '#!/bin/bash\n# -Dfml.queryResult=confirm\nwhile true\ndo\n   java -Xms6G -Xmx6G -Dfml.readTimeout=180 -Duser.language=en @java9args.txt -jar lwjgl3ify-forgePatches.jar nogui\n    echo "Rebooting in:"\ndone\n';
    expect(readStartArgs(script)).toEqual(['-Xms6G', '-Xmx6G', '-Dfml.readTimeout=180', '-Duser.language=en', '@java9args.txt', '-jar', 'lwjgl3ify-forgePatches.jar', 'nogui']);
  });
  it('handles a quoted java path, quoted arguments and redirections', () => {
    expect(readStartArgs('"/usr/bin/java" -Xmx8G -jar "forge server.jar" nogui > log.txt 2>&1\n')).toEqual(['-Xmx8G', '-jar', 'forge server.jar', 'nogui']);
  });
  it('fails clearly without a java line or a script', async () => {
    expect(() => readStartArgs('echo hello\n')).toThrow(StartScriptError);
    const empty = await mkdtemp(join(tmpdir(), 'gp-noscript-'));
    expect(() => findStartScript(empty)).toThrow(StartScriptError);
  });
});

describe('configureClone', () => {
  async function clone(eula = true) {
    const root = await mkdtemp(join(tmpdir(), 'gp-conf-'));
    const source = await makeFakeServer(join(root, 'server'), { eula });
    const target = join(root, '.local', 'export-server');
    await cloneServer({ source, target, root });
    const jar = join(root, 'gtnhplannerexport-0.1.0.jar');
    await writeFile(jar, 'jar');
    return { source, target, jar };
  }

  it('configures the clone for a private FLAT world and installs the exporter jar', async () => {
    const { source, target, jar } = await clone();
    await mkdir(join(target, 'export-world'), { recursive: true });
    await configureClone(target, { jar });
    const props = await readFile(join(target, 'server.properties'), 'utf8');
    for (const [k, v] of Object.entries(EXPORT_PROPERTIES)) expect(props.split('\n')).toContain(`${k}=${v}`);
    expect(await readFile(join(target, 'whitelist.json'), 'utf8')).toBe('[]\n');
    const mods = await readdir(join(target, 'mods'));
    expect(mods).toContain('gtnhplannerexport-0.1.0.jar');
    expect(mods).not.toContain('gtnhplannerexport-0.0.9.jar');
    expect(mods).toContain('gregtech-5.09.54.183.jar');
    expect(existsSync(join(target, 'export-world'))).toBe(false);
    expect(findStartScript(source)).toBe(join(source, 'startserver-java9.sh'));
  });

  it('refuses a server whose EULA is not accepted', async () => {
    const { target, jar } = await clone(false);
    await expect(configureClone(target, { jar })).rejects.toThrow(EulaError);
  });
});

describe('properties and start script details', () => {
  it('reads level-name as java.util.Properties does: escapes removed, the last line wins', () => {
    expect(readLevelName('level-name=Old\nlevel-name = Caf\\u00e9\\:1\n')).toBe('Café:1');
    expect(readLevelName('level-name=\n')).toBe('World');
    expect(readLevelName('#level-name=Commented\n')).toBe('World');
  });

  it('joins continued lines and stops at a redirection written without spaces', () => {
    const script = '#!/bin/sh\n"$JAVA_HOME/bin/java" -Xmx6G \\\n  -jar \'my server.jar\' nogui 2>&1|tee log.txt\n';
    expect(readStartArgs(script)).toEqual(['-Xmx6G', '-jar', 'my server.jar', 'nogui']);
  });
});

describe('configureClone never writes through a link', () => {
  async function linkedClone() {
    const root = await mkdtemp(join(tmpdir(), 'gp-link-'));
    const source = await makeFakeServer(join(root, 'server'));
    const target = join(root, '.local', 'export-server');
    await cloneServer({ source, target, root });
    const jar = join(root, 'gtnhplannerexport-0.1.0.jar');
    await writeFile(jar, 'jar');
    return { source, target, jar };
  }

  it('replaces a server.properties that links back into the server folder', async () => {
    const { source, target, jar } = await linkedClone();
    const live = join(source, 'server.properties');
    const before = await readFile(live, 'utf8');
    await rm(join(target, 'server.properties'));
    await symlink(live, join(target, 'server.properties'));
    await configureClone(target, { jar });
    expect(await readFile(live, 'utf8')).toBe(before);
    expect((await lstat(join(target, 'server.properties'))).isSymbolicLink()).toBe(false);
    expect((await readFile(join(target, 'server.properties'), 'utf8')).split('\n')).toContain('server-port=25566');
  });

  it('refuses a mods folder that is a link to the server folder\'s mods', async () => {
    const { source, target, jar } = await linkedClone();
    await rm(join(target, 'mods'), { recursive: true });
    await symlink(join(source, 'mods'), join(target, 'mods'));
    await expect(configureClone(target, { jar })).rejects.toThrow(/not a folder of the clone/);
    expect(await readdir(join(source, 'mods'))).toEqual(['gregtech-5.09.54.183.jar', 'gtnhplannerexport-0.0.9.jar']);
  });
});
