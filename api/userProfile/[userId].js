import { CosmosClient } from "@azure/cosmos";

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const container = client.database("trialquest-db").container("userProfile");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,PATCH,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json"
};

export async function onRequest(context) {
  const { request, params } = context;
  const userId = params.userId;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === "GET") {
    const { resource } = await container.item(userId, userId).read();
    if (!resource) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: corsHeaders
      });
    }
    return new Response(JSON.stringify(resource), { status: 200, headers: corsHeaders });
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const newProfile = {
      id: userId,
      skills: {
        health: 1,
        knowledge: 1,
        relationship: 1,
        action: 1,
        creation: 1
      },
      mtbi: body.mtbi,
      mtbiHistory: body.mtbi ? [{ values: body.mtbi, recordedAt: new Date().toISOString() }] : [],
      lastUpdated: new Date().toISOString()
    };

    await container.items.create(newProfile);
    return new Response(JSON.stringify(newProfile), { status: 201, headers: corsHeaders });
  }

  if (request.method === "PATCH" || request.method === "POST") {
    const body = await request.json();
    const { resource } = await container.item(userId, userId).read();
    if (!resource) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: corsHeaders
      });
    }

    if (body.category) {
      resource.skills[body.category] = (resource.skills[body.category] || 0) + 1;
    }

    if (body.mtbi) {
      resource.mtbi = body.mtbi;
      resource.mtbiHistory = resource.mtbiHistory || [];
      resource.mtbiHistory.push({ values: body.mtbi, recordedAt: new Date().toISOString() });
    }

    resource.lastUpdated = new Date().toISOString();

    await container.item(userId, userId).replace(resource);

    return new Response(JSON.stringify(resource), { status: 200, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: corsHeaders
  });
}
