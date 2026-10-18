import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { field, LAYOUTS, link, SCHEMA, section } from './format/index.mjs';

// The options of one instance: choices offered in forms, the icon set, and the template for a new Note.
// Stored as <dataDir>/options.json. A select.json from the original generator is converted on first start.

export const DEFAULT_OPTIONS = {
  headerIcons: [
    { label: 'Linux', icon: 'fa-linux' },
    { label: 'Server OS', icon: 'fa-server' },
    { label: 'Desktop', icon: 'fa-desktop' },
    { label: 'Windows', icon: 'fa-windows' },
    { label: 'Apple', icon: 'fa-apple' },
    { label: 'Home Assistant', icon: 'fa-home' },
    { label: 'Tools', icon: 'fa-wrench' },
    { label: 'Chip', icon: 'fa-microchip' },
    { label: 'Clone', icon: 'fa-clone' }
  ],
  // "table" (full-width HTML table) or "markdown" (the original generator's Markdown tables).
  layout: 'table',
  // An icon set on a web server, as in the original generator: <baseUrl>/<key><width>x<height><extension>.
  iconSet: { baseUrl: '', width: 100, height: 100, extension: '.png' },
  // Web icon sets a Note can link to (or copy icons from), each a folder of one size on a web server.
  webSets: [],
  images: [],
  osNames: ['Debian 13', 'Debian 12', 'Ubuntu Server 24.04', 'Ubuntu Server 22.04', 'Windows Server 2025', 'Home Assistant OS'],
  template: {
    headerIcon: 'fa-linux',
    sections: [
      section('creation', [field('Date', ''), field('Owner', ''), field('OS', ''), field('Backup', '')]),
      section('network', [field('IP', ''), field('MAC', ''), field('DHCP', 'No')]),
      section('services', [link('WebGUI', 'https://')]),
      section('access', [field('User', 'root'), field('SSH Key', 'No'), field('Password', 'No')])
    ]
  },
  // Defaults for every viewer; each browser can override them on the settings page.
  appearance: { theme: 'system', language: 'en' },
  // Icon generation with ComfyUI (see comfyui.mjs). The recipe's model names may leave out the
  // folder; the server finds them in the host's lists.
  generator: {
    hosts: [],
    mode: 'recipe',
    count: 4,
    timeoutSeconds: 300,
    recipe: {
      unet: 'qwen_image_2512_fp8_e4m3fn.safetensors',
      lora: 'Wuli-Qwen-Image-2512-Turbo-LoRA-4steps-V1.0-bf16_ComfyUi.safetensors',
      loraStrength: 1,
      clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
      vae: 'qwen_image_vae.safetensors',
      width: 1328,
      height: 1328,
      steps: 4,
      cfg: 1,
      sampler: 'euler',
      scheduler: 'simple',
      shift: 3,
      removeBackground: 'RMBG-2.0'
    },
    workflow: '',
    // Styles are ticked in the dialog; each ticked style adds its text to the prompt, in this
    // order, before what the icon shows. "checked" styles are ticked from the start.
    styles: [
      { name: 'Icon', prompt: 'A high quality icon type picture viewed straight ahead from the front.', checked: true },
      { name: 'Blue frame', prompt: 'The picture has a spotless plain blue metallic frame around it.', checked: true },
      { name: 'Green frame', prompt: 'The picture has a spotless clean new green metallic frame around it.', checked: false },
      { name: 'Empty outside', prompt: 'Outside the frame is emptiness.', checked: true }
    ]
  }
};

const FA_CLASS = z.string().regex(/^fa-[a-z0-9-]+( fa-[a-z0-9-]+)*$/, 'Font Awesome classes such as "fa-linux" or "fa-key fa-fw"');
const HTTP_URL = z.url().refine(v => /^https?:\/\//.test(v), 'http(s) only');
const rowSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field'), key: z.string(), value: z.string() }),
  z.object({ type: z.literal('link'), name: z.string(), url: z.string() }),
  z.object({ type: z.literal('text'), text: z.string() })
]);

export const optionsSchema = z.object({
  headerIcons: z.array(z.object({ label: z.string().min(1), icon: FA_CLASS })),
  layout: z.enum(LAYOUTS),
  iconSet: z.object({
    baseUrl: z.union([z.literal(''), HTTP_URL]),
    width: z.number().int().min(16).max(512),
    height: z.number().int().min(16).max(512),
    extension: z.string().regex(/^\.[a-z0-9]+$/)
  }),
  webSets: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    baseUrl: HTTP_URL,
    width: z.number().int().min(16).max(1024),
    height: z.number().int().min(16).max(1024),
    extension: z.string().regex(/^\.[a-z0-9]+$/)
  })).max(20),
  images: z.array(z.object({ label: z.string().min(1), key: z.string().regex(/^[\w.-]+-$/, 'an icon key ends with "-", for example "sonarr01-"') })),
  osNames: z.array(z.string().min(1)),
  template: z.object({
    headerIcon: FA_CLASS,
    sections: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), icon: FA_CLASS, rows: z.array(rowSchema) }))
  }),
  appearance: z.object({ theme: z.enum(['system', 'dark', 'light']), language: z.enum(['en', 'sv']) }),
  generator: z.object({
    hosts: z.array(HTTP_URL).max(10),
    mode: z.enum(['recipe', 'workflow']),
    count: z.number().int().min(1).max(4),
    timeoutSeconds: z.number().int().min(30).max(1800),
    recipe: z.object({
      unet: z.string().min(1),
      lora: z.string(),
      loraStrength: z.number().min(-5).max(5),
      clip: z.string().min(1),
      vae: z.string().min(1),
      width: z.number().int().min(256).max(2048).multipleOf(16),
      height: z.number().int().min(256).max(2048).multipleOf(16),
      steps: z.number().int().min(1).max(100),
      cfg: z.number().min(0).max(30),
      sampler: z.string().min(1),
      scheduler: z.string().min(1),
      shift: z.number().min(0).max(20),
      removeBackground: z.string()
    }),
    workflow: z.string().max(500_000),
    styles: z.array(z.object({
      name: z.string().trim().min(1).max(40),
      prompt: z.string().trim().min(1).max(2000),
      checked: z.boolean()
    })).max(30).refine(styles => new Set(styles.map(style => style.name)).size === styles.length, 'style names must differ')
  }).refine(generator => generator.mode !== 'workflow' || generator.workflow.includes('{{prompt}}'), 'an own workflow must contain {{prompt}}')
}).strict();

export function fromLegacySelect(selectJson) {
  const cfg = selectJson?.['proxmox-notes'];
  if (!cfg) {
    throw new Error('Not a Notes Generator select.json: expected a "proxmox-notes" object');
  }
  const r = cfg.resources ?? {};
  return {
    ...DEFAULT_OPTIONS,
    headerIcons: Object.entries(cfg.select01 ?? {}).map(([label, value]) => ({
      // The generator's labels start with the Font Awesome glyph itself (a private-use character).
      label: (typeof value === 'object' ? value.text ?? label : String(value)).replace(/[\uE000-\uF8FF]/g, '').trim(),
      icon: typeof value === 'object' ? value['fa-objects'] ?? value.fa ?? value.class ?? label : label
    })),
    iconSet: {
      baseUrl: r['image fqdn'] ?? '',
      width: Number(r['image width'] ?? 100),
      height: Number(r['image height'] ?? 100),
      extension: r.extension ?? '.png'
    },
    images: Object.entries(cfg.select02 ?? {}).map(([label, key]) => ({ label, key })),
    osNames: Object.keys(cfg.select03 ?? {}).length ? Object.keys(cfg.select03) : DEFAULT_OPTIONS.osNames
  };
}

export function iconSetUrl(iconSet, key) {
  if (!iconSet?.baseUrl || !key) {
    return null;
  }
  return `${iconSet.baseUrl.replace(/\/$/, '')}/${key}${iconSet.width}x${iconSet.height}${iconSet.extension ?? '.png'}`;
}

// A new, empty Note built from the instance template. Values given in `fill` replace template values.
export function newDocument(options, fill = {}) {
  const template = options.template ?? DEFAULT_OPTIONS.template;
  return {
    schema: SCHEMA,
    headerIcon: fill.headerIcon ?? template.headerIcon ?? 'fa-linux',
    title: fill.title ?? '',
    image: fill.image ?? null,
    description: fill.description ?? '',
    notes: fill.notes ?? '',
    sections: structuredClone(fill.sections ?? template.sections)
  };
}

// Missing parts (for example appearance or generator, added later) come from the defaults.
export function withDefaults(options) {
  const defaults = structuredClone(DEFAULT_OPTIONS);
  const generator = { ...options.generator };
  // Styles from 0.10.0 before release were whole prompts with {{subject}}; they become the defaults.
  if (generator.styles?.some(style => String(style.prompt).includes('{{subject}}'))) delete generator.styles;
  // Before web sets existed, the one icon set was only for importing; it becomes the first web set.
  // Its width and height were also the library's icon size, so a folder named like "512x512" wins.
  const fromIconSet = iconSet => {
    const folder = iconSet.baseUrl.replace(/\/+$/, '').match(/\/(\d+)x(\d+)$/);
    return {
      name: 'Web',
      baseUrl: iconSet.baseUrl,
      width: folder ? Number(folder[1]) : iconSet.width ?? 100,
      height: folder ? Number(folder[2]) : iconSet.height ?? 100,
      extension: iconSet.extension ?? '.png'
    };
  };
  const webSets = options.webSets ?? (options.iconSet?.baseUrl ? [fromIconSet(options.iconSet)] : defaults.webSets);
  return {
    ...defaults,
    ...options,
    webSets,
    generator: { ...defaults.generator, ...generator, recipe: { ...defaults.generator.recipe, ...generator.recipe } }
  };
}

export class OptionsStore {
  constructor(dataDir) {
    this.file = join(dataDir, 'options.json');
    this.legacyFile = join(dataDir, 'select.json');
    this.dataDir = dataDir;
    this.options = structuredClone(DEFAULT_OPTIONS);
    this.source = 'default';
  }

  static async open(dataDir) {
    const store = new OptionsStore(dataDir);
    await mkdir(dataDir, { recursive: true });
    if (existsSync(store.file)) {
      store.options = withDefaults(JSON.parse(await readFile(store.file, 'utf8')));
      store.source = 'options.json';
    } else if (existsSync(store.legacyFile)) {
      store.options = fromLegacySelect(JSON.parse(await readFile(store.legacyFile, 'utf8')));
      store.source = 'select.json';
    }
    return store;
  }

  get() {
    return this.options;
  }

  async save(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw Object.assign(new Error('Options must be a JSON object'), { statusCode: 400 });
    }
    const parsed = optionsSchema.safeParse(withDefaults(options));
    if (!parsed.success) {
      throw Object.assign(new Error(`Invalid options: ${z.prettifyError(parsed.error)}`), { statusCode: 400 });
    }
    const next = parsed.data;
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
    this.options = next;
    this.source = 'options.json';
    return next;
  }
}
