import { apiBase, loadConfig } from './config.js';
import { makePepitaApi, PepitaHttpError, type PepitaApi } from '@pepitahq/shared';

export { PepitaHttpError };
export type { PepitaApi };

export class AuthError extends Error {}
/** Thrown for bad/missing CLI arguments — printed as a plain `usage: …` line
 *  (no `Error:` prefix) by the top-level handler. */
export class UsageError extends Error {}

/** The single pepita API client (the same one the MCP uses, from @pepitahq/shared),
 *  built from the stored config. Auth endpoints (login/logout) still use apiFetch. */
export function api(): PepitaApi {
  return makePepitaApi({ apiBase: apiBase(), token: loadConfig().token ?? '' });
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = loadConfig();
  const headers = new Headers(init.headers);
  if (cfg.token) headers.set('authorization', `Bearer ${cfg.token}`);
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (res.status === 401) throw new AuthError('Not logged in — run `pepita login`.');
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
