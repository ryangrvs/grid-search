/** Input schemas shared by HTTP, MCP, and browser tool registration. */
export const schemas = {
  get_board: {
    type: 'object' as const, properties: {}, required: [], additionalProperties: false,
  },
  submit_clue: {
    type: 'object' as const, properties: {
      clue: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z]+$' },
      count: { type: 'integer', minimum: 1, maximum: 9 },
    }, required: ['clue', 'count'], additionalProperties: false,
  },
  make_guess: {
    type: 'object' as const, properties: { word: { type: 'string', minLength: 1, maxLength: 40 } },
    required: ['word'], additionalProperties: false,
  },
  end_turn: { type: 'object' as const, properties: {}, required: [], additionalProperties: false },
};

export type SchemaName = keyof typeof schemas;
