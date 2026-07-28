/**
 * pepita form <sub> — what visitors submitted through the site's forms.
 *
 * The source is named the way `pull` names it — `--live`, `--preview <name>`,
 * or neither for the editor's own test submissions — and deliberately never
 * with the word "branch", which is storage vocabulary.
 *
 *   pepita form list --site <slug>
 *   pepita form get <form-name> --site <slug> [--live] [--preview <name>] [--csv <path>] [--xlsx <path>] [--json <path>]
 */
import { writeFile } from 'node:fs/promises';
import {
  FORM_COLLECTIONS_CAP,
  filterByBranch,
  resolveFormBranch,
  submittedAtIso,
} from '@pepitahq/shared';
// `PepitaApi` comes from ../api.js like the neighbouring commands do, not from
// the shared package directly — same type, one import style on this surface.
import { api, UsageError, type PepitaApi } from '../api.js';
import { flagValue, positional } from './asset.js';

const USAGE = `usage:
  pepita form list --site <slug>
  pepita form get <form-name> --site <slug> [--live] [--preview <name>] [--csv <path>] [--xlsx <path>] [--json <path>]`;

// `positional` takes an ARRAY, not a Set — match `template.ts`, which ships.
const VALUE_FLAGS = ['--site', '--preview', '--csv', '--xlsx', '--json'];

export interface FormArgs {
  site: string;
  name?: string;
  live: boolean;
  preview?: string;
  csv?: string;
  xlsx?: string;
  json?: string;
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
  return {
    site,
    name,
    live,
    preview,
    csv: flagValue(args, '--csv'),
    xlsx: flagValue(args, '--xlsx'),
    json: flagValue(args, '--json')
  };
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

/** This source's records, out of the ONE response that carries them all.
 *
 *  There is no cursor and no page: ingest caps a form at 1000 records of 1000
 *  characters, so the server hands over the whole collection and the source is a
 *  local filter. The loop, the replayed-cursor guard and the `max` cap that used
 *  to live here all went with it. */
async function readRecords(client: PepitaApi, site: string, name: string, branch: string) {
  const { fields, records } = await client.getFormRecords(site, name);
  return { fields, records: filterByBranch(records, branch) };
}

type BytesWriter = (path: string, bytes: Uint8Array) => Promise<void>;

export async function runGet(
  client: PepitaApi,
  a: { site: string; name: string; live: boolean; preview?: string; csv?: string; xlsx?: string; json?: string },
  writeBytes: BytesWriter = (p, b) => writeFile(p, b)
): Promise<string> {
  const branch = resolveFormBranch({ live: a.live, preview: a.preview });

  // Naming exactly the two that were passed, not silently picking one — a
  // founder who gets the wrong file format would not notice until they
  // opened it. Three mutually exclusive flags, so this can only ever have
  // two names to report.
  const formatFlags: Array<['--csv' | '--xlsx' | '--json', string | undefined]> = [
    ['--csv', a.csv],
    ['--xlsx', a.xlsx],
    ['--json', a.json]
  ];
  const passed = formatFlags.filter(([, v]) => v !== undefined);
  if (passed.length > 1) {
    const [[flagA, valueA], [flagB, valueB]] = passed;
    throw new UsageError(`pass one of --csv, --xlsx or --json, not both (got ${flagA} ${valueA} and ${flagB} ${valueB})`);
  }

  // All three formats go through the export endpoint. `--csv` used to walk
  // the pages here and call toCsv locally; that is now the server's job, so
  // the CSV a founder downloads in the editor and the one the CLI writes
  // cannot diverge.
  const outPath = a.xlsx ?? a.csv ?? a.json;
  if (outPath) {
    const format = a.xlsx ? 'xlsx' : a.csv ? 'csv' : 'json';
    const { bytes, truncated } = await client.exportFormRecords(a.site, a.name, {
      format,
      branch
    });
    await writeBytes(outPath, bytes);
    // A truncated export is reported as partial, never as a plain success — a
    // founder who cannot see they got half the data is worse off than one told.
    return truncated
      ? `Partial export → ${outPath} (the collection exceeded the server's export size limit, so the tail is missing)`
      : `Exported → ${outPath}`;
  }

  const { fields, records } = await readRecords(client, a.site, a.name, branch);

  // Every matching record, no cap and no refusal. The old FORM_RECORDS_PAGE gate
  // existed because a collection could be arbitrarily large; ingest now bounds
  // it at 1000, and a terminal has room for 1000 lines.
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
    console.log(
      await runGet(client, {
        site: a.site,
        name: a.name!,
        live: a.live,
        preview: a.preview,
        csv: a.csv,
        xlsx: a.xlsx,
        json: a.json
      })
    );
    return;
  }
  throw new UsageError(USAGE);
}
