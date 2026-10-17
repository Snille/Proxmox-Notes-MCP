import { DESCRIPTION_ICON, IMAGE_ALT, LINK_STYLE, NOTES_ICON } from './defaults.mjs';

// Proxmox stores the Notes in the guest's `description`, which holds at most this many characters.
export const PROXMOX_DESCRIPTION_LIMIT = 8192;

export function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Newlines become <br>. In a table cell a "|" would split the cell, so it is written as an entity.
export function toLine(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}

export function toCell(value) {
  return toLine(value).replace(/\|/g, '&#124;');
}

export function renderImage(image, title) {
  if (!image || !image.src) {
    return '';
  }
  const attributes = [
    `title="${escapeAttribute(image.title ?? title)}"`,
    `src="${escapeAttribute(image.src)}"`,
    `alt="${escapeAttribute(image.alt ?? IMAGE_ALT)}"`
  ];
  const { width, height } = image;
  if (width && height) {
    // Proxmox removes `style` since 2026-05; width and height keep the size there.
    attributes.push(`width="${width}"`, `height="${height}"`, `style="width:${width}px;height:${height}px;"`);
  }
  return `<img ${attributes.join(' ')}>`;
}

export function renderRow(row) {
  switch (row.type) {
    case 'field':
      return `**${toCell(row.key)}:** ${toCell(row.value)}`;
    case 'link':
      return `<a href="${escapeAttribute(row.url)}" target="_blank" style="${LINK_STYLE}">${toCell(row.name)}</a>`;
    case 'text':
      return toCell(row.text);
    default:
      throw new Error(`Unknown row type "${row.type}"`);
  }
}

// "table": one HTML table, width 100%, header inside (the default since 0.5.0).
// "markdown": the Markdown tables of the original Notes Generator.
export const LAYOUTS = ['table', 'markdown'];
export const DEFAULT_LAYOUT = 'table';

// Inside an HTML block Markdown is not parsed, and Proxmox's CSS makes only <strong> bold
// (its reset leaves <b> at normal weight). So **x** and <b> become <strong>.
export function toHtmlLine(value) {
  return toLine(value)
    .replace(/<b>/gi, '<strong>')
    .replace(/<\/b>/gi, '</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderTableRow(row) {
  switch (row.type) {
    case 'field':
      return `<strong>${toHtmlLine(row.key)}:</strong> ${toHtmlLine(row.value)}`;
    case 'link':
      return `<a href="${escapeAttribute(row.url)}" target="_blank" style="${LINK_STYLE}">${toHtmlLine(row.name)}</a>`;
    case 'text':
      return toHtmlLine(row.text);
    default:
      throw new Error(`Unknown row type "${row.type}"`);
  }
}

function renderTableImage(image, title) {
  if (!image || !image.src) {
    return '';
  }
  const size = image.width && image.height ? ` width="${image.width}" height="${image.height}"` : '';
  return `<img title="${escapeAttribute(image.title ?? title)}" src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt ?? IMAGE_ALT)}"${size}>`;
}

// No blank line may appear inside: a blank line ends an HTML block, and Markdown would take over.
function renderTable(doc) {
  const header = `<h1><i class="fa ${doc.headerIcon}"></i> ${toHtmlLine(doc.title)}</h1><i class="fa ${DESCRIPTION_ICON}"></i> ${toHtmlLine(doc.description)}`;
  // Without an icon the header spans both columns, so the title starts at the left edge.
  const top = doc.image?.src
    ? `<tr><td width="${(doc.image.width ?? 100) + 10}">${renderTableImage(doc.image, doc.title)}</td><td>${header}</td></tr>`
    : `<tr><td colspan="2">${header}</td></tr>`;
  const lines = [
    '<table width="100%">',
    top,
    `<tr><td colspan="2"><h3><i class="fa ${NOTES_ICON}"></i> Notes:</h3>${toHtmlLine(doc.notes)}</td></tr>`
  ];
  // Without an icon no row sets the label column's width; the first section row does it instead,
  // or the browser splits the full width evenly between the two columns.
  let widthPending = !doc.image?.src;
  for (const section of doc.sections ?? []) {
    section.rows.forEach((row, index) => {
      const label = index === 0 ? `<i class="fa ${section.icon}"></i> <strong>${section.title}:</strong>` : '';
      const cell = widthPending ? '<td width="110">' : '<td>';
      widthPending = false;
      lines.push(`<tr>${cell}${label}</td><td>${renderTableRow(row)}</td></tr>`);
    });
  }
  lines.push('</table>');
  return `${lines.join('\n')}\n`;
}

export function renderNotes(doc, { layout = DEFAULT_LAYOUT } = {}) {
  if (layout === 'table') {
    return renderTable(doc);
  }
  if (layout !== 'markdown') {
    throw new Error(`Unknown layout "${layout}"; use ${LAYOUTS.join(' or ')}`);
  }
  const lines = [
    `# <i class="fa ${doc.headerIcon}"></i> ${toLine(doc.title)}`,
    '| | |',
    '| - | - |',
    `| ${renderImage(doc.image, doc.title)} | <i class="fa ${DESCRIPTION_ICON}"></i> ${toCell(doc.description)} |`,
    `### <i class="fa ${NOTES_ICON}"></i> Notes:`,
    toLine(doc.notes),
    '| | |',
    '| - | - |'
  ];
  for (const section of doc.sections ?? []) {
    section.rows.forEach((row, index) => {
      const label = index === 0 ? `<i class="fa ${section.icon}"></i> **${section.title}:**` : '';
      lines.push(`| ${label} | ${renderRow(row)} |`);
    });
  }
  return `${lines.join('\n')}\n`;
}
