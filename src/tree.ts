import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { api, UsageError } from './api.js';
import { isBlockedDotfile, rawByteLength } from '@pepitahq/shared';

export type Encoding = 'utf-8' | 'base64';
export type FileEntry = { content: string; encoding: Encoding };

/**
 * Which snapshot of a site `pull` fetches. Deliberately avoids version-control
 * words (no "branch"): these are the three product states.
 *   live    → the published site        (committed main)
 *   draft   → the --draft staging site  (committed develop — excludes unsaved)
 *   unsaved → your current working copy  (committed develop + un-saved edits)
 */
export type PullState = 'live' | 'draft' | 'unsaved';

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
 * and symmetrically against a locally symlink-escaped path being pushed.
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

/** Pure diff: which paths to write (new or changed) and which to delete. */
export function computePushPlan(
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

/** The current unsaved working copy (committed develop + un-saved edits). Used
 *  for the `unsaved` pull state AND as the diff base for `apply` (so we only
 *  send changed files). */
async function fetchRemote(slug: string, branch: 'develop' | 'main'): Promise<Map<string, FileEntry>> {
  const tree = await api().getTree(slug, branch);
  return new Map(tree.files.map((f) => [f.path, { content: f.content, encoding: f.encoding }]));
}

/** A committed checkout (live=main, draft=develop) as raw bytes per path —
 *  the same complete, unsaved-excluding snapshot the editor's "Download .zip"
 *  produces. Fetched as a zip and unpacked in memory. */
async function fetchCheckout(slug: string, branch: 'develop' | 'main'): Promise<Map<string, Uint8Array>> {
  const res = await api().raw(`/api/sites/${encodeURIComponent(slug)}/download?branch=${branch}`);
  if (!res.ok) throw new Error(`GET /download?branch=${branch} → ${res.status} ${await res.text()}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  return new Map(Object.entries(unzipSync(zip)));
}

export async function pull(slug: string, state: PullState, dir: string): Promise<number> {
  // Normalize every state to raw bytes per path, then write once.
  let files: Map<string, Uint8Array>;
  if (state === 'unsaved') {
    files = new Map();
    for (const [path, f] of await fetchRemote(slug, 'develop')) {
      files.set(path, Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf-8'));
    }
  } else {
    files = await fetchCheckout(slug, state === 'live' ? 'main' : 'develop');
  }

  let written = 0;
  for (const [path, bytes] of files) {
    if (!isSafeRelPath(path)) {
      console.warn(`skipping unsafe remote path: ${path}`);
      continue;
    }
    const abs = join(dir, ...path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    written++;
  }
  return written;
}

function walkLocal(dir: string): Map<string, FileEntry> {
  const out = new Map<string, FileEntry>();
  // Feature-C ingest barrier: dotfiles are stripped (except `.well-known/*`
  // and the `.gitkeep` marker — `isBlockedDotfile` encodes the rule), and every
  // non-root folder gets a `.gitkeep` so it survives server-side (the store is
  // path-based and has no empty-folder concept). We also skip `.git` (never
  // upload the VCS database).
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === '.git') continue;
      const abs = join(d, name);
      const rel = relative(dir, abs).split(sep).join('/');
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      if (!isSafeRelPath(rel)) {
        console.warn(`skipping unsafe local path: ${rel}`);
        continue;
      }
      if (isBlockedDotfile(rel)) continue; // strip dotfiles at the barrier
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
  return out;
}

/** Test-only export of the module-private walkLocal. */
export const __walkLocalForTest = walkLocal;

const MB = 1024 * 1024;

/** Human-readable multi-line message for a failed preflight verdict. */
export function formatPreflightError(pf: import('@pepitahq/shared').PreflightResult): string {
  const lines: string[] = ['push would exceed pepita size limits:'];
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

/** Upload local files into the site's unsaved working copy (`apply`). Diffs
 *  against the current working copy so only changed/removed paths are sent;
 *  `save` then persists them to the draft. */
export async function applyLocal(
  slug: string,
  dir: string,
  yes: boolean,
  confirm: (plan: { writes: string[]; deletes: string[] }) => Promise<boolean>
): Promise<{ written: number; deleted: number }> {
  const local = walkLocal(dir);
  const remote = await fetchRemote(slug, 'develop');
  const plan = computePushPlan(local, remote);
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
