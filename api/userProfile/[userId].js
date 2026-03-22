import { CosmosClient } from "@azure/cosmos";

const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
const container = client.database("trialquest-db").container("userProfile");

export async function onRequest(context) {
  const { request, params } = context;
  const userId = params.userId;

  if (request.method === "GET") {
    const { resource } = await container.item(userId, userId).read();
    return new Response(JSON.stringify(resource), { status: 200 });
  }

  if (request.method === "PUT") {
    const newProfile = {
      id: userId,
      skills: {
        health: 1,
        knowledge: 1,
        relationship: 1,
        action: 1,
        creation: 1
      },
      lastUpdated: new Date().toISOString()
    };

    await container.items.create(newProfile);
    return new Response(JSON.stringify(newProfile), { status: 201 });
  }

  if (request.method === "PATCH") {
    const body = await request.json();
    const category = body.category;

    const { resource } = await container.item(userId, userId).read();
    resource.skills[category] += 1;
    resource.lastUpdated = new Date().toISOString();

    await container.item(userId, userId).replace(resource);

    return new Response(JSON.stringify(resource), { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
}
