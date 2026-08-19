// Shared auth + header rendering used by every page.
const Auth = {
  user: null,
  async load() {
    try { this.user = await API.me(); } catch (e) { this.user = { authenticated: false }; }
    return this.user;
  },
  isAuthed() { return this.user && this.user.authenticated; },
  isCreator() { return this.user && this.user.isCreator; },
  login()  { location.href = "/.auth/login/aad?post_login_redirect_uri=" + encodeURIComponent(location.pathname); },
  logout() { location.href = "/.auth/logout?post_logout_redirect_uri=/"; }
};

// builds the top navigation bar into <header id="top">
function renderHeader(active) {
  const u = Auth.user || { authenticated: false };
  const right = u.authenticated
    ? `${u.isCreator ? '<a class="btn gold" href="/admin">Upload</a>' : ''}
       <span class="pill ${u.isCreator ? 'creator' : ''}">${escapeHtml(u.name || 'user')} · ${u.role || 'consumer'}</span>
       <button class="btn ghost" onclick="Auth.logout()">Sign out</button>`
    : `<button class="btn" onclick="Auth.login()">Sign in</button>`;
  document.getElementById("top").innerHTML = `
    <div class="container nav">
      <a class="logo" href="/">Stream<b>Verse</b></a>
      <form class="search" onsubmit="return doSearch(event)">
        <input id="q" type="search" placeholder="Search videos, creators, genres..." value="${escapeHtml(getParam('search'))}">
        <button class="btn ghost" type="submit">Search</button>
      </form>
      <span class="grow"></span>
      ${right}
    </div>`;
}

function doSearch(e){ e.preventDefault(); const q=document.getElementById("q").value.trim(); location.href="/?search="+encodeURIComponent(q); return false; }
function getParam(k){ return new URLSearchParams(location.search).get(k) || ""; }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
