// MCP over stdio, for an assistant on the same machine: node src/stdio.mjs
// Logs go to stderr; stdout belongs to the MCP protocol.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadSettings } from './config.mjs';
import { createMcpServer } from './mcp.mjs';
import { OptionsStore } from './options.mjs';
import { buildTools } from './tools.mjs';

const settings = loadSettings();
const options = await OptionsStore.open(settings.dataDir);
const tools = buildTools({ options });
serveStdio(() => createMcpServer(tools));
