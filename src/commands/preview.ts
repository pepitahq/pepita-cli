import { api, UsageError } from '../api.js';

/**
 * pepita preview <slug>            — freeze the current site as a shareable,
 *                                    immutable preview link (the successor of
 *                                    the old save+staging-URL step).
 * pepita preview <slug> --delete <name> — stop serving a preview (the version
 *                                    stays restorable from History).
 */
export async function run(args: string[]): Promise<void> {
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) throw new UsageError('usage: pepita preview <slug> [--delete <name>]');

  const del = args.indexOf('--delete');
  if (del !== -1) {
    const name = args[del + 1];
    if (!name) throw new UsageError('usage: pepita preview <slug> --delete <name>');
    await api().deletePreview(slug, name);
    console.log(`Preview ${name} deleted — the link no longer serves.`);
    return;
  }

  const p = await api().createPreview(slug);
  console.log(`Preview ready:\n  ${p.url}\nAnyone with the link can view it; it never changes.`);
}
