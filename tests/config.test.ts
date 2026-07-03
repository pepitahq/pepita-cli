import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pepita-cli-'));
  process.env.PEPITA_CONFIG_DIR = dir;
  delete process.env.PEPITA_API_BASE;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('config store', () => {
  it('round-trips config and defaults the apiBase', async () => {
    const { loadConfig, saveConfig } = await import('../src/config');
    expect(loadConfig().apiBase).toBe('https://app.pepita.dev');
    saveConfig({ apiBase: 'https://app.pepita.dev', token: 'tok', email: 'a@b.com' });
    const c = loadConfig();
    expect(c.token).toBe('tok');
    expect(c.email).toBe('a@b.com');
  });
  it('writes the config file with 0600 perms', async () => {
    const { saveConfig, configPath } = await import('../src/config');
    saveConfig({ apiBase: 'https://app.pepita.dev', token: 't' });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });
  it('clearAuth removes token+email but keeps apiBase', async () => {
    const { saveConfig, clearAuth, loadConfig } = await import('../src/config');
    saveConfig({ apiBase: 'https://x', token: 't', email: 'e' });
    clearAuth();
    const c = loadConfig();
    expect(c.token).toBeUndefined();
    expect(c.apiBase).toBe('https://x');
  });
});
