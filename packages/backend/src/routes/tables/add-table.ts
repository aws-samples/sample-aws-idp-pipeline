import { describeRoute } from 'hono-openapi';
import { createFactory } from 'hono/factory';
import { resolver, validator } from 'hono-openapi';
import * as v from 'valibot';
import { connectLanceDb } from '../../common/lancedb.js';
import { documentSchema } from '../../common/schema.js';

const factory = createFactory();

const addTableInput = v.object({
  name: v.string(),
});

const addTableOutput = v.object({
  name: v.string(),
});

export const addTable = factory.createHandlers(
  describeRoute({
    tags: ['tables'],
    description: 'Create a new table',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: resolver(addTableOutput),
          },
        },
      },
    },
  }),
  validator('json', addTableInput),
  async (c) => {
    const { name } = c.req.valid('json');

    const db = await connectLanceDb();
    await db.createEmptyTable(name, documentSchema);

    return c.json({ name });
  },
);
