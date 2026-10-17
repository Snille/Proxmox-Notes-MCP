import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/format/index.mjs';
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
