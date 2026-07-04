import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { api, UsageError } from '../api.js';
import { pull } from '../tree.js';

export function confirmMatchesSlug(input: string, slug: string): boolean {
  return input.trim() === slug;
}

export async function run(args: string[]): Promise<void> {
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) throw new UsageError('usage: pepita delete <slug> [--download-snapshot] [--yes]');
  const yes = args.includes('--yes');
  const snapshot = args.includes('--download-snapshot');

  if (snapshot) {
    const dir = join(tmpdir(), `pepita-${slug}-${Date.now()}`);
    const n = await pull(slug, 'unsaved', dir);
    console.log(`Snapshot: ${n} file(s) → ${dir}`);
  }

  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`This permanently deletes ${slug} and stops serving it. Type the slug to confirm: `);
    rl.close();
    if (!confirmMatchesSlug(ans, slug)) { console.log('Cancelled.'); return; }
  }

  await api().deleteSite(slug);
  console.log(`Deleted ${slug} — it no longer serves.`);
}
