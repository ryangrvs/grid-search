import type { Action, Board, RegistrationResult, Role, Team } from '../shared/types';

export const BOARD_URI = 'semanticspy://game/board';

type JsonSchema = Record<string, unknown>;

export interface ModelContext {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: JsonSchema;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
  }): void | Promise<void>;
}

export interface WebMCPOptions {
  agentToken: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  host?: ModelContext;
  /** Called after an agent mutation, with no agent board argument. */
  refreshHumanBoard?: () => Promise<void> | void;
}

export interface WebMCPRegistration {
  supported: boolean;
  registered: string[];
  reason?: string;
}

const toolNames = ['get_board', 'submit_clue', 'make_guess', 'end_turn'] as const;
const registrationToolName = 'register' as const;

function modelContextHost(): ModelContext | undefined {
  const doc = globalThis.document as (Document & { modelContext?: ModelContext }) | undefined;
  const nav = globalThis.navigator as (Navigator & { modelContext?: ModelContext }) | undefined;
  return doc?.modelContext ?? nav?.modelContext;
}

async function readJson<T>(response: Response): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned ${response.status} with invalid JSON`);
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function schemaMap(value: unknown): Record<(typeof toolNames)[number], JsonSchema> {
  if (!value || typeof value !== 'object') throw new Error('Invalid tool schemas response');
  const candidate = value as Record<string, unknown>;
  for (const name of toolNames) {
    if (!candidate[name] || typeof candidate[name] !== 'object') throw new Error(`Missing schema for ${name}`);
  }
  return candidate as Record<(typeof toolNames)[number], JsonSchema>;
}

function requireEmptyArgs(args: Record<string, unknown>): void {
  if (args && Object.keys(args).length) throw new Error('get_board does not accept arguments');
}

function requireKeys(args: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(args ?? {}).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Arguments must contain exactly: ${keys.join(', ')}`);
  }
}

function requireText(args: Record<string, unknown>, key: string): string {
  const value = args?.[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function requireCount(args: Record<string, unknown>): number {
  const value = args?.count;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('count must be a positive integer');
  return value;
}

function registrationArgs(args: Record<string, unknown>): { name: string; team?: Team; role?: Role } {
  const actual = Object.keys(args ?? {});
  if (!actual.includes('name') || actual.some((key) => !['name', 'team', 'role'].includes(key))) {
    throw new Error('Arguments must contain name and may contain team, role');
  }
  const name = requireText(args, 'name');
  if (name.length > 40) throw new Error('name must be at most 40 characters');
  if (args.team !== undefined && args.team !== 'blue' && args.team !== 'red') throw new Error('team must be blue or red');
  if (args.role !== undefined && args.role !== 'operative' && args.role !== 'spymaster') throw new Error('role must be operative or spymaster');
  return { name, team: args.team as Team | undefined, role: args.role as Role | undefined };
}

/**
 * Register the local game as WebMCP tools. The modelContext API is feature-detected
 * at call time; no browser resource registry or synthetic fallback is used.
 */
export async function registerWebMCP(options: WebMCPOptions): Promise<WebMCPRegistration> {
  const host = options.host ?? modelContextHost();
  if (!host || typeof host.registerTool !== 'function') {
    return { supported: false, registered: [], reason: 'WebMCP is not supported in this browser.' };
  }
  if (!options.agentToken) return { supported: false, registered: [], reason: 'Agent capability is not available yet.' };

  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.apiBase ?? '';
  let schemas: Record<(typeof toolNames)[number], JsonSchema> & Partial<Record<typeof registrationToolName, JsonSchema>>;
  try {
    schemas = schemaMap(await readJson(await fetchImpl(`${base}/api/schemas`))) as typeof schemas;
  } catch (error) {
    return { supported: false, registered: [], reason: error instanceof Error ? error.message : 'Could not load WebMCP schemas.' };
  }

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${options.agentToken}`);
    if (init?.body) headers.set('Content-Type', 'application/json');
    return readJson<T>(await fetchImpl(`${base}${path}`, { ...init, headers }));
  };

  const getAgentBoard = async (): Promise<Board> => request<Board>('/api/agent/board');
  const mutate = async (action: Action): Promise<{ uri: string; board: Board }> => {
    const board = await request<Board>('/api/agent/action', { method: 'POST', body: JSON.stringify(action) });
    // The agent view never enters the human DOM. The callback fetches /api/board itself.
    await options.refreshHumanBoard?.();
    return { uri: BOARD_URI, board };
  };

  const register = async (args: Record<string, unknown>): Promise<RegistrationResult> => {
    const registration = registrationArgs(args);
    const result = await request<RegistrationResult>('/api/register', { method: 'POST', body: JSON.stringify(registration) });
    await options.refreshHumanBoard?.();
    return result;
  };

  const tools = [
    {
      name: 'get_board',
      description: 'Read the current SemanticSpy board from the agent role. Use this before every move.',
      inputSchema: schemas.get_board,
      execute: async (args: Record<string, unknown>) => {
        requireEmptyArgs(args ?? {});
        const board = await getAgentBoard();
        return { uri: BOARD_URI, board };
      },
    },
    {
      name: 'submit_clue',
      description: 'Submit one clue and its count for the agent side. The operative gets at most count guesses, no bonus. Read get_board immediately before use.',
      inputSchema: schemas.submit_clue,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['clue', 'count']);
        return mutate({ type: 'submit_clue', clue: requireText(args, 'clue'), count: requireCount(args) });
      },
    },
    {
      name: 'make_guess',
      description: 'Make one legal board guess for the agent side. Read get_board immediately before use.',
      inputSchema: schemas.make_guess,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['word']);
        return mutate({ type: 'make_guess', word: requireText(args, 'word') });
      },
    },
    {
      name: 'end_turn',
      description: 'End the agent turn. Read get_board immediately before use.',
      inputSchema: schemas.end_turn,
      execute: async (args: Record<string, unknown>) => {
        requireEmptyArgs(args ?? {});
        return mutate({ type: 'end_turn' });
      },
    },
    ...(schemas.register ? [{
      name: registrationToolName,
      description: 'Register as a player in the live SemanticSpy lobby. Team and role are optional; the next open Blue-first seat is assigned when omitted.',
      inputSchema: schemas.register,
      execute: async (args: Record<string, unknown>) => register(args),
    }] : []),
  ];

  for (const tool of tools) await host.registerTool(tool);
  return { supported: true, registered: [...toolNames, ...(schemas.register ? [registrationToolName] : [])] };
}
