// The icon library in the browser: listing, adding (the browser draws each icon at the instance's
// icon size and encodes WebP, so the server needs no image library), the picker dialog with the
// library and dashboard-icons, and the Font Awesome 4 icon list for heading icons.
import { t } from './i18n.js';

const MAX_ORIGINAL_BYTES = 8_000_000;

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

// The icon is drawn from blob; the original kept with it is `original` when given (for example
// the untrimmed generated image), otherwise blob itself.
export async function addIcon({ label, blob, original = blob, source, size, generation, replace = false }) {
  const webp = await drawWebp(blob, size.width, size.height);
  return (await request('POST', '/api/icons', {
    label,
    webp: await base64(webp),
    original: original.size <= MAX_ORIGINAL_BYTES ? await base64(original) : undefined,
    width: size.width,
    height: size.height,
    source,
    generation,
    replace
  })).icon;
}

// Crops the transparent border off an image (a generated icon after background removal), keeping
// a small margin, so the icon fills its box like the hand-made ones. Returns a PNG blob.
export async function trimTransparent(blob, margin = 0.02) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return blob;
  const pad = Math.round(Math.max(right - left, bottom - top) * margin);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const crop = document.createElement('canvas');
  crop.width = right - left + 1;
  crop.height = bottom - top + 1;
  crop.getContext('2d').drawImage(canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise(resolve => crop.toBlob(resolve, 'image/png'));
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
export function openIconDialog({ el, toast, size, images = [], mode = 'pick', tab = 'library', generator = null, name = '' }) {
  const dialog = document.getElementById('iconDialog');
  const state = { icons: [], resolve: null };
  picker = state;
  const $ = id => document.getElementById(id);

  // A new icon (uploaded, from dashboard-icons or generated) goes into the Note only when ticked;
  // otherwise it is just added to the library and the dialog stays open.
  const embedNew = () => mode === 'pick' && $('iconDialogEmbed').checked;

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
              if (embedNew()) choose(icon);
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

  // ---------- create with AI ----------

  const styles = generator?.styles ?? [];
  const tickedStyles = () => [...$('genStyleTags').querySelectorAll('input:checked')].map(box => box.value);
  // This browser remembers which styles were ticked last time; otherwise the settings decide.
  const STYLE_KEY = 'proxmox-notes.generatorStyles';
  const rememberedStyles = () => {
    try {
      const names = JSON.parse(localStorage.getItem(STYLE_KEY));
      return Array.isArray(names) ? names : null;
    } catch {
      return null;
    }
  };
  const rememberStyles = () => {
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(tickedStyles()));
    } catch {
      // Storage may be blocked; the settings then decide next time.
    }
  };
  // The same order and joining as the server's buildPrompt.
  const showPrompt = () => {
    const subject = $('genSubject').value.trim().replace(/[.\s]+$/, '');
    const ticked = tickedStyles();
    const parts = styles.filter(style => ticked.includes(style.name)).map(style => style.prompt.trim());
    $('genPrompt').textContent = subject ? [...parts, `Motif: ${subject}.`].join(' ') : '';
  };

  const keepGenerated = async (job, label, src) => {
    try {
      const original = await (await fetch(src)).blob();
      const icon = await addIcon({
        label,
        blob: await trimTransparent(original),
        original,
        source: 'comfyui',
        size,
        generation: { subject: job.subject, style: job.styles.join(', '), prompt: job.prompt, seed: job.seed }
      });
      state.icons.push(icon);
      toast(t('lib.added', { name: icon.label }));
      if (embedNew()) choose(icon);
    } catch (error) {
      toast(error.message, 'bad');
    }
  };

  const generate = async () => {
    const label = $('genName').value.trim();
    const subject = $('genSubject').value.trim();
    if (!label || !subject) {
      toast(t('gen.needBoth'), 'bad');
      return;
    }
    const button = $('btnGenerate');
    const status = $('genStatus');
    button.disabled = true;
    $('genGrid').replaceChildren();
    try {
      let { job } = await request('POST', '/api/generate', {
        subject, styles: tickedStyles(), count: Number($('genCount').value), host: $('genHost').value || undefined
      });
      state.job = job.id;
      while (job.state === 'queued' || job.state === 'running') {
        status.textContent = t(`gen.${job.state}`, { seconds: Math.round(job.elapsedMs / 1000), host: job.host });
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (picker !== state || state.job !== job.id) return;
        job = (await request('GET', `/api/generate/${job.id}`)).job;
      }
      if (job.state === 'error') throw new Error(job.error);
      status.textContent = t('gen.done', { seconds: Math.round(job.elapsedMs / 1000), host: job.host });
      renderGrid($('genGrid'), job.images.map((src, index) => ({ id: `${job.id}-${index}`, label: `${label} ${index + 1}`, src })), {
        el,
        onPick: item => keepGenerated(job, label, item.src)
      });
    } catch (error) {
      status.textContent = '';
      toast(error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  };

  const fillGenerator = () => {
    const ready = Boolean(generator?.hosts?.length);
    $('genReady').hidden = !ready;
    $('genNotReady').hidden = ready;
    if (!ready) return;
    const remembered = rememberedStyles();
    $('genStyleTags').replaceChildren(...styles.map(style => el('label', { class: 'icon-chip style-tag', title: style.prompt }, [
      el('input', { type: 'checkbox', value: style.name, checked: remembered ? remembered.includes(style.name) : style.checked }),
      el('span', { text: style.name })
    ])));
    $('genCount').value = String(generator.count);
    $('genHost').replaceChildren(el('option', { value: '', text: t('gen.autoHost') }), ...generator.hosts.map(url => el('option', { value: url, text: url })));
    $('genName').value = name;
    $('genSubject').value = '';
    $('genStatus').textContent = '';
    $('genGrid').replaceChildren();
    showPrompt();
  };

  const setTab = name => {
    for (const button of dialog.querySelectorAll('[data-icon-tab]')) button.classList.toggle('active', button.dataset.iconTab === name);
    $('iconTabLibrary').hidden = name !== 'library';
    $('iconTabDashboard').hidden = name !== 'dashboard';
    $('iconTabGenerate').hidden = name !== 'generate';
    $('iconDialogEmbedRow').hidden = mode !== 'pick';
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
    $('btnGenerate').addEventListener('click', () => picker?.generate());
    $('genSubject').addEventListener('input', () => picker?.showPrompt());
    $('genStyleTags').addEventListener('change', () => { picker?.rememberStyles(); picker?.showPrompt(); });
  }

  state.generate = generate;
  state.showPrompt = showPrompt;
  state.rememberStyles = rememberStyles;
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
    if (last && files.length === 1 && embedNew()) choose(last);
  };

  $('iconDialogTitle').textContent = mode === 'pick' ? t('lib.pickTitle') : t('lib.addTitle');
  $('iconDialogSearch').value = '';
  $('dashboardGrid').replaceChildren();
  $('iconDialogEmbed').checked = true;
  fillGenerator();
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
