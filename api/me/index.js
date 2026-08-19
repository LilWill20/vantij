// /api/me  GET -> the signed-in user + resolved role, so the frontend can show
// the right UI (e.g. the "Upload" area only for creators). Returns 200 with
// {authenticated:false} when nobody is signed in.
const { getUser, isAuthenticated } = require("../shared/auth");
const { container } = require("../shared/cosmos");
const { ok, serverErr } = require("../shared/http");

module.exports = async function (context, req) {
  try {
    const user = getUser(req);
    if (!isAuthenticated(user)) return ok(context, { authenticated: false });

    // make sure a user record exists (first sign-in)
    let role = user.roles.includes("creator") ? "creator" : "consumer";
    try {
      const users = await container("users");
      const { resource } = await users.item(user.id, user.id).read();
      if (resource && resource.role) role = resource.role;
      else await users.items.upsert({ id: user.id, name: user.name, role, createdAt: new Date().toISOString() });
    } catch (e) { /* best effort */ }

    return ok(context, {
      authenticated: true,
      id: user.id,
      name: user.name,
      provider: user.provider,
      roles: user.roles,
      role,
      isCreator: role === "creator"
    });
  } catch (e) {
    return serverErr(context, e);
  }
};
