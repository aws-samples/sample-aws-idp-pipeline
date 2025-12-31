import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { openAPIRouteHandler } from 'hono-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import tablesRoute from './routes/tables/index.js';

const app = new Hono();

app.use('/*', cors());

app.get(
  '/openapi',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'IDP API',
        version: '0.0.1',
        description: 'IDP Backend API',
      },
      servers: [
        {
          url: '/',
          description: 'Local Server',
        },
      ],
    },
  }),
);

app.get('/docs', swaggerUI({ url: '/openapi' }));

app.route('/tables', tablesRoute);

export default app;
