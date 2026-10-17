# History

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
