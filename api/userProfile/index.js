import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const container = client.database('trialquest-db').container('userProfile');

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

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    try {
      if (request.method === 'GET') {
        const { resource } = await container.item(userId, userId).read();
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
          skills: { health: 1, knowledge: 1, relationship: 1, action: 1, creation: 1 },
          mtbi: body.mtbi || null,
          mtbiHistory: body.mtbi
            ? [{ values: body.mtbi, recordedAt: new Date().toISOString() }]
            : [],
          lastUpdated: new Date().toISOString(),
        };
        await container.items.create(newProfile);
        return {
          status: 201,
          body: JSON.stringify(newProfile),
          headers: corsHeaders,
        };
      }

      if (request.method === 'POST' || request.method === 'PATCH') {
        const body = await request.json();
        const { resource } = await container.item(userId, userId).read();
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

        resource.lastUpdated = new Date().toISOString();
        await container.item(userId, userId).replace(resource);
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
        body: JSON.stringify({ error: 'Internal server error' }),
        headers: corsHeaders,
      };
    }
  },
});
