import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Game } from './game';
import { parseAction, parseRole, schemas } from './contracts';
import { createGameMcp } from './mcp';

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new Error('Content-Type must be application/json');
  let length = 0; const parts: Buffer[] = [];
  for await (const part of request) {
    length += Buffer.byteLength(part);
    if (length > 16_384) throw new Error('Request body too large');
    parts.push(Buffer.from(part));
  }
  try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new Error('Invalid JSON'); }
}

export function createApp(options: { game?: Game; distDir?: string } = {}) {
  const game = options.game ?? new Game('operative');
  const tokens = { human: randomBytes(32).toString('base64url'), agent: randomBytes(32).toString('base64url') };
  const distDir = resolve(options.distDir ?? 'dist');
  const server = createServer((request, response) => { void handle(request, response); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    try {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 4310;
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5174', 'localhost:5174']);
      if (!request.headers.host || !hosts.has(request.headers.host)) { json(response, 403, { error: 'Untrusted Host' }); return; }
      const origins = new Set([...hosts].map((host) => `http://${host}`));
      if ((request.headers.origin && !origins.has(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') { json(response, 403, { error: 'Cross-site access denied' }); return; }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const method = request.method;
      if (path === '/api/bootstrap' && method === 'GET') {
        json(response, 200, { humanToken: tokens.human, agentToken: tokens.agent }); return;
      }
      if (path === '/api/schemas' && method === 'GET') { json(response, 200, schemas); return; }
      if (path === '/api/health' && method === 'GET') { json(response, 200, { ok: true }); return; }
      if (path.startsWith('/api/') || path === '/mcp') {
        const actor = path.startsWith('/api/agent/') || path === '/mcp' ? 'agent' : 'human';
        if (!sameSecret(request.headers.authorization ?? '', `Bearer ${tokens[actor]}`)) { json(response, 401, { error: 'Invalid actor capability' }); return; }
        if (path === '/mcp') {
          if (method !== 'POST') { json(response, 405, { error: 'Only POST is supported for stateless MCP' }); return; }
          const data = await body(request);
          const mcp = createGameMcp(game);
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          response.on('close', () => { void mcp.close(); });
          await mcp.connect(transport);
          await transport.handleRequest(request, response, data);
          return;
        }
        if ((path === '/api/board' || path === '/api/agent/board') && method === 'GET') { json(response, 200, game.getBoard(actor)); return; }
        if ((path === '/api/action' || path === '/api/agent/action') && method === 'POST') { json(response, 200, game.act(actor, parseAction(await body(request)))); return; }
        if (path === '/api/new' && method === 'POST') { json(response, 200, game.reset(parseRole(await body(request)))); return; }
        if (path === '/api/next-round' && method === 'POST') { json(response, 200, game.nextRound(parseRole(await body(request)))); return; }
        json(response, 404, { error: 'Unknown endpoint or method' }); return;
      }
      if (method !== 'GET' && method !== 'HEAD') { json(response, 405, { error: 'Method not allowed' }); return; }
      const filePath = resolve(distDir, `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`);
      if (!filePath.startsWith(`${distDir}${sep}`)) { json(response, 403, { error: 'Invalid path' }); return; }
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      try {
        const contents = await readFile(filePath);
        response.writeHead(200, { 'Content-Type': mime[extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        response.end(method === 'HEAD' ? undefined : contents);
      } catch { json(response, 404, { error: 'Not found. Build the frontend first or use the Vite development URL.' }); }
    } catch (error) {
      if (!response.headersSent) json(response, 400, { error: error instanceof Error ? error.message : 'Request rejected' });
      else response.end();
    }
  }
  return { server, game, tokens };
}
