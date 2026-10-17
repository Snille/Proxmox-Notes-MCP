// Settings come from environment variables only, so a container needs no config file to start.
export function loadSettings(env = process.env) {
  const list = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? './data',
    // Host names the service answers to, for example "notes.example.com". Empty accepts any host.
    allowedHosts: list(env.ALLOWED_HOSTS),
    // When set, /mcp needs "Authorization: Bearer <token>". Use it when the reverse proxy lets /mcp through without its own login.
    mcpToken: env.MCP_TOKEN || ''
  };
}
