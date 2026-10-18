import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MANIFEST, packItems, packKey } from '../src/web/packs.js';
import { crc32, readZip, writeZip } from '../src/web/zip.js';

const bytes = text => new TextEncoder().encode(text);

describe('ZIP', () => {
  it('writes a ZIP that it reads back, stored and deflated, with UTF-8 names', async () => {
    const zip = await writeZip([
      { name: 'å/manifest.json', data: '{"a":1}', deflate: true },
      { name: '100x100/b-100x100.png', data: new Uint8Array([1, 2, 3]) }
    ]);
    const entries = await readZip(zip);
    expect(entries.map(entry => entry.name)).toEqual(['å/manifest.json', '100x100/b-100x100.png']);
    expect(new TextDecoder().decode(entries[0].data)).toBe('{"a":1}');
    expect([...entries[1].data]).toEqual([1, 2, 3]);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('reads deflated entries made by another tool and refuses damaged or non-ZIP data', async () => {
    // A ZIP with one deflated file, built by hand with zlib, as other tools make them.
    const data = bytes('hello hello hello hello');
    const packed = deflateRawSync(data);
    const name = bytes('x.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + packed.length, 16);
    const file = Buffer.concat([local, name, packed, central, name, end]);
    const [entry] = await readZip(file);
    expect(new TextDecoder().decode(entry.data)).toBe('hello hello hello hello');

    file[30 + name.length] ^= 0xff;
    await expect(readZip(file)).rejects.toThrow();
    await expect(readZip(bytes('not a zip at all, just text'))).rejects.toThrow(/not a ZIP/);
  });
});

describe('icon packs', () => {
  it('makes icon-set keys from names', () => {
    expect(packKey('Prowlarr')).toBe('prowlarr01');
    expect(packKey('Sonarr 01 (green)')).toBe('sonarr01');
    expect(packKey('Home Assistant 02')).toBe('homeassistant02');
    expect(packKey('Ünifi')).toBe('unifi01');
  });

  it('takes the icons and names from the manifest of a pack', () => {
    const manifest = { format: 'proxmox-notes-icons', version: 1, icons: [
      { label: 'Prowlarr', key: 'prowlarr01', file: '512x512/prowlarr01-512x512.png', generation: { subject: 'radar', style: 'Icon', prompt: 'p', seed: 1 } },
      { label: 'Missing', key: 'gone01', file: '512x512/gone01-512x512.png' }
    ] };
    const entries = [
      { name: `pack/${MANIFEST}`, data: bytes(JSON.stringify(manifest)) },
      { name: 'pack/512x512/prowlarr01-512x512.png', data: new Uint8Array(10) },
      { name: 'pack/100x100/prowlarr01-100x100.png', data: new Uint8Array(5) }
    ];
    const items = packItems(entries);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'Prowlarr', generation: { subject: 'radar' } });
    expect(items[0].entry.name).toBe('pack/512x512/prowlarr01-512x512.png');
  });

  it('names images from their file names and keeps the largest of each key without a manifest', () => {
    const entries = [
      { name: 'blue/100x100/sonarr01-100x100.png', data: new Uint8Array(100) },
      { name: 'blue/512x512/sonarr01-512x512.png', data: new Uint8Array(900) },
      { name: 'blue/512x512/deluge03-512x512.png', data: new Uint8Array(800) },
      { name: '__MACOSX/blue/._sonarr01-512x512.png', data: new Uint8Array(5) },
      { name: 'readme.txt', data: bytes('hi') }
    ];
    const items = packItems(entries, [{ label: 'Sonarr 01', key: 'sonarr01-' }]);
    expect(items.map(item => [item.label, item.entry.name])).toEqual([
      ['Sonarr 01', 'blue/512x512/sonarr01-512x512.png'],
      ['Deluge 03', 'blue/512x512/deluge03-512x512.png']
    ]);
  });
});
