// Web icon sets: folders of images on a web server, as the old Notes Generator used them
// (<baseUrl>/<key><width>x<height><extension>, for example …/blue/100x100/sonarr01-100x100.png).
// A Note can link to such an image, or the image can be copied into the library and embedded.
//
// Which icons a set has comes from three places, merged: the folder's file listing when the web
// server shows one, a proxmox-notes-icons.json (an unpacked icon pack) in the folder or the one
// above it, and the image list in the settings ("Label = key", from the old select.json).

import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drawFile } from './imaging.mjs';
import { iconSetUrl } from './options.mjs';

const MANIFEST = 'proxmox-notes-icons.json';
const CACHE_MS = 5 * 60_000;
const MAX_ICONS = 5000;
const MAX_LISTING_BYTES = 2_000_000;

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "sonarr01-" -> "Sonarr 01"
export function labelFromKey(key) {
  const words = key.replace(/-+$/, '').replace(/[_-]+/g, ' ').replace(/([a-z])(\d+)$/i, '$1 $2').trim();
  return words ? words.replace(/\b\w/g, c => c.toUpperCase()) : key;
}

/** The keys of the set's images named in an HTML file listing. */
export function keysFromListing(html, set) {
  const file = new RegExp(`^(.+-)${set.width}x${set.height}${escapeRegExp(set.extension)}$`, 'i');
  const keys = new Set();
  for (const [, href] of String(html).matchAll(/href\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
    let name;
    try {
      name = decodeURIComponent(href.split('/').pop());
    } catch {
      continue;
    }
    const match = name.match(file);
    if (match && /^[\w.-]+-$/.test(match[1])) keys.add(match[1]);
    if (keys.size >= MAX_ICONS) break;
  }
  return [...keys];
}

/** The keys and names in an icon-pack manifest ({ icons: [{ label, key }] }). */
export function keysFromManifest(manifest) {
  return (Array.isArray(manifest?.icons) ? manifest.icons : [])
    .filter(icon => typeof icon.key === 'string' && /^[\w.-]+$/.test(icon.key))
    .slice(0, MAX_ICONS)
    .map(icon => ({ key: icon.key.endsWith('-') ? icon.key : `${icon.key}-`, label: String(icon.label ?? '').slice(0, 80) }));
}

async function fetchText(url, maxBytes) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return null;
  const text = await response.text();
  return text.length > maxBytes ? null : { text, type: response.headers.get('content-type') ?? '' };
}

export class WebSets {
  constructor({ options }) {
    this.options = options;
    this.cache = new Map();
  }

  set(index) {
    const set = this.options.get().webSets[Number(index)];
    if (!set) throw Object.assign(new Error('There is no web icon set with that number'), { statusCode: 404 });
    return set;
  }

  /** The icons of set number `index`: [{ key, label, url }], plus which sources answered. */
  async icons(index, { refresh = false } = {}) {
    return this.iconsOf(this.set(index), { refresh });
  }

  /** The same for a set given directly, for example one not saved yet. */
  async iconsOf(set, { refresh = false } = {}) {
    const cacheKey = JSON.stringify(set);
    const cached = this.cache.get(cacheKey);
    if (cached && !refresh && Date.now() - cached.at < CACHE_MS) return cached.result;

    const base = set.baseUrl.replace(/\/+$/, '');
    const found = new Map();
    const sources = [];
    const listing = await fetchText(`${base}/`, MAX_LISTING_BYTES);
    if (listing?.type.includes('html')) {
      const keys = keysFromListing(listing.text, set);
      if (keys.length) sources.push('listing');
      for (const key of keys) found.set(key, '');
    }
    for (const url of [`${base}/${MANIFEST}`, `${base.replace(/\/[^/]*$/, '')}/${MANIFEST}`]) {
      const manifest = await fetchText(url, MAX_LISTING_BYTES);
      if (!manifest) continue;
      try {
        const entries = keysFromManifest(JSON.parse(manifest.text));
        if (entries.length) sources.push('manifest');
        for (const { key, label } of entries) found.set(key, found.get(key) || label);
      } catch {
        // Not a manifest; ignore it.
      }
      break;
    }
    const images = this.options.get().images ?? [];
    if (images.length) sources.push('list');
    for (const image of images) found.set(image.key, image.label);

    const icons = [...found].slice(0, MAX_ICONS).map(([key, label]) => ({
      key,
      label: images.find(image => image.key === key)?.label || label || labelFromKey(key),
      url: iconSetUrl(set, key)
    })).sort((a, b) => a.label.localeCompare(b.label));
    const result = { icons, sources, size: { width: set.width, height: set.height } };
    this.cache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  /**
   * Writes an image into set number `index`, drawn at the set's size, as
   * <folder>/<key><width>x<height><extension>. An existing file is only replaced with `replace`.
   */
  async write(index, { key, image, replace = false }) {
    const set = this.set(index);
    if (!set.folder) throw Object.assign(new Error(`The web set ${set.name} has no folder to write to`), { statusCode: 400 });
    const fileKey = String(key ?? '').trim().replace(/-*$/, '-');
    if (!/^\w[\w.-]*-$/.test(fileKey)) throw Object.assign(new Error('A file name (key) has only letters, digits, ".", "_" and "-", for example prowlarr01'), { statusCode: 400 });
    const name = `${fileKey}${set.width}x${set.height}${set.extension}`;
    const file = join(set.folder, name);
    if (!replace && await access(file).then(() => true, () => false)) {
      throw Object.assign(new Error(`${name} is already in ${set.name}`), { statusCode: 409, exists: name });
    }
    const data = await drawFile(Buffer.from(String(image ?? ''), 'base64'), set, set.extension);
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(set.folder, { recursive: true });
      await writeFile(temporary, data);
      await rename(temporary, file);
    } catch (error) {
      // Usually the folder is not mounted, or the service may not write there.
      throw Object.assign(new Error(`Cannot write to ${set.folder} (${error.code ?? error.message})`), { statusCode: 422 });
    }
    this.cache.clear();
    return { set: set.name, key: fileKey, file: name, url: iconSetUrl(set, fileKey), width: set.width, height: set.height };
  }
}
