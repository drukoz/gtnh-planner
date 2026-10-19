// The shared password and the session cookie (spec §3.11, architecture §7, §9): the password is kept only as a
// scrypt hash, a login earns an HMAC-signed cookie that lasts 30 days, and an address that keeps guessing wrong is
// refused for a while, because the planner's port is open to the internet.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'gp_session';
/** 30 days. */
export const SESSION_MAX_AGE_S = 2_592_000;

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000;
const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const WHOLE_NUMBER = /^[1-9]\d{0,9}$/;

/** `scrypt$16384$8$1$<salt base64>$<key base64>` with a fresh random salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Whether `password` matches a hash made by `hashPassword`; `false` for an empty or malformed `stored`. */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof stored !== 'string') return false;   // loadConfig does not type-check this field
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [scheme, n, r, p, saltText, keyText] = parts as [string, string, string, string, string, string];
  if (scheme !== 'scrypt' || ![n, r, p].every((x) => WHOLE_NUMBER.test(x))) return false;
  if (!BASE64.test(saltText) || !BASE64.test(keyText)) return false;
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(keyText, 'base64');
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;   // a short key would match too easily
  try {
    return timingSafeEqual(scryptSync(password, salt, KEY_BYTES, { N: Number(n), r: Number(r), p: Number(p) }), expected);
  } catch {
    return false;   // cost parameters scrypt refuses (N not a power of two, too much memory)
  }
}

/** 32 random bytes as 64 hex digits. */
export function newSessionSecret(): string {
  return randomBytes(32).toString('hex');
}

function mac(secret: string, issuedAt: string): string {
  return createHmac('sha256', secret).update(issuedAt).digest('base64url');
}

/** `<issuedAtMs>.<base64url HMAC-SHA256 of the timestamp text>`. */
export function signSession(secret: string, issuedAtMs: number): string {
  const issuedAt = String(issuedAtMs);
  return `${issuedAt}.${mac(secret, issuedAt)}`;
}

/** A token `signSession(secret, …)` made at most 30 days before `nowMs` (and not after it); never with no secret. */
export function verifySession(secret: string, token: string | undefined, nowMs: number): boolean {
  if (typeof secret !== 'string' || secret === '' || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');   // base64url has no '.'
  if (dot <= 0) return false;
  const issuedAt = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(secret, issuedAt));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const age = nowMs - Number(issuedAt);
  return age >= 0 && age <= SESSION_MAX_AGE_MS;
}

const COOKIE_ATTRIBUTES = 'HttpOnly; SameSite=Strict; Path=/';

/** The `Set-Cookie` value that hands out a session token for 30 days. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_MAX_AGE_S}`;
}

/** The `Set-Cookie` value that removes the session cookie. */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** The first value of cookie `name` in a `Cookie` request header, as sent. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq >= 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

/** The scheme in any case, one or more spaces, then a token with no whitespace in it, to the end of the header. */
const BEARER = /^bearer +(\S+)$/i;

/** The token in an `Authorization: Bearer <token>` header (architecture §11.22), else null. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return BEARER.exec(header)?.[1] ?? null;
}

/**
 * Counts wrong passwords per client address: once an address has `maxFailures` (5) failures less than `windowMs`
 * (15 minutes) old, it is refused until enough of them are older than that. Memory stays bounded by the addresses
 * that failed recently.
 */
export class LoginLimiter {
  readonly #maxFailures: number;
  readonly #windowMs: number;
  /** Per address, the times of its recent failures, oldest first, at most `maxFailures` of them. */
  readonly #failures = new Map<string, number[]>();
  #sweptAt = -Infinity;

  constructor(opts: { maxFailures?: number; windowMs?: number } = {}) {
    this.#maxFailures = opts.maxFailures ?? 5;
    this.#windowMs = opts.windowMs ?? 900_000;
  }

  blocked(ip: string, nowMs: number): boolean {
    return this.#recent(ip, nowMs).length >= this.#maxFailures;
  }

  fail(ip: string, nowMs: number): void {
    this.#sweep(nowMs);
    this.#failures.set(ip, [...this.#recent(ip, nowMs), nowMs].slice(-this.#maxFailures));
  }

  succeed(ip: string): void {
    this.#failures.delete(ip);
  }

  #recent(ip: string, nowMs: number): number[] {
    return (this.#failures.get(ip) ?? []).filter((at) => nowMs - at < this.#windowMs);
  }

  /** At most once per window, forgets the addresses whose failures have all left it. */
  #sweep(nowMs: number): void {
    if (nowMs - this.#sweptAt < this.#windowMs) return;
    this.#sweptAt = nowMs;
    for (const [ip, times] of this.#failures) {
      if (times.every((at) => nowMs - at >= this.#windowMs)) this.#failures.delete(ip);
    }
  }
}
