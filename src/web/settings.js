// The settings page: Proxmox hosts, Notes defaults and template, icons, appearance.
// Host secrets go to the server once and are never read back.
import { LAYOUTS } from '/format/index.mjs';
import { LANGUAGES, t } from './i18n.js';
import { addIcon, fontAwesomeNames, labelFromFile, listIcons, matches, openIconDialog, removeIcon, renameIcon, renderGrid } from './library.js';
import { importPack, openExportDialog } from './packs.js';

const $ = id => document.getElementById(id);

let ctx;
let draft = null;
let editingId = null;

async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? response.statusText);
  }
  return data;
}

export function initSettings(context) {
  ctx = context;
  for (const tab of document.querySelectorAll('[data-settings-tab]')) {
    tab.addEventListener('click', () => showTab(tab.dataset.settingsTab));
  }
  $('btnAddHost').addEventListener('click', () => editHost(null));
  $('btnCancelHost').addEventListener('click', closeHostForm);
  $('btnReadCert').addEventListener('click', readCertificate);
  $('btnTestHost').addEventListener('click', testHost);
  $('btnSaveHost').addEventListener('click', saveHost);
  $('hostFingerprint').addEventListener('input', () => { $('hostVerifyTls').disabled = $('hostFingerprint').value.trim() !== ''; });
  for (const button of document.querySelectorAll('.save-options')) {
    button.addEventListener('click', saveOptions);
  }
  $('importSelect').addEventListener('change', importSelect);
  $('librarySearch').addEventListener('input', renderLibrary);
  $('libraryUpload').addEventListener('change', async event => {
    const files = [...event.target.files];
    event.target.value = '';
    await uploadFiles(files);
  });
  const drop = $('libraryDrop');
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async event => {
    event.preventDefault();
    drop.classList.remove('over');
    await uploadFiles([...event.dataTransfer.files].filter(file => file.type.startsWith('image/')));
  });
  $('btnDashboardIcons').addEventListener('click', async () => {
    await openIconDialog({ el: ctx.el, toast: ctx.toast, size: iconSize(), images: draft.images, mode: 'add', tab: 'dashboard', generator: ctx.getOptions().generator, webSets: ctx.getOptions().webSets });
    await loadLibrary();
  });
  $('btnGenerateIcons').addEventListener('click', async () => {
    await openIconDialog({ el: ctx.el, toast: ctx.toast, size: iconSize(), images: draft.images, mode: 'add', tab: 'generate', generator: ctx.getOptions().generator, webSets: ctx.getOptions().webSets });
    await loadLibrary();
  });
  $('btnImportSet').addEventListener('click', importIconSet);
  $('btnSelectShown').addEventListener('click', () => {
    for (const icon of library.filter(item => matches(item, $('librarySearch').value.trim()))) selection.add(icon.id);
    renderLibrary();
  });
  $('btnSelectNone').addEventListener('click', () => { selection.clear(); renderLibrary(); });
  $('btnExportPack').addEventListener('click', () => {
    openExportDialog({ el: ctx.el, toast: ctx.toast, icons: library.filter(icon => selection.has(icon.id)) });
  });
  $('libraryZip').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await importPack({
        file, images: draft.images, size: iconSize(), replace: $('libraryReplace').checked,
        progress: text => { $('libraryProgress').textContent = text; }, toast: ctx.toast
      });
      ctx.toast(result.found ? t('lib.uploadedReplaced', { added: result.added, replaced: result.replaced }) : t('pack.empty'), result.found ? 'ok' : 'bad');
    } catch (error) {
      $('libraryProgress').textContent = '';
      ctx.toast(error.message, 'bad');
    }
    await loadLibrary();
  });
  $('btnAddHeaderIcon').addEventListener('click', openFaDialog);
  $('faSearch').addEventListener('input', renderFaGrid);
  $('faClose').addEventListener('click', () => $('faDialog').close());
  $('btnTestGenerator').addEventListener('click', testGenerator);
  $('btnAddWebSet').addEventListener('click', () => {
    const { width, height, extension } = draft.iconSet;
    draft.webSets.push({ name: t('web.newSet'), baseUrl: '', width, height, extension });
    renderWebSets();
  });
  $('btnAddStyle').addEventListener('click', addStyle);
  $('genWorkflowFile').addEventListener('change', loadWorkflowFile);
  for (const radio of document.querySelectorAll('input[name="genMode"]')) radio.addEventListener('change', showGeneratorMode);
  $('myTheme').addEventListener('change', e => { ctx.setPreference('theme', e.target.value); });
  $('myLanguage').addEventListener('change', e => { ctx.setPreference('language', e.target.value); });
}

function showTab(name) {
  for (const tab of document.querySelectorAll('[data-settings-tab]')) {
    tab.classList.toggle('active', tab.dataset.settingsTab === name);
  }
  for (const page of document.querySelectorAll('[data-settings-page]')) {
    page.hidden = page.dataset.settingsPage !== name;
  }
}

export async function openSettings() {
  draft = structuredClone(ctx.getOptions());
  fillOptionForms();
  closeHostForm();
  await Promise.all([loadHosts(), loadLibrary()]);
}

// Re-renders the parts built in code after a language change.
export function refreshSettings() {
  if (!draft) return;
  const layout = $('optLayout').value;
  $('optLayout').replaceChildren(...LAYOUTS.map(value => ctx.el('option', { value, text: t(`layout.${value}`) })));
  $('optLayout').value = layout;
  fillAppearance();
  renderTemplate();
  renderHeaderIcons();
  renderLibrary();
  renderStyles();
  renderWebSets();
  loadHosts();
}

// ---------- hosts ----------

const TLS_TEXT = { pinned: 'set.tlsPinned', verified: 'set.tlsVerified', insecure: 'set.tlsInsecure' };

async function loadHosts() {
  const list = $('hostList');
  try {
    const { hosts } = await request('GET', '/api/settings/hosts');
    list.replaceChildren();
    if (!hosts.length) {
      list.append(ctx.el('li', { class: 'muted', text: t('set.noHosts') }));
    }
    for (const host of hosts) {
      list.append(ctx.el('li', { class: 'host-card' }, [
        ctx.el('div', { class: 'host-main' }, [
          ctx.el('strong', { text: host.name }),
          ctx.el('span', { class: 'muted small', text: ` ${host.id} · ${host.baseUrl} · ${host.tokenId}` }),
          ctx.el('div', { class: 'small' }, [
            ctx.el('span', { class: `badge ${host.tls === 'insecure' ? 'warn' : 'ok'}`, text: t(TLS_TEXT[host.tls]) }),
            ' ',
            ctx.el('span', { class: 'badge muted', text: t(host.secretSource === 'file' ? 'set.secretFile' : 'set.secretStored') })
          ])
        ]),
        ctx.el('button', { type: 'button', class: 'small', onclick: () => editHost(host) }, [ctx.el('i', { class: 'fa fa-pencil' }), ` ${t('edit')}`]),
        ctx.el('button', { type: 'button', class: 'small danger', onclick: () => removeHost(host) }, [ctx.el('i', { class: 'fa fa-trash' }), ` ${t('remove')}`])
      ]));
    }
  } catch (error) {
    list.replaceChildren(ctx.el('li', { class: 'muted', text: error.message }));
  }
}

function editHost(host) {
  editingId = host?.id ?? null;
  $('hostForm').hidden = false;
  $('hostFormTitle').textContent = host ? t('set.editHost', { name: host.name }) : t('set.addHost');
  $('hostId').value = host?.id ?? '';
  $('hostId').readOnly = Boolean(host);
  $('hostName').value = host?.name ?? '';
  $('hostUrl').value = host?.baseUrl ?? '';
  $('hostTokenId').value = host?.tokenId ?? 'proxmox-notes@pve!notes';
  $('hostTokenSecret').value = '';
  $('hostTokenSecret').placeholder = host ? t('set.secretUnchanged') : '';
  $('hostFingerprint').value = host?.fingerprint ?? '';
  $('hostVerifyTls').checked = host ? host.verifyTls : true;
  $('hostVerifyTls').disabled = Boolean(host?.fingerprint);
  $('certInfo').hidden = true;
  $('hostTestResult').textContent = '';
  $('hostForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeHostForm() {
  $('hostForm').hidden = true;
  $('hostTokenSecret').value = '';
  editingId = null;
}

function hostInput() {
  return {
    id: $('hostId').value.trim(),
    name: $('hostName').value.trim() || undefined,
    baseUrl: $('hostUrl').value.trim(),
    tokenId: $('hostTokenId').value.trim(),
    tokenSecret: $('hostTokenSecret').value,
    fingerprint: $('hostFingerprint').value.trim(),
    verifyTls: $('hostVerifyTls').checked
  };
}

async function readCertificate() {
  const box = $('certInfo');
  try {
    const cert = await request('POST', '/api/settings/certificate', { baseUrl: $('hostUrl').value.trim() });
    box.hidden = false;
    box.replaceChildren(
      ctx.el('div', { class: 'small', text: t('set.certSubject', { subject: cert.subject || '?', issuer: cert.issuer || '?', validTo: cert.validTo }) }),
      ctx.el('code', { class: 'fingerprint', text: cert.fingerprint }),
      ctx.el('p', { class: 'small', text: t('set.certCompare') }),
      ctx.el('button', { type: 'button', class: 'small', onclick: () => {
        $('hostFingerprint').value = cert.fingerprint;
        $('hostVerifyTls').disabled = true;
        box.hidden = true;
      } }, [ctx.el('i', { class: 'fa fa-thumb-tack' }), ` ${t('set.usePin')}`])
    );
  } catch (error) {
    box.hidden = false;
    box.replaceChildren(ctx.el('span', { class: 'bad', text: error.message }));
  }
}

async function testHost() {
  const result = $('hostTestResult');
  result.className = 'small';
  result.textContent = t('set.testing');
  try {
    const tested = await request('POST', '/api/settings/hosts/test', hostInput());
    if (tested.ok) {
      const write = tested.canWrite === null ? t('set.writeUnknown') : tested.canWrite ? t('set.writeYes') : t('set.writeNo');
      result.className = 'small ok';
      result.textContent = t('set.testOk', { version: tested.version, guests: tested.guests, write });
    } else {
      result.className = 'small bad';
      result.textContent = tested.error;
    }
  } catch (error) {
    result.className = 'small bad';
    result.textContent = error.message;
  }
}

async function saveHost() {
  const input = hostInput();
  try {
    await request('PUT', `/api/settings/hosts/${encodeURIComponent(input.id)}`, input);
    ctx.toast(t('set.hostSaved', { name: input.name ?? input.id }));
    closeHostForm();
    await loadHosts();
    await ctx.onHostsChanged();
  } catch (error) {
    ctx.toast(error.message, 'bad');
  }
}

async function removeHost(host) {
  if (!confirm(t('set.confirmRemove', { name: host.name }))) return;
  try {
    await request('DELETE', `/api/settings/hosts/${encodeURIComponent(host.id)}`);
    if (editingId === host.id) closeHostForm();
    ctx.toast(t('set.hostRemoved', { name: host.name }));
    await loadHosts();
    await ctx.onHostsChanged();
  } catch (error) {
    ctx.toast(error.message, 'bad');
  }
}

// ---------- Notes and icon options ----------

const pairsToText = (items, a, b) => items.map(item => `${item[a]} = ${item[b]}`).join('\n');
function textToPairs(text, a, b) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const index = line.lastIndexOf('=');
    return index === -1 ? { [a]: line, [b]: '' } : { [a]: line.slice(0, index).trim(), [b]: line.slice(index + 1).trim() };
  });
}

function fillOptionForms() {
  $('optLayout').replaceChildren(...LAYOUTS.map(value => ctx.el('option', { value, text: t(`layout.${value}`) })));
  $('optLayout').value = draft.layout;
  $('optHeaderIcon').replaceChildren(...draft.headerIcons.map(item => ctx.el('option', { value: item.icon, text: item.label })));
  $('optHeaderIcon').value = draft.template.headerIcon;
  $('optOsNames').value = draft.osNames.join('\n');
  $('optIconBase').value = draft.iconSet.baseUrl;
  $('optIconWidth').value = draft.iconSet.width;
  $('optIconHeight').value = draft.iconSet.height;
  $('optIconExt').value = draft.iconSet.extension;
  $('optImages').value = pairsToText(draft.images, 'label', 'key');
  renderHeaderIcons();
  renderTemplate();
  fillAppearance();
  fillGenerator();
  renderWebSets();
}

// ---------- web icon sets ----------

function renderWebSets() {
  const list = draft.webSets;
  $('webSetList').replaceChildren(...list.map((set, index) => {
    const text = (key, attributes = {}) => ctx.el('input', { type: 'text', value: set[key], spellcheck: 'false', ...attributes, oninput: event => { set[key] = event.target.value.trim(); } });
    const number = key => ctx.el('input', { type: 'number', min: 16, max: 1024, value: set[key], oninput: event => { set[key] = Number(event.target.value); } });
    const result = ctx.el('p', { class: 'small' });
    return ctx.el('div', { class: 'style-item' }, [
      ctx.el('div', { class: 'grid-2' }, [
        ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('gen.styleName') }), text('name')]),
        ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('web.address') }), text('baseUrl', { placeholder: 'https://icons.example.com/blue/100x100' })])
      ]),
      ctx.el('div', { class: 'grid-3' }, [
        ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('gen.width') }), number('width')]),
        ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('gen.height') }), number('height')]),
        ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('set.extension') }), text('extension')])
      ]),
      result,
      ctx.el('div', { class: 'row-buttons' }, [
        ctx.el('button', { type: 'button', class: 'small', onclick: () => testWebSet(set, result) }, [ctx.el('i', { class: 'fa fa-plug' }), ctx.el('span', { text: ` ${t('set.test')}` })]),
        ctx.el('button', { type: 'button', class: 'small danger', onclick: () => { list.splice(index, 1); renderWebSets(); } }, [
          ctx.el('i', { class: 'fa fa-trash' }), ctx.el('span', { text: ` ${t('remove')}` })
        ])
      ])
    ]);
  }));
}

async function testWebSet(set, result) {
  result.className = 'small muted';
  result.textContent = t('loading');
  try {
    const found = await request('POST', '/api/web-sets/test', set);
    const sources = found.sources.map(source => t(`web.source.${source}`)).join(', ');
    result.className = found.icons.length ? 'small test-ok' : 'small bad';
    result.textContent = found.icons.length ? t('web.found', { count: found.icons.length, sources }) : t('web.none');
  } catch (error) {
    result.className = 'small bad';
    result.textContent = error.message;
  }
}

// ---------- image generator ----------

const RECIPE_FIELDS = {
  unet: 'genUnet', clip: 'genClip', lora: 'genLora', vae: 'genVae', loraStrength: 'genLoraStrength', steps: 'genSteps',
  cfg: 'genCfg', sampler: 'genSampler', scheduler: 'genScheduler', shift: 'genShift', width: 'genWidth', height: 'genHeight',
  removeBackground: 'genBackground'
};

function fillGenerator() {
  const generator = draft.generator;
  $('genHosts').value = generator.hosts.join('\n');
  for (const radio of document.querySelectorAll('input[name="genMode"]')) radio.checked = radio.value === generator.mode;
  for (const [key, id] of Object.entries(RECIPE_FIELDS)) $(id).value = generator.recipe[key];
  $('genWorkflow').value = generator.workflow;
  $('genDefaultCount').value = generator.count;
  $('genTimeout').value = generator.timeoutSeconds;
  $('genTestResult').replaceChildren();
  showGeneratorMode();
  renderStyles();
}

function showGeneratorMode() {
  const own = document.querySelector('input[name="genMode"]:checked')?.value === 'workflow';
  $('genRecipe').hidden = own;
  $('genOwn').hidden = !own;
}

function collectGenerator() {
  const recipe = {};
  for (const [key, id] of Object.entries(RECIPE_FIELDS)) {
    const input = $(id);
    recipe[key] = input.type === 'number' ? Number(input.value) : input.value.trim();
  }
  return {
    hosts: $('genHosts').value.split('\n').map(line => line.trim().replace(/\/+$/, '')).filter(Boolean),
    mode: document.querySelector('input[name="genMode"]:checked')?.value ?? 'recipe',
    count: Number($('genDefaultCount').value),
    timeoutSeconds: Number($('genTimeout').value),
    recipe,
    workflow: $('genWorkflow').value.trim(),
    styles: draft.generator.styles
  };
}

function renderStyles() {
  const box = $('genStyles');
  box.replaceChildren(...draft.generator.styles.map((style, index) => {
    const list = draft.generator.styles;
    const move = offset => () => {
      list.splice(index + offset, 0, list.splice(index, 1)[0]);
      renderStyles();
    };
    return ctx.el('div', { class: 'style-item' }, [
      ctx.el('div', { class: 'grid-2' }, [
        ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('gen.styleName') }), ctx.el('input', { type: 'text', value: style.name, oninput: event => { style.name = event.target.value; } })]),
        ctx.el('label', { class: 'check' }, [
          ctx.el('input', { type: 'checkbox', checked: style.checked, onchange: event => { style.checked = event.target.checked; } }),
          ctx.el('span', { text: t('gen.styleChecked') })
        ])
      ]),
      ctx.el('label', { class: 'label' }, [ctx.el('span', { text: t('gen.stylePrompt') }), ctx.el('textarea', { rows: 2, text: style.prompt, oninput: event => { style.prompt = event.target.value; } })]),
      ctx.el('div', { class: 'row-buttons' }, [
        ctx.el('button', { type: 'button', class: 'small icon', title: t('moveUp'), disabled: index === 0, onclick: move(-1) }, [ctx.el('i', { class: 'fa fa-arrow-up' })]),
        ctx.el('button', { type: 'button', class: 'small icon', title: t('moveDown'), disabled: index === list.length - 1, onclick: move(1) }, [ctx.el('i', { class: 'fa fa-arrow-down' })]),
        ctx.el('button', { type: 'button', class: 'small danger', onclick: () => { list.splice(index, 1); renderStyles(); } }, [
          ctx.el('i', { class: 'fa fa-trash' }), ctx.el('span', { text: ` ${t('remove')}` })
        ])
      ])
    ]);
  }));
}

function addStyle() {
  draft.generator.styles.push({ name: t('gen.newStyle'), prompt: '', checked: false });
  renderStyles();
}

async function testGenerator() {
  const list = $('genTestResult');
  list.replaceChildren(ctx.el('li', { class: 'muted small', text: t('loading') }));
  try {
    const { results } = await request('POST', '/api/generator/test', collectGenerator());
    if (!results.length) {
      list.replaceChildren(ctx.el('li', { class: 'bad small', text: t('gen.noHosts') }));
      return;
    }
    list.replaceChildren(...results.map(result => {
      const lines = [ctx.el('strong', { class: result.ok ? 'test-ok' : 'test-bad', text: `${result.ok ? '✓' : '✗'} ${result.url}` })];
      if (result.device) lines.push(ctx.el('div', { class: 'small', text: `ComfyUI ${result.version ?? ''} · ${result.device}` }));
      for (const [key, name] of Object.entries(result.models ?? {})) {
        if (name) lines.push(ctx.el('div', { class: 'small muted', text: `${key}: ${name}` }));
      }
      if (result.missing?.length) lines.push(ctx.el('div', { class: 'small bad', text: t('gen.missing', { names: result.missing.join(', ') }) }));
      if (result.error) lines.push(ctx.el('div', { class: 'small bad', text: result.error }));
      return ctx.el('li', {}, lines);
    }));
  } catch (error) {
    list.replaceChildren(ctx.el('li', { class: 'bad small', text: error.message }));
  }
}

async function loadWorkflowFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) $('genWorkflow').value = await file.text();
}

// ---------- heading icons ----------

function renderHeaderIcons() {
  const box = $('headerIconChips');
  box.replaceChildren(...draft.headerIcons.map((item, index) => ctx.el('span', { class: 'icon-chip', title: item.icon }, [
    ctx.el('i', { class: `fa ${item.icon}` }),
    ` ${item.label} `,
    ctx.el('button', { type: 'button', class: 'chip-remove', title: t('remove'), 'aria-label': `${t('remove')} ${item.label}`, onclick: () => {
      draft.headerIcons.splice(index, 1);
      renderHeaderIcons();
      fillDefaultHeaderIcon();
    } }, [ctx.el('i', { class: 'fa fa-times' })])
  ])));
}

function fillDefaultHeaderIcon() {
  const current = $('optHeaderIcon').value || draft.template.headerIcon;
  $('optHeaderIcon').replaceChildren(...draft.headerIcons.map(item => ctx.el('option', { value: item.icon, text: item.label })));
  $('optHeaderIcon').value = current;
}

async function openFaDialog() {
  $('faSearch').value = '';
  $('faDialog').showModal();
  await renderFaGrid();
}

async function renderFaGrid() {
  const filter = $('faSearch').value.trim().toLowerCase();
  const names = (await fontAwesomeNames()).filter(name => !filter || name.includes(filter));
  $('faGrid').replaceChildren(...names.map(name => ctx.el('button', { type: 'button', class: 'fa-choice', title: `fa-${name}`, onclick: () => {
    const label = prompt(t('lib.faLabel'), name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    if (!label || !label.trim()) return;
    if (!draft.headerIcons.some(item => item.icon === `fa-${name}`)) {
      draft.headerIcons.push({ label: label.trim(), icon: `fa-${name}` });
    }
    renderHeaderIcons();
    fillDefaultHeaderIcon();
    $('faDialog').close();
  } }, [ctx.el('i', { class: `fa fa-${name}` }), ctx.el('span', { text: name })])));
}

// ---------- icon library ----------

let library = [];
// Icons chosen for a download as a pack; kept while the list is filtered.
const selection = new Set();

function updateExportButton() {
  for (const id of selection) if (!library.some(icon => icon.id === id)) selection.delete(id);
  $('btnExportPack').disabled = selection.size === 0;
  $('exportPackLabel').textContent = selection.size ? t('pack.downloadCount', { count: selection.size }) : t('pack.download');
}

const iconSize = () => ({
  width: Number($('optIconWidth').value) || draft?.iconSet.width || 100,
  height: Number($('optIconHeight').value) || draft?.iconSet.height || 100
});

async function loadLibrary() {
  try {
    library = (await listIcons()).icons;
    renderLibrary();
  } catch (error) {
    ctx.toast(error.message, 'bad');
  }
}

function renderLibrary() {
  const filter = $('librarySearch').value.trim();
  const shown = library.filter(icon => matches(icon, filter));
  $('libraryCount').textContent = t('lib.count', { shown: shown.length, total: library.length });
  updateExportButton();
  renderGrid($('libraryGrid'), shown, {
    el: ctx.el,
    selection,
    onSelect: updateExportButton,
    emptyText: library.length ? t('lib.noMatch') : t('lib.empty'),
    onRename: async (icon, label) => {
      try {
        await renameIcon(icon.id, label);
        await loadLibrary();
      } catch (error) {
        ctx.toast(error.message, 'bad');
      }
    },
    onRemove: async icon => {
      try {
        await removeIcon(icon.id);
        ctx.toast(t('lib.removed', { name: icon.label }));
        await loadLibrary();
      } catch (error) {
        ctx.toast(error.message, 'bad');
      }
    }
  });
}

async function uploadFiles(files) {
  let added = 0;
  let replaced = 0;
  const progress = $('libraryProgress');
  for (const [index, file] of files.entries()) {
    progress.textContent = files.length > 1 ? t('lib.uploading', { done: index, total: files.length }) : '';
    try {
      const icon = await addIcon({ label: labelFromFile(file.name, draft.images), blob: file, source: `upload:${file.name}`, size: iconSize(), replace: $('libraryReplace').checked });
      if (icon.replaced) replaced++;
      else added++;
    } catch (error) {
      ctx.toast(`${file.name}: ${error.message}`, 'bad');
    }
  }
  progress.textContent = '';
  if (added || replaced) ctx.toast(t('lib.uploadedReplaced', { added, replaced }));
  await loadLibrary();
}

// Copies every listed icon from the web icon set into the library, skipping names already there.
// The icon-set settings are saved first, because the server only fetches from the saved address.
async function importIconSet() {
  const progress = $('importProgress');
  const images = textToPairs($('optImages').value, 'label', 'key').filter(image => image.key);
  if (!$('optIconBase').value.trim() || !images.length) {
    progress.className = 'small bad';
    progress.textContent = t('lib.importNothing');
    return;
  }
  try {
    const saved = await request('PUT', '/api/options', collectOptions());
    draft = structuredClone(saved);
    ctx.setOptions(saved);
  } catch (error) {
    progress.className = 'small bad';
    progress.textContent = error.message;
    return;
  }
  const existing = new Set(library.map(icon => icon.source));
  let done = 0;
  let added = 0;
  const failed = [];
  progress.className = 'small';
  for (const image of images) {
    progress.textContent = t('lib.importing', { done, total: images.length });
    const source = `icon-set:${image.key}`;
    if (!existing.has(source)) {
      try {
        const response = await fetch(`/api/icon?key=${encodeURIComponent(image.key)}`);
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
        await addIcon({ label: image.label, blob: await response.blob(), source, size: iconSize() });
        added++;
      } catch {
        failed.push(image.label);
      }
    }
    done++;
  }
  progress.className = failed.length ? 'small bad' : 'small ok';
  progress.textContent = t('lib.imported', { added, skipped: images.length - added - failed.length, failed: failed.length })
    + (failed.length ? ` ${failed.join(', ')}` : '');
  await loadLibrary();
}

function renderTemplate() {
  const container = $('templateSections');
  container.replaceChildren();
  for (const section of draft.template.sections) {
    const rows = ctx.el('div', { class: 'rows' });
    section.rows.forEach((row, index) => {
      const isLink = row.type === 'link';
      const first = isLink ? 'name' : row.type === 'field' ? 'key' : 'text';
      const inputs = [ctx.el('input', { type: 'text', class: 'key', value: row[first], 'aria-label': t(isLink ? 'linkName' : 'key'), oninput: e => { row[first] = e.target.value; } })];
      if (row.type !== 'text') {
        const second = isLink ? 'url' : 'value';
        inputs.push(ctx.el('input', { type: 'text', class: 'value', value: row[second], placeholder: t(isLink ? 'linkUrl' : 'set.defaultValue'), 'aria-label': t(isLink ? 'linkUrl' : 'set.defaultValue'), oninput: e => { row[second] = e.target.value; } }));
      }
      rows.append(ctx.el('div', { class: 'row-item template-row' }, [
        ...inputs,
        ctx.el('button', { type: 'button', class: 'icon danger', title: t('removeRow'), onclick: () => { section.rows.splice(index, 1); renderTemplate(); } }, [ctx.el('i', { class: 'fa fa-times' })])
      ]));
    });
    const isServices = section.id === 'services';
    container.append(ctx.el('div', { class: 'template-section' }, [
      ctx.el('h3', {}, [ctx.el('i', { class: `fa ${section.icon}` }), ` ${section.title}`]),
      rows,
      ctx.el('div', { class: 'row-buttons' }, [ctx.el('button', { type: 'button', class: 'small', text: isServices ? t('addLink') : t('addRow'), onclick: () => {
        section.rows.push(isServices ? { type: 'link', name: '', url: 'https://' } : { type: 'field', key: '', value: '' });
        renderTemplate();
      } })])
    ]));
  }
}

function fillAppearance() {
  const themes = ['system', 'dark', 'light'];
  const fill = (select, values, label, withDefault) => {
    const options = values.map(value => ctx.el('option', { value, text: label(value) }));
    if (withDefault) options.unshift(ctx.el('option', { value: '', text: t('set.useDefault') }));
    select.replaceChildren(...options);
  };
  fill($('myTheme'), themes, value => t(`theme.${value}`), true);
  fill($('myLanguage'), Object.keys(LANGUAGES), value => LANGUAGES[value], true);
  fill($('optTheme'), themes, value => t(`theme.${value}`), false);
  fill($('optLanguage'), Object.keys(LANGUAGES), value => LANGUAGES[value], false);
  $('myTheme').value = ctx.getPreference('theme');
  $('myLanguage').value = ctx.getPreference('language');
  $('optTheme').value = draft.appearance.theme;
  $('optLanguage').value = draft.appearance.language;
}

function collectOptions() {
  return {
    ...draft,
    layout: $('optLayout').value,
    osNames: $('optOsNames').value.split('\n').map(line => line.trim()).filter(Boolean),
    iconSet: {
      baseUrl: $('optIconBase').value.trim(),
      width: Number($('optIconWidth').value),
      height: Number($('optIconHeight').value),
      extension: $('optIconExt').value.trim()
    },
    images: textToPairs($('optImages').value, 'label', 'key'),
    headerIcons: draft.headerIcons,
    template: { ...draft.template, headerIcon: $('optHeaderIcon').value },
    appearance: { theme: $('optTheme').value, language: $('optLanguage').value },
    generator: collectGenerator()
  };
}

async function saveOptions() {
  try {
    const saved = await request('PUT', '/api/options', collectOptions());
    draft = structuredClone(saved);
    ctx.setOptions(saved);
    fillOptionForms();
    ctx.toast(t('set.saved'));
  } catch (error) {
    ctx.toast(error.message, 'bad');
  }
}

async function importSelect(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const converted = await request('POST', '/api/settings/import-select', { selectJson: JSON.parse(await file.text()) });
    draft = { ...draft, headerIcons: converted.headerIcons, iconSet: converted.iconSet, images: converted.images, osNames: converted.osNames };
    fillOptionForms();
    ctx.toast(t('set.importedSelect'));
  } catch (error) {
    ctx.toast(error.message, 'bad');
  }
}
