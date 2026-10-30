import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { optionsSchema, withDefaults } from '../src/options.mjs';
import { keysFromListing, keysFromManifest, labelFromKey, WebSets } from '../src/websets.mjs';

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

// A web server with a blue set that has a file listing and a green set that does not (403, as
// Apache without Indexes), but has an unpacked icon pack's manifest one folder up.
async function webServer() {
  const server = createServer((req, res) => {
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    if (req.url === '/blue/100x100/') {
      return send(200, 'text/html', '<a href="sonarr01-100x100.png">s</a> <a href="/blue/100x100/prowlarr01-100x100.png">p</a> <a href="deluge01-200x200.png">wrong size</a> <a href="../">up</a>');
    }
    if (req.url === '/green/proxmox-notes-icons.json') {
      return send(200, 'application/json', JSON.stringify({ icons: [{ label: 'Prowlarr', key: 'prowlarr01' }, { label: 'Bad', key: '../x' }] }));
    }
    send(req.url.endsWith('/') ? 403 : 404, 'text/html', 'no');
  });
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('web icon sets', () => {
  it('reads keys from a file listing, only for the set size and extension', () => {
    const set = { width: 100, height: 100, extension: '.png' };
    const html = '<a href="sonarr01-100x100.png">x</a><a href="a%20b-100x100.png">y</a><a href="x-100x100.jpg">z</a><a href="plex-100x100.PNG?v=1">w</a>';
    expect(keysFromListing(html, set)).toEqual(['sonarr01-', 'plex-']);
  });

  it('reads keys and names from a manifest and makes names from keys', () => {
    expect(keysFromManifest({ icons: [{ label: 'Prowlarr', key: 'prowlarr01' }, { key: 'a/b' }, { label: 'X', key: 'x-' }] }))
      .toEqual([{ key: 'prowlarr01-', label: 'Prowlarr' }, { key: 'x-', label: 'X' }]);
    expect(keysFromManifest(null)).toEqual([]);
    expect(labelFromKey('sonarr01-')).toBe('Sonarr 01');
    expect(labelFromKey('home_assistant-')).toBe('Home Assistant');
  });

  it('merges the listing, a manifest and the image list, with names and link URLs', async () => {
    const base = await webServer();
    const options = withDefaults({
      webSets: [
        { name: 'Blue', baseUrl: `${base}/blue/100x100`, width: 100, height: 100, extension: '.png' },
        { name: 'Green', baseUrl: `${base}/green/100x100`, width: 100, height: 100, extension: '.png' }
      ],
      images: [{ label: 'Sonarr 01', key: 'sonarr01-' }]
    });
    const sets = new WebSets({ options: { get: () => options } });

    const blue = await sets.icons(0);
    expect(blue.sources).toEqual(['listing', 'list']);
    expect(blue.icons).toEqual([
      { key: 'prowlarr01-', label: 'Prowlarr 01', url: `${base}/blue/100x100/prowlarr01-100x100.png` },
      { key: 'sonarr01-', label: 'Sonarr 01', url: `${base}/blue/100x100/sonarr01-100x100.png` }
    ]);

    const green = await sets.icons(1);
    expect(green.sources).toEqual(['manifest', 'list']);
    expect(green.icons.map(icon => icon.label)).toEqual(['Prowlarr', 'Sonarr 01']);
    expect(green.size).toEqual({ width: 100, height: 100 });

    await expect(sets.icons(5)).rejects.toThrow(/no web icon set/);
  });

  it('turns the old import icon set into the first web set', () => {
    const iconSet = { baseUrl: 'https://icons.example.com/blue/100x100', width: 100, height: 100, extension: '.png' };
    expect(withDefaults({ iconSet }).webSets).toEqual([{ name: 'Web', ...iconSet }]);
    expect(withDefaults({ iconSet, webSets: [] }).webSets).toEqual([]);
    expect(withDefaults({}).webSets).toEqual([]);
  });

  it('takes the size of the old icon set from its folder name', () => {
    const iconSet = { baseUrl: 'https://icons.example.com/green/512x512/', width: 100, height: 100, extension: '.png' };
    expect(withDefaults({ iconSet }).webSets[0]).toMatchObject({ width: 512, height: 512 });
  });

  it('writes an icon into a set that has a folder, at the size of the set, and asks before replacing', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'websets-'));
    try {
      const set = { name: 'Blue', baseUrl: 'https://icons.example.com/blue/200x200', width: 200, height: 200, extension: '.png', folder: join(folder, '200x200') };
      const options = withDefaults({ webSets: [set, { ...set, name: 'Read only', folder: '' }] });
      const sets = new WebSets({ options: { get: () => options } });
      const image = (await sharp({ create: { width: 60, height: 30, channels: 4, background: '#95c200' } }).png().toBuffer()).toString('base64');

      const written = await sets.write(0, { key: 'prowlarr01', image });
      expect(written).toEqual({ set: 'Blue', key: 'prowlarr01-', file: 'prowlarr01-200x200.png', url: 'https://icons.example.com/blue/200x200/prowlarr01-200x200.png', width: 200, height: 200 });
      expect(await sharp(await readFile(join(set.folder, 'prowlarr01-200x200.png'))).metadata()).toMatchObject({ width: 200, height: 200, format: 'png' });

      await expect(sets.write(0, { key: 'prowlarr01-', image })).rejects.toMatchObject({ statusCode: 409 });
      await writeFile(join(set.folder, 'prowlarr01-200x200.png'), 'old');
      await sets.write(0, { key: 'prowlarr01', image, replace: true });
      expect((await readFile(join(set.folder, 'prowlarr01-200x200.png'))).subarray(1, 4).toString()).toBe('PNG');

      await expect(sets.write(0, { key: '../evil', image })).rejects.toMatchObject({ statusCode: 400 });
      await expect(sets.write(1, { key: 'prowlarr01', image })).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('accepts an absolute folder or none, and nothing else', () => {
    const element = optionsSchema.shape.webSets.element;
    const set = { name: 'Blue', baseUrl: 'https://icons.example.com/blue/100x100', width: 100, height: 100, extension: '.png' };
    expect(element.safeParse(set).success).toBe(true);
    expect(element.safeParse({ ...set, folder: '' }).success).toBe(true);
    expect(element.safeParse({ ...set, folder: '/icons/blue/100x100' }).success).toBe(true);
    expect(element.safeParse({ ...set, folder: 'icons/blue' }).success).toBe(false);
  });
});
