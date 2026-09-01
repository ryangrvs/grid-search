import { describe, expect, it, vi } from 'vitest';
import { GameController, MemoryStateStore } from '../src/game-controller';
import { registerWebMCP, STATE_URI, type ModelContext } from '../src/webmcp';

describe('browser WebMCP adapter', () => {
  it('feature-detects unsupported browsers without any network dependency', async () => {
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    const result = await registerWebMCP({ controller, host: undefined });
    expect(result.supported).toBe(false);
    expect(result.registered).toEqual([]);
  });

  it('registers the handle-scoped tools with strict inputs and authorized state results', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<any>; inputSchema: any }> = {};
    const registerTool = vi.fn(async (tool: Parameters<ModelContext['registerTool']>[0]) => { registered[tool.name] = tool; });
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    const result = await registerWebMCP({ controller, host: { registerTool } });
    expect(result).toMatchObject({ supported: true, registered: ['get_context', 'get_state', 'submit_clue', 'make_guess', 'end_turn', 'register'] });
    expect(registerTool).toHaveBeenCalledTimes(6);
    expect(registered.get_context.inputSchema).toMatchObject({ additionalProperties: false, required: [] });
    expect(registered.get_state.inputSchema).toMatchObject({ additionalProperties: false, required: ['playerHandle'] });
    expect(registered.submit_clue.inputSchema).toMatchObject({ additionalProperties: false, required: ['playerHandle', 'clue', 'count'] });
    expect(registered.make_guess.inputSchema).toMatchObject({ additionalProperties: false, required: ['playerHandle', 'word'] });
    expect(registered.end_turn.inputSchema).toMatchObject({ additionalProperties: false, required: ['playerHandle'] });

    const context = await registered.get_context.execute({});
    expect(context.context).toContain('playerHandle');
    expect(context.context).not.toContain('ANCHOR');

    const registration = await registered.register.execute({ name: 'Atlas' });
    const handle = registration.playerHandle;
    const read = await registered.get_state.execute({ playerHandle: handle });
    expect(read).toMatchObject({ uri: STATE_URI, state: {
      player: { displayName: 'Atlas', controller: 'agent', team: 'blue', role: 'spymaster' },
      board: { id: expect.any(String), revision: 0, cards: expect.any(Array) },
      activePlayer: { displayName: 'Atlas' },
      remainingGuesses: 0,
      legalActions: ['submit_clue'],
      status: 'playing',
      winner: null,
      turnNumber: 0,
    } });
    await expect(registered.end_turn.execute({ playerHandle: handle })).rejects.toThrow('Only the operative');
    const moved = await registered.submit_clue.execute({ playerHandle: handle, clue: 'Cosmic', count: 1 });
    expect(moved).toMatchObject({ uri: STATE_URI, state: {
      player: { displayName: 'Atlas' },
      clue: { word: 'Cosmic', count: 1 },
      activePlayer: { displayName: 'You' },
      legalActions: [],
    } });
    await expect(registered.end_turn.execute({ playerHandle: handle })).rejects.toThrow('not your turn');
  });

  it('rejects unknown arguments and handles before mutating the game', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }> = {};
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    await registerWebMCP({ controller, host: { registerTool: async (tool) => { registered[tool.name] = tool; } } });
    await expect(registered.make_guess.execute({ playerHandle: 'missing', word: 'ORBIT', secret: true })).rejects.toThrow('exactly');
    await expect(registered.get_state.execute({ playerHandle: 'missing' })).rejects.toThrow('Unknown or expired');
    expect(controller.view('human').revision).toBe(0);
  });

  it('authorizes a same-player follow-up guess from the successful action state', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<any> }> = {};
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    await registerWebMCP({ controller, host: { registerTool: async (tool) => { registered[tool.name] = tool; } } });
    const registration = await registered.register.execute({ name: 'Atlas' });
    controller.newGame('spymaster', 'co-op');
    controller.act('human', { type: 'submit_clue', clue: 'Cosmic', count: 2 });
    const handle = registration.playerHandle!;
    await registered.get_state.execute({ playerHandle: handle });
    const blueWords = controller.view('human').cards.filter((card) => card.alignment === 'blue').map((card) => card.word);
    const first = await registered.make_guess.execute({ playerHandle: handle, word: blueWords[0] });
    expect(first.state.legalActions).toEqual(['make_guess', 'end_turn']);
    const second = await registered.make_guess.execute({ playerHandle: handle, word: blueWords[1] });
    expect(second.state.board.revision).toBe(first.state.board.revision + 1);
  });

  it('shares registration and same-name recovery with the UI controller', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<any> }> = {};
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    await registerWebMCP({ controller, host: { registerTool: async (tool) => { registered[tool.name] = tool; } } });
    const first = await registered.register.execute({ name: 'Atlas' });
    const second = await registered.register.execute({ name: 'atlas' });
    expect(first.playerHandle).not.toBe(second.playerHandle);
    await expect(registered.get_state.execute({ playerHandle: first.playerHandle })).rejects.toThrow('Unknown or expired');
    expect((await registered.get_state.execute({ playerHandle: second.playerHandle })).state.player).toMatchObject({ displayName: 'Atlas' });
    controller.newGame('spymaster', 'co-op');
    expect((await registered.get_state.execute({ playerHandle: second.playerHandle })).state.player).toMatchObject({ displayName: 'Atlas', role: 'operative' });
    expect(controller.lobby().seats[1].player?.displayName).toBe('Atlas');
  });
});
