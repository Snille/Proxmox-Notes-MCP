// Renders Notes Markdown the way the Proxmox web GUI shows it: a small Markdown subset
// (headings, pipe tables, paragraphs, **bold**) followed by a sanitizer that mirrors
// proxmox-widget-toolkit src/Parser.js (allowed tags and attributes, no style, URL checks).

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite',
  'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark',
  'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr'
]);
const ALLOWED_ATTRIBUTES = /^(?:class|href|src|alt|align|valign|start|type|target|colspan|rowspan|title|width|height|dir)$/i;
const DENIED_SCHEMES = new Set(['javascript:', 'vbscript:', 'livescript:', 'mocha:', 'data:', 'jar:']);
const IMG_DATA = /^\s*data:image\/(?:png|gif|jpeg|jpg|webp|x-icon|vnd\.microsoft\.icon|bmp);/i;

const escapeText = value => value.replace(/&(?![#\w]+;)/g, '&amp;');
const inline = value => escapeText(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const isTableRow = line => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = line => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
const cells = line => line.trim().slice(1, -1).split('|').map(cell => cell.trim());

export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(inline).join('\n')}</p>`);
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (isTableRow(line) && isTableRule(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line);
      const body = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      i--;
      const row = (values, tag) => `<tr>${head.map((_, n) => `<${tag}>${inline(values[n] ?? '')}</${tag}>`).join('')}</tr>`;
      out.push(`<table><thead>${row(head, 'th')}</thead><tbody>${body.map(r => row(r, 'td')).join('')}</tbody></table>`);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out.join('\n');
}

function safeUrl(tag, value) {
  let url;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (DENIED_SCHEMES.has(protocol)) {
    return tag === 'img' && IMG_DATA.test(value) ? value : null;
  }
  if (tag === 'img') {
    return protocol === 'http:' || protocol === 'https:' ? url.href : null;
  }
  return url.href;
}

function sanitize(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
      child.replaceWith(document.createTextNode(child.nodeType === Node.ELEMENT_NODE ? child.outerHTML : ''));
      continue;
    }
    const tag = child.tagName.toLowerCase();
    for (const attribute of [...child.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!ALLOWED_ATTRIBUTES.test(name)) {
        child.removeAttribute(attribute.name);
      } else if (name === 'href' || name === 'src') {
        const value = safeUrl(tag, attribute.value);
        if (value === null) {
          child.removeAttribute(attribute.name);
        } else {
          child.setAttribute(attribute.name, value);
        }
      }
    }
    if (tag === 'a') {
      child.setAttribute('rel', 'noopener noreferrer');
    }
    sanitize(child);
  }
}

// Returns a DocumentFragment that is safe to insert into the page.
export function renderPreview(markdown) {
  // Proxmox drops style attributes; removing them before parsing also keeps the page's CSP quiet.
  const html = markdownToHtml(markdown).replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  sanitize(parsed.body);
  const fragment = document.createDocumentFragment();
  for (const node of [...parsed.body.childNodes]) {
    fragment.appendChild(document.importNode(node, true));
  }
  return fragment;
}
