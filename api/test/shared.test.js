const test = require("node:test");
const assert = require("node:assert");
const { fakeContext, bodyOf, tokenFor, req } = require("../testkit/helpers");

const http = require("../shared/http");
const auth = require("../shared/auth");

/* ------------------------------------------------------------------ http */

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

/* -------------------------------------------------------------- passwords */

test("a password hash keeps nothing readable", () => {
  const stored = auth.hashPassword("correct horse battery");
  assert.ok(stored.startsWith("scrypt$"));
  assert.ok(!stored.includes("correct horse battery"));
});

test("the same password hashes differently every time", () => {
  assert.notEqual(auth.hashPassword("same"), auth.hashPassword("same"));
});

test("the right password verifies and a wrong one does not", () => {
  const stored = auth.hashPassword("s3cret-passphrase");
  assert.equal(auth.verifyPassword("s3cret-passphrase", stored), true);
  assert.equal(auth.verifyPassword("s3cret-passphras", stored), false);
  assert.equal(auth.verifyPassword("", stored), false);
});

test("a damaged or missing hash never verifies", () => {
  for (const stored of [undefined, null, "", "plaintext", "scrypt$only-salt"]) {
    assert.equal(auth.verifyPassword("anything", stored), false);
  }
});

/* ----------------------------------------------------------------- tokens */

test("a token round trips the account it was issued for", () => {
  const token = auth.issueToken({ id: "u9", name: "Ada", role: "creator" });
  const payload = auth.readToken(token);
  assert.equal(payload.sub, "u9");
  assert.equal(payload.name, "Ada");
  assert.equal(payload.role, "creator");
});

test("a token with a tampered payload is refused", () => {
  const token = auth.issueToken({ id: "u1", name: "Sam", role: "consumer" });
  const [body, mac] = token.split(".");
  const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  forged.role = "creator";
  const swapped = Buffer.from(JSON.stringify(forged)).toString("base64url") + "." + mac;
  assert.equal(auth.readToken(swapped), null, "the signature must not match a changed payload");
});

test("a token signed with the wrong key is refused", () => {
  assert.equal(auth.readToken("eyJzdWIiOiJ1MSJ9.not-a-real-signature"), null);
});

test("rubbish in place of a token is refused rather than throwing", () => {
  for (const bad of [undefined, null, "", "no-dot", "a.b.c.d"]) {
    assert.equal(auth.readToken(bad), null);
  }
});

test("an expired token is refused", () => {
  const expired = auth.issueToken({ id: "u1", name: "Sam", role: "consumer" });
  const [body, mac] = expired.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.exp = Date.now() - 1000;
  // re-sign it properly, so only the expiry is at fault
  const crypto = require("node:crypto");
  const newBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const newMac = crypto
    .createHmac("sha256", process.env.AUTH_SECRET || "development-only-secret")
    .update(newBody).digest("base64url");
  assert.equal(auth.readToken(`${newBody}.${newMac}`), null);
});

/* --------------------------------------------------------------- requests */

test("getUser reads the bearer token", () => {
  const user = auth.getUser(req({ user: { id: "u9", name: "Ada", role: "creator" } }));
  assert.equal(user.id, "u9");
  assert.equal(user.role, "creator");
});

test("getUser returns null when there is no header", () => {
  assert.equal(auth.getUser(req()), null);
});

test("getUser ignores a header that is not a bearer token", () => {
  assert.equal(auth.getUser({ headers: { authorization: "Basic abc123" } }), null);
});

test("isAuthenticated needs a real id", () => {
  assert.equal(auth.isAuthenticated(null), false);
  assert.equal(auth.isAuthenticated({ id: "" }), false);
  assert.equal(auth.isAuthenticated({ id: "u1" }), true);
});

test("hasRole only matches the assigned role", () => {
  const creator = auth.getUser(req({ user: { role: "creator" } }));
  const consumer = auth.getUser(req({ user: { role: "consumer" } }));
  assert.equal(auth.hasRole(creator, "creator"), true);
  assert.equal(auth.hasRole(consumer, "creator"), false);
  assert.equal(auth.hasRole(null, "creator"), false);
});

test("the test helper signs with the real code, not a stand-in", () => {
  assert.ok(auth.readToken(tokenFor({ id: "abc" })));
});
