// Icon packs: download chosen icons as a ZIP in the layout of a web icon set
// (<size>/<key>-<size>.png, as the old Notes Generator used), with a manifest that keeps the names,
// and upload such a ZIP again, or any ZIP of images. Everything happens in the browser.
import { t } from './i18n.js';
import { addIcon, drawPng, labelFromFile, trimTransparent } from './library.js';
import { readZip, writeZip } from './zip.js';

export const MANIFEST = 'proxmox-notes-icons.json';
export const PACK_SIZES = [512, 200, 100];
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

// "Sonarr 01 (green)" -> "sonarr01", "Prowlarr" -> "prowlarr01": the keys of an icon set end in a number.
export function packKey(label) {
  const key = String(label).toLowerCase().replace(/\(.*?\)/g, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  return /\d$/.test(key) ? key : `${key || 'icon'}01`;
}

const $ = id => document.getElementById(id);
let exporting = null;

/** Opens the download dialog for the chosen icons. */
export function openExportDialog({ el, toast, icons }) {
  const dialog = $('packDialog');
  exporting = { el, toast, icons };
  $('packName').value = 'proxmox-notes-icons';
  $('packError').textContent = '';
  // Every download starts with the sizes of an icon set, without the original.
  for (const size of PACK_SIZES) $(`packSize${size}`).checked = true;
  $('packOriginal').checked = false;
  $('packList').replaceChildren(...icons.map(icon => el('li', { class: 'pack-row' }, [
    el('img', { src: `/api/icons/${encodeURIComponent(icon.id)}.webp`, alt: '' }),
    el('span', { class: 'pack-label', text: icon.label }),
    el('input', { type: 'text', value: packKey(icon.label), spellcheck: 'false', 'data-id': icon.id, 'aria-label': t('pack.key') })
  ])));
  $('packTitle').textContent = t('pack.title', { count: icons.length });
  if (!dialog.dataset.bound) {
    dialog.dataset.bound = '1';
    $('packCancel').addEventListener('click', () => dialog.close());
    $('packDownload').addEventListener('click', () => download());
  }
  dialog.showModal();
}

async function download() {
  const { toast, icons } = exporting;
  const keys = [...$('packList').querySelectorAll('input[data-id]')].map(input => ({ id: input.dataset.id, key: input.value.trim() }));
  const sizes = PACK_SIZES.filter(size => $(`packSize${size}`).checked);
  const withOriginal = $('packOriginal').checked;
  const error = $('packError');
  const bad = keys.find(item => !/^[a-z0-9][a-z0-9_-]*$/i.test(item.key));
  const seen = new Set();
  const twice = keys.find(item => seen.size === seen.add(item.key.toLowerCase()).size);
  if (bad || twice || (!sizes.length && !withOriginal)) {
    error.textContent = bad ? t('pack.badKey', { key: bad.key || '…' }) : twice ? t('pack.sameKey', { key: twice.key }) : t('pack.noSize');
    return;
  }
  error.textContent = '';
  const button = $('packDownload');
  button.disabled = true;
  try {
    const files = [];
    const manifest = { format: 'proxmox-notes-icons', version: 1, name: $('packName').value.trim(), icons: [] };
    for (const [index, { id, key }] of keys.entries()) {
      error.textContent = t('pack.building', { done: index, total: keys.length });
      const icon = icons.find(item => item.id === id);
      const original = await (await fetch(`/api/icons/${encodeURIComponent(id)}/original`)).blob();
      // A generated original still has its transparent border; the icon was drawn without it.
      const source = icon.generation ? await trimTransparent(original) : original;
      let largest = null;
      if (withOriginal) {
        const bitmap = await createImageBitmap(original);
        const ext = (original.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
        const name = `${bitmap.width}x${bitmap.height}/${key}-${bitmap.width}x${bitmap.height}.${ext}`;
        bitmap.close();
        files.push({ name, data: new Uint8Array(await original.arrayBuffer()) });
        largest = name;
      }
      for (const size of sizes) {
        const name = `${size}x${size}/${key}-${size}x${size}.png`;
        if (files.some(file => file.name === name)) continue;
        files.push({ name, data: new Uint8Array(await (await drawPng(source, size, size)).arrayBuffer()) });
        largest ??= name;
      }
      manifest.icons.push({ label: icon.label, key, file: largest, ...(icon.generation ? { generation: icon.generation } : {}) });
    }
    files.push({ name: MANIFEST, data: `${JSON.stringify(manifest, null, 2)}\n`, deflate: true });
    const zip = await writeZip(files);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zip);
    link.download = `${(manifest.name || 'proxmox-notes-icons').replace(/[^\w.-]+/g, '-')}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    $('packDialog').close();
    toast(t('pack.downloaded', { count: keys.length }));
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

/**
 * The icons in a pack: from its manifest when it has one, otherwise every image, named from its
 * file name, keeping the largest file when the same key comes in several sizes.
 */
export function packItems(entries, images = []) {
  const manifestEntry = entries.find(entry => entry.name.split('/').pop() === MANIFEST);
  if (manifestEntry) {
    const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
    const folder = manifestEntry.name.slice(0, manifestEntry.name.length - MANIFEST.length);
    return (manifest.icons ?? []).map(icon => ({
      label: String(icon.label ?? icon.key ?? 'Icon'),
      entry: entries.find(entry => entry.name === `${folder}${icon.file}`),
      generation: icon.generation
    })).filter(item => item.entry);
  }
  const best = new Map();
  for (const entry of entries) {
    const file = entry.name.split('/').pop();
    if (!IMAGE.test(file) || entry.name.includes('__MACOSX/') || file.startsWith('.')) continue;
    const key = file.replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/i, '').toLowerCase();
    if (!best.has(key) || best.get(key).data.length < entry.data.length) best.set(key, entry);
  }
  return [...best.values()].map(entry => ({ label: labelFromFile(entry.name.split('/').pop(), images), entry }));
}

/** Adds the icons of a pack to the library. Returns how many were added and replaced. */
export async function importPack({ file, images, size, replace, progress, toast }) {
  const items = packItems(await readZip(file), images);
  let added = 0;
  let replaced = 0;
  for (const [index, item] of items.entries()) {
    progress(t('lib.uploading', { done: index, total: items.length }));
    const ext = item.entry.name.split('.').pop().toLowerCase();
    try {
      const original = new Blob([item.entry.data], { type: TYPES[ext] ?? 'image/png' });
      const icon = await addIcon({
        label: item.label,
        blob: item.generation ? await trimTransparent(original) : original,
        original,
        source: `zip:${file.name}`,
        size,
        generation: item.generation,
        replace
      });
      if (icon.replaced) replaced++;
      else added++;
    } catch (error) {
      toast(`${item.entry.name}: ${error.message}`, 'bad');
    }
  }
  progress('');
  return { added, replaced, found: items.length };
}
