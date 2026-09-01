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
