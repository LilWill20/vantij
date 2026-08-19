// Inserts the sample creator + sample videos into Cosmos so the dashboard is not
// empty for the demo. Reads COSMOS_ENDPOINT / COSMOS_KEY from the environment.
//   COSMOS_ENDPOINT=... COSMOS_KEY=... node seed.js
const { CosmosClient } = require("@azure/cosmos");
const crypto = require("crypto");
const data = require("./seed-data.json");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const dbName = process.env.COSMOS_DATABASE || "vantij";
if (!endpoint || !key) { console.error("Set COSMOS_ENDPOINT and COSMOS_KEY first."); process.exit(1); }

(async () => {
  const client = new CosmosClient({ endpoint, key });
  const { database } = await client.databases.createIfNotExists({ id: dbName });
  const { container: users } = await database.containers.createIfNotExists({ id: "users", partitionKey: { paths: ["/id"] } });
  const { container: videos } = await database.containers.createIfNotExists({ id: "videos", partitionKey: { paths: ["/id"] } });

  await users.items.upsert({ ...data.creator, createdAt: new Date().toISOString() });
  console.log("creator seeded:", data.creator.name);

  for (const v of data.videos) {
    const id = "vid_" + crypto.randomBytes(8).toString("hex");
    await videos.items.upsert({
      id, ...v, blobName: "", transcript: "", transcriptStatus: "none", transcriptionJob: "",
      status: "ready", views: Math.floor(Math.random() * 500), avgRating: 0, ratingCount: 0,
      createdBy: data.creator.id, createdByName: data.creator.name, createdAt: new Date().toISOString()
    });
    console.log("video seeded:", v.title);
  }
  console.log("done.");
})().catch(e => { console.error(e); process.exit(1); });
