import { AuthError, UsageError, PepitaHttpError, authErrorMessage, lastUpgradeAdvised } from './api.js';
import { VERSION } from './version.js';

const HELP = `pepita — command line for pepita sites

Usage: pepita <command> [args]

  login                       Authorize this device in the browser
  logout                      Remove the local token
  whoami                      Show the logged-in account
  list                        List your sites
  create <name> [--allow-embedding] [--block-ai-crawlers] [--from d]   Create a new site (optionally from a local dir)
  pull <slug> [--live] [--preview <name>] [--dir d]         Download files (default: the working copy)
  apply <slug> [--dir d] [--yes]       Upload local files into the site's working copy
  preview <slug> [--update <name>] [--delete <name>]   Create, update, or remove a shareable preview link
  previews <slug>             List active preview links
  publish <slug>              Put the current site live
  delete <slug> [--download-snapshot] [--yes]   Permanently delete a site (optionally snapshot to /tmp first)
  status [slug]               Balance + your sites; with a slug, its pending changes
  asset <sub> --site <slug>   Video assets: add <file> | list | info <id> | rename <id> <name> | rm <id> | pull <id>
  template <sub> --site <slug>   Confirmation-email templates: list | read <form-name> | put <form-name> | rm <form-name>
  form <sub> --site <slug>   Form submissions: list | get <form-name> [--live] [--preview n] [--csv path] [--xlsx path] [--json path]
`;

const commands: Record<string, () => Promise<{ run: (args: string[]) => Promise<void> | void }>> = {
  login: () => import('./commands/login.js'),
  logout: () => import('./commands/logout.js'),
  whoami: () => import('./commands/whoami.js'),
  list: () => import('./commands/list.js'),
  create: () => import('./commands/create.js'),
  pull: () => import('./commands/pull.js'),
  apply: () => import('./commands/apply.js'),
  preview: () => import('./commands/preview.js'),
  previews: () => import('./commands/previews.js'),
  publish: () => import('./commands/publish.js'),
  delete: () => import('./commands/delete.js'),
  status: () => import('./commands/status.js'),
  asset: () => import('./commands/asset.js'),
  template: () => import('./commands/template.js'),
  form: () => import('./commands/form.js')
};

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HELP);
    return;
  }
  const loader = commands[cmd];
  if (!loader) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  const mod = await loader();
  await mod.run(args);
  noticeUpgrade();
}

/**
 * One line on stderr when the server says this binary is behind the API.
 *
 * After the command, not before or during: a single notice covers the whole run
 * however many requests it made, and stderr keeps it out of anything the user is
 * piping. Warn-only by design — a version mismatch never blocks a command, so
 * this cannot be the reason something failed.
 */
function noticeUpgrade(): void {
  const min = lastUpgradeAdvised();
  if (!min) return;
  console.error(
    `pepita: this CLI is ${VERSION}, but the server now expects ${min} or newer — run \`npm i -g @pepitahq/cli\` to update.`
  );
}

main().catch((err) => {
  // The notice belongs on the failure path too: an out-of-date client is a
  // plausible CAUSE of the error the user is looking at, so saying nothing here
  // is exactly when it is least helpful.
  noticeUpgrade();
  if (err instanceof UsageError) {
    // Plain usage line — no "Error:" prefix, no stack.
    console.error(err.message);
    process.exitCode = 1;
  } else if (err instanceof AuthError || (err instanceof PepitaHttpError && err.status === 401)) {
    // Both paths land here: AuthError from apiFetch and a 401 from the shared
    // PepitaApi client. Derive the wording from whether a token is stored, so a
    // revoked device never gets told it simply "isn't logged in".
    console.error(authErrorMessage());
    process.exitCode = 2;
  } else {
    console.error(`Error: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
});
