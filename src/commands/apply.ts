import { createInterface } from 'node:readline/promises';
import { applyLocal } from '../tree.js';
import { UsageError } from '../api.js';
export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) throw new UsageError('usage: pepita apply <slug> [--dir <path>] [--yes]');
  const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : `./${slug}`;
  const yes = args.includes('--yes');
  const confirm = async (plan: { writes: string[]; deletes: string[] }) => {
    console.log(`Plan for ${slug}: +${plan.writes.length} write(s), -${plan.deletes.length} delete(s)`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(`Apply these changes to ${slug}? [y/N] `)).trim().toLowerCase();
    rl.close();
    return ans === 'y' || ans === 'yes';
  };
  const r = await applyLocal(slug, dir, yes, confirm);
  console.log(
    `Applied to ${slug}: ${r.written} written, ${r.deleted} deleted.\n` +
      `Publish with \`pepita publish ${slug}\`, or update a preview with ` +
      `\`pepita preview ${slug} --update <name>\`.`
  );
}
