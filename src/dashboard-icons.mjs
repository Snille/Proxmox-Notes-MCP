// Search and fetch icons from the open dashboard-icons set (https://github.com/homarr-labs/dashboard-icons,
// Apache-2.0; the logos belong to their owners). Only tree.json is read for the names; the browser
// gets images through the server, because the page's CSP allows no other origin.

const BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
const MAX_TREE_BYTES = 5_000_000;
const MAX_IMAGE_BYTES = 3_000_000;
const CACHE_MS = 24 * 60 * 60 * 1000;

let cache = { names: null, at: 0 };

async function fetchLimited(url, maxBytes) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(error => {
    throw Object.assign(new Error(`dashboard-icons is not reachable: ${error.cause?.message ?? error.message}`), { statusCode: 502 });
  });
  if (!response.ok) {
    throw Object.assign(new Error(`dashboard-icons answered HTTP ${response.status}`), { statusCode: response.status === 404 ? 404 : 502 });
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) {
    throw Object.assign(new Error('dashboard-icons sent more data than expected'), { statusCode: 502 });
  }
  return { data, type: response.headers.get('content-type') ?? '' };
}

export async function dashboardIconNames() {
  if (cache.names && Date.now() - cache.at < CACHE_MS) {
    return cache.names;
  }
  const { data } = await fetchLimited(`${BASE}/tree.json`, MAX_TREE_BYTES);
  const tree = JSON.parse(data.toString('utf8'));
  const names = (tree.png ?? []).filter(file => file.endsWith('.png')).map(file => file.slice(0, -4)).sort();
  cache = { names, at: Date.now() };
  return names;
}

export async function searchDashboardIcons(query, limit = 60) {
  const names = await dashboardIconNames();
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? names.filter(name => words.every(word => name.includes(word))) : names;
  // Exact and prefix matches first.
  const first = words[0] ?? '';
  hits.sort((a, b) => Number(b === first) - Number(a === first) || Number(b.startsWith(first)) - Number(a.startsWith(first)) || a.localeCompare(b));
  return { total: hits.length, names: hits.slice(0, limit) };
}

export async function fetchDashboardIcon(name) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || !(await dashboardIconNames()).includes(name)) {
    throw Object.assign(new Error(`"${name}" is not in dashboard-icons`), { statusCode: 404 });
  }
  const { data } = await fetchLimited(`${BASE}/png/${name}.png`, MAX_IMAGE_BYTES);
  return data;
}
