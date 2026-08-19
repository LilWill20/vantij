const test = require("node:test");
const assert = require("node:assert");
const { fakeContext, bodyOf, req, fakeCosmos, loadHandler } = require("../testkit/helpers");
const auth = require("../shared/auth");

function load(name) {
  const cosmos = fakeCosmos();
  const { handler, cleanup } = loadHandler(name, { "shared/cosmos.js": cosmos.module });
  return { handler, cleanup, cosmos };
}

function accountsReq(action, body) {
  return { req: { method: "POST", body, headers: {} }, action };
}

async function callAccounts(handler, action, body) {
  const ctx = fakeContext();
  ctx.bindingData.action = action;
  await handler(ctx, { method: "POST", body, headers: {} });
  return ctx;
}

const SIGNUP = { email: "sam@example.com", name: "Sam Whitfield", password: "long-enough-pw" };

/* ------------------------------------------------------------- register */

test("anyone can register, and they become a consumer", async () => {
  const { handler, cleanup, cosmos } = load("accounts");
  const ctx = await callAccounts(handler, "register", SIGNUP);
  cleanup();
  assert.equal(ctx.res.status, 201);
  assert.equal(bodyOf(ctx).user.role, "consumer");
  assert.equal(bodyOf(ctx).user.isCreator, false);
  assert.equal([...cosmos.stores.users.values()][0].role, "consumer");
});

test("registering hands back a usable token", async () => {
  const { handler, cleanup } = load("accounts");
  const ctx = await callAccounts(handler, "register", SIGNUP);
  cleanup();
  const payload = auth.readToken(bodyOf(ctx).token);
  assert.ok(payload, "the token must verify");
  assert.equal(payload.role, "consumer");
});

test("the password is never stored or returned in the clear", async () => {
  const { handler, cleanup, cosmos } = load("accounts");
  const ctx = await callAccounts(handler, "register", SIGNUP);
  cleanup();
  const stored = [...cosmos.stores.users.values()][0];
  assert.ok(stored.password.startsWith("scrypt$"));
  assert.ok(!JSON.stringify(bodyOf(ctx)).includes(SIGNUP.password));
});

test("a role cannot be claimed at sign-up", async () => {
  const { handler, cleanup, cosmos } = load("accounts");
  await callAccounts(handler, "register", { ...SIGNUP, role: "creator" });
  cleanup();
  assert.equal([...cosmos.stores.users.values()][0].role, "consumer");
});

test("an invalid email address is refused", async () => {
  const { handler, cleanup } = load("accounts");
  const ctx = await callAccounts(handler, "register", { ...SIGNUP, email: "not-an-email" });
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("a short password is refused", async () => {
  const { handler, cleanup } = load("accounts");
  const ctx = await callAccounts(handler, "register", { ...SIGNUP, password: "short" });
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("a missing display name is refused", async () => {
  const { handler, cleanup } = load("accounts");
  const ctx = await callAccounts(handler, "register", { ...SIGNUP, name: " " });
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("the same email cannot register twice", async () => {
  const { handler, cleanup } = load("accounts");
  await callAccounts(handler, "register", SIGNUP);
  const second = await callAccounts(handler, "register", SIGNUP);
  cleanup();
  assert.equal(second.res.status, 400);
  assert.match(bodyOf(second).error, /already registered/i);
});

test("the email address is stored in lower case", async () => {
  const { handler, cleanup, cosmos } = load("accounts");
  await callAccounts(handler, "register", { ...SIGNUP, email: "MiXeD@Example.COM" });
  cleanup();
  assert.equal([...cosmos.stores.users.values()][0].email, "mixed@example.com");
});

/* ---------------------------------------------------------------- login */

test("the right password signs you in", async () => {
  const { handler, cleanup } = load("accounts");
  await callAccounts(handler, "register", SIGNUP);
  const ctx = await callAccounts(handler, "login", {
    email: SIGNUP.email, password: SIGNUP.password,
  });
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.equal(bodyOf(ctx).user.name, SIGNUP.name);
});

test("a wrong password is refused", async () => {
  const { handler, cleanup } = load("accounts");
  await callAccounts(handler, "register", SIGNUP);
  const ctx = await callAccounts(handler, "login", {
    email: SIGNUP.email, password: "not-the-password",
  });
  cleanup();
  assert.equal(ctx.res.status, 401);
});

test("an unknown email is refused the same way as a wrong password", async () => {
  const { handler, cleanup } = load("accounts");
  const ctx = await callAccounts(handler, "login", {
    email: "nobody@example.com", password: "whatever-long",
  });
  cleanup();
  assert.equal(ctx.res.status, 401);
  assert.match(bodyOf(ctx).error, /not correct/i);
});

test("a creator signs in with the creator role in the token", async () => {
  const { handler, cleanup, cosmos } = load("accounts");
  await callAccounts(handler, "register", SIGNUP);
  const stored = [...cosmos.stores.users.values()][0];
  stored.role = "creator";            // as an administrator would set it
  const ctx = await callAccounts(handler, "login", {
    email: SIGNUP.email, password: SIGNUP.password,
  });
  cleanup();
  assert.equal(bodyOf(ctx).user.isCreator, true);
  assert.equal(auth.readToken(bodyOf(ctx).token).role, "creator");
});

test("an unknown action is refused", async () => {
  const { handler, cleanup } = load("accounts");
  const ctx = await callAccounts(handler, "promote", SIGNUP);
  cleanup();
  assert.equal(ctx.res.status, 400);
});

/* ------------------------------------------------------------------- me */

test("me reports nobody when the request is anonymous", async () => {
  const { handler, cleanup } = load("me");
  const ctx = fakeContext();
  await handler(ctx, req());
  cleanup();
  assert.deepEqual(bodyOf(ctx), { authenticated: false });
});

test("me returns the signed-in identity", async () => {
  const { handler, cleanup } = load("me");
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "u7", name: "Ada", role: "consumer" } }));
  cleanup();
  assert.equal(bodyOf(ctx).authenticated, true);
  assert.equal(bodyOf(ctx).name, "Ada");
  assert.equal(bodyOf(ctx).isCreator, false);
});

test("the database is the authority on the role, not the token", async () => {
  const { handler, cleanup, cosmos } = load("me");
  cosmos.seed("users", [{ id: "u7", name: "Studio", role: "creator" }]);
  const ctx = fakeContext();
  // the token was issued while they were still a consumer
  await handler(ctx, req({ user: { id: "u7", name: "Studio", role: "consumer" } }));
  cleanup();
  assert.equal(bodyOf(ctx).role, "creator");
  assert.equal(bodyOf(ctx).isCreator, true);
});

test("me falls back to the token when the database cannot be read", async () => {
  const broken = { container: async () => { throw new Error("cosmos unreachable"); } };
  const { handler, cleanup } = loadHandler("me", { "shared/cosmos.js": broken });
  const ctx = fakeContext();
  await handler(ctx, req({ user: { id: "u1", name: "Sam", role: "consumer" } }));
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.equal(bodyOf(ctx).role, "consumer");
});
