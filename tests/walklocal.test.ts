import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __walkLocalForTest as walkLocal } from '../src/tree.js';
import { UsageError } from '../src/api.js';

/** An ISO-BMFF header whose major brand says "video" — the bytes a real mp4 starts with. */
function mp4Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.alloc(64) // body — irrelevant, only the head is sniffed
  ]);
}

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

describe('walkLocal video ingest gate', () => {
  it('refuses the whole batch when a video is present, by BYTES not extension', () => {
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    // A video renamed `.txt` — the extension lies, the bytes don't.
    writeFileSync(join(dir, 'promo.txt'), mp4Bytes());
    mkdirSync(join(dir, 'clips'));
    writeFileSync(join(dir, 'clips', 'intro.mp4'), mp4Bytes());

    try {
      walkLocal(dir);
      throw new Error('expected walkLocal to refuse the batch');
    } catch (err) {
      expect(err).toBeInstanceOf(UsageError);
      const msg = (err as Error).message;
      // Every offender is named — the user must know which files to pull out.
      expect(msg).toContain('promo.txt');
      expect(msg).toContain('clips/intro.mp4');
      expect(msg).toContain('video/mp4');
      expect(msg).toContain('Nothing was applied.');
      expect(msg).toContain('pepita asset add');
    }
  });

  it('allows non-video files whose bytes are unknown (conservative default)', () => {
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    writeFileSync(join(dir, 'empty.txt'), '');

    const paths = [...walkLocal(dir).keys()].sort();
    expect(paths).toEqual(['empty.txt', 'index.html', 'logo.png']);
  });

  it('legacy carve-out: an UNCHANGED-vs-server video is a no-op, not an offence', async () => {
    const { computeApplyPlan } = await import('../src/tree.js');
    const clip = mp4Bytes();
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(dir, 'clip.mp4'), clip);

    const serverTree = new Map([
      ['index.html', { content: '<h1>old</h1>', encoding: 'utf-8' as const }],
      ['clip.mp4', { content: clip.toString('base64'), encoding: 'base64' as const }]
    ]);

    const out = walkLocal(dir, serverTree);
    // Present in the map (as the server's own entry) → computeApplyPlan
    // neither writes it (contents equal) nor DELETES it (counts as present
    // locally). The delete half is the critical one: apply mirrors deletions
    // for locally-missing paths, so mere exclusion would nuke the live file.
    expect(out.has('clip.mp4')).toBe(true);
    const plan = computeApplyPlan(out, serverTree);
    expect(plan.writes).toEqual(['index.html']);
    expect(plan.deletes).toEqual([]);
  });

  it('legacy carve-out does NOT admit a CHANGED video — whole batch still refused', () => {
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(dir, 'clip.mp4'), mp4Bytes());

    // Same path on the server, different bytes (different size, too).
    const serverTree = new Map([
      [
        'clip.mp4',
        {
          content: Buffer.concat([mp4Bytes(), Buffer.alloc(8)]).toString('base64'),
          encoding: 'base64' as const
        }
      ]
    ]);

    expect(() => walkLocal(dir, serverTree)).toThrow(UsageError);
    // And with no server tree at all (the create path), a video always refuses.
    expect(() => walkLocal(dir)).toThrow(UsageError);
  });
});
