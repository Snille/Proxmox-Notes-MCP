# Proxmox Notes

A self-hosted service that creates, reads and edits the Notes (description) of Proxmox LXC containers and VMs. It has a web GUI, a REST API and an MCP server, and it replaces the browser-only [Proxmox Notes Generator](https://github.com/Snille/Proxmox-Notes).

Status: **0.3.0, early development.** The Notes format, the server (REST, MCP, Docker) and reading from Proxmox work. Writing to Proxmox, the real web GUI and the icon tools are not built yet; the web page is only a test page for now.

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
| Publishing | Public GitHub repository | Others can use it. Nothing site-specific may be in the code or the repository; it goes in configuration. |
| Icons | Embedded as WebP (`data:` URI) by default, URL as an option | Proxmox shows embedded raster images (tested 2026-10-17). SVG cannot be embedded. See [docs/NOTES_FORMAT.md](docs/NOTES_FORMAT.md). |
| Language | Node.js 22+, plain ES modules, Vitest | Same stack as the original generator logic, so it ports directly. |
| Data model | One JSON document per Note | The web GUI, REST, MCP and JSON export all use the same model; Markdown is rendered from it. |
| Writes | Preview first; the old Note is saved as a snapshot before every write | A write overwrites the old text in Proxmox. The snapshot makes it reversible. |
| Login | None in the service; put it behind a reverse proxy with authentication (for example Authelia) | One less thing to build and maintain; the proxy already does it well. |

## Connect a Proxmox host

Each Proxmox host gets its own user and API token. Run this on the Proxmox host as root. It creates a role that may only read, a user that cannot log in, and a token:

```bash
pveum role add ProxmoxNotesReader -privs VM.Audit
pveum user add proxmox-notes@pve -comment 'Proxmox Notes service'
pveum acl modify /vms -user proxmox-notes@pve -role ProxmoxNotesReader
pveum user token add proxmox-notes@pve notes -privsep 1 -comment 'Proxmox Notes service'
pveum acl modify /vms -token 'proxmox-notes@pve!notes' -role ProxmoxNotesReader
```

`pveum user token add` shows the token secret once. Save it in a file, for example as a Docker secret. The token has privilege separation (`-privsep 1`), so it needs its own ACL as well as the user's.

| Privilege | Needed for |
|-----------|-----------|
| `VM.Audit` | List guests and read their config and Notes (enough for now) |
| `VM.Config.Options` | Write the Notes (`description`); added when writing is built |

Then list the host in `/data/targets.json` (see [targets.example.json](targets.example.json)):

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

## Run it

With Docker Compose or as a Portainer stack, using [compose.yaml](compose.yaml):

```bash
docker compose up -d
```

Then open `http://<host>:8080/`. The container keeps its data (options, later snapshots and icons) in the volume mounted at `/data`.

The published image is not set up yet (step 7). Until then, build it locally with [compose.dev.yaml](compose.dev.yaml), which serves on port 8085. It mounts `DEV_DATA_DIR` (default `private/dev-data`) at `/data` and `DEV_SECRETS_DIR` (default `private/secrets`) read-only at `/run/secrets/proxmox-notes`:

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

The choices in the forms (heading icons, icon-set images, OS names and the template for a new Note) are kept in `/data/options.json`. On the first start, a `select.json` from the old Notes Generator in `/data` is converted automatically. Read and save them with `GET` and `PUT /api/options`.

### Interfaces

| Path | What |
|------|------|
| `/` | Web GUI (a test page for now) |
| `/api/tools/{name}` | REST: `POST` a tool's arguments as JSON |
| `/api/options` | `GET` or `PUT` the options |
| `/mcp` | MCP over Streamable HTTP |
| `/health/live` | Health check |

MCP over stdio, for an assistant on the same machine: `node src/stdio.mjs`.

Tools: `notes_status`, `notes_options`, `notes_hosts`, `notes_guests`, `notes_read`, `notes_prefill`, `notes_new`, `notes_render`, `notes_parse`, `notes_import_legacy`. None of them write to Proxmox yet.

## Development

```bash
npm install
npm run check
```

`npm run check` runs all tests. The tests include a round-trip check: every Note in `reference/examples/` is parsed and rendered again, and the result must be identical.

## Layout

| Path | Content |
|------|---------|
| `src/format/` | The Notes document model: `render.mjs`, `parse.mjs`, `defaults.mjs`, `legacy.mjs` (old generator JSON) |
| `src/server.mjs`, `src/mcp.mjs`, `src/tools.mjs` | HTTP server, MCP server and the tools both use |
| `src/options.mjs`, `src/config.mjs` | Instance options (`/data/options.json`) and environment settings |
| `src/proxmox/` | Targets (`targets.json`), the API client with certificate pinning, and guest facts |
| `src/web/` | The web page |
| `test/` | Vitest tests |
| `reference/examples/` | Eleven real Notes with addresses and names replaced, used as golden test files |
| `reference/select.json` | The old generator's options file (icons, image keys, OS names) |
| `reference/test/` | A Note with an embedded icon, used for the Proxmox display test |
| `docs/NOTES_FORMAT.md` | The format, the Proxmox display rules and the size budget |
| `private/` | Local only, ignored by git: the original hand-over and the real Notes the fixtures were made from |

## Plan

1. ✅ Notes format: document model, render, parse, round-trip tests.
2. ✅ Server: Docker image, configuration, REST API, MCP (HTTP and stdio).
3. Proxmox: ✅ list guests on several hosts, read Notes, prefill from facts. Next: write with preview and snapshot.
4. Web GUI: guest list, editor with live preview, save to Proxmox, JSON export and import, options editor (replaces `select.json`).
5. Icons: icon library, embed from file or URL, dashboard-icons.
6. Icon generation: ComfyUI first, then the cloud services one at a time.
7. Release: licence, container image built by GitHub Actions, ready-made Portainer stack.

Open questions: the project name (this could become the next major version of `Snille/Proxmox-Notes`), and where the image is published (GitHub Container Registry or Docker Hub).

History: [HISTORY.md](HISTORY.md).
