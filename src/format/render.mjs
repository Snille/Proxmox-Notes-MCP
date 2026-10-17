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

export function renderNotes(doc) {
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
