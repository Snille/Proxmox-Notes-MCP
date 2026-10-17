import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as z from 'zod';

// The Proxmox hosts one instance manages, from <dataDir>/targets.json (or TARGETS_FILE).
// A token secret is given inline (tokenSecret, which is how the settings page stores it) or as a
// file (tokenSecretFile), for example a Docker secret. Secrets never leave this module except in
// the Authorization header.

const ID = z.string().regex(/^[a-z0-9-]+$/, 'id must be lower-case letters, digits and dashes');
const BASE_URL = z.url().refine(value => value.startsWith('https://'), 'baseUrl must use https://');
const TOKEN_ID = z.string().regex(/^[^@\s]+@[^!\s]+![^\s=]+$/, 'tokenId looks like user@realm!tokenname');
const FINGERPRINT = z.string().regex(/^([0-9A-Fa-f]{2}:?){32}$/, 'fingerprint is a SHA-256 hex fingerprint');

const targetSchema = z.object({
  id: ID,
  name: z.string().optional(),
  baseUrl: BASE_URL,
  tokenId: TOKEN_ID,
  tokenSecret: z.string().min(1).optional(),
  tokenSecretFile: z.string().min(1).optional(),
  // SHA-256 fingerprint of the host's certificate (pin), or verifyTls against the system CAs.
  fingerprint: FINGERPRINT.optional(),
  verifyTls: z.boolean().default(true)
}).strict().refine(t => t.tokenSecret || t.tokenSecretFile, 'tokenSecret or tokenSecretFile is required');

const fileSchema = z.object({ targets: z.array(targetSchema) }).strict();

// What the settings page sends. An empty or missing tokenSecret keeps the stored secret.
export const targetInputSchema = z.object({
  id: ID,
  name: z.string().max(80).optional(),
  baseUrl: BASE_URL,
  tokenId: TOKEN_ID,
  tokenSecret: z.string().optional(),
  fingerprint: z.union([FINGERPRINT, z.literal('')]).optional(),
  verifyTls: z.boolean().default(true)
}).strict();

export function normalizeFingerprint(value) {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

export function formatFingerprint(value) {
  return normalizeFingerprint(value).match(/../g)?.join(':') ?? '';
}

export function tlsMode(target) {
  if (target.fingerprint) return 'pinned';
  return target.verifyTls ? 'verified' : 'insecure';
}

// What may be shown to users: everything except the secret.
export function publicTarget(target) {
  return {
    id: target.id,
    name: target.name ?? target.id,
    baseUrl: target.baseUrl,
    tokenId: target.tokenId,
    tls: tlsMode(target),
    fingerprint: target.fingerprint ?? '',
    verifyTls: target.verifyTls !== false,
    secretSource: target.tokenSecretFile ? 'file' : 'stored'
  };
}

function parseFile(text, file) {
  const parsed = fileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Invalid ${file}: ${z.prettifyError(parsed.error)}`);
  }
  const ids = new Set();
  for (const target of parsed.data.targets) {
    if (ids.has(target.id)) {
      throw new Error(`Invalid ${file}: target id "${target.id}" is used twice`);
    }
    ids.add(target.id);
  }
  return parsed.data.targets;
}

export async function resolveTarget(raw) {
  let secret = raw.tokenSecret;
  if (!secret) {
    if (!existsSync(raw.tokenSecretFile)) {
      throw new Error(`Target "${raw.id}": tokenSecretFile ${raw.tokenSecretFile} does not exist`);
    }
    secret = (await readFile(raw.tokenSecretFile, 'utf8')).trim();
  }
  const { tokenSecret, ...rest } = raw;
  // Keep the secret out of enumerable properties, so a stray JSON.stringify cannot print it.
  Object.defineProperty(rest, 'secret', { value: secret, enumerable: false });
  return rest;
}

export async function loadTargets(file) {
  if (!existsSync(file)) {
    return [];
  }
  return Promise.all(parseFile(await readFile(file, 'utf8'), file).map(resolveTarget));
}

// Reads and writes targets.json for the settings page. The file holds secrets, so it is written
// with mode 600 and replaced atomically.
export class TargetStore {
  constructor(file) {
    this.file = file;
    this.raw = [];
  }

  static async open(file) {
    const store = new TargetStore(file);
    if (existsSync(file)) {
      store.raw = parseFile(await readFile(file, 'utf8'), file);
    }
    return store;
  }

  resolved() {
    return Promise.all(this.raw.map(resolveTarget));
  }

  list() {
    return this.raw.map(publicTarget);
  }

  find(id) {
    return this.raw.find(target => target.id === id) ?? null;
  }

  // Builds the stored entry from settings input without saving it, so it can be tested first.
  merge(input) {
    const parsed = targetInputSchema.safeParse(input);
    if (!parsed.success) {
      throw Object.assign(new Error(`Invalid host: ${z.prettifyError(parsed.error)}`), { statusCode: 400 });
    }
    const data = parsed.data;
    const existing = this.find(data.id);
    const entry = { id: data.id, baseUrl: data.baseUrl, tokenId: data.tokenId, verifyTls: data.verifyTls };
    if (data.name) entry.name = data.name;
    if (data.fingerprint) entry.fingerprint = formatFingerprint(data.fingerprint);
    if (data.tokenSecret) {
      entry.tokenSecret = data.tokenSecret.trim();
    } else if (existing?.tokenSecret) {
      entry.tokenSecret = existing.tokenSecret;
    } else if (existing?.tokenSecretFile) {
      entry.tokenSecretFile = existing.tokenSecretFile;
    } else {
      throw Object.assign(new Error('A token secret is required for a new host'), { statusCode: 400 });
    }
    return targetSchema.parse(entry);
  }

  async upsert(input) {
    const entry = this.merge(input);
    const next = this.raw.filter(target => target.id !== entry.id);
    const index = this.raw.findIndex(target => target.id === entry.id);
    next.splice(index === -1 ? next.length : index, 0, entry);
    await this.write(next);
    return publicTarget(entry);
  }

  async remove(id) {
    if (!this.find(id)) {
      throw Object.assign(new Error(`Unknown Proxmox host "${id}"`), { statusCode: 404 });
    }
    await this.write(this.raw.filter(target => target.id !== id));
  }

  async write(targets) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ targets }, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => {});
    await rename(temporary, this.file);
    this.raw = targets;
  }
}
