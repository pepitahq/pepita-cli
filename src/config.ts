import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface PepitaConfig {
  apiBase: string;
  token?: string;
  email?: string;
}

const DEFAULT_API_BASE = 'https://app.pepita.dev';

function configDir(): string {
  return process.env.PEPITA_CONFIG_DIR ?? join(homedir(), '.pepita');
}
export function configPath(): string {
  return join(configDir(), 'config.json');
}
export function apiBase(): string {
  return process.env.PEPITA_API_BASE ?? loadConfig().apiBase ?? DEFAULT_API_BASE;
}

export function loadConfig(): PepitaConfig {
  try {
    const raw = readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PepitaConfig>;
    return { apiBase: DEFAULT_API_BASE, ...parsed };
  } catch {
    return { apiBase: DEFAULT_API_BASE };
  }
}

export function saveConfig(c: PepitaConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

export function clearAuth(): void {
  const c = loadConfig();
  saveConfig({ apiBase: c.apiBase });
}

export function ensureConfigFileExists(): boolean {
  return existsSync(configPath());
}
