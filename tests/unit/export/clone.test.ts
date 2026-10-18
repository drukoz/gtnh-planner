import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readlink, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CloneError, cloneServer } from '../../../src/server/export/clone.ts';
import { configureClone } from '../../../src/server/export/configure.ts';
import { makeFakeServer, snapshot } from '../../helpers/fake-server.ts';

async function setup(levelName?: string) {
  const root = await mkdtemp(join(tmpdir(), 'gp-clone-'));
  const source = await makeFakeServer(join(root, 'server'), { levelName });
  return { root, source, target: join(root, '.local', 'export-server') };
}

describe('cloneServer', () => {
  it('clones the pack and never copies World, backups, logs or player files', async () => {
    const { root, source, target } = await setup();
    const result = await cloneServer({ source, target, root });
    for (const kept of ['mods/gregtech-5.09.54.183.jar', 'config/GregTech/MachineStats.cfg', 'libraries/org/x.jar', 'falsepattern/lib.jar',
      'scripts/.keep', 'coretweaks/cache.dat', 'nestedmods/n.jar', 'lwjgl3ify-forgePatches.jar', 'java9args.txt', 'eula.txt', 'server.properties']) {
      expect(existsSync(join(target, kept)), kept).toBe(true);
    }
    for (const gone of ['World', 'backups', 'logs', 'crash-reports', 'usercache.json', 'usernamecache.json', 'ops.json', 'banned-ips.json',
      'banned-players.json', 'whitelist.json', 'journeymap', 'visualprospecting', 'serverutilities', 'blueprints',
      'startserver-java9.sh', 'startserver-java9.bat', 'World-20261002-214206.zip']) {
      expect(existsSync(join(target, gone)), gone).toBe(false);
      expect(result.skipped).toContain(gone);
    }
  });

  it('leaves the source folder unchanged, also after configuring the clone', async () => {
    const { root, source, target } = await setup();
    const before = await snapshot(source);
    await cloneServer({ source, target, root });
    const jar = join(root, 'gtnhplannerexport-0.1.0.jar');
    await writeFile(jar, 'jar');
    await configureClone(target, { jar });
    expect(await snapshot(source)).toEqual(before);
  });

  it('skips the live world named in server.properties', async () => {
    const { root, source, target } = await setup('MyWorld');
    await cloneServer({ source, target, root });
    expect(existsSync(join(target, 'MyWorld'))).toBe(false);
  });

  it('replaces a stale clone', async () => {
    const { root, source, target } = await setup();
    await mkdir(join(target, 'mods'), { recursive: true });
    await writeFile(join(target, 'mods', 'stale.jar'), 'old');
    await cloneServer({ source, target, root });
    expect(existsSync(join(target, 'mods', 'stale.jar'))).toBe(false);
  });

  it('refuses a target outside .local, a target inside the server folder, and a folder that is not a server', async () => {
    const { root, source } = await setup();
    await expect(cloneServer({ source, target: join(root, 'elsewhere'), root })).rejects.toThrow(/must be inside \.local/);
    await expect(cloneServer({ source, target: join(source, '.local', 'export-server'), root: source })).rejects.toThrow(/inside the server folder/);
    const empty = await mkdtemp(join(tmpdir(), 'gp-notserver-'));
    await expect(cloneServer({ source: empty, target: join(root, '.local', 'x'), root })).rejects.toThrow(/does not look like a GTNH server folder/);
  });
});

describe('cloneServer safety', () => {
  it('refuses a .local that is a symbolic link into the server folder, before writing anything', async () => {
    const { root, source } = await setup();
    await symlink(source, join(root, '.local'));
    const before = await snapshot(source);
    await expect(cloneServer({ source, target: join(root, '.local', 'export-server'), root })).rejects.toThrow(/inside the server folder/);
    expect(existsSync(join(source, 'export-server'))).toBe(false);
    expect(await snapshot(source)).toEqual(before);
  });

  it('refuses .local itself as the target', async () => {
    const { root, source } = await setup();
    await expect(cloneServer({ source, target: join(root, '.local'), root })).rejects.toThrow(/must be inside \.local/);
  });

  it('skips the world folder whatever the letter case of level-name', async () => {
    const { root, source, target } = await setup('MyWorld');
    await writeFile(join(source, 'server.properties'), 'level-name=myworld\n');
    const result = await cloneServer({ source, target, root });
    expect(existsSync(join(target, 'MyWorld'))).toBe(false);
    expect(result.skipped).toContain('MyWorld');
    expect(result.copied).toContain('mods');
  });
});

describe('cloneServer and symbolic links', () => {
  it('refuses a server folder whose config folder is a link outside it, removes the clone and changes nothing', async () => {
    const { root, source, target } = await setup();
    const shared = join(root, 'live-config');
    await rename(join(source, 'config'), shared);
    await symlink(shared, join(source, 'config'));   // cp -R copies it as a link: Forge would rewrite the live files
    const before = { source: await snapshot(source), shared: await snapshot(shared) };
    const err = await cloneServer({ source, target, root }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloneError);
    expect((err as Error).message).toContain(`config -> ${shared}`);
    expect((err as Error).message).toMatch(/symbolic links that lead outside/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(shared, 'GregTech', 'MachineStats.cfg'))).toBe(true);
    expect({ source: await snapshot(source), shared: await snapshot(shared) }).toEqual(before);
  });

  it('refuses a relative link that climbs out of the folder and a dangling link', async () => {
    const { root, source, target } = await setup();
    await mkdir(join(root, 'shared-libs'));
    await symlink('../../shared-libs', join(source, 'libraries', 'shared'));
    await symlink('/nowhere/at/all', join(source, 'mods', 'gone.jar'));
    const err = await cloneServer({ source, target, root }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloneError);
    expect((err as Error).message).toContain(`${join('libraries', 'shared')} -> ../../shared-libs`);
    expect((err as Error).message).toContain(`${join('mods', 'gone.jar')} -> /nowhere/at/all`);
    expect(existsSync(target)).toBe(false);
  });

  it('keeps links that stay inside the folder', async () => {
    const { root, source, target } = await setup();
    await symlink('gregtech-5.09.54.183.jar', join(source, 'mods', 'latest.jar'));
    await symlink('../../java9args.txt', join(source, 'config', 'GregTech', 'args.txt'));
    await cloneServer({ source, target, root });
    expect((await lstat(join(target, 'mods', 'latest.jar'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(target, 'config', 'GregTech', 'args.txt'))).toBe('../../java9args.txt');
    expect(existsSync(join(target, 'config', 'GregTech', 'args.txt'))).toBe(true);
  });
});
