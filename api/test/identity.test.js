const test = require("node:test");
const assert = require("node:assert");
const { fakeContext, bodyOf, req, fakeCosmos, loadHandler } = require("../testkit/helpers");

function load(name) {
  const cosmos = fakeCosmos();
  const { handler, cleanup } = loadHandler(name, { "shared/cosmos.js": cosmos.module });
  return { handler, cleanup, cosmos };
}

/* -------------------------------------------------------------------- /me */

test("me reports nobody when the request is anonymous", async () => {
  const { handler, cleanup } = load("me");
  const ctx = fakeContext();
  await handler(ctx, req());
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.deepEqual(bodyOf(ctx), { authenticated: false });
});

test("me returns the signed-in identity", async () => {
  const { handler, cleanup } = load("me");
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "u7", name: "Ada", roles: ["authenticated"] } }));
  cleanup();
  const body = bodyOf(ctx);
  assert.equal(body.authenticated, true);
  assert.equal(body.id, "u7");
  assert.equal(body.name, "Ada");
});

test("a first-time visitor is a consumer, not a creator", async () => {
  const { handler, cleanup } = load("me");
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "new", roles: ["authenticated"] } }));
  cleanup();
  assert.equal(bodyOf(ctx).role, "consumer");
  assert.equal(bodyOf(ctx).isCreator, false);
});

test("a first-time visitor is written to the users container", async () => {
  const { handler, cleanup, cosmos } = load("me");
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "new", name: "Newcomer", roles: ["authenticated"] } }));
  cleanup();
  assert.equal(cosmos.stores.users.get("new").role, "consumer");
});

test("a stored creator role wins over the token", async () => {
  const { handler, cleanup, cosmos } = load("me");
  cosmos.seed("users", [{ id: "u7", name: "Studio", role: "creator" }]);
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "u7", roles: ["authenticated"] } }));
  cleanup();
  assert.equal(bodyOf(ctx).role, "creator");
  assert.equal(bodyOf(ctx).isCreator, true);
});

test("me exposes isCreator so the page can hide the studio", async () => {
  const { handler, cleanup, cosmos } = load("me");
  cosmos.seed("users", [{ id: "u1", role: "consumer" }]);
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "u1", roles: ["authenticated"] } }));
  cleanup();
  assert.equal(bodyOf(ctx).isCreator, false);
});

/* -------------------------------------------------------------- /GetRoles */

test("GetRoles registers an unknown user as a consumer", async () => {
  const { handler, cleanup, cosmos } = load("GetRoles");
  const ctx = fakeContext();
  await handler(ctx, { body: { userId: "brand-new", userDetails: "Chris" }, headers: {} });
  cleanup();
  assert.deepEqual(ctx.res.body.roles, ["consumer"]);
  assert.equal(cosmos.stores.users.get("brand-new").role, "consumer");
});

test("GetRoles returns the role already on record", async () => {
  const { handler, cleanup, cosmos } = load("GetRoles");
  cosmos.seed("users", [{ id: "u5", role: "creator" }]);
  const ctx = fakeContext();
  await handler(ctx, { body: { userId: "u5" }, headers: {} });
  cleanup();
  assert.deepEqual(ctx.res.body.roles, ["creator"]);
});

test("GetRoles gives nothing away when there is no user id", async () => {
  const { handler, cleanup } = load("GetRoles");
  const ctx = fakeContext();
  await handler(ctx, { body: {}, headers: {} });
  cleanup();
  assert.deepEqual(ctx.res.body.roles, []);
  assert.equal(ctx.res.status, 200);
});

test("GetRoles never blocks a sign-in, even when the database is down", async () => {
  const broken = { container: async () => { throw new Error("cosmos unreachable"); } };
  const { handler, cleanup } = loadHandler("GetRoles", { "shared/cosmos.js": broken });
  const ctx = fakeContext();
  await handler(ctx, { body: { userId: "u1" }, headers: {} });
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.deepEqual(ctx.res.body.roles, []);
});

test("a creator role is never handed out by accident", async () => {
  const { handler, cleanup } = load("GetRoles");
  const ctx = fakeContext();
  await handler(ctx, {
    body: { userId: "sneaky", userDetails: "x", userRoles: ["creator"] },
    headers: {},
  });
  cleanup();
  assert.deepEqual(
    ctx.res.body.roles, ["consumer"],
    "roles must come from the users container, not from the request",
  );
});
