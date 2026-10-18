// Login, logout and the health check (architecture §7, spec §3.11): one shared password earns a 30-day session cookie,
// and an address that keeps guessing wrong is told to slow down.

import type { AppContext } from '../../app.ts';
import { LoginLimiter, clearSessionCookie, sessionCookie, signSession, verifyPassword } from '../auth.ts';
import { HttpError, readJson, sendJson, type Route } from '../router.ts';

/** A login body holds one password; nothing bigger is read. */
const LOGIN_MAX_BYTES = 16_384;

export function authRoutes(app: AppContext): Route[] {
  const limiter = new LoginLimiter();
  return [
    {
      method: 'POST', path: '/api/login', public: true,
      handler: async (req, res) => {
        const body = await readJson<unknown>(req, LOGIN_MAX_BYTES);
        const password = (body as { password?: unknown } | null)?.password;
        if (typeof password !== 'string') throw new HttpError(400, 'bad-request', 'Send {"password": "…"}');
        const ip = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        if (limiter.blocked(ip, now)) throw new HttpError(429, 'slow-down', 'Too many wrong passwords — try again in 15 minutes');
        if (!verifyPassword(password, app.config.passwordHash)) {
          limiter.fail(ip, now);
          throw new HttpError(401, 'bad-password', 'Wrong password');
        }
        limiter.succeed(ip);
        res.writeHead(204, { 'Set-Cookie': sessionCookie(signSession(app.config.sessionSecret, now)) });
        res.end();
      },
    },
    {
      method: 'POST', path: '/api/logout', public: true,
      handler: async (_req, res) => {
        res.writeHead(204, { 'Set-Cookie': clearSessionCookie() });
        res.end();
      },
    },
    {
      method: 'GET', path: '/api/health', public: true,
      handler: async (_req, res) => {
        sendJson(res, 200, { ok: true });
      },
    },
  ];
}
