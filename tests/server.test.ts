import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app';
import { Game } from '../server/game';
import { BOARD_URI } from '../server/mcp';
import type { Board } from '../shared/types';
import { request as httpRequest } from 'node:http';

describe('local HTTP and MCP integration', () => {
  let app: ReturnType<typeof createApp>;
  let base: string;
  beforeEach(async () => {
    app = createApp({ game: new Game('operative'), threadId: 'test-thread' });
    await new Promise<void>((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  });
  function request(path: string, actor?: 'human' | 'agent', data?: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(actor ? { Authorization: `Bearer ${app.tokens[actor]}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  it('bootstraps the thread without exposing hidden alignments to the human', async () => {
    const bootstrap = await (await request('/api/bootstrap')).json();
    expect(bootstrap.threadId).toBe('test-thread');
    expect(bootstrap.humanToken).not.toBe(bootstrap.agentToken);
    const board: Board = await (await request('/api/board', 'human')).json();
    expect(board.cards).toHaveLength(25);
    expect(board.cards.every((card) => !('alignment' in card))).toBe(true);
    const secret: Board = await (await request('/api/agent/board', 'agent')).json();
    expect(secret.cards.every((card) => card.alignment)).toBe(true);
  });
  it('blocks foreign origins, foreign hosts, cross-site bootstrap and wrong actor tokens', async () => {
    expect((await request('/api/bootstrap', undefined, undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${base}/api/bootstrap`, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(foreignHostStatus).toBe(403);
    expect((await request('/api/bootstrap', undefined, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await request('/api/agent/board', 'human')).status).toBe(401);
    expect((await request('/api/board')).status).toBe(401);
    expect((await request('/api/new', 'agent', { humanRole: 'spymaster' })).status).toBe(401);
    expect((await request('/api/bootstrap', undefined, undefined, { Origin: 'http://127.0.0.1:5174' })).status).toBe(200);
  });
  it('requires explicit fresh reads, strict action arguments and correct actor turn', async () => {
    const clue = { type: 'submit_clue', clue: 'Cosmic', count: 2 };
    expect((await request('/api/agent/action', 'agent', clue)).status).toBe(400);
    await request('/api/agent/board', 'agent');
    expect((await request('/api/agent/action', 'agent', { ...clue, extra: true })).status).toBe(400);
    const moved: Board = await (await request('/api/agent/action', 'agent', clue)).json();
    expect(moved.turn).toBe('human');
    expect((await request('/api/agent/action', 'agent', clue)).status).toBe(400);
    expect((await request('/api/action', 'human', { type: 'end_turn' })).status).toBe(200);
    expect((await request('/api/agent/action', 'agent', clue)).status).toBe(400);
    await request('/api/agent/board', 'agent');
    expect((await request('/api/agent/action', 'agent', clue)).status).toBe(200);
  });
  it('rejects malformed JSON and oversized bodies without changing the match', async () => {
    const start = app.game.view('human');
    const headers = { Authorization: `Bearer ${app.tokens.human}`, 'Content-Type': 'application/json' };
    expect((await fetch(`${base}/api/new`, { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await fetch(`${base}/api/new`, { method: 'POST', headers, body: JSON.stringify({ huge: 'x'.repeat(17000) }) })).status).toBe(400);
    expect(app.game.view('human')).toEqual(start);
  });
  it('interoperates with an actual MCP client and secures the Spymaster resource', async () => {
    const client = new Client({ name: 'semanticspy-test', version: '1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${app.tokens.agent}` } } });
    try {
      await client.connect(transport);
      const resources = await client.listResources();
      expect(resources.resources[0].uri).toBe(BOARD_URI);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['get_board', 'submit_clue', 'make_guess', 'end_turn']);
      expect(tools.tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
      const rejected = await client.callTool({ name: 'submit_clue', arguments: { clue: 'Cosmic', count: 1 } });
      expect(rejected.isError).toBe(true);
      const publicResource = await client.readResource({ uri: BOARD_URI });
      const publicContent = publicResource.contents[0];
      if (!('text' in publicContent)) throw new Error('Expected JSON text');
      const publicBoard = JSON.parse(publicContent.text) as Board;
      expect(publicBoard.cards.every((card) => !('alignment' in card))).toBe(true);
      const privateResource = await client.readResource({ uri: `${BOARD_URI}?role=spymaster` });
      const privateContent = privateResource.contents[0];
      if (!('text' in privateContent)) throw new Error('Expected JSON text');
      const privateBoard = JSON.parse(privateContent.text) as Board;
      expect(privateBoard.cards.every((card) => card.alignment)).toBe(true);
      const result = await client.callTool({ name: 'submit_clue', arguments: { clue: 'Cosmic', count: 1 } });
      expect(result.isError).not.toBe(true);
      expect(app.game.view('human').turn).toBe('human');
      app.game.reset('spymaster');
      await expect(client.readResource({ uri: `${BOARD_URI}?role=spymaster` })).rejects.toThrow();
      const operative = await client.callTool({ name: 'get_board', arguments: {} });
      const agentBoard = (operative.structuredContent as { board: Board }).board;
      expect(agentBoard.cards.every((card) => !('alignment' in card))).toBe(true);
      expect((await client.callTool({ name: 'get_board', arguments: { role: 'spymaster' } })).isError).toBe(true);
    } finally { await client.close(); }
  });
});
