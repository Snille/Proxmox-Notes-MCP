import { ProxmoxClient } from './client.mjs';
import { loadTargets, publicTarget } from './targets.mjs';

export class Proxmox {
  constructor(targets) {
    this.clients = new Map(targets.map(target => [target.id, new ProxmoxClient(target)]));
  }

  static async open(targetsFile) {
    return new Proxmox(await loadTargets(targetsFile));
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
