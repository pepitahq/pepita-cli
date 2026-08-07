/**
 * pepita content <sub> — the ITEMS of dynamic content, plus the `template`
 * hand-off to the shape.
 *
 * The split follows the two neighbours rather than taste: `pepita email
 * template …` is a shape and `pepita form list|get` is data with no `item` word,
 * so where a feature has a shape it gets a `template` sub-noun and the data stays
 * at the group's root. Content is the first feature holding both.
 *
 *   pepita content list --site <slug>
 *   pepita content get <collection> --site <slug> [--oldest] [--limit <n>] [--json <path>]
 *   pepita content add <collection> --file <items.json> --site <slug>
 *   pepita content put <collection> --file <item.json> --site <slug> (--id <id> | --content-slug <slug>)
 *   pepita content publish <collection> --site <slug> (--id <id> | --content-slug <slug>)
  pepita content unpublish <collection> --site <slug> (--id <id> | --content-slug <slug>)
  pepita content rm  <collection> --site <slug> (--id <id> | --content-slug <slug>) [--yes]
 *   pepita content template <sub> --site <slug>
 *
 * TWO ADDRESSES, and they are not equivalent. `--id` is a UUID that never
 * changes and is the only address the API itself accepts. `--content-slug` is
 * derived from the item's title, so it MOVES when the title changes, and it is
 * absent entirely on an item written before addresses existed. The slug is the
 * convenient one; the id is the correct one, and the usage string says so.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { CONTENT_MAX_RECORDS } from '@pepitahq/shared';
// `PepitaApi` comes from ../api.js like the neighbouring commands do, not from
// the shared package directly — same type, one import style on this surface.
import { api, UsageError, type PepitaApi } from '../api.js';
import { flagValue, positional } from './video.js';
import { run as runContentTemplate } from './content-template.js';

const USAGE = `usage:
  pepita content list --site <slug>
  pepita content get <collection> --site <slug> [--oldest] [--limit <n>] [--json <path>]
  pepita content add <collection> --file <items.json> --site <slug>
  pepita content put <collection> --file <item.json> --site <slug> (--id <id> | --content-slug <slug>)
  pepita content publish <collection> --site <slug> (--id <id> | --content-slug <slug>)
  pepita content unpublish <collection> --site <slug> (--id <id> | --content-slug <slug>)
  pepita content rm  <collection> --site <slug> (--id <id> | --content-slug <slug>) [--yes]

  pepita content template <sub> --site <slug>   the collection's SHAPE

add takes an ARRAY of items and lands all of them or none. put replaces ONE item.
Address it with --id, which never changes; --content-slug is friendlier but moves
when the item's title does.`;

const VALUE_FLAGS = ['--site', '--file', '--json', '--limit', '--id', '--content-slug'];

export interface ContentArgs {
  site: string;
  name?: string;
  file?: string;
  json?: string;
  limit?: number;
  id?: string;
  contentSlug?: string;
  oldest: boolean;
  yes: boolean;
}

export function parseContentArgs(
  args: string[],
  opts: { needName?: boolean } = { needName: true }
): ContentArgs {
  const site = flagValue(args, '--site');
  if (!site) throw new UsageError(`${USAGE}\n(--site <slug> is required)`);
  const id = flagValue(args, '--id');
  const contentSlug = flagValue(args, '--content-slug');
  // Two addresses at once is not a preference to resolve — it names two different
  // items. The parseFormArgs precedent for --live + --preview.
  if (id && contentSlug) {
    throw new UsageError('Pass either --id or --content-slug, not both — they can name different items.');
  }
  const name = positional(args, VALUE_FLAGS);
  if (opts.needName && !name) throw new UsageError(USAGE);
  const rawLimit = flagValue(args, '--limit');
  return {
    site,
    name,
    file: flagValue(args, '--file'),
    json: flagValue(args, '--json'),
    limit: rawLimit === undefined ? undefined : Number(rawLimit),
    id,
    contentSlug,
    oldest: args.includes('--oldest'),
    yes: args.includes('--yes')
  };
}

/**
 * One item's id, from whichever address was given.
 *
 * `--content-slug` is resolved HERE, in the client, because there is no by-slug
 * HTTP route — the collection is bounded at CONTENT_MAX_RECORDS, so one read is
 * enough. An item whose slug is NULL (written before the column existed) can
 * never match, which is why the failure names --id rather than just saying "not
 * found".
 */
export async function resolveRecordId(
  client: PepitaApi,
  site: string,
  name: string,
  addr: { id?: string; contentSlug?: string }
): Promise<string> {
  if (addr.id) return addr.id;
  if (!addr.contentSlug) {
    throw new UsageError('This needs an address: pass --id <id> or --content-slug <slug>.');
  }
  const { records } = await client.getContentRecords(site, name, { limit: CONTENT_MAX_RECORDS });
  const hit = records.find((r) => r.slug === addr.contentSlug);
  if (!hit) {
    throw new Error(
      `No item with address "${addr.contentSlug}" in "${name}". An address moves when an item's ` +
        `title changes, and an item created before addresses existed has none at all — run ` +
        `\`pepita content get ${name} --site ${site}\` and use --id.`
    );
  }
  return hit.id;
}

export async function runList(client: PepitaApi, site: string): Promise<string> {
  const cols = await client.listContentCollections(site);
  if (cols.length === 0) {
    return 'No content collections yet. `pepita content template put <collection> --file <file.html>` creates one.';
  }
  // A collection appears here once it has items OR a template, so a count of 0 is
  // an ordinary row: the shape exists and nothing has been written into it yet.
  return cols.map((c) => `${c.name}  ${c.count}`).join('\n');
}

export async function runGet(
  client: PepitaApi,
  site: string,
  name: string,
  opts: { limit?: number; oldest?: boolean; asJson?: boolean }
): Promise<string> {
  const { records, total, oldestFirst } = await client.getContentRecords(site, name, {
    limit: opts.limit,
    oldest: opts.oldest
  });
  if (opts.asJson) {
    // WRAPPED, not flat: a template may legitimately declare a field called `id`,
    // and a flat shape would let an item's own field shadow the platform's
    // address. `fields` keeps the two apart.
    return JSON.stringify(
      records.map((r) => ({
        id: r.id,
        slug: r.slug,
        // Published, as opposed to a draft. Carried here because a script that
        // publishes has to be able to ask what is not published yet — and
        // because `content publish` takes an id, so without this the only way to
        // pick one is to guess.
        live: r.live,
        createdAtMs: r.createdAtMs,
        updatedAtMs: r.updatedAtMs,
        fields: r.data
      })),
      null,
      2
    );
  }
  if (records.length === 0) return `No items in "${name}".`;
  const head = `${name} — ${records.length} of ${total} item${total === 1 ? '' : 's'}, ${oldestFirst ? 'oldest' : 'newest'} first.`;
  const lines = records.map((r) => {
    const fields = Object.entries(r.data)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('  ');
    // The state LEADS the line: "what have I not published yet" is the question
    // this listing is most often opened to answer, and `content publish` needs an
    // id from it. Fixed width so the addresses stay in a column.
    return `${r.live ? 'LIVE ' : 'DRAFT'}  ${r.slug ?? '(no address)'}  ${r.id}  ${fields}`;
  });
  return [head, '', ...lines].join('\n');
}

export async function runAdd(
  client: PepitaApi,
  site: string,
  name: string,
  fileText: string
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch (e) {
    throw new Error(`That file is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'An import file holds an ARRAY of items — `[ { "title": "…" }, … ]` — even for a single one.'
    );
  }
  // All of them land or none do: the server validates every item before it writes
  // any, and the write itself is one transaction. So there is no partial result to
  // report and nothing to resume from.
  const created = await client.addContentRecords(site, name, parsed);
  const lines = created.map((r) => `${r.slug}  ${r.id}`);
  return [
    `Added ${created.length} item${created.length === 1 ? '' : 's'} to "${name}" as ` +
      `draft${created.length === 1 ? '' : 's'} — publish with \`pepita content publish\`.`,
    '',
    ...lines
  ].join('\n');
}

export async function runPut(
  client: PepitaApi,
  site: string,
  name: string,
  id: string,
  fileText: string
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch (e) {
    throw new Error(`That file is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('A put file holds ONE item as a JSON object — `{ "title": "…" }`.');
  }
  await client.putContentRecord(site, name, id, parsed);
  return `Replaced item ${id} in "${name}". Its published state is unchanged — editing never publishes or unpublishes an item.`;
}

export async function runRm(
  client: PepitaApi,
  site: string,
  name: string,
  id: string
): Promise<string> {
  await client.deleteContentRecord(site, name, id);
  return `Deleted item ${id} from "${name}".`;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

export async function run(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'template') return runContentTemplate(rest);
  const client = api();
  switch (sub) {
    case 'list': {
      const a = parseContentArgs(rest, { needName: false });
      console.log(await runList(client, a.site));
      return;
    }
    case 'get': {
      const a = parseContentArgs(rest);
      const out = await runGet(client, a.site, a.name!, {
        limit: a.limit,
        oldest: a.oldest,
        asJson: a.json !== undefined
      });
      if (a.json) {
        await writeFile(a.json, out, 'utf8');
        console.log(`Wrote ${a.json}`);
      } else console.log(out);
      return;
    }
    case 'add': {
      const a = parseContentArgs(rest);
      if (!a.file) throw new UsageError(`${USAGE}\n(--file <items.json> is required for add)`);
      console.log(await runAdd(client, a.site, a.name!, await readFile(a.file, 'utf8')));
      return;
    }
    case 'put': {
      const a = parseContentArgs(rest);
      if (!a.file) throw new UsageError(`${USAGE}\n(--file <item.json> is required for put)`);
      const id = await resolveRecordId(client, a.site, a.name!, a);
      console.log(await runPut(client, a.site, a.name!, id, await readFile(a.file, 'utf8')));
      return;
    }
    case 'publish':
    case 'unpublish': {
      // One case for both: they differ by a boolean, and splitting them would be
      // two places for the address resolution and the wording to drift.
      const live = sub === 'publish';
      const a = parseContentArgs(rest);
      const id = await resolveRecordId(client, a.site, a.name!, a);
      await client.setContentRecordLive(a.site, a.name!, id, live);
      console.log(
        live
          ? `Published ${id} in "${a.name}". It is on your live site now, wherever the collection is placed.`
          : `Unpublished ${id} in "${a.name}". It is off your live site and still here as a draft — nothing was deleted.`
      );
      return;
    }
    case 'rm': {
      const a = parseContentArgs(rest);
      const id = await resolveRecordId(client, a.site, a.name!, a);
      if (
        !a.yes &&
        !(await confirm(`Delete item ${id} from "${a.name}"? It disappears from your site immediately.`))
      ) {
        console.log('Aborted.');
        return;
      }
      console.log(await runRm(client, a.site, a.name!, id));
      return;
    }
    default:
      throw new UsageError(USAGE);
  }
}
