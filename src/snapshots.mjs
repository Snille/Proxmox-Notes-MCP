import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Before every write the Notes as Proxmox had them are kept here, one JSON file per write:
// <dataDir>/snapshots/<host>/<vmid>/<id>.json. Nothing is deleted automatically.

const ID = /^\d{8}T\d{6}\d{3}Z(?:-\d+)?$/;
const HOST = /^[a-z0-9-]+$/;

export class SnapshotStore {
  constructor(dataDir) {
    this.root = join(dataDir, 'snapshots');
  }

  dir(host, vmid) {
    if (!HOST.test(host) || !Number.isInteger(Number(vmid)) || Number(vmid) <= 0) {
      throw Object.assign(new Error('Invalid host or guest id'), { statusCode: 400 });
    }
    return join(this.root, host, String(Number(vmid)));
  }

  async save({ host, vmid, name, description, digest, reason }) {
    const dir = this.dir(host, vmid);
    await mkdir(dir, { recursive: true });
    const base = new Date().toISOString().replace(/[-:.]/g, '');
    let id = base;
    const existing = new Set(await readdir(dir));
    for (let n = 2; existing.has(`${id}.json`); n++) {
      id = `${base}-${n}`;
    }
    const snapshot = { id, host, vmid: Number(vmid), name, takenAt: new Date().toISOString(), reason, digest, description };
    await writeFile(join(dir, `${id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
    return snapshot;
  }

  async list(host, vmid) {
    const dir = this.dir(host, vmid);
    let files = [];
    try {
      files = (await readdir(dir)).filter(file => file.endsWith('.json'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const snapshots = [];
    for (const file of files) {
      const snapshot = JSON.parse(await readFile(join(dir, file), 'utf8'));
      snapshots.push({ id: snapshot.id, takenAt: snapshot.takenAt, reason: snapshot.reason, length: snapshot.description.length, name: snapshot.name });
    }
    return snapshots.sort((a, b) => b.takenAt.localeCompare(a.takenAt) || b.id.localeCompare(a.id));
  }

  async read(host, vmid, id) {
    if (!ID.test(id)) {
      throw Object.assign(new Error('Invalid snapshot id'), { statusCode: 400 });
    }
    try {
      return JSON.parse(await readFile(join(this.dir(host, vmid), `${id}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw Object.assign(new Error(`Snapshot ${id} was not found`), { statusCode: 404 });
      }
      throw error;
    }
  }
}
