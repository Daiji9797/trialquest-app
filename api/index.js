import { app } from '@azure/functions';
import './questions/index.js';
import './answers/index.js';
import './userProfile/index.js';

// Diagnostic endpoint - no DB dependency
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => ({
    status: 200,
    body: JSON.stringify({ status: 'ok', ts: new Date().toISOString() }),
    headers: { 'Content-Type': 'application/json' },
  }),
});
