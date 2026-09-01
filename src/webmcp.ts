import type { Action, Board, RegistrationResult, Role, Team } from '../shared/types';
import { schemas } from '../shared/schemas';
import type { GameController } from './game-controller';

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
  controller: GameController;
  host?: ModelContext;
  /** Called after an agent mutation or registration so the human UI can re-render. */
  refreshHumanBoard?: () => Promise<void> | void;
}

export interface WebMCPRegistration {
  supported: boolean;
  registered: string[];
  reason?: string;
}

const toolNames = ['get_board', 'submit_clue', 'make_guess', 'end_turn', 'register'] as const;

function modelContextHost(): ModelContext | undefined {
  const doc = globalThis.document as (Document & { modelContext?: ModelContext }) | undefined;
  const nav = globalThis.navigator as (Navigator & { modelContext?: ModelContext }) | undefined;
  return doc?.modelContext ?? nav?.modelContext;
}

function requireEmptyArgs(args: Record<string, unknown>): void {
  if (args && Object.keys(args).length) throw new Error('Arguments must contain no arguments');
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
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 9) {
    throw new Error('count must be an integer from 1 to 9');
  }
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

/** Register imperative WebMCP tools against the browser-owned controller. */
export async function registerWebMCP(options: WebMCPOptions): Promise<WebMCPRegistration> {
  const host = options.host ?? modelContextHost();
  if (!host || typeof host.registerTool !== 'function') {
    return { supported: false, registered: [], reason: 'WebMCP is not supported in this browser.' };
  }

  const mutate = async (action: Action): Promise<{ uri: string; board: Board }> => {
    const board = options.controller.act('agent', action);
    await options.refreshHumanBoard?.();
    return { uri: BOARD_URI, board };
  };

  const tools = [
    {
      name: 'get_board',
      description: 'Read the current SemanticSpy board from the agent role. Use this before every move.',
      inputSchema: schemas.get_board as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireEmptyArgs(args ?? {});
        return { uri: BOARD_URI, board: options.controller.getBoard('agent') };
      },
    },
    {
      name: 'submit_clue',
      description: 'Submit one clue and its count for the agent side. Read get_board immediately before use.',
      inputSchema: schemas.submit_clue as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['clue', 'count']);
        return mutate({ type: 'submit_clue', clue: requireText(args, 'clue'), count: requireCount(args) });
      },
    },
    {
      name: 'make_guess',
      description: 'Make one legal board guess for the agent side. Read get_board immediately before use.',
      inputSchema: schemas.make_guess as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['word']);
        return mutate({ type: 'make_guess', word: requireText(args, 'word') });
      },
    },
    {
      name: 'end_turn',
      description: 'End the agent turn. Read get_board immediately before use.',
      inputSchema: schemas.end_turn as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireEmptyArgs(args ?? {});
        return mutate({ type: 'end_turn' });
      },
    },
    {
      name: 'register',
      description: 'Register as a player in the local SemanticSpy lobby. Team and role are optional.',
      inputSchema: schemas.register as JsonSchema,
      execute: async (args: Record<string, unknown>): Promise<RegistrationResult> => {
        const registration = registrationArgs(args);
        const result = options.controller.register(registration.name, registration.team, registration.role);
        await options.refreshHumanBoard?.();
        return result;
      },
    },
  ];

  for (const tool of tools) await host.registerTool(tool);
  return { supported: true, registered: [...toolNames] };
}
