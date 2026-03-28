import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

const memoryProfiles = new Map();

function getContainerOrNull() {
  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (!connectionString) {
    return null;
  }

  const client = new CosmosClient(connectionString);
  return client.database('trialquest-db').container('userProfile');
}

async function readProfile(container, userId) {
  const querySpec = {
    query: 'SELECT TOP 1 * FROM c WHERE c.id = @userId OR c.userId = @userId',
    parameters: [{ name: '@userId', value: userId }],
  };

  const { resources } = await container.items.query(querySpec).fetchAll();
  return resources[0] || null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

app.http('userProfile', {
  methods: ['GET', 'PUT', 'POST', 'PATCH', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'userProfile/{userId}',
  handler: async (request, context) => {
    const userId = request.params.userId;
    const container = getContainerOrNull();

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    try {
      if (request.method === 'GET') {
        const resource = container ? await readProfile(container, userId) : memoryProfiles.get(userId) || null;
        if (!resource) {
          return {
            status: 404,
            body: JSON.stringify({ error: 'Not found' }),
            headers: corsHeaders,
          };
        }
        return {
          status: 200,
          body: JSON.stringify(resource),
          headers: corsHeaders,
        };
      }

      if (request.method === 'PUT') {
        const body = await request.json().catch(() => ({}));
        const newProfile = {
          id: userId,
          userId,
          skills: { health: 1, knowledge: 1, relationship: 1, action: 1, creation: 1 },
          mtbi: body.mtbi || null,
          mtbiHistory: body.mtbi
            ? [{ values: body.mtbi, recordedAt: new Date().toISOString() }]
            : [],
          lastUpdated: new Date().toISOString(),
        };

        if (container) {
          await container.items.upsert(newProfile);
        } else {
          memoryProfiles.set(userId, newProfile);
        }

        return {
          status: 201,
          body: JSON.stringify(newProfile),
          headers: corsHeaders,
        };
      }

      if (request.method === 'POST' || request.method === 'PATCH') {
        const body = await request.json();
        const resource = container ? await readProfile(container, userId) : memoryProfiles.get(userId) || null;
        if (!resource) {
          return {
            status: 404,
            body: JSON.stringify({ error: 'Not found' }),
            headers: corsHeaders,
          };
        }

        if (body.category) {
          resource.skills = resource.skills || {};
          resource.skills[body.category] = (resource.skills[body.category] || 0) + 1;
        }

        if (body.mtbi) {
          resource.mtbi = body.mtbi;
          resource.mtbiHistory = resource.mtbiHistory || [];
          resource.mtbiHistory.push({ values: body.mtbi, recordedAt: new Date().toISOString() });
        }

        resource.userId = userId;
        resource.lastUpdated = new Date().toISOString();

        if (container) {
          await container.items.upsert(resource);
        } else {
          memoryProfiles.set(userId, resource);
        }

        return {
          status: 200,
          body: JSON.stringify(resource),
          headers: corsHeaders,
        };
      }

      return {
        status: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
        headers: corsHeaders,
      };
    } catch (err) {
      context.error('userProfile handler error:', err);
      return {
        status: 500,
        body: JSON.stringify({ error: err?.message || 'Internal server error' }),
        headers: corsHeaders,
      };
    }
  },
});
