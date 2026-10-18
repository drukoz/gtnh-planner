// A synthetic GTNH server folder for the export orchestrator's tests (architecture §10, §11.7): the top-level layout of
// a real pack server (export-mod.md §5.1) with tiny placeholder files, so no test ever reads or copies a real server.

import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/** The pack's start script: it loops forever, which is why the clone never gets it (export-mod.md §5.1). */
const START_SCRIPT = [
  '#!/bin/bash',
  '# Add custom JVM arguments (such as RAM allocation) to the java9args.txt file',
  'while true',
  'do',
  '   java -Xms6G -Xmx6G -Dfml.readTimeout=180 -Duser.language=en @java9args.txt -jar lwjgl3ify-forgePatches.jar nogui',
  '    echo "If you want to completely stop the server process now, press Ctrl+C before the time is up!"',
  '    echo "Rebooting in:"',
  '    for i in 12 11 10 9 8 7 6 5 4 3 2 1',
  '    do',
  '        echo "$i..."',
  '        sleep 1',
  '    done',
  '    echo "Rebooting now!"',
  'done',
  '',
].join('\n');

const START_SCRIPT_BAT = [
  '@echo off',
  ':start',
  'java -Xms6G -Xmx6G -Dfml.readTimeout=180 -Duser.language=en @java9args.txt -jar lwjgl3ify-forgePatches.jar nogui',
  'goto start',
  '',
].join('\r\n');

/**
 * Writes a GTNH-shaped server folder at `dir` (created if needed) and returns its absolute path. The world folder is
 * named by `opts.levelName` (default `World`, also the `level-name` in server.properties); `eula.txt` says
 * `eula=false` only when `opts.eula` is false.
 */
export async function makeFakeServer(dir: string, opts: { levelName?: string; eula?: boolean } = {}): Promise<string> {
  const root = resolve(dir);
  const levelName = opts.levelName ?? 'World';
  const files: Record<string, string> = {
    'mods/gregtech-5.09.54.183.jar': 'fake gregtech jar',
    'mods/gtnhplannerexport-0.0.9.jar': 'fake old exporter jar',
    'config/GregTech/MachineStats.cfg': 'machinestats {\n}\n',
    'libraries/org/x.jar': 'fake library jar',
    'falsepattern/lib.jar': 'fake falsepattern library',
    'scripts/.keep': '',
    'coretweaks/cache.dat': 'transformer cache',
    'nestedmods/n.jar': 'fake nested mod',
    'lwjgl3ify-forgePatches.jar': 'fake launcher jar',
    'minecraft_server.1.7.10.jar': 'fake minecraft server jar',
    'java9args.txt': '-Dfile.encoding=UTF-8\n',
    'eula.txt': `eula=${opts.eula === false ? 'false' : 'true'}\n`,
    'server.properties': [
      '#Minecraft server properties', 'server-port=25565', `level-name=${levelName}`, 'level-type=rwg', 'max-tick-time=0',
      'white-list=true', 'online-mode=true', 'motd=Our Server', '',
    ].join('\n'),
    'startserver-java9.sh': START_SCRIPT,
    'startserver-java9.bat': START_SCRIPT_BAT,
    [`${levelName}/level.dat`]: 'fake level.dat',
    [`${levelName}/region/r.0.0.mca`]: 'fake region file',
    'backups/2026-10-17-17-52-25.zip': 'fake backup',
    'World-20261002-214206.zip': 'fake world zip',
    'logs/latest.log': '[00:00:00] [Server thread/INFO]: Done (1.0s)!\n',
    'crash-reports/crash.txt': 'fake crash report\n',
    'usercache.json': '[]\n',
    'usernamecache.json': '{}\n',
    'ops.json': '[]\n',
    'banned-ips.json': '[]\n',
    'banned-players.json': '[]\n',
    'whitelist.json': '[{"name":"someone"}]\n',
    'journeymap/a': 'a',
    'visualprospecting/a': 'a',
    'serverutilities/a': 'a',
    'blueprints/a': 'a',
    'GregTech.lang': 'languagefile {\n}\n',
  };
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await chmod(join(root, 'startserver-java9.sh'), 0o755);
  return root;
}

/** Every file below `dir` (symbolic links and folders left out): path relative to `dir` → `size:mtimeMs:sha1`. */
export async function snapshot(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort();
  for (const file of files) {
    const info = await stat(file);
    const sha1 = createHash('sha1').update(await readFile(file)).digest('hex');
    result.set(relative(dir, file), `${info.size}:${info.mtimeMs}:${sha1}`);
  }
  return result;
}
