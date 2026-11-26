# Privacy policy

Proxmox Notes is self-hosted software. You run it on your own server. This policy says
what the software stores, where it sends data, and what the author receives.

## What the author receives

Nothing. The software has no telemetry, no analytics, no crash reporting and no
update check. It never contacts the author or any service run by the author.

## What an instance stores

Everything stays in the instance's data folder (`DATA_DIR`, `/data` in the container):

| File or folder | Content |
|----------------|---------|
| `targets.json` | The Proxmox hosts you add, with their API token IDs and token secrets. Written with file mode 600. Token secrets are never returned by the API or over MCP. |
| `options.json` | Instance options: the Note template, icon sets, image generator settings. |
| `snapshots/` | A copy of a guest's Notes from just before each write, so a write can be undone. Notes can hold host names, IP and MAC addresses, user names and other text you wrote. |
| `icons/` | The icon library: images you upload, copy or make with AI, and the prompts and styles of AI images. |

Nothing is deleted on its own. Delete files in the data folder to remove them.

The web GUI keeps a few choices in your browser (`localStorage`): settings such as
language and theme, the last layout and Proxmox host, the ticked AI styles and where a
new icon is saved. It sets no cookies.

## Where an instance sends data

Only to addresses you configure, plus one public icon source:

- **Your Proxmox hosts:** reads guest lists, configuration and Notes, and writes Notes,
  with the API token you entered.
- **Your ComfyUI hosts** (if you set up the image generator): the prompt for each icon.
- **Your web icon sets** (if you set them up): reads icon images from the URL you gave.
  Sets with a folder are written to that folder on the instance's own disk.
- **cdn.jsdelivr.net** (only when you search or copy an icon from the open
  dashboard-icons set): the icon names you search for. jsDelivr sees the instance's
  IP address. See the [jsDelivr privacy policy](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net).

## MCP and AI assistants

When you connect an AI assistant over MCP, the tools return Notes, guest names, IP and
MAC addresses and other facts from Proxmox to that assistant. The assistant and its
provider then handle that data under their own terms. Connect only assistants you trust
with that information. Writes over MCP need two steps, so the user can check a write
before it happens.

## Logs

The service writes logs to standard output: start-up settings (token secrets are shown
only as "set" or "not set") and errors with the request path. Where the logs go depends
on how you run the container.

## Contact

Questions or problems: open an issue at
https://github.com/Snille/Proxmox-Notes-MCP/issues.
