> **Snapshot.** Factored out of the private pepita monorepo, built and released from there,
> and **not standalone-buildable**. PRs are applied in the monorepo. https://pepita.dev

# @pepitahq/cli

Command-line access to your [pepita](https://pepita.dev) sites. Talks to
`app.pepita.dev` over HTTPS; you sign in once via a browser-based device
authorization (OAuth-style).

## Install

```bash
npm i -g @pepitahq/cli    # then: pepita <command>
# or one-off:
npx @pepitahq/cli <command>
```

### Standalone binary (no Node)

Prefer not to install Node at all? Grab a single self-contained binary from the
[latest release](https://github.com/pepitahq/pepita-cli/releases/latest) — no
Node, no npm, nothing installed:

```bash
# macOS (Apple Silicon) — swap in your platform's asset name (see below)
curl -fsSL https://github.com/pepitahq/pepita-cli/releases/latest/download/pepita-macos-arm64 -o pepita
chmod +x pepita
./pepita login
```

Asset names: `pepita-macos-arm64`, `pepita-macos-x64`, `pepita-linux-x64`,
`pepita-linux-arm64`, `pepita-windows-x64.exe`. The `…/releases/latest/download/…`
URL always resolves to the newest release.

Or install it onto your `PATH` in one line (macOS/Linux):

```bash
curl -fsSL https://github.com/pepitahq/pepita-cli/releases/latest/download/install.sh | sh
```

(Override the target dir with `PEPITA_INSTALL_DIR`; default `~/.local/bin`.)

## Use

```bash
pepita login                          # opens the browser to authorize this device
pepita list
pepita pull my-site                   # the live site (default)
pepita pull my-site --state unsaved   # your current working copy
# …edit files locally…
pepita apply my-site                  # upload as unsaved changes
pepita save my-site                   # save unsaved → draft
pepita publish my-site                # publish draft → live
```

### The three states (`pull --state …`)

| `--state` | what you get | URL |
|-----------|--------------|-----|
| `live` (default) | the published site | `my-site.pepita.dev` |
| `draft` | the saved staging site (excludes unsaved edits) | `my-site--draft.pepita.dev` |
| `unsaved` | your current working copy, including un-saved edits | — |

`live`/`draft` are complete checkouts (same as the editor's "Download .zip");
`unsaved` is the editable working set. `apply` always uploads into the
`unsaved` state — then `save` promotes it to `draft`, and `publish` to `live`.

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
