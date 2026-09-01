import { describe, expect, it } from 'vitest';
import { GameController } from '../src/game-controller';
import { MemoryRosterStore } from '../src/roster';

describe('browser GameController', () => {
  it('shares the role-filtered game and roster between human and agent callers', () => {
    const controller = new GameController({ rosterStore: new MemoryRosterStore() });
    const human = controller.getBoard('human');
    const agent = controller.getBoard('agent');
    expect(human.cards.every((card) => card.alignment === undefined)).toBe(true);
    expect(agent.cards.every((card) => card.alignment !== undefined)).toBe(true);
    expect(controller.register('Atlas').success).toBe(true);
    expect(controller.lobby().seats[1].player?.displayName).toBe('Atlas');
  });

  it('keeps roster persistence across controller instances and resets game state locally', () => {
    const store = new MemoryRosterStore();
    const first = new GameController({ rosterStore: store });
    first.register('Atlas');
    const originalWords = new Set(first.view('human').cards.map((card) => card.word));
    const next = first.nextRound();
    expect(new Set(next.cards.map((card) => card.word))).toEqual(originalWords);
    const restored = new GameController({ rosterStore: store });
    expect(restored.lobby().seats[1].player?.displayName).toBe('Atlas');
    expect(restored.view('human').revision).toBe(0);
  });

  it('rejects changing roles during an active round but aligns roles for New Game', () => {
    const controller = new GameController({ rosterStore: new MemoryRosterStore() });
    expect(() => controller.setHumanRole('spymaster')).toThrow('active');
    const board = controller.newGame('spymaster');
    expect(board.humanRole).toBe('spymaster');
    expect(controller.lobby().seats.map((seat) => seat.role)).toEqual(['spymaster', 'operative', 'spymaster', 'operative']);
  });
});
