import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { field, link, SCHEMA, section } from './format/index.mjs';

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
  }
};

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
      label: (typeof value === 'object' ? value.text ?? label : String(value)).replace(/[-]/g, '').trim(),
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
      store.options = { ...structuredClone(DEFAULT_OPTIONS), ...JSON.parse(await readFile(store.file, 'utf8')) };
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
    const next = { ...structuredClone(DEFAULT_OPTIONS), ...options };
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
    this.options = next;
    this.source = 'options.json';
    return next;
  }
}
