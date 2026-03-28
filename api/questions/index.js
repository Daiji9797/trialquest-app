import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

function getContainer() {
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  return client.database('trialquest-db').container('questions');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

app.http('questions', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'questions',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    try {
      const category = request.query.get('category');
      let querySpec;
      if (category) {
        querySpec = {
          query: 'SELECT * FROM c WHERE c.category = @category',
          parameters: [{ name: '@category', value: category }],
        };
      } else {
        querySpec = { query: 'SELECT * FROM c' };
      }

      const { resources } = await getContainer().items.query(querySpec).fetchAll();
      return {
        status: 200,
        body: JSON.stringify(resources),
        headers: corsHeaders,
      };
    } catch (err) {
      context.error('questions handler error:', err);
      return {
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
        headers: corsHeaders,
      };
    }
  },
});
