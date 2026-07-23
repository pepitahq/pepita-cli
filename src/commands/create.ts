import { api, UsageError } from '../api.js';
import { applyLocal } from '../tree.js';

const USAGE = 'usage: pepita create <name> [--allow-embedding] [--block-ai-crawlers] [--from <dir>]';

export interface CreateArgs {
  name: string;
  /** Allow other sites to iframe-embed this one (server default: deny). */
  embeddable: boolean;
  /** Visible to AI crawlers (server default: visible). */
  aiVisible: boolean;
  from?: string;
}

export function parseCreateArgs(args: string[]): CreateArgs {
  let name: string | undefined;
  let embeddable = false;
  let aiVisible = true;
  let from: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--allow-embedding') { embeddable = true; continue; }
    if (a === '--block-ai-crawlers') { aiVisible = false; continue; }
    if (a === '--from') {
      const v = args[++i];
      if (!v || v.startsWith('--')) throw new UsageError('--from <dir> needs a path');
      from = v;
      continue;
    }
    if (a === '--no-analytics') {
      // Retired in 0.10.0. Fail loudly so a script doesn't create a site
      // while believing analytics is off.
      throw new UsageError(
        '`--no-analytics` was removed — analytics is always on at creation (turn it off in Settings → Advanced).'
      );
    }
    if (a.startsWith('--')) throw new UsageError(`unknown flag '${a}'`);
    if (name !== undefined) throw new UsageError(USAGE);
    name = a;
  }
  if (!name) throw new UsageError(USAGE);
  return { name, embeddable, aiVisible, from };
}

export async function run(args: string[]): Promise<void> {
  const { name, embeddable, aiVisible, from } = parseCreateArgs(args);

  const { slug, liveUrl, draftUrl } = await api().createSite(name, { embeddable, aiVisible });
  // New-model servers return no draftUrl (previews replace the fixed staging URL).
  console.log(`Created ${slug}\n  live:  ${liveUrl}${draftUrl ? `\n  draft: ${draftUrl}` : ''}`);

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
    console.log(`Uploaded ${applied!.written} file(s). Run \`pepita publish ${slug}\` to go live, or \`pepita preview ${slug}\` for a shareable link.`);
  }
}
