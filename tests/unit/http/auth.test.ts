import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verifyPassword, signSession, verifySession, sessionCookie, readCookie, LoginLimiter,
  SESSION_MAX_AGE_S, clearSessionCookie, newSessionSecret } from '../../../src/server/http/auth.ts';
import { applyNewPassword } from '../../../src/server/cli/set-password.ts';
import { loadConfig, type AppConfig } from '../../../src/server/config.ts';

const DAY = 86_400_000;
afterEach(() => { delete process.env.GTNH_PLANNER_CONFIG; });
describe('config', () => {
  it('loadConfig honours GTNH_PLANNER_CONFIG and fills port 8765, host 0.0.0.0, passwordHash "", sessionSecret ""', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gp-cfg-')), 'config.json');
    writeFileSync(file, JSON.stringify({ dataDir: 'data/x', serverFolder: null, activeExportId: 'e1' }));   // Plan 1's fields only
    process.env.GTNH_PLANNER_CONFIG = file;
    expect(loadConfig()).toEqual({ dataDir: 'data/x', serverFolder: null, activeExportId: 'e1',
      port: 8765, host: '0.0.0.0', passwordHash: '', sessionSecret: '', clientJar: null });
  });
});
describe('passwords', () => {
  it('hashes with scrypt and verifies', () => {
    const h = hashPassword('correct horse');
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(verifyPassword('correct horse', h)).toBe(true);
    expect(verifyPassword('wrong horse', h)).toBe(false);
    expect(hashPassword('correct horse')).not.toBe(h);           // random salt
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'scrypt$garbage')).toBe(false);
  });
  it('uses a 16-byte salt and a 32-byte key, and refuses damaged hashes', () => {
    const h = hashPassword('correct horse');
    const [, , , , salt, key] = h.split('$');
    expect(Buffer.from(salt!, 'base64')).toHaveLength(16);
    expect(Buffer.from(key!, 'base64')).toHaveLength(32);
    expect(verifyPassword('correct horse', h.replace(/^scrypt/, 'bcrypt'))).toBe(false);
    expect(verifyPassword('correct horse', h.replace('$16384$', '$abc$'))).toBe(false);
    expect(verifyPassword('correct horse', `${h.slice(0, h.lastIndexOf('$'))}$`)).toBe(false);   // no key
    expect(verifyPassword('correct horse', `${h}$extra`)).toBe(false);
    expect(verifyPassword('anything', `scrypt$16384$8$1$${'A'.repeat(22)}==$a`)).toBe(false);   // key decodes to 0 bytes
    expect(verifyPassword('correct horse', h.replace('$16384$', '$1000$'))).toBe(false);        // N not a power of two
  });
});
describe('sessions', () => {
  const secret = 'a'.repeat(64);
  it('accepts its own token for 30 days only', () => {
    const t = signSession(secret, 1_000);
    expect(verifySession(secret, t, 1_000 + 29 * DAY)).toBe(true);
    expect(verifySession(secret, t, 1_000 + 31 * DAY)).toBe(false);
    expect(verifySession('b'.repeat(64), t, 2_000)).toBe(false);
    expect(verifySession(secret, t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 2_000)).toBe(false);
    expect(verifySession('', t, 2_000)).toBe(false);
    expect(verifySession(secret, undefined, 2_000)).toBe(false);
  });
  it('builds and reads the cookie', () => {
    expect(sessionCookie('tok')).toBe(`gp_session=tok; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_S}`);
    expect(readCookie('a=1; gp_session=tok.x; b=2', 'gp_session')).toBe('tok.x');
    expect(readCookie(undefined, 'gp_session')).toBeUndefined();
  });
  it('refuses tokens from the future, with another timestamp, or without a signature', () => {
    const t = signSession(secret, 5_000);
    expect(verifySession(secret, t, 5_000)).toBe(true);
    expect(verifySession(secret, t, 5_000 + 30 * DAY)).toBe(true);
    expect(verifySession(secret, t, 4_999)).toBe(false);
    expect(verifySession(secret, t.replace(/^5000/, '6000'), 6_000)).toBe(false);
    for (const bad of ['', '5000', '5000.', '.abc', 'x.y']) expect(verifySession(secret, bad, 5_000)).toBe(false);
  });
  it('clears the cookie and makes fresh 32-byte secrets', () => {
    expect(clearSessionCookie()).toBe('gp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    expect(readCookie('xgp_session=1; gp_session_old=2', 'gp_session')).toBeUndefined();
    expect(newSessionSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(newSessionSecret()).not.toBe(newSessionSecret());
  });
});
describe('LoginLimiter', () => {
  it('blocks an address after 5 failures in 15 minutes, then forgets', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 5; i++) l.fail('1.2.3.4', 1000 + i);
    expect(l.blocked('1.2.3.4', 2000)).toBe(true);
    expect(l.blocked('5.6.7.8', 2000)).toBe(false);
    expect(l.blocked('1.2.3.4', 1000 + 15 * 60_000 + 10)).toBe(false);
  });
  it('allows 4 failures, counts only the window, and forgets an address that logs in', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 4; i++) l.fail('1.2.3.4', i * 60_000);
    expect(l.blocked('1.2.3.4', 4 * 60_000)).toBe(false);
    l.fail('1.2.3.4', 15 * 60_000);                              // the failure at 0 has just left the window
    expect(l.blocked('1.2.3.4', 15 * 60_000)).toBe(false);
    l.fail('1.2.3.4', 15 * 60_000 + 1);
    expect(l.blocked('1.2.3.4', 15 * 60_000 + 1)).toBe(true);
    l.succeed('1.2.3.4');
    expect(l.blocked('1.2.3.4', 15 * 60_000 + 2)).toBe(false);
    const strict = new LoginLimiter({ maxFailures: 2, windowMs: 1_000 });
    strict.fail('9.9.9.9', 0);
    strict.fail('9.9.9.9', 10);
    expect(strict.blocked('9.9.9.9', 999)).toBe(true);
    expect(strict.blocked('9.9.9.9', 1_010)).toBe(false);
  });
});
describe('applyNewPassword', () => {
  const base = { port: 8765, host: '0.0.0.0', dataDir: 'data', serverFolder: null, activeExportId: null, passwordHash: '', sessionSecret: '' } as AppConfig;
  it('sets the hash and creates a session secret once', () => {
    const a = applyNewPassword(base, 'hunter2hunter2', { rotateSessions: false });
    expect(verifyPassword('hunter2hunter2', a.passwordHash)).toBe(true);
    expect(a.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
    const b = applyNewPassword(a, 'another-password', { rotateSessions: false });
    expect(b.sessionSecret).toBe(a.sessionSecret);
    expect(applyNewPassword(a, 'another-password', { rotateSessions: true }).sessionSecret).not.toBe(a.sessionSecret);
  });
  it('rejects short passwords', () => {
    expect(() => applyNewPassword(base, 'short', { rotateSessions: false })).toThrow('at least 8 characters');
  });
  it('keeps every other setting and accepts exactly 8 characters', () => {
    const cfg = { ...base, port: 9000, serverFolder: '/srv/gtnh', future: 'kept' } as AppConfig;
    const next = applyNewPassword(cfg, '12345678', { rotateSessions: false });
    expect({ ...next, passwordHash: '', sessionSecret: '' }).toEqual({ ...cfg });
    expect(base.passwordHash).toBe('');                          // the input is not changed
    expect(() => applyNewPassword(base, '1234567', { rotateSessions: false })).toThrow('Password must be at least 8 characters');
  });
});
