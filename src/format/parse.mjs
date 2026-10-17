import { DESCRIPTION_ICON, SCHEMA, SECTIONS } from './defaults.mjs';

const TABLE_HEAD = /^\|\s*\|\s*\|$/;
const TABLE_RULE = /^\|\s*-+\s*\|\s*-+\s*\|$/;
const HEADING = /^#\s+<i class="fa ([^"]+)"><\/i>\s?(.*)$/;
const NOTES_HEADING = /^###\s.*Notes:\s*$/;
const SECTION_LABEL = /^<i class="fa ([^"]+)"><\/i>\s*\*\*(.+?):\*\*$/;
const FIELD = /^\*\*(.+?):\*\*\s?(.*)$/s;
const LINK = /^<a\s[^>]*?href="([^"]*)"[^>]*>(.*)<\/a>$/s;
const DESCRIPTION_PREFIX = new RegExp(`^<i class="fa ${DESCRIPTION_ICON}"></i>\\s?`);
const ICON_SET_KEY = /\/([^/]+-)\d+x\d+\.png$/;

export function unescapeAttribute(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function fromLine(value) {
  return value.replace(/<br\s*\/?>/gi, '\n');
}

export function fromCell(value) {
  return fromLine(value).replace(/&#124;/g, '|');
}

// Column 1 never holds a "|", so everything after the first separator belongs to column 2.
function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) {
    return null;
  }
  const cells = trimmed.slice(1, -1).split('|');
  if (cells.length < 2) {
    return null;
  }
  return [cells[0].trim(), cells.slice(1).join('|').trim()];
}

function parseImage(cell) {
  const tag = /<img\s([^>]*)>/i.exec(cell);
  if (!tag) {
    return null;
  }
  const attributes = {};
  for (const [, name, value] of tag[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[name.toLowerCase()] = unescapeAttribute(value);
  }
  if (!attributes.src) {
    return null;
  }
  const style = attributes.style ?? '';
  const width = Number(attributes.width ?? /width:\s*(\d+)px/.exec(style)?.[1]) || undefined;
  const height = Number(attributes.height ?? /height:\s*(\d+)px/.exec(style)?.[1]) || undefined;
  const image = { src: attributes.src };
  if (width && height) {
    image.width = width;
    image.height = height;
  }
  const key = ICON_SET_KEY.exec(attributes.src)?.[1];
  if (key) {
    image.key = key;
  }
  if (attributes.alt !== undefined && attributes.alt !== '[Icon]') {
    image.alt = attributes.alt;
  }
  return { image, title: attributes.title };
}

function parseRow(content) {
  const field = FIELD.exec(content);
  if (field) {
    return { type: 'field', key: fromCell(field[1]), value: fromCell(field[2]) };
  }
  const link = LINK.exec(content);
  if (link) {
    return { type: 'link', name: fromCell(link[2]), url: unescapeAttribute(link[1]) };
  }
  return { type: 'text', text: fromCell(content) };
}

function sectionId(title, used) {
  const known = Object.entries(SECTIONS).find(([, value]) => value.title.toLowerCase() === title.toLowerCase());
  let id = known ? known[0] : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  for (let n = 2; used.has(id); n++) {
    id = `${id.replace(/-\d+$/, '')}-${n}`;
  }
  used.add(id);
  return id;
}

/**
 * Reads a Notes text into a document: the full-width table layout, or the Markdown tables of
 * the original generator. A successful result says which layout it was.
 * Content that does not fit the format is never dropped: the result is { ok: false } instead,
 * so a caller can fall back to editing the raw text.
 */
export function parseNotes(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines.at(-1).trim() === '') {
    lines.pop();
  }
  const layout = TABLE_START.test(lines[0] ?? '') ? 'table' : 'markdown';
  const result = layout === 'table' ? parseTableLayout(lines) : parseMarkdownLayout(lines);
  return result.ok ? { ...result, layout } : result;
}

const fail = (index, error) => ({ ok: false, error, line: index + 1 });

const TABLE_START = /^<table\b[^>]*>\s*$/i;
const TABLE_END = /^<\/table>\s*$/i;
const TABLE_ROW = /^<tr>(.*)<\/tr>$/is;
const TABLE_CELL = /<td\b[^>]*>(.*?)<\/td>/gis;
const TABLE_HEADER = /^<h1><i class="fa ([^"]+)"><\/i>\s?(.*?)<\/h1>(.*)$/is;
const TABLE_NOTES = /^<h3>.*?Notes:\s*<\/h3>(.*)$/is;
const TABLE_LABEL = /^<i class="fa ([^"]+)"><\/i>\s*<(strong|b)>(.+?):<\/\2>$/is;
const TABLE_FIELD = /^<(strong|b)>(.+?):<\/\1>\s?(.*)$/is;

function cellsOf(line) {
  const row = TABLE_ROW.exec(String(line ?? '').trim());
  return row ? [...row[1].matchAll(TABLE_CELL)].map(match => match[1].trim()) : null;
}

function parseTableRow(content) {
  const field = TABLE_FIELD.exec(content);
  if (field) {
    return { type: 'field', key: fromLine(field[2]), value: fromLine(field[3]) };
  }
  const link = LINK.exec(content);
  if (link) {
    return { type: 'link', name: fromLine(link[2]), url: unescapeAttribute(link[1]) };
  }
  return { type: 'text', text: fromLine(content) };
}

// The full-width table layout (see render.mjs). As for Markdown, anything that does not fit
// is reported with its line, never dropped.
function parseTableLayout(lines) {
  const warnings = [];
  const last = lines.length - 1;
  if (!TABLE_END.test(lines[last] ?? '')) {
    return fail(last, 'The table does not end with </table> on its own line');
  }
  let top = cellsOf(lines[1]);
  if (top?.length === 1) {
    // No icon: the heading cell spans both columns.
    top = ['', top[0]];
  }
  if (!top || top.length !== 2) {
    return fail(1, 'The first row is not an icon cell and a heading cell');
  }
  const header = TABLE_HEADER.exec(top[1]);
  if (!header) {
    return fail(1, 'The heading cell does not start with <h1><i class="fa ..."></i> Title</h1>');
  }
  if (!DESCRIPTION_PREFIX.test(header[3])) {
    warnings.push(`Line 2: the description has no ${DESCRIPTION_ICON} icon; it is added when saved`);
  }
  const doc = {
    schema: SCHEMA,
    headerIcon: header[1],
    title: fromLine(header[2]),
    image: null,
    description: fromLine(header[3].replace(DESCRIPTION_PREFIX, '')),
    notes: '',
    sections: []
  };
  if (top[0] !== '') {
    const parsed = parseImage(top[0]);
    if (!parsed) {
      return fail(1, 'The icon cell is not an <img> with a src');
    }
    doc.image = parsed.image;
    if (parsed.title !== undefined && parsed.title !== doc.title) {
      doc.image.title = parsed.title;
    }
  }

  const notesRow = cellsOf(lines[2]);
  const notes = notesRow?.length === 1 ? TABLE_NOTES.exec(notesRow[0]) : null;
  if (!notes) {
    return fail(2, 'The second row is not the "Notes:" row');
  }
  doc.notes = fromLine(notes[1]);

  const used = new Set();
  let current = null;
  for (let i = 3; i < last; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells || cells.length !== 2) {
      return fail(i, 'Expected a row with a label cell and a value cell');
    }
    const [label, content] = cells;
    if (label !== '') {
      const match = TABLE_LABEL.exec(label);
      if (!match) {
        return fail(i, 'The label cell is not "<i class="fa ..."></i> <strong>Title:</strong>"');
      }
      current = { id: sectionId(match[3], used), title: match[3], icon: match[1], rows: [] };
      doc.sections.push(current);
    } else if (!current) {
      return fail(i, 'A row comes before the first section label');
    }
    current.rows.push(parseTableRow(content));
  }
  return { ok: true, doc, warnings };
}

function parseMarkdownLayout(lines) {
  const warnings = [];
  let i = 0;

  const heading = HEADING.exec(lines[i] ?? '');
  if (!heading) {
    return fail(i, 'The first line is not a "# <i class="fa ..."></i> Title" heading');
  }
  const doc = {
    schema: SCHEMA,
    headerIcon: heading[1],
    title: fromLine(heading[2]),
    image: null,
    description: '',
    notes: '',
    sections: []
  };
  i++;

  if (!TABLE_HEAD.test(lines[i] ?? '') || !TABLE_RULE.test(lines[i + 1] ?? '')) {
    return fail(i, 'The icon table does not follow the heading');
  }
  i += 2;

  const top = splitRow(lines[i] ?? '');
  if (!top) {
    return fail(i, 'The icon and description row is missing');
  }
  if (top[0] !== '') {
    const parsed = parseImage(top[0]);
    if (!parsed) {
      return fail(i, 'Column 1 of the icon row is not an <img> with a src');
    }
    doc.image = parsed.image;
    if (parsed.title !== undefined && parsed.title !== doc.title) {
      doc.image.title = parsed.title;
    }
  }
  if (!DESCRIPTION_PREFIX.test(top[1])) {
    warnings.push(`Line ${i + 1}: the description has no ${DESCRIPTION_ICON} icon; it is added when saved`);
  }
  doc.description = fromCell(top[1].replace(DESCRIPTION_PREFIX, ''));
  i++;

  if (!NOTES_HEADING.test(lines[i] ?? '')) {
    return fail(i, 'The "### Notes:" heading does not follow the icon table');
  }
  i++;

  const notesStart = i;
  while (i < lines.length && !(TABLE_HEAD.test(lines[i]) && TABLE_RULE.test(lines[i + 1] ?? ''))) {
    i++;
  }
  doc.notes = lines.slice(notesStart, i).map(fromLine).join('\n');
  if (i >= lines.length) {
    // A Note without sections is valid; the generator always writes the table, though.
    return { ok: true, doc, warnings };
  }
  i += 2;

  const used = new Set();
  let current = null;
  for (; i < lines.length; i++) {
    const row = splitRow(lines[i]);
    if (!row) {
      return fail(i, 'Unexpected text after the section table');
    }
    const [label, content] = row;
    if (label !== '') {
      const match = SECTION_LABEL.exec(label);
      if (!match) {
        return fail(i, 'Column 1 is not a "<i class="fa ..."></i> **Title:**" section label');
      }
      current = { id: sectionId(match[2], used), title: match[2], icon: match[1], rows: [] };
      doc.sections.push(current);
    } else if (!current) {
      return fail(i, 'A row comes before the first section label');
    }
    current.rows.push(parseRow(content));
  }

  return { ok: true, doc, warnings };
}
