const test = require("node:test");
const assert = require("node:assert");
const { fakeContext, bodyOf, req, fakeCosmos, loadHandler } = require("../testkit/helpers");

function comments({ sentiment } = {}) {
  const cosmos = fakeCosmos();
  const ai = {
    calls: [],
    sentiment: sentiment || (async (text) => {
      ai.calls.push(text);
      return { label: "positive", scores: { positive: 0.9, neutral: 0.08, negative: 0.02 } };
    }),
  };
  const { handler, cleanup } = loadHandler("comments", {
    "shared/cosmos.js": cosmos.module,
    "shared/ai.js": { sentiment: (t) => ai.sentiment(t) },
  });
  return { handler, cleanup, cosmos, ai };
}

function ratings() {
  const cosmos = fakeCosmos();
  const { handler, cleanup } = loadHandler("ratings", { "shared/cosmos.js": cosmos.module });
  return { handler, cleanup, cosmos };
}

const VIEWER = { id: "u1", name: "Sam", roles: ["authenticated"] };

/* ---------------------------------------------------------------- comments */

test("comments are readable without signing in", async () => {
  const { handler, cleanup, cosmos } = comments();
  cosmos.queue("comments", [{ id: "c1", text: "Great" }]);
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.equal(bodyOf(ctx).count, 1);
});

test("comments are fetched for one video, newest first", async () => {
  const { handler, cleanup, cosmos } = comments();
  const ctx = fakeContext();
  ctx.bindingData.id = "v42";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  const q = cosmos.state.lastQuery;
  assert.match(q.query, /c\.videoId=@v/);
  assert.match(q.query, /ORDER BY c\.createdAt DESC/);
  assert.equal(q.parameters[0].value, "v42");
});

test("posting a comment requires signing in", async () => {
  const { handler, cleanup } = comments();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { text: "Hi" } }));
  cleanup();
  assert.equal(ctx.res.status, 401);
});

test("a consumer can comment, so the role check is not over-tight", async () => {
  const { handler, cleanup } = comments();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { text: "Enjoyed that" }, user: VIEWER }));
  cleanup();
  assert.equal(ctx.res.status, 201);
  assert.equal(bodyOf(ctx).userId, "u1");
});

test("an empty comment is refused", async () => {
  const { handler, cleanup } = comments();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { text: "   " }, user: VIEWER }));
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("an overlong comment is refused", async () => {
  const { handler, cleanup } = comments();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { text: "x".repeat(1001) }, user: VIEWER }));
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("sentiment is scored and stored with the comment", async () => {
  const { handler, cleanup, ai } = comments();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { text: "Loved this" }, user: VIEWER }));
  cleanup();
  const doc = bodyOf(ctx);
  assert.equal(doc.sentiment, "positive");
  assert.equal(doc.sentimentScores.positive, 0.9);
  assert.deepEqual(ai.calls, ["Loved this"]);
});

test("a comment still saves when the sentiment service fails", async () => {
  const { handler, cleanup } = comments({
    sentiment: async () => { throw new Error("language service unavailable"); },
  });
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { text: "Still fine" }, user: VIEWER }));
  cleanup();
  assert.equal(ctx.res.status, 201);
  assert.equal(bodyOf(ctx).sentiment, "unknown");
});

/* ---------------------------------------------------------------- ratings */

test("the rating summary is public", async () => {
  const { handler, cleanup, cosmos } = ratings();
  cosmos.queue("ratings", [5, 3, 4]);
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.deepEqual(bodyOf(ctx), { avg: 4, count: 3 });
});

test("an unrated video reports zero rather than dividing by zero", async () => {
  const { handler, cleanup, cosmos } = ratings();
  cosmos.queue("ratings", []);
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.deepEqual(bodyOf(ctx), { avg: 0, count: 0 });
});

test("the average is rounded to one decimal place", async () => {
  const { handler, cleanup, cosmos } = ratings();
  cosmos.queue("ratings", [5, 4, 4]);
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.equal(bodyOf(ctx).avg, 4.3);
});

test("the ratings query quotes the reserved word", async () => {
  const { handler, cleanup, cosmos } = ratings();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.ok(
    cosmos.state.lastQuery.query.includes('c["value"]'),
    'value is reserved in Cosmos SQL and must use the quoted accessor',
  );
});

test("rating requires signing in", async () => {
  const { handler, cleanup } = ratings();
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { value: 4 } }));
  cleanup();
  assert.equal(ctx.res.status, 401);
});

test("a score outside one to five is refused", async () => {
  for (const value of [0, 6, -1, "abc"]) {
    const { handler, cleanup } = ratings();
    const ctx = fakeContext();
    ctx.bindingData.id = "v1";
    await handler(ctx, req({ method: "POST", body: { value }, user: VIEWER }));
    cleanup();
    assert.equal(ctx.res.status, 400, `${value} should be rejected`);
  }
});

test("one person rates a video once, because the id is deterministic", async () => {
  const { handler, cleanup, cosmos } = ratings();
  const ctx1 = fakeContext();
  ctx1.bindingData.id = "v1";
  await handler(ctx1, req({ method: "POST", body: { value: 5 }, user: VIEWER }));
  const ctx2 = fakeContext();
  ctx2.bindingData.id = "v1";
  await handler(ctx2, req({ method: "POST", body: { value: 2 }, user: VIEWER }));
  cleanup();
  assert.equal(cosmos.stores.ratings.size, 1);
  assert.equal([...cosmos.stores.ratings.values()][0].value, 2);
});

test("the average is cached onto the video for cheap dashboard reads", async () => {
  const { handler, cleanup, cosmos } = ratings();
  cosmos.seed("videos", [{ id: "v1", title: "One", avgRating: 0, ratingCount: 0 }]);
  cosmos.queue("ratings", [4, 4]);
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "POST", body: { value: 4 }, user: VIEWER }));
  cleanup();
  const video = cosmos.stores.videos.get("v1");
  assert.equal(video.avgRating, 4);
  assert.equal(video.ratingCount, 2);
});
