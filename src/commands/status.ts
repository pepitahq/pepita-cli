import { api } from '../api.js';
import {
  siteLiveUrl,
  formatMicroUsd2,
  VIDEO_RATE_DISPLAY_MICRO_USD_PER_MIN
} from '@pepitahq/shared';

/**
 * What's left in the balance, and what it buys where THIS tool can spend it.
 *
 * The CLI is not a read-only window onto the site: `asset add` uploads a video
 * and debits the balance per source-minute, on the spot. A tool that can spend
 * your money without ever showing you the meter is what this line exists to fix
 * — hence the minutes, not only the dollars.
 *
 * DISPLAY-domain arithmetic only: the balance arrives in display dollars and
 * is divided by the display per-minute price. The CLI is a user surface — it
 * must never hold a real amount or a real↔display conversion (a guard test
 * enforces the import list).
 */
async function balanceLine(): Promise<string> {
  try {
    const { balanceMicroUsd, provider } = await api().getBalance();
    const usd = formatMicroUsd2(balanceMicroUsd);
    if (provider === 'byok') {
      // The balance is dormant for AI, not gone — it still funds video.
      return `Balance: ${usd}  (BYOK — AI runs on your own key; this covers video)`;
    }
    const minutes = balanceMicroUsd / VIDEO_RATE_DISPLAY_MICRO_USD_PER_MIN;
    return `Balance: ${usd}  (~${minutes.toFixed(0)} min of video, or AI)`;
  } catch {
    // Billing being unreachable must not take `status` down with it — the
    // pending-changes answer is still worth printing. Don't imply zero either:
    // say it's unknown.
    return 'Balance: unavailable';
  }
}

export async function run(args: string[]): Promise<void> {
  const slug = args[0];

  // No slug → a cheap "status all": one line per site with its URLs. We avoid
  // fetching each site's /tree here (that returns full file content, so it'd be
  // expensive across every site); per-site unsaved-change detail stays behind
  // `pepita status <slug>`.
  if (!slug) {
    const [sites, balance] = await Promise.all([api().listSites(), balanceLine()]);
    console.log(balance);
    console.log('');
    if (sites.length === 0) {
      console.log('No sites yet.');
      return;
    }
    console.log(`${sites.length} site${sites.length === 1 ? '' : 's'}:`);
    for (const s of sites) {
      console.log(`  ${s.slug}`);
      console.log(`    live: ${siteLiveUrl(s.slug)}`);
    }
    console.log('\nRun `pepita status <slug>` to see pending changes for one site.');
    return;
  }

  // No balance here, deliberately. One balance spends across every site, so
  // printing it under a `Site:` heading would present a global figure as if it
  // belonged to this site. It lives on the bare `pepita status` instead, which
  // is the account-wide view.
  const tree = await api().getTree(slug);
  const dirty = tree.files.filter((f) => f.dirty).map((f) => f.path);
  console.log(`Site: ${slug}`);
  console.log(`Live:   ${siteLiveUrl(slug)}`);
  console.log(`Pending (not yet live): ${dirty.length} changed, ${tree.deletions.length} deleted`);
  for (const p of dirty) console.log(`  ~ ${p}`);
  for (const p of tree.deletions) console.log(`  - ${p}`);
}
