import { createServer } from 'node:http';
import { hostname, userInfo } from 'node:os';
import { spawn } from 'node:child_process';
import { sha256Base64Url } from '@pepitahq/shared';
import { apiBase, loadConfig, saveConfig, clearAuth } from './config.js';
import { apiFetch } from './api.js';

const LOGIN_TIMEOUT_MS = 180_000;

function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

/** Loopback OAuth handoff. Resolves once a token is stored. */
export async function login(): Promise<void> {
  const verifier = randomString(32);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(16);
  const label = `${hostname()} (${userInfo().username})`;

  // `port` is assigned once the loopback server binds (in the `listen`
  // callback) and read when the browser redirects back to `/callback` (in
  // the `createServer` request-handler callback). Both closures share this
  // single `let` declared in the executor's scope so `port` is always in
  // scope where it's used — it doesn't need to travel through the
  // resolved value, since nothing after resolution needs it.
  const { code } = await new Promise<{ code: string }>((resolve, reject) => {
    let port = 0;
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '', 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get('code');
      const gotState = u.searchParams.get('state');
      res.writeHead(200, { 'content-type': 'text/html' }).end(
        '<html><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2>pepita CLI</h2><p>You can close this tab and return to the terminal.</p></body></html>'
      );
      server.close();
      clearTimeout(timer);
      if (!code || gotState !== state) reject(new Error('Authorization failed (state mismatch).'));
      else resolve({ code });
    });
    // If the user clicks Cancel on the consent page (or never gets there),
    // the loopback server never receives a `/callback` hit and this promise
    // would otherwise hang forever. Give up after a few minutes.
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          'Login timed out (no response). If you clicked Cancel, run `pepita login` again.'
        )
      );
    }, LOGIN_TIMEOUT_MS);
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      const url = `${apiBase()}/auth/cli/authorize?port=${port}&state=${state}&code_challenge=${challenge}&label=${encodeURIComponent(label)}`;
      console.log('Opening your browser to authorize…');
      console.log(url);
      openBrowser(url);
    });
  });

  const res = await fetch(`${apiBase()}/auth/cli/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier })
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const { token, user } = (await res.json()) as { token: string; user: { email: string } };
  const cfg = loadConfig();
  saveConfig({ ...cfg, token, email: user.email });
  console.log(`Logged in as ${user.email}.`);
}

export async function logout(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.token) {
    // Best-effort server-side revoke — logout must ALWAYS clear the local
    // config even if this network call fails (offline, server down, token
    // already revoked, etc.).
    try {
      await apiFetch('/api/cli-tokens/current', { method: 'DELETE' });
    } catch {
      // ignore — local config is cleared unconditionally below.
    }
  }
  clearAuth();
  console.log('Logged out.');
}

export function whoami(): void {
  const cfg = loadConfig();
  console.log(cfg.token ? (cfg.email ?? 'logged in') : 'Not logged in — run `pepita login`.');
}
