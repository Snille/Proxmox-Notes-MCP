# History

## 0.8.0 - 2026-10-17

- An icon library in the service (`/data/icons`), which replaces the web icon set as the source of icons. Erik's decision: icons are always embedded; a web icon set is only imported once, and link mode is gone. Each icon is kept as a WebP drawn by the browser at the instance's icon size (ready to embed) plus the uploaded original. The server only checks file signatures (PNG, JPEG, GIF, WebP; SVG refused), so it needs no image library.
- Settings → Icons is a grid with search, rename, remove, multi-file upload and drag and drop. **From dashboard-icons** searches the open dashboard-icons set by name (only its `tree.json` is read, cached for a day) and copies icons into the library through the server. **Import from a web icon set** copies a whole set once, for example the old generator's from its `select.json`; tested with Erik's set: 36 of 36 icons imported.
- Heading icons are chips with their icon; new ones are chosen from a searchable list of all 786 Font Awesome 4 icons, read from the bundled CSS.
- In the editor, **Choose icon** opens the library as a grid with search, with dashboard-icons in a second tab; an uploaded image goes into the library first. The stored WebP is embedded as it is, and encoded again at a lower quality only when the Note has too little room left.
- MCP: `notes_icons` lists the library, and `notes_new` and `notes_prefill` take `icon` (a library id) and embed it, so an assistant can give a Note an icon without a browser.
- Number fields in the settings now have the same style as the other fields.

## 0.7.0 - 2026-10-17

- A settings page in the web GUI, which replaces editing `targets.json` and `select.json` by hand.
- Proxmox hosts: add, edit and remove. **Read the certificate** shows the host certificate (subject, issuer, expiry, SHA-256 fingerprint) without trusting it, to compare with `pvenode cert info` and pin. **Test connection** checks the address and token before saving and reports the Proxmox version, the number of guests and, from `/access/permissions`, whether the token may write Notes. A token secret is sent once, stored in `targets.json` (mode 600, replaced atomically) and never returned; an update with an empty secret keeps the stored one. Changes take effect at once, without a restart. These endpoints are web and REST only, not MCP.
- Notes defaults and template (default values such as the owner), OS names, icon set, image list and heading icons, with import of the old `select.json`. `PUT /api/options` now checks the options against a schema instead of storing any JSON.
- Theme (dark, light, follow the system) and language (English, Swedish), per browser, with defaults for every browser in the options. All interface texts are in `src/web/i18n.js`; a test checks that the page and the code use no text that is missing, and that both languages have the same texts.
- The help on the settings page lists the `pveum` commands for a new host in the right order (the token must exist before its ACL).

## 0.6.0 - 2026-10-17

- Write Notes to Proxmox, in two steps. `notes_prepare_write` returns the current and the new text and a single-use confirmation (10 minutes); `notes_write_confirmed` writes only with it. Before writing, the config is read again and the write stops if its `digest` changed; the digest is also sent with the write, so Proxmox itself refuses it if the config changed in between. Only `description` is sent, and the stored text is read back and compared.
- Every write first keeps the current Notes as a snapshot in `/data/snapshots/<host>/<vmid>/`. New tools `notes_snapshots` and `notes_snapshot`; in the web GUI, **History** lists them and loads one into the editor, so a restore is an ordinary save.
- The web GUI's **Save to Proxmox** opens a dialog with the Notes now in Proxmox and the Notes to be written side by side, rendered as Proxmox shows them.
- The role is now `ProxmoxNotesEditor` (`VM.Audit` and `VM.Config.Options` on `/vms`). Checked in the Proxmox source: `description` needs `VM.Config.Options` for both LXC and VM, and no narrower privilege exists.
- Tested on a real host: a change was written to a test container, checked with `pct config`, and the original was put back from History.

## 0.5.1 - 2026-10-17

- A Note without an icon no longer keeps an empty icon cell: the header spans both columns, so the title and description start at the left edge (Erik's request). The first section label cell then sets the label column to 110 px, as the icon does otherwise; without it the browser split the table width evenly between the two columns.
- Repaired the two Font Awesome font files, which a line-ending cleanup had damaged in the previous commit, and added .gitattributes so fonts and images are always treated as binary.

## 0.5.0 - 2026-10-17

- New default layout: one HTML table with `width="100%"` and the header (icon, title, description) inside, so a Note fills the Proxmox Notes panel instead of being as wide as its text. Erik chose this layout ("B") after testing two variants in Proxmox. Proxmox keeps `width` and applies its Notes table CSS to HTML tables, so the rows alternate in colour as before.
- Bold is written as `<strong>`: the Proxmox test showed that `<b>` is not bold there (the theme only styles `strong`), and Markdown is not parsed inside an HTML block. `**x**` and `<b>` in text become `<strong>`.
- Both layouts are read. The old Markdown layout can still be chosen (`layout` in `options.json`, the `layout` argument of `notes_render`, or the choice in the web GUI). The editor says when a Note is stored in the other layout and will be converted on save.
- The preview uses Proxmox's own Notes CSS (`.pmx-md` and the dark theme's `_markdown.scss`): alternating row colours, row lines, hover, link colour, and the fixed width of the Notes panel. It also passes raw HTML blocks through, as Markdown does.
- Round-trip tests for the table layout against all eleven example Notes.

## 0.4.0 - 2026-10-17

- The web GUI replaces the test page: a guest list per Proxmox host (with each guest's Notes state), an editor for every part of a Note, a live preview, a size bar against the 8192-character limit, and a badge when the Note differs from what Proxmox has. Notes that do not follow the format open as raw text instead of being dropped.
- The preview uses the same render code as the server: the browser imports `src/format/` from `/format/`. The preview HTML is cleaned like current Proxmox versions clean Notes (allowed tags and attributes only, no `style`, safe `href`/`src`), so it also shows what Proxmox will show, and a Note cannot run script in the editor.
- Icons are embedded by default: the browser draws the image on a canvas and encodes WebP at the highest quality that fits the space left in the Note (PNG when the browser cannot make WebP). Icon-set images come through `/api/icon`, which fetches only URLs built from the configured icon set, because a canvas cannot read a cross-origin image.
- "Update from Proxmox" fills IP, MAC, DHCP and OS from the guest's config and moves service links from the old IP to the new one; this was done with `sed` by hand at every cutover in the Arr rebuild.
- Import of JSON (this tool and the old Notes Generator) and Markdown; export as JSON; copy Markdown with a fallback when the clipboard API is not available (plain http).
- `notes_guests` takes `notes: true` to report each guest's Notes state (four config reads at a time).
- Static files are served from the web and format folders only, with path checks; Font Awesome 4.7 (woff2/woff) is bundled with its licence.

## 0.3.0 - 2026-10-17

- Read from Proxmox. Hosts are listed in `/data/targets.json` with an API token per host; the secret is read from a file (`tokenSecretFile`, for example a Docker secret) and is kept out of every response and log. Four read-only tools: `notes_hosts`, `notes_guests`, `notes_read` (Markdown, parsed document and facts) and `notes_prefill` (a new Note from the template, filled with hostname, IP, MAC, DHCP, OS and today's date).
- Certificate pinning: a target can carry the SHA-256 fingerprint of the host's certificate, and the service then accepts only that certificate, checked before any request byte is sent. Proxmox uses its own CA, so without a pin the choice is between installing that CA and not checking at all.
- Trap found while testing: on a reused TLS session Node reports no peer certificate, so the second request to a host failed the pin check. Pinned connections now always make a full handshake (`maxCachedSessions: 0`).
- The minimal role is `VM.Audit` on `/vms`, for both the user and the token (the token has privilege separation). Tested against a real host with two guests, one LXC and one VM: both existing Notes were read, parsed, and rendered back to the identical text apart from the added `width`/`height`.

## 0.2.0 - 2026-10-17

- The server: one Node.js process with a web page, REST (`POST /api/tools/{name}`), MCP over Streamable HTTP (`/mcp`) and MCP over stdio (`node src/stdio.mjs`). REST and MCP share one set of tools: `notes_status`, `notes_options`, `notes_new`, `notes_render`, `notes_parse`, `notes_import_legacy`. None of them write to Proxmox yet.
- No login in the service, by decision: it is meant to sit behind a reverse proxy with authentication (Authelia). To make that safe, requests with an `Origin` from another site are refused, `ALLOWED_HOSTS` can pin the host names, and `MCP_TOKEN` can protect `/mcp` when the proxy lets it through.
- Instance options in `/data/options.json` (heading icons, icon set, images, OS names, template for a new Note). A `select.json` from the old generator is converted on first start. Its labels start with the Font Awesome glyph itself (a private-use character); the conversion removes it.
- Docker image (`node:22-alpine`, non-root user, health check, `/data` volume), `compose.yaml` for running a published image (for example in Portainer) and `compose.dev.yaml` for a local build. Tested in Docker Desktop.

## 0.1.0 - 2026-10-17

- Start of the project. It becomes a self-hosted service (own Docker container, one independent instance per site) with a web GUI, REST and MCP, and it replaces the browser-only Proxmox Notes Generator. It was first planned as tools inside the Infrastructure Gateway; it was moved out so that anyone can run their own instance and so it can be published.
- The Notes document model: one JSON document per Note, `renderNotes()` to Markdown and `parseNotes()` back. Output matches the original generator, with one addition: `width` and `height` on the icon, because Proxmox removes the `style` attribute since its sanitizer was hardened on 2026-05-03.
- Icons are embedded as `data:` images by default. Tested in the Proxmox web GUI: an embedded WebP icon shows correctly, and a full Note with the icon is 5.8 KB of the 8192-character limit. SVG cannot be embedded; Proxmox blocks it.
- Import of JSON files saved by the old Notes Generator.
- Round-trip tests against the eleven real Notes in `reference/examples/` (real Notes with addresses and names replaced).
