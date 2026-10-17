import * as z from 'zod';
import { DEFAULT_LAYOUT, fromLegacyJson, LAYOUTS, parseNotes, PROXMOX_DESCRIPTION_LIMIT, renderNotes, SCHEMA } from './format/index.mjs';
import { iconSetUrl, newDocument } from './options.mjs';
import { applyFacts, guestFacts } from './proxmox/facts.mjs';
import { version } from './version.mjs';

const rowSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field'), key: z.string(), value: z.string() }),
  z.object({ type: z.literal('link'), name: z.string(), url: z.string() }),
  z.object({ type: z.literal('text'), text: z.string() })
]);

const imageSchema = z.object({
  src: z.string().min(1).describe('An https:// URL or an embedded data:image/...;base64, image'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  key: z.string().optional().describe('Icon-set key, for example "sonarr01-"'),
  title: z.string().optional(),
  alt: z.string().optional()
});

export const documentSchema = z.object({
  schema: z.literal(SCHEMA).default(SCHEMA),
  headerIcon: z.string().describe('Font Awesome 4 class for the heading, for example "fa-linux"'),
  title: z.string(),
  image: imageSchema.nullable().default(null),
  description: z.string().default('').describe('Short description; real newlines'),
  notes: z.string().default('').describe('Free text; real newlines; simple HTML such as <b> is allowed'),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    icon: z.string().describe('Font Awesome classes, for example "fa-sitemap fa-fw"'),
    rows: z.array(rowSchema)
  }))
});

const layoutSchema = z.enum(LAYOUTS).optional()
  .describe('"table" (full-width HTML table, the default) or "markdown" (the Markdown tables of the original generator)');

function rendered(doc, layout) {
  const markdown = renderNotes(doc, { layout });
  return {
    layout,
    markdown,
    length: markdown.length,
    limit: PROXMOX_DESCRIPTION_LIMIT,
    fits: markdown.length <= PROXMOX_DESCRIPTION_LIMIT
  };
}

const hostSchema = z.string().describe('Proxmox host id from notes_hosts');
const vmidSchema = z.coerce.number().int().positive().describe('Guest id (VMID)');

async function mapLimit(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function readGuest(proxmox, host, vmid) {
  const client = proxmox.client(host);
  const guest = await client.guest(vmid);
  const config = await client.config(guest);
  const facts = guestFacts(guest, config, await client.lxcInterfaces(guest));
  return { guest, config, facts };
}

export function buildTools({ options, proxmox }) {
  return [
    {
      name: 'notes_status',
      title: 'Service status',
      description: 'Show the service version and where its options come from.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({}).strict(),
      handler: async () => ({
        service: 'proxmox-notes',
        version,
        optionsSource: options.source,
        proxmoxHosts: proxmox.hosts().length,
        transports: { mcp: '/mcp', rest: '/api/tools/{name}' }
      })
    },
    {
      name: 'notes_options',
      title: 'Form options',
      description: 'Return the choices for a Note: heading icons, icon-set images, OS names and the template for a new Note.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({}).strict(),
      handler: async () => options.get()
    },
    {
      name: 'notes_new',
      title: 'New Note',
      description: 'Create a new Note document from the instance template. Optionally pick an icon-set image by key. Nothing is written to Proxmox.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        title: z.string().default(''),
        headerIcon: z.string().optional(),
        imageKey: z.string().optional().describe('Icon-set key from notes_options images, for example "sonarr01-"')
      }).strict(),
      handler: async ({ title, headerIcon, imageKey }) => {
        const current = options.get();
        const src = iconSetUrl(current.iconSet, imageKey);
        if (imageKey && !src) {
          throw new Error('No icon set is configured, so an image key cannot be used');
        }
        const image = src ? { src, width: current.iconSet.width, height: current.iconSet.height, key: imageKey } : null;
        return { doc: newDocument(current, { title, headerIcon, image }) };
      }
    },
    {
      name: 'notes_hosts',
      title: 'Proxmox hosts',
      description: 'List the Proxmox hosts this instance manages. Token secrets are never shown.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({}).strict(),
      handler: async () => ({ hosts: proxmox.hosts() })
    },
    {
      name: 'notes_guests',
      title: 'Guests on a host',
      description: 'List the LXC containers and VMs on one Proxmox host that the token can see. With notes=true, also tell for each guest whether its Notes are empty, in the Notes format, or other text.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({ host: hostSchema, notes: z.boolean().default(false) }).strict(),
      handler: async ({ host, notes }) => {
        const client = proxmox.client(host);
        const guests = await client.guests();
        if (notes) {
          // One config read per guest, a few at a time, so a large host is not flooded.
          await mapLimit(guests, 4, async guest => {
            try {
              const markdown = (await client.config(guest)).description ?? '';
              const parsed = markdown.trim() ? parseNotes(markdown) : null;
              guest.notes = !parsed ? 'empty' : parsed.ok ? 'format' : 'other';
              guest.noteTitle = parsed?.ok ? parsed.doc.title : '';
            } catch (error) {
              guest.notes = 'error';
              guest.noteError = error.message;
            }
          });
        }
        return { host, guests };
      }
    },
    {
      name: 'notes_read',
      title: "Read a guest's Note",
      description: 'Read the current Notes of one guest: the Markdown, the parsed document (or why it does not follow the format), and the facts Proxmox knows (hostname, IP, MAC, DHCP, OS).',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({ host: hostSchema, vmid: vmidSchema }).strict(),
      handler: async ({ host, vmid }) => {
        const { guest, config, facts } = await readGuest(proxmox, host, vmid);
        const markdown = config.description ?? '';
        return { host, guest, facts, markdown, empty: markdown.trim() === '', parsed: markdown.trim() ? parseNotes(markdown) : null };
      }
    },
    {
      name: 'notes_prefill',
      title: 'New Note from a guest',
      description: 'Create a new Note document for one guest from the instance template, filled with what Proxmox knows (title, IP, MAC, DHCP, OS, and today as the date). Nothing is written to Proxmox.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({ host: hostSchema, vmid: vmidSchema }).strict(),
      handler: async ({ host, vmid }) => {
        const { guest, facts } = await readGuest(proxmox, host, vmid);
        const doc = applyFacts(newDocument(options.get()), facts);
        const today = new Date().toISOString().slice(0, 10);
        for (const row of doc.sections.flatMap(s => s.rows)) {
          if (row.type === 'field' && row.key === 'Date' && !row.value) {
            row.value = today;
          }
        }
        return { host, guest, facts, doc };
      }
    },
    {
      name: 'notes_render',
      title: 'Render a Note',
      description: 'Turn a Note document into the Markdown Proxmox shows, and check it against the 8192-character limit. Nothing is written to Proxmox.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ doc: documentSchema, layout: layoutSchema }).strict(),
      handler: async ({ doc, layout }) => rendered(doc, layout ?? options.get().layout ?? DEFAULT_LAYOUT)
    },
    {
      name: 'notes_parse',
      title: 'Parse a Note',
      description: 'Read Notes Markdown into a Note document. Returns ok=false with the line number when the text does not follow the format; the text is then best edited as raw text.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ markdown: z.string() }).strict(),
      handler: async ({ markdown }) => parseNotes(markdown)
    },
    {
      name: 'notes_import_legacy',
      title: 'Import a Notes Generator file',
      description: 'Convert a JSON file saved by the original Proxmox Notes Generator into a Note document.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ saved: z.record(z.string(), z.unknown()) }).strict(),
      handler: async ({ saved }) => {
        const { iconSet } = options.get();
        const doc = fromLegacyJson(saved, { imageFqdn: iconSet.baseUrl, imageWidth: iconSet.width, imageHeight: iconSet.height });
        return { doc, ...rendered(doc, options.get().layout ?? DEFAULT_LAYOUT) };
      }
    }
  ];
}

export async function executeTool(tool, rawArgs) {
  const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const error = new Error(`Invalid arguments: ${z.prettifyError(parsed.error)}`);
    error.statusCode = 400;
    throw error;
  }
  return tool.handler(parsed.data);
}
