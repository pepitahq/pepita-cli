import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __walkLocalForTest as walkLocal } from '../src/tree.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pepita-walk-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('walkLocal', () => {
  it('strips blocked dotfiles, keeps .well-known, injects .gitkeep per non-root folder', () => {
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    writeFileSync(join(dir, '.DS_Store'), 'junk');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'logo.png'), 'PNG');
    mkdirSync(join(dir, '.well-known'));
    writeFileSync(join(dir, '.well-known', 'security.txt'), 'contact: x');

    const out = walkLocal(dir);
    const paths = [...out.keys()].sort();

    expect(paths).toContain('index.html');
    expect(paths).toContain('assets/logo.png');
    expect(paths).toContain('.well-known/security.txt');
    // blocked dotfiles stripped
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('.DS_Store');
    // .gitkeep in every non-root folder (assets + .well-known), not at root
    expect(paths).toContain('assets/.gitkeep');
    expect(paths).toContain('.well-known/.gitkeep');
    expect(paths).not.toContain('.gitkeep');
  });
});
