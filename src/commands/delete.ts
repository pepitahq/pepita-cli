import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { api, UsageError } from '../api.js';
import { pull } from '../tree.js';

export function confirmMatchesSlug(input: string, slug: string): boolean {
  return input.trim() === slug;
}

/** Where a pre-delete backup goes: ~/Downloads if it exists (visible in every
 *  file manager), else the current directory — never a hidden/temp dir, since
 *  the snapshot is a recovery copy the user must be able to find later.
 *  `base` (from --dir) overrides the parent. */
function backupDir(slug: string, base?: string): string {
  let parent = base;
  if (!parent) {
    const downloads = join(homedir(), 'Downloads');
    parent = existsSync(downloads) ? downloads : process.cwd();
  }
  return join(parent, `pepita-${slug}-backup-${Date.now()}`);
}

export async function run(args: string[]): Promise<void> {
  const dirIdx = args.indexOf('--dir');
  const dirValIdx = dirIdx === -1 ? -1 : dirIdx + 1;
  const slug = args.find((a, i) => !a.startsWith('--') && i !== dirValIdx);
  if (!slug) {
    throw new UsageError('usage: pepita delete <slug> [--download-snapshot] [--dir <path>] [--yes]');
  }
  const yes = args.includes('--yes');
  const snapshot = args.includes('--download-snapshot');
  const dirOverride = dirIdx !== -1 ? args[dirIdx + 1] : undefined;

  // Verify the site exists BEFORE the destructive confirm. `create` appends a
  // uniqueness suffix (my-site -> my-site-1a2b), so a wrong slug is common —
  // fail early and clearly instead of "confirm, then 404".
  const sites = await api().listSites();
  if (!sites.some((s) => s.slug === slug)) {
    const near = sites
      .map((s) => s.slug)
      .filter((s) => s.includes(slug) || slug.includes(s));
    const hint = near.length
      ? ` Did you mean: ${near.join(', ')}?`
      : ' Run `pepita list` to see your sites.';
    throw new UsageError(`No site "${slug}".${hint}`);
  }

  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(
      `This permanently deletes ${slug} and stops serving it. Type the slug to confirm: `
    );
    rl.close();
    if (!confirmMatchesSlug(ans, slug)) {
      console.log('Cancelled.');
      return;
    }
  }

  // Snapshot AFTER the confirm (no orphan copy if cancelled) but BEFORE the
  // destructive delete; if the backup fails, the throw aborts — never delete
  // without the backup the user asked for.
  if (snapshot) {
    const dir = backupDir(slug, dirOverride);
    const n = await pull(slug, 'unsaved', dir);
    console.log(`Backup: ${n} file(s) -> ${dir}`);
  }

  await api().deleteSite(slug);
  console.log(`Deleted ${slug} — it no longer serves.`);
}
