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

function makeAnswerId(userId, questionId) {
  return `${String(userId)}:${String(questionId)}`;
}

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
        const userId = body?.userId;
        const questionId = body?.questionId;
        const answerText = body?.answer;

        if (!userId || !questionId || typeof answerText !== 'string') {
          return {
            status: 400,
            body: JSON.stringify({
              error: 'userId, questionId, and answer(string) are required',
            }),
            headers: corsHeaders,
          };
        }

        const now = new Date().toISOString();
        const resource = {
          id: makeAnswerId(userId, questionId),
          userId,
          questionId,
          questionTitle: body?.questionTitle || '',
          question: body?.question || '',
          answer: answerText,
          createdAt: body?.createdAt || now,
          updatedAt: now,
        };

        await getContainer().items.upsert(resource);
        return {
          status: 200,
          body: JSON.stringify(resource),
          headers: corsHeaders,
        };
      }

      if (request.method === 'GET') {
        const userId = request.query.get('userId');
        if (!userId) {
          return {
            status: 400,
            body: JSON.stringify({ error: 'userId query is required' }),
            headers: corsHeaders,
          };
        }

        const questionId = request.query.get('questionId');
        const querySpec = {
          query: questionId
            ? 'SELECT * FROM c WHERE c.userId = @userId AND c.questionId = @questionId'
            : 'SELECT * FROM c WHERE c.userId = @userId',
          parameters: questionId
            ? [
                { name: '@userId', value: userId },
                { name: '@questionId', value: questionId },
              ]
            : [{ name: '@userId', value: userId }],
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
