import { api } from '../api.js';
export async function run(): Promise<void> {
  const sites = await api().listSites();
  if (sites.length === 0) return console.log('No sites yet.');
  for (const s of sites) console.log(s.slug);
}
