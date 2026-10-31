'use strict';
const http = require('node:http');
const fs = require('node:fs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { createMcpServer, createTrainingService } = require('./server.js');

function secret(name) {
  const value = process.env[`${name}_FILE`] ? fs.readFileSync(process.env[`${name}_FILE`], 'utf8').trim() : (process.env[name] || '').trim();
  if (!value || /\s/.test(value)) throw new Error(`${name} must be configured`);
  return value;
}
const accessToken = secret('MCP_APP_ACCESS_TOKEN');
if (accessToken.length < 32) throw new Error('MCP_APP_ACCESS_TOKEN must contain at least 32 characters');
const trainingKey = secret('XUNJI_API_KEY');
const service = createTrainingService({ credentialProvider: async () => trainingKey, localAppData: process.env.LOCALAPPDATA || '/app/data' });
const sessions = new Map();
const TTL = 30 * 60 * 1000;
const allowedHosts = new Set((process.env.MCP_ALLOWED_HOSTS || '10.0.0.45:8091,127.0.0.1:8091,localhost:8091,localhost:8080,127.0.0.1:8080,fitness-mcp.eziosudo.org').split(',').map(x => x.trim()));
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function authenticated(req) {
  const headers = req.rawHeaders.filter((_, i) => i % 2 === 0).filter(x => x.toLowerCase() === 'authorization');
  if (headers.length !== 1) return false;
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
  if (!match) return false;
  const a = Buffer.from(match[1]), b = Buffer.from(accessToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw Object.assign(new Error('body too large'), { status: 413 }); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}
async function closeSession(id) {
  const entry = sessions.get(id); if (!entry) return;
  sessions.delete(id); await entry.server.close().catch(() => {});
}
const listener = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has((req.headers.host || '').toLowerCase())) return json(res, 403, { error: 'Invalid Host' });
    if (req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { return json(res, 403, { error: 'Invalid Origin' }); }
      if (!allowedHosts.has(origin.host.toLowerCase())) return json(res, 403, { error: 'Invalid Origin' });
    }
    // Docker health probe carries no credential and reveals no account data.
    if (req.url === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
    if (!authenticated(req)) { res.setHeader('WWW-Authenticate', 'Bearer'); return json(res, 401, { error: 'Unauthorized' }); }
    if (req.url !== '/mcp') return json(res, 404, { error: 'Not found' });
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
    const id = req.headers['mcp-session-id'];
    if (id && (typeof id !== 'string' || !sessions.has(id))) return json(res, 404, { error: 'Unknown MCP session' });
    let parsed;
    if (req.method === 'POST') {
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(res, 415, { error: 'Expected application/json' });
      parsed = await body(req);
    }
    let entry = id ? sessions.get(id) : null;
    if (!entry) {
      if (req.method !== 'POST' || !isInitializeRequest(parsed)) return json(res, 400, { error: 'MCP initialization required' });
      if (sessions.size >= 32) return json(res, 503, { error: 'Session limit reached' });
      const { server } = createMcpServer({ service });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true, onsessioninitialized: sessionId => sessions.set(sessionId, entry) });
      entry = { server, transport, lastSeen: Date.now() };
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport);
    }
    entry.lastSeen = Date.now();
    await entry.transport.handleRequest(req, res, parsed);
    if (!entry.transport.sessionId) await entry.server.close();
  } catch (error) {
    // Do not log request bodies, credentials, or training records.
    console.error('MCP request failed:', error.status || 500);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
    else res.end();
  }
});
listener.headersTimeout = 15_000;
listener.requestTimeout = 30_000;
setInterval(() => { for (const [id, entry] of sessions) if (Date.now() - entry.lastSeen > TTL) void closeSession(id); }, 60_000).unref();
listener.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Healthy Fitness MCP listening on /mcp'));
async function shutdown() { listener.close(); await Promise.all([...sessions.keys()].map(closeSession)); process.exit(0); }
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
