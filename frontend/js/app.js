// Dashboard: latest videos + search + genre filter.
const GENRES = ["Action","Comedy","Documentary","Drama","Education","Music","Sports","Tech","Other"];

async function initHome() {
  await Auth.load();
  renderHeader("home");
  renderGenres();
  await loadVideos();
}

function renderGenres() {
  const cur = getParam("genre");
  const el = document.getElementById("genres");
  el.innerHTML = `<span class="tag ${cur ? '' : 'age'}" onclick="pickGenre('')">All</span> ` +
    GENRES.map(g => `<span class="tag ${cur===g?'age':''}" onclick="pickGenre('${g}')">${g}</span>`).join(" ");
}
function pickGenre(g){ const q=getParam("search"); const p=new URLSearchParams(); if(q)p.set("search",q); if(g)p.set("genre",g); location.href="index.html?"+p.toString(); }

function emptyHtml() {
  if (getParam("search") || getParam("genre")) {
    return `<div class="empty"><strong>Nothing matched that</strong>
      Search covers the title, publisher, producer, genre and what is said in the clip.
      <div style="margin-top:15px"><a class="btn ghost" href="index.html">Show everything</a></div></div>`;
  }
  if (Auth.isCreator()) {
    return `<div class="empty"><strong>No videos yet</strong>
      Your account can publish, so the first one is yours to add.
      <div style="margin-top:15px"><a class="btn gold" href="admin.html">Upload a video</a></div></div>`;
  }
  return `<div class="empty"><strong>No videos yet</strong>
    Anyone can browse, search, play, comment and rate. Publishing is for creator accounts.</div>`;
}

async function loadVideos() {
  const grid = document.getElementById("grid");
  grid.innerHTML = `<div class="empty">Loading videos…</div>`;
  try {
    const data = await API.listVideos(getParam("search"), getParam("genre"));
    const ready = data.videos.filter(v => v.status === "ready" || v.status === undefined);
    if (!ready.length) { grid.innerHTML = emptyHtml(); return; }
    grid.innerHTML = ready.map(cardHtml).join("");
  } catch (e) {
    grid.innerHTML = `<div class="empty">Could not load videos (${escapeHtml(e.message)}).</div>`;
  }
}

function cardHtml(v) {
  const stars = v.avgRating ? `★ ${v.avgRating}` : "unrated";
  return `<div class="card" onclick="location.href='/watch.html?id=${v.id}'">
    <div class="thumb">▶</div>
    <div class="meta">
      <h3>${escapeHtml(v.title)}</h3>
      <div class="sub">
        <span class="tag">${escapeHtml(v.genre||'Other')}</span>
        <span class="tag age">${escapeHtml(v.ageRating||'PG')}</span>
        <span>${stars}</span>
        <span>· ${v.views||0} views</span>
      </div>
      <div class="sub" style="margin-top:6px">${v.publisher?escapeHtml(v.publisher):''}</div>
    </div>
  </div>`;
}
