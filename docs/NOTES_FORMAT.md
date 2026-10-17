# Notes format

This is the reference for the text this service writes into a Proxmox guest's Notes. There are two layouts:

- **table** (the default since 0.5.0): one HTML table, `width="100%"`, with the header inside. It fills the Notes panel and gets Proxmox's alternating row colours.
- **markdown**: the Markdown tables of the original Notes Generator (`notes/script/notes-generator.js` in `Snille/Proxmox-Notes`), with one deliberate addition: `width` and `height` attributes on the icon.

Both are read; a Note is written in the instance's layout (`layout` in `options.json`, or the choice in the web GUI).

## The document model

Every interface (web GUI, REST, MCP, JSON export) works on one JSON document. Markdown is only produced from it (`renderNotes`) or read back into it (`parseNotes`).

```json
{
  "schema": "proxmox-notes/1",
  "headerIcon": "fa-linux",
  "title": "Sonarr Server",
  "image": { "src": "data:image/webp;base64,...", "width": 100, "height": 100 },
  "description": "TV series manager.\nGets indexers from Prowlarr01.",
  "notes": "Installed 2026-10-16 with the community script <b>sonarr</b>.",
  "sections": [
    { "id": "creation", "title": "Creation", "icon": "fa-exclamation-circle fa-fw",
      "rows": [{ "type": "field", "key": "Date", "value": "2026-10-16" }] },
    { "id": "services", "title": "Services", "icon": "fa-cogs",
      "rows": [{ "type": "link", "name": "Sonarr", "url": "http://192.0.2.36:8989" }] }
  ]
}
```

- `description` and `notes` use real newlines. They become `<br>` in the Markdown.
- A row is `field` (`**Key:** value`), `link` (a green service link) or `text` (any other cell content, kept as it is).
- `image` may be `null`. `image.src` is either an `https://` URL or an embedded `data:image/...;base64,` image. `image.key` (for example `sonarr01-`) is kept when the URL follows the icon-set naming, so a form can show which icon is selected.

## The table layout

```
<table width="100%">
<tr><td width="110"><img title="{title}" src="{src}" alt="[Icon]" width="100" height="100"></td><td><h1><i class="fa {headerIcon}"></i> {title}</h1><i class="fa fa-file-text-o"></i> {description}</td></tr>
<tr><td colspan="2"><h3><i class="fa fa-sticky-note-o"></i> Notes:</h3>{notes}</td></tr>
<tr><td><i class="fa fa-exclamation-circle fa-fw"></i> <strong>Creation:</strong></td><td><strong>Date:</strong> 2026-10-17</td></tr>
<tr><td></td><td><strong>Owner:</strong> Jane Doe</td></tr>
<tr><td><i class="fa fa-cogs"></i> <strong>Services:</strong></td><td><a href="http://192.0.2.36:8989" target="_blank" style="text-decoration: none; color: #00f000;">Sonarr</a></td></tr>
</table>
```

Rules:

- One row per line and **no blank line** inside: a blank line ends an HTML block, and Markdown would take over.
- The first column is the icon width plus 10 px, so the section labels line up under the icon.
- Bold is `<strong>`: Proxmox's CSS makes only `<strong>` bold, and Markdown (`**x**`) is not parsed inside an HTML block. `**x**` and `<b>` in text are written as `<strong>`.
- Proxmox's table CSS (`.pmx-md tbody tr:nth-of-type(even)`) applies to every row, so the rows alternate in colour. Tested in Proxmox on 2026-10-17: the table fills the panel and the rows alternate.

## The Markdown layout

```
# <i class="fa {headerIcon}"></i> {title}
| | |
| - | - |
| <img title="{title}" src="{src}" alt="[Icon]" width="100" height="100" style="width:100px;height:100px;"> | <i class="fa fa-file-text-o"></i> {description} |
### <i class="fa fa-sticky-note-o"></i> Notes:
{notes}
| | |
| - | - |
| <i class="fa fa-exclamation-circle fa-fw"></i> **Creation:** | **Date:** 2026-10-17 |
|  | **Owner:** Jane Doe |
| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.36:8989" target="_blank" style="text-decoration: none; color: #00f000;">Sonarr</a> |
```

Rules:

- Only the first row of a section has the icon and the section title in column 1. The other rows have an empty column 1 (`|  |`).
- The Services icon is `fa fa-cogs` without `fa-fw`. The other section icons have `fa-fw`. The icon string is stored per section, so this round-trips.
- The text ends with one newline.
- A `|` inside a table cell is written as `&#124;`, so it cannot split the cell.
- The original generator's default rows are Creation (Date, Owner, OS, Backup), Network (IP, MAC, DHCP, VLAN), Services (WebGUI) and Access (User, SSH Key, Password). Empty rows are left out.

## What Proxmox shows

Checked in the Proxmox source on 2026-10-17 (`proxmox-widget-toolkit` `src/Parser.js`, hardened 2026-05-03) and in the web GUI with an embedded icon:

- The Notes field (`description`) holds at most **8192 characters**, for both LXC and VM.
- The `style` attribute is removed. The green link colour and the `style` width on the icon are lost on new versions. `width`, `height`, `title`, `class`, `href`, `target` and `alt` are kept. This is why the icon also has `width` and `height`.
- `<img src>` may be `http(s)://` or `data:image/png|gif|jpeg|webp|bmp|x-icon`. An embedded raster image works without a web server.
- SVG does not work embedded: the `<svg>` tag is shown as text and `data:image/svg+xml` is blocked. SVG only works from an `http(s)` URL.
- Font Awesome 4 classes work, because `class` is kept.
- `<b>` is not bold: the theme's reset leaves it at normal weight, and only `.pmx-md strong` is set to bold.
- A raw HTML table works. Its `width="100%"` is kept, and the Notes table CSS applies to it as to a Markdown table.

Size budget: a 100×100 icon as WebP is about 3.4 KB as base64. A Note without the icon is 1.3–2.0 KB in the Markdown layout and 1.9–2.6 KB in the table layout. Together that is about 6 KB, which fits; the editor lowers the WebP quality when space is short.

## How Proxmox stores it

- API: `PUT /api2/json/nodes/{node}/lxc/{vmid}/config` (or `/qemu/{vmid}/config`) with `description`. Reading: `GET` on the same path.
- In `/etc/pve/nodes/<node>/lxc/<id>.conf` every line becomes a `#` comment and `:` is stored as `%3A`. Always read through the API, not the file.
- Notes travel with `vzdump` backups and come back on restore.
