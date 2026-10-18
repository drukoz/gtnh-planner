// JSON calls to the planner's own API (architecture §7). Every call says who is acting (X-Planner-Name, URI-encoded so
// names such as "Jörg 🙂" survive the header), a lost session sends the page to the login form, and any other failed
// answer becomes an ApiError carrying the server's `{ error, message }`.

import { NAME_HEADER, type ApiError as ApiErrorBody } from '../../shared/types/api.ts';
import { currentPath, navigate } from '../router.ts';
import { getName } from '../state/name.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function errorOf(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody> | null;
  } catch {
    // not JSON (a proxy's error page, say)
  }
  const code = typeof body?.error === 'string' ? body.error : `http-${res.status}`;
  const message = typeof body?.message === 'string' ? body.message : `The server answered ${res.status}`;
  return new ApiError(res.status, code, message);
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const name = getName();
  if (name !== null) headers[NAME_HEADER] = encodeURIComponent(name);
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 401 && location.pathname !== '/login') {
    // The login form itself gets 401 for a wrong password and shows it; everywhere else it means "log in again".
    navigate(`/login?next=${encodeURIComponent(currentPath())}`);
  }
  if (!res.ok) throw await errorOf(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return call<T>('GET', path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return call<T>('POST', path, body);
}

/** Same headers, 401 redirect and ApiError as apiPost; resolves on 204 (architecture §11.23). */
export function apiDelete(path: string): Promise<void> {
  return call<void>('DELETE', path);
}

/** What went wrong, in words fit to show: the server's message, or the browser's for a network failure. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
