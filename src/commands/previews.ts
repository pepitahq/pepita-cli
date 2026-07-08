import { api, UsageError } from '../api.js';

/** pepita previews <slug> — list the active preview links. */
export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) throw new UsageError('usage: pepita previews <slug>');
  const previews = await api().listPreviews(slug);
  if (previews.length === 0) {
    console.log(`No previews for ${slug}. Create one with \`pepita preview ${slug}\`.`);
    return;
  }
  for (const p of previews) {
    const when = new Date(p.createdAt * 1000).toLocaleString();
    console.log(`${p.name}  ${p.url}  (${when})`);
  }
}
