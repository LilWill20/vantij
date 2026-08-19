// REST client for the Functions backend.
//
// The site is served from Blob Storage static website hosting and the API runs
// as a separate Function App, so calls are cross-origin and the base URL is
// read from config.json at start-up rather than being baked into the build.
// Sign-in produces a token, which is sent as a bearer header on every request.
const API = {
  base: "",
  TOKEN_KEY: "vantij.token",

  async loadConfig() {
    try {
      const res = await fetch("config.json", { cache: "no-store" });
      if (res.ok) {
        const cfg = await res.json();
        this.base = (cfg.apiBaseUrl || "").replace(/\/$/, "");
      }
    } catch (e) {
      this.base = "";
    }
  },

  token()          { return localStorage.getItem(this.TOKEN_KEY) || ""; },
  setToken(value)  { value ? localStorage.setItem(this.TOKEN_KEY, value) : localStorage.removeItem(this.TOKEN_KEY); },

  async _fetch(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const token = this.token();
    if (token) headers.Authorization = "Bearer " + token;

    const res = await fetch(this.base + "/api" + path, { ...opts, headers });

    if (res.status === 401) this.setToken("");
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  },

  register(name, email, password) {
    return this._fetch("/accounts/register", {
      method: "POST", body: JSON.stringify({ name, email, password }),
    });
  },
  login(email, password) {
    return this._fetch("/accounts/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
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

  // the file goes straight to Blob Storage with the signed URL from createVideo,
  // so a large upload never travels through the API
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
