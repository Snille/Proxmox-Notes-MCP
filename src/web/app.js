import {
  DEFAULT_LAYOUT,
  fromLegacyJson,
  LAYOUTS,
  parseNotes,
  PROXMOX_DESCRIPTION_LIMIT,
  renderNotes,
  SCHEMA
} from '/format/index.mjs';
import { embedImage, fetchIconSetImage } from './icons.js';
import { renderPreview } from './preview.js';

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
  original: null
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
  toastTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

function banner(message, kind = 'info') {
  const box = $('banner');
  box.hidden = !message;
  box.className = `banner ${kind}`;
  box.textContent = message ?? '';
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LAYOUT_NAMES = { table: 'full-width table', markdown: 'Markdown (old generator)' };

const slug = value => String(value ?? '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'note';
const clone = value => structuredClone(value);

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

function iconSetUrl(key) {
  const set = state.options?.iconSet;
  if (!set?.baseUrl || !key) return null;
  return `${set.baseUrl.replace(/\/$/, '')}/${key}${set.width}x${set.height}${set.extension ?? '.png'}`;
}

// ---------- loading a Note into the editor ----------

function loadDocument(doc, { source = state.source, facts = state.facts, original = null, message = null } = {}) {
  state.mode = 'form';
  state.doc = doc;
  state.source = source;
  state.facts = facts;
  state.original = original;
  banner(message, 'info');
  renderEditor();
}

function loadRaw(markdown, { source = state.source, facts = state.facts, original = markdown, message } = {}) {
  state.mode = 'raw';
  state.raw = markdown;
  state.source = source;
  state.facts = facts;
  state.original = original;
  banner(message, 'warn');
  renderEditor();
}

async function openGuest(guest) {
  try {
    const result = await api('notes_read', { host: state.host, vmid: guest.vmid });
    const source = { host: state.host, vmid: guest.vmid, name: guest.name, type: guest.type };
    if (result.empty) {
      const prefill = await api('notes_prefill', { host: state.host, vmid: guest.vmid });
      loadDocument(prefill.doc, { source, facts: result.facts, original: '', message: 'This guest has no Notes yet. A new Note was filled in from the template and from Proxmox.' });
    } else if (result.parsed.ok) {
      const messages = [];
      if (result.parsed.layout !== state.layout) {
        messages.push(`These Notes use the ${LAYOUT_NAMES[result.parsed.layout]} layout; they are written in the ${LAYOUT_NAMES[state.layout]} layout when saved.`);
      }
      if (result.parsed.warnings.length) {
        messages.push(`Read with notes: ${result.parsed.warnings.join(' ')}`);
      }
      // Compare against the Note as this tool writes it in its own layout, so small differences
      // in how Proxmox stored it are not a change, but a change of layout is.
      loadDocument(result.parsed.doc, { source, facts: result.facts, original: renderNotes(result.parsed.doc, { layout: result.parsed.layout }), message: messages.join(' ') || null });
    } else {
      loadRaw(result.markdown, { source, facts: result.facts, message: `These Notes do not follow the Notes format (line ${result.parsed.line}: ${result.parsed.error}). They are shown as raw text.` });
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
    $('iconKey').value = doc.image?.key ?? '';
    $('embed').checked = doc.image ? doc.image.src.startsWith('data:') : $('embed').checked;
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
    const addField = el('button', { type: 'button', class: 'small', text: isServices ? '+ Link' : '+ Row', onclick: () => {
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
  const change = (key) => (event) => { row[key] = event.target.value; update(); };
  const move = (delta) => () => {
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
      el('input', { type: 'text', class: 'key', value: row.key, placeholder: 'Key', 'aria-label': 'Key', oninput: change('key') }),
      el('input', { type: 'text', class: 'value', value: row.value, placeholder: 'Value', 'aria-label': 'Value', oninput: change('value') })
    ];
  } else if (row.type === 'link') {
    inputs = [
      el('input', { type: 'text', class: 'key', value: row.name, placeholder: 'Name', 'aria-label': 'Link name', oninput: change('name') }),
      el('input', { type: 'text', class: 'value', value: row.url, placeholder: 'https://', 'aria-label': 'Link URL', oninput: change('url') })
    ];
  } else {
    inputs = [el('input', { type: 'text', class: 'value wide', value: row.text, placeholder: 'Text', 'aria-label': 'Text', oninput: change('text') })];
  }
  return el('div', { class: 'row-item' }, [
    ...inputs,
    el('button', { type: 'button', class: 'icon', title: 'Move up', onclick: move(-1) }, [el('i', { class: 'fa fa-arrow-up' })]),
    el('button', { type: 'button', class: 'icon', title: 'Move down', onclick: move(1) }, [el('i', { class: 'fa fa-arrow-down' })]),
    el('button', { type: 'button', class: 'icon danger', title: 'Remove row', onclick: remove }, [el('i', { class: 'fa fa-times' })])
  ]);
}

function renderFacts() {
  const box = $('factsBox');
  const facts = state.facts;
  box.hidden = !facts || state.mode !== 'form';
  if (box.hidden) return;
  const parts = [
    `Hostname ${facts.hostname || '?'}`,
    `IP ${facts.ip || 'unknown'}`,
    `MAC ${facts.mac || 'unknown'}`,
    `DHCP ${facts.dhcp === null ? 'unknown' : facts.dhcp ? 'Yes' : 'No'}`,
    `OS ${facts.os || 'unknown'}`
  ];
  $('factsText').textContent = parts.join(' · ');
}

function renderContext() {
  const label = $('contextLabel');
  if (state.source) {
    label.textContent = `${state.source.host} · ${state.source.type === 'lxc' ? 'CT' : 'VM'} ${state.source.vmid} · ${state.source.name}`;
    label.classList.remove('muted');
  } else {
    label.textContent = 'Not linked to a guest. Export it as JSON or copy the Markdown.';
    label.classList.add('muted');
  }
  $('btnSave').disabled = !state.source;
  $('btnSave').title = state.source ? `Write these Notes to ${state.source.name} (a preview comes first)` : 'Open a guest to save its Notes';
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
      toast('Proxmox already has exactly these Notes. Nothing to save.');
      return;
    }
    pendingWrite = prepared;
    const target = `${state.source.type === 'lxc' ? 'CT' : 'VM'} ${prepared.guest.vmid} (${prepared.guest.name}) on ${state.source.host}`;
    $('saveSummary').textContent = `Write ${prepared.length} of ${prepared.limit} characters to ${target}.`;
    $('saveCurrent').replaceChildren(prepared.current.trim() ? renderPreview(prepared.current) : el('p', { class: 'muted', text: '(empty)' }));
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
    banner(null);
    update();
    toast(`Saved to ${state.source.name}. The previous Notes are kept as snapshot ${result.snapshot}.`);
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
  list.replaceChildren(el('li', { class: 'muted', text: 'Loading…' }));
  $('historyDialog').showModal();
  try {
    const { snapshots } = await api('notes_snapshots', { host: source.host, vmid: source.vmid });
    list.replaceChildren();
    if (!snapshots.length) {
      list.append(el('li', { class: 'muted', text: 'No snapshots yet. One is kept every time these Notes are saved from here.' }));
    }
    for (const snapshot of snapshots) {
      list.append(el('li', {}, [
        el('span', { class: 'when', text: new Date(snapshot.takenAt).toLocaleString() }),
        el('span', { class: 'muted small', text: `${snapshot.length} characters` }),
        el('button', { type: 'button', class: 'small', text: 'Load into editor', onclick: () => loadSnapshot(source, snapshot.id) })
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
    const when = new Date(snapshot.takenAt).toLocaleString();
    const message = `Loaded the snapshot from ${when}. Save to put it back in Proxmox.`;
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
  $('sizeText').textContent = `${length} of ${PROXMOX_DESCRIPTION_LIMIT} characters${length > PROXMOX_DESCRIPTION_LIMIT ? ' — too long for Proxmox' : ''}`;
  const normalize = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');
  $('dirty').hidden = state.original === null || normalize(markdown) === normalize(state.original);
  renderIcon();
}

function renderIcon() {
  const thumb = $('iconThumb');
  const image = state.mode === 'form' ? state.doc?.image : null;
  thumb.replaceChildren(image?.src ? el('img', { src: image.src, alt: 'Icon' }) : el('i', { class: 'fa fa-picture-o' }));
  if (!image?.src) {
    $('iconInfo').textContent = 'No icon.';
  } else if (image.src.startsWith('data:')) {
    $('iconInfo').textContent = `Embedded, ${image.src.length} characters (${image.width}×${image.height}).`;
  } else {
    $('iconInfo').textContent = `Linked from ${image.src}`;
  }
}

// ---------- icons ----------

// Characters left for an embedded image: the limit minus the Note without an image.
function imageBudget() {
  const withoutImage = renderNotes({ ...state.doc, image: { src: '', width: 1, height: 1 } }, { layout: state.layout }).length;
  return PROXMOX_DESCRIPTION_LIMIT - withoutImage - 64;
}

async function setImageFromBlob(blob, key) {
  const { width = 100, height = 100 } = state.options?.iconSet ?? {};
  const result = await embedImage(blob, { width, height, budget: imageBudget() });
  state.doc.image = { src: result.src, width, height, ...(key ? { key } : {}) };
  update();
  toast(`Icon embedded as ${result.format}${result.quality ? ` (quality ${Math.round(result.quality * 100)})` : ''}, ${result.length} characters.`);
}

async function applyIconKey() {
  const key = $('iconKey').value;
  if (!key) {
    return;
  }
  const { width = 100, height = 100 } = state.options?.iconSet ?? {};
  try {
    if ($('embed').checked) {
      await setImageFromBlob(await fetchIconSetImage(key), key);
    } else {
      state.doc.image = { src: iconSetUrl(key), width, height, key };
      update();
    }
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function fillIconKeys() {
  const select = $('iconKey');
  const images = state.options?.images ?? [];
  select.replaceChildren(el('option', { value: '', text: images.length ? '— choose —' : '— no icon set configured —' }));
  for (const image of images) {
    select.append(el('option', { value: image.key, text: image.label }));
  }
  select.disabled = !state.options?.iconSet?.baseUrl || images.length === 0;
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
    changed.push(`${row.key}: ${row.value || '(empty)'} → ${value}`);
    row.value = value;
  }
  // Service links usually point at the old address; move them along with it.
  if (oldIp && facts.ip) {
    for (const row of state.doc.sections.flatMap(s => s.rows)) {
      if (row.type === 'link' && row.url.includes(`//${oldIp}`)) {
        row.url = row.url.replace(`//${oldIp}`, `//${facts.ip}`);
        changed.push(`Link ${row.name} → ${row.url}`);
      }
    }
  }
  renderSections();
  update();
  toast(changed.length ? `Updated: ${changed.join('; ')}` : 'Already up to date with Proxmox.');
}

// ---------- guest list ----------

async function loadHosts() {
  const { hosts } = await api('notes_hosts');
  state.hosts = hosts;
  const select = $('hostSelect');
  select.replaceChildren();
  for (const host of hosts) {
    select.append(el('option', { value: host.id, text: `${host.name}${host.tls === 'insecure' ? ' (TLS not checked)' : ''}` }));
  }
  if (!hosts.length) {
    select.append(el('option', { value: '', text: 'No Proxmox host configured' }));
    select.disabled = true;
    $('guestMessage').textContent = 'Add a host in targets.json (see the README) to read guests.';
    return;
  }
  let remembered = '';
  try { remembered = localStorage.getItem('proxmox-notes.host') ?? ''; } catch { /* storage may be blocked */ }
  state.host = hosts.some(h => h.id === remembered) ? remembered : hosts[0].id;
  select.value = state.host;
  await loadGuests();
}

async function loadGuests() {
  const list = $('guestList');
  $('guestMessage').textContent = 'Loading…';
  list.replaceChildren();
  try {
    const { guests } = await api('notes_guests', { host: state.host, notes: true });
    state.guests = guests;
    $('guestMessage').textContent = guests.length ? '' : 'The token sees no guests on this host.';
    renderGuests();
  } catch (error) {
    state.guests = [];
    $('guestMessage').textContent = error.message;
  }
}

const NOTE_BADGES = {
  format: { text: 'Notes', class: 'ok', title: 'Notes in the Notes format' },
  other: { text: 'Other', class: 'warn', title: 'Notes that do not follow the format' },
  empty: { text: 'Empty', class: 'muted', title: 'No Notes yet' },
  error: { text: 'Error', class: 'bad', title: 'The config could not be read' }
};

function renderGuests() {
  const filter = $('guestFilter').value.trim().toLowerCase();
  const list = $('guestList');
  list.replaceChildren();
  for (const guest of state.guests) {
    const text = `${guest.vmid} ${guest.name} ${guest.noteTitle ?? ''} ${guest.tags.join(' ')}`.toLowerCase();
    if (filter && !text.includes(filter)) continue;
    const badge = NOTE_BADGES[guest.notes] ?? null;
    const item = el('li', {}, [
      el('button', { type: 'button', class: 'guest', 'data-vmid': guest.vmid, title: guest.noteTitle || guest.name, onclick: () => openGuest(guest) }, [
        el('i', { class: `fa ${guest.type === 'lxc' ? 'fa-cube' : 'fa-desktop'} status-${guest.status}` }),
        el('span', { class: 'vmid', text: String(guest.vmid) }),
        el('span', { class: 'name', text: guest.name }),
        badge ? el('span', { class: `badge ${badge.class}`, text: badge.text, title: badge.title }) : null
      ])
    ]);
    list.append(item);
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
      throw new Error('The file is not valid JSON');
    }
    if (data.schema === SCHEMA && Array.isArray(data.sections)) {
      loadDocument(data, { original: state.original, message: `Imported ${file.name}.` });
      return;
    }
    if (data.h && data.sections) {
      const set = state.options?.iconSet ?? {};
      const doc = fromLegacyJson(data, { imageFqdn: set.baseUrl ?? '', imageWidth: set.width ?? 100, imageHeight: set.height ?? 100 });
      loadDocument(doc, { original: state.original, message: `Imported ${file.name} from the old Notes Generator.` });
      return;
    }
    throw new Error('This JSON is neither a Proxmox Notes document nor a Notes Generator file');
  }
  const parsed = parseNotes(text);
  if (parsed.ok) {
    loadDocument(parsed.doc, { original: state.original, message: `Imported ${file.name}.` });
  } else {
    loadRaw(text, { original: state.original, message: `${file.name} does not follow the Notes format (line ${parsed.line}: ${parsed.error}). It is shown as raw text.` });
  }
}

function exportJson() {
  if (state.mode === 'raw') {
    download(`${slug(state.source?.name)}.md`, state.raw, 'text/markdown');
    toast('Raw text exported as Markdown, because it is not in the Notes format.');
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
  toast(`Markdown copied (${markdown.length} characters).`);
}

// ---------- wiring ----------

function bindInputs() {
  $('headerIcon').addEventListener('change', e => { state.doc.headerIcon = e.target.value; update(); });
  $('title').addEventListener('input', e => { state.doc.title = e.target.value; update(); });
  $('description').addEventListener('input', e => { state.doc.description = e.target.value; update(); });
  $('notes').addEventListener('input', e => { state.doc.notes = e.target.value; update(); });
  $('raw').addEventListener('input', e => { state.raw = e.target.value; update(); });
  $('iconKey').addEventListener('change', applyIconKey);
  $('embed').addEventListener('change', () => { if ($('iconKey').value) applyIconKey(); });
  $('iconUpload').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      $('iconKey').value = '';
      await setImageFromBlob(file, null);
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  $('btnIconRemove').addEventListener('click', () => { state.doc.image = null; $('iconKey').value = ''; update(); });
  $('btnApplyFacts').addEventListener('click', applyFacts);

  $('btnRawParse').addEventListener('click', () => {
    const parsed = parseNotes(state.raw);
    if (parsed.ok) loadDocument(parsed.doc, { original: state.original, message: 'The text now follows the Notes format.' });
    else toast(`Still not in the Notes format (line ${parsed.line}: ${parsed.error}).`, 'bad');
  });
  $('btnRawTemplate').addEventListener('click', async () => {
    if (!confirm('Replace the raw text in the editor with a new Note from the template? Proxmox is not changed.')) return;
    if (state.source) {
      const prefill = await api('notes_prefill', { host: state.source.host, vmid: state.source.vmid });
      loadDocument(prefill.doc, { original: state.original, message: 'A new Note was filled in from the template and from Proxmox.' });
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
}

async function start() {
  bindInputs();
  try {
    const [status, options] = await Promise.all([api('notes_status'), fetch('/api/options').then(r => r.json())]);
    $('version').textContent = `v${status.version}`;
    state.options = options;
    let remembered = '';
    try { remembered = localStorage.getItem('proxmox-notes.layout') ?? ''; } catch { /* storage may be blocked */ }
    state.layout = LAYOUTS.includes(remembered) ? remembered : LAYOUTS.includes(options.layout) ? options.layout : DEFAULT_LAYOUT;
    $('layout').replaceChildren(...LAYOUTS.map(value => el('option', { value, text: LAYOUT_NAMES[value] })));
    $('layout').value = state.layout;
    fillIconKeys();
    loadDocument(newDocument(), { source: null, facts: null, original: null });
    await loadHosts();
  } catch (error) {
    banner(`The service did not answer: ${error.message}`, 'bad');
  }
}

start();
