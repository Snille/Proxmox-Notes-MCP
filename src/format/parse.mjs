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
 * Reads a Notes text in the generator format into a document.
 * Content that does not fit the format is never dropped: the result is { ok: false } instead,
 * so a caller can fall back to editing the raw text.
 */
export function parseNotes(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines.at(-1).trim() === '') {
    lines.pop();
  }
  const fail = (index, error) => ({ ok: false, error, line: index + 1 });
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
