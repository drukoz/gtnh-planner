// Runs one of the repo's CLIs (src/server/cli/<script>.ts) as a child process, the way its npm script does, and
// captures what it prints (architecture §10, §11.7).

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_DIR = fileURLToPath(new URL('../../src/server/cli/', import.meta.url));
/** How long a timed-out CLI gets between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2_000;

export interface CliResult { code: number | null; stdout: string; stderr: string }

/**
 * Spawns `node --disable-warning=ExperimentalWarning src/server/cli/<script>.ts ...args` in `opts.cwd`, with
 * `opts.env` over `process.env` (a key set to `undefined` is removed). After `timeoutMs` (default 20 000) the child is
 * sent SIGTERM, and SIGKILL 2 s later if it is still running; a child ended by a signal has `code` null.
 * `opts.onSpawn` gets the child right after it is spawned (e.g. to send it a signal).
 */
export function runCli(
  script: 'pack-info' | 'export' | 'scan' | 'extract-assets' | 'import-nei-icons',
  args: string[],
  opts: { cwd: string; env?: Record<string, string | undefined>; timeoutMs?: number; onSpawn?: (child: ChildProcess) => void },
): Promise<CliResult> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const [name, value] of Object.entries(opts.env ?? {})) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', `${CLI_DIR}${script}.ts`, ...args], {
    cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  opts.onSpawn?.(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');   // lets the export CLI stop the server copy it started
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, opts.timeoutMs ?? 20_000);
    const done = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
    };
    child.on('error', (err) => {
      done();
      reject(err);
    });
    child.on('close', (code) => {
      done();
      resolve({ code, stdout, stderr });
    });
  });
}
