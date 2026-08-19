// Promote/demote a user. The <userId> is the user's Entra id (or email) as it
// appears in the `users` container after they have signed in at least once.
//   COSMOS_ENDPOINT=... COSMOS_KEY=... node set-role.js <userId> creator
const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const dbName = process.env.COSMOS_DATABASE || "vantij";
const [, , userId, role = "creator"] = process.argv;

if (!endpoint || !key) { console.error("Set COSMOS_ENDPOINT and COSMOS_KEY first."); process.exit(1); }
if (!userId) { console.error("Usage: node set-role.js <userId> <creator|consumer>"); process.exit(1); }
if (!["creator", "consumer"].includes(role)) { console.error("Role must be creator or consumer."); process.exit(1); }

(async () => {
  const client = new CosmosClient({ endpoint, key });
  const container = client.database(dbName).container("users");
  let existing = {};
  try { const { resource } = await container.item(userId, userId).read(); existing = resource || {}; } catch (e) {}
  await container.items.upsert({
    id: userId,
    name: existing.name || userId,
    role,
    createdAt: existing.createdAt || new Date().toISOString()
  });
  console.log(`user ${userId} is now a ${role}.`);
})().catch(e => { console.error(e); process.exit(1); });
