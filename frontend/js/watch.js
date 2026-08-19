// Watch page: play a video, rate it, read/add comments (with sentiment),
// and show the auto-generated transcript once Speech has finished.
let VID = null;

async function initWatch() {
  await Auth.load();
  renderHeader("watch");
  const id = getParam("id");
  if (!id) { document.getElementById("main").innerHTML = '<div class="empty">No video specified.</div>'; return; }
  try {
    VID = await API.getVideo(id);
  } catch (e) {
    document.getElementById("main").innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; return;
  }
  render();
  loadRating();
  loadComments();
  pollTranscript();
}

function render() {
  const v = VID;
  document.getElementById("main").innerHTML = `
    <div class="watch">
      <div>
        <video controls playsinline poster="" src="${v.videoUrl}"></video>
        <h1 class="vtitle">${escapeHtml(v.title)}</h1>
        <div class="vmeta">
          <span class="tag">${escapeHtml(v.genre||'Other')}</span>
          <span class="tag age">${escapeHtml(v.ageRating||'PG')}</span>
          <span>${v.views||0} views</span>
          <span id="ratingSummary">· rating…</span>
        </div>
        <div class="vmeta" style="margin-top:8px">
          ${v.publisher?`<span>Publisher: ${escapeHtml(v.publisher)}</span>`:''}
          ${v.producer?`<span>· Producer: ${escapeHtml(v.producer)}</span>`:''}
          <span>· by ${escapeHtml(v.createdByName||'creator')}</span>
        </div>

        <div class="section" style="margin-top:16px">
          <h4>Rate this video</h4>
          <div class="stars" id="stars">${[1,2,3,4,5].map(n=>`<span class="star" data-n="${n}" onclick="rate(${n})">★</span>`).join("")}</div>
          <div class="note" id="rateNote">${Auth.isAuthed()?'Click a star to rate.':'Sign in to rate.'}</div>
        </div>

        <div class="section" style="margin-top:16px">
          <h4>Transcript <span class="note" id="tstatus"></span></h4>
          <div class="transcript" id="transcript">—</div>
        </div>
      </div>

      <div>
        <div class="section">
          <h4>Comments (<span id="cCount">0</span>)</h4>
          <div class="commentbox">
            <input id="cInput" placeholder="${Auth.isAuthed()?'Add a comment…':'Sign in to comment'}" ${Auth.isAuthed()?'':'disabled'}>
            <button class="btn" onclick="addComment()" ${Auth.isAuthed()?'':'disabled'}>Post</button>
          </div>
          <div id="comments"></div>
        </div>
      </div>
    </div>`;
}

async function loadRating() {
  try {
    const r = await API.getRating(VID.id);
    document.getElementById("ratingSummary").textContent = r.count ? `· ★ ${r.avg} (${r.count})` : "· unrated";
    highlightStars(Math.round(r.avg));
  } catch (e) {}
}
function highlightStars(n){ document.querySelectorAll("#stars .star").forEach(s=>s.classList.toggle("on", parseInt(s.dataset.n)<=n)); }
async function rate(n) {
  if (!Auth.isAuthed()) { Auth.login(); return; }
  try { const r = await API.setRating(VID.id, n); highlightStars(n);
    document.getElementById("ratingSummary").textContent = `· ★ ${r.avg} (${r.count})`;
    document.getElementById("rateNote").textContent = "Thanks for rating!";
  } catch (e) { document.getElementById("rateNote").textContent = e.message; }
}

async function loadComments() {
  try {
    const data = await API.listComments(VID.id);
    document.getElementById("cCount").textContent = data.count;
    document.getElementById("comments").innerHTML = data.comments.map(commentHtml).join("") || '<div class="note">No comments yet.</div>';
  } catch (e) {}
}
function commentHtml(c) {
  const s = c.sentiment && c.sentiment !== "unknown" ? `<span class="sent ${c.sentiment}">${c.sentiment}</span>` : "";
  return `<div class="comment"><div class="who">${escapeHtml(c.userName||'user')} ${s}</div>
    <div class="txt">${escapeHtml(c.text)}</div></div>`;
}
async function addComment() {
  if (!Auth.isAuthed()) { Auth.login(); return; }
  const input = document.getElementById("cInput");
  const text = input.value.trim(); if (!text) return;
  input.disabled = true;
  try { await API.addComment(VID.id, text); input.value=""; await loadComments(); }
  catch (e) { alert(e.message); }
  finally { input.disabled = false; }
}

// poll transcription until it is done (advanced feature: speech-to-text)
async function pollTranscript(tries = 0) {
  const box = document.getElementById("transcript");
  const status = document.getElementById("tstatus");
  if (VID.transcript) { box.textContent = VID.transcript; status.textContent = ""; return; }
  try {
    const r = await API.transcribe(VID.id);
    if (r.status === "done") { box.textContent = r.transcript || "(no speech detected)"; status.textContent=""; return; }
    if (r.status === "unavailable") { status.textContent = "(not configured)"; box.textContent="—"; return; }
    if (r.status === "failed") { status.textContent = "(failed)"; return; }
    status.textContent = "generating…";
    if (tries < 20) setTimeout(() => pollTranscript(tries + 1), 6000);
  } catch (e) { status.textContent = ""; }
}
