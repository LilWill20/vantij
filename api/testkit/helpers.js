// Test doubles for the Azure bindings, so the functions can run with no cloud.
const path = require("node:path");

function fakeContext() {
  const logs = [];
  const log = (...a) => logs.push(a.join(" "));
  log.error = (...a) => logs.push("ERROR " + a.join(" "));
  log.warn = (...a) => logs.push("WARN " + a.join(" "));
  return { res: null, bindingData: {}, log, logs };
}

function bodyOf(context) {
  return context.res && context.res.body ? JSON.parse(context.res.body) : undefined;
}

// Signs a real token with the same code the API uses, so the tests exercise
// the actual verification path rather than a stand-in.
const { issueToken } = require("../shared/auth");

function tokenFor({ id = "u1", name = "Sam", role = "consumer" } = {}) {
  return issueToken({ id, name, role });
}

function req({ method = "GET", body = null, query = {}, user = null } = {}) {
  const headers = {};
  if (user) headers.authorization = "Bearer " + tokenFor(user);
  return { method, body, query, headers };
}

// An in-memory stand-in for Cosmos. Containers are plain maps; queries return
// whatever the test has queued, and the last query is kept for assertions.
function fakeCosmos() {
  const stores = {};
  const state = { lastQuery: null, queued: {} };

  const collection = (name) => {
    stores[name] = stores[name] || new Map();
    const docs = stores[name];

    return {
      item: (id) => ({
        read: async () => ({ resource: docs.get(id) || undefined }),
        replace: async (doc) => { docs.set(doc.id, doc); return { resource: doc }; },
      }),
      items: {
        create: async (doc) => { docs.set(doc.id, doc); return { resource: doc }; },
        upsert: async (doc) => { docs.set(doc.id, doc); return { resource: doc }; },
        query: (spec) => ({
          fetchAll: async () => {
            state.lastQuery = { container: name, ...spec };
            const queued = state.queued[name];
            if (queued !== undefined) return { resources: queued };
            return { resources: [...docs.values()] };
          },
        }),
      },
    };
  };

  return {
    module: { container: async (name) => collection(name) },
    stores,
    state,
    seed(name, docs) {
      stores[name] = new Map(docs.map((d) => [d.id, d]));
    },
    queue(name, resources) {
      state.queued[name] = resources;
    },
  };
}

// Swaps a module out before the function under test requires it.
function stub(relativeToApi, exports) {
  const full = path.join(__dirname, "..", relativeToApi);
  const resolved = require.resolve(full);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return resolved;
}

function unstub(resolvedPaths) {
  for (const p of resolvedPaths) delete require.cache[p];
}

// Loads a function handler fresh, with the given stubs in place.
function loadHandler(name, stubs = {}) {
  const applied = Object.entries(stubs).map(([mod, exp]) => stub(mod, exp));
  const handlerPath = require.resolve(path.join(__dirname, "..", name, "index.js"));
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  return { handler, cleanup: () => unstub([...applied, handlerPath]) };
}

module.exports = { fakeContext, bodyOf, tokenFor, req, fakeCosmos, loadHandler };
