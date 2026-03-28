import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

function getContainer() {
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  return client.database('trialquest-db').container('answers');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

app.http('answers', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'answers',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    try {
      if (request.method === 'POST') {
        const body = await request.json();
        body.createdAt = new Date().toISOString();
        await getContainer().items.create(body);
        return {
          status: 201,
          body: JSON.stringify(body),
          headers: corsHeaders,
        };
      }

      if (request.method === 'GET') {
        const userId = request.query.get('userId');
        const querySpec = {
          query: 'SELECT * FROM c WHERE c.userId = @userId',
          parameters: [{ name: '@userId', value: userId }],
        };
        const { resources } = await getContainer().items.query(querySpec).fetchAll();
        return {
          status: 200,
          body: JSON.stringify(resources),
          headers: corsHeaders,
        };
      }

      return {
        status: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
        headers: corsHeaders,
      };
    } catch (err) {
      context.error('answers handler error:', err);
      return {
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
        headers: corsHeaders,
      };
    }
  },
});
