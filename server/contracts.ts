import type { Action, Role } from '../shared/types';

export { schemas } from '../shared/schemas';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) {
    throw new Error(`Expected exactly: ${allowed.join(', ') || 'no arguments'}`);
  }
}
export function parseTool(name: string, input: unknown): Action | null {
  const args = object(input);
  switch (name) {
    case 'get_board': keys(args, []); return null;
    case 'submit_clue': {
      keys(args, ['clue', 'count']);
      if (typeof args.clue !== 'string' || !/^[A-Za-z]+$/.test(args.clue) || args.clue.length > 40) throw new Error('Clue must be one word of 1–40 letters');
      if (typeof args.count !== 'number' || !Number.isInteger(args.count) || args.count < 1 || args.count > 9) throw new Error('Count must be an integer from 1 to 9');
      return { type: 'submit_clue', clue: args.clue, count: args.count };
    }
    case 'make_guess':
      keys(args, ['word']);
      if (typeof args.word !== 'string' || !args.word.trim() || args.word.length > 40) throw new Error('Word must contain 1–40 characters');
      return { type: 'make_guess', word: args.word.trim() };
    case 'end_turn': keys(args, []); return { type: 'end_turn' };
    default: throw new Error('Unknown game tool');
  }
}
export function parseAction(input: unknown): Action {
  const { type, ...args } = object(input);
  if (typeof type !== 'string' || type === 'get_board') throw new Error('Unknown action');
  const action = parseTool(type, args);
  if (!action) throw new Error('Unknown action');
  return action;
}
export function parseRole(input: unknown): Role {
  const args = object(input); keys(args, ['humanRole']);
  if (args.humanRole !== 'operative' && args.humanRole !== 'spymaster') throw new Error('Invalid human role');
  return args.humanRole;
}
