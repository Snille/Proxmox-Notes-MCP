import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The icon library: <dataDir>/icons/<id>.webp is the icon ready to embed (drawn by the browser at
// the instance's icon size), <id>.v<n>.webp the same icon at lower qualities (for Notes with little
// room left), <id>.orig.<ext> the uploaded original, index.json the names.
// The server never decodes images; it only checks file signatures, so no image library is needed.

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_ICON_BYTES = 200_000;
const MAX_ORIGINAL_BYTES = 8_000_000;
const MAX_VARIANTS = 4;

const validQuality = value => (typeof value === 'number' && value > 0 && value <= 1 ? value : null);

const SIGNATURES = [
  { type: 'image/png', ext: 'png', test: b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { type: 'image/jpeg', ext: 'jpg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', ext: 'gif', test: b => b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8' },
  { type: 'image/webp', ext: 'webp', test: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
];

export function imageType(buffer) {
  return SIGNATURES.find(signature => signature.test(buffer)) ?? null;
}

export function iconId(label) {
  const base = String(label ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return base || 'icon';
}

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });

export class IconStore {
  constructor(dataDir) {
    this.dir = join(dataDir, 'icons');
    this.indexFile = join(this.dir, 'index.json');
    this.icons = [];
  }

  static async open(dataDir) {
    const store = new IconStore(dataDir);
    await mkdir(store.dir, { recursive: true });
    if (existsSync(store.indexFile)) {
      store.icons = JSON.parse(await readFile(store.indexFile, 'utf8')).icons ?? [];
    }
    return store;
  }

  list() {
    return [...this.icons].sort((a, b) => a.label.localeCompare(b.label));
  }

  get(id) {
    const icon = ID.test(id) ? this.icons.find(entry => entry.id === id) : null;
    if (!icon) {
      throw Object.assign(new Error(`Icon "${id}" is not in the library`), { statusCode: 404 });
    }
    return icon;
  }

  async read(id) {
    const icon = this.get(id);
    return { icon, data: await readFile(join(this.dir, `${icon.id}.webp`)) };
  }

  async readOriginal(id) {
    const icon = this.get(id);
    if (!icon.original) return this.read(id).then(({ data }) => ({ icon, data, type: 'image/webp' }));
    return { icon, data: await readFile(join(this.dir, icon.original.file)), type: icon.original.type };
  }

  // A data: URI for a Note, as the editor would embed it.
  async dataUri(id) {
    const { icon, data } = await this.read(id);
    return { icon, src: `data:image/webp;base64,${data.toString('base64')}` };
  }

  // The icon and its smaller copies as data: URIs, largest first. Icons added before 0.14.0 have
  // no copies, so the list then holds only the icon itself.
  async encodings(id) {
    const { icon, data } = await this.read(id);
    const all = [{ quality: icon.quality ?? null, src: `data:image/webp;base64,${data.toString('base64')}` }];
    for (const variant of icon.variants ?? []) {
      const bytes = await readFile(join(this.dir, variant.file)).catch(() => null);
      if (bytes) all.push({ quality: variant.quality, src: `data:image/webp;base64,${bytes.toString('base64')}` });
    }
    return all.sort((a, b) => b.src.length - a.src.length);
  }

  // With replace, an icon whose id the name gives already exists is replaced in place (same id and
  // name, new image), so importing a set again updates it instead of making copies. variants are
  // the same icon encoded at a lower quality ({ quality, webp }), drawn by the browser too.
  async add({ label, webp, quality, variants, original, width, height, source, generation, replace = false }) {
    const name = String(label ?? '').trim();
    if (!name || name.length > 80) throw badRequest('An icon needs a name of 1 to 80 characters');
    const icon = Buffer.from(String(webp ?? ''), 'base64');
    if (imageType(icon)?.type !== 'image/webp') throw badRequest('The icon must be a WebP image');
    if (icon.length > MAX_ICON_BYTES) throw badRequest(`The icon is larger than ${MAX_ICON_BYTES} bytes`);
    if (variants !== undefined && (!Array.isArray(variants) || variants.length > MAX_VARIANTS)) {
      throw badRequest(`variants must be a list of at most ${MAX_VARIANTS} images`);
    }
    const copies = (variants ?? []).map(variant => {
      const data = Buffer.from(String(variant?.webp ?? ''), 'base64');
      if (imageType(data)?.type !== 'image/webp') throw badRequest('Every variant must be a WebP image');
      if (data.length > MAX_ICON_BYTES) throw badRequest(`A variant is larger than ${MAX_ICON_BYTES} bytes`);
      return { quality: validQuality(variant.quality), data };
    });
    let originalFile = null;
    let originalBuffer = null;
    if (original) {
      originalBuffer = Buffer.from(String(original), 'base64');
      const type = imageType(originalBuffer);
      if (!type) throw badRequest('The original must be a PNG, JPEG, GIF or WebP image');
      if (originalBuffer.length > MAX_ORIGINAL_BYTES) throw badRequest(`The original is larger than ${MAX_ORIGINAL_BYTES} bytes`);
      originalFile = { ext: type.ext, type: type.type };
    }
    let id = iconId(name);
    const existing = replace ? this.icons.find(entry => entry.id === id) : null;
    if (!existing) {
      for (let n = 2; this.icons.some(entry => entry.id === id); n++) {
        id = `${iconId(name).slice(0, 46)}-${n}`;
      }
    } else {
      await this.unlinkFiles(existing, { keepIcon: true });
    }
    await writeFile(join(this.dir, `${id}.webp`), icon);
    const entry = {
      id,
      label: existing?.label ?? name,
      width: Number(width) || null,
      height: Number(height) || null,
      bytes: icon.length,
      source: String(source ?? 'upload').slice(0, 200),
      addedAt: new Date().toISOString()
    };
    if (validQuality(quality)) entry.quality = quality;
    if (copies.length) {
      entry.variants = [];
      for (const [index, copy] of copies.entries()) {
        const file = `${id}.v${index + 1}.webp`;
        await writeFile(join(this.dir, file), copy.data);
        entry.variants.push({ file, quality: copy.quality, bytes: copy.data.length });
      }
    }
    if (generation && typeof generation === 'object') {
      entry.generation = {
        subject: String(generation.subject ?? '').slice(0, 1000),
        style: String(generation.style ?? '').slice(0, 200),
        prompt: String(generation.prompt ?? '').slice(0, 4000),
        seed: Number.isSafeInteger(generation.seed) ? generation.seed : null
      };
    }
    if (originalFile) {
      entry.original = { file: `${id}.orig.${originalFile.ext}`, type: originalFile.type, bytes: originalBuffer.length };
      await writeFile(join(this.dir, entry.original.file), originalBuffer);
    }
    if (existing) {
      entry.addedAt = existing.addedAt;
      entry.updatedAt = new Date().toISOString();
      await this.save(this.icons.map(item => (item.id === id ? entry : item)));
      return { ...entry, replaced: true };
    }
    await this.save([...this.icons, entry]);
    return entry;
  }

  async rename(id, label) {
    const icon = this.get(id);
    const name = String(label ?? '').trim();
    if (!name || name.length > 80) throw badRequest('An icon needs a name of 1 to 80 characters');
    await this.save(this.icons.map(entry => (entry.id === icon.id ? { ...entry, label: name } : entry)));
    return { ...icon, label: name };
  }

  async remove(id) {
    const icon = this.get(id);
    await this.save(this.icons.filter(entry => entry.id !== icon.id));
    await this.unlinkFiles(icon);
  }

  async unlinkFiles(icon, { keepIcon = false } = {}) {
    const files = [icon.original?.file, ...(icon.variants ?? []).map(variant => variant.file)];
    if (!keepIcon) files.push(`${icon.id}.webp`);
    for (const file of files.filter(Boolean)) await unlink(join(this.dir, file)).catch(() => {});
  }

  async save(icons) {
    const temporary = `${this.indexFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ icons }, null, 2)}\n`);
    await rename(temporary, this.indexFile);
    this.icons = icons;
  }
}
