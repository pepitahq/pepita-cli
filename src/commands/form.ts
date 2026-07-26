/**
 * pepita form <sub> — what visitors submitted through the site's forms.
 *
 * The source is named the way `pull` names it — `--live`, `--preview <name>`,
 * or neither for the editor's own test submissions — and deliberately never
 * with the word "branch", which is storage vocabulary.
 *
 *   pepita form list --site <slug>
 *   pepita form get <form-name> --site <slug> [--live] [--preview <name>] [--csv <path>]
 */
import { writeFile } from 'node:fs/promises';
import {
  FORM_COLLECTIONS_CAP,
  FORM_RECORDS_PAGE,
  resolveFormBranch,
  sourceTotal,
  submittedAtIso,
  toCsv,
  type FormRecord
} from '@pepitahq/shared';
// `PepitaApi` comes from ../api.js like the neighbouring commands do, not from
// the shared package directly — same type, one import style on this surface.
import { api, UsageError, type PepitaApi } from '../api.js';
import { flagValue, positional } from './asset.js';

const USAGE = `usage:
  pepita form list --site <slug>
  pepita form get <form-name> --site <slug> [--live] [--preview <name>] [--csv <path>]`;

// `positional` takes an ARRAY, not a Set — match `template.ts`, which ships.
const VALUE_FLAGS = ['--site', '--preview', '--csv'];

export interface FormArgs {
  site: string;
  name?: string;
  live: boolean;
  preview?: string;
  csv?: string;
}

export function parseFormArgs(args: string[], opts: { needName?: boolean } = {}): FormArgs {
  const site = flagValue(args, '--site');
  if (!site) throw new UsageError(`${USAGE}\n(--site <slug> is required)`);
  const live = args.includes('--live');
  const preview = flagValue(args, '--preview');
  // `flagValue` answers undefined both for "not passed" and for "passed with no
  // value" (`--preview --csv out.csv`). Undefined means the EDITOR source, so
  // the second case would quietly hand back test rows instead of the preview
  // link's submissions — and with --live also present, live would win the check
  // below that exists precisely to stop a silent winner.
  if (args.includes('--preview') && !preview)
    throw new UsageError('--preview needs a preview name, e.g. --preview k4t9');
  // Surfaced here as well as in the resolver: the CLI can say it in usage terms.
  if (live && preview) throw new UsageError('pass --live or --preview, not both');
  const name = positional(args, VALUE_FLAGS);
  if (opts.needName && !name) throw new UsageError(USAGE);
  return { site, name, live, preview, csv: flagValue(args, '--csv') };
}

export async function runList(client: PepitaApi, site: string): Promise<string> {
  const cols = await client.listFormCollections(site);
  if (!cols.length) return 'No form submissions yet.';
  const lines = cols.map((c) => `${c.name}  ${c.count}`);
  // The count sums every source; `form get` reads one, and defaults to the
  // editor's. Without this line a founder reads "contact 40", asks for them,
  // and is told there are none.
  lines.push(
    '',
    'Counts cover every source together (live site, editor, preview links).',
    "`form get` reads one source, and without --live/--preview it reads the editor's test submissions."
  );
  if (cols.length === FORM_COLLECTIONS_CAP)
    lines.push(`Listing is capped at ${FORM_COLLECTIONS_CAP} forms — there may be more.`);
  return lines.join('\n');
}

/** Walk the cursor. `max` caps the read; omit it to take everything.
 *  `total` is THIS SOURCE's count, off the first page's `branches`. */
async function readRecords(client: PepitaApi, site: string, name: string, branch: string, max?: number) {
  const records: FormRecord[] = [];
  let fields: string[] = [];
  let total = 0;
  // Loop position is tracked explicitly, never inferred from a nullable payload
  // field: `fields` is null on any page but the first BY CONTRACT, so a first
  // page that returned null would leave the sentinel unset, re-run this block on
  // page two — where `branches` is null — and reset `total` to 0. A 0 total is
  // exactly the value that switches the refuse-to-truncate gate off.
  let first = true;
  let cursor: string | undefined;
  for (;;) {
    const page = await client.getFormRecords(site, name, { branch, cursor });
    if (first) {
      fields = page.fields ?? [];
      total = sourceTotal(page.branches ?? [], branch);
      first = false;
    }
    records.push(...page.records);
    if (!page.nextCursor) break;
    if (max !== undefined && records.length >= max) break;
    // "No cap on records" is not "no cap on iterations": a cursor that comes
    // back unchanged (a replayed response, a server bug) would spin forever,
    // holding every record in memory and writing nothing. Say what happened.
    if (page.nextCursor === cursor)
      throw new UsageError(
        `The server stopped advancing after ${records.length} records — nothing was written. Try again.`
      );
    cursor = page.nextCursor;
  }
  return {
    fields,
    total,
    records: max === undefined ? records : records.slice(0, max)
  };
}

type Writer = (path: string, contents: string) => Promise<void>;

export async function runGet(
  client: PepitaApi,
  a: { site: string; name: string; live: boolean; preview?: string; csv?: string },
  write: Writer = (p, c) => writeFile(p, c, 'utf8')
): Promise<string> {
  const branch = resolveFormBranch({ live: a.live, preview: a.preview });

  if (a.csv) {
    // No cap: half a CSV is not an export.
    const { fields, records } = await readRecords(client, a.site, a.name, branch);
    await write(a.csv, toCsv(fields, records));
    return `${records.length} record${records.length === 1 ? '' : 's'} → ${a.csv}`;
  }

  // Read up to the limit FIRST — the first page carries this source's own count,
  // and gating on the collection list's cross-branch count would refuse a
  // three-row editor read because the live site holds three hundred.
  const { fields, total, records } = await readRecords(
    client,
    a.site,
    a.name,
    branch,
    FORM_RECORDS_PAGE
  );

  // Refuse rather than truncate. A founder who cannot see that they got half
  // the data is worse off than one who is told to pass a flag.
  if (total > FORM_RECORDS_PAGE)
    throw new UsageError(
      `${total} records — more than ${FORM_RECORDS_PAGE}. Pass --csv <path> to export them all.`
    );

  if (!records.length) return `No records for "${a.name}".`;
  return records
    .map((r) => {
      const when = submittedAtIso(r.createdAt);
      const pairs = fields
        .filter((f) => r.data[f] !== undefined && r.data[f] !== null && r.data[f] !== '')
        .map((f) => `${f}=${typeof r.data[f] === 'string' ? r.data[f] : JSON.stringify(r.data[f])}`);
      return `${when}  ${pairs.join('  ')}`;
    })
    .join('\n');
}

export async function run(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const client = api();
  if (sub === 'list') {
    console.log(await runList(client, parseFormArgs(rest).site));
    return;
  }
  if (sub === 'get') {
    const a = parseFormArgs(rest, { needName: true });
    console.log(await runGet(client, { site: a.site, name: a.name!, live: a.live, preview: a.preview, csv: a.csv }));
    return;
  }
  throw new UsageError(USAGE);
}
