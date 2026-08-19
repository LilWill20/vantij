// /api/GetRoles  -> Static Web Apps calls this after every login (rolesSource in
// staticwebapp.config.json). It returns the roles for the signed-in user, which
// SWA then bakes into the client principal. This is the heart of the identity
// framework: a user's role (creator | consumer) comes from the users container.
// First-time users are auto-registered as consumers.
const { container } = require("../shared/cosmos");

module.exports = async function (context, req) {
  try {
    const info = req.body || {};
    const userId = info.userId;
    const name = info.userDetails || "user";
    if (!userId) { context.res = { status: 200, body: { roles: [] } }; return; }

    const users = await container("users");
    let role = "consumer";
    try {
      const { resource } = await users.item(userId, userId).read();
      if (resource && resource.role) {
        role = resource.role;
      } else {
        await users.items.upsert({ id: userId, name, role: "consumer", createdAt: new Date().toISOString() });
      }
    } catch (e) {
      // not found -> register as consumer
      await users.items.upsert({ id: userId, name, role: "consumer", createdAt: new Date().toISOString() });
    }

    // "authenticated" is added by SWA automatically; we add the app role.
    context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { roles: [role] } };
  } catch (e) {
    context.log.error(e);
    context.res = { status: 200, body: { roles: [] } };  // never block login on an error
  }
};
