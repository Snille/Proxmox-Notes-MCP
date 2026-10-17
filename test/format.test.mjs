import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  emptyDocument,
  field,
  fromLegacyJson,
  legacyResources,
  link,
  parseNotes,
  PROXMOX_DESCRIPTION_LIMIT,
  renderNotes,
  section,
  text
} from '../src/format/index.mjs';

// The original generator's layout; the table layout has its own tests below.
const renderMarkdown = doc => renderNotes(doc, { layout: 'markdown' });
const examplesDir = new URL('../reference/examples/', import.meta.url);
const examples = readdirSync(examplesDir).filter(name => name.endsWith('.md'));
const read = name => readFileSync(new URL(name, examplesDir), 'utf8');

// The one deliberate difference from the original generator: width and height on the icon.
const withSizeAttributes = markdown =>
  markdown.replace('alt="[Icon]" style="width:100px;height:100px;"', 'alt="[Icon]" width="100" height="100" style="width:100px;height:100px;"');

describe('real Notes round-trip', () => {
  it('has the eleven examples', () => {
    expect(examples).toHaveLength(11);
  });

  for (const name of examples) {
    it(`${name}: parse then render gives the same text`, () => {
      const original = read(name);
      const result = parseNotes(original);
      expect(result.ok, result.error).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(renderMarkdown(result.doc)).toBe(withSizeAttributes(original));
    });

    it(`${name}: a rendered Note parses to the same document`, () => {
      const { doc } = parseNotes(read(name));
      expect(parseNotes(renderMarkdown(doc)).doc).toEqual(doc);
    });
  }
});

describe('parseNotes', () => {
  const sonarr = parseNotes(read('Sonarr02.md')).doc;

  it('reads the header, icon and description', () => {
    expect(sonarr.headerIcon).toBe('fa-linux');
    expect(sonarr.title).toBe('Sonarr Server');
    expect(sonarr.image).toEqual({
      src: 'https://icons.example.com/proxmox/icons/blue/100x100/sonarr01-100x100.png',
      width: 100,
      height: 100,
      key: 'sonarr01-'
    });
    expect(sonarr.description).toBe('TV series manager.\nGets indexers from Prowlarr01, sends downloads to SABnzbd and the torrent client.');
    expect(sonarr.notes.split('\n')).toHaveLength(4);
  });

  it('reads the sections with their exact icons', () => {
    expect(sonarr.sections.map(s => [s.id, s.icon])).toEqual([
      ['creation', 'fa-exclamation-circle fa-fw'],
      ['network', 'fa-sitemap fa-fw'],
      ['services', 'fa-cogs'],
      ['access', 'fa-key fa-fw']
    ]);
    expect(sonarr.sections[1].rows[1]).toEqual(field('MAC', 'bc:24:11:00:00:0a'));
    expect(sonarr.sections[2].rows[0]).toEqual(link('Sonarr', 'http://192.0.2.36:8989'));
    expect(sonarr.sections[3].rows.map(r => r.key)).toEqual(['User', 'SSH Key', 'Password', 'User', 'Password']);
  });

  it('keeps extra rows such as VPN', () => {
    const qbt = parseNotes(read('qBittorrent01.md')).doc;
    expect(qbt.sections[1].rows.at(-1)).toEqual(field('VPN', 'ExampleVPN, OpenVPN, server-01'));
  });

  it('accepts CRLF line endings and a missing final newline', () => {
    const original = read('Radarr02.md');
    const result = parseNotes(original.trimEnd().replace(/\n/g, '\r\n'));
    expect(result.ok).toBe(true);
    expect(result.doc).toEqual(parseNotes(original).doc);
  });

  it('reads an embedded icon', () => {
    const result = parseNotes(readFileSync(new URL('../reference/test/embedded-icon-test.md', import.meta.url), 'utf8'));
    expect(result.ok).toBe(true);
    expect(result.doc.image.src.startsWith('data:image/webp;base64,')).toBe(true);
    expect(result.doc.image).toMatchObject({ width: 100, height: 100 });
    expect(result.doc.image.key).toBeUndefined();
  });

  it('refuses free text instead of dropping it', () => {
    expect(parseNotes('Just some notes').ok).toBe(false);
    const extra = `${read('Lidarr02.md')}\nA line someone added by hand\n`;
    expect(parseNotes(extra)).toMatchObject({ ok: false, line: 23 });
  });

  it('keeps a custom section and a free text row', () => {
    const doc = emptyDocument();
    doc.title = 'Custom';
    doc.sections = [{ id: 'storage', title: 'Storage', icon: 'fa-hdd-o fa-fw', rows: [text('Data on <b>/mnt/data</b>')] }];
    const parsed = parseNotes(renderMarkdown(doc));
    expect(parsed.ok).toBe(true);
    expect(parsed.doc.sections).toEqual(doc.sections);
  });
});

describe('renderNotes', () => {
  it('escapes a | inside a cell and restores it on parse', () => {
    const doc = emptyDocument();
    doc.title = 'Pipes';
    doc.description = 'a | b';
    doc.sections = [section('network', [field('Ports', '80 | 443')])];
    const markdown = renderMarkdown(doc);
    expect(markdown).toContain('a &#124; b');
    expect(markdown).toContain('**Ports:** 80 &#124; 443');
    expect(parseNotes(markdown).doc).toEqual(doc);
  });

  it('escapes quotes in the icon title', () => {
    const doc = emptyDocument();
    doc.title = 'Say "hi"';
    doc.image = { src: 'https://example.com/a.png', width: 100, height: 100 };
    doc.sections = [];
    const markdown = renderMarkdown(doc);
    expect(markdown).toContain('title="Say &quot;hi&quot;"');
    expect(parseNotes(markdown).doc).toEqual(doc);
  });

  it('leaves out sections without rows', () => {
    const doc = emptyDocument();
    doc.title = 'Empty';
    expect(renderMarkdown(doc)).not.toContain('Creation');
    expect(parseNotes(renderMarkdown(doc)).doc.sections).toEqual([]);
  });

  it('writes an empty first column when there is no icon', () => {
    const doc = emptyDocument();
    doc.title = 'No icon';
    expect(renderMarkdown(doc).split('\n')[3]).toBe('|  | <i class="fa fa-file-text-o"></i>  |');
    expect(parseNotes(renderMarkdown(doc)).doc.image).toBeNull();
  });

  it('keeps the real Notes well under the Proxmox limit', () => {
    for (const name of examples) {
      expect(read(name).length).toBeLessThan(PROXMOX_DESCRIPTION_LIMIT / 2);
    }
  });
});

describe('fromLegacyJson', () => {
  const selectJson = JSON.parse(readFileSync(new URL('../reference/select.json', import.meta.url), 'utf8'));
  const saved = {
    h: { s1: 'fa-linux', t1: 'Sonarr Server', s2: 'sonarr01-', m1: 'TV series manager.\nSecond line', m2: 'Installed.' },
    sections: {
      creation: [{ k: 'Date', v: '2026-10-16' }, { k: 'Owner', v: 'Jane Doe' }],
      network: [{ k: 'IP', v: '192.0.2.36' }],
      services: [{ n: 'Sonarr', u: 'http://192.0.2.36:8989' }],
      access: [{ k: 'User', v: 'snille' }]
    }
  };

  it('converts a saved generator file and renders like the generator', () => {
    const doc = fromLegacyJson(saved, legacyResources(selectJson));
    expect(doc.image.src).toBe('https://icons.example.com/proxmox/icons/blue/100x100/sonarr01-100x100.png');
    const markdown = renderMarkdown(doc);
    expect(markdown).toContain('<i class="fa fa-file-text-o"></i> TV series manager.<br>Second line |');
    expect(markdown).toContain('| <i class="fa fa-cogs"></i> **Services:** | <a href="http://192.0.2.36:8989" target="_blank" style="text-decoration: none; color: #00f000;">Sonarr</a> |');
    expect(parseNotes(markdown).doc).toEqual(doc);
  });

  it('rejects other JSON', () => {
    expect(() => fromLegacyJson({ title: 'x' })).toThrow(/Notes Generator/);
  });
});

describe('table layout (default)', () => {
  // Proxmox only shows <strong> as bold, so <b> in text becomes <strong>.
  const strong = doc => JSON.parse(JSON.stringify(doc).replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>'));

  for (const name of examples) {
    it(`${name}: Markdown layout -> table -> same document`, () => {
      const { doc } = parseNotes(read(name));
      const table = renderNotes(doc);
      const back = parseNotes(table);
      expect(back.ok, back.error).toBe(true);
      expect(back.layout).toBe('table');
      expect(back.warnings).toEqual([]);
      expect(back.doc).toEqual(strong(doc));
      expect(renderNotes(back.doc)).toBe(table);
    });
  }

  it('is one full-width table with the header inside and no blank line', () => {
    const table = renderNotes(parseNotes(read('Sonarr02.md')).doc);
    const lines = table.trimEnd().split('\n');
    expect(lines[0]).toBe('<table width="100%">');
    expect(lines.at(-1)).toBe('</table>');
    expect(lines[1]).toMatch(/^<tr><td width="110"><img [^>]*width="100" height="100"><\/td><td><h1><i class="fa fa-linux"><\/i> Sonarr Server<\/h1>/);
    expect(lines[2]).toMatch(/^<tr><td colspan="2"><h3><i class="fa fa-sticky-note-o"><\/i> Notes:<\/h3>/);
    expect(table).toContain('<tr><td><i class="fa fa-exclamation-circle fa-fw"></i> <strong>Creation:</strong></td><td><strong>Date:</strong> 2026-10-16</td></tr>');
    expect(table).toContain('<tr><td></td><td><a href="https://192.0.2.36:10000" target="_blank"');
    expect(table).not.toMatch(/\n\s*\n/);
    expect(table).not.toContain('<b>');
  });

  it('writes **bold** in text as <strong>', () => {
    const doc = emptyDocument();
    doc.title = 'Bold';
    doc.notes = 'Run **update** as root';
    doc.sections = [];
    expect(renderNotes(doc)).toContain('Run <strong>update</strong> as root');
  });

  it('lets the header span both columns when there is no icon, and keeps a custom section', () => {
    const doc = emptyDocument();
    doc.title = 'No icon';
    doc.sections = [{ id: 'storage', title: 'Storage', icon: 'fa-hdd-o fa-fw', rows: [text('Data on /mnt/data'), field('Disk', '16 GiB')] }];
    const table = renderNotes(doc);
    expect(table.split('\n')[1]).toMatch(/^<tr><td colspan="2"><h1><i class="fa fa-linux"><\/i> No icon<\/h1>/);
    expect(table.split('\n')[3]).toMatch(/^<tr><td width="110"><i class="fa fa-hdd-o fa-fw"><\/i> <strong>Storage:<\/strong><\/td>/);
    expect(table.split('\n')[4]).toMatch(/^<tr><td><\/td>/);
    expect(parseNotes(table).doc).toEqual(doc);
  });

  it('refuses a table that does not fit instead of dropping rows', () => {
    const table = renderNotes(parseNotes(read('Radarr02.md')).doc);
    const broken = table.replace('</table>', '<tr><td>one cell only</td></tr>\n</table>');
    expect(parseNotes(broken)).toMatchObject({ ok: false });
    expect(parseNotes(table.replace('\n</table>\n', '\n'))).toMatchObject({ ok: false });
  });

  it('rejects an unknown layout', () => {
    expect(() => renderNotes(emptyDocument(), { layout: 'fancy' })).toThrow(/Unknown layout/);
  });
});
