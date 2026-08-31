import { describe, expect, it } from 'vitest';
import type { Board, Card } from '../shared/types';
import { actionTitle, cardPresentation, clueLabel } from '../src/board-view';

const base = { status: 'playing', humanRole: 'operative', agentRole: 'spymaster' } as const;
const card = (extra: Partial<Card>): Card => ({ word: 'ORBIT', revealed: false, ...extra });

describe('board view model', () => {
  it('labels turns by actor and phase, including terminal matches', () => {
    expect(actionTitle({ ...base, turn: 'human', phase: 'clue' })).toBe('Your turn — giving a clue');
    expect(actionTitle({ ...base, turn: 'agent', phase: 'guess' })).toBe("Agent's turn — guessing");
    expect(actionTitle({ ...base, status: 'won', turn: 'human', phase: 'clue' })).toBe('Match ended');
  });

  it('makes an active clue available to either role', () => {
    expect(clueLabel({ word: 'Space', count: 2 })).toBe('Current clue: Space · 2');
    expect(clueLabel(null)).toBeNull();
  });

  it('does not expose live hidden keys, and animates only a new operative reveal', () => {
    const hidden = card({ alignment: 'red' });
    expect(cardPresentation(base, hidden, new Set(), true)).toEqual({ tone: 'hidden', badge: null, animate: false });
    const revealed = card({ revealed: true, alignment: 'blue' });
    expect(cardPresentation(base, revealed, new Set(), true)).toMatchObject({ tone: 'revealed', badge: '✓ Found', animate: true });
    expect(cardPresentation(base, revealed, new Set(['ORBIT']), true).animate).toBe(false);
    expect(cardPresentation(base, revealed, new Set(), false).animate).toBe(false);
  });

  it('distinguishes a terminal unguessed key from a guessed card', () => {
    const terminal = { ...base, status: 'lost' } as Pick<Board, 'status' | 'humanRole'>;
    expect(cardPresentation(terminal, card({ alignment: 'blue' }), new Set(), true)).toMatchObject({ tone: 'terminal', badge: 'Not guessed · Blue', animate: false });
    expect(cardPresentation(terminal, card({ revealed: true, alignment: 'assassin' }), new Set(), true)).toMatchObject({ tone: 'revealed', badge: 'Revealed', animate: true });
    expect(cardPresentation(terminal, card({ revealed: true, alignment: 'assassin' }), new Set(['ORBIT']), true).animate).toBe(false);
  });

  it('shows a spymaster key as muted and guessed cards as vivid, labeled outcomes', () => {
    const spymaster = { status: 'playing', humanRole: 'spymaster' } as const;
    expect(cardPresentation(spymaster, card({ alignment: 'blue' }), new Set(), true)).toMatchObject({ tone: 'key', badge: 'Key · Blue', animate: false });
    expect(cardPresentation(spymaster, card({ revealed: true, alignment: 'blue' }), new Set(), true)).toMatchObject({ tone: 'revealed', badge: '✓ Found', animate: false });
    expect(cardPresentation(spymaster, card({ revealed: true, alignment: 'red' }), new Set(), true)).toMatchObject({ tone: 'revealed', badge: 'Miss', animate: false });
  });
});
