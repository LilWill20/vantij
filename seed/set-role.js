// Grants or removes the creator role. This is the only way an account becomes a
// creator -- there is deliberately no page that does it, which is what the brief
// asks for.
//
//   COSMOS_ENDPOINT=... COSMOS_KEY=... node set-role.js someone@example.com creator
const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const dbName = process.env.COSMOS_DATABASE || "vantij";
const [, , email, role = "creator"] = process.argv;

if (!endpoint || !key) { console.error("Set COSMOS_ENDPOINT and COSMOS_KEY first."); process.exit(1); }
if (!email) { console.error("Usage: node set-role.js <email> <creator|consumer>"); process.exit(1); }
if (!["creator", "consumer"].includes(role)) { console.error("Role must be creator or consumer."); process.exit(1); }

(async () => {
  const client = new CosmosClient({ endpoint, key });
  const users = client.database(dbName).container("users");

  const { resources } = await users.items.query({
    query: "SELECT * FROM c WHERE c.email=@e",
    parameters: [{ name: "@e", value: email.toLowerCase() }]
  }).fetchAll();

  const user = resources[0];
  if (!user) {
    console.error(`No account for ${email}. They have to register on the site first.`);
    process.exit(1);
  }

  user.role = role;
  await users.items.upsert(user);
  console.log(`${user.name} <${user.email}> is now a ${role}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
