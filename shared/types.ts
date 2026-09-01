export type Role = 'spymaster' | 'operative';
export type Actor = 'human' | 'agent';
export type Alignment = 'blue' | 'red' | 'innocent' | 'assassin';
export type Team = 'blue' | 'red';
export type Controller = 'human' | 'agent';
export type MatchMode = 'coop' | 'versus';
export type MatchModeInput = MatchMode | 'co-op';

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
  /** The player whose action is currently required. This is the authoritative turn identity. */
  activePlayer: Player;
  activePlayerId: string;
  mode: MatchMode;
  turn: Actor;
  phase: 'clue' | 'guess';
  status: 'playing' | 'won' | 'lost';
  winner: Team | null;
  clue: { word: string; count: number } | null;
  turnGuesses: Array<{ playerId: string; word: string }>;
  guessesRemaining: number;
  scores: { blue: number; red: number; blueTotal: number; redTotal: number };
  turnNumber: number;
  teamTurnCounts: { blue: number; red: number };
  log: Array<{ id: number; text: string }>;
  lastAction: string;
}

export type LegalAction = 'submit_clue' | 'make_guess' | 'end_turn';

export interface AuthorizedBoard {
  id: string;
  revision: number;
  cards: Card[];
  mode: MatchMode;
  scores: Board['scores'];
  teamTurnCounts: Board['teamTurnCounts'];
  turnGuesses: Board['turnGuesses'];
  lastAction: string;
}

/** The complete state an identified WebMCP player is allowed to see. */
export interface AuthorizedState {
  player: Player;
  board: AuthorizedBoard;
  activePlayer: Player;
  phase: Board['phase'];
  status: Board['status'];
  winner: Team | null;
  clue: Board['clue'];
  remainingGuesses: number;
  legalActions: LegalAction[];
  turnNumber: number;
}

export type Action =
  | { type: 'submit_clue'; clue: string; count: number }
  | { type: 'make_guess'; word: string }
  | { type: 'end_turn' };
