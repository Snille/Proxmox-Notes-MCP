# History

## 0.15.1 - 2026-10-18

- Dependency updates for `npm audit`, which now finds nothing. undici 7.29.0 to 7.30.1 (ten advisories: WebSocket, retry and dump interceptors, caches, BalancedPool, decompression). None of them touched this service, which uses undici only for the pinned Proxmox connection (`Agent` and `buildConnector`). 7.30.1 was three days old when it was taken, earlier than the usual two weeks; it is a coordinated security release from the Node.js team (with 6.29.1 and 8.12.2). Erik's choice.
- `@modelcontextprotocol/server` 2.0.0 to 2.2.0, `@modelcontextprotocol/node` 2.0.0 to 2.1.0, and the client used by the tests 2.0.0 to 2.2.0 (an OAuth advisory in the client, which is not in the image).

## 0.15.0 - 2026-10-18

- AI icons over MCP. `notes_icon_generate` starts a ComfyUI run (subject, styles, count, host) and lists the styles there are; `notes_icon_generation` follows it and, when it is done, returns small previews (192 px, trimmed) as MCP images the assistant can look at; `notes_icon_keep` trims the chosen image, draws it at the icon size as WebP with the smaller copies, and adds it to the library with the prompt, styles and seed. `notes_icons` shows the styles of each AI icon, so a new icon can match the theme of the others. Erik's aim: an assistant builds a guest and then gives it a good Note with a matching icon, made when none exists.
- The server now has an image library, [sharp](https://sharp.pixelplumbing.com/) 0.35.5 (Erik's decision). It is used only for drawing icons over MCP; the web GUI still draws in the browser. The image grows by about 30 MB (265 to 295 MB).
- Docker trap: the dependency stage runs on the build machine's platform, so an arm64 image built on amd64 would have got sharp's amd64 binary. npm is now told the target (`--os=linux --libc=musl --cpu=<target>`), the stage fails if the binary is missing, and the WebAssembly fallback (9 MB) is left out. Checked: the arm64 stage gets `@img/sharp-linuxmusl-arm64`.
- Tested against ComfyUI 0.41.3 with the built-in recipe: two images in 30 seconds, previews shown, the kept icon 5,552 bytes with copies of 4,310 and 3,860 bytes, embedded in a new Note as 7,427 characters.

## 0.14.0 - 2026-10-18

- An embedded icon that does not fit no longer stops a Note made over MCP. When the browser adds an icon to the library (upload, dashboard-icons, web set, icon pack, AI), it also encodes two smaller copies at WebP quality 65 and 45 and sends them with the icon; the library keeps them as `<id>.v<n>.webp`. When a Note is over 8192 characters and its image is an embedded library icon, `notes_render` and `notes_prepare_write` put in the largest copy that makes it fit and report it in `icon`. The server still has no image library. Found when an assistant made a Note for MiniCube CT 140: the icon as stored was about 7,100 characters, the Note 9,194, and the icon had to be encoded again by hand.
- Icons added before 0.14.0 have no smaller copies. The write is refused as before, now with a message that says how to fix it. Uploading the icon again with **Replace icons with the same name** adds the copies.
- Tested in a browser: a 100 px icon of 6,022 bytes got copies of 4,712 and 4,154 bytes, and a Note of 9,241 characters fitted at 7,493 with the quality 65 copy.

## 0.13.0 - 2026-10-18

- The guest list marks each Note's image: a yellow link when it links to an image on a web server (hovering shows which), a grey picture when its image is embedded. A link wins when a Note has both, since that is the dependency to see. It works for any Notes text, also text that does not follow the format, and is updated after a save. `notes_guests` with `notes: true` returns the same as `images: { linked: [hosts], embedded }`.

## 0.12.1 - 2026-10-18

- The import icon set that becomes the first web set takes its size from a folder name such as `512x512`. Its width and height were also the library's icon size (100), so a set pointing at a 512 px folder found no icons (seen in production right after 0.12.0).

## 0.12.0 - 2026-10-18

- Web icon sets: Settings → Icons has a list of folders on a web server (name, address, size, extension), for example the blue and green sets on Erik's web server. **Choose icon** has a tab **Web server** with the icons of a set, shown through the server. **Link to the web server** puts the image URL in the Note (a Note with a linked icon was 1,257 characters), **Copy into the library and embed** copies it and embeds it as before. Embedding stays the default.
- Which icons a set has: its folder listing when the web server shows one, a `proxmox-notes-icons.json` from an unpacked icon pack in the folder or the one above, and the image list ("Label = key"). Erik's Apache answers 403 for folder listings, so there only the 36 listed icons show until the listing is turned on or a key is added to the list. A **Test** button in the settings shows how many icons were found and from where, before saving.
- The icon set used only for importing becomes the first web set when an instance starts with 0.12.

## 0.11.0 - 2026-10-18

- Icon packs. In Settings → Icons every icon has a check box; **Select the shown** ticks all icons the search shows, and **Download as ZIP** opens a dialog with the pack name, the sizes (512, 200 and 100 px, and the original) and a file name (key) per icon, prefilled from the name ("Prowlarr" becomes `prowlarr01`). The ZIP has `<size>/<key>-<size>.png`, the layout of a web icon set, so it can be unpacked into an existing set (for example the blue one on the web server), and `proxmox-notes-icons.json` with the names and the AI data. Two icons with the same key, a bad key or no size are refused before anything is drawn. Each time the dialog opens it starts with 512, 200 and 100 px ticked and the original unticked.
- **Upload ZIP** adds a pack: with its manifest the names and AI data come along; any other ZIP of images is named from the file names like a folder upload, keeping the largest size of each key. **Replace icons with the same name** applies here too. AI originals have their transparent border trimmed again when the icon is drawn.
- A small ZIP reader and writer in the browser (`zip.js`): stored and deflated entries, UTF-8 names, CRC checks, and limits of 5000 files and 500 MB. The server needed no change.
- Tested in the browser: three Prowlarr icons downloaded with and without originals and uploaded again with their names and AI data.

## 0.10.0 - 2026-10-18

- Icons can be created with ComfyUI. **Choose icon** has a tab **Create with AI**, and Settings → Icons a button for it: give a name and what the icon shows, tick styles and choose how many images (1 to 4). The server sends the work to ComfyUI, follows it (queued, drawing) and fetches the images; clicking one trims its transparent border, draws the icon and adds it to the library with the original, the prompt, the styles and the seed.
- Built-in recipe from Erik's own workflow: Qwen-Image 2512 with the Wuli Turbo LoRA (4 steps, 1328 × 1328), then RMBG-2.0 for a transparent background, which replaces the separate Qwen-Image-Edit pass that made the background white. Model names may leave out the folder; the server looks them up on the host. An own workflow in ComfyUI's API format can be used instead, with `{{prompt}}`, `{{seed}}`, `{{width}}`, `{{height}}` and `{{count}}`.
- Settings → **Image generator**: ComfyUI hosts tried in order, a connection test that shows the GPU and the models found (or missing), the recipe, an own workflow, images per run, a time limit and the styles.
- Styles are tags: each is a short text, ticked in the dialog, and the ticked texts go first in the prompt, in the order of the list, with what the icon shows last ("Motif: ..."). So a frame colour is one tick and the name is typed as wanted, with no name ending per style. Included: Icon, Blue frame, Green frame and Empty outside. The browser remembers the ticked styles. A prompt built this way gave the same framed icons with a transparent background as the old whole-prompt templates.
- **Choose icon** has a box **Put a new icon in the Note right away** (ticked from the start). Unticked, an icon that is uploaded, taken from dashboard-icons or created with AI only goes into the library, and the dialog stays open, so icons can be made from an empty Note without putting one in it.
- An icon original may now be up to 8 MB, since a generated 1328 px PNG with transparency is about 4 MB.
- Interface texts keep `{{placeholders}}` as they are.
- Tested against ComfyUI 0.41.3 on an RTX 5070 Ti: two images in 29 seconds once the model is loaded.

## 0.9.0 - 2026-10-17

- First release. The code is under the MIT licence.
- GitHub Actions runs the tests on every push and pull request. A version tag (`v0.9.0`) also builds the image for `linux/amd64` and `linux/arm64`, pushes it to `ghcr.io/snille/proxmox-notes-mcp` (tags `latest`, `0.9.0` and `0.9`) and creates the GitHub release. The workflow stops if the tag does not match the version in `package.json`.
- `compose.yaml` is ready to paste as a Portainer stack; the README describes how to deploy and update it.
- The image's dependency stage runs on the build machine's own platform, so the arm64 image builds quickly under emulation. The image has OCI labels that link it to the repository.

## 0.8.1 - 2026-10-17

- Uploading a folder of icons works as an import: the name comes from the file name without its size suffix (also a mistyped one such as `-512x1512`), from the icon-set list when the key is in it ("Sonarr 01") or made from the key ("deluge03" becomes "Deluge 03"). With **Replace icons with the same name** (on by default in the settings) an upload replaces the icon with that name, keeping its id and name, instead of adding a copy. A progress line shows how far a large upload has come.
- Used to load Erik's full blue icon set from its 512 px originals: 35 icons replaced, 7 added (6 that were not in the old select.json, plus one mistyped file name that was merged by hand).

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
