import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { hostHeaderValidation } from '@modelcontextprotocol/node';
import { createMcpNodeHandler } from './mcp.mjs';
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

const WEB_ASSETS = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' }
};

// Embedded icons make a Note up to 8 KB; this leaves room for an imported legacy file or options.
const MAX_BODY_BYTES = 2_000_000;

function sendJson(res, status, document) {
  const body = JSON.stringify(document);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...SECURITY_HEADERS
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`), { statusCode: 413 });
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

export function createNotesServer({ settings, options, tools }) {
  const toolMap = new Map(tools.map(tool => [tool.name, tool]));
  const validateHost = settings.allowedHosts.length ? hostHeaderValidation(settings.allowedHosts) : null;
  const mcp = createMcpNodeHandler(tools);
  const webRoot = new URL('./web/', import.meta.url);

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

      const asset = req.method === 'GET' && WEB_ASSETS[url.pathname];
      if (asset) {
        const body = await readFile(new URL(asset.file, webRoot));
        res.writeHead(200, {
          'content-type': asset.type,
          'content-length': body.length,
          'content-security-policy': CONTENT_SECURITY_POLICY,
          ...SECURITY_HEADERS
        });
        res.end(body);
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
