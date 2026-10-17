import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const webDir = new URL('../src/web/', import.meta.url);
const source = readFileSync(new URL('i18n.js', webDir), 'utf8');

// The two dictionaries are object literals named en and sv; read their keys from the source,
// so the test needs no browser.
function keysOf(name) {
  const start = source.indexOf(`const ${name} = {`);
  const end = source.indexOf('\n};', start);
  const body = source.slice(start, end);
  // A key starts a line or follows ", ", and its value is always a single-quoted string.
  return new Set([...body.matchAll(/(?:^\s*|, )'?([\w.]+)'?: '/gm)].map(match => match[1]));
}

const en = keysOf('en');
const sv = keysOf('sv');

function usedKeys() {
  const keys = new Set();
  const html = readFileSync(new URL('index.html', webDir), 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-title|-placeholder|-aria-label)?="([^"]+)"/g)) keys.add(match[1]);
  for (const file of readdirSync(webDir).filter(name => name.endsWith('.js') && name !== 'i18n.js')) {
    const code = readFileSync(new URL(file, webDir), 'utf8');
    for (const match of code.matchAll(/\bt\('([\w.]+)'/g)) keys.add(match[1]);
  }
  return keys;
}

describe('interface texts', () => {
  it('has every key that the page and the code use, in English', () => {
    const missing = [...usedKeys()].filter(key => !en.has(key));
    expect(missing).toEqual([]);
  });

  it('has the same keys in Swedish as in English', () => {
    expect([...en].filter(key => !sv.has(key))).toEqual([]);
    expect([...sv].filter(key => !en.has(key))).toEqual([]);
  });
});
