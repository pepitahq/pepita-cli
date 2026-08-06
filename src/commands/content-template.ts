/**
 * pepita content template <sub> — the SHAPE half of dynamic content.
 *
 * A content template is the HTML for ONE item of a collection, with
 * {{placeholder}} fields. It is not a site file: it lives outside the worktree
 * and is matched to a `<pepita-content name="…">` tag purely by NAME, the same
 * convention an email template uses for a form's `_form`. So every subcommand
 * here is addressed by the collection name and an asset id never surfaces.
 *
 *   pepita content template list --site <slug>
 *   pepita content template read <collection> --site <slug> [--out <file.html>]
 *   pepita content template put  <collection> --file <file.html> --site <slug> [--save]
 *   pepita content template save <collection> --site <slug>
 *   pepita content template rm   <collection> --site <slug> [--yes]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
// `PepitaApi` comes from ../api.js like the neighbouring commands do, not from
// the shared package directly — same type, one import style on this surface.
import { api, UsageError, type PepitaApi } from '../api.js';
import { flagValue, positional } from './video.js';

const USAGE = `usage:
  pepita content template list --site <slug>
  pepita content template read <collection> --site <slug> [--out <file.html>]
  pepita content template put  <collection> --file <file.html> --site <slug> [--save]
  pepita content template save <collection> --site <slug>
  pepita content template rm   <collection> --site <slug> [--yes]

A new collection is created AND saved in one step. Changing an existing one writes
the working copy; save makes it the version your pages render.`;

const VALUE_FLAGS = ['--site', '--file', '--out'];

export interface ContentTemplateArgs {
  site: string;
  name?: string;
  file?: string;
  out?: string;
  yes: boolean;
  save: boolean;
}

export function parseContentTemplateArgs(
  args: string[],
  opts: { needName?: boolean } = { needName: true }
): ContentTemplateArgs {
  const site = flagValue(args, '--site');
  if (!site) throw new UsageError(`${USAGE}\n(--site <slug> is required)`);
  // The collection name is the first true POSITIONAL, wherever it sits on the
  // line — `content template read --site acme blog` works, like the email twin.
  const name = positional(args, VALUE_FLAGS);
  if (opts.needName && !name) throw new UsageError(USAGE);
  return {
    site,
    name,
    file: flagValue(args, '--file'),
    out: flagValue(args, '--out'),
    yes: args.includes('--yes'),
    save: args.includes('--save')
  };
}

async function byName(client: PepitaApi, site: string, name: string) {
  const all = await client.listContentTemplates(site);
  return { all, hit: all.find((t) => t.name === name) ?? null };
}

const noCollection = (name: string, all: Array<{ name: string }>): Error =>
  new Error(
    `No content template for "${name}".` +
      (all.length
        ? ` Existing: ${all.map((t) => t.name).join(', ')}`
        : ' This site has no content templates yet.')
  );

export async function runList(client: PepitaApi, site: string): Promise<string> {
  const all = await client.listContentTemplates(site);
  if (all.length === 0) {
    return 'No content templates yet. `pepita content template put <collection> --file <file.html>` creates one.';
  }
  return all
    .map((t) => `${t.name}  ${t.sizeBytes} bytes  sha: ${t.sha}${t.cssKey ? `  css: ${t.cssKey}` : ''}`)
    .join('\n');
}

/**
 * The template's SOURCE document — head, style and all.
 *
 * `readContentTemplateSource` goes through the `open` endpoint for a reason that
 * matters here: the `by-name` endpoint answers the RENDER body, which has already
 * had its `<head>` and `<style>` stripped, so reading that and putting it back
 * would delete the founder's styling without a word.
 */
export async function runRead(client: PepitaApi, site: string, name: string): Promise<string> {
  const { all, hit } = await byName(client, site, name);
  if (!hit) throw noCollection(name, all);
  return client.readContentTemplateSource(site, hit.id);
}

/**
 * Create or update a template's body, and — when `save` is set — promote it.
 *
 * `save` is handled HERE rather than by the caller, because only this function
 * knows which branch it took and a create needs no promotion: that path writes
 * the SOURCE, so it is already saved. The first version let `run` decide by
 * matching `out.includes('working copy')` against this function's own prose,
 * which was correct and would have broken silently the first time anyone reworded
 * a sentence.
 */
export async function runPut(
  client: PepitaApi,
  a: { site: string; name: string; html: string; save?: boolean }
): Promise<string> {
  const { hit } = await byName(client, a.site, a.name);
  if (!hit) {
    const res = await client.createContentTemplate(a.site, a.name, a.html);
    // No mention of saving even under --save: telling someone to save what is
    // already saved is worse than saying nothing.
    return (
      `Created and saved the "${a.name}" content template (sha ${res.sha}).\n` +
      `Place it in a page with <pepita-content mode="list" name="${a.name}"></pepita-content>, ` +
      `then add items with \`pepita content add ${a.name} --file items.json\`.`
    );
  }
  await client.writeContentTemplate(a.site, hit.id, a.html);
  if (a.save) {
    const res = await client.saveContentTemplate(a.site, hit.id);
    // `saved: false` here means the new body was byte-identical to the saved one,
    // so the write left nothing pending — an outcome, not a failure.
    return res.saved
      ? `Updated and saved the "${a.name}" content template — your pages render it now.`
      : `The "${a.name}" content template already matched what your pages render — nothing to save.`;
  }
  return (
    `Updated the "${a.name}" content template's working copy.\n` +
    `Your pages still render the previous version — run \`pepita content template save ${a.name} --site ${a.site}\` to change that.`
  );
}

export async function runSave(client: PepitaApi, site: string, name: string): Promise<string> {
  const { all, hit } = await byName(client, site, name);
  if (!hit) throw noCollection(name, all);
  const res = await client.saveContentTemplate(site, hit.id);
  return res.saved
    ? `Saved the "${name}" content template — your pages render it now.`
    : `The "${name}" content template has no unsaved edits — your pages already render the current version.`;
}

export async function runRm(client: PepitaApi, site: string, name: string): Promise<string> {
  const { all, hit } = await byName(client, site, name);
  if (!hit) throw noCollection(name, all);
  await client.deleteContentTemplate(site, hit.id);
  return (
    `Deleted the "${name}" content template.\n` +
    `Its items are KEPT — writing a template with the same name again brings them back — but every ` +
    `<pepita-content name="${name}"> on your pages falls back to whatever static markup sits inside the tag.`
  );
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
  const client = api();
  switch (sub) {
    case 'list': {
      const a = parseContentTemplateArgs(rest, { needName: false });
      console.log(await runList(client, a.site));
      return;
    }
    case 'read': {
      const a = parseContentTemplateArgs(rest);
      const html = await runRead(client, a.site, a.name!);
      if (a.out) {
        await writeFile(a.out, html, 'utf8');
        console.log(`Template written to ${a.out}`);
      } else console.log(html);
      return;
    }
    case 'put': {
      const a = parseContentTemplateArgs(rest);
      if (!a.file) throw new UsageError(`${USAGE}\n(--file <file.html> is required for put)`);
      const html = await readFile(a.file, 'utf8');
      console.log(await runPut(client, { site: a.site, name: a.name!, html, save: a.save }));
      return;
    }
    case 'save': {
      const a = parseContentTemplateArgs(rest);
      console.log(await runSave(client, a.site, a.name!));
      return;
    }
    case 'rm': {
      const a = parseContentTemplateArgs(rest);
      if (
        !a.yes &&
        !(await confirm(
          `Delete the "${a.name}" content template? Its items are kept, but every page section using that name stops showing them.`
        ))
      ) {
        console.log('Aborted.');
        return;
      }
      console.log(await runRm(client, a.site, a.name!));
      return;
    }
    default:
      throw new UsageError(USAGE);
  }
}
