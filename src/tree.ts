import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { api } from './api.js';

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
const TEXT_BASENAMES = new Set(['_headers']);

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
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === '.git' || name === 'node_modules') continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const rel = relative(dir, abs).split(sep).join('/');
        if (!isSafeRelPath(rel)) {
          console.warn(`skipping unsafe local path: ${rel}`);
          continue;
        }
        const enc = encodingFor(rel);
        const content =
          enc === 'base64' ? readFileSync(abs).toString('base64') : readFileSync(abs, 'utf-8');
        out.set(rel, { content, encoding: enc });
      }
    }
  };
  walk(dir);
  return out;
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
  if (!yes && !(await confirm(plan))) return { written: 0, deleted: 0 };

  const client = api();
  for (const path of plan.writes) {
    const f = local.get(path)!;
    await client.writeFile(slug, path, f.content, f.encoding);
  }
  for (const path of plan.deletes) {
    await client.deleteFile(slug, path);
  }
  return { written: plan.writes.length, deleted: plan.deletes.length };
}
