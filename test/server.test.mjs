import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.mjs';
import { IconStore } from '../src/icons.mjs';
import { OptionsStore } from '../src/options.mjs';
import { createNotesServer } from '../src/server.mjs';
import { Proxmox } from '../src/proxmox/index.mjs';
import { SnapshotStore } from '../src/snapshots.mjs';
import { buildTools } from '../src/tools.mjs';
import { version } from '../src/version.mjs';

const sonarr = await readFile(new URL('../reference/examples/Sonarr02.md', import.meta.url), 'utf8');
let server;

async function start(env = {}, prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), 'proxmox-notes-'));
  if (prepare) {
    await prepare(dataDir);
  }
  const settings = loadSettings({ DATA_DIR: dataDir, ...env });
  const options = await OptionsStore.open(dataDir);
  const proxmox = await Proxmox.open(join(dataDir, 'targets.json'));
  const icons = await IconStore.open(dataDir);
  server = createNotesServer({ settings, options, proxmox, icons, tools: buildTools({ options, proxmox, icons, snapshots: new SnapshotStore(dataDir) }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, dataDir };
}

const post = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
});

describe('HTTP', () => {
  it('reports health and serves the web page with a CSP', async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/health/live`)).json()).toEqual({ ok: true, version });
    const page = await fetch(`${base}/`);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await page.text()).toContain('<title>Proxmox Notes</title>');
  });

  it('serves the format modules to the browser and nothing outside the web roots', async () => {
    const { base } = await start();
    const module = await fetch(`${base}/format/render.mjs`);
    expect(module.headers.get('content-type')).toContain('text/javascript');
    expect(await module.text()).toContain('export function renderNotes');
    expect((await fetch(`${base}/vendor/font-awesome/fonts/fontawesome-webfont.woff2?v=4.7.0`)).headers.get('content-type')).toBe('font/woff2');
    for (const path of ['/..%2fpackage.json', '/format/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/server.mjs']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });

  it('refuses an icon request without a valid key or icon set', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/icon?key=sonarr01-`)).status).toBe(400);
    expect((await fetch(`${base}/api/icon?key=../../etc`)).status).toBe(400);
  });

  it('parses and renders through the REST tools', async () => {
    const { base } = await start();
    const parsed = await (await post(base, '/api/tools/notes_parse', { markdown: sonarr })).json();
    expect(parsed.ok).toBe(true);
    const rendered = await (await post(base, '/api/tools/notes_render', { doc: parsed.doc })).json();
    expect(rendered).toMatchObject({ fits: true, limit: 8192 });
    expect(rendered.markdown).toContain('width="100" height="100"');
  });

  it('rejects invalid arguments with 400 and unknown tools with 404', async () => {
    const { base } = await start();
    const bad = await post(base, '/api/tools/notes_render', { doc: { title: 1 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Invalid arguments/);
    expect((await post(base, '/api/tools/nope', {})).status).toBe(404);
  });

  it('refuses a request from a page on another site', async () => {
    const { base } = await start();
    const response = await post(base, '/api/tools/notes_status', {}, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    const same = await post(base, '/api/tools/notes_status', {}, { origin: base });
    expect(same.status).toBe(200);
  });

  it('refuses an unknown Host header when ALLOWED_HOSTS is set', async () => {
    const { base } = await start({ ALLOWED_HOSTS: 'notes.example.com' });
    expect((await fetch(`${base}/health/live`)).status).toBe(403);
  });
});

describe('options', () => {
  it('converts a select.json from the original generator on first start', async () => {
    const select = await readFile(new URL('../reference/select.json', import.meta.url), 'utf8');
    const { base } = await start({}, dataDir => writeFile(join(dataDir, 'select.json'), select));
    const options = await (await fetch(`${base}/api/options`)).json();
    expect(options.iconSet).toEqual({ baseUrl: 'https://icons.example.com/proxmox/icons/blue/100x100', width: 100, height: 100, extension: '.png' });
    expect(options.images).toContainEqual({ label: 'Default 01', key: 'default01-' });
    expect(options.headerIcons).toContainEqual({ label: 'Linux', icon: 'fa-linux' });
  });

  it('saves options to options.json', async () => {
    const { base, dataDir } = await start();
    const current = await (await fetch(`${base}/api/options`)).json();
    current.osNames = ['Debian 14'];
    const saved = await fetch(`${base}/api/options`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(current) });
    expect(saved.status).toBe(200);
    expect(JSON.parse(await readFile(join(dataDir, 'options.json'), 'utf8')).osNames).toEqual(['Debian 14']);
    const bad = await fetch(`${base}/api/options`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '[1]' });
    expect(bad.status).toBe(400);
  });
});

describe('MCP', () => {
  it('lists the tools and renders a Note', async () => {
    const { base } = await start();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['notes_guests', 'notes_hosts', 'notes_icon_generate', 'notes_icon_generation', 'notes_icon_keep', 'notes_icons', 'notes_import_legacy', 'notes_new', 'notes_options', 'notes_parse', 'notes_prefill', 'notes_prepare_write', 'notes_read', 'notes_render', 'notes_snapshot', 'notes_snapshots', 'notes_status', 'notes_write_confirmed']);
    const result = await client.callTool({ name: 'notes_new', arguments: { title: 'Test' } });
    expect(result.structuredContent.doc.title).toBe('Test');
    await client.close();
  });

  it('needs the bearer token when MCP_TOKEN is set', async () => {
    const { base } = await start({ MCP_TOKEN: 'test-token-not-secret' });
    const without = await post(base, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { accept: 'application/json, text/event-stream' });
    expect(without.status).toBe(401);

    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: 'Bearer test-token-not-secret' } }
    }));
    expect((await client.listTools()).tools.length).toBe(18);
    await client.close();
  });
});

describe('settings: Proxmox hosts', () => {
  const host = { id: 'pve1', name: 'PVE 1', baseUrl: 'https://127.0.0.1:1', tokenId: 'proxmox-notes@pve!notes', tokenSecret: 'not-a-real-secret', verifyTls: false };
  const put = (base, body, id = body.id) => fetch(`${base}/api/settings/hosts/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('adds, lists without the secret, keeps the secret on update, and removes', async () => {
    const { base, dataDir } = await start();
    expect((await put(base, host)).status).toBe(200);

    const listed = await (await fetch(`${base}/api/settings/hosts`)).json();
    expect(listed.hosts).toEqual([{ id: 'pve1', name: 'PVE 1', baseUrl: 'https://127.0.0.1:1', tokenId: 'proxmox-notes@pve!notes', tls: 'insecure', fingerprint: '', verifyTls: false, secretSource: 'stored' }]);
    expect(JSON.stringify(listed)).not.toContain('not-a-real-secret');
    expect((await (await post(base, '/api/tools/notes_hosts', {})).json()).hosts.map(h => h.id)).toEqual(['pve1']);

    // An update without a secret keeps the stored one.
    expect((await put(base, { ...host, name: 'Renamed', tokenSecret: '' })).status).toBe(200);
    const file = JSON.parse(await readFile(join(dataDir, 'targets.json'), 'utf8'));
    expect(file.targets[0]).toMatchObject({ name: 'Renamed', tokenSecret: 'not-a-real-secret' });

    expect((await fetch(`${base}/api/settings/hosts/pve1`, { method: 'DELETE' })).status).toBe(200);
    expect((await (await fetch(`${base}/api/settings/hosts`)).json()).hosts).toEqual([]);
    expect((await (await post(base, '/api/tools/notes_hosts', {})).json()).hosts).toEqual([]);
  });

  it('refuses a new host without a secret, http, and a mismatched id', async () => {
    const { base } = await start();
    expect((await put(base, { ...host, tokenSecret: '' })).status).toBe(400);
    expect((await put(base, { ...host, baseUrl: 'http://127.0.0.1:1' })).status).toBe(400);
    expect((await put(base, host, 'other')).status).toBe(400);
  });

  it('reports a host that cannot be reached', async () => {
    const { base } = await start();
    const tested = await (await post(base, '/api/settings/hosts/test', host)).json();
    expect(tested).toMatchObject({ ok: false });
    expect(tested.error).toMatch(/not reachable/);
    expect((await post(base, '/api/settings/certificate', { baseUrl: 'https://127.0.0.1:1' })).status).toBe(502);
  });

  it('is not reachable from a page on another site', async () => {
    const { base } = await start();
    expect((await post(base, '/api/settings/hosts/test', host, { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('options validation', () => {
  it('refuses options that break the form', async () => {
    const { base } = await start();
    const current = await (await fetch(`${base}/api/options`)).json();
    const bad = await fetch(`${base}/api/options`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...current, layout: 'fancy' }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Invalid options/);
    const good = await fetch(`${base}/api/options`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...current, appearance: { theme: 'dark', language: 'sv' } }) });
    expect(good.status).toBe(200);
  });
});

describe('settings: select.json import', () => {
  it('converts the old generator file without saving it', async () => {
    const { base, dataDir } = await start();
    const selectJson = JSON.parse(await readFile(new URL('../reference/select.json', import.meta.url), 'utf8'));
    const response = await post(base, '/api/settings/import-select', { selectJson });
    expect(response.status).toBe(200);
    const converted = await response.json();
    expect(converted.images).toContainEqual({ label: 'Default 01', key: 'default01-' });
    await expect(readFile(join(dataDir, 'options.json'), 'utf8')).rejects.toThrow();
    expect((await post(base, '/api/settings/import-select', { selectJson: { nope: 1 } })).status).toBe(400);
  });
});

describe('icon library', () => {
  // Only the file signature is checked, so a RIFF/WEBP header is enough for a test icon.
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 1)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
  const upload = (base, body) => post(base, '/api/icons', body);

  it('adds, lists, serves, renames and removes an icon', async () => {
    const { base } = await start();
    const added = await (await upload(base, { label: 'Sonarr', webp: webp.toString('base64'), original: png.toString('base64'), width: 100, height: 100, source: 'test' })).json();
    expect(added.icon).toMatchObject({ id: 'sonarr', label: 'Sonarr', width: 100, original: { type: 'image/png' } });

    const second = await (await upload(base, { label: 'Sonarr', webp: webp.toString('base64') })).json();
    expect(second.icon.id).toBe('sonarr-2');

    const listed = await (await fetch(`${base}/api/icons`)).json();
    expect(listed.icons.map(icon => icon.id)).toEqual(['sonarr', 'sonarr-2']);
    expect(listed.size).toEqual({ width: 100, height: 100 });

    const image = await fetch(`${base}/api/icons/sonarr.webp`);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await image.arrayBuffer()).equals(webp)).toBe(true);
    expect((await fetch(`${base}/api/icons/sonarr/original`)).headers.get('content-type')).toBe('image/png');

    const renamed = await fetch(`${base}/api/icons/sonarr`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Sonarr TV' }) });
    expect((await renamed.json()).icon.label).toBe('Sonarr TV');

    expect((await fetch(`${base}/api/icons/sonarr-2`, { method: 'DELETE' })).status).toBe(200);
    expect((await (await fetch(`${base}/api/icons`)).json()).icons.map(icon => icon.id)).toEqual(['sonarr']);
    expect((await fetch(`${base}/api/icons/sonarr-2.webp`)).status).toBe(404);
  });

  it('keeps the smaller copies the browser sends with an icon', async () => {
    const { base } = await start();
    const added = await (await upload(base, { label: 'Lidarr', webp: webp.toString('base64'), quality: 0.85, variants: [{ quality: 0.45, webp: webp.toString('base64') }] })).json();
    expect(added.icon).toMatchObject({ id: 'lidarr', quality: 0.85, variants: [{ file: 'lidarr.v1.webp', quality: 0.45 }] });
    expect((await upload(base, { label: 'Bad', webp: webp.toString('base64'), variants: [{ quality: 0.45, webp: png.toString('base64') }] })).status).toBe(400);
    expect((await fetch(`${base}/api/icons/lidarr.v1.webp`)).status).toBe(404);
  });

  it('refuses files that are not raster images, and odd ids', async () => {
    const { base } = await start();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
    expect((await upload(base, { label: 'Bad', webp: svg })).status).toBe(400);
    expect((await upload(base, { label: 'Bad', webp: webp.toString('base64'), original: svg })).status).toBe(400);
    expect((await upload(base, { label: '', webp: webp.toString('base64') })).status).toBe(400);
    expect((await fetch(`${base}/api/icons/..%2f..%2findex.webp`)).status).toBe(404);
  });

  it('embeds a library icon in a new Note over MCP and REST', async () => {
    const { base } = await start();
    await upload(base, { label: 'Radarr', webp: webp.toString('base64'), width: 100, height: 100 });
    const listed = await (await post(base, '/api/tools/notes_icons', { search: 'rad' })).json();
    expect(listed.icons).toEqual([{ id: 'radarr', label: 'Radarr' }]);
    const created = await (await post(base, '/api/tools/notes_new', { title: 'Radarr Server', icon: 'radarr' })).json();
    expect(created.doc.image).toEqual({ src: `data:image/webp;base64,${webp.toString('base64')}`, width: 100, height: 100, key: 'radarr' });
    expect((await post(base, '/api/tools/notes_new', { title: 'x', icon: 'missing' })).status).toBe(404);
  });
});

describe('icon library: replace', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 1)]);
  const webp2 = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(30, 2)]);

  it('replaces an icon with the same name instead of adding a copy, keeping its id and name', async () => {
    const { base } = await start();
    await post(base, '/api/icons', { label: 'Sonarr 01', webp: webp.toString('base64') });
    const replaced = await (await post(base, '/api/icons', { label: 'sonarr 01', webp: webp2.toString('base64'), replace: true })).json();
    expect(replaced.icon).toMatchObject({ id: 'sonarr-01', label: 'Sonarr 01', replaced: true });
    const listed = await (await fetch(`${base}/api/icons`)).json();
    expect(listed.icons).toHaveLength(1);
    expect(Buffer.from(await (await fetch(`${base}/api/icons/sonarr-01.webp`)).arrayBuffer()).equals(webp2)).toBe(true);

    const copy = await (await post(base, '/api/icons', { label: 'Sonarr 01', webp: webp.toString('base64') })).json();
    expect(copy.icon.id).toBe('sonarr-01-2');
  });
});
