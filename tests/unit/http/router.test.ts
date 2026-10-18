import { describe, it, expect } from 'vitest';
import { matchRoute, HttpError, type Route } from '../../../src/server/http/router.ts';

const h: Route['handler'] = async () => {};
const routes: Route[] = [{ method: 'GET', path: '/api/files/*', handler: h }, { method: 'GET', path: '/api/stuff/:key', handler: h }];

describe('matchRoute', () => {
  it('sees encoded dot segments as ".." (the raw path is matched, then each param is decoded once)', () => {
    expect(matchRoute(routes, 'GET', '/api/files/%2e%2e/%2e%2e/config.json')?.params).toEqual({ '*': '../../config.json' });
    expect(matchRoute(routes, 'GET', '/api/stuff/t%3Airon_plate%400')?.params).toEqual({ key: 't:iron_plate@0' });
    expect(matchRoute(routes, 'GET', '/api/stuff/a%252F')?.params).toEqual({ key: 'a%2F' });
    expect(matchRoute(routes, 'POST', '/api/stuff/x')).toBeNull();
  });
  it('turns a malformed escape into HttpError 400 bad-path', () => {
    expect(() => matchRoute(routes, 'GET', '/api/files/%E0%A4%A.png')).toThrow(HttpError);
    const err = (() => { try { matchRoute(routes, 'GET', '/api/stuff/%E0%A4%A'); return null; } catch (e) { return e; } })();
    expect(err).toMatchObject({ status: 400, code: 'bad-path' });
  });
});
