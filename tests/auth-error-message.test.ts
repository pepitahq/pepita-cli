import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A 401 has two completely different causes, and conflating them is what made a
// revoked device look like a logout the user never performed (2026-07-25):
//   • no token stored        → never logged in on this machine
//   • token stored, rejected → revoked from Settings → Devices, or invalidated
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pepita-cli-'));
  process.env.PEPITA_CONFIG_DIR = dir;
  delete process.env.PEPITA_API_BASE;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('authErrorMessage', () => {
  it('says "not logged in" only when no token is stored', async () => {
    const { authErrorMessage } = await import('../src/api');
    expect(authErrorMessage()).toBe('Not logged in — run `pepita login`.');
  });

  it('reports a revoked device when a token IS stored', async () => {
    const { saveConfig } = await import('../src/config');
    const { authErrorMessage } = await import('../src/api');
    saveConfig({ apiBase: 'https://app.pepita.dev', token: 'tok', email: 'a@b.com' });
    const msg = authErrorMessage();
    expect(msg).toMatch(/revoked/i);
    // The old wording is the bug — it must not come back for this case.
    expect(msg).not.toMatch(/not logged in/i);
  });

  it('both wordings tell the user how to recover', async () => {
    const { saveConfig } = await import('../src/config');
    const { authErrorMessage } = await import('../src/api');
    expect(authErrorMessage()).toContain('pepita login');
    saveConfig({ apiBase: 'https://app.pepita.dev', token: 'tok' });
    expect(authErrorMessage()).toContain('pepita login');
  });
});
