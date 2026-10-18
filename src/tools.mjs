import { randomBytes } from 'node:crypto';
import * as z from 'zod';
import { DEFAULT_LAYOUT, fromLegacyJson, LAYOUTS, noteImages, parseNotes, PROXMOX_DESCRIPTION_LIMIT, renderNotes, SCHEMA } from './format/index.mjs';
import { newDocument } from './options.mjs';
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

// Proxmox may store the text without the final newline; compare without trailing whitespace.
const sameText = (a, b) => String(a ?? '').replace(/\r\n?/g, '\n').trimEnd() === String(b ?? '').replace(/\r\n?/g, '\n').trimEnd();

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

function log(event) {
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), ...event }));
}

const iconSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional().describe('Icon id from notes_icons');

export function buildTools({ options, proxmox, snapshots, icons }) {
  // An icon from the library as an embedded image, the same way the web editor embeds it.
  const libraryImage = async id => {
    if (!id) return null;
    if (!icons) throw Object.assign(new Error('There is no icon library in this setup'), { statusCode: 400 });
    const { icon, src } = await icons.dataUri(id);
    const { width, height } = options.get().iconSet;
    return { src, width: icon.width ?? width, height: icon.height ?? height, key: icon.id };
  };

  // Renders a document. When it is too long and its image is an embedded library icon, the largest
  // smaller copy of that icon that makes it fit is put in, as the web editor would encode the icon
  // again (the server cannot encode images). icon tells what happened, or why nothing could be done.
  const renderFitted = async (doc, layout) => {
    const markdown = renderNotes(doc, { layout });
    const image = doc.image;
    if (markdown.length <= PROXMOX_DESCRIPTION_LIMIT || !icons || !image?.key || !image.src?.startsWith('data:')) {
      return { doc, markdown, icon: null };
    }
    const encodings = await icons.encodings(image.key).catch(() => null);
    if (!encodings?.some(encoding => encoding.src === image.src)) return { doc, markdown, icon: null };
    const smaller = encodings.filter(encoding => encoding.src.length < image.src.length);
    for (const encoding of smaller) {
      const fitted = { ...doc, image: { ...image, src: encoding.src } };
      const text = renderNotes(fitted, { layout });
      if (text.length <= PROXMOX_DESCRIPTION_LIMIT) {
        return {
          doc: fitted,
          markdown: text,
          icon: {
            id: image.key,
            swapped: true,
            quality: encoding.quality,
            imageLength: encoding.src.length,
            message: `The Note was ${markdown.length} characters, so the icon "${image.key}" was put in at a lower quality${encoding.quality ? ` (${Math.round(encoding.quality * 100)})` : ''}: ${image.src.length} → ${encoding.src.length} characters.`
          }
        };
      }
    }
    const message = smaller.length
      ? `Even the smallest copy of the icon "${image.key}" (${smaller.at(-1).src.length} characters) does not make it fit; shorten the text.`
      : `The icon "${image.key}" has no smaller copy to put in (icons added before 0.14.0 have none). Add it to the library again in the web GUI (for example upload it with "Replace icons with the same name"), open the Note in the web editor, or shorten the text.`;
    return { doc, markdown, icon: { id: image.key, swapped: false, message } };
  };

  // Single-use confirmations from notes_prepare_write, kept in memory only.
  const confirmations = new Map();
  const takeConfirmation = id => {
    const now = Date.now();
    for (const [key, value] of confirmations) {
      if (value.expiresAt < now) confirmations.delete(key);
    }
    const found = confirmations.get(id);
    confirmations.delete(id);
    return found ?? null;
  };

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
      description: 'Create a new Note document from the instance template, optionally with an icon from the library (see notes_icons), embedded in the Note. Nothing is written to Proxmox.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        title: z.string().default(''),
        headerIcon: z.string().optional(),
        icon: iconSchema
      }).strict(),
      handler: async ({ title, headerIcon, icon }) => ({
        doc: newDocument(options.get(), { title, headerIcon, image: await libraryImage(icon) })
      })
    },
    {
      name: 'notes_icons',
      title: 'Icon library',
      description: 'List the icons in the library (id and name). Pass an id as "icon" to notes_new or notes_prefill to embed it in a Note.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ search: z.string().optional() }).strict(),
      handler: async ({ search }) => {
        const words = String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const list = (icons?.list() ?? [])
          .filter(icon => words.every(word => `${icon.id} ${icon.label}`.toLowerCase().includes(word)))
          .map(icon => ({ id: icon.id, label: icon.label }));
        return { icons: list };
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
      description: 'List the LXC containers and VMs on one Proxmox host that the token can see. With notes=true, also tell for each guest whether its Notes are empty, in the Notes format, or other text, and which images they have (images.linked: web server hosts the Note links to; images.embedded: an embedded image).',
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
              guest.images = noteImages(markdown);
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
      description: 'Create a new Note document for one guest from the instance template, filled with what Proxmox knows (title, IP, MAC, DHCP, OS, and today as the date), optionally with an icon from the library. Nothing is written to Proxmox.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({ host: hostSchema, vmid: vmidSchema, icon: iconSchema }).strict(),
      handler: async ({ host, vmid, icon }) => {
        const { guest, facts } = await readGuest(proxmox, host, vmid);
        const doc = applyFacts(newDocument(options.get(), { image: await libraryImage(icon) }), facts);
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
      name: 'notes_prepare_write',
      title: 'Prepare writing a Note',
      description: 'Step 1 of 2 for writing Notes to a guest. Give the new Notes as a document (rendered in the instance layout unless layout is set) or as raw Markdown. When a document is too long and its image is an embedded library icon, the largest smaller copy of the icon that makes it fit is put in, and "icon" says so. Returns the current and the new text, whether anything changes, the size check, and a single-use confirmation that is valid for 10 minutes. Nothing is written. Show the change to the user and get explicit approval before calling notes_write_confirmed.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        host: hostSchema,
        vmid: vmidSchema,
        doc: documentSchema.optional(),
        layout: layoutSchema,
        markdown: z.string().optional().describe('Raw Notes text, used instead of doc')
      }).strict().refine(a => (a.doc ? 1 : 0) + (a.markdown !== undefined ? 1 : 0) === 1, 'Give either doc or markdown'),
      handler: async ({ host, vmid, doc, layout, markdown }) => {
        const fitted = doc ? await renderFitted(doc, layout ?? options.get().layout ?? DEFAULT_LAYOUT) : null;
        const next = fitted ? fitted.markdown : markdown;
        if (next.length > PROXMOX_DESCRIPTION_LIMIT) {
          const hint = fitted?.icon ? ` ${fitted.icon.message}` : '';
          throw Object.assign(new Error(`The Notes are ${next.length} characters; Proxmox allows ${PROXMOX_DESCRIPTION_LIMIT}.${hint}`), { statusCode: 400 });
        }
        const client = proxmox.client(host);
        const guest = await client.guest(vmid);
        const config = await client.config(guest);
        const current = config.description ?? '';
        const changed = !sameText(current, next);
        let confirmation = null;
        let expiresAt = null;
        if (changed) {
          confirmation = randomBytes(16).toString('hex');
          expiresAt = Date.now() + CONFIRMATION_TTL_MS;
          confirmations.set(confirmation, { host, vmid: guest.vmid, next, digest: config.digest, expiresAt });
        }
        return {
          host,
          guest,
          changed,
          current,
          next,
          length: next.length,
          limit: PROXMOX_DESCRIPTION_LIMIT,
          ...(fitted?.icon ? { icon: fitted.icon } : {}),
          confirmation,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
        };
      }
    },
    {
      name: 'notes_write_confirmed',
      title: 'Write a Note',
      description: 'Step 2 of 2: write the Notes prepared by notes_prepare_write, after the user approved them. The current Notes are saved as a snapshot first. Fails, and writes nothing, if the guest config changed since the preview.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({ confirmation: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
      handler: async ({ confirmation }) => {
        const pending = takeConfirmation(confirmation);
        if (!pending) {
          throw Object.assign(new Error('Unknown, used or expired confirmation; prepare the write again'), { statusCode: 409 });
        }
        const client = proxmox.client(pending.host);
        const guest = await client.guest(pending.vmid);
        const config = await client.config(guest);
        if (config.digest !== pending.digest) {
          throw Object.assign(new Error('The guest config changed since the preview; nothing was written. Prepare the write again.'), { statusCode: 409 });
        }
        const snapshot = await snapshots.save({
          host: pending.host,
          vmid: guest.vmid,
          name: guest.name,
          description: config.description ?? '',
          digest: config.digest,
          reason: 'before write'
        });
        await client.setDescription(guest, pending.next, pending.digest);
        const stored = (await client.config(guest)).description ?? '';
        const verified = sameText(stored, pending.next);
        log({ message: 'notes written', host: pending.host, vmid: guest.vmid, length: pending.next.length, snapshot: snapshot.id, verified });
        if (!verified) {
          throw Object.assign(new Error(`Proxmox accepted the write, but the stored Notes differ from what was sent. The previous Notes are in snapshot ${snapshot.id}.`), { statusCode: 502 });
        }
        return { written: true, host: pending.host, vmid: guest.vmid, length: pending.next.length, snapshot: snapshot.id };
      }
    },
    {
      name: 'notes_snapshots',
      title: 'Snapshots of a guest\'s Notes',
      description: 'List the snapshots kept for one guest, newest first. A snapshot is the Notes as they were just before a write.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ host: hostSchema, vmid: vmidSchema }).strict(),
      handler: async ({ host, vmid }) => ({ host, vmid, snapshots: await snapshots.list(host, vmid) })
    },
    {
      name: 'notes_snapshot',
      title: 'Read a snapshot',
      description: 'Read one snapshot: the Notes text and the parsed document. To restore it, pass its text to notes_prepare_write as markdown.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ host: hostSchema, vmid: vmidSchema, id: z.string() }).strict(),
      handler: async ({ host, vmid, id }) => {
        const snapshot = await snapshots.read(host, vmid, id);
        return { ...snapshot, parsed: snapshot.description.trim() ? parseNotes(snapshot.description) : null };
      }
    },
    {
      name: 'notes_render',
      title: 'Render a Note',
      description: 'Turn a Note document into the Markdown Proxmox shows, and check it against the 8192-character limit. When the Note is too long and its image is an embedded library icon, a smaller copy of the icon is put in when that makes it fit, as notes_prepare_write does; "icon" then says so and "doc" is the changed document. Nothing is written to Proxmox.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ doc: documentSchema, layout: layoutSchema }).strict(),
      handler: async ({ doc, layout }) => {
        const chosen = layout ?? options.get().layout ?? DEFAULT_LAYOUT;
        const fitted = await renderFitted(doc, chosen);
        if (!fitted.icon) return rendered(doc, chosen);
        return { ...rendered(fitted.doc, chosen), icon: fitted.icon, ...(fitted.icon.swapped ? { doc: fitted.doc } : {}) };
      }
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
