// The icon library in the browser: listing, adding (the browser draws each icon at the instance's
// icon size and encodes WebP, so the server needs no image library), the picker dialog with the
// library and dashboard-icons, and the Font Awesome 4 icon list for heading icons.
import { t } from './i18n.js';

const MAX_ORIGINAL_BYTES = 4_000_000;

async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

export const iconUrl = id => `/api/icons/${encodeURIComponent(id)}.webp`;

export function listIcons() {
  return request('GET', '/api/icons');
}

export function renameIcon(id, label) {
  return request('PATCH', `/api/icons/${encodeURIComponent(id)}`, { label });
}

export function removeIcon(id) {
  return request('DELETE', `/api/icons/${encodeURIComponent(id)}`);
}

async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Draws the image inside a width × height box, keeping its proportions, and encodes WebP.
async function drawWebp(blob, width, height) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
  bitmap.close();
  const webp = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!webp || webp.type !== 'image/webp') throw new Error(t('lib.noWebp'));
  return webp;
}

export async function addIcon({ label, blob, source, size, replace = false }) {
  const webp = await drawWebp(blob, size.width, size.height);
  return (await request('POST', '/api/icons', {
    label,
    webp: await base64(webp),
    original: blob.size <= MAX_ORIGINAL_BYTES ? await base64(blob) : undefined,
    width: size.width,
    height: size.height,
    source,
    replace
  })).icon;
}

// "sonarr01-512x512.png" -> key "sonarr01". A size suffix is dropped, also a mistyped one such as
// "-512x1512". The name comes from the icon-set list when the key is in it ("Sonarr 01"), or is
// made from the key ("deluge03" -> "Deluge 03").
export function labelFromFile(fileName, images = []) {
  const key = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/i, '');
  const known = images.find(image => image.key.replace(/-$/, '').toLowerCase() === key.toLowerCase());
  if (known) return known.label;
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])(\d+)$/i, '$1 $2').trim();
  return words ? words.replace(/\b\w/g, c => c.toUpperCase()) : 'Icon';
}
export const labelFromName = name => name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ---------- the grid ----------

/**
 * Renders icons as cards. options: { el, selected, onPick, onRename, onRemove }.
 * Without onRename/onRemove the cards are only for picking.
 */
export function renderGrid(container, icons, { el, selected, onPick, onRename, onRemove, emptyText }) {
  container.replaceChildren();
  if (!icons.length) {
    container.append(el('p', { class: 'muted small', text: emptyText ?? t('lib.empty') }));
    return;
  }
  for (const icon of icons) {
    const card = el('div', { class: `icon-card${icon.id === selected ? ' selected' : ''}`, title: icon.label });
    const image = el('img', { src: icon.src ?? iconUrl(icon.id), alt: '', loading: 'lazy' });
    const pick = el('button', { type: 'button', class: 'icon-card-pick', 'aria-label': icon.label, onclick: () => onPick?.(icon) }, [image]);
    const label = el('span', { class: 'icon-card-label', text: icon.label });
    card.append(pick, label);
    if (onRename || onRemove) {
      const tools = el('div', { class: 'icon-card-tools' });
      if (onRename) {
        tools.append(el('button', { type: 'button', class: 'icon', title: t('lib.rename'), onclick: () => {
          const next = prompt(t('lib.renamePrompt'), icon.label);
          if (next && next.trim() && next.trim() !== icon.label) onRename(icon, next.trim());
        } }, [el('i', { class: 'fa fa-pencil' })]));
      }
      if (onRemove) {
        tools.append(el('button', { type: 'button', class: 'icon danger', title: t('remove'), onclick: () => {
          if (confirm(t('lib.removeConfirm', { name: icon.label }))) onRemove(icon);
        } }, [el('i', { class: 'fa fa-trash' })]));
      }
      card.append(tools);
    }
    container.append(card);
  }
}

export const matches = (icon, filter) => !filter || `${icon.id} ${icon.label}`.toLowerCase().includes(filter.toLowerCase());

// ---------- the picker dialog ----------

let picker = null;

/**
 * Opens the icon dialog. mode "pick" resolves with the chosen library icon; mode "add" keeps the
 * dialog open so several dashboard-icons can be added to the library. Returns a promise of the
 * chosen icon, or null when the dialog is closed.
 */
export function openIconDialog({ el, toast, size, images = [], mode = 'pick', tab = 'library' }) {
  const dialog = document.getElementById('iconDialog');
  const state = { icons: [], resolve: null };
  picker = state;
  const $ = id => document.getElementById(id);

  const choose = icon => {
    if (mode === 'pick') {
      dialog.close();
      state.resolve?.(icon);
      state.resolve = null;
    }
  };

  const showLibrary = () => renderGrid($('iconDialogGrid'), state.icons.filter(icon => matches(icon, $('iconDialogSearch').value.trim())), { el, onPick: choose, emptyText: t('lib.emptyPick') });

  const loadLibrary = async () => {
    try {
      state.icons = (await listIcons()).icons;
      showLibrary();
    } catch (error) {
      toast(error.message, 'bad');
    }
  };

  let searchTimer;
  const searchDashboard = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const query = $('dashboardSearch').value.trim();
      const grid = $('dashboardGrid');
      grid.replaceChildren(el('p', { class: 'muted small', text: t('loading') }));
      try {
        const found = await request('GET', `/api/dashboard-icons?q=${encodeURIComponent(query)}`);
        $('dashboardCount').textContent = t('lib.dashboardCount', { shown: found.names.length, total: found.total });
        const existing = new Set(state.icons.map(icon => icon.source));
        renderGrid(grid, found.names.map(name => ({ id: name, label: name, src: `/api/dashboard-icons/${name}.png`, added: existing.has(`dashboard-icons:${name}`) })), {
          el,
          emptyText: t('lib.dashboardNone'),
          onPick: async item => {
            try {
              const blob = await (await fetch(item.src)).blob();
              const icon = await addIcon({ label: labelFromName(item.id), blob, source: `dashboard-icons:${item.id}`, size });
              state.icons.push(icon);
              toast(t('lib.added', { name: icon.label }));
              if (mode === 'pick') choose(icon);
            } catch (error) {
              toast(error.message, 'bad');
            }
          }
        });
      } catch (error) {
        grid.replaceChildren(el('p', { class: 'bad small', text: error.message }));
      }
    }, 250);
  };

  const setTab = name => {
    for (const button of dialog.querySelectorAll('[data-icon-tab]')) button.classList.toggle('active', button.dataset.iconTab === name);
    $('iconTabLibrary').hidden = name !== 'library';
    $('iconTabDashboard').hidden = name !== 'dashboard';
    if (name === 'dashboard' && !$('dashboardGrid').childElementCount) searchDashboard();
    if (name === 'library') showLibrary();
  };

  // Bind once; handlers read the current picker state.
  if (!dialog.dataset.bound) {
    dialog.dataset.bound = '1';
    $('iconDialogSearch').addEventListener('input', () => picker?.showLibrary());
    $('dashboardSearch').addEventListener('input', () => picker?.searchDashboard());
    for (const button of dialog.querySelectorAll('[data-icon-tab]')) button.addEventListener('click', () => picker?.setTab(button.dataset.iconTab));
    $('iconDialogClose').addEventListener('click', () => dialog.close());
    $('iconDialogUpload').addEventListener('change', async event => {
      const files = [...event.target.files];
      event.target.value = '';
      await picker?.uploadFiles(files);
    });
    dialog.addEventListener('close', () => { picker?.resolve?.(null); if (picker) picker.resolve = null; });
  }

  state.showLibrary = showLibrary;
  state.searchDashboard = searchDashboard;
  state.setTab = setTab;
  state.uploadFiles = async files => {
    let last = null;
    for (const file of files) {
      try {
        last = await addIcon({ label: labelFromFile(file.name, images), blob: file, source: `upload:${file.name}`, size });
        state.icons.push(last);
      } catch (error) {
        toast(`${file.name}: ${error.message}`, 'bad');
      }
    }
    showLibrary();
    if (last && mode === 'pick' && files.length === 1) choose(last);
  };

  $('iconDialogTitle').textContent = mode === 'pick' ? t('lib.pickTitle') : t('lib.addTitle');
  $('iconDialogSearch').value = '';
  $('dashboardGrid').replaceChildren();
  dialog.showModal();
  loadLibrary().then(() => setTab(tab));
  return new Promise(resolve => { state.resolve = resolve; });
}

// ---------- Font Awesome 4 ----------

let faNames = null;

export async function fontAwesomeNames() {
  if (!faNames) {
    const css = await (await fetch('/vendor/font-awesome/css/font-awesome.css')).text();
    faNames = [...new Set([...css.matchAll(/\.fa-([a-z0-9-]+):before/g)].map(match => match[1]))].sort();
  }
  return faNames;
}
