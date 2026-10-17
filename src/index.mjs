import { loadSettings } from './config.mjs';
import { OptionsStore } from './options.mjs';
import { Proxmox } from './proxmox/index.mjs';
import { SnapshotStore } from './snapshots.mjs';
import { createNotesServer } from './server.mjs';
import { buildTools } from './tools.mjs';
import { version } from './version.mjs';

const settings = loadSettings();
const options = await OptionsStore.open(settings.dataDir);
const proxmox = await Proxmox.open(settings.targetsFile);
const snapshots = new SnapshotStore(settings.dataDir);
const tools = buildTools({ options, proxmox, snapshots });
const server = createNotesServer({ settings, options, tools });

server.listen(settings.port, settings.host, () => {
  console.log(JSON.stringify({
    level: 'info',
    message: 'proxmox-notes started',
    version,
    port: settings.port,
    optionsSource: options.source,
    proxmoxHosts: proxmox.hosts().map(h => `${h.id} (${h.tls})`),
    mcpToken: settings.mcpToken ? 'set' : 'not set',
    allowedHosts: settings.allowedHosts
  }));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
