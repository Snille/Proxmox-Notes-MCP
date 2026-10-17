# Proxmox Notes

A self-hosted service that creates, reads and edits the Notes (description) of Proxmox LXC containers and VMs. It has a web GUI, a REST API and an MCP server, and it replaces the browser-only [Proxmox Notes Generator](https://github.com/Snille/Proxmox-Notes).

Status: **0.1.0, early development.** The Notes format (render and parse) is done and tested. The server, the Proxmox connection, the web GUI and the icon tools are not built yet.

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
| Publishing | Public GitHub repository later | Others can use it. Nothing site-specific may be in the code; it goes in configuration. |
| Icons | Embedded as WebP (`data:` URI) by default, URL as an option | Proxmox shows embedded raster images (tested 2026-10-17). SVG cannot be embedded. See [docs/NOTES_FORMAT.md](docs/NOTES_FORMAT.md). |
| Language | Node.js 22+, plain ES modules, Vitest | Same stack as the original generator logic, so it ports directly. |
| Data model | One JSON document per Note | The web GUI, REST, MCP and JSON export all use the same model; Markdown is rendered from it. |
| Writes | Preview first; the old Note is saved as a snapshot before every write | A write overwrites the old text in Proxmox. The snapshot makes it reversible. |

## Proxmox permissions

Each Proxmox host gets its own API token, stored in this service's configuration. The smallest role this needs:

| Privilege | Needed for |
|-----------|-----------|
| `VM.Audit` | List guests and read their config and Notes |
| `VM.Config.Options` | Write the Notes (`description`) |

A read-only instance needs only `VM.Audit`. The exact role, and what the OS prefill needs (the QEMU guest agent for VMs; LXC has no exec API), will be verified when the Proxmox connection is built.

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
| `test/` | Vitest tests |
| `reference/examples/` | Eleven real Notes with addresses and names replaced, used as golden test files |
| `reference/select.json` | The old generator's options file (icons, image keys, OS names) |
| `reference/test/` | A Note with an embedded icon, used for the Proxmox display test |
| `docs/NOTES_FORMAT.md` | The format, the Proxmox display rules and the size budget |
| `private/` | Local only, ignored by git: the original hand-over and the real Notes the fixtures were made from |

## Plan

1. ✅ Notes format: document model, render, parse, round-trip tests.
2. Server: Docker image, configuration, REST API, MCP (HTTP and stdio), login for the web GUI.
3. Proxmox: list guests on several hosts, read Notes, write with preview and snapshot.
4. Web GUI: guest list, editor with live preview, save to Proxmox, JSON export and import, options editor (replaces `select.json`).
5. Icons: icon library, embed from file or URL, dashboard-icons.
6. Icon generation: ComfyUI first, then the cloud services one at a time.
7. Release: licence, public README, container image.

Open questions: the project and repository name (this could become the next major version of `Snille/Proxmox-Notes`), and how the web GUI login works (local users, or behind a reverse proxy).

History: [HISTORY.md](HISTORY.md).
