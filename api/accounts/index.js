// /api/accounts/register  POST -> create a consumer account
// /api/accounts/login     POST -> check the password and hand back a token
//
// Creator accounts are never created here. The role is only ever raised by an
// administrator running seed/set-role.js, which is what the brief asks for.
const { container } = require("../shared/cosmos");
const { hashPassword, verifyPassword, issueToken, TOKEN_HOURS } = require("../shared/auth");
const { ok, created, badReq, unauth, serverErr } = require("../shared/http");

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async function (context, req) {
  try {
    const action = (context.bindingData.action || "").toLowerCase();
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const users = await container("users");

    if (!EMAIL.test(email)) return badReq(context, "A valid email address is required.");

    if (action === "register") {
      const name = String(body.name || "").trim();
      if (name.length < 2) return badReq(context, "Please give a display name.");
      if (password.length < 8) return badReq(context, "Use a password of at least 8 characters.");

      const { resources } = await users.items.query({
        query: "SELECT * FROM c WHERE c.email=@e",
        parameters: [{ name: "@e", value: email }],
      }).fetchAll();
      if (resources.length) return badReq(context, "That email address is already registered.");

      const user = {
        id: "usr_" + require("crypto").randomBytes(8).toString("hex"),
        email,
        name,
        role: "consumer",
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      await users.items.create(user);
      return created(context, {
        token: issueToken(user),
        expiresInHours: TOKEN_HOURS,
        user: { id: user.id, name: user.name, role: user.role, isCreator: false },
      });
    }

    if (action === "login") {
      const { resources } = await users.items.query({
        query: "SELECT * FROM c WHERE c.email=@e",
        parameters: [{ name: "@e", value: email }],
      }).fetchAll();
      const user = resources[0];
      if (!user || !verifyPassword(password, user.password)) {
        return unauth(context, "Email address or password is not correct.");
      }
      return ok(context, {
        token: issueToken(user),
        expiresInHours: TOKEN_HOURS,
        user: { id: user.id, name: user.name, role: user.role, isCreator: user.role === "creator" },
      });
    }

    return badReq(context, "Unknown account action.");
  } catch (e) {
    return serverErr(context, e);
  }
};
