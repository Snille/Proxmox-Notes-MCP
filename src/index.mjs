import { loadSettings } from './config.mjs';
import { OptionsStore } from './options.mjs';
import { createNotesServer } from './server.mjs';
import { buildTools } from './tools.mjs';
import { version } from './version.mjs';

const settings = loadSettings();
const options = await OptionsStore.open(settings.dataDir);
const tools = buildTools({ options });
const server = createNotesServer({ settings, options, tools });

server.listen(settings.port, settings.host, () => {
  console.log(JSON.stringify({
    level: 'info',
    message: 'proxmox-notes started',
    version,
    port: settings.port,
    optionsSource: options.source,
    mcpToken: settings.mcpToken ? 'set' : 'not set',
    allowedHosts: settings.allowedHosts
  }));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
