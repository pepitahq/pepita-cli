import { apiBase, loadConfig } from './config.js';
import { CLIENT_ID } from './version.js';
import { makePepitaApi, PepitaHttpError, type PepitaApi } from '@pepitahq/shared';

export { PepitaHttpError };
export type { PepitaApi };

export class AuthError extends Error {}
/** Thrown for bad/missing CLI arguments — printed as a plain `usage: …` line
 *  (no `Error:` prefix) by the top-level handler. */
export class UsageError extends Error {}

/** The single pepita API client (the same one the MCP uses, from @pepitahq/shared),
 *  built from the stored config. Auth endpoints (login/logout) still use apiFetch. */
/** The api client for this process, built once so the upgrade advice the server
 *  sends on any request survives to the end of the command. */
let cached: PepitaApi | null = null;

/** The minimum version the server last advised, or null. Read after the command
 *  runs — see `noticeUpgrade` in index.ts. */
export function lastUpgradeAdvised(): string | null {
  return cached?.upgradeAdvised() ?? null;
}

export function api(): PepitaApi {
  if (cached) return cached;
  cached = makePepitaApi({
    apiBase: apiBase(),
    token: loadConfig().token ?? '',
    // Identifies this published binary so the server can advise an upgrade when
    // the API has moved past it. Warn-only — never blocks a command.
    clientId: CLIENT_ID
  });
  return cached;
}

/** What to say about a 401. A stored token the server REJECTS is not the same
 *  state as never having logged in: it was revoked (avatar → Settings → Devices,
 *  where one stray click on the wrong row does it) or otherwise invalidated.
 *  Telling that user "not logged in" sends them hunting for a logout they never
 *  performed — which is exactly what happened on 2026-07-25. */
export function authErrorMessage(): string {
  return loadConfig().token
    ? 'This device’s access was revoked or is no longer valid — run `pepita login` to reconnect.'
    : 'Not logged in — run `pepita login`.';
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = loadConfig();
  const headers = new Headers(init.headers);
  if (cfg.token) headers.set('authorization', `Bearer ${cfg.token}`);
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (res.status === 401) throw new AuthError(authErrorMessage());
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
