import { AuthError, UsageError, PepitaHttpError, authErrorMessage, lastUpgradeAdvised } from './api.js';
import { RENAMED, renameNotice } from './renamed.js';
import { VERSION } from './version.js';

const HELP = `pepita — command line for pepita sites

Usage: pepita <command> [args]

  login                       Authorize this device in the browser
  logout                      Remove the local token
  whoami                      Show the logged-in account
  status                      Your balance + every site's URL
  site <sub>                  Sites: list | create | pull | apply | preview | previews | publish | delete | status <slug>
  video <sub> --site <slug>   Video assets: add <file> | list | info <id> | rename <id> <name> | rm <id> | pull <id>
  email template <sub> --site <slug>   Confirmation-email templates: list | read <form-name> | put <form-name> | save <form-name> | rm <form-name> | image add|list|rm
  form <sub> --site <slug>   Form submissions: list | get <form-name> [--live] [--preview n] [--csv path] [--xlsx path] [--json path]
  content <sub> --site <slug>   Content items: list | get | add | put | publish | unpublish | rm  (all take <collection>)
  content template <sub> --site <slug>   Content templates: list | read | put | save | rm
`;

const commands: Record<string, () => Promise<{ run: (args: string[]) => Promise<void> | void }>> = {
  login: () => import('./commands/login.js'),
  logout: () => import('./commands/logout.js'),
  whoami: () => import('./commands/whoami.js'),
  status: () => import('./commands/status.js'),
  site: () => import('./commands/site.js'),
  video: () => import('./commands/video.js'),
  email: () => import('./commands/email.js'),
  form: () => import('./commands/form.js'),
  content: () => import('./commands/content.js')
};

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HELP);
    return;
  }
  // A renamed word: say so once, then run the new home with the same arguments.
  // Before dispatch, not after — a command that throws must not swallow the one
  // line that explains why the user should stop typing this spelling.
  const renamed = RENAMED[cmd];
  const word = renamed ? renamed.cmd : cmd;
  const argv = renamed ? [...renamed.prepend, ...args] : args;
  if (renamed) console.error(renameNotice(cmd, renamed.phrase));

  const loader = commands[word];
  if (!loader) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  const mod = await loader();
  await mod.run(argv);
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
