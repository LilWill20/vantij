// /api/videos            GET   -> list latest / search (public)
// /api/videos/{id}        GET   -> one video (+ view count) (public)
// /api/videos             POST  -> create metadata + return a SAS upload URL (CREATOR only)
const { container } = require("../shared/cosmos");
const { getUser, isAuthenticated, hasRole } = require("../shared/auth");
const { uploadSas } = require("../shared/storage");
const { ok, created, badReq, unauth, forbid, notFound, serverErr, json } = require("../shared/http");
const cache = require("../shared/cache");

const GENRES = ["Action","Comedy","Documentary","Drama","Education","Music","Sports","Tech","Other"];
const AGE_RATINGS = ["U","PG","12","15","18"];

module.exports = async function (context, req) {
  try {
    const id = context.bindingData.id;
    const videos = await container("videos");

    // ---- GET one ----
    if (req.method === "GET" && id) {
      const { resource } = await videos.item(id, id).read();
      if (!resource) return notFound(context, "Video not found.");
      resource.views = (resource.views || 0) + 1;
      await videos.item(id, id).replace(resource);
      return ok(context, resource);
    }

    // ---- GET list / search ----
    if (req.method === "GET") {
      const q = (req.query.search || "").trim().toLowerCase();
      const genre = (req.query.genre || "").trim();

      // the unfiltered dashboard is the hot path, so it is held briefly
      const cacheKey = `videos|${q}|${genre}`;
      const hit = cache.get(cacheKey);
      if (hit) {
        json(context, 200, hit);
        context.res.headers["Cache-Control"] = cache.publicFor();
        context.res.headers["X-Cache"] = "hit";
        return;
      }
      let query = "SELECT * FROM c";
      const where = [];
      const params = [];
      if (q) {
        where.push("(CONTAINS(LOWER(c.title),@q) OR CONTAINS(LOWER(c.publisher),@q) OR CONTAINS(LOWER(c.producer),@q) OR CONTAINS(LOWER(c.genre),@q) OR CONTAINS(LOWER(c.transcript),@q))");
        params.push({ name: "@q", value: q });
      }
      if (genre) { where.push("c.genre=@g"); params.push({ name: "@g", value: genre }); }
      if (where.length) query += " WHERE " + where.join(" AND ");
      query += " ORDER BY c.createdAt DESC";
      const { resources } = await videos.items.query({ query, parameters: params }).fetchAll();
      const payload = { count: resources.length, videos: resources };
      cache.set(cacheKey, payload);
      json(context, 200, payload);
      context.res.headers["Cache-Control"] = cache.publicFor();
      context.res.headers["X-Cache"] = "miss";
      return;
    }

    // ---- POST create (creator only) ----
    if (req.method === "POST") {
      const user = getUser(req);
      if (!isAuthenticated(user)) return unauth(context);
      if (!hasRole(user, "creator")) return forbid(context, "Only creators can upload videos.");

      const b = req.body || {};
      const title = (b.title || "").trim();
      const fileName = (b.fileName || "").trim();
      if (!title) return badReq(context, "Title is required.");
      if (!fileName) return badReq(context, "fileName is required.");
      const ext = (fileName.split(".").pop() || "mp4").toLowerCase();
      if (!["mp4", "webm", "mov", "m4v"].includes(ext)) return badReq(context, "Unsupported video type.");
      if (b.ageRating && !AGE_RATINGS.includes(b.ageRating)) return badReq(context, "Invalid age rating.");

      const vid = cryptoId();
      const blobName = `${vid}.${ext}`;
      const { uploadUrl, publicUrl } = await uploadSas(blobName);

      const doc = {
        id: vid,
        title,
        publisher: (b.publisher || "").trim(),
        producer:  (b.producer  || "").trim(),
        genre: GENRES.includes(b.genre) ? b.genre : "Other",
        ageRating: b.ageRating || "PG",
        blobName,
        videoUrl: publicUrl,
        transcript: "",
        transcriptStatus: "none",
        transcriptionJob: "",
        status: "uploading",       // -> "ready" after /complete
        views: 0,
        avgRating: 0,
        ratingCount: 0,
        createdBy: user.id,
        createdByName: user.name,
        createdAt: new Date().toISOString()
      };
      await videos.items.create(doc);
      cache.drop("videos|");   // a new upload must appear straight away
      return created(context, { video: doc, uploadUrl });
    }

    return badReq(context, "Unsupported method.");
  } catch (e) {
    return serverErr(context, e);
  }
};

function cryptoId() {
  // short, url-safe id
  return "vid_" + require("crypto").randomBytes(8).toString("hex");
}
