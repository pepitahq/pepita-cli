> **Snapshot.** Factored out of the private pepita monorepo, built and released from there,
> and **not standalone-buildable**. PRs are applied in the monorepo. https://pepita.dev

# @pepitahq/cli

Command-line access to your [pepita](https://pepita.dev) sites. Talks to
`app.pepita.dev` over HTTPS; you sign in once via a browser-based device
authorization — the way `wrangler` or `gh` do it, no pasted API key.

## Install

```bash
npm i -g @pepitahq/cli    # then: pepita <command>
# or one-off:
npx @pepitahq/cli <command>
```

## Use

```bash
pepita login                          # opens the browser to authorize this device
pepita list                           # your sites
pepita pull my-site --dir ./my-site   # download the live site to a folder
# …edit files locally with your own tools…
pepita apply my-site --dir ./my-site  # upload local changes into the working copy
pepita preview my-site                # a shareable link to review first
pepita publish my-site                # put the current site live
```

## Commands

| Command | What it does |
|---------|--------------|
| `login` | Authorize this device in the browser |
| `logout` | Remove the local token (revokes the device server-side) |
| `whoami` | Show the logged-in account |
| `list` | List your sites |
| `create <name> [--no-analytics] [--from <dir>]` | Create a new site (optionally seeded from a local folder) |
| `pull <slug> [--state live\|draft\|unsaved] [--dir <path>]` | Download a site's files (default: `live`) |
| `apply <slug> [--dir <path>] [--yes]` | Upload local files into the site's working copy |
| `preview <slug> [--update <name>] [--delete <name>]` | Create, update, or remove a shareable preview link |
| `previews <slug>` | List active preview links |
| `publish <slug>` | Put the current site live |
| `status <slug>` | Show pending changes + URLs |
| `delete <slug> [--download-snapshot] [--yes]` | Permanently delete a site (optionally snapshot to `/tmp` first) |

### The three states (`pull --state …`)

| `--state` | what you get | URL |
|-----------|--------------|-----|
| `live` (default) | the published site | `my-site.pepita.page` |
| `draft` | the `draft` staging preview | `my-site--draft.pepita.page` |
| `unsaved` | your current working copy, including un-published edits | — |

`live`/`draft` are complete checkouts of a committed version (the same bytes
those URLs serve); `unsaved` is the editable working set — exactly what the
editor shows. `apply` always uploads into the `unsaved` working copy; from there
`publish` puts it live, and `preview` freezes a shareable snapshot link.

- The token is stored in `~/.pepita/config.json` (mode 600). Revoke any device
  in **Connected devices** in the editor. `PEPITA_API_BASE` overrides the host.

## Notes

- `pull` writes/overwrites files locally but does NOT delete local files that
  are absent from the fetched state.
- `apply` will DELETE files from the unsaved working copy that exist remotely
  but not in your local directory — it shows a plan and asks for confirmation
  unless `--yes` is passed. Run `apply` from a complete copy of the site
  (ideally a fresh `pull --state unsaved`) to avoid surprise deletions.

## Security

- The server stores only `sha256(token)`; the raw token lives only on your machine.
- One-time PKCE code, 120 s TTL, loopback-only redirect.
