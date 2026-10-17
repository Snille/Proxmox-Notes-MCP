import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { executeTool } from './tools.mjs';
import { version } from './version.mjs';

const INSTRUCTIONS = [
  'This server creates and reads Proxmox guest Notes.',
  'A Note is a JSON document; notes_render turns it into the Markdown Proxmox shows and checks the 8192-character limit.',
  'Start a new Note with notes_new or notes_prefill, read a guest\'s Notes with notes_read.',
  'Writing takes two steps: notes_prepare_write returns the current and the new text and a single-use confirmation; show the change to the user, and call notes_write_confirmed only after they approve it.',
  'Every write keeps the previous Notes as a snapshot (notes_snapshots, notes_snapshot).'
].join(' ');

export function createMcpServer(tools) {
  const server = new McpServer({ name: 'proxmox-notes', version }, { instructions: INSTRUCTIONS });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async args => {
        try {
          const result = await executeTool(tool, args);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          return { content: [{ type: 'text', text: error.message }], isError: true };
        }
      }
    );
  }
  return server;
}

export function createMcpNodeHandler(tools) {
  const handler = createMcpHandler(() => createMcpServer(tools), {
    legacy: 'stateless',
    responseMode: 'auto',
    onerror: error => console.error(JSON.stringify({ level: 'error', component: 'mcp', message: error.message }))
  });
  return { nodeHandler: toNodeHandler(handler), close: () => handler.close() };
}
