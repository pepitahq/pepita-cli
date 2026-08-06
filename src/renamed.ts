/**
 * Retired top-level words, and where each one went.
 *
 * ITS OWN MODULE rather than living in index.ts, and that is not organisational
 * taste: index.ts calls `main()` at module scope, so importing it from a test
 * would RUN the CLI against vitest's own argv. This table has to be readable
 * without that.
 *
 * FORWARDING rather than refusing, and that departs from a local convention on
 * purpose. This CLI refuses other retired spellings — `--state live`,
 * `--no-analytics`, `--to-field` all throw and name the replacement — because
 * honouring those would produce a WRONG result: the option's meaning changed or
 * the thing it named is gone. Nothing lies here. `list` means precisely what
 * `site list` means, so a refusal would only punish existing scripts for a change
 * of taste. The rule is: refuse when the old spelling would be wrong, deprecate
 * when it would be right.
 *
 * `status` is absent deliberately. With no slug it prints the account balance
 * plus every site's URL, which is not a property of a site — so the word keeps
 * its top-level home and its exact behaviour, and `pepita site status <slug>` is
 * an additional home for the per-site half rather than its replacement.
 */
export interface Renamed {
  /** What to print as the new spelling — may be more than one word. */
  phrase: string;
  /** The top-level command that now owns it. */
  cmd: string;
  /** Arguments to insert before the user's own, where the depth changed. */
  prepend: string[];
}

export const RENAMED: Record<string, Renamed> = {
  list: { phrase: 'site list', cmd: 'site', prepend: ['list'] },
  create: { phrase: 'site create', cmd: 'site', prepend: ['create'] },
  pull: { phrase: 'site pull', cmd: 'site', prepend: ['pull'] },
  apply: { phrase: 'site apply', cmd: 'site', prepend: ['apply'] },
  preview: { phrase: 'site preview', cmd: 'site', prepend: ['preview'] },
  previews: { phrase: 'site previews', cmd: 'site', prepend: ['previews'] },
  publish: { phrase: 'site publish', cmd: 'site', prepend: ['publish'] },
  delete: { phrase: 'site delete', cmd: 'site', prepend: ['delete'] }
};

/** One line, on stderr, naming the new spelling. Stderr so a piped stdout stays
 *  byte-identical to what the old command produced. */
export function renameNotice(old: string, phrase: string): string {
  return `pepita: \`${old}\` is now \`${phrase}\` — use \`pepita ${phrase}\`.`;
}
