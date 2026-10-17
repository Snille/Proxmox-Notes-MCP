import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostHeaderValidation } from '@modelcontextprotocol/node';
import { createMcpNodeHandler } from './mcp.mjs';
import { fetchDashboardIcon, searchDashboardIcons } from './dashboard-icons.mjs';
import { fromLegacySelect, iconSetUrl } from './options.mjs';
import { fetchCertificate, testTarget } from './proxmox/client.mjs';
import { resolveTarget } from './proxmox/targets.mjs';
import { executeTool } from './tools.mjs';
import { version } from './version.mjs';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY'
};

// Icons in the preview may be embedded (data:) or come from an icon-set web server (https:).
const CONTENT_SECURITY_POLICY = "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// Static files: the web GUI from src/web, and the Notes format modules from src/format, which
// the browser imports directly so the preview renders exactly like the server does.
const STATIC_ROOTS = [
  { prefix: '/format/', dir: resolve(fileURLToPath(new URL('./format/', import.meta.url))) },
  { prefix: '/', dir: resolve(fileURLToPath(new URL('./web/', import.meta.url))) }
];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

const MAX_ICON_BYTES = 2_000_000;

async function staticFile(pathname) {
  const root = STATIC_ROOTS.find(r => pathname.startsWith(r.prefix));
  if (!root) {
    return null;
  }
  let relative = decodeURIComponent(pathname.slice(root.prefix.length));
  if (relative === '' || relative.endsWith('/')) {
    relative += 'index.html';
  }
  const file = resolve(root.dir, relative);
  const type = CONTENT_TYPES[extname(file).toLowerCase()];
  if (!type || !file.startsWith(root.dir + sep)) {
    return null;
  }
  try {
    if (!(await stat(file)).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return { body: await readFile(file), type };
}

// Embedded icons make a Note up to 8 KB; this leaves room for an imported legacy file or options.
const MAX_BODY_BYTES = 2_000_000;
// An icon upload carries the original image too (up to 4 MB, about 5.4 MB as base64).
const ICON_UPLOAD_BYTES = 6_000_000;

function sendJson(res, status, document) {
  const body = JSON.stringify(document);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...SECURITY_HEADERS
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw Object.assign(new Error(`Request body exceeds ${maxBytes} bytes`), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
  }
}

// There is no login: the web GUI is meant to sit behind a reverse proxy with authentication.
// A browser page on another site must still not be able to call this service, so a request
// that carries an Origin header must come from the same host.
function isCrossOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).host.toLowerCase() !== String(req.headers.host ?? '').toLowerCase();
  } catch {
    return true;
  }
}

function hasMcpToken(req, token) {
  const header = String(req.headers.authorization ?? '');
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sendImage(res, data, type) {
  res.writeHead(200, { 'content-type': type, 'content-length': data.length, ...SECURITY_HEADERS });
  res.end(data);
}

// The icon library and dashboard-icons. Uploads carry a WebP drawn by the browser plus the
// original, as base64 in JSON.
async function handleIcons(req, res, url, icons, options) {
  const path = url.pathname;
  if (!icons || !(path.startsWith('/api/icons') || path.startsWith('/api/dashboard-icons'))) {
    return false;
  }
  if (req.method === 'GET' && path === '/api/icons') {
    const { width, height } = options.get().iconSet;
    sendJson(res, 200, { icons: icons.list(), size: { width, height } });
    return true;
  }
  if (req.method === 'POST' && path === '/api/icons') {
    sendJson(res, 200, { icon: await icons.add(await readJsonBody(req, ICON_UPLOAD_BYTES)) });
    return true;
  }
  const image = path.match(/^\/api\/icons\/([a-z0-9-]+)\.webp$/);
  if (req.method === 'GET' && image) {
    sendImage(res, (await icons.read(image[1])).data, 'image/webp');
    return true;
  }
  const original = path.match(/^\/api\/icons\/([a-z0-9-]+)\/original$/);
  if (req.method === 'GET' && original) {
    const { data, type } = await icons.readOriginal(original[1]);
    sendImage(res, data, type);
    return true;
  }
  const one = path.match(/^\/api\/icons\/([a-z0-9-]+)$/);
  if (one && req.method === 'PATCH') {
    sendJson(res, 200, { icon: await icons.rename(one[1], (await readJsonBody(req)).label) });
    return true;
  }
  if (one && req.method === 'DELETE') {
    await icons.remove(one[1]);
    sendJson(res, 200, { removed: one[1] });
    return true;
  }
  if (req.method === 'GET' && path === '/api/dashboard-icons') {
    sendJson(res, 200, await searchDashboardIcons(url.searchParams.get('q') ?? ''));
    return true;
  }
  const dashboard = path.match(/^\/api\/dashboard-icons\/([a-z0-9._-]+)\.png$/);
  if (req.method === 'GET' && dashboard) {
    sendImage(res, await fetchDashboardIcon(dashboard[1]), 'image/png');
    return true;
  }
  sendJson(res, 404, { error: 'Unknown icon endpoint' });
  return true;
}

async function handleSettings(req, url, proxmox) {
  const store = proxmox?.store;
  if (!url.pathname.startsWith('/api/settings/')) {
    return null;
  }
  // Converts the old generator's select.json for the settings form; nothing is saved here.
  if (req.method === 'POST' && url.pathname === '/api/settings/import-select') {
    const { selectJson } = await readJsonBody(req);
    try {
      return { body: fromLegacySelect(selectJson) };
    } catch (error) {
      throw Object.assign(error, { statusCode: 400 });
    }
  }
  if (!store) {
    throw Object.assign(new Error('Host settings are not available in this setup'), { statusCode: 404 });
  }
  if (req.method === 'GET' && url.pathname === '/api/settings/hosts') {
    return { body: { hosts: store.list(), file: store.file } };
  }
  if (req.method === 'POST' && url.pathname === '/api/settings/certificate') {
    const { baseUrl } = await readJsonBody(req);
    return { body: await fetchCertificate(String(baseUrl ?? '')) };
  }
  if (req.method === 'POST' && url.pathname === '/api/settings/hosts/test') {
    const target = await resolveTarget(store.merge(await readJsonBody(req)));
    try {
      return { body: await testTarget(target) };
    } catch (error) {
      return { body: { ok: false, error: error.message } };
    }
  }
  const match = url.pathname.match(/^\/api\/settings\/hosts\/([a-z0-9-]+)$/);
  if (match && req.method === 'PUT') {
    const input = await readJsonBody(req);
    if (input.id !== match[1]) {
      throw Object.assign(new Error('The id in the path and in the body differ'), { statusCode: 400 });
    }
    const host = await store.upsert(input);
    await proxmox.reload();
    return { body: { host } };
  }
  if (match && req.method === 'DELETE') {
    await store.remove(match[1]);
    await proxmox.reload();
    return { body: { removed: match[1] } };
  }
  return { status: 404, body: { error: 'Unknown settings endpoint' } };
}

export function createNotesServer({ settings, options, tools, proxmox, icons }) {
  const toolMap = new Map(tools.map(tool => [tool.name, tool]));
  const validateHost = settings.allowedHosts.length ? hostHeaderValidation(settings.allowedHosts) : null;
  const mcp = createMcpNodeHandler(tools);

  const server = createServer(async (req, res) => {
    if (validateHost && !validateHost(req, res)) {
      return;
    }
    if (isCrossOrigin(req)) {
      sendJson(res, 403, { error: 'Cross-origin requests are not allowed' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health/live') {
        sendJson(res, 200, { ok: true, version });
        return;
      }

      // An icon from the configured icon set, fetched by the server so the browser can embed it
      // (a canvas cannot read a cross-origin image). Only URLs built from the icon set are fetched.
      if (req.method === 'GET' && url.pathname === '/api/icon') {
        const source = iconSetUrl(options.get().iconSet, url.searchParams.get('key'));
        if (!source || !/^[\w.-]+-$/.test(url.searchParams.get('key'))) {
          sendJson(res, 400, { error: 'An icon-set key is required, and an icon set must be configured' });
          return;
        }
        const upstream = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(10_000) }).catch(() => null);
        const type = upstream?.headers.get('content-type') ?? '';
        if (!upstream?.ok || !type.startsWith('image/') || type.includes('svg')) {
          sendJson(res, 502, { error: `The icon set did not return a raster image for this key (${upstream ? upstream.status : 'not reachable'})` });
          return;
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        if (body.length > MAX_ICON_BYTES) {
          sendJson(res, 502, { error: 'The icon is larger than 2 MB' });
          return;
        }
        res.writeHead(200, { 'content-type': type, 'content-length': body.length, ...SECURITY_HEADERS });
        res.end(body);
        return;
      }

      const asset = req.method === 'GET' && await staticFile(url.pathname);
      if (asset) {
        res.writeHead(200, {
          'content-type': asset.type,
          'content-length': asset.body.length,
          'content-security-policy': CONTENT_SECURITY_POLICY,
          ...SECURITY_HEADERS
        });
        res.end(asset.body);
        return;
      }

      if (url.pathname === '/mcp') {
        if (settings.mcpToken && !hasMcpToken(req, settings.mcpToken)) {
          res.writeHead(401, { 'www-authenticate': 'Bearer', ...SECURITY_HEADERS });
          res.end();
          return;
        }
        await mcp.nodeHandler(req, res);
        return;
      }

      // The settings page. Not offered over MCP: token secrets should not pass through an assistant.
      if (await handleIcons(req, res, url, icons, options)) {
        return;
      }

      const settingsResult = await handleSettings(req, url, proxmox);
      if (settingsResult) {
        sendJson(res, settingsResult.status ?? 200, settingsResult.body);
        return;
      }

      if (url.pathname === '/api/options') {
        if (req.method === 'GET') {
          sendJson(res, 200, options.get());
          return;
        }
        if (req.method === 'PUT') {
          sendJson(res, 200, await options.save(await readJsonBody(req)));
          return;
        }
      }

      const toolMatch = req.method === 'POST' && url.pathname.match(/^\/api\/tools\/([a-z0-9_]+)$/);
      if (toolMatch) {
        const tool = toolMap.get(toolMatch[1]);
        if (!tool) {
          sendJson(res, 404, { error: 'Unknown tool' });
          return;
        }
        sendJson(res, 200, await executeTool(tool, await readJsonBody(req)));
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.statusCode ?? 500;
      if (status >= 500) {
        console.error(JSON.stringify({ level: 'error', component: 'http', path: url.pathname, message: error.message }));
      }
      if (!res.headersSent) {
        sendJson(res, status, { error: status >= 500 ? 'Internal error' : error.message });
      }
    }
  });

  server.on('close', () => mcp.close());
  return server;
}
