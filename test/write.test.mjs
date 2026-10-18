import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDocument, PROXMOX_DESCRIPTION_LIMIT, renderNotes } from '../src/format/index.mjs';
import { IconStore } from '../src/icons.mjs';
import { DEFAULT_OPTIONS } from '../src/options.mjs';
import { SnapshotStore } from '../src/snapshots.mjs';
import { buildTools, executeTool } from '../src/tools.mjs';

// A Proxmox host in memory: one guest, a digest that changes on every write.
function fakeProxmox() {
  const guest = { vmid: 101, name: 'test01', type: 'lxc', node: 'pve1', status: 'running', template: false, tags: [] };
  const state = { description: 'Old notes\n', digest: 'd1', writes: [], storeDifferent: false };
  const client = {
    guest: async vmid => {
      if (Number(vmid) !== 101) throw Object.assign(new Error('not found'), { statusCode: 404 });
      return guest;
    },
    config: async () => ({ hostname: 'test01', description: state.description, digest: state.digest }),
    setDescription: async (_guest, description, digest) => {
      if (digest !== state.digest) throw new Error('HTTP 500 detected modified configuration');
      state.writes.push(description);
      // Proxmox does not keep the final newline.
      state.description = state.storeDifferent ? 'something else' : description.trimEnd();
      state.digest = `d${state.writes.length + 1}`;
    }
  };
  return { state, proxmox: { client: () => client, hosts: () => [] } };
}

let tools;
let state;
let snapshots;
const run = (name, args) => executeTool(tools.find(t => t.name === name), args);

beforeEach(async () => {
  const fake = fakeProxmox();
  state = fake.state;
  snapshots = new SnapshotStore(await mkdtemp(join(tmpdir(), 'proxmox-notes-write-')));
  tools = buildTools({ options: { get: () => DEFAULT_OPTIONS, source: 'default' }, proxmox: fake.proxmox, snapshots });
});

function sampleDoc() {
  const doc = emptyDocument();
  doc.title = 'Test 01';
  doc.sections = [];
  return doc;
}

describe('write in two steps', () => {
  it('previews, writes after confirmation, keeps a snapshot and verifies', async () => {
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, doc: sampleDoc() });
    expect(prepared).toMatchObject({ changed: true, current: 'Old notes\n' });
    expect(prepared.next.startsWith('<table width="100%">')).toBe(true);
    expect(state.writes).toHaveLength(0);

    const written = await run('notes_write_confirmed', { confirmation: prepared.confirmation });
    expect(written).toMatchObject({ written: true, vmid: 101 });
    expect(state.writes).toEqual([prepared.next]);

    const { snapshots: list } = await run('notes_snapshots', { host: 'pve1', vmid: 101 });
    expect(list).toHaveLength(1);
    const snapshot = await run('notes_snapshot', { host: 'pve1', vmid: 101, id: list[0].id });
    expect(snapshot.description).toBe('Old notes\n');
    expect(snapshot.parsed.ok).toBe(false);
  });

  it('uses a confirmation only once', async () => {
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, markdown: 'New text' });
    await run('notes_write_confirmed', { confirmation: prepared.confirmation });
    await expect(run('notes_write_confirmed', { confirmation: prepared.confirmation })).rejects.toThrow(/Unknown, used or expired/);
    expect(state.writes).toHaveLength(1);
  });

  it('writes nothing when the guest changed after the preview', async () => {
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, markdown: 'New text' });
    state.digest = 'changed-by-someone-else';
    await expect(run('notes_write_confirmed', { confirmation: prepared.confirmation })).rejects.toThrow(/changed since the preview/);
    expect(state.writes).toHaveLength(0);
    expect(await snapshots.list('pve1', 101)).toHaveLength(0);
  });

  it('reports no change and gives no confirmation when the text is the same', async () => {
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, markdown: 'Old notes' });
    expect(prepared).toMatchObject({ changed: false, confirmation: null });
  });

  it('refuses text over the Proxmox limit', async () => {
    await expect(run('notes_prepare_write', { host: 'pve1', vmid: 101, markdown: 'x'.repeat(8193) })).rejects.toThrow(/8192/);
  });

  it('needs exactly one of doc and markdown', async () => {
    await expect(run('notes_prepare_write', { host: 'pve1', vmid: 101 })).rejects.toThrow(/either doc or markdown/);
    await expect(run('notes_prepare_write', { host: 'pve1', vmid: 101, doc: sampleDoc(), markdown: 'x' })).rejects.toThrow(/either doc or markdown/);
  });

  it('says so when Proxmox stored something else, and names the snapshot', async () => {
    state.storeDifferent = true;
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, markdown: 'New text' });
    await expect(run('notes_write_confirmed', { confirmation: prepared.confirmation })).rejects.toThrow(/stored Notes differ.*snapshot \d{8}T/);
  });
});

describe('an embedded library icon that does not fit', () => {
  // Only the file signature is checked, so a RIFF/WEBP header with filler is a test icon.
  const webp = (bytes, fill) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(bytes, fill)]);
  const main = webp(4000, 1);
  const medium = webp(3000, 2);
  const small = webp(1200, 3);
  let icons;
  let dataDir;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'proxmox-notes-fit-'));
    icons = await IconStore.open(dataDir);
    tools = buildTools({ options: { get: () => DEFAULT_OPTIONS, source: 'default' }, proxmox: fakeProxmox().proxmox, snapshots, icons });
  });

  const noteWith = async (icon, notes) => {
    const { doc } = await run('notes_new', { title: 'MiniCube', icon });
    return { ...doc, notes };
  };

  it('puts in the largest smaller copy that makes the Note fit, and says so', async () => {
    await icons.add({ label: 'AI', webp: main.toString('base64'), quality: 0.85, width: 100, height: 100, variants: [
      { quality: 0.65, webp: medium.toString('base64') },
      { quality: 0.45, webp: small.toString('base64') }
    ] });
    const doc = await noteWith('ai', 'x'.repeat(2500));
    expect(renderNotes(doc).length).toBeGreaterThan(PROXMOX_DESCRIPTION_LIMIT);

    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, doc });
    expect(prepared.length).toBeLessThanOrEqual(PROXMOX_DESCRIPTION_LIMIT);
    expect(prepared.next).toContain(medium.toString('base64'));
    expect(prepared.icon).toMatchObject({ id: 'ai', swapped: true, quality: 0.65 });
    expect(prepared.icon.message).toMatch(/lower quality \(65\)/);

    const rendered = await run('notes_render', { doc });
    expect(rendered).toMatchObject({ fits: true, icon: { swapped: true, quality: 0.65 } });
    expect(rendered.doc.image.src).toBe(`data:image/webp;base64,${medium.toString('base64')}`);
  });

  it('takes the smallest copy when only that fits', async () => {
    await icons.add({ label: 'AI', webp: main.toString('base64'), variants: [
      { quality: 0.65, webp: medium.toString('base64') },
      { quality: 0.45, webp: small.toString('base64') }
    ] });
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, doc: await noteWith('ai', 'x'.repeat(3500)) });
    expect(prepared.icon).toMatchObject({ swapped: true, quality: 0.45 });
  });

  it('leaves a Note that fits as it is', async () => {
    await icons.add({ label: 'AI', webp: main.toString('base64'), variants: [{ quality: 0.45, webp: small.toString('base64') }] });
    const prepared = await run('notes_prepare_write', { host: 'pve1', vmid: 101, doc: await noteWith('ai', 'short') });
    expect(prepared.icon).toBeUndefined();
    expect(prepared.next).toContain(main.toString('base64'));
  });

  it('refuses with a clear message for an icon without smaller copies', async () => {
    await icons.add({ label: 'Old', webp: main.toString('base64') });
    await expect(run('notes_prepare_write', { host: 'pve1', vmid: 101, doc: await noteWith('old', 'x'.repeat(2500)) }))
      .rejects.toThrow(/8192\. The icon "old" has no smaller copy/);
  });

  it('refuses when even the smallest copy is too large', async () => {
    await icons.add({ label: 'AI', webp: main.toString('base64'), variants: [{ quality: 0.45, webp: small.toString('base64') }] });
    await expect(run('notes_prepare_write', { host: 'pve1', vmid: 101, doc: await noteWith('ai', 'x'.repeat(6000)) }))
      .rejects.toThrow(/Even the smallest copy of the icon "ai"/);
  });

  it('does not swap an image that is not the library icon', async () => {
    await icons.add({ label: 'AI', webp: main.toString('base64'), variants: [{ quality: 0.45, webp: small.toString('base64') }] });
    const doc = await noteWith('ai', 'x'.repeat(2500));
    doc.image.src = `data:image/webp;base64,${webp(4000, 9).toString('base64')}`;
    await expect(run('notes_prepare_write', { host: 'pve1', vmid: 101, doc })).rejects.toThrow(/^The Notes are \d+ characters; Proxmox allows 8192\.$/);
  });

  it('keeps the copies on disk, replaces them with the icon and removes them with it', async () => {
    await icons.add({ label: 'AI', webp: main.toString('base64'), variants: [
      { quality: 0.65, webp: medium.toString('base64') },
      { quality: 0.45, webp: small.toString('base64') }
    ] });
    expect(icons.get('ai').variants).toEqual([
      { file: 'ai.v1.webp', quality: 0.65, bytes: medium.length },
      { file: 'ai.v2.webp', quality: 0.45, bytes: small.length }
    ]);
    expect((await icons.encodings('ai')).map(encoding => encoding.quality)).toEqual([null, 0.65, 0.45]);

    await icons.add({ label: 'AI', webp: main.toString('base64'), replace: true });
    expect(icons.get('ai').variants).toBeUndefined();
    expect(existsSync(join(dataDir, 'icons', 'ai.v1.webp'))).toBe(false);

    await icons.add({ label: 'AI', webp: main.toString('base64'), replace: true, variants: [{ quality: 0.45, webp: small.toString('base64') }] });
    await icons.remove('ai');
    expect(existsSync(join(dataDir, 'icons', 'ai.v1.webp'))).toBe(false);
  });

  it('refuses variants that are not WebP images, or too many', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
    await expect(icons.add({ label: 'AI', webp: main.toString('base64'), variants: [{ quality: 0.5, webp: png.toString('base64') }] }))
      .rejects.toThrow(/Every variant must be a WebP image/);
    const five = Array.from({ length: 5 }, () => ({ quality: 0.5, webp: small.toString('base64') }));
    await expect(icons.add({ label: 'AI', webp: main.toString('base64'), variants: five })).rejects.toThrow(/at most 4/);
    expect(icons.list()).toHaveLength(0);
  });
});

describe('snapshot store', () => {
  it('refuses path tricks in host, guest id and snapshot id', async () => {
    expect(() => snapshots.dir('../x', 1)).toThrow(/Invalid/);
    expect(() => snapshots.dir('pve1', '1/../2')).toThrow(/Invalid/);
    await expect(snapshots.read('pve1', 101, '../../etc/passwd')).rejects.toThrow(/Invalid snapshot id/);
  });

  it('keeps two snapshots taken in the same millisecond apart', async () => {
    const a = await snapshots.save({ host: 'pve1', vmid: 5, name: 'a', description: 'one', digest: 'x', reason: 'test' });
    const b = await snapshots.save({ host: 'pve1', vmid: 5, name: 'a', description: 'two', digest: 'y', reason: 'test' });
    expect(a.id).not.toBe(b.id);
    expect((await snapshots.list('pve1', 5)).map(s => s.length).sort()).toEqual([3, 3]);
  });
});
