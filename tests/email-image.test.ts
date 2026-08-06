import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImageAdd, runImageList, runImageRm } from '../src/commands/email.js';

const T = { id: 'a1', name: 'contact', sha: 'sha-1', subject: 'S', from: 'info', fromName: 'Acme', toField: 'email' };

function fakeApi(overrides: Partial<Record<string, any>> = {}) {
  return {
    listTemplates: async () => [T],
    templateImages: async () => [],
    uploadTemplateImage: async (_s: string, _id: string, name: string, bytes: Uint8Array) => ({
      name,
      size: bytes.byteLength
    }),
    removeTemplateImage: async () => {},
    ...overrides
  } as any;
}

// The name→id lookup (`byName` in template.ts) is the SAME helper every
// template subcommand uses — read/put/save/rm and the three image verbs all
// go through it. A regression here would silently break more than images, so
// pin it once for all three image verbs rather than trusting the shared code
// path by inference.
describe('template image commands — name→id lookup', () => {
  it('add / list / rm all name the templates that DO exist when the form is unknown', async () => {
    const client = fakeApi(); // listTemplates() -> [T] (name: 'contact')
    const msg = /No template for form "nope"\. Existing: contact/;
    await expect(runImageAdd(client, 's', 'nope', '/tmp/whatever.jpg')).rejects.toThrow(msg);
    await expect(runImageList(client, 's', 'nope')).rejects.toThrow(msg);
    await expect(runImageRm(client, 's', 'nope', 'hero.jpg')).rejects.toThrow(msg);
  });

  it('a real form name resolves without complaint', async () => {
    const client = fakeApi();
    await expect(runImageList(client, 's', 'contact')).resolves.toMatch(/No images/i);
  });
});

// The server answers `{name, size}` only (see pepita-api.ts's templateImages
// doc comment) — it deliberately never sends a URL, because the URL is
// host-dependent and fully derivable client-side. If the server ever started
// sending one and a future edit switched to printing THAT, this is the test
// that would have to change to notice it.
describe('runImageList — builds the URL itself, never expects one from the server', () => {
  it('prints {slug}.pepita.page/__pepita/tpl/{id}/{name}', async () => {
    const client = fakeApi({ templateImages: async () => [{ name: 'hero.jpg', size: 2048 }] });
    const out = await runImageList(client, 'acme', 'contact');
    expect(out).toContain('acme.pepita.page/__pepita/tpl/a1/hero.jpg');
  });
});

// `basename(file)` is what template.ts sends as the image name — a local
// directory the founder happens to keep the file in ("photos/", "Downloads/")
// is not part of the object's identity on the server, and sending the full
// path would either be rejected as an invalid image name or silently create a
// name nobody who saw the file would recognise.
describe('runImageAdd — sends the file BASENAME, not its local path', () => {
  it('strips the directory before naming the upload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pepita-template-image-test-'));
    try {
      const nested = join(dir, 'photos');
      mkdirSync(nested);
      const file = join(nested, 'hero.jpg');
      writeFileSync(file, Buffer.from('fake-bytes'));

      let sentName: string | undefined;
      const client = fakeApi({
        uploadTemplateImage: async (_s: string, _id: string, name: string, bytes: Uint8Array) => {
          sentName = name;
          return { name, size: bytes.byteLength };
        }
      });
      await runImageAdd(client, 's', 'contact', file);
      expect(sentName).toBe('hero.jpg');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// A header can only carry ISO-8859-1; setting one with anything else THROWS
// (an undici TypeError), which would turn a founder's non-Latin filename into
// an unreadable crash instead of a refusal they can act on. The CLI must
// sanitize before it ever reaches that header, the same guard the editor's
// browser upload path applies — and since the server now normalises names on
// its side too, the sanitised value will usually still land as a legal name.
describe('runImageAdd — sanitizes non-Latin-1 filenames so the upload never throws', () => {
  it('replaces characters outside the header-safe range with "?" before sending', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pepita-template-image-test-'));
    try {
      const raw = 'Árvíztűrő.png';
      const file = join(dir, raw);
      writeFileSync(file, Buffer.from('fake-bytes'));

      let sentName: string | undefined;
      const client = fakeApi({
        uploadTemplateImage: async (_s: string, _id: string, name: string, bytes: Uint8Array) => {
          sentName = name;
          return { name, size: bytes.byteLength };
        }
      });
      await runImageAdd(client, 's', 'contact', file);
      expect(sentName).toBe(raw.replace(/[^\x20-\x7e]/g, '?'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The server owns every naming rule (allowed characters, length, extension).
// A CLI that trims, lower-cases or otherwise "cleans up" the name before
// sending it would be a second, driftable copy of those rules — `rm` must be
// a pure pass-through so the server's own message is what the founder sees.
describe('runImageRm — passes the image name through untouched', () => {
  it('does not normalize, case-fold, or trim the name', async () => {
    let received: string | undefined;
    const client = fakeApi({
      removeTemplateImage: async (_s: string, _id: string, name: string) => {
        received = name;
      }
    });
    const odd = 'Hero Photo (Final).JPG';
    await runImageRm(client, 's', 'contact', odd);
    expect(received).toBe(odd);
  });
});
