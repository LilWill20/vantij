// /api/videos/{id}/transcribe  GET or POST -> poll the Azure Speech job and,
// once it has succeeded, store the transcript on the video. The frontend calls
// this a few times after upload until transcriptStatus becomes "done".
const { container } = require("../shared/cosmos");
const { readSas } = require("../shared/storage");
const { speechSubmit, speechResult } = require("../shared/ai");
const { ok, notFound, serverErr } = require("../shared/http");

module.exports = async function (context, req) {
  try {
    const id = context.bindingData.id;
    const videos = await container("videos");
    const { resource } = await videos.item(id, id).read();
    if (!resource) return notFound(context, "Video not found.");

    if (resource.transcriptStatus === "done") {
      return ok(context, { status: "done", transcript: resource.transcript });
    }

    // no job yet -> submit one
    if (!resource.transcriptionJob) {
      const src = await readSas(resource.blobName, 120);
      const job = await speechSubmit(src, resource.title);
      if (!job) return ok(context, { status: "unavailable" });
      resource.transcriptionJob = job;
      resource.transcriptStatus = "transcribing";
      await videos.item(id, id).replace(resource);
      return ok(context, { status: "transcribing" });
    }

    // poll the existing job
    const r = await speechResult(resource.transcriptionJob);
    if (r.status === "Succeeded") {
      resource.transcript = r.text || "";
      resource.transcriptStatus = "done";
      await videos.item(id, id).replace(resource);
      return ok(context, { status: "done", transcript: resource.transcript });
    }
    if (r.status === "Failed") {
      resource.transcriptStatus = "failed";
      await videos.item(id, id).replace(resource);
      return ok(context, { status: "failed" });
    }
    return ok(context, { status: "transcribing" });
  } catch (e) {
    return serverErr(context, e);
  }
};
