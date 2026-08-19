// Thin REST client for the Functions backend. Everything is same-origin under
// /api, so the browser sends the auth cookie automatically.
const API = {
  async _fetch(path, opts = {}) {
    const res = await fetch("/api" + path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  },
  me()                       { return this._fetch("/me"); },
  listVideos(search, genre)  {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (genre)  q.set("genre", genre);
    const s = q.toString();
    return this._fetch("/videos" + (s ? "?" + s : ""));
  },
  getVideo(id)               { return this._fetch("/videos/" + id); },
  createVideo(meta)          { return this._fetch("/videos", { method: "POST", body: JSON.stringify(meta) }); },
  completeVideo(id)          { return this._fetch("/videos/" + id + "/complete", { method: "POST" }); },
  transcribe(id)             { return this._fetch("/videos/" + id + "/transcribe", { method: "POST" }); },
  listComments(id)           { return this._fetch("/videos/" + id + "/comments"); },
  addComment(id, text)       { return this._fetch("/videos/" + id + "/comments", { method: "POST", body: JSON.stringify({ text }) }); },
  getRating(id)              { return this._fetch("/videos/" + id + "/ratings"); },
  setRating(id, value)       { return this._fetch("/videos/" + id + "/ratings", { method: "POST", body: JSON.stringify({ value }) }); },

  // upload the file straight to Blob Storage using the SAS URL from createVideo()
  async uploadToBlob(uploadUrl, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
      xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
      xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error("Upload failed: " + xhr.status));
      xhr.onerror = () => reject(new Error("Upload network error"));
      xhr.send(file);
    });
  }
};
