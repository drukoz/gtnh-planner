// `npm run set-password [-- --rotate-sessions]`: sets the shared password and turns it on (spec §3.11). Reads the first
// line of stdin (prompting, without echo, when stdin is a terminal), stores only its scrypt hash in the settings file,
// sets `requirePassword`, and creates the session secret on first use; `--rotate-sessions` replaces the secret, which
// logs everyone out. `npm run set-password -- --off` reads nothing and turns the password off, keeping its hash. The
// password is never printed or logged. Exit 0 on success; 1 when no usable password was given or the settings file is
// damaged; 2 on bad arguments.

import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { type AppConfig, ConfigError, configPath, loadConfig, saveConfig } from '../config.ts';
import { hashPassword, newSessionSecret } from '../http/auth.ts';

const USAGE = 'Usage: npm run set-password [-- --rotate-sessions]  (reads the password from the first line of stdin)\n'
  + '       npm run set-password -- --off  (stops asking for a password)';
const MIN_LENGTH = 8;

/**
 * `cfg` with the new password's hash, which the planner asks for from now on (`requirePassword`); a session secret is
 * created when there is none or when `rotateSessions`.
 */
export function applyNewPassword(cfg: AppConfig, password: string, opts: { rotateSessions: boolean }): AppConfig {
  if ([...password].length < MIN_LENGTH) throw new Error(`Password must be at least ${MIN_LENGTH} characters`);
  return {
    ...cfg,
    passwordHash: hashPassword(password),
    sessionSecret: opts.rotateSessions || cfg.sessionSecret === '' ? newSessionSecret() : cfg.sessionSecret,
    requirePassword: true,
  };
}

/** `cfg` with the password turned off (spec §3.11); its hash and session secret stay until a new password replaces them. */
export function turnPasswordOff(cfg: AppConfig): AppConfig {
  return { ...cfg, requirePassword: false };
}

/** The first line `rl` reads, without its line ending; `null` when the input ends (or is cancelled) first. */
function firstLine(rl: Interface): Promise<string | null> {
  return new Promise((resolve) => {
    rl.once('line', (line) => {
      resolve(line);
      rl.close();
    });
    rl.once('close', () => resolve(null));
  });
}

/** Asks for a line on the terminal without echoing what is typed; Ctrl-C or Ctrl-D give `null`. */
async function promptHidden(prompt: string): Promise<string | null> {
  process.stdout.write(prompt);
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
  rl.on('SIGINT', () => rl.close());
  const line = await firstLine(rl);
  process.stdout.write('\n');
  return line;
}

export async function main(argv: string[]): Promise<number> {
  const fail = (message: string, code: number) => {
    process.stderr.write(`${message}\n`);
    return code;
  };
  let rotateSessions: boolean;
  let off: boolean;
  try {
    const { values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { 'rotate-sessions': { type: 'boolean' }, off: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    });
    if (values.help === true) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    rotateSessions = values['rotate-sessions'] === true;
    off = values.off === true;
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`, 2);
  }
  if (off && rotateSessions) return fail(`--off takes no other option\n${USAGE}`, 2);
  const file = configPath();
  let cfg: AppConfig;
  try {
    cfg = loadConfig(file);   // before asking, so a damaged file is reported first
  } catch (err) {
    if (err instanceof ConfigError) return fail(err.message, 1);
    throw err;
  }
  if (off) {
    saveConfig(turnPasswordOff(cfg), file);
    process.stdout.write('The planner no longer asks for a password. Restart the planner if it is running.\n');
    return 0;
  }
  const password = process.stdin.isTTY
    ? await promptHidden('New shared password: ')
    : await firstLine(createInterface({ input: process.stdin, terminal: false }));
  process.stdin.destroy();   // the rest of stdin is not read, and an open pipe must not keep the process alive
  if (password === null) return fail('No password given; nothing changed.', 1);
  let next: AppConfig;
  try {
    next = applyNewPassword(cfg, password, { rotateSessions });
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : String(err)}; nothing changed.`, 1);
  }
  saveConfig(next, file);
  process.stdout.write('Password set; the planner asks for it from now on. Restart the planner if it is running.\n');
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
