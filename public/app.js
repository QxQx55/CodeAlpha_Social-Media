const state = {
  user: null,
  route: { name: "feed", param: null },
  feedMode: "all",
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v = "") => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtDate = (iso) => {
  const d = new Date((iso || "").replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function toast(msg, err = false) {
  const el = $("#message");
  el.textContent = msg;
  el.className = `toast show${err ? " error" : ""}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.classList.remove("show"); }, 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const p = h.split("/").filter(Boolean);
  if (p[0] === "profile" && p[1]) return { name: "profile", param: decodeURIComponent(p[1]) };
  if (p[0] === "explore") return { name: "explore" };
  if (p[0] === "saved") return { name: "saved" };
  if (p[0] === "login") return { name: "auth" };
  return { name: "feed" };
}
const nav = (hash) => { location.hash = hash; };

function avatarHTML(user, cls = "avatar") {
  const letter = esc((user?.username || "?")[0].toUpperCase());
  const img = user?.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="" onerror="this.remove()">` : "";
  return `<span class="${cls}">${img}${letter}</span>`;
}
function avatarBtnHTML(user, cls = "avatar") {
  const letter = esc((user?.username || "?")[0].toUpperCase());
  const img = user?.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="" onerror="this.remove()">` : "";
  return `<button class="${cls}" data-action="profile">${img}${letter}</button>`;
}

function setActiveNav(name) {
  $$(".nav-btn[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
}

function renderAuthActions() {
  const el = $("#auth-actions");
  if (state.user) {
    el.innerHTML = `<button class="btn ghost small" id="logout-btn">Log out</button>`;
    $("#logout-btn").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      toast("Logged out");
      syncUI();
      nav("#/");
    };
  } else {
    el.innerHTML = `<a class="btn primary small" href="#/login">Log in</a>`;
  }
}

function renderNavAvatar() {
  const el = $("#nav-avatar");
  if (!state.user) { el.textContent = "?"; return; }
  el.innerHTML = "";
  if (state.user.avatar_url) {
    const img = document.createElement("img");
    img.src = state.user.avatar_url;
    img.alt = "";
    img.onerror = () => { el.textContent = state.user.username[0].toUpperCase(); };
    el.appendChild(img);
  } else {
    el.textContent = state.user.username[0].toUpperCase();
  }
}

function renderSideUser() {
  const el = $("#side-user");
  if (!state.user) {
    el.innerHTML = `<div class="side-user-row"><div class="side-user-info"><span class="name">Welcome to Pulse</span><span class="sub">Sign in to share and connect</span></div></div><div style="margin-top:12px"><a class="btn primary btn-block small" href="#/login">Log in</a></div>`;
    return;
  }
  const u = state.user;
  el.innerHTML = `
    <div class="side-user-row">
      ${avatarHTML(u, "avatar")}
      <div class="side-user-info">
        <a href="#/profile/${esc(u.username)}" class="name">${esc(u.username)}</a>
        <span class="sub">${esc(u.bio || "Welcome back")}</span>
      </div>
      <a href="#/profile/${esc(u.username)}" class="btn-text">Profile</a>
    </div>`;
}

async function renderSuggestions() {
  const el = $("#suggested-list");
  try {
    const { users } = await api("/api/users/suggested");
    if (!users.length) { el.innerHTML = `<p class="muted" style="font-size:13px">No suggestions right now.</p>`; return; }
    el.innerHTML = users.map((u) => `
      <div class="suggest-row">
        ${avatarHTML(u, "avatar xs")}
        <div class="s-info">
          <span class="s-name" data-user="${esc(u.username)}">${esc(u.username)}</span>
          <span class="s-sub">${esc(u.bio || "Suggested for you")}</span>
        </div>
        ${state.user && state.user.username !== u.username ? `<button class="btn-text" data-follow="${esc(u.username)}">Follow</button>` : ""}
      </div>`).join("");
    el.querySelectorAll("[data-user]").forEach((n) => n.onclick = () => nav(`#/profile/${n.dataset.user}`));
    el.querySelectorAll("[data-follow]").forEach((btn) => {
      btn.onclick = async () => {
        if (!state.user) return nav("#/login");
        btn.disabled = true;
        try {
          await api(`/api/users/${encodeURIComponent(btn.dataset.follow)}/follow`, { method: "POST" });
          btn.textContent = "Following";
          btn.disabled = true;
          btn.style.color = "var(--muted)";
          await loadMe();
        } catch (e) { toast(e.message, true); btn.disabled = false; }
      };
    });
  } catch { el.innerHTML = ""; }
}

async function renderStories() {
  const el = $("#stories-bar");
  if (el) el.classList.add("hidden");
}

function syncUI() {
  renderAuthActions();
  renderNavAvatar();
  renderSideUser();
  $$(".auth-only").forEach((el) => el.classList.toggle("hidden", !state.user));
  const cc = $("#composer-card");
  if (cc) cc.classList.toggle("hidden", !state.user);
  if (state.user) {
    const ca = $("#composer-avatar");
    ca.innerHTML = "";
    if (state.user.avatar_url) { const img = document.createElement("img"); img.src = state.user.avatar_url; img.onerror = () => { ca.textContent = state.user.username[0].toUpperCase(); }; ca.appendChild(img); }
    else ca.textContent = state.user.username[0].toUpperCase();
  }
}

async function loadMe() {
  try { state.user = (await api("/api/auth/me")).user; } catch { state.user = null; }
  syncUI();
}

function renderPost(post, opts = {}) {
  const tpl = $("#post-template").content.cloneNode(true);
  const art = tpl.querySelector(".post");
  art.dataset.postId = post.id;
  const av = tpl.querySelector(".post-avatar");
  av.innerHTML = (post.author.avatar_url ? `<img src="${esc(post.author.avatar_url)}" alt="" onerror="this.remove()">` : "") + esc(post.author.username[0].toUpperCase());
  av.onclick = () => nav(`#/profile/${encodeURIComponent(post.author.username)}`);
  const author = tpl.querySelector(".post-author");
  author.textContent = post.author.username;
  author.onclick = () => nav(`#/profile/${encodeURIComponent(post.author.username)}`);
  tpl.querySelector(".post-time").textContent = fmtDate(post.created_at);

  const more = tpl.querySelector(".post-more");
  if (state.user && state.user.id === post.author.id) {
    more.classList.remove("hidden");
    more.onclick = async () => {
      if (!confirm("Delete this post?")) return;
      try { await api(`/api/posts/${post.id}`, { method: "DELETE" }); toast("Post deleted"); refresh(); }
      catch (e) { toast(e.message, true); }
    };
  }

  const imgWrap = tpl.querySelector(".post-image-wrap");
  if (post.image_url) {
    imgWrap.classList.remove("hidden");
    const img = tpl.querySelector(".post-image");
    img.src = post.image_url;
    img.onerror = () => { imgWrap.classList.add("hidden"); };
  }

  tpl.querySelector(".caption-author").textContent = post.author.username;
  tpl.querySelector(".caption-author").onclick = () => nav(`#/profile/${encodeURIComponent(post.author.username)}`);
  const contentEl = tpl.querySelector(".post-content");
  contentEl.textContent = post.content || "";
  if (!post.content) tpl.querySelector(".post-caption").classList.add("hidden");

  const likeBtn = tpl.querySelector(".like-btn");
  likeBtn.classList.toggle("liked", !!post.liked);
  tpl.querySelector(".like-count").textContent = post.likes;
  likeBtn.onclick = () => toggleLike(post);

  const saveBtn = tpl.querySelector(".save-btn");
  saveBtn.classList.toggle("saved", !!post.saved);
  saveBtn.onclick = () => toggleSave(post);

  tpl.querySelector(".comment-focus-btn").onclick = () => {
    const input = art.querySelector(".comment-form input");
    if (input) input.focus();
    else nav("#/login");
  };

  const commentsWrap = tpl.querySelector(".comments");
  const viewBtn = tpl.querySelector(".view-comments-btn");
  const renderComments = (list, limit) => {
    commentsWrap.innerHTML = "";
    const shown = limit ? list.slice(-limit) : list;
    shown.forEach((c) => {
      const row = document.createElement("div");
      row.className = "comment";
      const canDel = state.user && (state.user.id === c.user_id || state.user.id === post.author.id);
      row.innerHTML = `<div class="comment-body"><strong data-u="${esc(c.username)}">${esc(c.username)}</strong><span>${esc(c.content)}</span></div>${canDel ? `<button class="comment-del" data-cid="${c.id}" title="Delete">&times;</button>` : ""}`;
      row.querySelector("strong").onclick = () => nav(`#/profile/${encodeURIComponent(c.username)}`);
      const del = row.querySelector(".comment-del");
      if (del) del.onclick = async () => { try { await api(`/api/comments/${c.id}`, { method: "DELETE" }); refresh(); } catch (e) { toast(e.message, true); } };
      commentsWrap.appendChild(row);
    });
  };

  const limit = opts.expandComments ? 0 : 2;
  if (post.comments.length > 2 && !opts.expandComments) {
    viewBtn.classList.remove("hidden");
    viewBtn.textContent = `View all ${post.comments.length} comments`;
    viewBtn.onclick = () => { renderComments(post.comments, 0); viewBtn.classList.add("hidden"); };
  }
  renderComments(post.comments, limit);

  const form = tpl.querySelector(".comment-form");
  const input = form.querySelector("input");
  const submit = form.querySelector(".comment-submit");
  if (!state.user) {
    form.innerHTML = `<button type="button" class="muted" style="font-size:14px;background:none;border:none;padding:0;cursor:pointer" id="login-to-comment-${post.id}">Log in to comment</button>`;
    setTimeout(() => { const b = document.getElementById(`login-to-comment-${post.id}`); if (b) b.onclick = () => nav("#/login"); }, 0);
  } else {
    input.addEventListener("input", () => { submit.disabled = !input.value.trim(); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const content = input.value.trim();
      if (!content) return;
      submit.disabled = true;
      try { await api(`/api/posts/${post.id}/comments`, { method: "POST", body: JSON.stringify({ content }) }); input.value = ""; refresh(); }
      catch (err) { toast(err.message, true); submit.disabled = false; }
    };
  }

  return art;
}

async function toggleLike(post) {
  if (!state.user) { toast("Log in to like posts", true); return nav("#/login"); }
  try {
    await api(`/api/posts/${post.id}/like`, { method: post.liked ? "DELETE" : "POST" });
    refresh();
  } catch (e) { toast(e.message, true); }
}

async function toggleSave(post) {
  if (!state.user) { toast("Log in to save posts", true); return nav("#/login"); }
  try {
    await api(`/api/posts/${post.id}/save`, { method: post.saved ? "DELETE" : "POST" });
    toast(post.saved ? "Removed from saved" : "Saved");
    refresh();
  } catch (e) { toast(e.message, true); }
}

function emptyState(icon, title, text) {
  return `<div class="card empty-state"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

async function loadFeed() {
  setActiveNav("feed");
  $("#view-feed").classList.remove("hidden");
  const list = $("#feed-list");
  list.innerHTML = `<div class="card empty-state"><p class="muted">Loading...</p></div>`;
  renderStories();
  renderSuggestions();
  try {
    const { posts } = await api(`/api/posts?feed=${state.feedMode}`);
    list.innerHTML = "";
    if (!posts.length) {
      list.innerHTML = emptyState(`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
        state.feedMode === "following" ? "No posts yet" : "Share your first photo",
        state.feedMode === "following" ? "Follow people to see their posts here." : "When you share posts, they'll appear on your feed.");
      return;
    }
    posts.forEach((p) => list.appendChild(renderPost(p)));
  } catch (e) { list.innerHTML = emptyState("!", "Couldn't load feed", e.message); }
}

async function loadExplore() {
  setActiveNav("explore");
  $("#view-explore").classList.remove("hidden");
  const grid = $("#explore-grid");
  grid.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { posts } = await api("/api/posts/explore");
    if (!posts.length) { grid.innerHTML = emptyState("", "No posts to explore", "Posts from the community will show up here."); return; }
    grid.innerHTML = posts.map((p) => `
      <article class="explore-card card" data-profile="${esc(p.author.username)}">
        ${p.image_url ? `<div class="explore-media"><img src="${esc(p.image_url)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>` : ""}
        <div class="explore-body">
          <div class="explore-author">
            <span class="avatar xs">${p.author.avatar_url ? `<img src="${esc(p.author.avatar_url)}" alt="">` : esc(p.author.username[0].toUpperCase())}</span>
            <strong>${esc(p.author.username)}</strong>
          </div>
          <p class="explore-text">${esc(p.content || "Shared a post")}</p>
          <div class="explore-meta muted"><span>♥ ${p.likes}</span><span>💬 ${p.comments.length}</span><span>${esc(fmtDate(p.created_at))}</span></div>
        </div>
      </article>`).join("");
    grid.querySelectorAll(".explore-card").forEach((el) => el.onclick = () => nav(`#/profile/${el.dataset.profile}`));
  } catch (e) { grid.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function loadSaved() {
  if (!state.user) return nav("#/login");
  setActiveNav("saved");
  $("#view-saved").classList.remove("hidden");
  const list = $("#saved-list");
  list.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { posts } = await api("/api/posts/saved");
    list.innerHTML = "";
    if (!posts.length) { list.innerHTML = emptyState(`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4h12a1 1 0 011 1v16l-7-4-7 4V5a1 1 0 011-1z"/></svg>`, "Save posts for later", "Bookmark posts you want to see again."); return; }
    posts.forEach((p) => list.appendChild(renderPost(p)));
  } catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function loadProfile(username) {
  const target = username === "me" ? state.user?.username : username;
  if (!target) return nav("#/login");
  setActiveNav(username === "me" || (state.user && target.toLowerCase() === state.user.username.toLowerCase()) ? "profile" : "");
  $("#view-profile").classList.remove("hidden");
  const hero = $("#profile-hero");
  const postsEl = $("#profile-posts");
  hero.innerHTML = `<div class="profile-main" style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>`;
  postsEl.innerHTML = "";
  try {
    const [{ user: u }, { posts }] = await Promise.all([
      api(`/api/users/${encodeURIComponent(target)}`),
      api(`/api/users/${encodeURIComponent(target)}/posts`),
    ]);
    const canFollow = state.user && !u.isMe;
    hero.innerHTML = `
      <div class="profile-cover"></div>
      <div class="profile-main">
        <div class="profile-row">
          <div class="profile-avatar-lg">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" onerror="this.remove()">` : esc(u.username[0].toUpperCase())}</div>
          <div class="profile-identity">
            <div class="profile-top-line">
              <h1 class="profile-username">${esc(u.username)}</h1>
              ${u.isMe ? `<button class="btn ghost small" id="edit-profile-btn">Edit profile</button>` : ""}
              ${canFollow ? `<button class="btn ${u.isFollowing ? "ghost" : "primary"} small" id="follow-btn">${u.isFollowing ? "Following" : "Follow"}</button>` : ""}
              ${!state.user && !u.isMe ? `<a class="btn primary small" href="#/login">Log in to follow</a>` : ""}
            </div>
            <div class="profile-stats">
              <span><strong>${u.postsCount}</strong> posts</span>
              <button id="stat-followers"><strong>${u.followers}</strong> followers</button>
              <button id="stat-following"><strong>${u.following}</strong> following</button>
            </div>
            <div class="profile-meta muted">${esc(u.last_seen_text || "Offline")}${u.isMe && u.phone ? ` · ${esc(u.phone)}` : ""}</div>
            <div class="profile-bio">${esc(u.bio || (u.isMe ? "Add a bio to tell people about yourself." : ""))}</div>
          </div>
        </div>
      </div>`;

    if (u.isMe) $("#edit-profile-btn").onclick = () => openEditProfile(u);
    const followBtn = $("#follow-btn");
    if (followBtn) followBtn.onclick = async () => {
      followBtn.disabled = true;
      try {
        await api(`/api/users/${encodeURIComponent(u.username)}/follow`, { method: u.isFollowing ? "DELETE" : "POST" });
        await loadMe(); refresh();
      } catch (e) { toast(e.message, true); followBtn.disabled = false; }
    };
    $("#stat-followers").onclick = () => showUserList(u.username, "followers");
    $("#stat-following").onclick = () => showUserList(u.username, "following");

    if (!posts.length) {
      postsEl.innerHTML = emptyState(`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6 6-2z"/></svg>`,
        u.isMe ? "No posts yet" : "No posts yet",
        u.isMe ? "Share your first post to get started." : `When ${u.username} posts, you'll see it here.`);
    } else {
      posts.forEach((p) => postsEl.appendChild(renderPost(p)));
    }
  } catch (e) {
    hero.innerHTML = emptyState("", "Profile not found", e.message);
  }
}

function openEditProfile(u) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  const form = $("#edit-profile-form");
  form.bio.value = u.bio || "";
  form.phone.value = u.phone || "";
  form.avatar_url.value = u.avatar_url || "";
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api("/api/users/me", { method: "PATCH", body: JSON.stringify({ bio: form.bio.value, phone: form.phone.value, avatar_url: form.avatar_url.value }) });
      modal.classList.add("hidden");
      toast("Profile updated");
      await loadMe(); refresh();
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  };
}

async function showUserList(username, type) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#edit-profile-form").classList.add("hidden");
  const head = modal.querySelector(".modal-head h3");
  head.textContent = type === "followers" ? "Followers" : "Following";
  let body = modal.querySelector(".modal-body-list");
  if (!body) { body = document.createElement("div"); body.className = "modal-body-list"; modal.querySelector(".modal-card").appendChild(body); }
  body.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { users } = await api(`/api/users/${encodeURIComponent(username)}/${type}`);
    if (!users.length) { body.innerHTML = `<p class="muted">No ${type} yet.</p>`; }
    else {
      body.innerHTML = users.map((u) => `<div class="suggest-row" style="padding:6px 0"><div class="avatar xs">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(u.username[0].toUpperCase())}</div><div class="s-info"><span class="s-name" data-u="${esc(u.username)}">${esc(u.username)}</span><span class="s-sub">${esc(u.bio || "")}</span></div></div>`).join("");
      body.querySelectorAll("[data-u]").forEach((n) => n.onclick = () => { closeModal(); nav(`#/profile/${n.dataset.u}`); });
    }
  } catch (e) { body.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

function closeModal() {
  $("#modal").classList.add("hidden");
  $("#edit-profile-form").classList.remove("hidden");
  const body = document.querySelector(".modal-body-list");
  if (body) body.remove();
  $("#modal .modal-head h3").textContent = "Edit profile";
}

function showView(name) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const el = $(`#view-${name}`);
  if (el) el.classList.remove("hidden");
}

async function refresh() {
  await loadMe();
  route();
}

async function route() {
  state.route = parseHash();
  closeModal();
  showView(state.route.name);
  if (state.route.name === "auth") { setActiveNav(""); return; }
  if (state.route.name === "explore") return loadExplore();
  if (state.route.name === "saved") return loadSaved();
  if (state.route.name === "profile") return loadProfile(state.route.param);
  return loadFeed();
}

// Composer
function bindComposer() {
  const trigger = $("#open-composer");
  const form = $("#post-form");
  const cancel = $("#cancel-post");
  const content = $("#post-content");
  const imgInput = $("#post-image");
  const preview = $("#post-image-preview");

  trigger.onclick = () => { if (!state.user) return nav("#/login"); form.classList.remove("hidden"); trigger.classList.add("hidden"); content.focus(); };
  cancel.onclick = () => { form.classList.add("hidden"); trigger.classList.remove("hidden"); form.reset(); preview.classList.add("hidden"); preview.innerHTML = ""; $("#post-count").textContent = "0/700"; };
  content.addEventListener("input", () => { $("#post-count").textContent = `${content.value.length}/700`; });
  imgInput.addEventListener("input", () => {
    const url = imgInput.value.trim();
    if (/^https?:\/\/.+/i.test(url)) { preview.classList.remove("hidden"); preview.innerHTML = `<img src="${esc(url)}" alt="Preview" onerror="this.parentElement.classList.add('hidden')">`; }
    else { preview.classList.add("hidden"); preview.innerHTML = ""; }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!state.user) return nav("#/login");
    const text = content.value.trim();
    const image_url = imgInput.value.trim();
    if (!text && !image_url) return toast("Add text or an image URL", true);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api("/api/posts", { method: "POST", body: JSON.stringify({ content: text, image_url }) });
      cancel.onclick();
      toast("Post shared");
      refresh();
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  };
}

function bindAuth() {
  $$(".tab").forEach((tab) => {
    tab.onclick = () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const login = tab.dataset.authTab === "login";
      $("#login-form").classList.toggle("hidden", !login);
      $("#register-form").classList.toggle("hidden", login);
    };
  });
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }) });
      await loadMe(); toast("Welcome back!"); nav("#/");
    } catch (err) { toast(err.message, true); }
  };
  $("#register-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: fd.get("username"), phone: fd.get("phone"), password: fd.get("password"), bio: fd.get("bio") }) });
      await loadMe(); toast("Account created!"); nav("#/");
    } catch (err) { toast(err.message, true); }
  };
}

function bindSearch() {
  const input = $("#global-search");
  const box = $("#search-results");
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    t = setTimeout(async () => {
      try {
        const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (!users.length) { box.innerHTML = `<div class="search-item"><span class="muted">No users found</span></div>`; }
        else {
          box.innerHTML = users.map((u) => `
            <button class="search-item" data-u="${esc(u.username)}">
              <div class="avatar xs">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(u.username[0].toUpperCase())}</div>
              <div class="s-info"><span class="s-name">${esc(u.username)}</span><span class="s-bio">${esc(u.bio || "")}</span></div>
            </button>`).join("");
          box.querySelectorAll("[data-u]").forEach((b) => b.onclick = () => { input.value = ""; box.classList.add("hidden"); nav(`#/profile/${b.dataset.u}`); });
        }
        box.classList.remove("hidden");
      } catch { box.classList.add("hidden"); }
    }, 250);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) box.classList.add("hidden"); });
}

function bindUI() {
  $$(".feed-tab").forEach((btn) => {
    btn.onclick = () => {
      $$(".feed-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.feedMode = btn.dataset.feed;
      if (state.route.name === "feed") loadFeed();
    };
  });
  $$("[data-close='modal']").forEach((el) => el.onclick = closeModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  window.addEventListener("hashchange", route);
}

(async function init() {
  bindComposer();
  bindAuth();
  bindSearch();
  bindUI();
  await loadMe();
  await route();
})();
