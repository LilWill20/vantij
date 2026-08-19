// /api/me  GET -> the signed-in account and its role, so the page can show the
// right controls. Returns 200 with {authenticated:false} when nobody is signed
// in, because "not signed in" is a normal state and not an error.
const { getUser, isAuthenticated } = require("../shared/auth");
const { container } = require("../shared/cosmos");
const { ok, serverErr } = require("../shared/http");

module.exports = async function (context, req) {
  try {
    const user = getUser(req);
    if (!isAuthenticated(user)) return ok(context, { authenticated: false });

    // the token carries a role, but the database is the authority on it, so a
    // role that was changed after the token was issued still takes effect
    let role = user.role || "consumer";
    try {
      const users = await container("users");
      const { resource } = await users.item(user.id, user.id).read();
      if (resource && resource.role) role = resource.role;
    } catch (e) { /* fall back to the token */ }

    return ok(context, {
      authenticated: true,
      id: user.id,
      name: user.name,
      role,
      isCreator: role === "creator",
    });
  } catch (e) {
    return serverErr(context, e);
  }
};
