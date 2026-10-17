import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../src/config.mjs';
import { OptionsStore } from '../src/options.mjs';
import { createNotesServer } from '../src/server.mjs';
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
  server = createNotesServer({ settings, options, tools: buildTools({ options }) });
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

    const created = await (await post(base, '/api/tools/notes_new', { title: 'Sonarr Server', imageKey: 'sonarr01-' })).json();
    expect(created.doc.image.src).toBe('https://icons.example.com/proxmox/icons/blue/100x100/sonarr01-100x100.png');
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
    expect(tools.map(t => t.name).sort()).toEqual(['notes_import_legacy', 'notes_new', 'notes_options', 'notes_parse', 'notes_render', 'notes_status']);
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
    expect((await client.listTools()).tools.length).toBe(6);
    await client.close();
  });
});
