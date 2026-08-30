import { describe, expect, it, vi } from 'vitest';
import { BOARD_URI, registerWebMCP, type ModelContext } from '../src/webmcp';

const schemas = {
  get_board: { type: 'object', properties: {}, additionalProperties: false },
  submit_clue: { type: 'object', properties: { clue: { type: 'string' }, count: { type: 'integer' } }, additionalProperties: false },
  make_guess: { type: 'object', properties: { word: { type: 'string' } }, additionalProperties: false },
  end_turn: { type: 'object', properties: {}, additionalProperties: false },
};

const board = { id: 'g1', revision: 1, cards: [], humanRole: 'operative', agentRole: 'spymaster', turn: 'agent', phase: 'clue', status: 'playing', clue: null, guessesRemaining: 0, scores: { blue: 0, red: 0, blueTotal: 9, redTotal: 8 }, log: [], lastAction: '' };

describe('WebMCP adapter', () => {
  it('feature-detects unsupported browsers', async () => {
    const result = await registerWebMCP({ agentToken: 'agent', host: undefined, fetchImpl: vi.fn() as typeof fetch });
    expect(result.supported).toBe(false);
    expect(result.registered).toEqual([]);
  });

  it('registers strict server schemas and requires an explicit board read before mutation', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown>; inputSchema: unknown }> = {};
    const registerTool = vi.fn(async (tool: Parameters<ModelContext['registerTool']>[0]) => { registered[tool.name] = tool; });
    const host: ModelContext = { registerTool };
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.endsWith('/api/schemas')) return new Response(JSON.stringify(schemas), { status: 200 });
      if (path.endsWith('/api/agent/action')) return new Response(JSON.stringify(board), { status: 200 });
      if (path.endsWith('/api/agent/board')) return new Response(JSON.stringify(board), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const refreshHumanBoard = vi.fn();
    const result = await registerWebMCP({ agentToken: 'agent-secret', host, fetchImpl, refreshHumanBoard });
    expect(result).toEqual({ supported: true, registered: ['get_board', 'submit_clue', 'make_guess', 'end_turn'] });
    expect(registered.get_board.inputSchema).toEqual(schemas.get_board);
    await expect(registered.make_guess.execute({ word: 'ORBIT' })).resolves.toMatchObject({ uri: BOARD_URI });
    expect(calls.filter((call) => call.startsWith('GET /api/agent/board'))).toHaveLength(0);
    await registered.get_board.execute({});
    await registered.make_guess.execute({ word: 'ORBIT' });
    expect(calls.filter((call) => call.startsWith('GET /api/agent/board'))).toHaveLength(1);
    expect(refreshHumanBoard).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown arguments before making a request', async () => {
    const registerTool = vi.fn(async (_tool: Parameters<ModelContext['registerTool']>[0]) => undefined);
    const host: ModelContext = { registerTool };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(schemas), { status: 200 })) as typeof fetch;
    await registerWebMCP({ agentToken: 'agent', host, fetchImpl });
    const tool = registerTool.mock.calls.find((call) => call[0].name === 'make_guess')?.[0];
    expect(tool).toBeDefined();
    if (!tool) throw new Error('make_guess tool was not registered');
    await expect(tool.execute({ word: 'ORBIT', secret: true })).rejects.toThrow('exactly');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
