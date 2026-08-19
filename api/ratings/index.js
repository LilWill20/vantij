// /api/videos/{id}/ratings  GET  -> { avg, count } (public)
//                           POST -> add/update this user's rating 1..5, then
//                                   recompute the average onto the video doc.
const { container } = require("../shared/cosmos");
const { getUser, isAuthenticated } = require("../shared/auth");
const { ok, badReq, unauth, notFound, serverErr } = require("../shared/http");

async function summary(ratings, videoId) {
  const { resources } = await ratings.items.query({
    // "value" is a reserved word in Cosmos SQL, so it needs the quoted accessor
    query: 'SELECT VALUE c["value"] FROM c WHERE c.videoId=@v',
    parameters: [{ name: "@v", value: videoId }]
  }).fetchAll();
  const count = resources.length;
  const avg = count ? Math.round((resources.reduce((a, b) => a + b, 0) / count) * 10) / 10 : 0;
  return { avg, count };
}

module.exports = async function (context, req) {
  try {
    const videoId = context.bindingData.id;
    const ratings = await container("ratings");

    if (req.method === "GET") {
      return ok(context, await summary(ratings, videoId));
    }

    // POST
    const user = getUser(req);
    if (!isAuthenticated(user)) return unauth(context);
    const value = parseInt(((req.body || {}).value), 10);
    if (!(value >= 1 && value <= 5)) return badReq(context, "Rating must be 1 to 5.");

    const id = `rat_${videoId}_${user.id}`;              // one rating per user per video
    await ratings.items.upsert({
      id, videoId, userId: user.id, value, createdAt: new Date().toISOString()
    });

    const s = await summary(ratings, videoId);
    // cache the aggregate on the video for cheap dashboard reads
    const videos = await container("videos");
    try {
      const { resource } = await videos.item(videoId, videoId).read();
      if (resource) { resource.avgRating = s.avg; resource.ratingCount = s.count; await videos.item(videoId, videoId).replace(resource); }
    } catch (e) { /* video read is best-effort */ }

    return ok(context, s);
  } catch (e) {
    return serverErr(context, e);
  }
};
