import { api, UsageError } from '../api.js';
export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) throw new UsageError('usage: pepita publish <slug>');
  const r = await api().publish(slug);
  console.log(`Published ${slug} to live → ${r.productionUrl}`);
}
