'use strict';
const fs = require('node:fs');
const { createMcpServer } = require('./server.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
(async () => {
 const key = fs.readFileSync(process.env.XUNJI_API_KEY_FILE, 'utf8').trim();
 const { server } = createMcpServer({ credentialProvider: async () => key, localAppData: process.env.LOCALAPPDATA || '/app/data' });
 await server.connect(new StdioServerTransport());
})().catch(() => { console.error('Unable to start SSH/stdio MCP server'); process.exitCode=1; });
