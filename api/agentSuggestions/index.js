import { app } from '@azure/functions';

const FUNC_URL = process.env.AGENT_FUNC_URL;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

app.http('agentSuggestions', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'agentSuggestions',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') return { status: 204, headers: corsHeaders };

    const body = await request.text();
    let res;
    try {
      res = await fetch(FUNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      context.error('[proxy] fetch error:', err.message);
      return { status: 502, body: JSON.stringify({ error: err.message }), headers: corsHeaders };
    }

    context.log('[proxy] upstream status:', res.status);
    const data = await res.text();
    return { status: res.status, body: data, headers: corsHeaders };
  },
});
