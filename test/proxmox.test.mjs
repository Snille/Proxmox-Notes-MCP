import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newDocument, DEFAULT_OPTIONS } from '../src/options.mjs';
import { applyFacts, guestFacts, parsePropertyString } from '../src/proxmox/facts.mjs';
import { Proxmox } from '../src/proxmox/index.mjs';
import { loadTargets, normalizeFingerprint, publicTarget } from '../src/proxmox/targets.mjs';

const FINGERPRINT = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

async function targetsFile(document, extraFiles = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'proxmox-notes-targets-'));
  for (const [name, content] of Object.entries(extraFiles)) {
    await writeFile(join(dir, name), content);
  }
  const file = join(dir, 'targets.json');
  await writeFile(file, JSON.stringify(typeof document === 'function' ? document(dir) : document));
  return file;
}

describe('targets', () => {
  it('reads the secret from a file and never shows it', async () => {
    const file = await targetsFile(dir => ({
      targets: [{ id: 'pve1', baseUrl: 'https://192.0.2.10:8006', tokenId: 'proxmox-notes@pve!notes', tokenSecretFile: join(dir, 'pve1-token.txt'), fingerprint: FINGERPRINT }]
    }), { 'pve1-token.txt': 'not-a-real-secret\n' });
    const [target] = await loadTargets(file);
    expect(target.secret).toBe('not-a-real-secret');
    expect(JSON.stringify(target)).not.toContain('not-a-real-secret');
    expect(publicTarget(target)).toEqual({ id: 'pve1', name: 'pve1', baseUrl: 'https://192.0.2.10:8006', tokenId: 'proxmox-notes@pve!notes', tls: 'pinned' });
    expect(JSON.stringify(new Proxmox([target]).hosts())).not.toContain('not-a-real-secret');
  });

  it('returns no targets when the file does not exist', async () => {
    expect(await loadTargets(join(tmpdir(), 'does-not-exist', 'targets.json'))).toEqual([]);
  });

  it('rejects http, a bad token id, a missing secret and duplicate ids', async () => {
    const base = { id: 'a', baseUrl: 'https://192.0.2.10:8006', tokenId: 'u@pve!t', tokenSecret: 'x' };
    await expect(loadTargets(await targetsFile({ targets: [{ ...base, baseUrl: 'http://192.0.2.10:8006' }] }))).rejects.toThrow(/https/);
    await expect(loadTargets(await targetsFile({ targets: [{ ...base, tokenId: 'nope' }] }))).rejects.toThrow(/tokenId/);
    await expect(loadTargets(await targetsFile({ targets: [{ ...base, tokenSecret: undefined }] }))).rejects.toThrow(/tokenSecret/);
    await expect(loadTargets(await targetsFile({ targets: [base, base] }))).rejects.toThrow(/used twice/);
  });

  it('normalizes fingerprints', () => {
    expect(normalizeFingerprint('aa:bb:0c')).toBe('AABB0C');
  });

  it('names the known hosts when an unknown one is asked for', () => {
    expect(() => new Proxmox([]).client('x')).toThrow(/none configured/);
  });
});

describe('guest facts', () => {
  it('parses a property string', () => {
    expect(parsePropertyString('name=eth0,ip=dhcp,hwaddr=BC:24:11:00:00:0A')).toEqual({ name: 'eth0', ip: 'dhcp', hwaddr: 'BC:24:11:00:00:0A' });
  });

  it('reads a static LXC address and writes the MAC in lower case', () => {
    const guest = { vmid: 104, node: 'pve1', type: 'lxc', status: 'running', name: 'Sonarr02' };
    const config = { hostname: 'Sonarr02', ostype: 'debian', onboot: 1, tags: 'arr;media', net0: 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:0A,ip=192.0.2.36/24,gw=192.0.2.1,type=veth' };
    expect(guestFacts(guest, config)).toMatchObject({ hostname: 'Sonarr02', ip: '192.0.2.36', mac: 'bc:24:11:00:00:0a', dhcp: false, os: 'Debian', tags: ['arr', 'media'], onboot: true });
  });

  it('finds the DHCP address of a running LXC from its interfaces', () => {
    const guest = { vmid: 105, node: 'pve1', type: 'lxc', status: 'running', name: 'test' };
    const config = { hostname: 'test', net0: 'name=eth0,hwaddr=BC:24:11:00:00:0B,ip=dhcp' };
    const interfaces = [{ name: 'lo', inet: '127.0.0.1/8' }, { name: 'eth0', inet: '192.0.2.77/24' }];
    expect(guestFacts(guest, config, interfaces)).toMatchObject({ ip: '192.0.2.77', dhcp: true });
    expect(guestFacts(guest, config, null)).toMatchObject({ ip: '', dhcp: true });
  });

  it('reads a VM MAC and a cloud-init address', () => {
    const guest = { vmid: 100, node: 'pve1', type: 'qemu', status: 'running', name: 'Mint01' };
    const config = { name: 'Mint01', ostype: 'l26', net0: 'virtio=BC:24:11:00:00:0C,bridge=vmbr0', ipconfig0: 'ip=192.0.2.57/24,gw=192.0.2.1' };
    expect(guestFacts(guest, config)).toMatchObject({ hostname: 'Mint01', mac: 'bc:24:11:00:00:0c', ip: '192.0.2.57', dhcp: false, os: 'Linux' });
    expect(guestFacts(guest, { ...config, ipconfig0: undefined })).toMatchObject({ ip: '', dhcp: null });
  });

  it('fills the template rows a Note already has', () => {
    const doc = applyFacts(newDocument(DEFAULT_OPTIONS), { hostname: 'Sonarr02', ip: '192.0.2.36', mac: 'bc:24:11:00:00:0a', dhcp: false, os: 'Debian' });
    const rows = Object.fromEntries(doc.sections.flatMap(s => s.rows).filter(r => r.type === 'field').map(r => [r.key, r.value]));
    expect(doc.title).toBe('Sonarr02');
    expect(rows).toMatchObject({ IP: '192.0.2.36', MAC: 'bc:24:11:00:00:0a', DHCP: 'No', OS: 'Debian' });
  });
});
