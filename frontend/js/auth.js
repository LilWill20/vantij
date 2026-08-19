// Sign-in state and the header, shared by every page.
const Auth = {
  user: null,

  async load() {
    await API.loadConfig();
    try {
      this.user = await API.me();
    } catch (e) {
      this.user = { authenticated: false };
    }
    return this.user;
  },

  isAuthed()  { return this.user && this.user.authenticated; },
  isCreator() { return this.user && this.user.isCreator; },

  async signIn(email, password) {
    const out = await API.login(email, password);
    API.setToken(out.token);
    this.user = { authenticated: true, ...out.user };
    return this.user;
  },

  async signUp(name, email, password) {
    const out = await API.register(name, email, password);
    API.setToken(out.token);
    this.user = { authenticated: true, ...out.user };
    return this.user;
  },

  logout() {
    API.setToken("");
    this.user = { authenticated: false };
    location.href = "index.html";
  },

  goToLogin() { location.href = "login.html"; },
};

// builds the top navigation bar into <header id="top">
function renderHeader(active) {
  const u = Auth.user || { authenticated: false };
  const right = u.authenticated
    ? `${u.isCreator ? '<a class="btn gold" href="admin.html">Upload</a>' : ''}
       <span class="pill ${u.isCreator ? 'creator' : ''}">${escapeHtml(u.name || 'user')} &middot; ${u.role || 'consumer'}</span>
       <button class="btn ghost" onclick="Auth.logout()">Sign out</button>`
    : `<button class="btn" onclick="Auth.goToLogin()">Sign in</button>`;

  document.getElementById("top").innerHTML = `
    <div class="container nav">
      <a class="logo" href="index.html">Van<b>tij</b></a>
      <form class="search" onsubmit="return doSearch(event)">
        <input id="q" type="search" placeholder="Search titles, creators, what was said" value="${escapeHtml(getParam('search'))}">
        <button class="btn ghost" type="submit">Search</button>
      </form>
      <span class="grow"></span>
      ${right}
    </div>`;
}

function doSearch(e) {
  e.preventDefault();
  const q = document.getElementById("q").value.trim();
  location.href = "index.html?search=" + encodeURIComponent(q);
  return false;
}

function getParam(k) { return new URLSearchParams(location.search).get(k) || ""; }

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
