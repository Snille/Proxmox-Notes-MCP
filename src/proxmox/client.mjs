import { Agent, buildConnector } from 'undici';
import { normalizeFingerprint } from './targets.mjs';

const MAX_RESPONSE_BYTES = 5_000_000;

// A pinned connection accepts exactly one certificate, checked before any request byte is sent.
function pinnedAgent(fingerprint) {
  const expected = normalizeFingerprint(fingerprint);
  // No session reuse: a resumed TLS session carries no peer certificate, so every connection
  // must make a full handshake for the fingerprint to be checked.
  const connect = buildConnector({ rejectUnauthorized: false, maxCachedSessions: 0 });
  return new Agent({
    connect(options, callback) {
      connect(options, (error, socket) => {
        if (error) {
          callback(error, null);
          return;
        }
        const actual = normalizeFingerprint(socket.getPeerCertificate()?.fingerprint256);
        if (actual !== expected) {
          socket.destroy();
          callback(new Error(`TLS certificate fingerprint does not match the pinned one (got ${actual.match(/../g)?.join(':')})`), null);
          return;
        }
        callback(null, socket);
      });
    }
  });
}

export class ProxmoxClient {
  constructor(target) {
    this.target = target;
    this.dispatcher = target.fingerprint
      ? pinnedAgent(target.fingerprint)
      : new Agent({ connect: { rejectUnauthorized: target.verifyTls } });
  }

  async request(method, path, { query, form } = {}) {
    const url = new URL(`/api2/json${path}`, this.target.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `PVEAPIToken=${this.target.tokenId}=${this.target.secret}`,
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
        },
        body: form ? form.toString() : undefined,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw Object.assign(new Error(`Proxmox host "${this.target.id}" is not reachable: ${error.cause?.message ?? error.message}`), { statusCode: 502 });
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error(`Proxmox host "${this.target.id}" returned more than ${MAX_RESPONSE_BYTES} bytes`);
    }
    if (!response.ok) {
      // Proxmox puts the reason in the status text, for example "Permission check failed (/vms/101, VM.Audit)".
      const error = new Error(`Proxmox host "${this.target.id}": HTTP ${response.status} ${response.statusText}`);
      error.statusCode = response.status === 403 || response.status === 401 ? 403 : 502;
      throw error;
    }
    return text ? JSON.parse(text).data : null;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  async guests() {
    const resources = await this.get('/cluster/resources', { type: 'vm' });
    return resources
      .filter(r => r.type === 'lxc' || r.type === 'qemu')
      .map(r => ({
        vmid: r.vmid,
        name: r.name ?? '',
        type: r.type,
        node: r.node,
        status: r.status,
        template: Boolean(r.template),
        tags: r.tags ? String(r.tags).split(/[;,\s]+/).filter(Boolean) : []
      }))
      .sort((a, b) => a.vmid - b.vmid);
  }

  async guest(vmid) {
    const guest = (await this.guests()).find(g => g.vmid === Number(vmid));
    if (!guest) {
      throw Object.assign(new Error(`Guest ${vmid} was not found on "${this.target.id}" (or the token may not see it)`), { statusCode: 404 });
    }
    return guest;
  }

  config(guest) {
    return this.get(`/nodes/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}/config`);
  }

  // Only the description is sent. With the digest from the config that was read, Proxmox refuses
  // the write if the config changed in between.
  async setDescription(guest, description, digest) {
    const body = new URLSearchParams({ description });
    if (digest) {
      body.set('digest', digest);
    }
    return this.request('PUT', `/nodes/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}/config`, { form: body });
  }

  // Running LXC containers report their addresses here, which is how a DHCP address is found.
  async lxcInterfaces(guest) {
    if (guest.type !== 'lxc' || guest.status !== 'running') {
      return null;
    }
    try {
      return await this.get(`/nodes/${encodeURIComponent(guest.node)}/lxc/${guest.vmid}/interfaces`);
    } catch {
      return null;
    }
  }
}
