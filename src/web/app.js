import {
  DEFAULT_LAYOUT,
  fromLegacyJson,
  LAYOUTS,
  parseNotes,
  PROXMOX_DESCRIPTION_LIMIT,
  renderNotes,
  SCHEMA
} from '/format/index.mjs';
import { applyTranslations, setLanguage, t } from './i18n.js';
import { embedImage } from './icons.js';
import { addIcon, iconUrl, labelFromFile, openIconDialog } from './library.js';
import { renderPreview } from './preview.js';
import { initSettings, openSettings, refreshSettings } from './settings.js';

const $ = id => document.getElementById(id);

const state = {
  options: null,
  hosts: [],
  host: '',
  guests: [],
  // The guest the editor belongs to, with the Markdown Proxmox had when it was read.
  source: null,
  facts: null,
  mode: 'form',
  layout: DEFAULT_LAYOUT,
  doc: null,
  raw: '',
  original: null,
  // A message shown above the editor, kept as a key and values so it follows a language change.
  message: null
};

// ---------- small helpers ----------

async function api(tool, args = {}) {
  const response = await fetch(`/api/tools/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? response.statusText);
  }
  return body;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

let toastTimer;
function toast(message, kind = 'ok') {
  const box = $('toast');
  box.textContent = message;
  box.className = `toast ${kind}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// message: null, or a list of [key, values] pairs.
function showMessage(message, kind = 'info') {
  state.message = message ? { parts: message, kind } : null;
  renderMessage();
}

function renderMessage() {
  const box = $('banner');
  box.hidden = !state.message;
  if (!state.message) return;
  box.className = `banner ${state.message.kind}`;
  box.textContent = state.message.parts.map(([key, values]) => t(key, values)).join(' ');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const kind = type => (type === 'lxc' ? 'CT' : 'VM');
const slug = value => String(value ?? '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'note';
const clone = value => structuredClone(value);

// ---------- preferences: theme and language ----------

function getPreference(name) {
  try { return localStorage.getItem(`proxmox-notes.${name}`) ?? ''; } catch { return ''; }
}

function setPreference(name, value) {
  try {
    if (value) localStorage.setItem(`proxmox-notes.${name}`, value);
    else localStorage.removeItem(`proxmox-notes.${name}`);
  } catch { /* storage may be blocked */ }
  applyAppearance();
}

function applyAppearance() {
  const defaults = state.options?.appearance ?? { theme: 'system', language: 'en' };
  document.documentElement.dataset.theme = getPreference('theme') || defaults.theme;
  setLanguage(getPreference('language') || defaults.language);
  refreshTexts();
}

// Everything built in code that shows text.
function refreshTexts() {
  $('btnSettingsText').textContent = $('settingsView').hidden ? t('settings') : t('settings.back');
  fillLayoutChoice();
  renderMessage();
  if (state.doc || state.mode === 'raw') {
    if (state.mode === 'form') renderSections();
    renderFacts();
    renderContext();
    renderOutput();
  }
  renderHostSelect();
  renderGuests();
  refreshSettings();
}

// ---------- documents ----------

function newDocument(fill = {}) {
  const template = state.options?.template ?? {};
  return {
    schema: SCHEMA,
    headerIcon: template.headerIcon ?? 'fa-linux',
    title: '',
    image: null,
    description: '',
    notes: '',
    sections: clone(template.sections ?? []),
    ...fill
  };
}

function currentMarkdown() {
  return state.mode === 'raw' ? state.raw : renderNotes(state.doc, { layout: state.layout });
}


// ---------- loading a Note into the editor ----------

function loadDocument(doc, { source = state.source, facts = state.facts, original = null, message = null } = {}) {
  state.mode = 'form';
  state.doc = doc;
  state.source = source;
  state.facts = facts;
  state.original = original;
  showMessage(message, 'info');
  renderEditor();
}

function loadRaw(markdown, { source = state.source, facts = state.facts, original = markdown, message = null } = {}) {
  state.mode = 'raw';
  state.raw = markdown;
  state.source = source;
  state.facts = facts;
  state.original = original;
  showMessage(message, 'warn');
  renderEditor();
}

async function openGuest(guest) {
  try {
    const result = await api('notes_read', { host: state.host, vmid: guest.vmid });
    const source = { host: state.host, vmid: guest.vmid, name: guest.name, type: guest.type };
    if (result.empty) {
      const prefill = await api('notes_prefill', { host: state.host, vmid: guest.vmid });
      loadDocument(prefill.doc, { source, facts: result.facts, original: '', message: [['msg.prefilled']] });
    } else if (result.parsed.ok) {
      const message = [];
      if (result.parsed.layout !== state.layout) {
        message.push(['msg.layoutDiffers', { from: t(`layout.${result.parsed.layout}`), to: t(`layout.${state.layout}`) }]);
      }
      if (result.parsed.warnings.length) {
        message.push(['msg.warnings', { warnings: result.parsed.warnings.join(' ') }]);
      }
      // Compare against the Note as this tool writes it in its own layout, so small differences
      // in how Proxmox stored it are not a change, but a change of layout is.
      loadDocument(result.parsed.doc, { source, facts: result.facts, original: renderNotes(result.parsed.doc, { layout: result.parsed.layout }), message: message.length ? message : null });
    } else {
      loadRaw(result.markdown, { source, facts: result.facts, message: [['msg.notFormat', { line: result.parsed.line, error: result.parsed.error }]] });
    }
    markActiveGuest();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

// ---------- editor rendering ----------

function renderEditor() {
  $('formMode').hidden = state.mode !== 'form';
  $('rawMode').hidden = state.mode !== 'raw';
  if (state.mode === 'raw') {
    $('raw').value = state.raw;
  } else {
    const doc = state.doc;
    fillHeaderIcons(doc.headerIcon);
    $('title').value = doc.title;
    $('description').value = doc.description;
    $('notes').value = doc.notes;
    renderSections();
  }
  renderFacts();
  renderContext();
  update();
}

function fillHeaderIcons(selected) {
  const select = $('headerIcon');
  select.replaceChildren();
  const icons = [...(state.options?.headerIcons ?? [])];
  if (selected && !icons.some(i => i.icon === selected)) {
    icons.push({ label: selected, icon: selected });
  }
  for (const item of icons) {
    select.append(el('option', { value: item.icon, text: item.label }));
  }
  select.value = selected;
}

function renderSections() {
  const container = $('sections');
  container.replaceChildren();
  state.doc.sections.forEach(section => {
    const rows = el('div', { class: 'rows' });
    section.rows.forEach((row, rowIndex) => rows.append(renderRow(section, row, rowIndex)));
    const isServices = section.id === 'services';
    const addField = el('button', { type: 'button', class: 'small', text: isServices ? t('addLink') : t('addRow'), onclick: () => {
      section.rows.push(isServices ? { type: 'link', name: '', url: 'https://' } : { type: 'field', key: '', value: '' });
      renderSections();
      update();
    } });
    container.append(el('fieldset', { class: 'section' }, [
      el('legend', {}, [el('i', { class: `fa ${section.icon}` }), ` ${section.title}`]),
      rows,
      el('div', { class: 'row-buttons' }, [addField])
    ]));
  });
}

function renderRow(section, row, index) {
  const change = key => event => { row[key] = event.target.value; update(); };
  const move = delta => () => {
    const target = index + delta;
    if (target < 0 || target >= section.rows.length) return;
    [section.rows[index], section.rows[target]] = [section.rows[target], section.rows[index]];
    renderSections();
    update();
  };
  const remove = () => { section.rows.splice(index, 1); renderSections(); update(); };
  let inputs;
  if (row.type === 'field') {
    inputs = [
      el('input', { type: 'text', class: 'key', value: row.key, placeholder: t('key'), 'aria-label': t('key'), oninput: change('key') }),
      el('input', { type: 'text', class: 'value', value: row.value, placeholder: t('value'), 'aria-label': t('value'), oninput: change('value') })
    ];
  } else if (row.type === 'link') {
    inputs = [
      el('input', { type: 'text', class: 'key', value: row.name, placeholder: t('linkName'), 'aria-label': t('linkName'), oninput: change('name') }),
      el('input', { type: 'text', class: 'value', value: row.url, placeholder: 'https://', 'aria-label': t('linkUrl'), oninput: change('url') })
    ];
  } else {
    inputs = [el('input', { type: 'text', class: 'value wide', value: row.text, placeholder: t('textRow'), 'aria-label': t('textRow'), oninput: change('text') })];
  }
  return el('div', { class: 'row-item' }, [
    ...inputs,
    el('button', { type: 'button', class: 'icon', title: t('moveUp'), onclick: move(-1) }, [el('i', { class: 'fa fa-arrow-up' })]),
    el('button', { type: 'button', class: 'icon', title: t('moveDown'), onclick: move(1) }, [el('i', { class: 'fa fa-arrow-down' })]),
    el('button', { type: 'button', class: 'icon danger', title: t('removeRow'), onclick: remove }, [el('i', { class: 'fa fa-times' })])
  ]);
}

function renderFacts() {
  const box = $('factsBox');
  const facts = state.facts;
  box.hidden = !facts || state.mode !== 'form';
  if (box.hidden) return;
  $('factsText').textContent = t('facts', {
    hostname: facts.hostname || '?',
    ip: facts.ip || t('unknown'),
    mac: facts.mac || t('unknown'),
    dhcp: facts.dhcp === null ? t('unknown') : facts.dhcp ? t('yes') : t('no'),
    os: facts.os || t('unknown')
  });
}

function renderContext() {
  const label = $('contextLabel');
  if (state.source) {
    label.textContent = t('context.guest', { host: state.source.host, kind: kind(state.source.type), vmid: state.source.vmid, name: state.source.name });
    label.classList.remove('muted');
  } else {
    label.textContent = t('context.unlinked');
    label.classList.add('muted');
  }
  $('btnSave').disabled = !state.source;
  $('btnSave').title = state.source ? t('save.titleFor', { name: state.source.name }) : t('save.titleNone');
  $('btnHistory').hidden = !state.source;
}

// ---------- saving to Proxmox ----------

let pendingWrite = null;

async function openSaveDialog() {
  if (!state.source) return;
  const markdown = currentMarkdown();
  try {
    const prepared = await api('notes_prepare_write', { host: state.source.host, vmid: state.source.vmid, markdown });
    if (!prepared.changed) {
      toast(t('save.nothing'));
      return;
    }
    pendingWrite = prepared;
    const target = t('save.target', { kind: kind(state.source.type), vmid: prepared.guest.vmid, name: prepared.guest.name, host: state.source.host });
    $('saveSummary').textContent = t('save.summary', { length: prepared.length, limit: prepared.limit, target });
    $('saveCurrent').replaceChildren(prepared.current.trim() ? renderPreview(prepared.current) : el('p', { class: 'muted', text: t('empty') }));
    $('saveNext').replaceChildren(renderPreview(prepared.next));
    $('saveConfirm').disabled = false;
    $('saveDialog').showModal();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

async function confirmSave() {
  if (!pendingWrite) return;
  $('saveConfirm').disabled = true;
  try {
    const result = await api('notes_write_confirmed', { confirmation: pendingWrite.confirmation });
    state.original = pendingWrite.next;
    pendingWrite = null;
    $('saveDialog').close();
    showMessage(null);
    update();
    toast(t('save.done', { name: state.source.name, snapshot: result.snapshot }));
    const guest = state.guests.find(g => g.vmid === result.vmid);
    if (guest && state.host === result.host) {
      guest.notes = state.mode === 'form' ? 'format' : 'other';
      guest.noteTitle = state.mode === 'form' ? state.doc.title : '';
      renderGuests();
    }
  } catch (error) {
    pendingWrite = null;
    $('saveDialog').close();
    toast(error.message, 'bad');
  }
}

// ---------- history ----------

async function openHistory() {
  if (!state.source) return;
  const source = state.source;
  const list = $('historyList');
  list.replaceChildren(el('li', { class: 'muted', text: t('loading') }));
  $('historyDialog').showModal();
  try {
    const { snapshots } = await api('notes_snapshots', { host: source.host, vmid: source.vmid });
    list.replaceChildren();
    if (!snapshots.length) {
      list.append(el('li', { class: 'muted', text: t('history.none') }));
    }
    for (const snapshot of snapshots) {
      list.append(el('li', {}, [
        el('span', { class: 'when', text: new Date(snapshot.takenAt).toLocaleString() }),
        el('span', { class: 'muted small', text: t('history.chars', { count: snapshot.length }) }),
        el('button', { type: 'button', class: 'small', text: t('history.load'), onclick: () => loadSnapshot(source, snapshot.id) })
      ]));
    }
  } catch (error) {
    list.replaceChildren(el('li', { class: 'muted', text: error.message }));
  }
}

async function loadSnapshot(source, id) {
  try {
    const snapshot = await api('notes_snapshot', { host: source.host, vmid: source.vmid, id });
    $('historyDialog').close();
    const message = [['history.loaded', { when: new Date(snapshot.takenAt).toLocaleString() }]];
    if (snapshot.parsed?.ok) {
      loadDocument(snapshot.parsed.doc, { original: state.original, message });
    } else {
      loadRaw(snapshot.description, { original: state.original, message });
    }
  } catch (error) {
    toast(error.message, 'bad');
  }
}

// ---------- preview, size and dirty state ----------

let previewTimer;
function update() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderOutput, 80);
}

function renderOutput() {
  if (!state.doc && state.mode === 'form') return;
  const markdown = currentMarkdown();
  $('markdownOut').value = markdown;
  $('preview').replaceChildren(renderPreview(markdown));
  const length = markdown.length;
  const ratio = Math.min(length / PROXMOX_DESCRIPTION_LIMIT, 1);
  $('sizeFill').style.width = `${(ratio * 100).toFixed(1)}%`;
  $('sizeFill').className = length > PROXMOX_DESCRIPTION_LIMIT ? 'over' : ratio > 0.9 ? 'near' : '';
  $('sizeText').textContent = t('size', { length, limit: PROXMOX_DESCRIPTION_LIMIT }) + (length > PROXMOX_DESCRIPTION_LIMIT ? t('size.over') : '');
  const normalize = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');
  $('dirty').hidden = state.original === null || normalize(markdown) === normalize(state.original);
  renderIcon();
}

function renderIcon() {
  const thumb = $('iconThumb');
  const image = state.mode === 'form' ? state.doc?.image : null;
  thumb.replaceChildren(image?.src ? el('img', { src: image.src, alt: t('icon') }) : el('i', { class: 'fa fa-picture-o' }));
  if (!image?.src) {
    $('iconInfo').textContent = t('icon.none');
  } else if (image.src.startsWith('data:')) {
    $('iconInfo').textContent = t('icon.embedded', { length: image.src.length, width: image.width, height: image.height });
  } else {
    $('iconInfo').textContent = t('icon.linked', { src: image.src });
  }
}

// ---------- icons ----------

// Characters left for an embedded image: the limit minus the Note without an image.
function imageBudget() {
  const withoutImage = renderNotes({ ...state.doc, image: { src: '', width: 1, height: 1 } }, { layout: state.layout }).length;
  return PROXMOX_DESCRIPTION_LIMIT - withoutImage - 64;
}

const iconSize = () => ({ width: state.options?.iconSet?.width ?? 100, height: state.options?.iconSet?.height ?? 100 });

async function dataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Embeds a library icon as it is; only when the Note has too little room left is it encoded again
// at a lower quality.
async function embedLibraryIcon(icon) {
  const blob = await (await fetch(iconUrl(icon.id))).blob();
  const width = icon.width ?? iconSize().width;
  const height = icon.height ?? iconSize().height;
  let src = await dataUri(blob);
  const budget = imageBudget();
  if (src.length > budget) {
    const result = await embedImage(blob, { width, height, budget });
    src = result.src;
    toast(t('icon.doneQuality', { format: result.format, quality: result.quality ? Math.round(result.quality * 100) : '-', length: result.length }));
  }
  state.doc.image = { src, width, height, key: icon.id };
  state.iconLabel = icon.label;
  update();
}

async function pickIcon() {
  const icon = await openIconDialog({ el, toast, size: iconSize(), mode: 'pick' });
  if (!icon) return;
  try {
    await embedLibraryIcon(icon);
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function fillLayoutChoice() {
  $('layout').replaceChildren(...LAYOUTS.map(value => el('option', { value, text: t(`layout.${value}`) })));
  $('layout').value = state.layout;
}

// ---------- facts from Proxmox ----------

function applyFacts() {
  const facts = state.facts;
  if (!facts || state.mode !== 'form') return;
  const values = { IP: facts.ip, MAC: facts.mac, DHCP: facts.dhcp === null ? '' : facts.dhcp ? 'Yes' : 'No', OS: facts.os };
  let oldIp = '';
  const changed = [];
  for (const row of state.doc.sections.flatMap(s => s.rows)) {
    if (row.type !== 'field') continue;
    const value = values[row.key];
    if (value === undefined || value === '' || row.value === value) continue;
    // Keep an exact release ("Debian 13") when Proxmox only knows the family ("Debian").
    if (row.key === 'OS' && row.value.toLowerCase().startsWith(value.toLowerCase())) continue;
    if (row.key === 'IP') oldIp = row.value;
    changed.push(`${row.key}: ${row.value || t('empty')} → ${value}`);
    row.value = value;
  }
  // Service links usually point at the old address; move them along with it.
  if (oldIp && facts.ip) {
    for (const row of state.doc.sections.flatMap(s => s.rows)) {
      if (row.type === 'link' && row.url.includes(`//${oldIp}`)) {
        row.url = row.url.replace(`//${oldIp}`, `//${facts.ip}`);
        changed.push(t('facts.link', { name: row.name, url: row.url }));
      }
    }
  }
  renderSections();
  update();
  toast(changed.length ? t('facts.updated', { changes: changed.join('; ') }) : t('facts.same'));
}

// ---------- guest list ----------

async function loadHosts() {
  const { hosts } = await api('notes_hosts');
  state.hosts = hosts;
  if (!hosts.some(h => h.id === state.host)) {
    const remembered = getPreference('host');
    state.host = hosts.some(h => h.id === remembered) ? remembered : hosts[0]?.id ?? '';
  }
  renderHostSelect();
  if (state.host) {
    await loadGuests();
  } else {
    state.guests = [];
    renderGuests();
  }
}

function renderHostSelect() {
  const select = $('hostSelect');
  select.replaceChildren();
  select.disabled = !state.hosts.length;
  for (const host of state.hosts) {
    select.append(el('option', { value: host.id, text: host.tls === 'insecure' ? t('hosts.insecure', { name: host.name }) : host.name }));
  }
  if (!state.hosts.length) {
    select.append(el('option', { value: '', text: t('hosts.none') }));
    $('guestMessage').textContent = t('hosts.add');
  }
  select.value = state.host;
}

async function loadGuests() {
  const list = $('guestList');
  $('guestMessage').textContent = t('loading');
  list.replaceChildren();
  try {
    const { guests } = await api('notes_guests', { host: state.host, notes: true });
    state.guests = guests;
    $('guestMessage').textContent = guests.length ? '' : t('guests.none');
    renderGuests();
  } catch (error) {
    state.guests = [];
    $('guestMessage').textContent = error.message;
  }
}

const NOTE_BADGES = {
  format: { key: 'badge.format', class: 'ok' },
  other: { key: 'badge.other', class: 'warn' },
  empty: { key: 'badge.empty', class: 'muted' },
  error: { key: 'badge.error', class: 'bad' }
};

function renderGuests() {
  const filter = $('guestFilter').value.trim().toLowerCase();
  const list = $('guestList');
  list.replaceChildren();
  for (const guest of state.guests) {
    const text = `${guest.vmid} ${guest.name} ${guest.noteTitle ?? ''} ${guest.tags.join(' ')}`.toLowerCase();
    if (filter && !text.includes(filter)) continue;
    const badge = NOTE_BADGES[guest.notes] ?? null;
    list.append(el('li', {}, [
      el('button', { type: 'button', class: 'guest', 'data-vmid': guest.vmid, title: guest.noteTitle || guest.name, onclick: () => openGuest(guest) }, [
        el('i', { class: `fa ${guest.type === 'lxc' ? 'fa-cube' : 'fa-desktop'} status-${guest.status}` }),
        el('span', { class: 'vmid', text: String(guest.vmid) }),
        el('span', { class: 'name', text: guest.name }),
        badge ? el('span', { class: `badge ${badge.class}`, text: t(badge.key), title: t(`${badge.key}Title`) }) : null
      ])
    ]));
  }
  markActiveGuest();
}

function markActiveGuest() {
  for (const button of document.querySelectorAll('.guest')) {
    const active = state.source && state.source.host === state.host && Number(button.dataset.vmid) === state.source.vmid;
    button.classList.toggle('active', Boolean(active));
  }
}

// ---------- import and export ----------

async function importFile(file) {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(t('import.badJson'));
    }
    if (data.schema === SCHEMA && Array.isArray(data.sections)) {
      loadDocument(data, { original: state.original, message: [['import.done', { file: file.name }]] });
      return;
    }
    if (data.h && data.sections) {
      const set = state.options?.iconSet ?? {};
      const doc = fromLegacyJson(data, { imageFqdn: set.baseUrl ?? '', imageWidth: set.width ?? 100, imageHeight: set.height ?? 100 });
      loadDocument(doc, { original: state.original, message: [['import.legacy', { file: file.name }]] });
      return;
    }
    throw new Error(t('import.unknown'));
  }
  const parsed = parseNotes(text);
  if (parsed.ok) {
    loadDocument(parsed.doc, { original: state.original, message: [['import.done', { file: file.name }]] });
  } else {
    loadRaw(text, { original: state.original, message: [['import.raw', { file: file.name, line: parsed.line, error: parsed.error }]] });
  }
}

function exportJson() {
  if (state.mode === 'raw') {
    download(`${slug(state.source?.name)}.md`, state.raw, 'text/markdown');
    toast(t('export.raw'));
    return;
  }
  download(`${slug(state.doc.title)}.json`, `${JSON.stringify(state.doc, null, 2)}\n`, 'application/json');
}

async function copyMarkdown() {
  const markdown = currentMarkdown();
  try {
    await navigator.clipboard.writeText(markdown);
  } catch {
    // The clipboard API needs https or localhost; fall back to a selection copy.
    const area = $('markdownOut');
    const hidden = area.hidden;
    area.hidden = false;
    area.select();
    document.execCommand('copy');
    area.hidden = hidden;
  }
  toast(t('copied', { length: markdown.length }));
}

// ---------- views ----------

function toggleSettings() {
  const opening = $('settingsView').hidden;
  $('settingsView').hidden = !opening;
  $('editorView').hidden = opening;
  $('editorActions').hidden = opening;
  $('btnSettingsText').textContent = opening ? t('settings.back') : t('settings');
  if (opening) openSettings();
}

// ---------- wiring ----------

function bindInputs() {
  $('headerIcon').addEventListener('change', e => { state.doc.headerIcon = e.target.value; update(); });
  $('title').addEventListener('input', e => { state.doc.title = e.target.value; update(); });
  $('description').addEventListener('input', e => { state.doc.description = e.target.value; update(); });
  $('notes').addEventListener('input', e => { state.doc.notes = e.target.value; update(); });
  $('raw').addEventListener('input', e => { state.raw = e.target.value; update(); });
  $('btnPickIcon').addEventListener('click', pickIcon);
  $('iconUpload').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const icon = await addIcon({ label: labelFromFile(file.name), blob: file, source: 'upload', size: iconSize() });
      toast(t('lib.added', { name: icon.label }));
      await embedLibraryIcon(icon);
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  $('btnIconRemove').addEventListener('click', () => { state.doc.image = null; update(); });
  $('btnApplyFacts').addEventListener('click', applyFacts);

  $('btnRawParse').addEventListener('click', () => {
    const parsed = parseNotes(state.raw);
    if (parsed.ok) loadDocument(parsed.doc, { original: state.original, message: [['raw.nowForm']] });
    else toast(t('raw.still', { line: parsed.line, error: parsed.error }), 'bad');
  });
  $('btnRawTemplate').addEventListener('click', async () => {
    if (!confirm(t('raw.confirm'))) return;
    if (state.source) {
      const prefill = await api('notes_prefill', { host: state.source.host, vmid: state.source.vmid });
      loadDocument(prefill.doc, { original: state.original, message: [['raw.prefilled']] });
    } else {
      loadDocument(newDocument(), { original: state.original });
    }
  });

  $('btnNew').addEventListener('click', () => {
    loadDocument(newDocument(), { source: null, facts: null, original: null, message: null });
    markActiveGuest();
  });
  $('fileImport').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await importFile(file);
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  $('btnExport').addEventListener('click', exportJson);
  $('btnCopy').addEventListener('click', copyMarkdown);
  $('btnSave').addEventListener('click', openSaveDialog);
  $('saveConfirm').addEventListener('click', confirmSave);
  $('saveCancel').addEventListener('click', () => { pendingWrite = null; $('saveDialog').close(); });
  $('btnHistory').addEventListener('click', openHistory);
  $('historyClose').addEventListener('click', () => $('historyDialog').close());
  $('btnSettings').addEventListener('click', toggleSettings);
  $('layout').addEventListener('change', e => {
    state.layout = e.target.value;
    try { localStorage.setItem('proxmox-notes.layout', state.layout); } catch { /* storage may be blocked */ }
    update();
  });

  $('hostSelect').addEventListener('change', e => {
    state.host = e.target.value;
    try { localStorage.setItem('proxmox-notes.host', state.host); } catch { /* storage may be blocked */ }
    loadGuests();
  });
  $('btnReload').addEventListener('click', loadGuests);
  $('guestFilter').addEventListener('input', renderGuests);

  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tabs button')) other.classList.toggle('active', other === tab);
      $('preview').hidden = tab.dataset.tab !== 'preview';
      $('markdownOut').hidden = tab.dataset.tab !== 'markdown';
    });
  }

  window.addEventListener('beforeunload', event => {
    if (!$('dirty').hidden) event.preventDefault();
  });

  initSettings({
    el,
    toast,
    getOptions: () => state.options,
    setOptions: options => {
      state.options = options;
      applyAppearance();
    },
    getPreference,
    setPreference,
    onHostsChanged: () => loadHosts()
  });
}

async function start() {
  applyTranslations(document);
  bindInputs();
  try {
    const [status, options] = await Promise.all([api('notes_status'), fetch('/api/options').then(r => r.json())]);
    $('version').textContent = `v${status.version}`;
    state.options = options;
    const remembered = getPreference('layout');
    state.layout = LAYOUTS.includes(remembered) ? remembered : LAYOUTS.includes(options.layout) ? options.layout : DEFAULT_LAYOUT;
    loadDocument(newDocument(), { source: null, facts: null, original: null });
    applyAppearance();
    await loadHosts();
  } catch (error) {
    showMessage([['service.down', { error: error.message }]], 'bad');
  }
}

start();
