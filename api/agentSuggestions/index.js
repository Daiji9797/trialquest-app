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
    urlEnv: 'HEALTH_AGENT_URL',
    keyEnv: 'HEALTH_AGENT_KEY',
    headerEnv: 'HEALTH_AGENT_KEY_HEADER',
  },
  {
    key: 'knowledge',
    name: '知識大陸',
    urlEnv: 'KNOWLEDGE_AGENT_URL',
    keyEnv: 'KNOWLEDGE_AGENT_KEY',
    headerEnv: 'KNOWLEDGE_AGENT_KEY_HEADER',
  },
  {
    key: 'relationship',
    name: '関係大陸',
    urlEnv: 'RELATIONSHIP_AGENT_URL',
    keyEnv: 'RELATIONSHIP_AGENT_KEY',
    headerEnv: 'RELATIONSHIP_AGENT_KEY_HEADER',
  },
  {
    key: 'action',
    name: '行動大陸',
    urlEnv: 'ACTION_AGENT_URL',
    keyEnv: 'ACTION_AGENT_KEY',
    headerEnv: 'ACTION_AGENT_KEY_HEADER',
  },
  {
    key: 'creation',
    name: '創造大陸',
    urlEnv: 'CREATION_AGENT_URL',
    keyEnv: 'CREATION_AGENT_KEY',
    headerEnv: 'CREATION_AGENT_KEY_HEADER',
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

async function invokeConductor(url, input) {
  const apiKey =
    process.env.CONDUCTOR_KEY ||
    process.env.AZURE_FOUNDRY_KEY ||
    process.env.FOUNDRY_API_KEY ||
    null;
  const apiKeyHeader = isAzureFoundryUrl(url) ? 'api-key' : 'x-api-key';

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers[apiKeyHeader] = apiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      userId: input.userId,
      mtbi: input.mtbi,
      answers: input.answers,
      continents: input.continents,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`conductor error: ${response.status} ${text}`.trim());
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  // {suggestions: [{name, action}, ...]}
  if (payload?.suggestions && Array.isArray(payload.suggestions)) {
    return payload.suggestions;
  }
  // [{name, action}, ...]
  if (Array.isArray(payload)) {
    return payload;
  }
  // プレーンテキスト or その他 → 文字列として1件の提案に変換
  const text = normalizeAgentResponse(payload);
  // コンダクターが JSON 文字列を返す場合も考慮してパース試行
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed?.suggestions && Array.isArray(parsed.suggestions)) return parsed.suggestions;
    } catch {
      // パース失敗は無視
    }
    return [{ name: 'コンシェルジュ', action: text }];
  }
  return [];
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

      // コンダクター（council-agent）が設定されている場合は優先して呼び出す
      const conductorUrl = process.env.CONDUCTOR_URL || process.env.COUNCIL_AGENT_URL;
      context.log('conductorUrl:', conductorUrl ? conductorUrl.substring(0, 60) + '...' : 'NOT SET');
      if (conductorUrl) {
        try {
          const suggestions = await invokeConductor(conductorUrl, {
            userId,
            mtbi,
            answers,
            continents: requestedContinents ? [...requestedContinents] : [],
          });
          return {
            status: 200,
            headers: corsHeaders,
            body: JSON.stringify({ suggestions, _source: 'conductor' }),
          };
        } catch (err) {
          context.warn('conductor invoke failed, falling back to individual agents:', err.message);
          // Return conductor error for debugging
          return {
            status: 200,
            headers: corsHeaders,
            body: JSON.stringify({ suggestions: [], _conductorError: err.message }),
          };
        }
      }

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
