import { describeRoute } from 'hono-openapi';
import { createFactory } from 'hono/factory';
import { resolver } from 'hono-openapi';
import * as v from 'valibot';
import { connectLanceDb } from '../../common/lancedb.js';

const factory = createFactory();

const listTablesOutput = v.array(v.string());

export const listTables = factory.createHandlers(
  describeRoute({
    tags: ['tables'],
    description: 'Returns a list of tables',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: resolver(listTablesOutput),
          },
        },
      },
    },
  }),
  async (c) => {
    const db = await connectLanceDb();

    const tables = await db.tableNames();
    return c.json(tables);
  },
);
