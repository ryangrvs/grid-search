export type Role = 'spymaster' | 'operative';
export type Actor = 'human' | 'agent';
export type Alignment = 'blue' | 'red' | 'innocent' | 'assassin';
export type Team = 'blue' | 'red';
export type Controller = 'human' | 'agent';

export interface Player {
  id: string;
  displayName: string;
  controller: Controller;
  team: Team;
  role: Role;
}

export interface LobbySeat {
  id: string;
  team: Team;
  role: Role;
  player: Player | null;
}

export interface Lobby {
  seats: LobbySeat[];
  canStartCoop: boolean;
  canStartVersus: boolean;
}

export interface RegistrationResult {
  success: boolean;
  player?: Player;
  playerHandle?: string;
  error?: string;
  availableSeats: Array<{ team: Team; role: Role }>;
  lobby: Lobby;
}

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
  turnGuesses: Array<{ actor: Actor; word: string }>;
  guessesRemaining: number;
  scores: { blue: number; red: number; blueTotal: number; redTotal: number };
  log: Array<{ id: number; text: string }>;
  lastAction: string;
}

export type Action =
  | { type: 'submit_clue'; clue: string; count: number }
  | { type: 'make_guess'; word: string }
  | { type: 'end_turn' };
