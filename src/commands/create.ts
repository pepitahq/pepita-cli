import { api, UsageError } from '../api.js';
import { applyLocal } from '../tree.js';

export async function run(args: string[]): Promise<void> {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) throw new UsageError('usage: pepita create <name> [--no-analytics] [--from <dir>]');
  const allowAnalytics = !args.includes('--no-analytics');
  const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined;

  const { slug, liveUrl, draftUrl } = await api().createSite(name, { allowAnalytics });
  console.log(`Created ${slug}\n  live:  ${liveUrl}\n  draft: ${draftUrl}`);

  if (from) {
    console.log(`Uploading files from ${from} to ${slug}…`);
    // The site's develop tree bootstraps on first /tree; retry briefly if the
    // freshly-provisioned repo isn't populated yet.
    let applied: { written: number; deleted: number } | undefined;
    for (let i = 0; i < 5; i++) {
      try { applied = await applyLocal(slug, from, true, async () => true); break; }
      catch (err) {
        if (i < 4 && /404|empty|not found/i.test((err as Error).message)) { await new Promise((r) => setTimeout(r, 750)); continue; }
        throw err;
      }
    }
    console.log(`Uploaded ${applied!.written} file(s) (unsaved). Run \`pepita save ${slug}\` then \`pepita publish ${slug}\`.`);
  }
}
