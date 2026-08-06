/**
 * pepita site <sub> — the site-level verbs.
 *
 * A dispatcher and nothing else: every verb's implementation stays in the module
 * it has always lived in, so this file moves the ADDRESS of a command without
 * touching what it does. The old top-level spellings keep working through the
 * RENAMED table in ../renamed.ts and land in exactly the same modules.
 */
import { UsageError } from '../api.js';

const USAGE = `usage:
  pepita site list
  pepita site create <name> [--allow-embedding] [--block-ai-crawlers] [--from <dir>]
  pepita site pull <slug> [--live] [--preview <name>] [--dir <path>]
  pepita site apply <slug> [--dir <path>] [--yes]
  pepita site preview <slug> [--update <name>] [--delete <name>]
  pepita site previews <slug>
  pepita site publish <slug>
  pepita site delete <slug> [--download-snapshot] [--yes]
  pepita site status <slug>`;

const SUBS: Record<string, () => Promise<{ run: (args: string[]) => Promise<void> | void }>> = {
  list: () => import('./list.js'),
  create: () => import('./create.js'),
  pull: () => import('./pull.js'),
  apply: () => import('./apply.js'),
  preview: () => import('./preview.js'),
  previews: () => import('./previews.js'),
  publish: () => import('./publish.js'),
  delete: () => import('./delete.js'),
  status: () => import('./status.js')
};

export async function run(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const load = sub ? SUBS[sub] : undefined;
  if (!load) throw new UsageError(USAGE);
  // `pepita status` (no slug) is the ACCOUNT view and stays top-level; under the
  // site noun a slug is the whole point, so require it rather than silently
  // printing a balance for a command that named no site.
  if (sub === 'status' && !rest.some((a) => !a.startsWith('--'))) {
    throw new UsageError(
      'usage: pepita site status <slug>\n(for your balance and every site, run `pepita status`)'
    );
  }
  const mod = await load();
  await mod.run(rest);
}
