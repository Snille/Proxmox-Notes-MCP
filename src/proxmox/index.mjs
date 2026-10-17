import { ProxmoxClient } from './client.mjs';
import { publicTarget, TargetStore } from './targets.mjs';

export class Proxmox {
  constructor(targets = [], store = null) {
    this.store = store;
    this.setTargets(targets);
  }

  static async open(targetsFile) {
    const store = await TargetStore.open(targetsFile);
    return new Proxmox(await store.resolved(), store);
  }

  setTargets(targets) {
    this.clients = new Map(targets.map(target => [target.id, new ProxmoxClient(target)]));
  }

  // After the settings page changed targets.json.
  async reload() {
    if (this.store) {
      this.setTargets(await this.store.resolved());
    }
  }

  hosts() {
    return [...this.clients.values()].map(client => publicTarget(client.target));
  }

  client(host) {
    const client = this.clients.get(host);
    if (!client) {
      const known = [...this.clients.keys()].join(', ') || 'none configured';
      throw Object.assign(new Error(`Unknown Proxmox host "${host}" (known: ${known})`), { statusCode: 404 });
    }
    return client;
  }
}
