// MCP over stdio, for an assistant on the same machine: node src/stdio.mjs
// Logs go to stderr; stdout belongs to the MCP protocol.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadSettings } from './config.mjs';
import { createMcpServer } from './mcp.mjs';
import { OptionsStore } from './options.mjs';
import { Proxmox } from './proxmox/index.mjs';
import { SnapshotStore } from './snapshots.mjs';
import { buildTools } from './tools.mjs';

const settings = loadSettings();
const options = await OptionsStore.open(settings.dataDir);
const proxmox = await Proxmox.open(settings.targetsFile);
const snapshots = new SnapshotStore(settings.dataDir);
const tools = buildTools({ options, proxmox, snapshots });
serveStdio(() => createMcpServer(tools));
