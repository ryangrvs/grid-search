import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Game } from './game';
import { parseTool, schemas } from './contracts';

export const BOARD_URI = 'semanticspy://game/board';
export function createGameMcp(game: Game): Server {
  const server = new Server({ name: 'semanticspy', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: BOARD_URI, name: 'SemanticSpy board', mimeType: 'application/json', description: 'Public grid; add ?role=spymaster for the authenticated agent Spymaster view.' }] }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ uriTemplate: `${BOARD_URI}{?role}`, name: 'Authorized role board', mimeType: 'application/json', description: 'role=spymaster requires authenticated agent to actually hold that role.' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const uri = new URL(params.uri);
    if (`${uri.protocol}//${uri.host}${uri.pathname}` !== BOARD_URI || uri.hash || [...uri.searchParams.keys()].some((key) => key !== 'role') || uri.searchParams.getAll('role').length > 1) throw new Error('Unknown board resource');
    const role = uri.searchParams.get('role');
    if (role && role !== 'spymaster') throw new Error('Unknown role view');
    if (role === 'spymaster' && game.view('agent').agentRole !== 'spymaster') throw new Error('This agent is not the Spymaster');
    const board = game.getBoard('agent');
    const result = role === 'spymaster' || board.status !== 'playing' ? board : { ...board, cards: board.cards.map(({ alignment, ...card }) => card.revealed ? { ...card, alignment } : card) };
    return { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(result) }] };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(schemas).map(([name, inputSchema]) => ({ name, inputSchema, description: name === 'get_board' ? 'Read current agent-authorized board before EVERY move.' : `${name}: act for the agent, only after reading the current board.`, annotations: { readOnlyHint: name === 'get_board', destructiveHint: false, openWorldHint: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const action = parseTool(params.name, params.arguments ?? {});
      const board = action ? game.act('agent', action) : game.getBoard('agent');
      const result = { uri: BOARD_URI, board };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Game move rejected' }] };
    }
  });
  return server;
}
