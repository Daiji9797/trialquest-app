const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const CONTINENT_NAMES = {
  health: '健康大陸',
  knowledge: '知識大陸',
  relationship: '関係大陸',
  action: '行動大陸',
  creation: '創造大陸',
};

// 各大陸に対応する Foundry エージェント名（env var でオーバーライド可）
const CONTINENT_APPS = {
  health:       process.env.HEALTH_APP        || 'health-agent',
  knowledge:    process.env.KNOWLEDGE_APP     || 'knowledge-agent',
  relationship: process.env.RELATIONSHIP_APP  || 'relationship-agent',
  action:       process.env.ACTION_APP        || 'action-agent',
  creation:     process.env.CREATION_APP      || 'creation-agent',
};

// エージェント定義キャッシュ（TTL: 5分）
const _agentCache = {};
const _CACHE_TTL = 5 * 60 * 1000;

// Foundry からエージェント定義（instructions + model）を取得してキャッシュ
async function getAgentDefinition(continentKey, context) {
  const agentName = CONTINENT_APPS[continentKey];
  const cached = _agentCache[continentKey];
  if (cached && Date.now() - cached.ts < _CACHE_TTL) return cached;

  const baseEndpoint = process.env.OPENAI_ENDPOINT || 'https://trialquestopenai.services.ai.azure.com';
  const projectName  = process.env.FOUNDRY_PROJECT  || 'trialquestopenai-project';
  const url = baseEndpoint + '/api/projects/' + projectName + '/agents/' + agentName + '?api-version=2025-05-15-preview';

  const token = await getManagedIdentityToken('https://ai.azure.com', context);
  if (!token) throw new Error('MI token failed for agent definition fetch');

  // Helper: extract instructions+model from an agent object
  const extract = (d) => ({
    instructions: d.instructions
      || (d.versions && d.versions.latest && d.versions.latest.definition && d.versions.latest.definition.instructions)
      || '',
    model: d.model
      || (d.versions && d.versions.latest && d.versions.latest.definition && d.versions.latest.definition.model)
      || '',
  });

  // Helper: fetch detail by ID
  const fetchById = async (id, tkn) => {
    const u = baseEndpoint + '/api/projects/' + projectName + '/agents/' + id + '?api-version=2025-05-15-preview';
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tkn } });
    if (!r.ok) { if (context) context.log('fetchById failed', id, r.status); return null; }
    return r.json();
  };

  // --- Attempt 1: Foundry project API (ai.azure.com token) ---
  let instructions = '';
  let model = '';
  const aiToken = await getManagedIdentityToken('https://ai.azure.com', context);
  if (aiToken) {
    // 1a: direct fetch by name
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + aiToken } });
    if (res.ok) {
      const d = await res.json();
      if (context) context.log('[def] direct OK keys:', Object.keys(d).join(','), 'body:', JSON.stringify(d).substring(0, 300));
      const ex = extract(d);
      if (ex.instructions) { instructions = ex.instructions; model = ex.model; }
      else if (d.id) {
        // 1b: direct had no instructions, fetch detail by ID
        const d2 = await fetchById(d.id, aiToken);
        if (d2) { const ex2 = extract(d2); instructions = ex2.instructions; model = ex2.model; }
        if (context) context.log('[def] detail by id instructions.len=', instructions.length);
      }
    } else {
      const errText = await res.text().catch(() => '');
      if (context) context.log('[def] direct failed', res.status, errText.substring(0, 300));
    }

    // 1c: if still no instructions, list all agents
    if (!instructions) {
      const listUrl = baseEndpoint + '/api/projects/' + projectName + '/agents?api-version=2025-05-15-preview';
      const listRes = await fetch(listUrl, { headers: { Authorization: 'Bearer ' + aiToken } });
      if (listRes.ok) {
        const listData = await listRes.json();
        if (context) context.log('[def] list OK body:', JSON.stringify(listData).substring(0, 400));
        const agents = listData.value || listData.data || listData.agents || listData.items || [];
        if (context) context.log('[def] list count:', agents.length, 'names:', agents.map(a => a.name).join(','));
        const found = agents.find(a => a.name === agentName);
        if (found) {
          const ex3 = extract(found);
          if (ex3.instructions) { instructions = ex3.instructions; model = ex3.model; }
          else if (found.id) {
            // fetch detail by the found ID
            const d3 = await fetchById(found.id, aiToken);
            if (d3) { if (context) context.log('[def] list detail body:', JSON.stringify(d3).substring(0, 300)); const ex4 = extract(d3); instructions = ex4.instructions; model = ex4.model; }
            if (context) context.log('[def] detail from list id instructions.len=', instructions.length);
          }
        } else {
          if (context) context.log('[def] agent not found in list. available:', agents.map(a=>a.name).join(','));
        }
      } else {
        const le = await listRes.text().catch(() => '');
        if (context) context.log('[def] list failed', listRes.status, le.substring(0, 200));
      }
    }
  }

  // --- Attempt 2: Azure OpenAI Assistants API (cognitiveservices token) ---
  if (!instructions) {
    const cogToken = await getManagedIdentityToken('https://cognitiveservices.azure.com', context);
    if (cogToken) {
      const aoaiListUrl = baseEndpoint + '/openai/assistants?api-version=2024-05-01-preview';
      const aoaiRes = await fetch(aoaiListUrl, { headers: { Authorization: 'Bearer ' + cogToken } });
      if (aoaiRes.ok) {
        const aoaiData = await aoaiRes.json();
        if (context) context.log('[def] AOAI assistants body:', JSON.stringify(aoaiData).substring(0, 400));
        const aoaiAgents = aoaiData.data || aoaiData.value || [];
        const aoaiFound = aoaiAgents.find(a => a.name === agentName);
        if (aoaiFound) { const ex5 = extract(aoaiFound); instructions = ex5.instructions; model = ex5.model; }
        if (context) context.log('[def] AOAI found:', !!aoaiFound, 'instructions.len=', instructions.length);
      } else {
        const ae = await aoaiRes.text().catch(() => '');
        if (context) context.log('[def] AOAI list failed', aoaiRes.status, ae.substring(0, 200));
      }
    }
  }

  if (context) context.log('[def] FINAL for', agentName, 'instructions.len=', instructions.length, 'model=', model);
  const entry = { instructions, model, ts: Date.now() };
  _agentCache[continentKey] = entry;
  return entry;
}

async function getManagedIdentityToken(resource, context) {
  const endpoint = process.env.IDENTITY_ENDPOINT || process.env.MSI_ENDPOINT;
  const secret = process.env.IDENTITY_HEADER || process.env.MSI_SECRET;
  if (!endpoint || !secret) { if (context) context.log('MI: no endpoint/secret'); return null; }
  const url = endpoint + '?resource=' + encodeURIComponent(resource) + '&api-version=2019-08-01';
  if (context) context.log('MI: fetching token for', resource);
  const res = await fetch(url, { headers: { 'X-IDENTITY-HEADER': secret } });
  if (!res.ok) { if (context) context.log('MI: token fetch failed', res.status); return null; }
  const data = await res.json();
  if (context) context.log('MI: got token, length=', (data.access_token || '').length);
  return data.access_token || null;
}

// 単一大陸: Foundry からエージェント定義（instructions + model）を取得して Chat Completions で実行
async function callSingleAgent(continentKey, input, context, _debug) {
  const baseEndpoint = process.env.OPENAI_ENDPOINT || 'https://trialquestopenai.services.ai.azure.com';

  // Foundry エージェント定義から instructions と model を取得（5分キャッシュ）
  let systemPrompt = null;
  try {
    const agentDef = await getAgentDefinition(continentKey, context);
    systemPrompt = agentDef.instructions || null;
    if (_debug) _debug.push('instructions:' + (systemPrompt ? 'from-foundry:len=' + systemPrompt.length : 'empty'));
  } catch (e) {
    if (context) context.log('[single] getAgentDefinition error:', e.message);
    if (_debug) _debug.push('instructions-fetch-error:' + e.message);
  }
  if (!systemPrompt) {
    if (context) context.log('[single] No Foundry instructions for', continentKey, '- using default prompt');
    if (_debug) _debug.push('instructions:default-fallback');
    systemPrompt = 'あなたは' + (CONTINENT_NAMES[continentKey] || continentKey) + 'のAIエージェントです。ユーザーのMBTIタイプと質問への回答をもとに、具体的で実行しやすい行動提案を3つ考えてください。必ずJSON配列 [{"name":"大陸名","action":"提案内容"},...] の形式のみで返してください。余分な説明は不要です。';
  }

  // Foundry 定義の model を優先し、未設定の場合は env var / デフォルト値にフォールバック
  const deployment = agentDef.model || process.env.CHAT_DEPLOYMENT || 'gpt-4o-mini';
  const url = baseEndpoint + '/openai/deployments/' + deployment + '/chat/completions?api-version=2024-12-01-preview';

  const continentLabel = CONTINENT_NAMES[continentKey] || continentKey;
  const interestsLine = input.interests ? '\n今興味があること: ' + input.interests : '';
  const userMessage = 'ユーザーMBTI: ' + JSON.stringify(input.mtbi) +
    '\n選択した大陸: ' + continentLabel +
    interestsLine +
    '\n回答: ' + JSON.stringify(input.answers || []);

  const body = JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.8,
    max_tokens: 1024,
  });

  const token = await getManagedIdentityToken('https://cognitiveservices.azure.com', context);
  if (!token) throw new Error('MI token for cognitiveservices.azure.com failed');

  if (context) context.log('Calling single agent via Chat Completions:', continentKey, 'model=', deployment);
  if (_debug) _debug.push('mode:single-agent-foundry-instructions:' + continentKey + ':model=' + deployment);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (_debug) _debug.push('error:' + response.status);
    throw new Error('Chat API error: ' + response.status + ' ' + text.substring(0, 200));
  }

  const data = await response.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (context) context.log('Single agent response (first 500):', content.substring(0, 500));
  if (_debug) _debug.push('agent:' + continentKey + ':instructions-from-foundry');

  return parseAgentResponse(content, continentLabel, context);
}

// 2大陸以上: Conductor Application endpointで統合
async function callConductor(input, context, _debug) {
  const baseEndpoint = process.env.OPENAI_ENDPOINT || 'https://trialquestopenai.services.ai.azure.com';
  const projectName = process.env.FOUNDRY_PROJECT || 'trialquestopenai-project';
  const appName = process.env.FOUNDRY_APP || 'council-agent';
  const apiVersion = process.env.APP_API_VERSION || '2025-11-15-preview';
  const url = baseEndpoint + '/api/projects/' + projectName + '/applications/' + appName + '/protocols/openai/responses?api-version=' + apiVersion;

  const token = await getManagedIdentityToken('https://ai.azure.com', context);
  if (!token) throw new Error('MI token for ai.azure.com failed');
  if (_debug) _debug.push('auth:MI-Bearer-ai.azure.com(len=' + token.length + ')');

  const continentLabels = (input.continents || []).map(c => CONTINENT_NAMES[c] || c).join(', ');
  const interestsLine = input.interests ? '\n今興味があること: ' + input.interests : '';
  const userMessage = 'ユーザーMBTI: ' + JSON.stringify(input.mtbi) +
    '\n選択した大陸: ' + (continentLabels || '全て') +
    interestsLine +
    '\n回答: ' + JSON.stringify(input.answers || []);

  const body = JSON.stringify({ input: userMessage, model: 'gpt-4o-mini' });

  if (context) context.log('Calling Conductor:', url.substring(0, 100));
  if (_debug) _debug.push('mode:conductor');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (_debug) _debug.push('error:' + response.status);
    throw new Error('Application API error: ' + response.status + ' ' + text.substring(0, 200));
  }

  const data = await response.json();
  let content = '';
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && item.content) {
        for (const c of item.content) {
          if (c.type === 'output_text' && c.text) content += c.text;
        }
      }
    }
  }

  if (context) context.log('Conductor response (first 500):', (content || '').substring(0, 500));
  if (_debug) _debug.push('agent:' + (data.agent && data.agent.name || 'unknown') + ':v' + (data.agent && data.agent.version || '?'));

  return parseAgentResponse(content, null, context);
}

function sanitizeJsonNewlines(str) {
  let result = '';
  let inString = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\' && inString) { result += c + str[++i]; continue; }
    if (c === '"') { inString = !inString; result += c; continue; }
    if (inString && (c === '\n' || c === '\r')) { result += '\\n'; continue; }
    result += c;
  }
  return result;
}

function parseAgentResponse(content, fallbackName, context) {
  if (!content) return [];
  const stripLeadingNumber = (arr) => arr.map(item => ({
    ...item,
    action: (item.action || '').replace(/^\d+\.\s*/, ''),
  }));
  const tryParse = (str) => {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return stripLeadingNumber(parsed);
    if (parsed && parsed.suggestions && Array.isArray(parsed.suggestions)) return stripLeadingNumber(parsed.suggestions);
    return null;
  };
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    }
    // 1回目: そのままパース
    try {
      const result = tryParse(cleaned);
      if (result) return result;
    } catch (e1) {
      // 2回目: 文字列内の実改行をエスケープしてパース
      const result = tryParse(sanitizeJsonNewlines(cleaned));
      if (result) return result;
    }
  } catch (e) {
    if (context) context.log('JSON parse failed, wrapping as text');
  }
  return [{ name: fallbackName || 'AIアドバイス', action: content }];
}

async function callConductorSummary(suggestions, input, context) {
  const baseEndpoint = process.env.OPENAI_ENDPOINT || 'https://trialquestopenai.services.ai.azure.com';
  const deployment = process.env.CHAT_DEPLOYMENT || 'gpt-4o-mini';
  const url = baseEndpoint + '/openai/deployments/' + deployment + '/chat/completions?api-version=2024-12-01-preview';
  const token = await getManagedIdentityToken('https://cognitiveservices.azure.com', context);
  if (!token) return null;
  const continentLabels = (input.continents || []).map(c => CONTINENT_NAMES[c] || c).join('、');
  const sugText = suggestions.map(s => `[${s.name}] ${s.action}`).join('\n');
  const systemPrompt = 'あなたはコンダクター（指揮者）です。複数の大陸エージェントからの提案を受け取り、ユーザーへの統合メッセージを作成します。\n提案全体を2〜3文で統合し、「まず何から取り組むべきか」と「それがなぜあなたに合っているか」を伝えてください。\n日本語で。自然な文章で回答してください（JSON不要）。';
  const userMessage = `MBTI: ${JSON.stringify(input.mtbi)}\n選択した大陸: ${continentLabels}\n\n各エージェントからの提案:\n${sugText}`;
  const body = JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], temperature: 0.7, max_tokens: 300 });
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body });
  if (!response.ok) { if (context) context.log('conductorSummary API failed:', response.status); return null; }
  const data = await response.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return content.trim() || null;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  try {
    const body = req.body || {};
    const mtbi = body.mtbi || null;
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const continents = Array.isArray(body.continents) ? body.continents : [];
    const interests = typeof body.interests === 'string' ? body.interests.substring(0, 500) : '';

    const _debug = [];
    if (context) context.log('Processing agentSuggestions: continents=' + continents.join(','));

    let suggestions;
    if (continents.length === 1 && CONTINENT_APPS[continents[0]]) {
      // 1大陸 → Foundry の各大陸エージェント Application を呼び出す
      suggestions = await callSingleAgent(continents[0], { mtbi, answers, interests }, context, _debug);
    } else {
      // 0大陸(全て) or 2大陸以上 → Conductor が統合回答
      suggestions = await callConductor({ mtbi, answers, continents, interests }, context, _debug);
    }

    const source = continents.length === 1 ? 'singleAgent:' + continents[0] : 'conductor';
    let conductorSummary = null;
    if (continents.length !== 1 && suggestions.length > 0) {
      try { conductorSummary = await callConductorSummary(suggestions, { mtbi, answers, continents }, context); } catch (e) { if (context) context.log('conductorSummary failed:', e.message); }
    }
    return { status: 200, headers: corsHeaders, body: JSON.stringify({ suggestions, conductorSummary, _source: source, _debug }) };
  } catch (err) {
    context.log.error('agentSuggestions error:', err);
    return { status: 200, headers: corsHeaders, body: JSON.stringify({ suggestions: [], _error: err.message }) };
  }
};
