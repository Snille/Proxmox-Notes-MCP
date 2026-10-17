import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as z from 'zod';

// The Proxmox hosts one instance manages, from <dataDir>/targets.json (or TARGETS_FILE).
// A token secret is given inline (tokenSecret) or, better, as a file (tokenSecretFile), for
// example a Docker secret. Secrets never leave this module except in the Authorization header.

const targetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id must be lower-case letters, digits and dashes'),
  name: z.string().optional(),
  baseUrl: z.url().refine(value => value.startsWith('https://'), 'baseUrl must use https://'),
  tokenId: z.string().regex(/^[^@\s]+@[^!\s]+![^\s=]+$/, 'tokenId looks like user@realm!tokenname'),
  tokenSecret: z.string().min(1).optional(),
  tokenSecretFile: z.string().min(1).optional(),
  // SHA-256 fingerprint of the host's certificate (pin), or verifyTls against the system CAs.
  fingerprint: z.string().regex(/^([0-9A-Fa-f]{2}:?){32}$/, 'fingerprint is a SHA-256 hex fingerprint').optional(),
  verifyTls: z.boolean().default(true)
}).strict().refine(t => t.tokenSecret || t.tokenSecretFile, 'tokenSecret or tokenSecretFile is required');

const fileSchema = z.object({ targets: z.array(targetSchema) }).strict();

export function normalizeFingerprint(value) {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

export function tlsMode(target) {
  if (target.fingerprint) return 'pinned';
  return target.verifyTls ? 'verified' : 'insecure';
}

// What may be shown to users: everything except the secret.
export function publicTarget(target) {
  return { id: target.id, name: target.name ?? target.id, baseUrl: target.baseUrl, tokenId: target.tokenId, tls: tlsMode(target) };
}

export async function loadTargets(file) {
  if (!existsSync(file)) {
    return [];
  }
  const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid ${file}: ${z.prettifyError(parsed.error)}`);
  }
  const ids = new Set();
  const targets = [];
  for (const target of parsed.data.targets) {
    if (ids.has(target.id)) {
      throw new Error(`Invalid ${file}: target id "${target.id}" is used twice`);
    }
    ids.add(target.id);
    let secret = target.tokenSecret;
    if (!secret) {
      if (!existsSync(target.tokenSecretFile)) {
        throw new Error(`Target "${target.id}": tokenSecretFile ${target.tokenSecretFile} does not exist`);
      }
      secret = (await readFile(target.tokenSecretFile, 'utf8')).trim();
    }
    const { tokenSecret, tokenSecretFile, ...rest } = target;
    // Keep the secret out of enumerable properties, so a stray JSON.stringify cannot print it.
    Object.defineProperty(rest, 'secret', { value: secret, enumerable: false });
    targets.push(rest);
  }
  return targets;
}
