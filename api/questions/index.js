import { CosmosClient } from "@azure/cosmos";

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const container = client.database("trialquest-db").container("questions");

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const category = url.searchParams.get("category");

  let query = "SELECT * FROM c";
  if (category) {
    query = `SELECT * FROM c WHERE c.category = "${category}"`;
  }

  const { resources } = await container.items.query(query).fetchAll();
  return new Response(JSON.stringify(resources), { status: 200 });
}
