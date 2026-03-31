import { app } from '@azure/functions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const AGENT_CONFIG = [
  {
    key: 'health',
    name: '健康大陸',
    urlEnv: 'AGENT_HEALTH_URL',
    keyEnv: 'AGENT_HEALTH_KEY',
    headerEnv: 'AGENT_HEALTH_KEY_HEADER',
  },
  {
    key: 'knowledge',
    name: '知識大陸',
    urlEnv: 'AGENT_KNOWLEDGE_URL',
    keyEnv: 'AGENT_KNOWLEDGE_KEY',
    headerEnv: 'AGENT_KNOWLEDGE_KEY_HEADER',
  },
  {
    key: 'relationship',
    name: '関係大陸',
    urlEnv: 'AGENT_RELATIONSHIP_URL',
    keyEnv: 'AGENT_RELATIONSHIP_KEY',
    headerEnv: 'AGENT_RELATIONSHIP_KEY_HEADER',
  },
  {
    key: 'action',
    name: '行動大陸',
    urlEnv: 'AGENT_ACTION_URL',
    keyEnv: 'AGENT_ACTION_KEY',
    headerEnv: 'AGENT_ACTION_KEY_HEADER',
  },
  {
    key: 'creation',
    name: '創造大陸',
    urlEnv: 'AGENT_CREATION_URL',
    keyEnv: 'AGENT_CREATION_KEY',
    headerEnv: 'AGENT_CREATION_KEY_HEADER',
  },
];

function isAzureFoundryUrl(url) {
  if (!url) return false;
  return /\.services\.ai\.azure\.com|\.openai\.azure\.com/i.test(url);
}

function normalizeAgentResponse(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload.action === 'string') return payload.action;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.output === 'string') return payload.output;
  if (Array.isArray(payload.messages)) {
    const msg = payload.messages.find((m) => typeof m?.content === 'string');
    if (msg) return msg.content;
  }
  return JSON.stringify(payload);
}

async function invokeAgent(config, input) {
  const url = process.env[config.urlEnv];
  if (!url) return null;

  const apiKey =
    process.env[config.keyEnv] ||
    process.env.AZURE_FOUNDRY_KEY ||
    process.env.FOUNDRY_API_KEY ||
    null;
  const apiKeyHeader =
    process.env[config.headerEnv] || (isAzureFoundryUrl(url) ? 'api-key' : 'x-api-key');

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers[apiKeyHeader] = apiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      continent: {
        key: config.key,
        name: config.name,
      },
      userId: input.userId,
      mtbi: input.mtbi,
      answers: input.answers,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${config.key} agent error: ${response.status} ${text}`.trim());
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    return normalizeAgentResponse(json);
  }

  return normalizeAgentResponse(await response.text());
}

app.http('agentSuggestions', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'agentSuggestions',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    try {
      const body = await request.json().catch(() => ({}));
      const mtbi = body?.mtbi || null;
      const answers = Array.isArray(body?.answers) ? body.answers : [];
      const userId = body?.userId || null;
      const requestedContinents = Array.isArray(body?.continents)
        ? new Set(body.continents.map((x) => String(x)))
        : null;

      const activeAgents = AGENT_CONFIG.filter(
        (cfg) =>
          !!process.env[cfg.urlEnv] &&
          (!requestedContinents || requestedContinents.has(cfg.key))
      );
      if (activeAgents.length === 0) {
        return {
          status: 200,
          headers: corsHeaders,
          body: JSON.stringify({ suggestions: [] }),
        };
      }

      const settled = await Promise.allSettled(
        activeAgents.map((cfg) => invokeAgent(cfg, { userId, mtbi, answers }))
      );

      const suggestions = [];
      const errors = [];

      for (let i = 0; i < activeAgents.length; i += 1) {
        const cfg = activeAgents[i];
        const result = settled[i];
        if (result.status === 'fulfilled' && result.value) {
          suggestions.push({ name: cfg.name, action: result.value });
        } else if (result.status === 'rejected') {
          errors.push({ agent: cfg.key, error: result.reason?.message || 'unknown error' });
          context.warn('agentSuggestions invoke failed', cfg.key, result.reason);
        }
      }

      if (suggestions.length === 0) {
        return {
          status: 200,
          headers: corsHeaders,
          body: JSON.stringify({ suggestions: [], errors }),
        };
      }

      return {
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ suggestions, errors }),
      };
    } catch (err) {
      context.error('agentSuggestions handler error:', err);
      return {
        status: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: err?.message || 'Internal server error' }),
      };
    }
  },
});
