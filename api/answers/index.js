import { CosmosClient } from "@azure/cosmos";

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const container = client.database("trialquest-db").container("answers");

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "POST") {
    const body = await request.json();
    body.createdAt = new Date().toISOString();

    await container.items.create(body);
    return new Response(JSON.stringify(body), { status: 201 });
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");

    const query = `SELECT * FROM c WHERE c.userId = "${userId}"`;
    const { resources } = await container.items.query(query).fetchAll();

    return new Response(JSON.stringify(resources), { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
}
