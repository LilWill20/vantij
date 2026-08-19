const test = require("node:test");
const assert = require("node:assert");
const { fakeContext, bodyOf, req, fakeCosmos, loadHandler } = require("../testkit/helpers");
const cache = require("../shared/cache");

function setup() {
  cache._store.clear();   // each test starts with a cold cache
  const cosmos = fakeCosmos();
  const sas = {
    calls: [],
    uploadSas: async (blobName) => {
      sas.calls.push(blobName);
      return {
        uploadUrl: `https://blob.test/videos/${blobName}?sig=write`,
        publicUrl: `https://blob.test/videos/${blobName}`,
      };
    },
  };
  const { handler, cleanup } = loadHandler("videos", {
    "shared/cosmos.js": cosmos.module,
    "shared/storage.js": { uploadSas: sas.uploadSas },
  });
  return { handler, cleanup, cosmos, sas };
}

const DRAFT = {
  title: "Sunrise over the docks",
  fileName: "sunrise.mp4",
  publisher: "Harbour Films",
  producer: "R. Nazir",
  genre: "Documentary",
  ageRating: "PG",
};

test("anyone can list videos without signing in", async () => {
  const { handler, cleanup, cosmos } = setup();
  cosmos.queue("videos", [{ id: "v1", title: "One" }, { id: "v2", title: "Two" }]);
  const ctx = fakeContext();
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.equal(ctx.res.status, 200);
  assert.equal(bodyOf(ctx).count, 2);
});

test("the list is ordered newest first", async () => {
  const { handler, cleanup, cosmos } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.match(cosmos.state.lastQuery.query, /ORDER BY c\.createdAt DESC/);
});

test("a search term filters on title, people and transcript", async () => {
  const { handler, cleanup, cosmos } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({ method: "GET", query: { search: "Harbour" } }));
  cleanup();
  const q = cosmos.state.lastQuery;
  assert.match(q.query, /WHERE/);
  for (const field of ["c.title", "c.publisher", "c.producer", "c.transcript"]) {
    assert.ok(q.query.includes(field), `${field} should be searched`);
  }
  assert.equal(q.parameters[0].value, "harbour");
});

test("a genre filter is passed as a parameter, not concatenated", async () => {
  const { handler, cleanup, cosmos } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({ method: "GET", query: { genre: "Music" } }));
  cleanup();
  const q = cosmos.state.lastQuery;
  assert.ok(q.query.includes("c.genre=@g"));
  assert.deepEqual(q.parameters.find((p) => p.name === "@g"), { name: "@g", value: "Music" });
});

test("opening a video counts the view", async () => {
  const { handler, cleanup, cosmos } = setup();
  cosmos.seed("videos", [{ id: "v1", title: "One", views: 4 }]);
  const ctx = fakeContext();
  ctx.bindingData.id = "v1";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.equal(bodyOf(ctx).views, 5);
});

test("a missing video is a 404, not an error", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  ctx.bindingData.id = "nope";
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.equal(ctx.res.status, 404);
});

test("uploading requires signing in", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({ method: "POST", body: DRAFT }));
  cleanup();
  assert.equal(ctx.res.status, 401);
});

test("a consumer cannot upload", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({ method: "POST", body: DRAFT, user: { role: "consumer" } }));
  cleanup();
  assert.equal(ctx.res.status, 403);
  assert.match(bodyOf(ctx).error, /creator/i);
});

test("a creator gets a record and a write-only upload URL", async () => {
  const { handler, cleanup, sas } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: DRAFT,
    user: { id: "c1", name: "Harbour Films", role: "creator" },
  }));
  cleanup();
  assert.equal(ctx.res.status, 201);
  const out = bodyOf(ctx);
  assert.ok(out.uploadUrl.includes("sig=write"));
  assert.equal(out.video.createdBy, "c1");
  assert.equal(sas.calls.length, 1);
});

test("every metadata field the brief names is stored", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: DRAFT,
    user: { id: "c1", role: "creator" },
  }));
  cleanup();
  const v = bodyOf(ctx).video;
  assert.equal(v.title, DRAFT.title);
  assert.equal(v.publisher, DRAFT.publisher);
  assert.equal(v.producer, DRAFT.producer);
  assert.equal(v.genre, DRAFT.genre);
  assert.equal(v.ageRating, DRAFT.ageRating);
});

test("a title is required", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: { ...DRAFT, title: "   " },
    user: { id: "c1", role: "creator" },
  }));
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("an unsupported file type is refused", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: { ...DRAFT, fileName: "notes.pdf" },
    user: { id: "c1", role: "creator" },
  }));
  cleanup();
  assert.equal(ctx.res.status, 400);
  assert.match(bodyOf(ctx).error, /video type/i);
});

test("an invented age rating is refused", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: { ...DRAFT, ageRating: "X" },
    user: { id: "c1", role: "creator" },
  }));
  cleanup();
  assert.equal(ctx.res.status, 400);
});

test("an unknown genre falls back rather than being stored raw", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: { ...DRAFT, genre: "<script>" },
    user: { id: "c1", role: "creator" },
  }));
  cleanup();
  assert.equal(bodyOf(ctx).video.genre, "Other");
});

test("a new upload starts as uploading, not ready", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({
    method: "POST", body: DRAFT,
    user: { id: "c1", role: "creator" },
  }));
  cleanup();
  assert.equal(bodyOf(ctx).video.status, "uploading");
  assert.equal(bodyOf(ctx).video.views, 0);
});

/* ------------------------------------------------------------- caching */

test("a repeated dashboard request is served from the cache", async () => {
  const { handler, cleanup, cosmos } = setup();
  const first = fakeContext();
  await handler(first, req({ method: "GET" }));
  const queryCount = cosmos.state.lastQuery ? 1 : 0;
  cosmos.state.lastQuery = null;

  const second = fakeContext();
  await handler(second, req({ method: "GET" }));
  cleanup();

  assert.equal(queryCount, 1, "the first request should reach the database");
  assert.equal(cosmos.state.lastQuery, null, "the second should not");
  assert.equal(second.res.headers["X-Cache"], "hit");
  assert.equal(first.res.headers["X-Cache"], "miss");
});

test("the cached response carries a Cache-Control header for the edge", async () => {
  const { handler, cleanup } = setup();
  const ctx = fakeContext();
  await handler(ctx, req({ method: "GET" }));
  cleanup();
  assert.match(ctx.res.headers["Cache-Control"], /public, max-age=\d+/);
});

test("different searches are cached separately", async () => {
  const { handler, cleanup, cosmos } = setup();
  await handler(fakeContext(), req({ method: "GET", query: { search: "one" } }));
  cosmos.state.lastQuery = null;
  await handler(fakeContext(), req({ method: "GET", query: { search: "two" } }));
  cleanup();
  assert.ok(cosmos.state.lastQuery, "a different search must not reuse the first result");
});

test("publishing a video clears the dashboard cache", async () => {
  const { handler, cleanup, cosmos } = setup();
  await handler(fakeContext(), req({ method: "GET" }));

  await handler(fakeContext(), req({
    method: "POST", body: DRAFT,
    user: { id: "c1", role: "creator" },
  }));

  cosmos.state.lastQuery = null;
  const after = fakeContext();
  await handler(after, req({ method: "GET" }));
  cleanup();

  assert.ok(cosmos.state.lastQuery, "the list must be rebuilt after an upload");
  assert.equal(after.res.headers["X-Cache"], "miss");
});
