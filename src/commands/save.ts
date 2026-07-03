import { api, UsageError } from '../api.js';

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) throw new UsageError('usage: pepita save <slug>');

  // save commits the server-side content for the dirty paths (the server
  // re-reads content itself; what we send is a fallback) and needs the current
  // head sha for conflict detection — so read the current state first.
  const client = api();
  const tree = await client.getTree(slug, 'develop');
  const dirty = tree.files.filter((f) => f.dirty);

  await client.flush(slug, {
    expectedHeadSha: tree.headSha,
    files: dirty.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
    deletions: tree.deletions
  });
  console.log(`Saved ${slug} to draft. Run \`pepita publish ${slug}\` to go live.`);
}
