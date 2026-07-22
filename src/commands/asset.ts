/**
 * pepita asset <sub> — the VIDEO asset surface.
 *
 * Video does NOT live in the site's file tree (the worktree budget is 20 MB
 * total / 5 MB per file, and the tree refuses videos by magic bytes). It lives
 * in pepita's asset pipeline: upload → transcode → an HLS ladder + poster on the
 * CDN. This command group is the local half of that — the one place a multi-GB
 * file can be handed over, since the bytes go straight to storage with presigned
 * URLs and never through an API worker (or a tool-call payload).
 *
 *   pepita asset add <file> --site <slug>
 *   pepita asset list --site <slug>
 *   pepita asset info <id> --site <slug>
 *   pepita asset rename <id> <new name> --site <slug>
 *   pepita asset rm <id> --site <slug> [--yes]
 *   pepita asset pull <id> --site <slug> [--out <path>]
 *
 * V1 is operator-gated server-side: every route 403s for everyone else (and the
 * list route answers `{enabled:false}`). We surface that as one plain sentence.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, mkdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline/promises';
import { sniffVideoMime, VIDEO_SNIFF_BYTES, type VideoAsset } from '@pepitahq/shared';
import { api, PepitaHttpError, UsageError } from '../api.js';

const USAGE = `usage:
  pepita asset add <file> --site <slug>
  pepita asset list --site <slug>
  pepita asset info <id> --site <slug>
  pepita asset rename <id> <new name> --site <slug>
  pepita asset rm <id> --site <slug> [--yes]
  pepita asset pull <id> --site <slug> [--out <path>]`;

/** The public asset shape the routes return is the canonical `VideoAsset` from
 *  @pepitahq/shared (pepita-api.ts) — re-exported here for the existing import
 *  surface. Note there is deliberately no `original_key` on the wire: that key
 *  points into the private bucket. */
export type { VideoAsset };

type CreateResponse =
  | { dedup: true; asset: VideoAsset }
  | { assetId: string; uploadId: string; partSize: number; partUrls: string[] };

/** The message the server gives a non-operator (403), and what the list route's
 *  `{enabled:false}` means. A gate, not a crash — say so in one line. */
const GATED = 'Video assets are not available yet.';

const enc = encodeURIComponent;

/** `--flag value`, or undefined. A missing/flag-shaped value is not a value. */
export function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return !v || v.startsWith('--') ? undefined : v;
}

/** The first positional (non-flag, not a flag's value). */
export function positional(args: string[], flags: string[]): string | undefined {
  const consumed = new Set<number>();
  for (const f of flags) {
    const i = args.indexOf(f);
    if (i !== -1) consumed.add(i + 1);
  }
  return args.find((a, i) => !a.startsWith('--') && !consumed.has(i));
}

/** ALL positionals, in order. Lets `rename` take a multi-word name without
 *  quoting: everything after the id (that isn't a flag or its value) is the
 *  name — `pepita asset rename <id> Hero video final --site x`. */
export function positionals(args: string[], flags: string[]): string[] {
  const consumed = new Set<number>();
  for (const f of flags) {
    const i = args.indexOf(f);
    if (i !== -1) consumed.add(i + 1);
  }
  return args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
}

export function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/**
 * `created_at` / `ready_at` come from D1's `unixepoch()` — they are unix
 * SECONDS. `new Date()` takes MILLISECONDS, so they must be scaled or every
 * asset reports 1970. (`duration_ms` really is milliseconds — see
 * `formatDuration` — the two must not be confused.)
 */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return '—';
  return new Date(seconds * 1000).toISOString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Left-pad a table of rows to even columns — the CLI has no table dependency. */
export function renderTable(rows: string[][]): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length)));
  return rows
    .map((r) => r.map((cell, c) => (cell ?? '').padEnd(widths[c])).join('  ').trimEnd())
    .join('\n');
}

/** Read the file's first bytes and sniff them. Content, never the extension —
 *  a `.mov` renamed `.txt` is still a video, and a `.mp4` that isn't one isn't. */
async function sniffFile(path: string): Promise<string | null> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(VIDEO_SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, VIDEO_SNIFF_BYTES, 0);
    return sniffVideoMime(new Uint8Array(buf.subarray(0, bytesRead)));
  } finally {
    await fh.close();
  }
}

/** SHA-256 by STREAMING the file — a multi-GB video must never be read into
 *  memory. The hash costs seconds; the upload it can save costs minutes plus a
 *  paid transcode, so it is always worth paying first. */
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function listAssets(slug: string): Promise<VideoAsset[]> {
  const res = await api().json<{ enabled: boolean; assets: VideoAsset[] }>(
    `/api/sites/${enc(slug)}/assets`
  );
  if (!res.enabled) throw new UsageError(GATED);
  return res.assets;
}

async function findAsset(slug: string, id: string): Promise<VideoAsset> {
  // There is no per-asset GET route (the row is small and the list is the panel's
  // data source) — so `info` reads the list and picks its row.
  const found = (await listAssets(slug)).find((a) => a.id === id);
  if (!found) throw new UsageError(`No asset "${id}" on ${slug}. Run \`pepita asset list --site ${slug}\`.`);
  return found;
}

async function cmdAdd(args: string[]): Promise<void> {
  const file = positional(args, ['--site']);
  const slug = flagValue(args, '--site');
  if (!file || !slug) throw new UsageError('usage: pepita asset add <file> --site <slug>');

  const path = resolve(file);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new UsageError(`Not a file: ${file}`);

  // This command is for VIDEO only — and the file tree refuses video. They are
  // mirror images of one gate: every file has exactly one home.
  const mime = await sniffFile(path);
  if (!mime) {
    throw new UsageError(
      `${basename(path)} is not a video (its bytes say so, whatever the extension). ` +
        'Images, docs and everything else belong in the site files — use `pepita apply`.'
    );
  }

  console.log(`Hashing ${basename(path)} (${formatBytes(info.size)})…`);
  const sha256 = await sha256File(path);

  const created = await api().json<CreateResponse>(`/api/sites/${enc(slug)}/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: basename(path), size: info.size, sha256 })
  });

  if ('dedup' in created) {
    const a = created.asset;
    console.log(`already uploaded — ready\n  id: ${a.id}\n  master: ${a.masterUrl ?? '—'}`);
    return;
  }

  const { assetId, uploadId, partSize, partUrls } = created;
  const parts: Array<{ partNumber: number; etag: string }> = [];
  const fh = await open(path, 'r');
  try {
    for (let i = 0; i < partUrls.length; i++) {
      const offset = i * partSize;
      const len = Math.min(partSize, info.size - offset);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const res = await fetch(partUrls[i], { method: 'PUT', body: buf });
      if (!res.ok) throw new Error(`part ${i + 1} → ${res.status} ${await res.text()}`);
      // The ETag is the only proof R2 has the part; complete fails without it.
      // Passed through verbatim (quotes included) — the server quotes it into XML.
      const etag = res.headers.get('etag');
      if (!etag) throw new Error(`part ${i + 1} returned no ETag`);
      parts.push({ partNumber: i + 1, etag });
      process.stdout.write(`\rUploading… ${i + 1}/${partUrls.length} parts`);
    }
    process.stdout.write('\n');
  } finally {
    await fh.close();
  }

  await api().json<{ ok: boolean; status: string }>(
    `/api/sites/${enc(slug)}/assets/${enc(assetId)}/complete`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId, parts })
    }
  );

  console.log(
    `Uploaded — processing.\n  id: ${assetId}\n` +
      `Run \`pepita asset info ${assetId} --site ${slug}\` in a minute for the playable URL.`
  );
}

async function cmdList(args: string[]): Promise<void> {
  const slug = flagValue(args, '--site');
  if (!slug) throw new UsageError('usage: pepita asset list --site <slug>');
  const rows = await listAssets(slug);
  if (rows.length === 0) return console.log('No video assets yet.');
  console.log(
    renderTable([
      ['ID', 'FILENAME', 'STATUS', 'DURATION', 'SIZE'],
      ...rows.map((a) => [
        a.id,
        a.originalFilename ?? '—',
        a.status,
        formatDuration(a.durationMs),
        formatBytes(a.sizeBytes)
      ])
    ])
  );
}

async function cmdInfo(args: string[]): Promise<void> {
  const id = positional(args, ['--site']);
  const slug = flagValue(args, '--site');
  if (!id || !slug) throw new UsageError('usage: pepita asset info <id> --site <slug>');
  const a = await findAsset(slug, id);
  const dims = a.width && a.height ? `${a.width}×${a.height}` : '—';
  console.log(
    [
      `id:        ${a.id}`,
      `filename:  ${a.originalFilename ?? '—'}`,
      `status:    ${a.status}${a.errorMessage ? ` (${a.errorMessage})` : ''}`,
      `size:      ${formatBytes(a.sizeBytes)}`,
      `duration:  ${formatDuration(a.durationMs)}`,
      `dimensions: ${dims}`,
      `sha256:    ${a.sourceSha ?? '—'}`,
      `created:   ${formatTimestamp(a.createdAt)}`,
      `ready:     ${formatTimestamp(a.readyAt)}`,
      // The two URLs the founder actually puts in the markup.
      `master:    ${a.masterUrl ?? '—'}`,
      `poster:    ${a.posterUrl ?? '—'}`
    ].join('\n')
  );
}

async function cmdRename(args: string[]): Promise<void> {
  const slug = flagValue(args, '--site');
  const [id, ...nameParts] = positionals(args, ['--site']);
  const name = nameParts.join(' ').trim();
  if (!id || !slug || !name)
    throw new UsageError('usage: pepita asset rename <id> <new name> --site <slug>');

  // Fail early on a wrong id (and pick up the old name for the confirmation).
  const a = await findAsset(slug, id);
  // The name is a display label only — identity is the id, so the stored URLs
  // (and any markup referencing them) are untouched by a rename.
  await api().json<{ ok: boolean }>(`/api/sites/${enc(slug)}/assets/${enc(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: name })
  });
  console.log(
    `Renamed "${a.originalFilename ?? id}" -> "${name}". (Label only — URLs and pages referencing it keep working.)`
  );
}

async function cmdRm(args: string[]): Promise<void> {
  const id = positional(args, ['--site']);
  const slug = flagValue(args, '--site');
  if (!id || !slug) throw new UsageError('usage: pepita asset rm <id> --site <slug> [--yes]');

  // Confirm against the real row (and fail early on a wrong id) — the same shape
  // as `pepita delete`: verify it exists, THEN ask.
  const a = await findAsset(slug, id);
  if (!args.includes('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(
      `This permanently deletes "${a.originalFilename ?? a.id}" (video + poster). ` +
        'Assets are not versioned — restoring an old site version will NOT bring it back. Type y to confirm: '
    );
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') return console.log('Cancelled.');
  }

  await api().json<{ ok: boolean }>(`/api/sites/${enc(slug)}/assets/${enc(id)}`, { method: 'DELETE' });
  console.log(`Deleted ${id} — it no longer plays anywhere it was referenced.`);
}

async function cmdPull(args: string[]): Promise<void> {
  const id = positional(args, ['--site', '--out']);
  const slug = flagValue(args, '--site');
  if (!id || !slug) throw new UsageError('usage: pepita asset pull <id> --site <slug> [--out <path>]');

  const a = await findAsset(slug, id);
  const out = resolve(flagValue(args, '--out') ?? a.originalFilename ?? `${id}.mp4`);

  // THIS COMMAND IS THE ENTIRE REASON THE ORIGINAL IS KEPT IN OUR BUCKET AT ALL:
  // the CDN only ever holds the transcoded ladder + poster, so without a way to
  // get the master file back the founder's source would be gone forever. The
  // route 302s to a presigned GET on the private bucket — the bytes stream
  // R2 → here, never through a worker.
  // The redirect is followed BY HAND (not `redirect: 'follow'`) so our Bearer
  // header can never ride along to R2 — an Authorization header on a presigned
  // GET overrides the query signature and the download would 400.
  const hop = await api().raw(`/api/sites/${enc(slug)}/assets/${enc(id)}/original`, {
    redirect: 'manual'
  });
  const signed = hop.headers.get('location');
  if (hop.status !== 302 || !signed) {
    throw new PepitaHttpError(hop.status, `pull ${id} → ${hop.status} ${await hop.text()}`);
  }
  const res = await fetch(signed);
  if (!res.ok || !res.body) {
    throw new PepitaHttpError(res.status, `pull ${id} → ${res.status} ${await res.text()}`);
  }

  await mkdir(dirname(out), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(out));
  console.log(`Downloaded ${id} -> ${out}`);
}

export async function run(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const subs: Record<string, (a: string[]) => Promise<void>> = {
    add: cmdAdd,
    list: cmdList,
    info: cmdInfo,
    rename: cmdRename,
    rm: cmdRm,
    pull: cmdPull
  };
  const fn = sub ? subs[sub] : undefined;
  if (!fn) throw new UsageError(USAGE);

  try {
    await fn(rest);
  } catch (err) {
    // The V1 operator gate — a 403 here is policy, not a bug. One sentence, no stack.
    if (err instanceof PepitaHttpError && err.status === 403) throw new UsageError(GATED);
    throw err;
  }
}
