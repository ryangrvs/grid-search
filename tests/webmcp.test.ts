import { describe, expect, it, vi } from 'vitest';
import { GameController, MemoryStateStore } from '../src/game-controller';
import { BOARD_URI, registerWebMCP, type ModelContext } from '../src/webmcp';

describe('browser WebMCP adapter', () => {
  it('feature-detects unsupported browsers without any network dependency', async () => {
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    const result = await registerWebMCP({ controller, host: undefined });
    expect(result.supported).toBe(false);
    expect(result.registered).toEqual([]);
  });

  it('registers strict tools against the same controller and requires a fresh read', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown>; inputSchema: unknown }> = {};
    const registerTool = vi.fn(async (tool: Parameters<ModelContext['registerTool']>[0]) => { registered[tool.name] = tool; });
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    const result = await registerWebMCP({ controller, host: { registerTool } });
    expect(result).toMatchObject({ supported: true, registered: ['get_board', 'submit_clue', 'make_guess', 'end_turn', 'register'] });
    expect(registerTool).toHaveBeenCalledTimes(5);
    expect(registered.get_board.inputSchema).toMatchObject({ additionalProperties: false });

    await expect(registered.submit_clue.execute({ clue: 'Cosmic', count: 1 })).rejects.toThrow('Fresh agent board read');
    const read = await registered.get_board.execute({});
    expect(read).toMatchObject({ uri: BOARD_URI });
    const moved = await registered.submit_clue.execute({ clue: 'Cosmic', count: 1 });
    expect(moved).toMatchObject({ uri: BOARD_URI });
    await expect(registered.end_turn.execute({})).rejects.toThrow('Fresh agent board read');
  });

  it('rejects unknown arguments before mutating the game', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }> = {};
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    await registerWebMCP({ controller, host: { registerTool: async (tool) => { registered[tool.name] = tool; } } });
    await expect(registered.make_guess.execute({ word: 'ORBIT', secret: true })).rejects.toThrow('exactly');
    expect(controller.view('human').revision).toBe(0);
  });

  it('shares registration and recovery with the UI controller', async () => {
    const registered: Record<string, { execute: (args: Record<string, unknown>) => Promise<any> }> = {};
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    await registerWebMCP({ controller, host: { registerTool: async (tool) => { registered[tool.name] = tool; } } });
    const first = await registered.register.execute({ name: 'Atlas' });
    const second = await registered.register.execute({ name: 'atlas' });
    expect(first.playerHandle).not.toBe(second.playerHandle);
    expect(controller.lobby().seats[1].player?.displayName).toBe('Atlas');
  });
});
