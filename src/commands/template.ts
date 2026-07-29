/**
 * pepita template <sub> — confirmation-email templates, one per form.
 *
 * Templates live OUTSIDE the site's file tree (they are never published as
 * pages); a template is matched to a form by NAME — the form's `_form` value.
 * The recipient is ALWAYS the submission's `email` field: the form must
 * contain an input named `email`, and no flag here (or anywhere) changes that.
 *
 * A `put` writes the WORKING COPY: it does not change the emails people receive
 * until the template is saved (`template save`, or `put --save` in one shot, or
 * the editor's Save button on the template's row).
 *
 *   pepita template list --site <slug>
 *   pepita template read <form-name> --site <slug> [--out body.html]
 *   pepita template put  <form-name> --site <slug> [--file body.html] [--subject s] [--from local] [--from-name name] [--save]
 *   pepita template save <form-name> --site <slug>
 *   pepita template rm   <form-name> --site <slug> [--yes]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { api, PepitaHttpError, UsageError, type PepitaApi } from '../api.js';
import { flagValue, positional } from './asset.js';

const USAGE = `usage:
  pepita template list --site <slug>
  pepita template read <form-name> --site <slug> [--out body.html]
  pepita template put  <form-name> --site <slug> [--file body.html] [--subject s] [--from local] [--from-name name] [--save]
  pepita template save <form-name> --site <slug>
  pepita template rm   <form-name> --site <slug> [--yes]

put writes the working copy; save makes it the version people receive.`;

export interface TemplateArgs {
  site: string;
  name?: string;
  file?: string;
  out?: string;
  subject?: string;
  from?: string;
  fromName?: string;
  yes: boolean;
  /** `put --save` — write and save in one step. The ordinary one-shot case ("I
   *  have a file, make it the version in use"), and why a bare `put` followed by
   *  a bare `save` would read as two words for the same thing. */
  save: boolean;
}

/** Every flag here that takes a value — `positional` needs them so it doesn't
 *  mistake a flag's value for the form name. */
const VALUE_FLAGS = ['--site', '--file', '--out', '--subject', '--from', '--from-name'];

/** Shared arg parsing for the name-taking subcommands. `--to-field` is refused
 *  with the reason, not silently ignored — the flag never existed, but the MCP
 *  had one for a day, so say why. Both spellings are caught: `--to-field=email`
 *  slipping through as an unknown arg is exactly what the refusal is for. */
export function parseTemplateArgs(args: string[], opts: { needName?: boolean } = { needName: true }): TemplateArgs {
  if (args.some((a) => a === '--to-field' || a.startsWith('--to-field=')))
    throw new UsageError('There is no --to-field: the recipient is always the form field named "email".');
  const site = flagValue(args, '--site');
  if (!site) throw new UsageError(USAGE + '\n(--site <slug> is required)');
  // The form name is the first true POSITIONAL, wherever it sits on the line —
  // `template read --site acme contact` works, like `asset info` does.
  const name = positional(args, VALUE_FLAGS);
  if (opts.needName && !name) throw new UsageError(USAGE);
  return {
    site,
    name,
    file: flagValue(args, '--file'),
    out: flagValue(args, '--out'),
    subject: flagValue(args, '--subject'),
    from: flagValue(args, '--from'),
    fromName: flagValue(args, '--from-name'),
    yes: args.includes('--yes'),
    save: args.includes('--save')
  };
}

async function byName(client: PepitaApi, site: string, name: string) {
  const all = await client.listTemplates(site);
  const hit = all.find((t) => t.name === name) ?? null;
  return { all, hit };
}

const noTemplate = (name: string, all: Array<{ name: string }>): Error =>
  new Error(
    `No template for form "${name}".` +
      (all.length ? ` Existing: ${all.map((t) => t.name).join(', ')}` : ' This site has no templates yet.')
  );

export async function runList(client: PepitaApi, site: string): Promise<string> {
  const all = await client.listTemplates(site);
  if (!all.length) return 'No confirmation-email templates yet. `pepita template put <form-name>` creates one.';
  return all
    .map((t) => `${t.name}  subject: "${t.subject}"  from: "${t.fromName}" <${t.from}@…>  sha: ${t.sha}`)
    .join('\n');
}

export async function runRead(client: PepitaApi, site: string, name: string): Promise<string> {
  const { all, hit } = await byName(client, site, name);
  if (!hit) throw noTemplate(name, all);
  const t = await client.readTemplate(site, hit.id);
  return [
    `form: ${t.name}`,
    `subject: ${t.subject}`,
    `from: "${t.fromName}" <${t.from}@…>`,
    `recipient: the form's "email" field (fixed)`,
    `sha: ${t.sha}`,
    '--- body ---',
    t.html
  ].join('\n');
}

export interface PutInput {
  site: string;
  name: string;
  html?: string;
  subject?: string;
  from?: string;
  fromName?: string;
}

/** Create, translating the two HTTP failures a person at a terminal can act on.
 *  A bare `POST /api/sites/… → 400 {"message":…}` is not something to hand
 *  someone who typed a form name in a shell. */
async function createOrExplain(client: PepitaApi, input: PutInput) {
  try {
    return await client.createTemplate(input.site, input.name, input.html);
  } catch (e) {
    if (e instanceof PepitaHttpError && e.status === 400)
      throw new Error(
        `pepita refused the template name "${input.name}". A template is matched to a form BY NAME, so it has to be a valid form name: letters, digits, - and _, 1–64 characters, no spaces. Use the form's _form value verbatim.`
      );
    if (e instanceof PepitaHttpError && e.status === 409)
      throw new Error(
        `A template for form "${input.name}" already exists — it appeared while this command ran. Re-run the same command and it will update that template instead.`
      );
    throw e;
  }
}

/** The trailing facts after a create: the sha, and the sender display name that
 *  was ACTUALLY stored — with no `--from-name` pepita defaults it to the site's
 *  own name, which is exactly what an inbox should not show, so say so rather
 *  than leaving it silent. */
const createdTail = (sha: string, fromName: string, defaulted: boolean): string =>
  [
    defaulted
      ? `Sender name defaulted to "${fromName}" (pepita used the site's own name) — pass --from-name to show the business's real name instead.`
      : `Sender name: "${fromName}".`,
    `sha ${sha}.`
  ].join(' ');

/** Upsert by form name. One-shot last-write-wins for a human: an existing
 *  template is read first and its sha is passed as the CAS token, so only a
 *  write racing THIS command's read can conflict — and that conflict is
 *  surfaced as "re-run", never auto-retried. */
export async function runPut(client: PepitaApi, input: PutInput): Promise<string> {
  const envelope = {
    ...(input.subject !== undefined && { subject: input.subject }),
    ...(input.from !== undefined && { from: input.from }),
    ...(input.fromName !== undefined && { fromName: input.fromName })
  };
  const { hit } = await byName(client, input.site, input.name);

  if (!hit) {
    const created = await createOrExplain(client, input);
    const defaulted = input.fromName === undefined;
    if (!Object.keys(envelope).length)
      return [
        input.html === undefined
          ? `Created template for "${input.name}" with pepita's starter body.`
          : `Created template for "${input.name}".`,
        createdTail(created.sha, created.fromName, defaulted)
      ].join(' ');
    // The PUT is a full overwrite: with no --file, the body that exists is the
    // seeded one — read it back rather than writing '' over a brand-new template.
    const html = input.html ?? (await client.readTemplate(input.site, created.id)).html;
    const r = await client.updateTemplate(input.site, created.id, { content: html, expectedSha: created.sha, ...envelope });
    if (!r.ok) throw new Error(`Created, but the envelope write raced another edit — re-run the same command.`);
    return [
      `Created template for "${input.name}" and set its envelope.`,
      createdTail(r.sha, input.fromName ?? created.fromName, defaulted)
    ].join(' ');
  }

  const cur = await client.readTemplate(input.site, hit.id);
  const html = input.html ?? cur.html; // envelope-only put re-sends the current body
  const r = await client.updateTemplate(input.site, hit.id, { content: html, expectedSha: cur.sha, ...envelope });
  if (!r.ok)
    throw new Error(
      `The template changed while this command ran (current subject: "${r.conflict.currentSubject}") — re-run to retry against the new version.`
    );
  return [
    `Updated the "${input.name}" template's working copy.`,
    'It does not change the emails people receive yet —',
    `run \`pepita template save ${input.name} --site ${input.site}\` (or use --save) to make it the version in use.`
  ].join(' ');
}

/** Promote the working copy — the CLI's Save. Nothing pending is reported, not
 *  raised: re-running `save` after a save is a reasonable thing for a person to
 *  do, and it has not failed at anything. */
export async function runSave(client: PepitaApi, site: string, name: string): Promise<string> {
  const { all, hit } = await byName(client, site, name);
  if (!hit) throw noTemplate(name, all);
  const r = await client.saveTemplate(site, hit.id);
  if (r.ok) return `Saved the "${name}" template — it is now the version people receive.`;
  if (r.reason === 'nothing-to-save')
    return `The "${name}" template has no unsaved edits — the version people receive is already current.`;
  throw new Error(`Could not save the "${name}" template: ${r.reason}`);
}

export async function runRm(client: PepitaApi, site: string, name: string): Promise<string> {
  const { all, hit } = await byName(client, site, name);
  if (!hit) throw noTemplate(name, all);
  await client.deleteTemplate(site, hit.id);
  return `Deleted the "${name}" template — confirmation emails for that form stop going out.`;
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
      const a = parseTemplateArgs(rest, { needName: false });
      console.log(await runList(client, a.site));
      return;
    }
    case 'read': {
      const a = parseTemplateArgs(rest);
      const out = await runRead(client, a.site, a.name!);
      if (a.out) {
        const t = out.slice(out.indexOf('--- body ---') + '--- body ---\n'.length);
        await writeFile(a.out, t, 'utf8');
        console.log(`Body written to ${a.out}`);
      } else console.log(out);
      return;
    }
    case 'put': {
      const a = parseTemplateArgs(rest);
      const html = a.file ? await readFile(a.file, 'utf8') : undefined;
      const put = await runPut(client, { site: a.site, name: a.name!, html, subject: a.subject, from: a.from, fromName: a.fromName });
      if (!a.save) {
        console.log(put);
        return;
      }
      // --save: write then save. The put's own line is dropped — it ends in
      // "run save to make it the version in use", which the next line just did.
      console.log(await runSave(client, a.site, a.name!));
      return;
    }
    case 'save': {
      const a = parseTemplateArgs(rest);
      console.log(await runSave(client, a.site, a.name!));
      return;
    }
    case 'rm': {
      const a = parseTemplateArgs(rest);
      if (!a.yes && !(await confirm(`Delete the "${a.name}" template? Confirmation emails for that form stop going out.`))) {
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
