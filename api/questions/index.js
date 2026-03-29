import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

function getContainer() {
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  return client.database('trialquest-db').container('questions');
}

function getAnswersContainer() {
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  return client.database('trialquest-db').container('answers');
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
      const userId = request.query.get('userId');
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

      if (!userId) {
        return {
          status: 200,
          body: JSON.stringify(resources),
          headers: corsHeaders,
        };
      }

      const answerQuery = {
        query: 'SELECT c.questionId FROM c WHERE c.userId = @userId',
        parameters: [{ name: '@userId', value: userId }],
      };
      const { resources: answerResources } = await getAnswersContainer().items
        .query(answerQuery)
        .fetchAll();

      const answeredQuestionIds = new Set(
        answerResources.map((item) => String(item.questionId))
      );
      const questionsWithAnswered = resources.map((question) => ({
        ...question,
        answered: answeredQuestionIds.has(String(question.id)),
      }));

      return {
        status: 200,
        body: JSON.stringify(questionsWithAnswered),
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
