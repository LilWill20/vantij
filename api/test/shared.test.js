const test = require("node:test");
const assert = require("node:assert");
const { fakeContext, bodyOf, principal, req } = require("../testkit/helpers");

const http = require("../shared/http");
const { getUser, isAuthenticated, hasRole } = require("../shared/auth");

test("http helpers set the right status codes", () => {
  const cases = [
    [http.ok, 200],
    [http.created, 201],
    [http.badReq, 400],
    [http.unauth, 401],
    [http.forbid, 403],
    [http.notFound, 404],
  ];
  for (const [fn, status] of cases) {
    const ctx = fakeContext();
    fn(ctx, "message");
    assert.equal(ctx.res.status, status);
  }
});

test("http helpers always send JSON", () => {
  const ctx = fakeContext();
  http.ok(ctx, { hello: "world" });
  assert.equal(ctx.res.headers["Content-Type"], "application/json");
  assert.deepEqual(bodyOf(ctx), { hello: "world" });
});

test("error helpers carry a message the client can show", () => {
  const ctx = fakeContext();
  http.badReq(ctx, "Title is required.");
  assert.equal(bodyOf(ctx).error, "Title is required.");
});

test("serverErr logs the cause but does not leak it", () => {
  const ctx = fakeContext();
  http.serverErr(ctx, new Error("connection string is wrong"));
  assert.equal(ctx.res.status, 500);
  assert.equal(bodyOf(ctx).error, "Server error.");
  assert.ok(ctx.logs.some((l) => l.includes("ERROR")));
});

test("getUser decodes the Static Web Apps principal", () => {
  const r = req({ user: { id: "u9", name: "Ada", roles: ["authenticated", "creator"] } });
  const user = getUser(r);
  assert.equal(user.id, "u9");
  assert.equal(user.name, "Ada");
  assert.deepEqual(user.roles, ["authenticated", "creator"]);
  assert.equal(user.provider, "aad");
});

test("getUser returns null when nobody is signed in", () => {
  assert.equal(getUser(req()), null);
});

test("getUser survives a corrupt header instead of throwing", () => {
  const r = { headers: { "x-ms-client-principal": "not base64 json" } };
  assert.equal(getUser(r), null);
});

test("isAuthenticated needs a real id", () => {
  assert.equal(isAuthenticated(null), false);
  assert.equal(isAuthenticated({ id: "" }), false);
  assert.equal(isAuthenticated({ id: "u1" }), true);
});

test("hasRole only matches an assigned role", () => {
  const creator = getUser(req({ user: { roles: ["authenticated", "creator"] } }));
  const consumer = getUser(req({ user: { roles: ["authenticated"] } }));
  assert.equal(hasRole(creator, "creator"), true);
  assert.equal(hasRole(consumer, "creator"), false);
  assert.equal(hasRole(null, "creator"), false);
});

test("the principal helper produces what the platform sends", () => {
  const decoded = JSON.parse(Buffer.from(principal({ id: "abc" }), "base64").toString("utf8"));
  assert.equal(decoded.userId, "abc");
  assert.ok(Array.isArray(decoded.userRoles));
});
