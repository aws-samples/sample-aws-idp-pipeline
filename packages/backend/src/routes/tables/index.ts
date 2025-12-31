import { Hono } from 'hono';
import { listTables } from './list-tables.js';
import { addTable } from './add-table.js';

const app = new Hono();

app.get('/', ...listTables);
app.post('/', ...addTable);

export default app;
