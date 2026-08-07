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
pepita login                               # opens the browser to authorize this device
pepita site list                           # your sites
pepita site pull my-site --dir ./my-site   # download the working copy to a folder
# …edit files locally with your own tools…
pepita site apply my-site --dir ./my-site  # upload local changes into the working copy
pepita site preview my-site                # a shareable link to review first
pepita site publish my-site                # put the current site live
```

## Commands

| Command | What it does |
|---------|--------------|
| `login` | Authorize this device in the browser |
| `logout` | Remove the local token (revokes the device server-side) |
| `whoami` | Show the logged-in account — checked against the server, so a device whose access was revoked says so instead of reporting the cached email |
| `status` | Your balance + every site's URL |
| `site <sub>` | Sites: `list`, `create <name> [--allow-embedding] [--block-ai-crawlers] [--from <dir>]` (embedding starts denied and AI visibility on — both changeable later in Settings → Advanced), `pull <slug> [--live] [--preview <name>] [--dir <path>]` (default: the working copy), `apply <slug> [--dir <path>] [--yes]`, `preview <slug> [--update <name>] [--delete <name>]`, `previews <slug>`, `publish <slug>`, `delete <slug> [--download-snapshot] [--yes]` (optionally snapshot to `/tmp` first), `status <slug>` (that site's pending changes) |
| `video <sub> --site <slug>` | Video assets: `add <file>` (upload + transcode), `list`, `info <id>`, `rename <id> <new name>` (label only — URLs keep working), `rm <id>`, `pull <id>` (download the original) |
| `email template <sub> --site <slug>` | Confirmation-email templates, one per form: `list`, `read <form-name> [--out body.html]`, `put <form-name> [--file body.html] [--subject s] [--from local] [--from-name name] [--save]` (upsert by form name — envelope-only puts re-send the current body; a put writes the WORKING COPY, `--save` does both in one step), `save <form-name>` (makes the working copy the version people receive), `rm <form-name> [--yes]`, and the template's images: `image add <form-name> <file>`, `image list <form-name>` (name, size and the public URL of each), `image rm <form-name> <image-name>` |
| `form <sub> --site <slug>` | Form submissions: `list` (every collection + its count), `get <form-name> [--live] [--preview <name>] [--csv <path>] [--xlsx <path>] [--json <path>]` (without `--live`/`--preview` you get the editor's own test submissions). `get` prints EVERY record of that source — a form holds at most 1000 entries, so there is no cap and no refusal. `--csv`/`--xlsx`/`--json` write a file through the same server export the editor's download button uses, so the file the CLI writes and the one a founder downloads can't diverge; if a collection is too large even for that, the export is partial and the CLI says so rather than reporting success. A form whose entries carry more than 50 different field names can't be shown as a table at all — the error message tells you to download the raw JSON, which `--json` does (the one format immune to the column-merge refusal, since it has no columns to merge). |
| `content <sub> --site <slug>` | Content items: `list` (every collection + its item count), `get <collection> [--oldest] [--limit <n>] [--json <path>]`, `add <collection> --file <items.json>` (an array — all of it lands or none does), `put <collection> --file <item.json>` and `rm <collection>`, both addressed with `--id <id>` or `--content-slug <slug>`. See **Dynamic content** below |
| `content template <sub> --site <slug>` | Content templates, one per collection: `list`, `read <collection> [--out <file.html>]`, `put <collection> --file <file.html> [--save]`, `save <collection>`, `rm <collection> [--yes]` |

**Every old top-level spelling still works** and prints one line on stderr naming
the new one — `pepita list` → `pepita site list`, `pepita asset` → `pepita video`,
`pepita template` → `pepita email template`. The notice goes to stderr, so a piped
stdout is byte-identical to what the old command produced.

Videos never live in the site's file tree — `apply` refuses video files and
points you at `video add`, which uploads to the asset library and transcodes
for streaming. A video already on the site and unchanged locally is skipped
silently, so a `pull` → `apply` round-trip keeps working.

**Video uploads cost money**: hosting is metered at **$0.60 per minute of
source footage** (per-second pro-rata), charged from your pepita balance when
you upload — `pepita status` shows what's left. Only **mp4, mov and m4v**
files are accepted, and by content, not by extension: a WebM renamed `.mp4`
is rejected before any upload starts.

If the server has moved past this CLI's version, every command prints one line
on stderr telling you to update. It is a notice, never a block — nothing stops
working because of it.

Templates live outside the site's file tree and are matched to a form by name
(the form's `_form` value). The confirmation email's recipient is always the
submission's `email` field — there is no `--to-field` flag, on this command or
anywhere else.

A template can hold up to **10 images** (JPEG or PNG, 300 kB each, 1 MB per
template). Reference one in the email body by its **bare filename** —
`<img src="hero.jpg">` — and pepita turns it into a full URL when it sends;
`image list` prints that URL if you need it elsewhere. Names are lowercased and
tidied for you (`Logo.PNG` → `logo.png`), and the format is checked by content,
not extension. Two things to know: **uploading an image is immediate, but the
`<img>` that references it is part of the template body, so it only reaches
recipients after `email template save`** — and **`image rm` is immediate too**, so
deleting one the saved body still names breaks that picture in the next email
that goes out. Re-using a name is refused rather than overwritten: image URLs
are cached for a long time, so the old picture could keep showing. Upload under
a new name and point the template at it.

### Dynamic content

A collection is repeating structured content — a blog, a menu, a team page. It has
two halves and the CLI addresses them separately: `content template` is the HTML
for ONE item, with `{{placeholder}}` fields, and `content` is the items filling it.
Neither lives in the site's file tree. A new item is a **draft**: it shows in the
editor and on preview links, and reaches the live site only when you publish it
with `pepita content publish`. `pepita content unpublish` puts it back.

**Two addresses, and they are not equivalent.** `--id` is the item's permanent
address: it never changes. `--content-slug` is derived from the item's title, so
renaming the item **moves it** — and an item written before addresses existed has
none at all, reachable only by `--id`. Use the slug by hand, the id in a script.

**Two file shapes.** `add` takes an ARRAY of bare field objects, because an item
that does not exist yet has no address to carry:

```json
[ { "title": "Turtle soup", "body": "…" },
  { "title": "Turtle stew", "body": "…" } ]
```

`put` replaces ONE item, so its file is a single object and the address is on the
command line:

```json
{ "title": "Turtle ragout", "body": "…" }
```

**An import is all-or-nothing.** The server validates every item before it writes
any, and the write itself is one transaction — so a refusal names every bad item
by index and writes nothing, and there is no partial state to resume from. One
request carries at most 5 MB; past that, split the file.

`add` prints each created item's address, because pepita mints the last four
characters and nothing else can know them:

```
Added 2 items to "blog".

turtle-soup-k3m9  6f1c…
turtle-stew-p7x2  b28a…
```

**The round trip**, if you want to edit a batch in an editor:

```bash
pepita content get blog --json blog.json --site acme
# edit blog.json, then feed each item back through put:
jq -c '.[]' blog.json | while read -r r; do
  jq '.fields' <<<"$r" > /tmp/one.json
  pepita content put blog --file /tmp/one.json --id "$(jq -r .id <<<"$r")" --site acme
done
```

`--json` wraps each item's own fields under `fields`, so a template that happens
to declare a field called `id` cannot shadow the item's address.

### What `site pull` downloads

| target | what you get |
|--------|--------------|
| *(default)* | the **working copy** — the site as it stands in the editor |
| `--live` | the **published** live site |
| `--preview <name>` | a specific **preview** link's files (name from `site previews`) |

`site apply` uploads local files into the working copy; from there `site publish`
puts it live, and `site preview` shares it at a stable link.

- The token is stored in `~/.pepita/config.json` (mode 600). Revoke any device
  under your avatar → Settings → **Devices**. `PEPITA_API_BASE` overrides the host.

## Notes

- `site pull` writes/overwrites files locally but does NOT delete local files
  that are absent from the fetched state.
- `site apply` will DELETE files from the working copy that exist remotely but
  not in your local directory — it shows a plan and asks for confirmation unless
  `--yes` is passed. Run it from a complete copy of the site (ideally a fresh
  `site pull`) to avoid surprise deletions.

## Security

- The server stores only `sha256(token)`; the raw token lives only on your machine.
- One-time PKCE code, 120 s TTL, loopback-only redirect.
