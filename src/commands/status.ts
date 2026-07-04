import { api } from '../api.js';
import { siteLiveUrl, siteDraftUrl } from '@pepitahq/shared';

export async function run(args: string[]): Promise<void> {
  const slug = args[0];

  // No slug → a cheap "status all": one line per site with its URLs. We avoid
  // fetching each site's /tree here (that returns full file content, so it'd be
  // expensive across every site); per-site unsaved-change detail stays behind
  // `pepita status <slug>`.
  if (!slug) {
    const sites = await api().listSites();
    if (sites.length === 0) {
      console.log('No sites yet.');
      return;
    }
    console.log(`${sites.length} site${sites.length === 1 ? '' : 's'}:`);
    for (const s of sites) {
      console.log(`  ${s.slug}`);
      console.log(`    draft: ${siteDraftUrl(s.slug)}   live: ${siteLiveUrl(s.slug)}`);
    }
    console.log('\nRun `pepita status <slug>` to see unsaved changes for one site.');
    return;
  }

  const tree = await api().getTree(slug, 'develop');
  const dirty = tree.files.filter((f) => f.dirty).map((f) => f.path);
  console.log(`Site: ${slug}`);
  console.log(`Draft:  ${siteDraftUrl(slug)}`);
  console.log(`Live:   ${siteLiveUrl(slug)}`);
  console.log(`Unsaved: ${dirty.length} changed, ${tree.deletions.length} deleted`);
  for (const p of dirty) console.log(`  ~ ${p}`);
  for (const p of tree.deletions) console.log(`  - ${p}`);
}
