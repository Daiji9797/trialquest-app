import { CosmosClient } from "@azure/cosmos";

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const container = client.database("trialquest-db").container("questions");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json"
};

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders
    });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");

  let query = "SELECT * FROM c";
  if (category) {
    query = `SELECT * FROM c WHERE c.category = "${category}"`;
  }

  const { resources } = await container.items.query(query).fetchAll();
  return new Response(JSON.stringify(resources), { status: 200, headers: corsHeaders });
}
