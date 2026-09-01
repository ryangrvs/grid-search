import { describe, expect, it } from 'vitest';
import { GameController, LocalStorageStateStore, MemoryStateStore, type PersistedState, type StateStore } from '../src/game-controller';

describe('browser GameController', () => {
  it('shares the role-filtered game and roster between human and agent callers', () => {
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    const human = controller.getBoard('human');
    const agent = controller.getBoard('agent');
    expect(human.cards.every((card) => card.alignment === undefined)).toBe(true);
    expect(agent.cards.every((card) => card.alignment !== undefined)).toBe(true);
    expect(controller.register('Atlas').success).toBe(true);
    expect(controller.lobby().seats[1].player?.displayName).toBe('Atlas');
  });

  it('keeps roster persistence across controller instances and resets game state locally', () => {
    const store = new MemoryStateStore();
    const first = new GameController({ stateStore: store });
    first.register('Atlas');
    const originalWords = new Set(first.view('human').cards.map((card) => card.word));
    const next = first.nextRound();
    expect(new Set(next.cards.map((card) => card.word))).toEqual(originalWords);
    const restored = new GameController({ stateStore: store });
    expect(restored.lobby().seats[1].player?.displayName).toBe('Atlas');
    expect(restored.view('human').revision).toBe(0);
  });

  it('rejects changing roles during an active round but aligns roles for New Game', () => {
    const controller = new GameController({ stateStore: new MemoryStateStore() });
    expect(() => controller.setHumanRole('spymaster')).toThrow('active');
    const board = controller.newGame('spymaster');
    expect(board.humanRole).toBe('spymaster');
    expect(controller.lobby().seats.map((seat) => seat.role)).toEqual(['spymaster', 'operative', 'spymaster', 'operative']);
  });

  it('keeps a post-round role change coherent in the persisted snapshot', () => {
    const store = new MemoryStateStore();
    const controller = new GameController({ stateStore: store });
    controller.getBoard('agent');
    controller.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 1 });
    const assassin = controller.view('agent').cards.find((card) => card.alignment === 'assassin')!;
    controller.act('human', { type: 'make_guess', word: assassin.word });
    controller.setHumanRole('spymaster');
    const restored = new GameController({ stateStore: store });
    expect(restored.view('human').humanRole).toBe('spymaster');
    expect(restored.lobby().seats[0].role).toBe('spymaster');
  });

  it('round-trips the complete game and roster snapshot while requiring a fresh agent read', () => {
    const store = new MemoryStateStore();
    const first = new GameController({ stateStore: store });
    first.register('Atlas');
    first.getBoard('agent');
    first.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 2 });
    first.act('human', { type: 'end_turn' });
    const saved = first.snapshot();

    const restored = new GameController({ stateStore: store });
    expect(restored.snapshot()).toEqual(saved);
    expect(restored.view('agent').cards).toEqual(first.getBoard('agent').cards);
    expect(() => restored.act('agent', { type: 'submit_clue', clue: 'Fresh', count: 1 })).toThrow('Fresh agent board read');
    restored.getBoard('agent');
    expect(restored.act('agent', { type: 'submit_clue', clue: 'Fresh', count: 1 }).clue).toEqual({ word: 'Fresh', count: 1 });
  });

  it('falls back to and replaces corrupt or unknown-version state', () => {
    for (const invalid of [{ version: 2 }, { version: 1, game: {}, roster: {} }, '{not json']) {
      const store = new MemoryStateStore(invalid);
      const controller = new GameController({ stateStore: store });
      expect(controller.view('human').revision).toBe(0);
      expect(controller.lobby().seats[0].player?.displayName).toBe('You');
      expect(store.load()).toMatchObject({ version: 1, game: { revision: 0 }, roster: { seats: expect.any(Array) } });
    }
  });

  it('discards both domains when a structurally valid snapshot has incoherent roles', () => {
    const operative = new GameController({ stateStore: new MemoryStateStore() });
    operative.register('Atlas');
    const saved = operative.snapshot();
    const spymaster = new GameController({ humanRole: 'spymaster', stateStore: new MemoryStateStore() });
    const incoherent: PersistedState = { version: 1, game: saved.game, roster: spymaster.snapshot().roster };
    const store = new MemoryStateStore(incoherent);

    const restored = new GameController({ stateStore: store });
    expect(restored.view('human').id).not.toBe(saved.game.id);
    expect(restored.view('human').cards.map((card) => card.word)).not.toEqual(saved.game.cards.map((card) => card.word));
    expect(restored.lobby().seats[1].player).toBeNull();
    expect((store.load() as PersistedState).roster.seats.map((seat) => seat.player?.displayName ?? null)).toEqual(['You', null, null, null]);
  });

  it('saves successful mutations but does not save failed mutations', () => {
    const saves: PersistedState[] = [];
    const store: StateStore = { load: () => null, save: (snapshot) => saves.push(snapshot) };
    const controller = new GameController({ stateStore: store });
    expect(saves).toHaveLength(1);
    controller.register('Atlas');
    expect(saves).toHaveLength(2);
    expect(controller.register('You').success).toBe(false);
    expect(saves).toHaveLength(2);
    expect(() => controller.act('human', { type: 'submit_clue', clue: 'Cosmic', count: 1 })).toThrow('not your turn');
    expect(saves).toHaveLength(2);
  });

  it('removes the obsolete roster-only key after writing the unified browser snapshot', () => {
    const values = new Map([[LocalStorageStateStore.legacyRosterKey, '{"version":1}']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } as Storage;

    new GameController({ stateStore: new LocalStorageStateStore(storage) });

    expect(values.has(LocalStorageStateStore.key)).toBe(true);
    expect(values.has(LocalStorageStateStore.legacyRosterKey)).toBe(false);
  });
});
