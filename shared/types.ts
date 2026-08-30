export type Role = 'spymaster' | 'operative';
export type Actor = 'human' | 'agent';
export type Alignment = 'blue' | 'red' | 'innocent' | 'assassin';

export interface Card {
  word: string;
  revealed: boolean;
  alignment?: Alignment;
}

export interface Board {
  id: string;
  revision: number;
  cards: Card[];
  humanRole: Role;
  agentRole: Role;
  turn: Actor;
  phase: 'clue' | 'guess';
  status: 'playing' | 'won' | 'lost';
  clue: { word: string; count: number } | null;
  guessesRemaining: number;
  scores: { blue: number; red: number; blueTotal: number; redTotal: number };
  log: Array<{ id: number; text: string }>;
  lastAction: string;
}

export type Action =
  | { type: 'submit_clue'; clue: string; count: number }
  | { type: 'make_guess'; word: string }
  | { type: 'end_turn' };
