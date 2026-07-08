import { api, UsageError } from '../api.js';

/**
 * pepita preview <slug>                 — create a new shareable preview link
 *                                         from the current site.
 * pepita preview <slug> --update <name> — push the current site onto an
 *                                         existing preview: same link, new
 *                                         content. Run `pepita apply` first to
 *                                         upload local changes.
 * pepita preview <slug> --delete <name> — stop serving a preview (the version
 *                                         stays restorable from History).
 */
export async function run(args: string[]): Promise<void> {
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) throw new UsageError('usage: pepita preview <slug> [--update <name>] [--delete <name>]');

  const del = args.indexOf('--delete');
  if (del !== -1) {
    const name = args[del + 1];
    if (!name) throw new UsageError('usage: pepita preview <slug> --delete <name>');
    await api().deletePreview(slug, name);
    console.log(`Preview ${name} deleted — the link no longer serves.`);
    return;
  }

  const upd = args.indexOf('--update');
  if (upd !== -1) {
    const name = args[upd + 1];
    if (!name || name.startsWith('--')) {
      throw new UsageError('usage: pepita preview <slug> --update <name>');
    }
    const p = await api().updatePreview(slug, name);
    console.log(`Preview ${p.name} updated:\n  ${p.url}\nAnyone with the link now sees the current site.`);
    return;
  }

  const p = await api().createPreview(slug);
  console.log(
    `Preview ready:\n  ${p.url}\n` +
      `Share the link. Update it anytime with \`pepita preview ${slug} --update ${p.name}\`.`
  );
}
