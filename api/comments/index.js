// /api/videos/{id}/comments  GET  -> list comments (public)
//                            POST -> add a comment (any signed-in user).
// Each new comment is scored by Azure AI Language (advanced feature: sentiment).
const { container } = require("../shared/cosmos");
const { getUser, isAuthenticated } = require("../shared/auth");
const { sentiment } = require("../shared/ai");
const { ok, created, badReq, unauth, serverErr } = require("../shared/http");

module.exports = async function (context, req) {
  try {
    const videoId = context.bindingData.id;
    const comments = await container("comments");

    if (req.method === "GET") {
      const { resources } = await comments.items.query({
        query: "SELECT * FROM c WHERE c.videoId=@v ORDER BY c.createdAt DESC",
        parameters: [{ name: "@v", value: videoId }]
      }).fetchAll();
      return ok(context, { count: resources.length, comments: resources });
    }

    // POST
    const user = getUser(req);
    if (!isAuthenticated(user)) return unauth(context);
    const text = ((req.body || {}).text || "").trim();
    if (!text) return badReq(context, "Comment text is required.");
    if (text.length > 1000) return badReq(context, "Comment is too long.");

    let sent = null;
    try { sent = await sentiment(text); } catch (e) { context.log.warn("sentiment failed: " + e.message); }

    const doc = {
      id: "cmt_" + require("crypto").randomBytes(8).toString("hex"),
      videoId,
      userId: user.id,
      userName: user.name,
      text,
      sentiment: sent ? sent.label : "unknown",
      sentimentScores: sent ? sent.scores : null,
      createdAt: new Date().toISOString()
    };
    await comments.items.create(doc);
    return created(context, doc);
  } catch (e) {
    return serverErr(context, e);
  }
};
