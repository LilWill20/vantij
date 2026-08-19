// Cosmos DB (NoSQL) access. One shared client; containers are created on first
// use so the app is self-bootstrapping (no manual DB setup needed).
const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const dbName = process.env.COSMOS_DATABASE || "vantij";

let _client = null;
function client() {
  if (!_client) {
    if (!endpoint || !key) throw new Error("COSMOS_ENDPOINT / COSMOS_KEY not configured.");
    _client = new CosmosClient({ endpoint, key });
  }
  return _client;
}

// containers and their partition keys
const CONTAINERS = {
  videos:   "/id",
  comments: "/videoId",
  ratings:  "/videoId",
  users:    "/id"
};

const _ready = {};
async function container(name) {
  if (!CONTAINERS[name]) throw new Error("Unknown container: " + name);
  if (!_ready[name]) {
    const { database } = await client().databases.createIfNotExists({ id: dbName });
    const { container } = await database.containers.createIfNotExists({
      id: name,
      partitionKey: { paths: [CONTAINERS[name]] }
    });
    _ready[name] = container;
  }
  return _ready[name];
}

module.exports = { container };
