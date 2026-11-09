import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { Generator } from '../src/comfyui.mjs';
import { IconStore, imageType } from '../src/icons.mjs';
import { drawIcon, trimTransparent } from '../src/imaging.mjs';
import { toolResult } from '../src/mcp.mjs';
import { withDefaults } from '../src/options.mjs';
import { SnapshotStore } from '../src/snapshots.mjs';
import { WebSets } from '../src/websets.mjs';
import { buildTools, executeTool } from '../src/tools.mjs';

// A generated icon after background removal: a coloured block on a large transparent canvas.
async function generatedPng() {
  const block = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: block, left: 250, top: 150 }]).png().toBuffer();
}

describe('drawing icons on the server', () => {
  it('trims the transparent border, keeping a small margin', async () => {
    const trimmed = await trimTransparent(await generatedPng());
    expect(await sharp(trimmed).metadata()).toMatchObject({ format: 'png', width: 312, height: 212 });
  });

  it('leaves an image without transparent pixels whole', async () => {
    const solid = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#808080' } }).png().toBuffer();
    expect(await sharp(await trimTransparent(solid)).metadata()).toMatchObject({ width: 40, height: 30 });
  });

  it('draws a WebP in the icon box, with smaller copies at lower quality', async () => {
    const pixels = Buffer.from(Array.from({ length: 256 * 256 * 3 }, (_, i) => (i * 7919) % 251));
    const noise = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    const drawn = await drawIcon(noise, { width: 100, height: 100 });
    const webp = Buffer.from(drawn.webp, 'base64');
    expect(imageType(webp).type).toBe('image/webp');
    expect(await sharp(webp).metadata()).toMatchObject({ width: 100, height: 100 });
    expect(drawn.quality).toBe(0.85);
    expect(drawn.variants.length).toBeGreaterThan(0);
    let previous = webp.length;
    for (const variant of drawn.variants) {
      const bytes = Buffer.from(variant.webp, 'base64').length;
      expect(bytes).toBeLessThan(previous);
      previous = bytes;
    }
  });
});

describe('AI icons over MCP', () => {
  const servers = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
  });

  // ComfyUI with an own workflow: a prompt endpoint, a history that is done at once, and /view.
  async function fakeComfy(png) {
    const server = createServer((req, res) => {
      const json = body => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/system_stats') return json({});
      if (req.url === '/prompt') return json({ prompt_id: 'p1' });
      if (req.url === '/queue') return json({ queue_running: [] });
      if (req.url === '/history/p1') {
        return json({ p1: { status: { status_str: 'success', completed: true }, outputs: { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'temp' }] } } } });
      }
      if (req.url.startsWith('/view')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(png);
      }
      res.writeHead(404).end();
    });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }

  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'proxmox-notes-ai-'));
    const url = await fakeComfy(await generatedPng());
    const workflow = { 1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } }, 9: { class_type: 'PreviewImage', inputs: { images: ['1', 0] } } };
    const set = (name, size, folder) => ({ name, baseUrl: `https://icons.example.com/blue/${size}x${size}`, width: size, height: size, extension: '.png', ...(folder ? { folder: join(dataDir, 'web', `${size}`) } : {}) });
    const options = withDefaults({
      generator: { hosts: [url], mode: 'workflow', workflow: JSON.stringify(workflow) },
      webSets: [set('Blue 100', 100, true), set('Blue 512', 512, true), set('Blue 200', 200, false)]
    });
    const icons = await IconStore.open(dataDir);
    const generator = new Generator({ options: { get: () => options }, pollMs: 5 });
    const webSets = new WebSets({ options: { get: () => options } });
    const tools = buildTools({ options: { get: () => options, source: 'test' }, proxmox: { hosts: () => [] }, snapshots: new SnapshotStore(dataDir), icons, generator, webSets });
    const run = (name, args) => executeTool(tools.find(tool => tool.name === name), args);
    return { run, icons, options, dataDir };
  }

  async function done(run, id) {
    for (let i = 0; i < 200; i++) {
      const job = await run('notes_icon_generation', { id });
      if (job.state === 'done' || job.state === 'error') return job;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('the generation did not finish');
  }

  it('starts, follows and keeps a generated icon, then embeds it in a Note', async () => {
    const { run, icons, options } = await setup();
    const style = options.generator.styles[0].name;
    const started = await run('notes_icon_generate', { subject: 'a small cube computer', styles: [style], count: 1 });
    expect(started.state).toBe('queued');
    expect(started.availableStyles.map(item => item.name)).toContain(style);

    const job = await done(run, started.id);
    expect(job).toMatchObject({ state: 'done', images: 1 });
    expect(job.previews).toHaveLength(1);
    expect(await sharp(Buffer.from(job.previews[0].data, 'base64')).metadata()).toMatchObject({ format: 'webp', width: 192, height: 192 });

    const mcp = toolResult(job);
    expect(mcp.content.map(item => item.type)).toEqual(['text', 'image']);
    expect(mcp.content[0].text).not.toContain(job.previews[0].data);

    const { icon } = await run('notes_icon_keep', { id: started.id, image: 0, label: 'MiniCube AI' });
    expect(icon).toMatchObject({ id: 'minicube-ai', source: 'comfyui', width: 100, height: 100, quality: 0.85, original: { type: 'image/png' } });
    expect(icon.generation).toMatchObject({ subject: 'a small cube computer', style, seed: started.seed });
    const stored = (await icons.read('minicube-ai')).data;
    expect(await sharp(stored).metadata()).toMatchObject({ format: 'webp', width: 100, height: 100 });

    const listed = await run('notes_icons', { search: 'minicube' });
    expect(listed.icons).toEqual([{ id: 'minicube-ai', label: 'MiniCube AI', styles: style }]);
    const { doc } = await run('notes_new', { title: 'MiniCube', icon: 'minicube-ai' });
    expect(doc.image.src.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('refuses unknown styles, unknown generations and images that are not there', async () => {
    const { run } = await setup();
    await expect(run('notes_icon_generate', { subject: 'x', styles: ['Nope'] })).rejects.toThrow(/Unknown styles: Nope/);
    await expect(run('notes_icon_generation', { id: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(/Unknown or expired/);
    const started = await run('notes_icon_generate', { subject: 'x', count: 1 });
    await done(run, started.id);
    await expect(run('notes_icon_keep', { id: started.id, image: 2, label: 'X' })).rejects.toThrow(/No such image/);
  });

  it('saves a kept AI icon in web sets, trimmed, and refuses to overwrite without replace', async () => {
    const { run, dataDir } = await setup();
    const started = await run('notes_icon_generate', { subject: 'a lora library', count: 1 });
    await done(run, started.id);
    await run('notes_icon_keep', { id: started.id, image: 0, label: 'LoraManager01' });

    const saved = await run('notes_icon_web_save', { icon: 'loramanager01', sets: ['blue 100', 1] });
    expect(saved.written.map(file => file.file)).toEqual(['loramanager01-100x100.png', 'loramanager01-512x512.png']);
    expect(saved.noteImage).toEqual({ src: 'https://icons.example.com/blue/100x100/loramanager01-100x100.png', width: 100, height: 100, key: 'loramanager01-' });
    // Trimmed: the 300x200 block fills the width of the square, so the top row is transparent.
    const big = await sharp(join(dataDir, 'web', '512', 'loramanager01-512x512.png')).raw().toBuffer({ resolveWithObject: true });
    expect(big.info).toMatchObject({ width: 512, height: 512 });
    const pixel = (x, y) => big.data[(y * 512 + x) * big.info.channels + 3];
    expect(pixel(256, 0)).toBe(0);
    expect(pixel(20, 256)).toBe(255);

    await expect(run('notes_icon_web_save', { icon: 'loramanager01', sets: [0, 1] })).rejects.toThrow(/Already there: loramanager01-100x100.png in Blue 100, loramanager01-512x512.png in Blue 512\. Nothing was written/);
    const again = await run('notes_icon_web_save', { icon: 'loramanager01', sets: [0], replace: true });
    expect(again.replaced).toEqual(['loramanager01-100x100.png in Blue 100']);
  });

  it('refuses unknown web sets and sets without a folder before writing anything', async () => {
    const { run, icons } = await setup();
    await icons.add({ label: 'Plain', webp: (await drawIcon(await generatedPng(), { width: 100, height: 100 })).webp });
    await expect(run('notes_icon_web_save', { icon: 'plain', sets: ['Green 100'] })).rejects.toThrow(/Unknown web set "Green 100". Known: 0: Blue 100, 1: Blue 512, 2: Blue 200 \(no folder\)/);
    await expect(run('notes_icon_web_save', { icon: 'plain', sets: ['Blue 200'] })).rejects.toThrow(/Blue 200 has no folder/);
    await expect(run('notes_icon_web_save', { icon: 'nope', sets: [0] })).rejects.toThrow(/not in the library/);
  });

  it('says so when there is no generator', async () => {
    const tools = buildTools({ options: { get: () => withDefaults({}) }, proxmox: { hosts: () => [] }, snapshots: null });
    await expect(executeTool(tools.find(tool => tool.name === 'notes_icon_generate'), { subject: 'x' })).rejects.toThrow(/not set up/);
  });
});
