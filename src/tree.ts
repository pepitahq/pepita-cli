import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { api, UsageError } from './api.js';
import { isBlockedPath, rawByteLength, sniffVideoMime, VIDEO_SNIFF_BYTES } from '@pepitahq/shared';

export type Encoding = 'utf-8' | 'base64';
export type FileEntry = { content: string; encoding: Encoding };

/**
 * What `pull` fetches:
 *   working → the working copy — the site as it stands in the editor
 *   live    → the published site
 *   preview → a specific preview link, by name
 */
export type PullTarget =
  | { kind: 'working' }
  | { kind: 'live' }
  | { kind: 'preview'; name: string };

// Kept in sync with pepita's textual-storage contract (which file types are
// stored as UTF-8 vs base64). A mismatch here causes encoding flip-flop /
// phantom diffs between the CLI and the editor.
const TEXT_EXT = new Set(['txt', 'xml', 'html', 'htm', 'js', 'css', 'webmanifest', 'svg']);
const TEXT_BASENAMES = new Set(['_headers', '.gitkeep']);

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function encodingFor(path: string): Encoding {
  const base = baseName(path);
  if (TEXT_BASENAMES.has(base)) return 'utf-8';
  return TEXT_EXT.has(base.split('.').pop()?.toLowerCase() ?? '') ? 'utf-8' : 'base64';
}

/**
 * True iff `p` is a relative path that stays inside its base directory:
 * non-empty, not absolute, and contains no `..` segment. Guards against a
 * malicious/misbehaving server-provided path escaping the pull target dir,
 * and symmetrically against a locally symlink-escaped path being uploaded.
 */
export function isSafeRelPath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  const segments = p.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '..') return false;
  }
  return true;
}

/** Rule 5: `.gitkeep` markers are server-side folder keepers — never write
 *  them to local disc (a fresh walkLocal re-injects them on the next apply). */
export function shouldWriteToDisc(path: string): boolean {
  return baseName(path) !== '.gitkeep';
}

/** Pure diff: which paths to write (new or changed) and which to delete. */
export function computeApplyPlan(
  local: Map<string, FileEntry>,
  remote: Map<string, FileEntry>
): { writes: string[]; deletes: string[] } {
  const writes: string[] = [];
  const deletes: string[] = [];
  for (const [path, l] of local) {
    const r = remote.get(path);
    if (!r || r.content !== l.content || r.encoding !== l.encoding) writes.push(path);
  }
  for (const path of remote.keys()) if (!local.has(path)) deletes.push(path);
  return { writes, deletes };
}

/** The working copy — the site as it stands in the editor. Used for the working
 *  pull target AND as the diff base for `apply` (so we only send changed files). */
async function fetchRemote(slug: string): Promise<Map<string, FileEntry>> {
  const tree = await api().getTree(slug);
  return new Map(tree.files.map((f) => [f.path, { content: f.content, encoding: f.encoding }]));
}

/** A committed checkout — `main` (live) or a preview branch — as raw bytes per
 *  path (all files, incl. binary). Fetched as a zip and unpacked in memory. */
async function fetchCheckout(slug: string, branch: string): Promise<Map<string, Uint8Array>> {
  const res = await api().raw(
    `/api/sites/${encodeURIComponent(slug)}/download?branch=${encodeURIComponent(branch)}`
  );
  if (!res.ok) throw new Error(`GET /download?branch=${branch} → ${res.status} ${await res.text()}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  return new Map(Object.entries(unzipSync(zip)));
}

export async function pull(slug: string, target: PullTarget, dir: string): Promise<number> {
  // Normalize every target to raw bytes per path, then write once.
  let files: Map<string, Uint8Array>;
  if (target.kind === 'working') {
    files = new Map();
    for (const [path, f] of await fetchRemote(slug)) {
      files.set(path, Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf-8'));
    }
  } else {
    files = await fetchCheckout(slug, target.kind === 'live' ? 'main' : target.name);
  }

  let written = 0;
  for (const [path, bytes] of files) {
    if (!isSafeRelPath(path)) {
      console.warn(`skipping unsafe remote path: ${path}`);
      continue;
    }
    const abs = join(dir, ...path.split('/'));
    // Rule 5: don't write .gitkeep markers to disc — but DO materialize the
    // folder they keep alive, so a fresh walkLocal re-injects the marker and a
    // pull→apply is a true no-op (otherwise a leaf empty folder reads as a delete).
    mkdirSync(dirname(abs), { recursive: true });
    if (!shouldWriteToDisc(path)) continue;
    writeFileSync(abs, bytes);
    written++;
  }
  return written;
}

/**
 * Sniff a local file's leading bytes for a video container. CONTENT, never the
 * extension — a video renamed `promo.txt` is still a video. Reads only the head
 * (`VIDEO_SNIFF_BYTES`), never the whole file: this runs on every walked file,
 * and the files it exists to catch are the multi-GB ones.
 */
function sniffVideoFile(abs: string): string | null {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(VIDEO_SNIFF_BYTES);
    const read = readSync(fd, buf, 0, VIDEO_SNIFF_BYTES, 0);
    return sniffVideoMime(new Uint8Array(buf.subarray(0, read)));
  } finally {
    closeSync(fd);
  }
}

/** The message for a batch that contains video. Names every offender — the user
 *  has to know which files to pull out, not just that "something" was wrong. */
export function formatVideoIngestError(videos: Array<{ path: string; mime: string }>): string {
  return [
    `video can't live in a site's files (the file tree is for pages, styles and images —`,
    `it has a 5 MB per-file budget). Found:`,
    ...videos.map((v) => `  ${v.path} — ${v.mime}`),
    'Nothing was applied.',
    'Move these out of the folder and upload them with `pepita asset add <file> --site <slug>`,',
    'then reference the URLs it prints from your markup.'
  ].join('\n');
}

function walkLocal(dir: string, serverTree?: ReadonlyMap<string, FileEntry>): Map<string, FileEntry> {
  const out = new Map<string, FileEntry>();
  // The CONTENT-based half of the ingest gate (`isBlockedPath` below is the
  // PATH-based half — different axes, both needed). Video must never enter the
  // worktree, and the server enforces that per-write: were we to walk a video
  // into the plan, the batch would 400 MID-LOOP, after earlier files had already
  // been written — a half-applied site, which is worse than a clean refusal. So
  // we collect every offender and refuse the WHOLE batch before writing anything.
  //
  // LEGACY carve-out (`serverTree`): sites older than the video gate can already
  // carry a small committed video in their working copy — a pull brings it to
  // disc, and without the carve-out that site could never `apply` again. A
  // sniffed video whose bytes are IDENTICAL to the server's copy at the same
  // path is a no-op: we put the server's own entry in the map, so the diff
  // neither writes it (contents equal) nor deletes it (present locally). A NEW
  // or CHANGED video still refuses the whole batch — the gate only yields where
  // applying would change nothing.
  const videos: Array<{ path: string; mime: string }> = [];
  // Feature-C ingest barrier: dotfiles (except `.well-known/*` and the
  // `.gitkeep` marker) AND pepita's reserved `__pepita/` namespace are stripped
  // — `isBlockedPath` encodes both rules, same gate the server enforces. Every
  // non-root folder gets a `.gitkeep` so it survives server-side (the store is
  // path-based and has no empty-folder concept). We also skip `.git` (never
  // upload the VCS database).
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === '.git') continue;
      const abs = join(d, name);
      const rel = relative(dir, abs).split(sep).join('/');
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!isSafeRelPath(rel)) {
        console.warn(`skipping unsafe local path: ${rel}`);
        continue;
      }
      if (isBlockedPath(rel)) continue; // strip dotfiles + reserved paths at the barrier
      // Sniff BEFORE reading the file — a video must never be slurped into memory.
      const videoMime = sniffVideoFile(abs);
      if (videoMime) {
        // Legacy carve-out (see the header comment): unchanged-vs-server is a
        // no-op, not an offence. Size gates the comparison — mismatched size is
        // a changed video (error path) WITHOUT reading it, and a matched size is
        // bounded by the server's per-file budget, so the read is small.
        const server = serverTree?.get(rel);
        if (server && st.size === rawByteLength(server.content, server.encoding)) {
          const localContent =
            server.encoding === 'base64'
              ? readFileSync(abs).toString('base64')
              : readFileSync(abs, 'utf-8');
          if (localContent === server.content) {
            console.warn(`skipping unchanged video ${rel} (already on the site)`);
            out.set(rel, server);
            continue;
          }
        }
        videos.push({ path: rel, mime: videoMime });
        continue;
      }
      const enc = encodingFor(rel);
      const content =
        enc === 'base64' ? readFileSync(abs).toString('base64') : readFileSync(abs, 'utf-8');
      out.set(rel, { content, encoding: enc });
    }
    // Every non-root folder gets a .gitkeep, unconditionally.
    if (d !== dir) {
      const rel = `${relative(dir, d).split(sep).join('/')}/.gitkeep`;
      if (isSafeRelPath(rel)) out.set(rel, { content: '', encoding: 'utf-8' });
    }
  };
  walk(dir);
  // Refuse the whole batch, loudly — never silently strip (that would publish a
  // site whose video simply isn't there, with no warning) and never partially apply.
  if (videos.length > 0) throw new UsageError(formatVideoIngestError(videos));
  return out;
}

/** Test-only export of the module-private walkLocal. */
export const __walkLocalForTest = walkLocal;

const MB = 1024 * 1024;

/** Human-readable multi-line message for a failed preflight verdict. */
export function formatPreflightError(pf: import('@pepitahq/shared').PreflightResult): string {
  const lines: string[] = ['this would exceed pepita size limits:'];
  for (const v of pf.perFileViolations) {
    lines.push(
      `  ${v.path}: ${(v.size / MB).toFixed(1)} MB (max ${(pf.budget.perFileBytes / MB).toFixed(0)} MB per file)`
    );
  }
  if (pf.projectedTotal > pf.budget.totalBytes) {
    lines.push(
      `  total would be ${(pf.projectedTotal / MB).toFixed(1)} MB (max ${(pf.budget.totalBytes / MB).toFixed(0)} MB per site)`
    );
  }
  lines.push('Shrink or remove the oversized file(s) and try again.');
  return lines.join('\n');
}

/** Upload local files into the site's working copy (`apply`). Diffs against the
 *  current working copy so only changed/removed paths are sent; `publish` then
 *  puts them live, or `preview` shares them at a stable link. */
export async function applyLocal(
  slug: string,
  dir: string,
  yes: boolean,
  confirm: (plan: { writes: string[]; deletes: string[] }) => Promise<boolean>
): Promise<{ written: number; deleted: number }> {
  // Remote FIRST: walkLocal needs the server tree to recognize a legacy
  // committed video as unchanged (see the carve-out in walkLocal).
  const remote = await fetchRemote(slug);
  const local = walkLocal(dir, remote);
  const plan = computeApplyPlan(local, remote);
  if (plan.writes.length === 0 && plan.deletes.length === 0) return { written: 0, deleted: 0 };

  const client = api();
  const writes = plan.writes.map((path) => {
    const f = local.get(path)!;
    return { path, size: rawByteLength(f.content, f.encoding) };
  });
  const pf = await client.preflight(slug, { writes, deletes: plan.deletes });
  if (!pf.ok) throw new UsageError(formatPreflightError(pf));

  if (!yes && !(await confirm(plan))) return { written: 0, deleted: 0 };

  for (const path of plan.writes) {
    const f = local.get(path)!;
    await client.writeFile(slug, path, f.content, f.encoding);
  }
  for (const path of plan.deletes) {
    await client.deleteFile(slug, path);
  }
  return { written: plan.writes.length, deleted: plan.deletes.length };
}
