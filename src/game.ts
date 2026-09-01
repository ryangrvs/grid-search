import type { Action, Actor, Alignment, Board, Card, MatchMode, MatchModeInput, Player, Role, Team } from '../shared/types';

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

export interface GameOptions {
  humanRole?: Role;
  players?: Player[];
  roster?: { players: () => Player[] };
  allowSyntheticPlayers?: boolean;
  mode?: MatchModeInput;
  random?: () => number;
  idFactory?: IdFactory;
}

export interface PersistedGame {
  id: string;
  revision: number;
  cards: InternalCard[];
  players: Player[];
  mode: MatchMode;
  activePlayerId: string;
  humanRole: Role;
  turn: Actor;
  phase: Board['phase'];
  status: Board['status'];
  winner: Team | null;
  clue: Board['clue'];
  turnGuesses: Board['turnGuesses'];
  guessesRemaining: number;
  scores: Board['scores'];
  turnNumber: number;
  teamTurnCounts: Board['teamTurnCounts'];
  log: Board['log'];
  lastAction: string;
}

function opposite(role: Role): Role { return role === 'operative' ? 'spymaster' : 'operative'; }
function validPlayer(value: unknown): value is Player {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && !!p.id && typeof p.displayName === 'string' &&
    (p.controller === 'human' || p.controller === 'agent') && (p.team === 'blue' || p.team === 'red') && isRole(p.role);
}

/** The single authoritative engine. Actor overloads remain for old UI/WebMCP adapters. */
export class Game {
  private gameId: string;
  private revision = 0;
  private cards: InternalCard[] = [];
  private players: Player[];
  private mode: MatchMode;
  private activePlayerId: string;
  private phase: Board['phase'];
  private status: Board['status'] = 'playing';
  private winner: Team | null = null;
  private clue: Board['clue'] = null;
  private turnGuesses: Board['turnGuesses'] = [];
  private guessesRemaining = 0;
  private blue = 0;
  private red = 0;
  private turnNumber = 0;
  private teamTurnCounts = { blue: 0, red: 0 };
  private log: Array<{ id: number; text: string }> = [];
  private lastAction = 'Match started';
  private agentReads = new Map<string, number>();
  private readonly random: () => number;
  private readonly idFactory: IdFactory;

  constructor(humanRoleOrOptions: Role | GameOptions | Player[] = 'operative', randomOrMode: (() => number) | MatchMode = Math.random, idFactory: IdFactory = randomId) {
    const arrayInput = Array.isArray(humanRoleOrOptions);
    const options: GameOptions = arrayInput
      ? { players: humanRoleOrOptions, mode: typeof randomOrMode === 'string' ? randomOrMode : undefined }
      : (typeof humanRoleOrOptions === 'object' ? humanRoleOrOptions : {});
    this.random = options.random ?? (typeof randomOrMode === 'function' ? randomOrMode : Math.random);
    this.idFactory = options.idFactory ?? idFactory;
    const role = typeof humanRoleOrOptions === 'string' ? humanRoleOrOptions
      : (options.humanRole ?? options.players?.find((p) => p.controller === 'human')?.role ?? 'operative');
    if (!isRole(role)) throw new GameError('Invalid human role');
    this.mode = options.mode === 'versus' ? 'versus' : 'coop';
    this.players = normalizePlayers(options.players ?? options.roster?.players(), role, this.mode, options.allowSyntheticPlayers !== false);
    this.gameId = this.idFactory();
    this.activePlayerId = this.players.find((p) => p.team === 'blue' && p.role === 'spymaster')?.id
      ?? (options.allowSyntheticPlayers === false && this.players.length === 1 ? 'agent-compatibility' : this.players[0].id);
    this.phase = 'clue';
    this.initializeCards();
  }

  get human(): Role { return this.humanPlayer().role; }
  get agentRole(): Role { return this.agentPlayer()?.role ?? opposite(this.human); }
  get humanRole(): Role { return this.human; }
  get activePlayer(): Player {
    return this.activePlayerId === 'agent-compatibility' ? this.compatibilityAgent() : this.player(this.activePlayerId);
  }

  getBoard(viewer: Actor | string | Player = 'human'): Board {
    const p = this.resolveViewer(viewer);
    if (p.controller === 'agent') this.agentReads.set(p.id, this.revision);
    return this.view(p);
  }
  view(viewer: Actor | string | Player = 'human'): Board {
    const p = this.resolveViewer(viewer);
    const canSeeSecrets = p.role === 'spymaster' || this.status !== 'playing';
    const activePlayer = this.activePlayer;
    return {
      id: this.gameId,
      revision: this.revision,
      cards: this.cards.map((card): Card => ({
        word: card.word,
        revealed: card.revealed,
        ...(card.revealed || canSeeSecrets ? { alignment: card.alignment } : {}),
      })),
      humanRole: this.human,
      agentRole: this.agentRole,
      activePlayer: { ...activePlayer },
      activePlayerId: this.activePlayerId,
      mode: this.mode,
      turn: activePlayer.controller,
      phase: this.phase,
      status: this.status,
      winner: this.winner,
      clue: this.clue ? { ...this.clue } : null,
      turnGuesses: this.turnGuesses.map((guess) => ({ ...guess })),
      guessesRemaining: this.guessesRemaining,
      scores: { blue: this.blue, red: this.red, blueTotal: 9, redTotal: 8 },
      turnNumber: this.turnNumber,
      teamTurnCounts: { ...this.teamTurnCounts },
      log: this.log.map((entry) => ({ ...entry })),
      lastAction: this.lastAction,
    };
  }

  snapshot(): PersistedGame {
    return {
      id: this.gameId,
      revision: this.revision,
      cards: this.cards.map((card) => ({ ...card })),
      players: this.players.map((player) => ({ ...player })),
      mode: this.mode,
      activePlayerId: this.activePlayerId,
      humanRole: this.human,
      turn: this.activePlayer.controller,
      phase: this.phase,
      status: this.status,
      winner: this.winner,
      clue: this.clue ? { ...this.clue } : null,
      turnGuesses: this.turnGuesses.map((guess) => ({ ...guess })),
      guessesRemaining: this.guessesRemaining,
      scores: { blue: this.blue, red: this.red, blueTotal: 9, redTotal: 8 },
      turnNumber: this.turnNumber,
      teamTurnCounts: { ...this.teamTurnCounts },
      log: this.log.map((entry) => ({ ...entry })),
      lastAction: this.lastAction,
    };
  }

  restore(snapshot: unknown): void {
    if (!isPersistedGame(snapshot)) throw new GameError('Invalid game snapshot');
    this.gameId = snapshot.id;
    this.revision = snapshot.revision;
    this.cards = snapshot.cards.map((card) => ({ ...card }));
    this.players = snapshot.players.map((player) => ({ ...player }));
    this.mode = snapshot.mode;
    this.activePlayerId = snapshot.activePlayerId;
    this.phase = snapshot.phase;
    this.status = snapshot.status;
    this.winner = snapshot.winner;
    this.clue = snapshot.clue ? { ...snapshot.clue } : null;
    this.turnGuesses = snapshot.turnGuesses.map((guess) => ({ ...guess }));
    this.guessesRemaining = snapshot.guessesRemaining;
    this.blue = snapshot.scores.blue;
    this.red = snapshot.scores.red;
    this.turnNumber = snapshot.turnNumber;
    this.teamTurnCounts = { ...snapshot.teamTurnCounts };
    this.log = snapshot.log.map((entry) => ({ ...entry }));
    this.lastAction = snapshot.lastAction;
    this.agentReads.clear();
  }

  setHumanRole(role: Role, rosterPlayers?: Player[], allowSyntheticPlayers = true): Board {
    if (!isRole(role)) throw new GameError('Invalid human role');
    if (this.status === 'playing' && role !== this.human) throw new GameError('Human role cannot change during an active clue/guess turn');
    // On a completed round the controller can pass the latest roster so the
    // game never retains a compatibility/synthetic identity after registration.
    if (rosterPlayers) this.players = normalizePlayers(rosterPlayers, role, this.mode, allowSyntheticPlayers);
    const human = this.humanPlayer(); human.role = role;
    const otherBlue = this.players.find((p) => p.team === 'blue' && p.id !== human.id); if (otherBlue) otherBlue.role = opposite(role);
    this.players.filter((p) => p.team === 'red').forEach((p, i) => { p.role = i === 0 ? role : opposite(role); });
    return this.view(human);
  }

  /** Adopt the controller's roster without dealing a new board. */
  syncPlayers(players: Player[], allowSyntheticPlayers = true): void {
    const active = this.activePlayer;
    this.players = normalizePlayers(players, this.human, this.mode, allowSyntheticPlayers);
    const targetTeam = this.mode === 'coop' ? 'blue' : active.team;
    const targetRole: Role = this.phase === 'clue' ? 'spymaster' : 'operative';
    const replacement = this.players.find((p) => p.team === targetTeam && p.role === targetRole);
    this.activePlayerId = replacement?.id
      ?? (targetTeam === 'blue' && targetRole === 'spymaster' ? 'agent-compatibility' : this.humanPlayer().id);
  }

  /** Begin a match from the current authoritative roster. */
  startRound(modeInput: MatchModeInput, players: Player[], humanRole = this.human, keepWords = false, allowSyntheticPlayers = true): Board {
    const mode: MatchMode = modeInput === 'versus' ? 'versus' : 'coop';
    const oldWords = keepWords ? this.cards.map((c) => c.word) : undefined;
    this.players = normalizePlayers(players, humanRole, mode, allowSyntheticPlayers); this.mode = mode; this.resetState(humanRole);
    this.initializeCards(oldWords, keepWords ? new Set<string>() : new Set(this.cards.map((c) => c.word)));
    return this.view('human');
  }
  startMatch(mode: MatchModeInput, players: Player[], humanRole = this.human): Board { return this.startRound(mode, players, humanRole); }
  startCoop(players: Player[], humanRole = this.human): Board { return this.startRound('coop', players, humanRole); }
  startVersus(players: Player[], humanRole = this.human): Board { return this.startRound('versus', players, humanRole); }

  act(actorOrPlayer: Actor | string | Player, action: Action): Board {
    const actor = this.resolveViewer(actorOrPlayer);
    if (actor.controller === 'agent' && this.agentReads.get(actor.id) !== this.revision) throw new GameError('Fresh agent board read required before this action');
    if (this.status !== 'playing') throw new GameError('The match is over');
    if (actor.id !== this.activePlayerId) throw new GameError('It is not your turn');
    if (action.type === 'submit_clue') {
      if (actor.role !== 'spymaster' || this.phase !== 'clue') throw new GameError('Only the spymaster can submit a clue now');
      const clue = typeof action.clue === 'string' ? action.clue.trim() : '';
      if (!clue || clue.length > 40 || !/^[A-Za-z]+$/.test(clue)) throw new GameError('Clue must be one word of 1–40 letters');
      if (this.cards.some((c) => c.word.toLowerCase() === clue.toLowerCase())) throw new GameError('Clue cannot be a board word');
      if (!Number.isInteger(action.count) || action.count < 1 || action.count > 9) throw new GameError('Clue count must be an integer from 1 to 9');
      this.turnGuesses = [];
      this.clue = { word: clue, count: action.count };
      this.guessesRemaining = action.count;
      this.phase = 'guess';
      this.activePlayerId = this.playerFor(actor.team, 'operative').id;
      this.turnNumber += 1;
      this.teamTurnCounts[actor.team] += 1;
      this.lastAction = `${actor.displayName} gave clue “${clue}” (${action.count})`;
      this.addLog(this.lastAction);
      this.bumpRevision();
      return this.view(actor);
    }
    if (action.type === 'end_turn') {
      if (actor.role !== 'operative' || this.phase !== 'guess') throw new GameError('Only the operative can end a guessing turn');
      this.finishTurn(actor, `${actor.displayName} ended the turn`); this.bumpRevision(); return this.view(actor);
    }
    if (action.type === 'make_guess') {
      if (actor.role !== 'operative' || this.phase !== 'guess') throw new GameError('Only the operative can guess now');
      const word = typeof action.word === 'string' ? action.word.trim() : '';
      const card = this.cards.find((c) => c.word.toLowerCase() === word.toLowerCase());
      if (!card || card.revealed) throw new GameError('Choose an unrevealed board word');
      this.turnGuesses.push({ playerId: actor.id, word: card.word });
      card.revealed = true;
      this.guessesRemaining -= 1;
      const summary = `${actor.displayName} guessed ${card.word}`;
      this.lastAction = summary;
      this.addLog(summary);
      if (card.alignment === 'blue') {
        this.blue += 1;
      } else if (card.alignment === 'red') {
        this.red += 1;
      }
      if (card.alignment === 'assassin') {
        this.status = 'lost';
        this.winner = oppositeTeam(actor.team);
        this.turnGuesses = [];
        this.lastAction = `${summary}; the assassin was revealed`;
      } else if (this.blue === 9 || (this.mode === 'versus' && this.red === 8)) {
        this.status = 'won';
        this.winner = this.blue === 9 ? 'blue' : 'red';
        this.turnGuesses = [];
        this.lastAction = `${summary}; ${this.winner} team found every word`;
      } else if (card.alignment !== actor.team || this.guessesRemaining <= 0) {
        this.finishTurn(actor, `${summary}; ${this.guessesRemaining <= 0 ? 'guess limit reached' : 'turn ended'}`);
      }
      this.bumpRevision(); return this.view(actor);
    }
    throw new GameError('Unknown action');
  }

  reset(humanRole: Role = this.human): Board {
    const oldWords = new Set(this.cards.map((card) => card.word));
    this.resetState(humanRole);
    this.initializeCards(undefined, oldWords);
    return this.view('human');
  }

  nextRound(humanRole: Role = this.human): Board {
    const words = this.cards.map((card) => card.word);
    this.resetState(humanRole);
    this.initializeCards(words);
    return this.view('human');
  }

  private resetState(humanRole: Role): void {
    if (!isRole(humanRole)) throw new GameError('Invalid human role');
    this.setRoles(humanRole);
    this.gameId = this.idFactory();
    this.revision = 0;
    this.activePlayerId = this.players.find((p) => p.team === 'blue' && p.role === 'spymaster')?.id
      ?? (this.humanPlayer().role === 'spymaster' ? this.humanPlayer().id : 'agent-compatibility');
    this.phase = 'clue';
    this.status = 'playing';
    this.winner = null;
    this.clue = null;
    this.turnGuesses = [];
    this.guessesRemaining = 0;
    this.blue = 0;
    this.red = 0;
    this.turnNumber = 0;
    this.teamTurnCounts = { blue: 0, red: 0 };
    this.log = [];
    this.lastAction = 'Match started';
    this.agentReads.clear();
  }
  private setRoles(humanRole: Role): void {
    const human = this.humanPlayer();
    human.role = humanRole;
    const bluePartner = this.players.find((p) => p.team === 'blue' && p.id !== human.id);
    if (bluePartner) bluePartner.role = opposite(humanRole);
    this.players.filter((p) => p.team === 'red').forEach((player, index) => {
      player.role = index ? opposite(humanRole) : humanRole;
    });
  }

  private finishTurn(actor: Player, summary: string): void {
    this.activePlayerId = this.nextSpymaster(actor.team).id;
    this.phase = 'clue';
    this.clue = null;
    this.turnGuesses = [];
    this.guessesRemaining = 0;
    this.lastAction = summary;
    this.addLog(summary);
  }

  private nextSpymaster(team: Team): Player {
    const otherTeam = team === 'blue' ? 'red' : 'blue';
    return this.mode === 'versus'
      ? this.playerFor(otherTeam, 'spymaster')
      : this.playerFor('blue', 'spymaster');
  }

  private playerFor(team: Team, role: Role): Player {
    const player = this.players.find((candidate) => candidate.team === team && candidate.role === role);
    if (!player) throw new GameError(`No ${team} ${role} player is registered`);
    return player;
  }
  private firstSpymaster(): Player { return this.playerFor('blue', 'spymaster'); }
  private humanPlayer(): Player { return this.players.find((p) => p.controller === 'human') ?? this.players[0]; }
  private agentPlayer(): Player | undefined { return this.players.find((p) => p.controller === 'agent'); }
  private compatibilityAgent(): Player {
    return {
      id: 'agent-compatibility', displayName: 'Agent', controller: 'agent', team: 'blue', role: opposite(this.human),
    };
  }
  private player(id: string): Player {
    const player = this.players.find((candidate) => candidate.id === id);
    if (!player) throw new GameError('Unknown player');
    return player;
  }
  private resolveViewer(viewer: Actor | string | Player): Player {
    if (typeof viewer === 'object') {
      if (viewer.id === 'agent-compatibility') return viewer;
      return this.player(viewer.id);
    }
    if (viewer === 'human') return this.humanPlayer();
    if (viewer === 'agent') return this.agentPlayer() ?? {
      id: 'agent-compatibility', displayName: 'Agent', controller: 'agent', team: 'blue', role: opposite(this.human),
    };
    return this.player(viewer);
  }
  private addLog(text: string): void { this.log.push({ id: this.log.length + 1, text }); }
  private bumpRevision(): void { this.revision += 1; this.agentReads.clear(); }
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

}

export { WORDS };

function oppositeTeam(team: Team): Team { return team === 'blue' ? 'red' : 'blue'; }

function normalizePlayers(input: Player[] | undefined, humanRole: Role, mode: MatchMode, allowSyntheticPlayers = true): Player[] {
  const players = (input ?? []).filter(validPlayer).map((player) => ({ ...player }));
  let human = players.find((p) => p.controller === 'human' && p.team === 'blue');
  if (!human) {
    human = { id: 'human', displayName: 'You', controller: 'human', team: 'blue', role: humanRole };
    players.unshift(human);
  }
  human.role = humanRole;
  if (allowSyntheticPlayers && !players.some((p) => p.team === 'blue' && p.id !== human!.id)) {
    players.push({
      id: 'agent-blue', displayName: 'Agent', controller: 'agent', team: 'blue', role: opposite(humanRole),
    });
  }
  // A direct Game({mode:'versus'}) caller may provide a complete roster; the
  // synthetic seats only make the compatibility constructor usable in tests.
  if (allowSyntheticPlayers && mode === 'versus') {
    if (!players.some((p) => p.team === 'red' && p.role === 'spymaster')) {
      players.push({ id: 'agent-red-spymaster', displayName: 'Red Spymaster', controller: 'agent', team: 'red', role: 'spymaster' });
    }
    if (!players.some((p) => p.team === 'red' && p.role === 'operative')) {
      players.push({ id: 'agent-red-operative', displayName: 'Red Operative', controller: 'agent', team: 'red', role: 'operative' });
    }
  }
  return players;
}

function isAlignment(value: unknown): value is Alignment {
  return value === 'blue' || value === 'red' || value === 'innocent' || value === 'assassin';
}

function isRole(value: unknown): value is Role { return value === 'operative' || value === 'spymaster'; }
function isActor(value: unknown): value is Actor { return value === 'human' || value === 'agent'; }
function isMode(value: unknown): value is MatchMode { return value === 'coop' || value === 'versus'; }
function isPhase(value: unknown): value is Board['phase'] { return value === 'clue' || value === 'guess'; }
function isStatus(value: unknown): value is Board['status'] { return value === 'playing' || value === 'won' || value === 'lost'; }

function isPersistedGame(value: unknown): value is PersistedGame {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id || !Number.isInteger(candidate.revision) || (candidate.revision as number) < 0
    || !isMode(candidate.mode) || typeof candidate.activePlayerId !== 'string' || !candidate.activePlayerId
    || !Array.isArray(candidate.players) || !candidate.players.every(validPlayer)
    || !isRole(candidate.humanRole) || !isActor(candidate.turn) || !isPhase(candidate.phase) || !isStatus(candidate.status)
    || (candidate.winner !== null && candidate.winner !== 'blue' && candidate.winner !== 'red')
    || !Array.isArray(candidate.cards) || candidate.cards.length !== 25 || !Array.isArray(candidate.turnGuesses)
    || !Array.isArray(candidate.log) || typeof candidate.lastAction !== 'string' || !Number.isInteger(candidate.guessesRemaining)
    || !candidate.scores || typeof candidate.scores !== 'object' || !Number.isInteger(candidate.turnNumber)
    || (candidate.turnNumber as number) < 0 || !candidate.teamTurnCounts || typeof candidate.teamTurnCounts !== 'object') return false;
  const players = candidate.players as Player[];
  const humanPlayers = players.filter((p) => p.controller === 'human' && p.team === 'blue');
  const bluePlayers = players.filter((p) => p.team === 'blue');
  const incompleteLobby = candidate.mode === 'coop' && bluePlayers.length === 1
    && (candidate.activePlayerId === humanPlayers[0]?.id || candidate.activePlayerId === 'agent-compatibility');
  if (new Set(players.map((p) => p.id)).size !== players.length || humanPlayers.length !== 1
    || (!incompleteLobby && !players.some((p) => p.id === candidate.activePlayerId))) return false;
  const active = players.find((p) => p.id === candidate.activePlayerId) ?? {
    id: 'agent-compatibility', displayName: 'Agent', controller: 'agent' as const, team: 'blue' as const, role: opposite(humanPlayers[0].role),
  };
  const blueSpies = players.filter((p) => p.team === 'blue' && p.role === 'spymaster');
  const blueOperatives = players.filter((p) => p.team === 'blue' && p.role === 'operative');
  const redSpies = players.filter((p) => p.team === 'red' && p.role === 'spymaster');
  const redOperatives = players.filter((p) => p.team === 'red' && p.role === 'operative');
  if ((!incompleteLobby && (blueSpies.length !== 1 || blueOperatives.length !== 1))
    || (candidate.mode === 'versus' && (redSpies.length !== 1 || redOperatives.length !== 1))) return false;
  if (active.team !== 'blue' && candidate.mode === 'coop') return false;
  if (!incompleteLobby && candidate.phase === 'clue' && active.role !== 'spymaster') return false;
  if (!incompleteLobby && candidate.phase === 'guess' && active.role !== 'operative') return false;
  const countsByTeam = candidate.teamTurnCounts as Record<string, unknown>;
  if (!Number.isInteger(countsByTeam.blue) || !Number.isInteger(countsByTeam.red) || (countsByTeam.blue as number) < 0 || (countsByTeam.red as number) < 0
    || (candidate.turnNumber as number) !== (countsByTeam.blue as number) + (countsByTeam.red as number)
    || (candidate.mode === 'coop' && countsByTeam.red !== 0)) return false;

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
  const assassinRevealed = candidate.cards.some((card) => (card as Record<string, unknown>).revealed && (card as Record<string, unknown>).alignment === 'assassin');
  const winner = candidate.winner as Team | null;
  if ((candidate.status === 'playing' && winner !== null) || (candidate.status !== 'playing' && winner === null)) return false;
  if (candidate.status === 'playing' && (scores.blue === 9 || (candidate.mode === 'versus' && scores.red === 8))) return false;
  if (candidate.status === 'won' && !((winner === 'blue' && scores.blue === 9)
    || (winner === 'red' && candidate.mode === 'versus' && scores.red === 8))) return false;
  if (candidate.status === 'lost' && (!assassinRevealed || winner !== oppositeTeam(active.team))) return false;

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
    return typeof item.playerId === 'string' && players.some((p) => p.id === item.playerId)
      && typeof item.word === 'string' && words.has(item.word);
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
  if (candidate.turn !== active.controller) return false;
  return true;
}
