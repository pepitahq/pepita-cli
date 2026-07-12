import { pull, type PullTarget } from '../tree.js';
import { UsageError } from '../api.js';

const USAGE = 'usage: pepita pull <slug> [--state live] [--preview <name>] [--dir <path>]';

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug || slug.startsWith('--')) throw new UsageError(USAGE);

  const stateIdx = args.indexOf('--state');
  const stateVal = stateIdx !== -1 ? args[stateIdx + 1] : undefined;
  const previewIdx = args.indexOf('--preview');
  const previewName = previewIdx !== -1 ? args[previewIdx + 1] : undefined;

  if (stateIdx !== -1 && stateVal !== 'live')
    throw new UsageError(
      `unknown --state '${stateVal ?? ''}' — only 'live' is a state; omit --state for the working copy`
    );
  if (previewIdx !== -1 && (!previewName || previewName.startsWith('--')))
    throw new UsageError('usage: pepita pull <slug> --preview <name>');
  if (stateVal === 'live' && previewName)
    throw new UsageError('pass either --state live or --preview <name>, not both');

  const target: PullTarget = previewName
    ? { kind: 'preview', name: previewName }
    : stateVal === 'live'
      ? { kind: 'live' }
      : { kind: 'working' };

  const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : `./${slug}`;
  const n = await pull(slug, target, dir);
  const label = target.kind === 'preview' ? `preview ${target.name}` : target.kind;
  console.log(`Pulled ${n} file(s) from ${slug} (${label}) into ${dir}`);
}
