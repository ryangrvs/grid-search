import type { Action, AuthorizedState, RegistrationResult, Role, Team } from '../shared/types';
import { schemas } from '../shared/schemas';
import type { GameController } from './game-controller';

export const STATE_URI = 'semanticspy://game/state';
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

const toolNames = ['get_context', 'get_state', 'submit_clue', 'make_guess', 'end_turn', 'register'] as const;

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

const CONTEXT = [
  'SemanticSpy objective: work with your teammate to find all your team’s words; in Versus, finish before the other team, and never choose the assassin.',
  'Register with register({ name, team?, role? }) and keep the returned playerHandle. If you lose context, register again with the same name to recover; this rotates the old handle.',
  'Call get_state({ playerHandle }) before your first action and whenever another player has acted. On your active turn, a spymaster submits one clue and count; the count is the exact maximum number of guesses with no bonus or carryover. An operative may guess or end_turn; an opponent or innocent word ends the guessing turn.',
  'Successful actions return authoritative state and can be followed by another action when it remains legal. Use only alignments present in your role-filtered state, and do not reveal secrets through table talk.',
].join(' ');

/** Register imperative WebMCP tools against the browser-owned controller. */
export async function registerWebMCP(options: WebMCPOptions): Promise<WebMCPRegistration> {
  const host = options.host ?? modelContextHost();
  if (!host || typeof host.registerTool !== 'function') {
    return { supported: false, registered: [], reason: 'WebMCP is not supported in this browser.' };
  }

  const mutate = async (playerHandle: string, action: Action): Promise<{ uri: string; state: AuthorizedState }> => {
    options.controller.syncFromStore();
    const state = options.controller.actForHandle(playerHandle, action);
    await options.refreshHumanBoard?.();
    return { uri: STATE_URI, state };
  };

  const tools = [
    {
      name: 'get_context',
      description: 'Read the concise, static SemanticSpy objective, rules, and tool workflow.',
      inputSchema: schemas.get_context as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireEmptyArgs(args ?? {});
        return { context: CONTEXT };
      },
    },
    {
      name: 'get_state',
      description: 'Read the current role-filtered SemanticSpy state for a registered player handle.',
      inputSchema: schemas.get_state as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['playerHandle']);
        const playerHandle = requireText(args, 'playerHandle');
        options.controller.syncFromStore();
        return { uri: STATE_URI, state: options.controller.getState(playerHandle) };
      },
    },
    {
      name: 'submit_clue',
      description: 'Submit one clue and its exact maximum guess count for the registered spymaster.',
      inputSchema: schemas.submit_clue as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['playerHandle', 'clue', 'count']);
        return mutate(requireText(args, 'playerHandle'), { type: 'submit_clue', clue: requireText(args, 'clue'), count: requireCount(args) });
      },
    },
    {
      name: 'make_guess',
      description: 'Make one legal board guess for the registered operative.',
      inputSchema: schemas.make_guess as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['playerHandle', 'word']);
        return mutate(requireText(args, 'playerHandle'), { type: 'make_guess', word: requireText(args, 'word') });
      },
    },
    {
      name: 'end_turn',
      description: 'End the registered operative’s guessing turn.',
      inputSchema: schemas.end_turn as JsonSchema,
      execute: async (args: Record<string, unknown>) => {
        requireKeys(args, ['playerHandle']);
        return mutate(requireText(args, 'playerHandle'), { type: 'end_turn' });
      },
    },
    {
      name: 'register',
      description: 'Register as a player in the local SemanticSpy lobby. Team and role are optional.',
      inputSchema: schemas.register as JsonSchema,
      execute: async (args: Record<string, unknown>): Promise<RegistrationResult> => {
        const registration = registrationArgs(args);
        options.controller.syncFromStore();
        const result = options.controller.register(registration.name, registration.team, registration.role);
        await options.refreshHumanBoard?.();
        return result;
      },
    },
  ];

  for (const tool of tools) await host.registerTool(tool);
  return { supported: true, registered: [...toolNames] };
}
