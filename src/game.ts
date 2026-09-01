import type { Action, Actor, Alignment, Board, Card, Role } from '../shared/types';

export type IdFactory = () => string;

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const WORDS = [
  'ANCHOR', 'APPLE', 'ARMOR', 'BEAR', 'BOLT', 'BRIDGE', 'CLOUD', 'COMET', 'CROWN',
  'DESERT', 'DRAGON', 'EAGLE', 'FIRE', 'FOREST', 'GHOST', 'GLASS', 'HAMMER', 'ICE',
  'JAGUAR', 'LASER', 'MOON', 'MOUSE', 'PILOT', 'ROBOT', 'SHADOW',
  'ACORN', 'AIRPORT', 'ALMOND', 'AMBULANCE', 'ANGEL', 'ANVIL', 'ARROW', 'ASTRONAUT',
  'AVALANCHE', 'BADGER', 'BALLOON', 'BANANA', 'BANNER', 'BARN', 'BARREL', 'BASIL',
  'BATTERY', 'BEACON', 'BEETLE', 'BICYCLE', 'BISON', 'BLANKET', 'BLOSSOM', 'BOTTLE',
  'BOULDER', 'BRANCH', 'BREEZE', 'BROCCOLI', 'BROOM', 'BUBBLE', 'BUCKET', 'BUTTER',
  'CABIN', 'CACTUS', 'CAMERA', 'CANDLE', 'CANNON', 'CANOE', 'CAPTAIN', 'CARPET',
  'CARROT', 'CASTLE', 'CEDAR', 'CELLO', 'CHERRY', 'CHISEL', 'CIRCLE', 'CIRCUS',
  'CLAW', 'CLOCK', 'COBRA', 'COFFEE', 'COIN', 'COLLAR', 'COMPASS', 'CORAL',
  'CRICKET', 'CRYSTAL', 'CURTAIN', 'DAGGER', 'DAISY', 'DIAMOND', 'DOLPHIN', 'DOMINO',
  'ECLIPSE', 'ENGINE', 'FALCON', 'FEATHER', 'FIDDLE', 'FIGURE', 'FINCH', 'FLAME',
  'FLUTE', 'FOUNTAIN', 'FOX', 'FRIDGE', 'FROG', 'GALAXY', 'GARDEN', 'GIRAFFE',
  'GLOBE', 'GUITAR', 'HARBOR', 'HAWK', 'HELMET', 'HONEY', 'IGLOO', 'ISLAND',
  'JELLY', 'KETTLE', 'KEY', 'KITE', 'LANTERN', 'LEMON', 'LION', 'LIZARD',
  'LOCK', 'MAGNET', 'MARBLE', 'MARCH', 'MARKET', 'MASK', 'MEDAL', 'MERMAID',
  'MIRROR', 'MONKEY', 'NEST', 'NIGHT', 'NUGGET', 'OASIS', 'OCEAN', 'ORBIT',
  'OTTER', 'OYSTER', 'PANDA', 'PAPER', 'PARACHUTE', 'PARROT', 'PEBBLE', 'PENGUIN',
  'PENCIL', 'PIRATE', 'PLANET', 'PLUM', 'POCKET', 'POLAR', 'PUMPKIN', 'PYRAMID',
  'QUARTZ', 'QUEEN', 'RABBIT', 'RADAR', 'RAINBOW', 'RAVEN', 'RELIC', 'RIVER',
  'ROCKET', 'ROSE', 'SAILOR', 'SATELLITE', 'SCARECROW', 'SHELL', 'SHIELD', 'SKATE',
  'SKULL', 'SNAKE', 'SNOW', 'SPIDER', 'SPOON', 'SPRING', 'STAR', 'STATUE',
  'STEAM', 'STORM', 'SUNSET', 'SWORD', 'TIGER', 'TOWER', 'TRAIN', 'TRUMPET',
  'TUNNEL', 'TURTLE', 'UMBRELLA', 'UNICORN', 'VALLEY', 'VIOLET', 'VOLCANO', 'WAGON',
  'WHALE', 'WHEEL', 'WILLOW', 'WINDOW', 'WIZARD', 'WOLF', 'YACHT', 'ZEBRA',
];

export class GameError extends Error {
  constructor(message: string) { super(message); this.name = 'GameError'; }
}

type InternalCard = { word: string; revealed: boolean; alignment: Alignment };

export interface PersistedGame {
  id: string;
  revision: number;
  cards: InternalCard[];
  humanRole: Role;
  turn: Actor;
  phase: Board['phase'];
  status: Board['status'];
  clue: Board['clue'];
  turnGuesses: Board['turnGuesses'];
  guessesRemaining: number;
  scores: Board['scores'];
  log: Board['log'];
  lastAction: string;
}

/** The authoritative, browser-owned game. State is intentionally in memory. */
export class Game {
  private gameId: string;
  private revision = 0;
  private cards: InternalCard[] = [];
  private humanRole: Role;
  private turn: Actor;
  private phase: Board['phase'];
  private status: Board['status'] = 'playing';
  private clue: Board['clue'] = null;
  private turnGuesses: Board['turnGuesses'] = [];
  private guessesRemaining = 0;
  private blue = 0;
  private red = 0;
  private log: Array<{ id: number; text: string }> = [];
  private lastAction = 'Match started';
  private agentReadRevision: number | null = null;

  constructor(humanRole: Role = 'operative', private readonly random: () => number = Math.random, private readonly idFactory: IdFactory = randomId) {
    this.gameId = this.idFactory();
    this.humanRole = humanRole;
    this.turn = humanRole === 'spymaster' ? 'human' : 'agent';
    this.phase = 'clue';
    this.initializeCards();
  }

  get agentRole(): Role { return this.humanRole === 'spymaster' ? 'operative' : 'spymaster'; }
  get human(): Role { return this.humanRole; }

  /** Agent reads are capability reads, and are required before each agent mutation. */
  getBoard(actor: Actor): Board {
    if (actor === 'agent') this.agentReadRevision = this.revision;
    return this.view(actor);
  }

  /** Render a view without changing read authorization state. */
  view(actor: Actor): Board {
    const role = actor === 'human' ? this.humanRole : this.agentRole;
    // Once a match is terminal the key is a post-game result, but revealed remains
    // the actual guessed flag so clients can distinguish guessed from unrevealed cards.
    const canSeeSecrets = role === 'spymaster' || this.status !== 'playing';
    return {
      id: this.gameId,
      revision: this.revision,
      cards: this.cards.map((card): Card => ({
        word: card.word,
        revealed: card.revealed,
        ...(card.revealed || canSeeSecrets ? { alignment: card.alignment } : {}),
      })),
      humanRole: this.humanRole,
      agentRole: this.agentRole,
      turn: this.turn,
      phase: this.phase,
      status: this.status,
      clue: this.clue ? { ...this.clue } : null,
      turnGuesses: this.turnGuesses.map((guess) => ({ ...guess })),
      guessesRemaining: this.guessesRemaining,
      scores: { blue: this.blue, red: this.red, blueTotal: 9, redTotal: 8 },
      log: this.log.map((entry) => ({ ...entry })),
      lastAction: this.lastAction,
    };
  }

  /** Return the complete authoritative game state, including the hidden key. */
  snapshot(): PersistedGame {
    return {
      id: this.gameId,
      revision: this.revision,
      cards: this.cards.map((card) => ({ ...card })),
      humanRole: this.humanRole,
      turn: this.turn,
      phase: this.phase,
      status: this.status,
      clue: this.clue ? { ...this.clue } : null,
      turnGuesses: this.turnGuesses.map((guess) => ({ ...guess })),
      guessesRemaining: this.guessesRemaining,
      scores: { blue: this.blue, red: this.red, blueTotal: 9, redTotal: 8 },
      log: this.log.map((entry) => ({ ...entry })),
      lastAction: this.lastAction,
    };
  }

  /** Restore only validated state; persistence and storage remain controller concerns. */
  restore(snapshot: unknown): void {
    if (!isPersistedGame(snapshot)) throw new GameError('Invalid game snapshot');
    this.gameId = snapshot.id;
    this.revision = snapshot.revision;
    this.cards = snapshot.cards.map((card) => ({ ...card }));
    this.humanRole = snapshot.humanRole;
    this.turn = snapshot.turn;
    this.phase = snapshot.phase;
    this.status = snapshot.status;
    this.clue = snapshot.clue ? { ...snapshot.clue } : null;
    this.turnGuesses = snapshot.turnGuesses.map((guess) => ({ ...guess }));
    this.guessesRemaining = snapshot.guessesRemaining;
    this.blue = snapshot.scores.blue;
    this.red = snapshot.scores.red;
    this.log = snapshot.log.map((entry) => ({ ...entry }));
    this.lastAction = snapshot.lastAction;
    // Fresh-read authorization is deliberately transient and never restored.
    this.agentReadRevision = null;
  }

  /** Align the role labels for a non-active round without dealing a board. */
  setHumanRole(role: Role): Board {
    if (!isRole(role)) throw new GameError('Invalid human role');
    if (this.status === 'playing' && role !== this.humanRole) {
      throw new GameError('Human role cannot change during an active clue/guess turn');
    }
    this.humanRole = role;
    return this.view('human');
  }

  act(actor: Actor, action: Action): Board {
    if (actor === 'agent' && this.agentReadRevision !== this.revision) {
      throw new GameError('Fresh agent board read required before this action');
    }
    if (this.status !== 'playing') throw new GameError('The match is over');
    const actorRole = actor === 'human' ? this.humanRole : this.agentRole;
    if (actor !== this.turn) throw new GameError('It is not your turn');

    if (action.type === 'submit_clue') {
      if (actorRole !== 'spymaster' || this.phase !== 'clue') throw new GameError('Only the spymaster can submit a clue now');
      const clue = typeof action.clue === 'string' ? action.clue.trim() : '';
      if (!clue || clue.length > 40 || !/^[A-Za-z]+$/.test(clue)) throw new GameError('Clue must be one word of 1–40 letters');
      if (this.cards.some((card) => card.word.toLowerCase() === clue.toLowerCase())) throw new GameError('Clue cannot be a board word');
      if (!Number.isInteger(action.count) || action.count < 1 || action.count > 9) throw new GameError('Clue count must be an integer from 1 to 9');
      this.turnGuesses = [];
      this.clue = { word: clue, count: action.count };
      this.guessesRemaining = action.count;
      this.turn = actor === 'human' ? 'agent' : 'human';
      this.phase = 'guess';
      this.lastAction = `${actor === 'human' ? 'Human' : 'Agent'} gave clue “${clue}” (${action.count})`;
      this.addLog(this.lastAction);
      this.bumpRevision();
      return this.view(actor);
    }

    if (action.type === 'end_turn') {
      if (actorRole !== 'operative' || this.phase !== 'guess') throw new GameError('Only the operative can end a guessing turn');
      this.endTurn(actor);
      this.bumpRevision();
      return this.view(actor);
    }

    if (action.type === 'make_guess') {
      if (actorRole !== 'operative' || this.phase !== 'guess') throw new GameError('Only the operative can guess now');
      const word = typeof action.word === 'string' ? action.word.trim() : '';
      const card = this.cards.find((candidate) => candidate.word.toLowerCase() === word.toLowerCase());
      if (!card || card.revealed) throw new GameError('Choose an unrevealed board word');
      this.turnGuesses.push({ actor, word: card.word });
      card.revealed = true;
      this.guessesRemaining -= 1;
      const guessSummary = `${actor === 'human' ? 'Human' : 'Agent'} guessed ${card.word}`;
      this.lastAction = guessSummary;
      // Never put the hidden alignment in the log: operative views share it.
      this.addLog(guessSummary);
      if (card.alignment === 'blue') {
        this.blue += 1;
        if (this.blue === 9) {
          this.status = 'won';
          this.turnGuesses = [];
          this.lastAction = `${guessSummary}; blue team found every blue word`;
        } else if (this.guessesRemaining <= 0) {
          this.endTurn(actor, `${guessSummary}; guess limit reached`);
        }
      } else {
        if (card.alignment === 'red') this.red += 1;
        if (card.alignment === 'assassin') {
          this.status = 'lost';
          this.turnGuesses = [];
          this.lastAction = `${guessSummary}; the assassin was revealed`;
        } else {
          this.endTurn(actor, `${guessSummary}; turn ended`);
        }
      }
      this.bumpRevision();
      return this.view(actor);
    }
    throw new GameError('Unknown action');
  }

  reset(humanRole: Role = 'operative'): Board {
    if (humanRole !== 'operative' && humanRole !== 'spymaster') throw new GameError('Invalid human role');
    const previousWords = new Set(this.cards.map((card) => card.word));
    this.startRound(humanRole);
    this.initializeCards(undefined, previousWords);
    return this.view('human');
  }

  /** Start another round with the same words, but a fresh key and game identity. */
  nextRound(humanRole: Role = this.humanRole): Board {
    if (humanRole !== 'operative' && humanRole !== 'spymaster') throw new GameError('Invalid human role');
    const currentWords = this.cards.map((card) => card.word);
    this.startRound(humanRole);
    this.initializeCards(currentWords);
    return this.view('human');
  }

  private startRound(humanRole: Role): void {
    this.gameId = this.idFactory();
    this.revision = 0;
    this.humanRole = humanRole;
    this.turn = humanRole === 'spymaster' ? 'human' : 'agent';
    this.phase = 'clue';
    this.status = 'playing';
    this.clue = null;
    this.turnGuesses = [];
    this.guessesRemaining = 0;
    this.blue = 0;
    this.red = 0;
    this.log = [];
    this.lastAction = 'Match started';
    this.agentReadRevision = null;
  }

  private initializeCards(selectedWords?: string[], exclude = new Set<string>()): void {
    const available = WORDS.filter((word) => !exclude.has(word));
    if (available.length < 25) throw new GameError('Not enough unused words for a new board');
    const words = selectedWords ? [...selectedWords] : [...available];
    if (words.length < 25) throw new GameError('Not enough words for a new board');
    if (new Set(words).size !== words.length) throw new GameError('A board must contain unique words');
    for (let i = words.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    const boardWords = words.slice(0, 25);
    const alignments: Alignment[] = [
      ...Array<Alignment>(9).fill('blue'), ...Array<Alignment>(8).fill('red'),
      ...Array<Alignment>(7).fill('innocent'), 'assassin',
    ];
    // Shuffle the key independently from the words; fixed positional keys leak secrets.
    for (let i = alignments.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [alignments[i], alignments[j]] = [alignments[j], alignments[i]];
    }
    this.cards = boardWords.map((word, index) => ({ word, revealed: false, alignment: alignments[index] }));
  }

  private endTurn(actor: Actor, summary?: string): void {
    this.turn = actor === 'human' ? 'agent' : 'human';
    this.phase = 'clue';
    this.clue = null;
    this.turnGuesses = [];
    this.guessesRemaining = 0;
    this.lastAction = summary ?? `${actor === 'human' ? 'Human' : 'Agent'} ended the turn`;
    this.addLog(this.lastAction);
  }

  private addLog(text: string): void { this.log.push({ id: this.log.length + 1, text }); }
  private bumpRevision(): void {
    this.revision += 1;
    // A read is consumed by a mutation; a second agent action must read again.
    this.agentReadRevision = null;
  }
}

export { WORDS };

function isAlignment(value: unknown): value is Alignment {
  return value === 'blue' || value === 'red' || value === 'innocent' || value === 'assassin';
}

function isRole(value: unknown): value is Role { return value === 'operative' || value === 'spymaster'; }
function isActor(value: unknown): value is Actor { return value === 'human' || value === 'agent'; }
function isPhase(value: unknown): value is Board['phase'] { return value === 'clue' || value === 'guess'; }
function isStatus(value: unknown): value is Board['status'] { return value === 'playing' || value === 'won' || value === 'lost'; }

function isPersistedGame(value: unknown): value is PersistedGame {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id || !Number.isInteger(candidate.revision) || (candidate.revision as number) < 0
    || !isRole(candidate.humanRole) || !isActor(candidate.turn) || !isPhase(candidate.phase) || !isStatus(candidate.status)
    || !Array.isArray(candidate.cards) || candidate.cards.length !== 25 || !Array.isArray(candidate.turnGuesses)
    || !Array.isArray(candidate.log) || typeof candidate.lastAction !== 'string' || !Number.isInteger(candidate.guessesRemaining)
    || !candidate.scores || typeof candidate.scores !== 'object') return false;

  const words = new Set<string>();
  const counts: Record<Alignment, number> = { blue: 0, red: 0, innocent: 0, assassin: 0 };
  for (const card of candidate.cards) {
    if (!card || typeof card !== 'object') return false;
    const item = card as Record<string, unknown>;
    if (typeof item.word !== 'string' || !WORDS.includes(item.word) || words.has(item.word)
      || typeof item.revealed !== 'boolean' || !isAlignment(item.alignment)) return false;
    words.add(item.word);
    counts[item.alignment] += 1;
  }
  if (counts.blue !== 9 || counts.red !== 8 || counts.innocent !== 7 || counts.assassin !== 1) return false;

  const scores = candidate.scores as Record<string, unknown>;
  if (scores.blueTotal !== 9 || scores.redTotal !== 8 || !Number.isInteger(scores.blue) || !Number.isInteger(scores.red)
    || (scores.blue as number) < 0 || (scores.blue as number) > 9 || (scores.red as number) < 0 || (scores.red as number) > 8) return false;
  const revealedBlue = candidate.cards.filter((card) => (card as Record<string, unknown>).revealed && (card as Record<string, unknown>).alignment === 'blue').length;
  const revealedRed = candidate.cards.filter((card) => (card as Record<string, unknown>).revealed && (card as Record<string, unknown>).alignment === 'red').length;
  if (scores.blue !== revealedBlue || scores.red !== revealedRed) return false;

  if (candidate.clue !== null) {
    if (!candidate.clue || typeof candidate.clue !== 'object') return false;
    const clue = candidate.clue as Record<string, unknown>;
    if (typeof clue.word !== 'string') return false;
    const clueWord = clue.word;
    if (!/^[A-Za-z]+$/.test(clueWord) || clueWord.length > 40
      || WORDS.some((word) => word.toLowerCase() === clueWord.toLowerCase())
      || !Number.isInteger(clue.count) || (clue.count as number) < 1 || (clue.count as number) > 9) return false;
  }
  if (!candidate.turnGuesses.every((guess): boolean => {
    if (!guess || typeof guess !== 'object') return false;
    const item = guess as Record<string, unknown>;
    return isActor(item.actor) && typeof item.word === 'string' && words.has(item.word);
  })) return false;
  const revealedWords = new Set(candidate.cards
    .filter((card) => (card as Record<string, unknown>).revealed)
    .map((card) => (card as Record<string, unknown>).word as string));
  if (!candidate.turnGuesses.every((guess) => revealedWords.has((guess as Record<string, unknown>).word as string))) return false;
  if (!candidate.log.every((entry): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    return Number.isInteger(item.id) && (item.id as number) > 0 && typeof item.text === 'string';
  })) return false;
  const guessesRemaining = candidate.guessesRemaining as number;
  if ((candidate.phase === 'clue' && (guessesRemaining !== 0 || candidate.turnGuesses.length !== 0))
    || guessesRemaining < 0 || guessesRemaining > 9) return false;
  if (candidate.status === 'playing' && candidate.phase === 'clue' && candidate.clue !== null) return false;
  if (candidate.status === 'playing' && candidate.phase === 'guess') {
    const clueCount = candidate.clue && typeof candidate.clue === 'object'
      ? (candidate.clue as Record<string, unknown>).count as number : null;
    if (clueCount === null || guessesRemaining !== clueCount - candidate.turnGuesses.length) return false;
  }
  return true;
}
