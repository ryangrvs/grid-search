import type { Board, Card } from '../shared/types';

export type CardTone = 'hidden' | 'key' | 'revealed' | 'terminal';

export interface CardPresentation {
  tone: CardTone;
  alignment?: Card['alignment'];
  badge: string | null;
  animate: boolean;
}

const alignmentLabel: Record<NonNullable<Card['alignment']>, string> = {
  blue: 'Blue',
  red: 'Red',
  innocent: 'Innocent',
  assassin: 'Assassin',
};

export function actionTitle(board: Pick<Board, 'status' | 'turn' | 'phase' | 'humanRole' | 'agentRole'>): string {
  if (board.status !== 'playing') return 'Match ended';
  const actor = board.turn === 'human' ? 'Your turn' : "Agent's turn";
  return `${actor} — ${board.phase === 'clue' ? 'giving a clue' : 'guessing'}`;
}

export function clueLabel(clue: Board['clue']): string | null {
  return clue ? `Current clue: ${clue.word} · ${clue.count}` : null;
}

export function cardPresentation(
  board: Pick<Board, 'status' | 'humanRole'>,
  card: Card,
  previousRevealed: ReadonlySet<string>,
  allowAnimation: boolean,
): CardPresentation {
  const terminal = board.status !== 'playing';
  const alignmentVisible = Boolean(card.alignment) && (card.revealed || board.humanRole === 'spymaster' || terminal);
  if (!alignmentVisible || !card.alignment) return { tone: 'hidden', badge: null, animate: false };
  if (card.revealed) {
    const badge = card.alignment === 'blue' ? '✓ Found' : card.alignment === 'red' ? 'Miss' : 'Revealed';
    return {
      tone: 'revealed', alignment: card.alignment, badge,
      // Keep the operative reveal animation tied to a live, newly guessed card.
      animate: allowAnimation && board.humanRole === 'operative' && !previousRevealed.has(card.word),
    };
  }
  if (terminal) return { tone: 'terminal', alignment: card.alignment, badge: `Not guessed · ${alignmentLabel[card.alignment]}`, animate: false };
  return { tone: 'key', alignment: card.alignment, badge: `Key · ${alignmentLabel[card.alignment]}`, animate: false };
}
