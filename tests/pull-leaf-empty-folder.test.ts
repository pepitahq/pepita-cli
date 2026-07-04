import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';

// pull() reaches the network via api() (fetchCheckout → api().raw(...)). Mock
// just that seam so the test stays a pure unit test of the write loop, per
// the "don't force a brittle mock" guidance — this only stubs the one call
// pull makes for a 'draft'/'live' pull, nothing about pull's own logic.
vi.mock('../src/api.js', () => ({
  api: () => ({
    raw: async () => {
      // A remote checkout whose only content under `empty/` is the
      // server-side .gitkeep folder-keeper — the leaf-empty-folder case.
      const zip = zipSync({ 'empty/.gitkeep': new Uint8Array(0) });
      return {
        ok: true,
        arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
      };
    }
  })
}));

const { pull } = await import('../src/tree.js');

describe('pull — leaf empty folder', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('materializes the containing folder even though the .gitkeep marker itself is skipped', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pepita-pull-test-'));
    const written = await pull('some-site', 'draft', dir);

    // The marker file itself must NOT be written (rule 5).
    expect(existsSync(join(dir, 'empty', '.gitkeep'))).toBe(false);
    // But the folder it was keeping alive MUST exist on disc, so a
    // subsequent walkLocal re-injects the marker and computePushPlan sees
    // no diff (a pull→apply is a true no-op instead of emitting a DELETE).
    expect(existsSync(join(dir, 'empty'))).toBe(true);
    expect(written).toBe(0);
  });
});
