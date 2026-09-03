/** Strict input schemas shared by browser WebMCP registration and tests. */
export const schemas = {
  learn_rules: {
    type: 'object' as const, properties: {}, required: [], additionalProperties: false,
  },
  get_context: {
    type: 'object' as const, properties: {}, required: [], additionalProperties: false,
  },
  get_state: {
    type: 'object' as const,
    properties: { playerHandle: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['playerHandle'], additionalProperties: false,
  },
  submit_clue: {
    type: 'object' as const, properties: {
      playerHandle: { type: 'string', minLength: 1, maxLength: 200 },
      clue: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z]+$' },
      count: { type: 'integer', minimum: 1, maximum: 9 },
    }, required: ['playerHandle', 'clue', 'count'], additionalProperties: false,
  },
  make_guess: {
    type: 'object' as const, properties: {
      playerHandle: { type: 'string', minLength: 1, maxLength: 200 },
      word: { type: 'string', minLength: 1, maxLength: 40 },
    }, required: ['playerHandle', 'word'], additionalProperties: false,
  },
  end_turn: {
    type: 'object' as const,
    properties: { playerHandle: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['playerHandle'], additionalProperties: false,
  },
  register: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 40 },
      team: { type: 'string', enum: ['blue', 'red'] },
      role: { type: 'string', enum: ['spymaster', 'operative'] },
    },
    required: ['name'], additionalProperties: false,
  },
};

export type SchemaName = keyof typeof schemas;
