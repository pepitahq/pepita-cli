import { pull, type PullState } from '../tree.js';
import { UsageError } from '../api.js';

const STATES: readonly PullState[] = ['live', 'draft', 'unsaved'];

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug)
    throw new UsageError('usage: pepita pull <slug> [--state live|draft|unsaved] [--dir <path>]');

  const stateArg = args.includes('--state') ? args[args.indexOf('--state') + 1] : 'live';
  if (!STATES.includes(stateArg as PullState))
    throw new UsageError(`unknown --state '${stateArg}' (expected: live | draft | unsaved)`);
  const state = stateArg as PullState;

  const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : `./${slug}`;
  const n = await pull(slug, state, dir);
  console.log(`Pulled ${n} file(s) from ${slug} (${state}) into ${dir}`);
}
