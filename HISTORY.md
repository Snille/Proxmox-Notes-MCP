# History

## 0.1.0 - 2026-10-17

- Start of the project. It becomes a self-hosted service (own Docker container, one independent instance per site) with a web GUI, REST and MCP, and it replaces the browser-only Proxmox Notes Generator. It was first planned as tools inside the Infrastructure Gateway; it was moved out so that anyone can run their own instance and so it can be published.
- The Notes document model: one JSON document per Note, `renderNotes()` to Markdown and `parseNotes()` back. Output matches the original generator, with one addition: `width` and `height` on the icon, because Proxmox removes the `style` attribute since its sanitizer was hardened on 2026-05-03.
- Icons are embedded as `data:` images by default. Tested in the Proxmox web GUI: an embedded WebP icon shows correctly, and a full Note with the icon is 5.8 KB of the 8192-character limit. SVG cannot be embedded; Proxmox blocks it.
- Import of JSON files saved by the old Notes Generator.
- Round-trip tests against the eleven real Notes in `reference/examples/` (real Notes with addresses and names replaced).
