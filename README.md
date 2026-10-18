# Proxmox Notes

A self-hosted service that creates, reads and edits the Notes (description) of Proxmox LXC containers and VMs. It has a web GUI, a REST API and an MCP server, and it replaces the browser-only [Proxmox Notes Generator](https://github.com/Snille/Proxmox-Notes).

Status: **0.13.0.** The Notes format, the server (REST, MCP, Docker), reading and writing Notes in Proxmox, the web GUI with its settings page (English and Swedish) and the icon library and icon generation with ComfyUI work, and a ready-made image is published. The cloud image services are not built yet.

## What it will do

- **Read** the Notes of existing guests on one or more Proxmox hosts, **edit** them in the web GUI and **save** them back.
- **Create** Notes for new guests, prefilled from Proxmox (hostname, IP, MAC, DHCP, OS).
- **Export and import** a Note as a loose JSON file. Files saved by the old Notes Generator can be imported.
- **Embed icons** in the Note itself, so no web server is needed for images. A URL to an icon set is still possible.
- **Make icons** when one is missing: from ComfyUI (your own workflow), from a cloud image service (Nano Banana, OpenAI or Grok, to be tested), or from the open [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) set.
- Give an AI assistant the same functions through **MCP**, with a preview before every write.

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Where it runs | Its own Docker container, one independent instance per site | Anyone can run their own copy (home, work, other people). No dependency on another service. |
| Publishing | Public GitHub repository (MIT licence), image on GitHub Container Registry | Others can use it, and the image lives next to the code. Nothing site-specific may be in the code or the repository; it goes in configuration. |
| Icons | An icon library in the service; icons are embedded as WebP (`data:` URI) by default. A Note can instead link to an image in a web icon set. | Proxmox shows embedded raster images (tested 2026-10-17), so no web server is needed. SVG cannot be embedded. See [docs/NOTES_FORMAT.md](docs/NOTES_FORMAT.md). |
| Language | Node.js 22+, plain ES modules, Vitest | Same stack as the original generator logic, so it ports directly. |
| Layout | One full-width HTML table with the header inside; the old Markdown layout is still read and can be chosen | It fills the Proxmox Notes panel and gets the alternating row colours (tested in Proxmox 2026-10-17). |
| Data model | One JSON document per Note | The web GUI, REST, MCP and JSON export all use the same model; Markdown is rendered from it. |
| Writes | Preview first; the old Note is saved as a snapshot before every write | A write overwrites the old text in Proxmox. The snapshot makes it reversible. |
| Login | None in the service; put it behind a reverse proxy with authentication (for example Authelia) | One less thing to build and maintain; the proxy already does it well. |

## Connect a Proxmox host

Each Proxmox host gets its own user and API token. Run this on the Proxmox host as root. It creates a role, a user that cannot log in, and a token:

```bash
pveum role add ProxmoxNotesEditor -privs VM.Audit,VM.Config.Options
pveum user add proxmox-notes@pve -comment 'Proxmox Notes service'
pveum acl modify /vms -user proxmox-notes@pve -role ProxmoxNotesEditor
pveum user token add proxmox-notes@pve notes -privsep 1 -comment 'Proxmox Notes service'
pveum acl modify /vms -token 'proxmox-notes@pve!notes' -role ProxmoxNotesEditor
```

`pveum user token add` shows the token secret once. Save it in a file, for example as a Docker secret. The token has privilege separation (`-privsep 1`), so it needs its own ACL as well as the user's.

| Privilege | Needed for |
|-----------|-----------|
| `VM.Audit` | List guests and read their config and Notes |
| `VM.Config.Options` | Write the Notes (`description`). Leave it out for a read-only instance. |

`VM.Config.Options` is the narrowest privilege Proxmox has for the description, but it also covers other general options (name, onboot, OS type and similar). The service only ever sends `description`.

### Writing

A write takes two steps. `notes_prepare_write` reads the guest's config and returns the current text, the new text and a single-use confirmation (valid 10 minutes); the web GUI shows both side by side. `notes_write_confirmed` then:

1. reads the config again and stops if it changed since the preview (Proxmox's config `digest`);
2. saves the current Notes as a snapshot in `/data/snapshots/<host>/<vmid>/`;
3. sends only `description`, with the digest, so Proxmox itself refuses the write if the config changed in between;
4. reads the Notes back and checks that Proxmox stored exactly what was sent.

Snapshots are never deleted automatically. **History** in the web GUI (or `notes_snapshots` and `notes_snapshot`) lists them; loading one puts it in the editor, and saving writes it back.

Then add the host under **Settings → Proxmox hosts** in the web GUI: address, token id and token secret. **Read the certificate** shows the host's certificate fingerprint; compare it with `pvenode cert info` on the host and pin it. **Test connection** shows the Proxmox version, how many guests the token sees, and whether it may write Notes. The secret is sent to the server once and never shown again.

The hosts are kept in `/data/targets.json`, which the settings page writes with mode 600. Secrets typed in the web GUI are stored in that file, so back the volume up as carefully as the tokens themselves. A host can also be written there by hand (see [targets.example.json](targets.example.json)), with the secret in a separate file such as a Docker secret:

| Field | Meaning |
|-------|---------|
| `id` | Short name used in tools and URLs, lower case |
| `baseUrl` | `https://<host>:8006` |
| `tokenId` | `proxmox-notes@pve!notes` |
| `tokenSecretFile` | Path inside the container to the file with the secret (or `tokenSecret` inline, not recommended) |
| `fingerprint` | SHA-256 fingerprint of the host's certificate. The service then accepts only that certificate. Read it on the host with `pvenode cert info` (`pve-ssl.pem`, or `pveproxy-ssl.pem` if you installed your own). |
| `verifyTls` | Without a fingerprint: `true` (default) checks the certificate against the system CAs; `false` accepts any certificate (not recommended) |

A pinned connection makes a full TLS handshake every time (no session reuse), because a resumed session carries no certificate to check.

The guests' facts come from their config: hostname, IP (static, or the DHCP address of a running LXC), MAC (written in lower case), DHCP and OS type. A VM's address is only known when it uses cloud-init; otherwise it needs the QEMU guest agent, which is not used yet.

## The web GUI

- **Guest list**: pick a Proxmox host; every guest shows whether its Notes are in the Notes format, other text, or empty, and a small mark for its image: a link (with the web server's name on hover) when the Note depends on a web server, a picture when the image is embedded.
- **Editor**: heading icon and title, icon image, description, notes and the sections with their rows (add, move, remove). A guest with no Notes gets a new Note filled in from the template and from Proxmox. Notes that do not follow the format open as raw text, so nothing is lost.
- **Live preview**, rendered by the same code as the server, cleaned the way current Proxmox versions clean Notes (inline styles removed, only safe tags, attributes and URLs) and styled with Proxmox's own Notes CSS in a panel of the same fixed width. A bar shows the size against the 8192-character limit, and a badge shows when the Note differs from what Proxmox has.
- **Layout**: full-width table (default) or the old Markdown layout. A Note stored in the other layout is converted when it is saved, and the editor says so.
- **Icons**: **Choose icon** opens the icon library as a searchable grid, with a second tab for dashboard-icons. An uploaded image is added to the library first. The icon is always embedded; if the Note has too little room left, it is encoded again at a lower quality.
- **Icon library** (Settings → Icons): a grid of every icon with search, rename and remove; upload several files or drop them on the page; add icons from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) by searching for them; import a whole web icon set once (for example the old Notes Generator's, from its `select.json`), after which that web server is no longer needed. An uploaded file is named from its file name without the size (`sonarr01-512x512.png` becomes "Sonarr 01", taking the name from the icon-set list when the key is in it), and with **Replace icons with the same name** an upload updates an icon instead of adding a copy, so a whole folder can be uploaded again, for example in a larger size. Heading icons are chips, added from a searchable list of all 786 Font Awesome 4 icons.
- **Web icon sets** (Settings → Icons): folders of icons on a web server, one size each (`<key>-<width>x<height>.png`), for example the blue and the green set of the old Notes Generator. **Choose icon → Web server** shows a set's icons; **Link** puts the image's URL in the Note (about 100 characters instead of about 5,000, but the image must be reachable wherever Proxmox is viewed), **Copy into the library and embed** works as before. The icons of a set are found in the folder listing when the web server shows one, in a `proxmox-notes-icons.json` from an unpacked icon pack (in the folder or the one above), and in the image list under Import. A set from before 0.12 (the import icon set) becomes the first web set.
- **Icon packs** (Settings → Icons): tick icons (or **Select the shown** after a search) and **Download as ZIP**. The ZIP has a folder per size with `<key>-<size>.png`, the layout of a web icon set such as the old Notes Generator's (512, 200 and 100 px drawn from the original, and the original itself if wanted), plus `proxmox-notes-icons.json` with the names and how AI icons were made. Each file name (key) can be changed first, for example `prowlarr01`, so an icon can be unpacked straight into an existing set on a web server. **Upload ZIP** adds a pack again, with the names from the manifest, or, for any other ZIP of images, from the file names, keeping the largest size of each key. All ZIP work happens in the browser.
- **Create with AI** (a tab in **Choose icon**, and a button in Settings → Icons): give a name and what the icon shows, tick the styles you want, and ComfyUI draws up to four images. Clicking one trims its transparent border, adds it to the library and keeps the prompt, styles and seed with it. The browser remembers which styles were ticked.
- **From Proxmox**: one button updates IP, MAC, DHCP and OS from the guest's config. When the IP changes, service links that pointed at the old IP move along. An exact OS release in the Note ("Debian 13") is kept when Proxmox only knows the family ("Debian").
- **Import and export**: export a Note as JSON; import JSON from this tool or from the old Notes Generator, or Markdown. **Copy Markdown** puts the text on the clipboard for the Proxmox Notes field.
- **Save to Proxmox**: a dialog shows the Notes now in Proxmox and the Notes that will be written, side by side, before anything is written. **History** lists the snapshots kept before each save.
- **Settings**: Proxmox hosts (add, edit, remove, read and pin the certificate, test the connection); Notes defaults (layout, heading icon, the template for a new Note with default values such as the owner, OS names); icons (icon-set address and size, image list, heading icons, import of the old `select.json`); image generator (ComfyUI hosts with a connection test, the recipe or an own workflow, styles); appearance (theme and language for this browser, and the defaults for every browser).
- **Languages**: English and Swedish. A missing Swedish text falls back to English; a test checks that both languages have every text the page uses.
- **Themes**: dark (default), light, or follow the system.

The browser loads the Notes format modules from `/format/`, so the preview matches what the server renders. Font Awesome 4.7 is bundled (font: SIL OFL 1.1, CSS: MIT; see `src/web/vendor/font-awesome/LICENSE.txt`), because Proxmox uses that version for the icons in Notes.

## Icon generation

The server sends the work to ComfyUI over its HTTP API and fetches the images, so only the server has to reach ComfyUI, not the browser. Add the addresses under **Settings → Image generator**; they are tried in order, and the first that answers is used (or pick one in the dialog). **Test connection** shows the GPU and which models were found.

- **Built-in recipe**: Qwen-Image with an optional speed LoRA, then background removal with the RMBG node from [ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG). The defaults are Qwen-Image 2512 (fp8), the Wuli Turbo LoRA (4 steps), the Qwen 2.5 VL text encoder, the Qwen-Image VAE and RMBG-2.0, at 1328 × 1328. A model name may leave out its folder; the server finds it in the host's lists. The results go to ComfyUI's temp folder, not its output folder.
- **Own workflow**: export it from ComfyUI with *Export (API)* and paste it. `{{prompt}}` is replaced with the prompt; `{{seed}}`, `{{width}}`, `{{height}}` and `{{count}}` become numbers. Every image the workflow outputs is offered.
- **Styles** are short prompt texts that are ticked in the dialog. The ticked ones are put first, in the order of the list, and what the icon shows comes last ("Motif: ..."). Included: Icon, Blue frame, Green frame and Empty outside; add, change, order and remove them in the settings, and choose which are ticked from the start.

Finished generations are kept in memory for 30 minutes. Generation is offered in the web GUI and REST, not over MCP, because the browser draws the icon.

## Run it

The image is `ghcr.io/snille/proxmox-notes-mcp`, built for `linux/amd64` and `linux/arm64` by GitHub Actions for every release. Tags: `latest`, the version (`0.9.0`) and the minor version (`0.9`).

### As a Portainer stack

1. **Stacks → Add stack**, name it for example `proxmox-notes`.
2. **Web editor**: paste [compose.yaml](compose.yaml). (Or **Repository**: `https://github.com/Snille/Proxmox-Notes-MCP`, compose path `compose.yaml`.)
3. Change the port, `ALLOWED_HOSTS` and `MCP_TOKEN` if you need to, then **Deploy the stack**.
4. Open `http://<host>:8080/` and add a Proxmox host under **Settings → Proxmox hosts** (see [Connect a Proxmox host](#connect-a-proxmox-host)).

To update, open the stack, choose **Update the stack** and turn on **Re-pull image**. The data stays in the volume.

### With Docker Compose

```bash
docker compose up -d
```

Then open `http://<host>:8080/`.

The container keeps its data (options, hosts with their token secrets, snapshots and the icon library) in the volume mounted at `/data`. Back the volume up, and protect the backup as carefully as the tokens.

To build the image from the source instead, use [compose.dev.yaml](compose.dev.yaml), which serves on port 8085. It mounts `DEV_DATA_DIR` (default `private/dev-data`) at `/data` and `DEV_SECRETS_DIR` (default `private/secrets`) read-only at `/run/secrets/proxmox-notes`:

```bash
docker compose -f compose.dev.yaml up -d --build
```

The host it runs on must reach the Proxmox API (port 8006) of every Proxmox host it manages.

### Settings

All settings are environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8080` | Port inside the container |
| `DATA_DIR` | `/data` in the image | Where options, targets, snapshots and icons are kept |
| `TARGETS_FILE` | `$DATA_DIR/targets.json` | The Proxmox hosts and their tokens |
| `ALLOWED_HOSTS` | empty (any) | Comma-separated host names the service answers to, for example `notes.example.com`. Recommended behind a reverse proxy. |
| `MCP_TOKEN` | empty (none) | When set, `/mcp` needs `Authorization: Bearer <token>`. Use it when the proxy lets `/mcp` through without its own login, because MCP clients cannot do a browser login. |

The service has no login of its own. Never expose it without a reverse proxy that has authentication. Requests from a web page on another site are refused (`Origin` check), so a logged-in browser cannot be used against it by another page.

### Options

The choices in the forms (layout, heading icons, icon-set images, OS names, the template for a new Note, and the default theme and language) are kept in `/data/options.json` and edited on the settings page. On the first start, a `select.json` from the old Notes Generator in `/data` is converted automatically; the settings page can also import one. Read and save them with `GET` and `PUT /api/options`; a save is checked against a schema.

The host settings (`/api/settings/...`) are offered in the web GUI and REST only, not over MCP, so token secrets never pass through an assistant.

### Interfaces

| Path | What |
|------|------|
| `/` | Web GUI |
| `/api/icons` | The icon library: `GET` lists, `POST` adds (a WebP drawn by the browser plus the original, as base64), `PATCH`/`DELETE /api/icons/<id>` rename and remove, `GET /api/icons/<id>.webp` serves one |
| `/api/generate` | `POST {subject, styles, count, host}` starts a generation; `GET /api/generate/<id>` shows its state and image URLs; `GET /api/generate/<id>/<n>.png` serves an image |
| `/api/generator/test` | `POST` the generator settings (also unsaved ones) to test each ComfyUI host |
| `/api/dashboard-icons?q=<words>` | Searches the names in dashboard-icons; `GET /api/dashboard-icons/<name>.png` fetches one through the server |
| `/api/icon?key=<key>[&set=<n>]` | An icon from the import icon set, or from web set number `n`. Only URLs built from a configured set are fetched. |
| `/api/web-sets/<n>/icons` | The icons of web set number `n` (`?refresh` reads them again); `POST /api/web-sets/test` lists a set given in the body, for the settings form |
| `/api/tools/{name}` | REST: `POST` a tool's arguments as JSON |
| `/api/options` | `GET` or `PUT` the options |
| `/mcp` | MCP over Streamable HTTP |
| `/health/live` | Health check |

MCP over stdio, for an assistant on the same machine: `node src/stdio.mjs`.

Tools: `notes_status`, `notes_options`, `notes_icons`, `notes_hosts`, `notes_guests`, `notes_read`, `notes_prefill`, `notes_new`, `notes_render`, `notes_parse`, `notes_import_legacy`, `notes_prepare_write`, `notes_write_confirmed`, `notes_snapshots`, `notes_snapshot`. Only `notes_write_confirmed` writes to Proxmox, and only with a confirmation from `notes_prepare_write`.

## Development

```bash
npm install
npm run check
```

`npm run check` runs all tests. The tests include a round-trip check: every Note in `reference/examples/` is parsed and rendered again, and the result must be identical. GitHub Actions runs them on every push and pull request.

To release a version:

1. Set the version in `package.json` (the only place it is kept) and run `npm install --package-lock-only`.
2. Add a section `## <version> - <date>` at the top of [HISTORY.md](HISTORY.md).
3. Commit, tag `v<version>` and push with `git push --follow-tags`.

The workflow checks that the tag matches `package.json`, runs the tests, builds and pushes the image, and creates the GitHub release with the text from HISTORY.md.

## Layout

| Path | Content |
|------|---------|
| `src/format/` | The Notes document model: `render.mjs`, `parse.mjs`, `defaults.mjs`, `legacy.mjs` (old generator JSON) |
| `src/server.mjs`, `src/mcp.mjs`, `src/tools.mjs` | HTTP server, MCP server and the tools both use |
| `src/options.mjs`, `src/config.mjs` | Instance options (`/data/options.json`) and environment settings |
| `src/proxmox/` | Targets (`targets.json`), the API client with certificate pinning, and guest facts |
| `src/websets.mjs` | Web icon sets: the icon list from a folder listing, a pack manifest and the image list |
| `src/comfyui.mjs` | Icon generation: the ComfyUI client, the built-in recipe, own workflows and the jobs |
| `src/icons.mjs`, `src/dashboard-icons.mjs` | The icon library (`/data/icons`) and the dashboard-icons search |
| `src/web/` | The web GUI: `app.js`, `settings.js`, `library.js` (icon library and picker), `packs.js` and `zip.js` (icon packs), `preview.js` (Proxmox-like rendering and sanitizing), `icons.js` (embedding within the size limit), `i18n.js` (texts), bundled Font Awesome |
| `test/` | Vitest tests |
| `.github/workflows/ci.yml` | Tests on every push; image and GitHub release on a version tag |
| `reference/examples/` | Eleven real Notes with addresses and names replaced, used as golden test files |
| `reference/select.json` | The old generator's options file (icons, image keys, OS names) |
| `reference/test/` | A Note with an embedded icon, used for the Proxmox display test |
| `docs/NOTES_FORMAT.md` | The format, the Proxmox display rules and the size budget |
| `private/` | Local only, ignored by git: the original hand-over and the real Notes the fixtures were made from |

## Plan

1. ✅ Notes format: document model, render, parse, round-trip tests.
2. ✅ Server: Docker image, configuration, REST API, MCP (HTTP and stdio).
3. ✅ Proxmox: list guests on several hosts, read Notes, prefill from facts, write with preview, digest check and snapshot.
4. ✅ Web GUI: guest list, editor with live preview, icons, JSON export and import, save to Proxmox, history.
5. ✅ Settings page in the web GUI: Proxmox hosts, Notes defaults and template, icons, theme and language. The image generator settings came with icon generation (step 8).
6. ✅ Icons: icon library, upload, dashboard-icons, import of a web icon set, icon picker in the editor.
7. ✅ Release: MIT licence, image on GitHub Container Registry built by GitHub Actions, ready-made Portainer stack.
8. ✅ Icon generation with ComfyUI: built-in recipe (Qwen-Image and RMBG) or an own workflow, styles, up to four images per run.
9. Icon generation with cloud services (Nano Banana, OpenAI, Grok), one at a time.

Open question: the project name (this could become the next major version of `Snille/Proxmox-Notes`).

History: [HISTORY.md](HISTORY.md).

## Licence

MIT, see [LICENSE](LICENSE). The bundled Font Awesome 4.7 has its own licence (font: SIL OFL 1.1, CSS: MIT).
