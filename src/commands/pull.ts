import { pull, type PullTarget } from '../tree.js';
import { UsageError } from '../api.js';

const USAGE = 'usage: pepita pull <slug> [--live] [--preview <name>] [--dir <path>]';

/**
 * The flags this command takes. Anything else is a typo — and a typo MUST NOT be
 * ignored here: an unrecognised flag falls through to the working copy, and
 * `pull` WRITES to disk, so `pepita pull foo --liev` would quietly overwrite the
 * directory with a different state of the site than the one that was asked for.
 */
const KNOWN_FLAGS = new Set(['--live', '--preview', '--dir']);

/**
 * Resolve `pull`'s arguments. Split out of `run` so the flag rules are testable
 * without a network or a filesystem — this command overwrites a directory, so
 * "which state did it decide on?" is worth pinning down.
 */
export function parsePullArgs(args: string[]): { slug: string; target: PullTarget; dir: string } {
  const slug = args[0];
  if (!slug || slug.startsWith('--')) throw new UsageError(USAGE);

  // `--state live` was the 0.8.x spelling. Rejected outright rather than kept as
  // a quiet alias — for the reason in KNOWN_FLAGS: a script still passing it
  // would pull the working copy over its own files while believing it got live.
  if (args.includes('--state'))
    throw new UsageError(`\`--state live\` is now just \`--live\`\n${USAGE}`);

  for (const a of args.slice(1)) {
    if (a.startsWith('--') && !KNOWN_FLAGS.has(a))
      throw new UsageError(`unknown flag '${a}'\n${USAGE}`);
  }

  const live = args.includes('--live');
  const previewIdx = args.indexOf('--preview');
  const previewName = previewIdx !== -1 ? args[previewIdx + 1] : undefined;

  if (previewIdx !== -1 && (!previewName || previewName.startsWith('--')))
    throw new UsageError('usage: pepita pull <slug> --preview <name>');
  if (live && previewName) throw new UsageError('pass either --live or --preview <name>, not both');

  // Three targets on one axis: the published site, one preview link, or — with
  // no flag at all — the working copy. Only the last is not a committed ref,
  // which is exactly why it is the default: it is the site as it stands now.
  const target: PullTarget = previewName
    ? { kind: 'preview', name: previewName }
    : live
      ? { kind: 'live' }
      : { kind: 'working' };

  const dirIdx = args.indexOf('--dir');
  const dirVal = dirIdx !== -1 ? args[dirIdx + 1] : undefined;
  if (dirIdx !== -1 && (!dirVal || dirVal.startsWith('--')))
    throw new UsageError('usage: pepita pull <slug> --dir <path>');

  return { slug, target, dir: dirVal ?? `./${slug}` };
}

export async function run(args: string[]): Promise<void> {
  const { slug, target, dir } = parsePullArgs(args);
  const n = await pull(slug, target, dir);
  const label = target.kind === 'preview' ? `preview ${target.name}` : target.kind;
  console.log(`Pulled ${n} file(s) from ${slug} (${label}) into ${dir}`);
}
