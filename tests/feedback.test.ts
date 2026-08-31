import { describe, expect, it } from 'vitest';
import { Game } from '../server/game';

describe('playtest feedback regressions', () => {
  it('ends a count-one clue after its first correct guess, even on the first round', () => {
    const game = new Game('operative');
    const blue = game.getBoard('agent').cards.find((card) => card.alignment === 'blue')!;
    game.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 1 });
    const board = game.act('human', { type: 'make_guess', word: blue.word });
    expect(board.guessesRemaining).toBe(0);
    expect(board.phase).toBe('clue');
    expect(board.turn).toBe('agent');
  });

  it('shows the unrevealed blue and red identities to the operative when the game ends', () => {
    const game = new Game('operative');
    const secret = game.getBoard('agent');
    const assassin = secret.cards.find((card) => card.alignment === 'assassin')!;
    game.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 1 });
    const board = game.act('human', { type: 'make_guess', word: assassin.word });
    expect(board.status).toBe('lost');
    for (const card of secret.cards.filter((card) => card.alignment === 'blue' || card.alignment === 'red')) {
      const endedCard = board.cards.find((item) => item.word === card.word)!;
      expect(endedCard.alignment).toBe(card.alignment);
      expect(endedCard.revealed).toBe(false); // Seeing the key must not imply it was guessed.
    }
  });

  it('deals different words on New Game, not just different positions', () => {
    const game = new Game('operative');
    const oldWords = new Set(game.view('human').cards.map((card) => card.word));
    const next = game.reset('operative');
    expect(next.cards.every((card) => !oldWords.has(card.word))).toBe(true);
    expect(new Set(next.cards.map((card) => card.word)).size).toBe(25);
  });

  it('does not carry unused guesses from an earlier clue into a count-one clue', () => {
    const game = new Game('operative');
    const blues = game.getBoard('agent').cards.filter((card) => card.alignment === 'blue');
    game.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 2 });
    game.act('human', { type: 'make_guess', word: blues[0].word });
    game.act('human', { type: 'end_turn' });
    game.getBoard('agent');
    game.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 1 });
    const next = game.act('human', { type: 'make_guess', word: blues[1].word });
    expect(next.guessesRemaining).toBe(0);
    expect(next.turn).toBe('agent');
  });

  it('shows unguessed red cards on a win while leaving them marked as not guessed', () => {
    const game = new Game('operative');
    const secret = game.getBoard('agent');
    game.act('agent', { type: 'submit_clue', clue: 'Cosmic', count: 9 });
    for (const card of secret.cards.filter((card) => card.alignment === 'blue')) {
      game.act('human', { type: 'make_guess', word: card.word });
    }
    const board = game.view('human');
    expect(board.status).toBe('won');
    const reds = board.cards.filter((card) => card.alignment === 'red');
    expect(reds).toHaveLength(8);
    expect(reds.every((card) => !card.revealed)).toBe(true);
    expect(board.scores).toMatchObject({ blue: 9, red: 0 });
  });
});
