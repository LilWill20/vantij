// /api/videos/{id}/complete  POST -> creator confirms the blob upload finished.
// Marks the video "ready" and kicks off Azure Speech transcription in the
// background (advanced feature: automated speech recognition).
const { container } = require("../shared/cosmos");
const { getUser, isAuthenticated, hasRole } = require("../shared/auth");
const { readSas } = require("../shared/storage");
const { speechSubmit } = require("../shared/ai");
const { ok, unauth, forbid, notFound, serverErr } = require("../shared/http");

module.exports = async function (context, req) {
  try {
    const user = getUser(req);
    if (!isAuthenticated(user)) return unauth(context);
    if (!hasRole(user, "creator")) return forbid(context, "Only creators can publish videos.");

    const id = context.bindingData.id;
    const videos = await container("videos");
    const { resource } = await videos.item(id, id).read();
    if (!resource) return notFound(context, "Video not found.");
    if (resource.createdBy !== user.id) return forbid(context, "You can only publish your own videos.");

    resource.status = "ready";

    // start transcription (best effort; the transcribe endpoint finishes it)
    try {
      const src = await readSas(resource.blobName, 120);
      const job = await speechSubmit(src, resource.title);
      if (job) { resource.transcriptionJob = job; resource.transcriptStatus = "transcribing"; }
    } catch (e) { context.log.warn("transcription submit failed: " + e.message); }

    await videos.item(id, id).replace(resource);
    return ok(context, { video: resource });
  } catch (e) {
    return serverErr(context, e);
  }
};
