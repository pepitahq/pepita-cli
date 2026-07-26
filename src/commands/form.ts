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
import { FORM_RECORDS_PAGE, resolveFormBranch, sourceTotal, toCsv, type FormRecord } from '@pepitahq/shared';
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
  // Surfaced here as well as in the resolver: the CLI can say it in usage terms.
  if (live && preview) throw new UsageError('pass --live or --preview, not both');
  const name = positional(args, VALUE_FLAGS);
  if (opts.needName && !name) throw new UsageError(USAGE);
  return { site, name, live, preview, csv: flagValue(args, '--csv') };
}

export async function runList(client: PepitaApi, site: string): Promise<string> {
  const cols = await client.listFormCollections(site);
  if (!cols.length) return 'No form submissions yet.';
  return cols.map((c) => `${c.name}  ${c.count}`).join('\n');
}

/** Walk the cursor. `max` caps the read; omit it to take everything.
 *  `total` is THIS SOURCE's count, off the first page's `branches`. */
async function readRecords(client: PepitaApi, site: string, name: string, branch: string, max?: number) {
  const records: FormRecord[] = [];
  let fields: string[] | null = null;
  let total = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await client.getFormRecords(site, name, { branch, cursor });
    if (fields === null) {
      fields = page.fields;
      total = sourceTotal(page.branches ?? [], branch);
    }
    records.push(...page.records);
    if (!page.nextCursor) break;
    if (max !== undefined && records.length >= max) break;
    cursor = page.nextCursor;
  }
  return {
    fields: fields ?? [],
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
      const when = new Date(r.createdAt).toISOString();
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
