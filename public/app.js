const state = {
  user: null,
  route: { name: "feed", param: null },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s = "") => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function fmtDate(iso) {
  const d = new Date(iso + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function showMessage(text, isError = false) {
  const el = $("#message");
  if (!text) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "profile" && parts[1]) return { name: "profile", param: decodeURIComponent(parts[1]) };
  if (parts[0] === "login") return { name: "auth", param: null };
  return { name: "feed", param: null };
}

function navigate(hash) { location.hash = hash; }

function setView(name) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${name}`).classList.remove("hidden");
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === (name === "profile" && state.route.param === "me" ? "profile" : name)));
}

function avatarLetter(username) { return (username || "?").slice(0, 1).toUpperCase(); }

function renderAuthActions() {
  const el = $("#auth-actions");
  if (state.user) {
    el.innerHTML = `<span class="muted">@${esc(state.user.username)}</span><button class="btn small ghost" id="logout-btn">Logout</button>`;
    $("#logout-btn").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      showMessage("Logged out");
      syncUI();
      navigate("#/");
    };
  } else {
    el.innerHTML = `<a class="btn small primary" href="#/login">Login</a>`;
  }
}

function renderSidebar() {
  const el = $("#sidebar-user");
  if (!state.user) {
    el.innerHTML = `
      <div class="sidebar-user">
        <div class="name">Welcome to Pulse</div>
        <p class="muted" style="margin:0">Log in to create posts, like, comment, and follow people.</p>
        <a class="btn primary" href="#/login">Get started</a>
      </div>`;
    return;
  }
  const u = state.user;
  el.innerHTML = `
    <div class="sidebar-user">
      <div class="who">
        <div class="avatar" style="cursor:default">${esc(avatarLetter(u.username))}</div>
        <div>
          <div class="name">${esc(u.username)}</div>
          <div class="handle">@${esc(u.username)}</div>
        </div>
      </div>
      <p class="muted" style="margin:0">${esc(u.bio || "No bio yet.")}</p>
      <div class="sidebar-stats">
        <span><strong>${u.postsCount}</strong> posts</span>
        <span><strong>${u.followers}</strong> followers</span>
        <span><strong>${u.following}</strong> following</span>
      </div>
      <a class="btn small" href="#/profile/${encodeURIComponent(u.username)}">View profile</a>
    </div>`;
}

function syncUI() {
  renderAuthActions();
  renderSidebar();
  $("#nav-profile").classList.toggle("hidden", !state.user);
  $("#composer-card").classList.toggle("hidden", !state.user);
}

function renderPost(post) {
  const tpl = $("#post-template").content.cloneNode(true);
  const article = tpl.querySelector(".post");
  article.dataset.postId = post.id;
  const avatar = tpl.querySelector(".post-avatar");
  avatar.textContent = avatarLetter(post.author.username);
  avatar.onclick = () => navigate(`#/profile/${encodeURIComponent(post.author.username)}`);
  const author = tpl.querySelector(".post-author");
  author.textContent = `@${post.author.username}`;
  author.onclick = () => navigate(`#/profile/${encodeURIComponent(post.author.username)}`);
  tpl.querySelector(".post-time").textContent = fmtDate(post.created_at);
  tpl.querySelector(".post-content").textContent = post.content;
  const likeBtn = tpl.querySelector(".like-btn");
  likeBtn.classList.toggle("liked", !!post.liked);
  likeBtn.querySelector(".like-count").textContent = post.likes;
  likeBtn.onclick = () => toggleLike(post.id, likeBtn);
  tpl.querySelector(".comment-count").textContent = `${post.comments.length} comment${post.comments.length === 1 ? "" : "s"}`;

  const comments = tpl.querySelector(".comments");
  post.comments.forEach((c) => {
    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      <div class="comment-head">
        <button class="comment-author">@${esc(c.username)}</button>
        <span class="muted">${esc(fmtDate(c.created_at))}</span>
      </div>
      <p class="comment-body">${esc(c.content)}</p>`;
    div.querySelector(".comment-author").onclick = () => navigate(`#/profile/${encodeURIComponent(c.username)}`);
    comments.appendChild(div);
  });

  const form = tpl.querySelector(".comment-form");
  if (!state.user) {
    form.innerHTML = `<span class="muted"><a href="#/login" style="color:var(--accent-deep);font-weight:700">Login</a> to comment.</span>`;
  } else {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      const content = input.value.trim();
      if (!content) return;
      form.querySelector("button").disabled = true;
      try {
        await api(`/api/posts/${post.id}/comments`, { method: "POST", body: JSON.stringify({ content }) });
        input.value = "";
        await refreshCurrentView();
      } catch (err) { showMessage(err.message, true); }
      finally { form.querySelector("button").disabled = false; }
    };
  }
  return article;
}

async function toggleLike(postId, btn) {
  if (!state.user) { showMessage("Login to like posts", true); navigate("#/login"); return; }
  const liked = btn.classList.contains("liked");
  btn.disabled = true;
  try {
    await api(`/api/posts/${postId}/like`, { method: liked ? "DELETE" : "POST" });
    await refreshCurrentView();
  } catch (err) { showMessage(err.message, true); }
  finally { btn.disabled = false; }
}

async function loadFeed() {
  setView("feed");
  const list = $("#feed-list");
  list.innerHTML = `<div class="card empty">Loading posts...</div>`;
  try {
    const { posts } = await api("/api/posts");
    list.innerHTML = "";
    if (!posts.length) { list.innerHTML = `<div class="card empty">No posts yet. Be the first to share something.</div>`; return; }
    posts.forEach((p) => list.appendChild(renderPost(p)));
  } catch (err) {
    list.innerHTML = `<div class="card empty">Could not load posts.</div>`;
    showMessage(err.message, true);
  }
}

async function loadProfile(username) {
  setView("profile");
  const card = $("#profile-card");
  const postsEl = $("#profile-posts");
  card.innerHTML = `<div class="empty">Loading profile...</div>`;
  postsEl.innerHTML = "";
  try {
    const target = username === "me" ? state.user?.username : username;
    if (!target) { navigate("#/login"); return; }
    const { user } = await api(`/api/users/${encodeURIComponent(target)}`);
    const { posts } = await api(`/api/users/${encodeURIComponent(target)}/posts`);
    const canFollow = state.user && !user.isMe;
    card.innerHTML = `
      <div class="profile-top">
        <div class="profile-ident">
          <div class="avatar profile-avatar">${esc(avatarLetter(user.username))}</div>
          <div>
            <h1 class="profile-name">${esc(user.username)}</h1>
            <div class="profile-handle">@${esc(user.username)}</div>
          </div>
        </div>
        ${canFollow ? `<button class="btn ${user.isFollowing ? "ghost danger" : "primary"}" id="follow-btn">${user.isFollowing ? "Unfollow" : "Follow"}</button>` : ""}
        ${user.isMe ? `<span class="muted">This is you</span>` : ""}
        ${!state.user && !user.isMe ? `<a class="btn primary" href="#/login">Login to follow</a>` : ""}
      </div>
      <p class="profile-bio">${esc(user.bio || "No bio yet.")}</p>
      <div class="profile-stats">
        <span class="stat"><strong>${user.postsCount}</strong> Posts</span>
        <span class="stat"><strong>${user.followers}</strong> Followers</span>
        <span class="stat"><strong>${user.following}</strong> Following</span>
      </div>`;

    const followBtn = $("#follow-btn");
    if (followBtn) {
      followBtn.onclick = async () => {
        followBtn.disabled = true;
        try {
          await api(`/api/users/${encodeURIComponent(user.username)}/follow`, { method: user.isFollowing ? "DELETE" : "POST" });
          await loadMe();
          await loadProfile(username);
        } catch (err) { showMessage(err.message, true); }
        finally { followBtn.disabled = false; }
      };
    }

    $("#profile-posts-title").textContent = user.isMe ? "Your posts" : `@${user.username}'s posts`;
    if (!posts.length) {
      postsEl.innerHTML = `<div class="card empty">${user.isMe ? "You haven't posted yet." : "No posts yet."}</div>`;
    } else {
      posts.forEach((p) => postsEl.appendChild(renderPost(p)));
    }
  } catch (err) {
    card.innerHTML = `<div class="empty">Profile not found.</div>`;
    showMessage(err.message, true);
  }
}

async function loadMe() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
  } catch {
    state.user = null;
  }
  syncUI();
}

async function refreshCurrentView() {
  await loadMe();
  if (state.route.name === "profile") await loadProfile(state.route.param);
  else await loadFeed();
}

async function handleRoute() {
  state.route = parseHash();
  showMessage("");
  if (state.route.name === "auth") {
    setView("auth");
    return;
  }
  if (state.route.name === "profile") return loadProfile(state.route.param);
  return loadFeed();
}

function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.onclick = () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const showLogin = tab.dataset.authTab === "login";
      $("#login-form").classList.toggle("hidden", !showLogin);
      $("#register-form").classList.toggle("hidden", showLogin);
      [$("#login-form"), $("#register-form")].forEach(f => { f.style.animation = 'none'; f.offsetHeight; f.style.animation = ''; });
    };
  });

  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }) });
      await loadMe();
      showMessage("Welcome back!");
      navigate("#/");
    } catch (err) { showMessage(err.message, true); }
  };

  $("#register-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password"), bio: fd.get("bio") }),
      });
      await loadMe();
      showMessage("Account created!");
      navigate("#/");
    } catch (err) { showMessage(err.message, true); }
  };

  $("#post-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.user) { navigate("#/login"); return; }
    const content = $("#post-content").value.trim();
    if (!content) return;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api("/api/posts", { method: "POST", body: JSON.stringify({ content }) });
      $("#post-content").value = "";
      $("#post-count").textContent = "0/500";
      showMessage("Post shared");
      await refreshCurrentView();
    } catch (err) { showMessage(err.message, true); }
    finally { btn.disabled = false; }
  };

  $("#post-content").addEventListener("input", (e) => {
    $("#post-count").textContent = `${e.target.value.length}/500`;
  });
  $("#refresh-feed").onclick = () => loadFeed();
  window.addEventListener("hashchange", handleRoute);
}

(async function init() {
  bindEvents();
  await loadMe();
  await handleRoute();
})();
