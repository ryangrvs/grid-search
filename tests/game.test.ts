import { describe, expect, it } from 'vitest';
import { Game, WORDS } from '../server/game';
import type { Alignment } from '../shared/types';

const fixedRandom = () => 0.5;

function startDefault(count = 1): { game: Game; secret: ReturnType<Game['view']> } {
  const game = new Game('operative', fixedRandom);
  game.getBoard('agent');
  game.act('agent', { type: 'submit_clue', clue: 'space', count });
  return { game, secret: game.getBoard('agent') };
}

function wordFor(game: Game, alignment: Alignment): string {
  return game.view('agent').cards.find((card) => card.alignment === alignment)!.word;
}

describe('SemanticSpy game', () => {
  it('creates the required 25-card composition, hides operative secrets, and shuffles the key', () => {
    const game = new Game('operative', fixedRandom);
    const board = game.getBoard('human');
    expect(board.cards).toHaveLength(25);
    expect(new Set(board.cards.map((card) => card.word)).size).toBe(25);
    expect(board.cards.every((card) => card.alignment === undefined)).toBe(true);
    const secret = game.getBoard('agent');
    expect(secret.cards.filter((card) => card.alignment === 'blue')).toHaveLength(9);
    expect(secret.cards.filter((card) => card.alignment === 'red')).toHaveLength(8);
    expect(secret.cards.filter((card) => card.alignment === 'innocent')).toHaveLength(7);
    expect(secret.cards.filter((card) => card.alignment === 'assassin')).toHaveLength(1);
    expect(secret.cards.slice(0, 9).every((card) => card.alignment === 'blue')).toBe(false);
  });

  it('enforces a fresh agent read before every mutation and invalidates it after reset', () => {
    const game = new Game('operative', fixedRandom);
    expect(() => game.act('agent', { type: 'submit_clue', clue: 'space', count: 1 })).toThrow('Fresh agent board read');
    game.getBoard('agent');
    game.act('agent', { type: 'submit_clue', clue: 'space', count: 1 });
    expect(() => game.act('agent', { type: 'end_turn' })).toThrow('Fresh agent board read');
    game.getBoard('agent');
    game.reset('operative');
    expect(() => game.act('agent', { type: 'submit_clue', clue: 'space', count: 1 })).toThrow('Fresh agent board read');
  });

  it('rejects wrong actor/phase actions and board-word or malformed clues', () => {
    const game = new Game('operative', fixedRandom);
    expect(() => game.act('human', { type: 'submit_clue', clue: 'space', count: 1 })).toThrow('not your turn');
    game.getBoard('agent');
    expect(() => game.act('agent', { type: 'end_turn' })).toThrow('Only the operative');
    expect(() => game.act('agent', { type: 'submit_clue', clue: 'bad clue', count: 1 })).toThrow('one word');
    expect(() => game.act('agent', { type: 'submit_clue', clue: '123', count: 1 })).toThrow('one word');
    const boardWord = game.view('agent').cards[0].word.toLowerCase();
    expect(() => game.act('agent', { type: 'submit_clue', clue: boardWord, count: 1 })).toThrow('board word');
    game.act('agent', { type: 'submit_clue', clue: 'space', count: 1 });
    game.getBoard('agent');
    expect(() => game.act('agent', { type: 'make_guess', word: 'ANCHOR' })).toThrow('not your turn');
  });

  it('allows exactly count guesses, then ends the guessing turn', () => {
    const { game, secret } = startDefault(1);
    const blues = secret.cards.filter((card) => card.alignment === 'blue').map((card) => card.word);
    const result = game.act('human', { type: 'make_guess', word: blues[0] });
    expect(result.guessesRemaining).toBe(0);
    expect(result.turn).toBe('agent');
    expect(result.phase).toBe('clue');
    expect(result.lastAction).toContain('guess limit reached');
  });

  it('ends a count-one turn on the first wrong guess as well', () => {
    const { game, secret } = startDefault(1);
    const wrong = secret.cards.find((card) => card.alignment !== 'blue')!.word;
    const result = game.act('human', { type: 'make_guess', word: wrong });
    expect(result.status).toBe('playing');
    expect(result.guessesRemaining).toBe(0);
    expect(result.turn).toBe('agent');
    expect(result.phase).toBe('clue');
  });

  it('rejects duplicate guesses without changing revision', () => {
    const { game, secret } = startDefault(2);
    const blue = secret.cards.find((card) => card.alignment === 'blue')!.word;
    game.act('human', { type: 'make_guess', word: blue });
    const revision = game.view('human').revision;
    expect(() => game.act('human', { type: 'make_guess', word: blue })).toThrow('unrevealed');
    expect(game.view('human').revision).toBe(revision);
  });

  it('ends the turn on red, innocent, and assassin cards', () => {
    for (const alignment of ['red', 'innocent', 'assassin'] as const) {
      const { game } = startDefault(3);
      const guessedWord = wordFor(game, alignment);
      const result = game.act('human', { type: 'make_guess', word: guessedWord });
      expect(result.lastAction).toContain(guessedWord);
      if (alignment === 'assassin') {
        expect(result.status).toBe('lost');
      } else {
        expect(result.status).toBe('playing');
        expect(result.turn).toBe('agent');
        expect(result.phase).toBe('clue');
      }
    }
  });

  it('wins after all nine blue cards and blocks post-terminal mutations', () => {
    const { game, secret } = startDefault(9);
    const blues = secret.cards.filter((item) => item.alignment === 'blue');
    for (const card of blues) game.act('human', { type: 'make_guess', word: card.word });
    const won = game.view('human');
    expect(won.status).toBe('won');
    expect(won.scores.blue).toBe(9);
    expect(() => game.act('human', { type: 'make_guess', word: 'ANCHOR' })).toThrow('match is over');
  });

  it('reveals the terminal key without marking untouched cards as guessed', () => {
    const { game, secret } = startDefault(1);
    const assassin = secret.cards.find((card) => card.alignment === 'assassin')!.word;
    const ended = game.act('human', { type: 'make_guess', word: assassin });
    expect(ended.status).toBe('lost');
    for (const card of ended.cards) {
      expect(card.alignment).toBeDefined();
      expect(card.revealed).toBe(card.word === assassin);
    }
  });

  it('supports human spymaster role and restores the selected role on reset', () => {
    const game = new Game('spymaster', fixedRandom);
    const board = game.getBoard('human');
    expect(board.turn).toBe('human');
    expect(board.phase).toBe('clue');
    expect(board.agentRole).toBe('operative');
    expect(board.cards.every((card) => card.alignment !== undefined)).toBe(true);
    game.act('human', { type: 'submit_clue', clue: 'space', count: 1 });
    expect(game.view('human').turn).toBe('agent');
    const reset = game.reset('operative');
    expect(reset.humanRole).toBe('operative');
    expect(reset.agentRole).toBe('spymaster');
    expect(reset.turn).toBe('agent');
  });

  it('keeps the agent read stale after a human action', () => {
    const { game, secret } = startDefault(2);
    game.act('human', { type: 'make_guess', word: secret.cards.find((card) => card.alignment === 'blue')!.word });
    expect(() => game.act('agent', { type: 'submit_clue', clue: 'fresh', count: 1 })).toThrow('Fresh agent board read');
  });

  it('deals reset boards from words outside the immediately prior board', () => {
    const game = new Game('operative', fixedRandom);
    const old = new Set(game.view('human').cards.map((card) => card.word));
    const previousId = game.view('human').id;
    const reset = game.reset('spymaster');
    expect(reset.id).not.toBe(previousId);
    expect(reset.revision).toBe(0);
    expect(reset.humanRole).toBe('spymaster');
    expect(reset.cards).toHaveLength(25);
    expect(reset.cards.every((card) => !old.has(card.word))).toBe(true);
    expect(() => game.act('agent', { type: 'make_guess', word: reset.cards[0].word })).toThrow('Fresh agent board read');
  });

  it('samples from the full eligible pool before selecting 25 cards', () => {
    let calls = 0;
    const game = new Game('operative', () => {
      const call = calls++;
      // Move the final pool entry into the first 25 during the full-pool shuffle.
      if (call === 0) return 24 / 150;
      if (call === 125) return 0;
      return 0.999999;
    });
    const first50 = new Set(WORDS.slice(0, 50));
    expect(game.view('human').cards.some((card) => !first50.has(card.word))).toBe(true);
  });

  it('nextRound keeps the exact word set while reshuffling its key and clears progress', () => {
    const game = new Game('operative', fixedRandom);
    const first = game.getBoard('human');
    const words = new Set(first.cards.map((card) => card.word));
    game.getBoard('agent');
    game.act('agent', { type: 'submit_clue', clue: 'cosmic', count: 2 });
    const next = game.nextRound();
    expect(new Set(next.cards.map((card) => card.word))).toEqual(words);
    expect(next.id).not.toBe(first.id);
    expect(next.revision).toBe(0);
    expect(next.clue).toBeNull();
    expect(next.turn).toBe('agent');
    expect(next.cards.every((card) => card.alignment === undefined)).toBe(true);
    expect(() => game.act('agent', { type: 'submit_clue', clue: 'fresh', count: 1 })).toThrow('Fresh agent board read');
  });
});
