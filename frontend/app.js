const state = {
  user: null,
  route: { name: "feed", param: null },
  feedMode: "all",
  profileTab: "posts",
  createKind: "post",
  createFile: null,
  createPreviewUrl: null,
  inlineFile: null,
  inlinePreviewUrl: null,
  replyPolicyIndex: 0,
  storyGroups: [],
  storyGroupIndex: 0,
  storyIndex: 0,
  storyTimer: null,
  conversation: null,
  messages: [],
  redirectAfterAuth: null,
};

const REPLY_POLICIES = ["Anyone can reply", "Profiles you follow", "Mentioned only"];
const GUEST_ALLOWED_ROUTES = new Set(["auth"]);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v = "") =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fmtDate = (iso) => {
  const d = new Date((iso || "").replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function toast(msg, err = false) {
  const el = $("#message");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show${err ? " error" : ""}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(path, opts = {}) {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers = { ...(opts.headers || {}) };
  if (!isForm && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const p = h.split("/").filter(Boolean);
  if (p[0] === "profile" && p[1]) return { name: "profile", param: decodeURIComponent(p[1]) };
  if (p[0] === "post" && p[1]) return { name: "post", param: p[1] };
  if (p[0] === "explore") return { name: "explore", param: p[1] ? decodeURIComponent(p[1]) : null };
  if (p[0] === "search") return { name: "search", param: p[1] ? decodeURIComponent(p[1]) : "" };
  if (p[0] === "reels") return { name: "reels" };
  if (p[0] === "messages") return { name: "messages", param: p[1] ? decodeURIComponent(p[1]) : null };
  if (p[0] === "notifications") return { name: "notifications" };
  if (p[0] === "saved") return { name: "saved" };
  if (p[0] === "login" || p[0] === "register") return { name: "auth", param: p[0] };
  return { name: "feed" };
}

const nav = (hash) => {
  location.hash = hash;
};

function finishAuth(message) {
  const authHashes = ["#/login", "#/register"];
  const target = state.redirectAfterAuth && !authHashes.includes(state.redirectAfterAuth) ? state.redirectAfterAuth : "#/";
  state.redirectAfterAuth = null;
  toast(message);
  nav(target);
}

function setAuthTab(register) {
  $$("[data-auth-tab]").forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.authTab === (register ? "register" : "login"))
  );
  $("#login-form")?.classList.toggle("hidden", register);
  $("#register-form")?.classList.toggle("hidden", !register);
}

function avatarHTML(user, cls = "avatar") {
  const letter = esc((user?.full_name || user?.username || "?")[0].toUpperCase());
  const img = user?.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="" onerror="this.remove()">` : "";
  return `<span class="${cls}">${img}${letter}</span>`;
}

function setActiveNav(name) {
  $$(".nav-btn[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
}

function setBadge(selector, count) {
  const el = $(selector);
  if (!el) return;
  el.textContent = count > 9 ? "9+" : String(count);
  el.classList.toggle("hidden", !count);
}

async function renderBadges() {
  if (!state.user) {
    setBadge("#msg-badge", 0);
    setBadge("#notif-badge", 0);
    return;
  }
  try {
    const [m, n] = await Promise.all([api("/api/messages/unread"), api("/api/notifications")]);
    setBadge("#msg-badge", m.count);
    setBadge("#notif-badge", n.unread);
  } catch {}
}

async function logoutUser() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  state.user = null;
  state.conversation = null;
  state.redirectAfterAuth = null;
  toast("Logged out");
  syncUI();
  nav("#/");
}

async function renderSuggestions() {
  const el = $("#suggested-list");
  if (!el) return;
  try {
    const { users } = await api("/api/users/suggested");
    if (!users.length) {
      el.innerHTML = `<p class="muted small">No suggestions right now.</p>`;
      return;
    }
    el.innerHTML = users
      .map(
        (u) => `
      <div class="suggest-row">
        ${avatarHTML(u, "avatar xs")}
        <div class="s-info">
          <span class="s-name" data-user="${esc(u.username)}">${esc(u.full_name || u.username)}</span>
          <span class="s-sub">@${esc(u.username)}</span>
        </div>
        ${
          state.user && !u.isMe
            ? `<button class="btn-text" type="button" data-follow="${esc(u.username)}" data-following="${u.isFollowing ? "1" : "0"}" data-requested="${u.isRequested ? "1" : "0"}">${
                u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow"
              }</button>`
            : ""
        }
      </div>`
      )
      .join("");
    el.querySelectorAll("[data-user]").forEach((n) => (n.onclick = () => nav(`#/profile/${encodeURIComponent(n.dataset.user)}`)));
    el.querySelectorAll("[data-follow]").forEach((btn) => {
      btn.onclick = async () => {
        if (!state.user) return nav("#/login");
        const username = btn.dataset.follow;
        const following = btn.dataset.following === "1" || btn.dataset.requested === "1";
        btn.disabled = true;
        try {
          const res = await api(`/api/users/${encodeURIComponent(username)}/follow`, {
            method: following ? "DELETE" : "POST",
          });
          const u = res.user;
          btn.dataset.following = u.isFollowing ? "1" : "0";
          btn.dataset.requested = u.isRequested ? "1" : "0";
          btn.textContent = u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow";
          if (state.route.name === "profile") refresh();
        } catch (e) {
          toast(e.message, true);
        } finally {
          btn.disabled = false;
        }
      };
    });
  } catch {
    el.innerHTML = "";
  }
}

async function renderTrending() {
  const el = $("#trending-content");
  if (!el) return;
  try {
    const { posts } = await api("/api/posts/explore");
    const post = posts[0];
    if (!post) {
      el.innerHTML = `<p class="muted trend-empty">Trending threads will appear here.</p>`;
      return;
    }
    const media = post.image_url
      ? post.media_type === "video"
        ? `<video class="trend-media" src="${esc(post.image_url)}" muted playsinline></video>`
        : `<img class="trend-media" src="${esc(post.image_url)}" alt="" loading="lazy">`
      : "";
    el.innerHTML = `
      <button class="trend-story" type="button">
        <span class="trend-author">${avatarHTML(post.author, "avatar xs")}<strong>${esc(post.author.username)}</strong><span>${esc(fmtDate(post.created_at))}</span></span>
        <span class="trend-copy">${esc(post.content || "A thread from the community")}</span>
        ${media}
      </button>`;
    el.querySelector(".trend-story").onclick = () => nav(`#/post/${post.id}`);
  } catch (e) {
    el.innerHTML = `<p class="muted trend-empty">Couldn't load threads: ${esc(e.message)}</p>`;
  }
}

function syncUI() {
  document.body.classList.toggle("is-guest", !state.user);
  document.body.classList.toggle("is-member", !!state.user);
  $$(".auth-only").forEach((el) => el.classList.toggle("hidden", !state.user));

  const cc = $("#composer-card");
  if (cc) cc.classList.toggle("hidden", !state.user);
  if (state.user) {
    const ca = $("#composer-avatar");
    const cn = $("#composer-name");
    if (cn) cn.textContent = state.user.full_name || state.user.username;
    if (ca) {
      ca.innerHTML = "";
      if (state.user.avatar_url) {
        const img = document.createElement("img");
        img.src = state.user.avatar_url;
        img.alt = "";
        img.onerror = () => {
          ca.textContent = (state.user.full_name || state.user.username)[0].toUpperCase();
        };
        ca.appendChild(img);
      } else {
        ca.textContent = (state.user.full_name || state.user.username)[0].toUpperCase();
      }
    }
  }
  renderBadges();
}

async function loadMe() {
  try {
    state.user = (await api("/api/auth/me")).user;
  } catch {
    state.user = null;
  }
  syncUI();
}

// ── Inline Thread Composer ────────────────────────────────────────────────
function clearInlineAttachment() {
  state.inlineFile = null;
  if (state.inlinePreviewUrl) URL.revokeObjectURL(state.inlinePreviewUrl);
  state.inlinePreviewUrl = null;
  const chip = $("#composer-file-chip");
  const preview = $("#composer-inline-preview");
  const fileInput = $("#composer-file");
  if (chip) chip.classList.add("hidden");
  if (preview) {
    preview.classList.add("hidden");
    preview.innerHTML = "";
  }
  if (fileInput) fileInput.value = "";
}

function setInlineAttachment(file) {
  if (!file) return;
  state.inlineFile = file;
  if (state.inlinePreviewUrl) URL.revokeObjectURL(state.inlinePreviewUrl);
  state.inlinePreviewUrl = URL.createObjectURL(file);

  const chip = $("#composer-file-chip");
  const nameEl = $("#composer-file-name");
  const preview = $("#composer-inline-preview");
  if (nameEl) nameEl.textContent = file.name || "attachment";
  if (chip) chip.classList.remove("hidden");

  if (preview) {
    const isVideo = file.type.startsWith("video/");
    preview.innerHTML = isVideo
      ? `<video src="${state.inlinePreviewUrl}" controls playsinline></video>`
      : `<img src="${state.inlinePreviewUrl}" alt="Attachment preview">`;
    preview.classList.remove("hidden");
  }
}

function bindInlineComposer() {
  const form = $("#composer-card");
  const input = $("#composer-input");
  const fileInput = $("#composer-file");
  const clearBtn = $("#composer-file-clear");
  const replyToggle = $("#composer-reply-toggle");
  const replyLabel = $("#composer-reply-label");
  const postBtn = $("#composer-post-btn");
  if (!form || !input) return;

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) setInlineAttachment(f);
  });

  clearBtn?.addEventListener("click", clearInlineAttachment);

  replyToggle?.addEventListener("click", () => {
    state.replyPolicyIndex = (state.replyPolicyIndex + 1) % REPLY_POLICIES.length;
    if (replyLabel) replyLabel.textContent = REPLY_POLICIES[state.replyPolicyIndex];
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!state.user) return nav("#/login");
    const content = input.value.trim();
    if (!content && !state.inlineFile) {
      input.focus();
      return toast("Write something or attach a file", true);
    }
    postBtn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("kind", "post");
      if (state.inlineFile) fd.append("media", state.inlineFile);
      await api("/api/posts", { method: "POST", body: fd });
      input.value = "";
      input.style.height = "auto";
      clearInlineAttachment();
      toast("Thread posted");
      loadFeed();
    } catch (err) {
      toast(err.message, true);
    } finally {
      postBtn.disabled = false;
    }
  };
}

// ── Create post / reel / story modal (File Upload Only) ──────────────────
function resetCreate() {
  state.createFile = null;
  $("#create-caption").value = "";
  $("#create-count").textContent = "0/2200";
  const preview = $("#create-preview");
  if (state.createPreviewUrl) URL.revokeObjectURL(state.createPreviewUrl);
  state.createPreviewUrl = null;
  preview.classList.add("hidden");
  preview.innerHTML = "";
  $("#create-file").value = "";
}

function openCreate(kind = "post") {
  if (!state.user) return nav("#/login");
  state.createKind = kind;
  resetCreate();
  $$(".create-tab").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  $("#create-share").textContent = kind === "story" ? "Share story" : "Post";
  $("#create-caption").placeholder =
    kind === "story" ? "Add a caption to your story (optional)" : "Start a thread... use #hashtags and @mentions";
  $("#create-modal").classList.remove("hidden");
  setTimeout(() => $("#create-caption").focus(), 50);
}

function setCreateFile(file) {
  if (!file) return;
  state.createFile = file;
  $("#create-file").value = "";
  const preview = $("#create-preview");
  if (state.createPreviewUrl) URL.revokeObjectURL(state.createPreviewUrl);
  state.createPreviewUrl = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");
  preview.innerHTML = `${
    isVideo ? `<video src="${state.createPreviewUrl}" controls playsinline></video>` : `<img src="${state.createPreviewUrl}" alt="Preview">`
  }<button type="button" class="remove-media" aria-label="Remove">&times;</button>`;
  preview.classList.remove("hidden");
  preview.querySelector(".remove-media").onclick = () => {
    state.createFile = null;
    URL.revokeObjectURL(state.createPreviewUrl);
    state.createPreviewUrl = null;
    preview.classList.add("hidden");
    preview.innerHTML = "";
  };
}

function bindCreate() {
  $$(".create-tab").forEach((tab) => (tab.onclick = () => openCreate(tab.dataset.kind)));
  $("#create-file").onchange = (e) => {
    const f = e.target.files?.[0];
    if (f) setCreateFile(f);
  };
  $("#create-caption").addEventListener("input", (e) => {
    $("#create-count").textContent = `${e.target.value.length}/2200`;
  });
  $("#create-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.user) return nav("#/login");
    const content = $("#create-caption").value.trim();
    if (!content && !state.createFile) return toast("Add text or upload a file", true);
    if ((state.createKind === "story" || state.createKind === "reel") && !state.createFile) {
      return toast(`Upload an image or video file for your ${state.createKind}`, true);
    }
    const btn = $("#create-share");
    btn.disabled = true;
    try {
      const fd = new FormData();
      const isStory = state.createKind === "story";
      fd.append(isStory ? "caption" : "content", content);
      if (!isStory) fd.append("kind", state.createKind);
      if (state.createFile) fd.append("media", state.createFile);
      await api(isStory ? "/api/stories" : "/api/posts", { method: "POST", body: fd });
      closeModal("create-modal");
      toast(isStory ? "Story added" : state.createKind === "reel" ? "Reel shared" : "Thread posted");
      refresh();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };
}

// ── Stories ───────────────────────────────────────────────────────────────
async function loadStories() {
  const bar = $("#stories-bar");
  if (!bar) return;
  try {
    const { stories } = await api("/api/stories");
    state.storyGroups = stories;
    const add = state.user
      ? `<div class="story story-add" data-add-story><div class="story-ring"><div class="story-ring-inner">+</div></div><span class="story-name">Your story</span></div>`
      : "";
    bar.innerHTML =
      add +
      stories
        .map(
          (g, i) => `
      <div class="story" data-story-group="${i}">
        <div class="story-ring ${g.seen ? "seen" : ""}"><div class="story-ring-inner">${
            g.user.avatar_url ? `<img src="${esc(g.user.avatar_url)}" alt="">` : esc(g.user.username[0].toUpperCase())
          }</div></div>
        <span class="story-name">${esc(g.user.username)}</span>
      </div>`
        )
        .join("");
    bar.classList.toggle("hidden", !state.user && !stories.length);
    bar.querySelector("[data-add-story]")?.addEventListener("click", () => openCreate("story"));
    $$("[data-story-group]", bar).forEach((el) => (el.onclick = () => openStoryViewer(Number(el.dataset.storyGroup), 0)));
  } catch {
    bar.classList.add("hidden");
  }
}

function clearStoryTimer() {
  clearTimeout(state.storyTimer);
  state.storyTimer = null;
}

function openStoryViewer(groupIdx, storyIdx = 0) {
  state.storyGroupIndex = groupIdx;
  state.storyIndex = storyIdx;
  $("#story-modal").classList.remove("hidden");
  renderStory();
}

function renderStory() {
  clearStoryTimer();
  const group = state.storyGroups[state.storyGroupIndex];
  const story = group?.stories[state.storyIndex];
  if (!story) {
    if (state.storyGroupIndex < state.storyGroups.length - 1) {
      state.storyGroupIndex++;
      state.storyIndex = 0;
      return renderStory();
    }
    return closeModal("story-modal");
  }
  const head = $("#story-header");
  if (head) {
    head.innerHTML = `${avatarHTML(group.user, "avatar xs")}<span>${esc(group.user.username)}</span><span class="muted small">${esc(fmtDate(story.created_at))}</span>`;
  }
  const stage = $("#story-stage");
  stage.innerHTML =
    story.media_type === "video"
      ? `<video src="${esc(story.media_url)}" autoplay playsinline controls></video>`
      : `<img src="${esc(story.media_url)}" alt="Story">`;
  $("#story-progress").innerHTML = group.stories
    .map((_, i) => `<div class="story-bar ${i <= state.storyIndex ? "active" : ""}"></div>`)
    .join("");
  const sh = $("#story-header");
  if (sh) sh.innerHTML = `${avatarHTML(group.user, "avatar xs")}<span>${esc(group.user.username)}</span><span class="muted small">${esc(fmtDate(story.created_at))}</span>`;
  $("#story-caption").textContent = story.caption || `@${group.user.username}`;
  $("#story-views").textContent = `Views ${story.views}`;
  $("#story-delete").classList.toggle("hidden", group.user.id !== state.user?.id);
  $("#story-delete").onclick = async () => {
    try {
      await api(`/api/stories/${story.id}`, { method: "DELETE" });
      closeModal("story-modal");
      refresh();
    } catch (e) {
      toast(e.message, true);
    }
  };
  api(`/api/stories/${story.id}/view`, { method: "POST" }).catch(() => {});
  state.storyTimer = setTimeout(nextStory, 5000);
}

function nextStory() {
  const group = state.storyGroups[state.storyGroupIndex];
  if (!group) return closeModal("story-modal");
  if (state.storyIndex < group.stories.length - 1) state.storyIndex++;
  else if (state.storyGroupIndex < state.storyGroups.length - 1) {
    state.storyGroupIndex++;
    state.storyIndex = 0;
  } else return closeModal("story-modal");
  renderStory();
}

function prevStory() {
  if (state.storyIndex > 0) state.storyIndex--;
  else if (state.storyGroupIndex > 0) {
    state.storyGroupIndex--;
    state.storyIndex = state.storyGroups[state.storyGroupIndex].stories.length - 1;
  }
  renderStory();
}

// ── Comments & In-place Post Updates ──────────────────────────────────────
function renderRichText(text = "") {
  return esc(text)
    .replace(/#([A-Za-z0-9_]{1,30})/g, '<button type="button" class="inline-tag" data-tag="$1">#$1</button>')
    .replace(/@([A-Za-z0-9_]{3,20})/g, '<a class="inline-mention" href="#/profile/$1">@$1</a>');
}

function bindRichLinks(root) {
  $$(".inline-tag", root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); searchFor(`#${b.dataset.tag}`); }));
}

function replacePostElement(art, post, forceExpand) {
  if (!art || !post) return refresh();
  const wasOpen = forceExpand ?? !art.querySelector(".post-comments-drawer")?.classList.contains("hidden");
  const nextEl = renderPost(post, { expandComments: wasOpen });
  art.replaceWith(nextEl);
  return nextEl;
}

function bindCommentForm(form, postId, art) {
  const input = form.querySelector('input[name="comment"]');
  const submit = form.querySelector(".comment-submit");
  const fileInput = form.querySelector('input[name="image_file"]');
  const tools = form.querySelector(".comment-tools");
  const preview = form.querySelector(".comment-preview");
  let file = null;
  let previewUrl = null;

  const syncTools = () => tools.classList.toggle("hidden", !file);
  const update = () => {
    submit.disabled = !(input.value.trim() || file);
  };
  const setPreview = (f) => {
    file = f;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (!f) {
      preview.classList.add("hidden");
      preview.innerHTML = "";
      syncTools();
      update();
      return;
    }
    previewUrl = URL.createObjectURL(f);
    const isVideo = f.type.startsWith("video/");
    preview.classList.remove("hidden");
    preview.innerHTML = `${
      isVideo ? `<video src="${previewUrl}" controls></video>` : `<img src="${previewUrl}" alt="Preview">`
    }<button type="button" class="remove-media" aria-label="Remove">&times;</button>`;
    preview.querySelector(".remove-media").onclick = () => {
      fileInput.value = "";
      setPreview(null);
    };
    syncTools();
    update();
  };

  input.addEventListener("input", update);
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) setPreview(f);
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content && !file) return;
    submit.disabled = true;
    try {
      const fd = new FormData();
      fd.append("content", content);
      if (file) fd.append("media", file);
      const res = await api(`/api/posts/${postId}/comments`, { method: "POST", body: fd });
      input.value = "";
      fileInput.value = "";
      setPreview(null);
      replacePostElement(art, res.post, true);
    } catch (err) {
      toast(err.message, true);
      update();
    }
  };
}

function searchFor(q) {
  const value = String(q || "").trim();
  if (!value) return;
  nav(`#/search/${encodeURIComponent(value)}`);
}

// ── Thread Post Rendering ─────────────────────────────────────────────────
function renderPost(post, opts = {}) {
  const tpl = $("#post-template").content.cloneNode(true);
  const art = tpl.querySelector(".post");
  art.dataset.postId = post.id;
  const authorUrl = `#/profile/${encodeURIComponent(post.author.username)}`;

  const av = tpl.querySelector(".post-avatar");
  av.innerHTML =
    (post.author.avatar_url ? `<img src="${esc(post.author.avatar_url)}" alt="" onerror="this.remove()">` : "") +
    esc((post.author.full_name || post.author.username)[0].toUpperCase());
  av.onclick = () => nav(authorUrl);

  const author = tpl.querySelector(".post-author");
  author.textContent = post.author.full_name || post.author.username;
  author.onclick = () => nav(authorUrl);
  tpl.querySelector(".post-time").textContent = fmtDate(post.created_at);

  const isOwner = state.user && state.user.id === post.author.id;
  const moreBtn = tpl.querySelector(".post-more");
  const menuEl = tpl.querySelector(".post-menu");
  const saveMenuBtn = menuEl.querySelector('[data-menu="save"]');
  const editMenuBtn = menuEl.querySelector('[data-menu="edit"]');
  const delMenuBtn = menuEl.querySelector('[data-menu="delete"]');
  saveMenuBtn.textContent = post.saved ? "Unsave" : "Save";
  if (isOwner) {
    editMenuBtn.classList.remove("hidden");
    delMenuBtn.classList.remove("hidden");
  }
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    const willOpen = menuEl.classList.contains("hidden");
    $$(".post-menu").forEach((m) => m.classList.add("hidden"));
    if (willOpen) menuEl.classList.remove("hidden");
  };
  menuEl.querySelector('[data-menu="open"]').onclick = () => nav(`#/post/${post.id}`);
  saveMenuBtn.onclick = () => {
    menuEl.classList.add("hidden");
    toggleSave(post, art);
  };
  menuEl.querySelector('[data-menu="copy"]').onclick = () => {
    menuEl.classList.add("hidden");
    const link = `${location.origin}/#/post/${post.id}`;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Link copied")).catch(() => toast(link));
    else toast(link);
  };

  const captionBox = tpl.querySelector(".post-caption");
  const contentEl = tpl.querySelector(".post-content");
  const editForm = tpl.querySelector(".post-edit-box");
  const editInput = editForm.querySelector('textarea[name="edit_content"]');
  contentEl.innerHTML = renderRichText(post.content || "");
  bindRichLinks(contentEl);
  if (!post.content) captionBox.classList.add("hidden");

  editMenuBtn.onclick = () => {
    menuEl.classList.add("hidden");
    editInput.value = post.content || "";
    captionBox.classList.add("hidden");
    editForm.classList.remove("hidden");
    editInput.focus();
  };
  editForm.querySelector(".post-edit-cancel").onclick = () => {
    editForm.classList.add("hidden");
    if (post.content) captionBox.classList.remove("hidden");
  };
  editForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editInput.value }),
      });
      toast("Thread updated");
      replacePostElement(art, res.post);
    } catch (err) {
      toast(err.message, true);
    }
  };

  delMenuBtn.onclick = async () => {
    menuEl.classList.add("hidden");
    if (!confirm("Delete this thread?")) return;
    try {
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      toast("Thread deleted");
      art.remove();
      if (state.route.name === "post") nav("#/");
    } catch (e) {
      toast(e.message, true);
    }
  };

  if (post.tags?.length) {
    const tagsEl = tpl.querySelector(".post-tags");
    tagsEl.innerHTML = post.tags.map((t) => `<button class="tag-link" type="button" data-tag="${esc(t)}">#${esc(t)}</button>`).join("");
    $$(".tag-link", tagsEl).forEach((b) => (b.onclick = () => searchFor(`#${b.dataset.tag}`)));
  }

  const imgWrap = tpl.querySelector(".post-image-wrap");
  if (post.image_url) {
    imgWrap.classList.remove("hidden");
    if (post.media_type === "video") {
      const video = tpl.querySelector(".post-video");
      video.src = post.image_url;
      video.hidden = false;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      tpl.querySelector(".post-image").hidden = true;
    } else {
      const img = tpl.querySelector(".post-image");
      img.src = post.image_url;
      img.onerror = () => imgWrap.classList.add("hidden");
    }
    imgWrap.ondblclick = () => {
      if (state.user && !post.liked) toggleLike(post, art);
    };
  }

  const likeBtn = tpl.querySelector(".like-btn");
  likeBtn.classList.toggle("liked", !!post.liked);
  likeBtn.onclick = () => toggleLike(post, art);

  const saveBtn = tpl.querySelector(".save-btn");
  saveBtn.classList.toggle("saved", !!post.saved);
  saveBtn.onclick = () => toggleSave(post, art);

  tpl.querySelector(".share-btn").onclick = () => {
    const link = `${location.origin}/#/post/${post.id}`;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Link copied")).catch(() => toast(link));
    else toast(link);
  };

  // Thread gutter mini avatars from replies
  const miniWrap = tpl.querySelector(".thread-avatars");
  const seenReplyUsers = [];
  const replyAuthors = [];
  for (const c of post.comments || []) {
    if (!seenReplyUsers.includes(c.username)) {
      seenReplyUsers.push(c.username);
      replyAuthors.push(c);
      if (replyAuthors.length >= 2) break;
    }
  }
  if (replyAuthors.length) {
    miniWrap.innerHTML = replyAuthors
      .map(
        (c) =>
          `<span class="thread-mini-av">${
            c.avatar_url ? `<img src="${esc(c.avatar_url)}" alt="">` : esc(c.username[0].toUpperCase())
          }</span>`
      )
      .join("");
  }

  // Engagement summary line
  const replyCount = post.comments.length;
  tpl.querySelector(".reply-count").textContent = `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;
  const likeSummaryEl = tpl.querySelector(".liked-summary");
  if (post.liked && post.likes > 1) {
    likeSummaryEl.innerHTML = `Liked by <strong>you</strong> and ${post.likes - 1} others`;
  } else if (post.liked) {
    likeSummaryEl.innerHTML = `Liked by <strong>you</strong>`;
  } else {
    likeSummaryEl.innerHTML = `<strong class="like-count">${post.likes}</strong> ${post.likes === 1 ? "like" : "likes"}`;
  }

  const drawer = tpl.querySelector(".post-comments-drawer");
  if (opts.expandComments) drawer.classList.remove("hidden");

  const toggleDrawer = (focusInput = false) => {
    drawer.classList.toggle("hidden");
    if (focusInput && !drawer.classList.contains("hidden")) {
      drawer.querySelector('.comment-form input[name="comment"]')?.focus();
    }
  };
  tpl.querySelector(".engagement-link").onclick = () => toggleDrawer(false);
  tpl.querySelector(".comment-focus-btn").onclick = () => {
    if (drawer.classList.contains("hidden")) drawer.classList.remove("hidden");
    drawer.querySelector('.comment-form input[name="comment"]')?.focus();
  };

  const commentsWrap = tpl.querySelector(".comments");
  post.comments.forEach((c) => {
    const row = document.createElement("div");
    row.className = "comment";
    const canDel = state.user && (state.user.id === c.user_id || state.user.id === post.author.id);
    row.innerHTML = `<div class="comment-body">
        <strong data-u="${esc(c.username)}">${esc(c.username)}</strong>
        ${c.content ? `<span class="comment-text">${renderRichText(c.content)}</span>` : ""}
        ${
          c.image_url
            ? c.image_url.match(/\.(mp4|webm|mov)/i)
              ? `<video class="comment-image" src="${esc(c.image_url)}" controls></video>`
              : `<img class="comment-image" src="${esc(c.image_url)}" alt="Comment media" loading="lazy">`
            : ""
        }
        <button class="comment-like ${c.liked ? "liked" : ""}" data-clid="${c.id}" type="button" title="Like reply">♥ ${c.likes || 0}</button>
      </div>${canDel ? `<button class="comment-del" data-cid="${c.id}" type="button" title="Delete">&times;</button>` : ""}`;
    bindRichLinks(row);
    row.querySelector("strong").onclick = () => nav(`#/profile/${encodeURIComponent(c.username)}`);
    row.querySelector(".comment-like").onclick = async () => {
      if (!state.user) return nav("#/login");
      try {
        const res = await api(`/api/comments/${c.id}/like`, { method: c.liked ? "DELETE" : "POST" });
        replacePostElement(art, res.post, true);
      } catch (e) {
        toast(e.message, true);
      }
    };
    const del = row.querySelector(".comment-del");
    if (del) {
      del.onclick = async () => {
        try {
          await api(`/api/comments/${c.id}`, { method: "DELETE" });
          const res = await api(`/api/posts/${post.id}`);
          replacePostElement(art, res.post, true);
        } catch (e) {
          toast(e.message, true);
        }
      };
    }
    commentsWrap.appendChild(row);
  });

  const form = tpl.querySelector(".comment-form");
  bindCommentForm(form, post.id, art);
  return art;
}

async function toggleLike(post, art) {
  if (!state.user) return nav("#/login");
  try {
    const res = await api(`/api/posts/${post.id}/like`, { method: post.liked ? "DELETE" : "POST" });
    replacePostElement(art, res.post);
  } catch (e) {
    toast(e.message, true);
  }
}

async function toggleSave(post, art) {
  if (!state.user) return nav("#/login");
  try {
    const res = await api(`/api/posts/${post.id}/save`, { method: post.saved ? "DELETE" : "POST" });
    toast(post.saved ? "Removed from saved" : "Saved");
    replacePostElement(art, res.post);
    if (state.route.name === "saved" && post.saved) loadSaved();
  } catch (e) {
    toast(e.message, true);
  }
}

function emptyState(icon, title, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

async function loadFeed() {
  setActiveNav("feed");
  if (!state.user) {
    showView("auth");
    return;
  }
  $("#view-feed").classList.remove("hidden");
  const list = $("#feed-list");
  list.innerHTML = `<div class="empty-state"><p class="muted">Loading threads...</p></div>`;
  loadStories();
  renderSuggestions();
  renderTrending();
  try {
    const { posts } = await api(`/api/posts?feed=${state.feedMode}`);
    list.innerHTML = "";
    if (!posts.length) {
      list.innerHTML = emptyState(
        `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
        state.feedMode === "following" ? "No threads yet" : "Start the conversation",
        state.feedMode === "following" ? "Follow people to see their threads here." : "Write your first thread above or attach a photo."
      );
      return;
    }
    posts.forEach((p) => list.appendChild(renderPost(p)));
  } catch (e) {
    list.innerHTML = emptyState("!", "Couldn't load feed", e.message);
  }
}

async function loadExplore(tag) {
  setActiveNav("explore");
  $("#view-explore").classList.remove("hidden");
  const grid = $("#explore-grid");
  const tagsEl = $("#trending-tags");
  grid.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const [postRes, tagRes] = await Promise.all([
      api(`/api/posts/explore${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`),
      api("/api/tags/trending"),
    ]);
    tagsEl.innerHTML = tagRes.tags.length
      ? `<button class="tag-pill ${!tag ? "active" : ""}" data-tag="" type="button">All</button>` +
        tagRes.tags
          .map((t) => `<button class="tag-pill ${tag === t.tag ? "active" : ""}" data-tag="${esc(t.tag)}" type="button">#${esc(t.tag)} · ${t.posts}</button>`)
          .join("")
      : "";
    $$(".tag-pill", tagsEl).forEach((b) => (b.onclick = () => nav(b.dataset.tag ? `#/explore/${encodeURIComponent(b.dataset.tag)}` : "#/explore")));
    if (!postRes.posts.length) {
      grid.innerHTML = emptyState("", "No threads to explore", "Threads from the community will show up here.");
      return;
    }
    grid.innerHTML = postRes.posts
      .map(
        (p) => `
      <article class="explore-card" data-post="${p.id}">
        <div class="explore-media">${
          p.image_url
            ? p.media_type === "video"
              ? `<video src="${esc(p.image_url)}" muted playsinline></video>`
              : `<img src="${esc(p.image_url)}" alt="" loading="lazy">`
            : `<div class="explore-no-media">${esc((p.content || "Thread").slice(0, 80))}</div>`
        }</div>
        <div class="explore-body">
          <div class="explore-author">${avatarHTML(p.author, "avatar xs")}<strong>${esc(p.author.username)}</strong></div>
          <p class="explore-text">${esc(p.content || "Shared media")}</p>
          <div class="explore-meta muted"><span>♥ ${p.likes}</span><span>💬 ${p.comments.length}</span><span>${esc(fmtDate(p.created_at))}</span></div>
        </div>
      </article>`
      )
      .join("");
    $$(".explore-card", grid).forEach((el) => (el.onclick = () => nav(`#/post/${el.dataset.post}`)));
  } catch (e) {
    grid.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function loadReels() {
  setActiveNav("reels");
  $("#view-reels").classList.remove("hidden");
  const list = $("#reels-list");
  list.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { posts } = await api("/api/reels");
    if (!posts.length) {
      list.innerHTML = emptyState("", "No reels yet", "Create a Reel to share a short video.");
      return;
    }
    list.innerHTML = "";
    posts.forEach((p) => list.appendChild(renderPost(p, { expandComments: false })));
  } catch (e) {
    list.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
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
    if (!posts.length) {
      list.innerHTML = emptyState("", "No saved threads", "Save threads to revisit them here.");
      return;
    }
    posts.forEach((p) => list.appendChild(renderPost(p)));
  } catch (e) {
    list.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function loadPost(id) {
  const el = $("#post-single");
  el.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { post } = await api(`/api/posts/${encodeURIComponent(id)}`);
    el.innerHTML = "";
    el.appendChild(renderPost(post, { expandComments: true }));
  } catch (e) {
    el.innerHTML = emptyState("", "Thread not found", e.message);
  }
}

async function loadProfile(username, tab = state.profileTab) {
  const target = username === "me" ? state.user?.username : username;
  if (!target) return nav("#/login");
  state.profileTab = tab;
  setActiveNav(username === "me" || (state.user && target.toLowerCase() === state.user.username.toLowerCase()) ? "profile" : "");
  $("#view-profile").classList.remove("hidden");
  const hero = $("#profile-hero");
  const postsEl = $("#profile-posts");
  hero.innerHTML = `<div style="padding:30px;text-align:center" class="muted">Loading...</div>`;
  postsEl.innerHTML = "";
  try {
    const { user: u } = await api(`/api/users/${encodeURIComponent(target)}`);
    let endpoint = `/api/users/${encodeURIComponent(target)}/posts`;
    if (tab === "reels") endpoint = `/api/users/${encodeURIComponent(target)}/reels`;
    if (tab === "saved") endpoint = "/api/posts/saved";
    const data = tab === "saved" && !u.isMe ? { posts: [], privateLocked: false } : await api(endpoint);
    const posts = data.posts || [];
    const privateLocked = !!data.privateLocked;
    const canFollow = state.user && !u.isMe;
    hero.innerHTML = `
      <div class="profile-row">
        <div class="profile-avatar-lg">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" onerror="this.remove()">` : esc((u.full_name || u.username)[0].toUpperCase())}</div>
        <div class="profile-identity">
          <div class="profile-top-line">
            <h1 class="profile-username">${esc(u.full_name || u.username)}</h1>
            <span class="muted small">@${esc(u.username)}</span>
            ${u.isPrivate ? '<span class="muted small">🔒 Private</span>' : ""}
            ${u.isMe ? `<button class="glass-btn small" id="edit-profile-btn" type="button">Edit profile</button>` : ""}
            ${u.isMe && u.isPrivate ? `<button class="glass-btn small" id="requests-btn" type="button">Requests</button>` : ""}
            ${u.isMe ? `<button class="glass-btn small" id="profile-logout-btn" type="button">Log out</button>` : ""}
            ${
              canFollow
                ? `<button class="glass-btn ${u.isFollowing || u.isRequested ? "" : "primary"} small" id="follow-btn" type="button">${
                    u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow"
                  }</button>
                  <button class="glass-btn small" id="message-user-btn" type="button">Message</button>`
                : ""
            }
          </div>
          <div class="profile-stats">
            <span><strong>${u.postsCount + u.reelsCount}</strong> threads</span>
            <button id="stat-followers" type="button"><strong>${u.followers}</strong> followers</button>
            <button id="stat-following" type="button"><strong>${u.following}</strong> following</button>
          </div>
          ${u.website ? `<div class="profile-meta"><a href="${esc(u.website)}" target="_blank" rel="noopener">${esc(u.website)}</a></div>` : ""}
          <div class="profile-bio">${esc(u.bio || (u.isMe ? "Add a bio to tell people about yourself." : ""))}</div>
        </div>
      </div>`;
    $$(".ptab").forEach((b) => b.classList.toggle("active", b.dataset.ptab === tab));
    if (u.isMe) {
      $("#edit-profile-btn").onclick = () => openEditProfile(u);
      $("#profile-logout-btn").onclick = logoutUser;
    }
    if (u.isMe && u.isPrivate) $("#requests-btn").onclick = () => showFollowRequests();
    const msgBtn = $("#message-user-btn");
    if (msgBtn) msgBtn.onclick = () => startMessageWith(u.username);
    const followBtn = $("#follow-btn");
    if (followBtn) {
      followBtn.onclick = async () => {
        followBtn.disabled = true;
        try {
          const isActive = u.isFollowing || u.isRequested;
          const res = await api(`/api/users/${encodeURIComponent(u.username)}/follow`, {
            method: isActive ? "DELETE" : "POST",
          });
          const next = res.user;
          u.isFollowing = next.isFollowing;
          u.isRequested = next.isRequested;
          followBtn.textContent = next.isRequested ? "Requested" : next.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow";
          followBtn.classList.toggle("primary", !(next.isFollowing || next.isRequested));
        } catch (e) {
          toast(e.message, true);
        } finally {
          followBtn.disabled = false;
        }
      };
    }
    $("#stat-followers").onclick = () => showUserList(u.username, "followers");
    $("#stat-following").onclick = () => showUserList(u.username, "following");

    if (privateLocked) {
      postsEl.innerHTML = emptyState(
        "🔒",
        "This account is private",
        `Follow @${u.username} to see their threads and reels.`
      );
    } else if (!posts.length) {
      postsEl.innerHTML = emptyState(
        "",
        `No ${tab} yet`,
        tab === "reels" ? "Reels will appear here." : tab === "saved" ? "Saved threads appear here." : `No threads from ${u.username} yet.`
      );
    } else posts.forEach((p) => postsEl.appendChild(renderPost(p)));
  } catch (e) {
    hero.innerHTML = emptyState("", "Profile not found", e.message);
  }
}

function openEditProfile(u) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#edit-profile-form").classList.remove("hidden");
  $("#modal .modal-head h3").textContent = "Edit profile";
  const form = $("#edit-profile-form");
  form.full_name.value = u.full_name || "";
  form.bio.value = u.bio || "";
  form.website.value = u.website || "";
  form.phone.value = u.phone || "";
  form.avatar_file.value = "";
  form.is_private.checked = !!u.isPrivate;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("full_name", form.full_name.value);
      fd.append("bio", form.bio.value);
      fd.append("website", form.website.value);
      fd.append("phone", form.phone.value);
      fd.append("is_private", form.is_private.checked ? "true" : "false");
      if (form.avatar_file.files?.[0]) fd.append("avatar_url", form.avatar_file.files[0]);
      await api("/api/users/me", { method: "PATCH", body: fd });
      closeModal("modal");
      toast("Profile updated");
      await loadMe();
      refresh();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };
}

async function showUserList(username, type) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#edit-profile-form").classList.add("hidden");
  $("#modal .modal-head h3").textContent = type === "followers" ? "Followers" : "Following";
  let body = modal.querySelector(".modal-body-list");
  if (!body) {
    body = document.createElement("div");
    body.className = "modal-body-list";
    modal.querySelector(".modal-card").appendChild(body);
  }
  body.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { users } = await api(`/api/users/${encodeURIComponent(username)}/${type}`);
    body.innerHTML = users.length
      ? users
          .map(
            (u) =>
              `<div class="suggest-row" style="padding:7px 0">${avatarHTML(u, "avatar xs")}<div class="s-info"><span class="s-name" data-u="${esc(
                u.username
              )}">${esc(u.full_name || u.username)}</span></div><span class="muted small">@${esc(u.username)}</span></div>`
          )
          .join("")
      : `<p class="muted">No ${type} yet.</p>`;
    $$("[data-u]", body).forEach((n) => (n.onclick = () => { closeModal("modal"); nav(`#/profile/${encodeURIComponent(n.dataset.u)}`); }));
  } catch (e) {
    body.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function showFollowRequests() {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#edit-profile-form").classList.add("hidden");
  $("#modal .modal-head h3").textContent = "Follow requests";
  let body = modal.querySelector(".modal-body-list");
  if (!body) {
    body = document.createElement("div");
    body.className = "modal-body-list";
    modal.querySelector(".modal-card").appendChild(body);
  }
  body.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { users } = await api("/api/users/me/follow-requests");
    if (!users.length) {
      body.innerHTML = `<p class="muted">No pending requests.</p>`;
      return;
    }
    body.innerHTML = users
      .map(
        (u) =>
          `<div class="suggest-row" style="padding:7px 0">${avatarHTML(u, "avatar xs")}<div class="s-info"><span class="s-name" data-u="${esc(
            u.username
          )}">${esc(u.username)}</span></div><button class="btn-text" data-accept="${esc(u.username)}" type="button">Accept</button><button class="btn-text danger" data-decline="${esc(
            u.username
          )}" type="button">Decline</button></div>`
      )
      .join("");
    $$("[data-accept]", body).forEach((b) => (b.onclick = async () => { await api(`/api/users/me/follow-requests/${encodeURIComponent(b.dataset.accept)}/accept`, { method: "POST" }); showFollowRequests(); refresh(); }));
    $$("[data-decline]", body).forEach((b) => (b.onclick = async () => { await api(`/api/users/me/follow-requests/${encodeURIComponent(b.dataset.decline)}`, { method: "DELETE" }); showFollowRequests(); }));
  } catch (e) {
    body.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

// ── Messages ──────────────────────────────────────────────────────────────
async function loadMessages(username) {
  if (!state.user) return nav("#/login");
  setActiveNav("messages");
  $("#view-messages").classList.remove("hidden");
  const list = $("#conversation-list");
  list.innerHTML = `<p class="muted" style="padding:12px">Loading...</p>`;
  try {
    const { conversations } = await api("/api/messages/conversations");
    list.innerHTML = conversations.length
      ? conversations
          .map(
            (c) => `
      <div class="conversation ${state.conversation === c.user.username ? "active" : ""}" data-user="${esc(c.user.username)}">
        ${avatarHTML(c.user, "avatar sm")}
        <div class="c-info">
          <span class="c-name">${esc(c.user.full_name || c.user.username)}</span>
          <span class="c-last">${esc(c.last_message ? c.last_message.body || "📎 Media" : "No messages yet")}</span>
        </div>
        ${c.unread ? '<span class="unread-dot"></span>' : ""}
      </div>`
          )
          .join("")
      : `<p class="muted small" style="padding:14px">No conversations yet. Visit someone's profile to start a chat.</p>`;
    $$(".conversation", list).forEach((el) => (el.onclick = () => nav(`#/messages/${encodeURIComponent(el.dataset.user)}`)));
    const target = username || state.conversation || conversations[0]?.user.username;
    if (target) await openConversation(target);
    else {
      $("#chat-panel").innerHTML = `<div class="chat-empty muted">Select a conversation to start chatting.</div>`;
      $("#message-form").classList.add("hidden");
    }
  } catch (e) {
    list.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function openConversation(username) {
  try {
    const { user, messages } = await api(`/api/messages/${encodeURIComponent(username)}`);
    state.conversation = username;
    state.messages = messages;
    $$(".conversation").forEach((el) => el.classList.toggle("active", el.dataset.user === username));
    const panel = $("#chat-panel");
    panel.innerHTML = `<div class="chat-head">${avatarHTML(user, "avatar sm")}<strong>${esc(
      user.full_name || user.username
    )}</strong><button class="btn-text" id="chat-profile-btn" type="button">Profile</button></div>
      <div id="chat-messages"></div>`;
    $("#chat-profile-btn").onclick = () => nav(`#/profile/${encodeURIComponent(user.username)}`);
    renderMessages();
    $("#message-form").classList.remove("hidden");
    renderBadges();
    setTimeout(() => {
      panel.scrollTop = panel.scrollHeight;
    }, 60);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderMessages() {
  const el = $("#chat-messages");
  if (!el) return;
  el.innerHTML = state.messages
    .map((m) => {
      const mine = state.user && m.sender.id === state.user.id;
      return `<div class="msg-row ${mine ? "mine" : ""}" data-id="${m.id}">
      ${mine ? `<button class="msg-del" data-del-msg="${m.id}" type="button" title="Delete message">&times;</button>` : ""}
      <div class="msg-bubble">
        ${m.body ? esc(m.body) : ""}
        ${m.image_url ? (/\.(mp4|webm|mov)/i.test(m.image_url) ? `<video src="${esc(m.image_url)}" controls></video>` : `<img src="${esc(m.image_url)}" alt="Attachment">`) : ""}
        <div class="msg-time">${esc(fmtDate(m.created_at))}${mine && m.read ? " · Seen" : ""}</div>
      </div>
    </div>`;
    })
    .join("");
  $$("[data-del-msg]", el).forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/api/messages/${btn.dataset.delMsg}`, { method: "DELETE" });
        state.messages = state.messages.filter((m) => String(m.id) !== String(btn.dataset.delMsg));
        renderMessages();
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
}

let dmSearchTimer;
function bindDmSearch() {
  const input = $("#dm-user-search");
  const box = $("#dm-search-results");
  if (!input || !box) return;
  input.addEventListener("input", () => {
    clearTimeout(dmSearchTimer);
    const q = input.value.trim();
    if (!q) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    dmSearchTimer = setTimeout(async () => {
      try {
        const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        const filtered = users.filter((u) => !u.isMe);
        box.innerHTML = filtered.length
          ? filtered
              .map(
                (u) => `<button class="dm-search-item" data-dm-user="${esc(u.username)}" type="button">${avatarHTML(u, "avatar xs")}<span>${esc(u.full_name || u.username)}</span><span class="muted small">@${esc(u.username)}</span></button>`
              )
              .join("")
          : `<div class="muted small" style="padding:8px 10px">No users found.</div>`;
        $$("[data-dm-user]", box).forEach((b) => {
          b.onclick = () => {
            box.classList.add("hidden");
            input.value = "";
            nav(`#/messages/${encodeURIComponent(b.dataset.dmUser)}`);
          };
        });
        box.classList.remove("hidden");
      } catch {
        box.classList.add("hidden");
      }
    }, 200);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dm-search-box")) box.classList.add("hidden");
  });
}

function bindMessageForm() {
  const form = $("#message-form");
  const input = $("#message-input");
  const fileInput = $("#message-file");
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!state.conversation) return toast("Choose a conversation first", true);
    const body = input.value.trim();
    const file = fileInput.files?.[0];
    if (!body && !file) return;
    try {
      const fd = new FormData();
      fd.append("body", body);
      if (file) fd.append("media", file);
      const { message } = await api(`/api/messages/${encodeURIComponent(state.conversation)}`, { method: "POST", body: fd });
      state.messages.push(message);
      input.value = "";
      fileInput.value = "";
      renderMessages();
      const panel = $("#chat-panel");
      setTimeout(() => {
        panel.scrollTop = panel.scrollHeight;
      }, 40);
      loadMessages(state.conversation);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function startMessageWith(username) {
  if (!state.user) return nav("#/login");
  nav(`#/messages/${encodeURIComponent(username)}`);
}

// ── Notifications ─────────────────────────────────────────────────────────
async function loadNotifications() {
  if (!state.user) return nav("#/login");
  setActiveNav("notifications");
  $("#view-notifications").classList.remove("hidden");
  const list = $("#notifications-list");
  list.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const [notifRes, reqRes] = await Promise.all([
      api("/api/notifications"),
      api("/api/users/me/follow-requests").catch(() => ({ users: [] })),
    ]);
    const reqHtml = reqRes.users?.length
      ? `<div class="follow-requests-box">
          <h3>Follow requests (${reqRes.users.length})</h3>
          ${reqRes.users
            .map(
              (u) => `<div class="suggest-row">${avatarHTML(u, "avatar xs")}<div class="s-info"><span class="s-name" data-u="${esc(
                u.username
              )}">${esc(u.full_name || u.username)}</span><span class="s-sub">@${esc(u.username)}</span></div>
                <button class="btn small primary" data-req-accept="${esc(u.username)}" type="button">Accept</button>
                <button class="btn small" data-req-decline="${esc(u.username)}" type="button">Decline</button></div>`
            )
            .join("")}
        </div>`
      : "";
    const notifsHtml = notifRes.notifications.length
      ? notifRes.notifications
          .map(
            (n) => `
      <div class="notification ${n.read ? "" : "unread"}" data-id="${n.id}" data-post="${n.post_id || ""}" data-user="${esc(n.actor.username)}">
        ${avatarHTML(n.actor, "avatar sm")}
        <div class="n-text"><strong>${esc(n.actor.username)}</strong> ${esc(n.text)}</div>
        <span class="n-time">${esc(fmtDate(n.created_at))}</span>
      </div>`
          )
          .join("")
      : reqRes.users?.length
      ? ""
      : emptyState("", "No activity yet", "Likes, replies and new followers will show up here.");
    list.innerHTML = reqHtml + notifsHtml;

    $$("[data-u]", list).forEach((n) => (n.onclick = () => nav(`#/profile/${encodeURIComponent(n.dataset.u)}`)));
    $$("[data-req-accept]", list).forEach((b) => {
      b.onclick = async () => {
        await api(`/api/users/me/follow-requests/${encodeURIComponent(b.dataset.reqAccept)}/accept`, { method: "POST" });
        toast("Follow request accepted");
        loadNotifications();
      };
    });
    $$("[data-req-decline]", list).forEach((b) => {
      b.onclick = async () => {
        await api(`/api/users/me/follow-requests/${encodeURIComponent(b.dataset.reqDecline)}`, { method: "DELETE" });
        loadNotifications();
      };
    });
    $$(".notification", list).forEach(
      (el) =>
        (el.onclick = async () => {
          try {
            await api(`/api/notifications/${el.dataset.id}/read`, { method: "POST" });
          } catch {}
          if (el.dataset.post) nav(`#/post/${el.dataset.post}`);
          else if (el.dataset.user) nav(`#/profile/${encodeURIComponent(el.dataset.user)}`);
        })
    );
    renderBadges();
  } catch (e) {
    list.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function searchUserRowHTML(u) {
  const followLabel = u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow";
  return `<div class="search-user-row">${avatarHTML(u, "avatar sm")}
    <div class="s-info" style="cursor:pointer" data-profile="${esc(u.username)}"><strong>${esc(u.full_name || u.username)}</strong><div class="muted small">@${esc(u.username)}</div></div>
    ${
      state.user && !u.isMe
        ? `<button class="btn small ${u.isFollowing || u.isRequested ? "" : "primary"}" data-sfollow="${esc(u.username)}" data-following="${u.isFollowing ? "1" : "0"}" data-requested="${u.isRequested ? "1" : "0"}" type="button">${followLabel}</button>
           <button class="btn small" data-smsg="${esc(u.username)}" type="button">Message</button>`
        : ""
    }
  </div>`;
}

function bindSearchUserActions(container) {
  $$("[data-profile]", container).forEach((b) => (b.onclick = () => nav(`#/profile/${encodeURIComponent(b.dataset.profile)}`)));
  $$("[data-smsg]", container).forEach((b) => (b.onclick = () => startMessageWith(b.dataset.smsg)));
  $$("[data-sfollow]", container).forEach((btn) => {
    btn.onclick = async () => {
      const username = btn.dataset.sfollow;
      const active = btn.dataset.following === "1" || btn.dataset.requested === "1";
      btn.disabled = true;
      try {
        const res = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: active ? "DELETE" : "POST" });
        const next = res.user;
        btn.dataset.following = next.isFollowing ? "1" : "0";
        btn.dataset.requested = next.isRequested ? "1" : "0";
        btn.textContent = next.isRequested ? "Requested" : next.isFollowing ? "Following" : next.isPrivate ? "Request" : "Follow";
        btn.classList.toggle("primary", !(next.isFollowing || next.isRequested));
      } catch (e) {
        toast(e.message, true);
      } finally {
        btn.disabled = false;
      }
    };
  });
}

// ── Search Page ───────────────────────────────────────────────────────────
async function loadSearchPage(q) {
  setActiveNav("search");
  $("#view-search").classList.remove("hidden");
  const input = $("#search-page-input");
  const results = $("#search-page-results");
  if (q && input.value !== q) input.value = q;
  if (!q) {
    const [trending, suggested] = await Promise.all([
      api("/api/tags/trending").catch(() => ({ tags: [] })),
      api("/api/users/suggested?limit=20").catch(() => ({ users: [] })),
    ]);
    results.innerHTML = `
      ${suggested.users.length ? `<div class="search-section"><h3>Suggested people</h3>${suggested.users.map(searchUserRowHTML).join("")}</div>` : ""}
      ${trending.tags.length ? `<div class="search-section"><h3>Trending hashtags</h3><div class="tag-row">${trending.tags.map((t) => `<button class="tag-pill" data-tag="#${esc(t.tag)}" type="button">#${esc(t.tag)} · ${t.posts}</button>`).join("")}</div></div>` : ""}
      ${!suggested.users.length && !trending.tags.length ? `<p class="muted">Start typing above to search people, threads and hashtags.</p>` : ""}`;
    bindSearchUserActions(results);
    $$(".tag-pill", results).forEach((b) => (b.onclick = () => searchFor(b.dataset.tag)));
    return;
  }
  results.innerHTML = `<p class="muted">Searching...</p>`;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const users = data.users.map(searchUserRowHTML).join("");
    const tags = data.tags
      .map((t) => `<button class="tag-pill" data-tag="#${esc(t.tag)}" type="button">#${esc(t.tag)} · ${t.posts}</button>`)
      .join("");
    const posts = data.posts
      .map(
        (p) =>
          `<div class="search-grid-item" data-post="${p.id}">${
            p.image_url
              ? p.media_type === "video"
                ? `<video src="${esc(p.image_url)}" muted></video>`
                : `<img src="${esc(p.image_url)}" alt="">`
              : `<div style="padding:10px;font-size:11.5px">${esc((p.content || "Thread").slice(0, 60))}</div>`
          }</div>`
      )
      .join("");
    results.innerHTML = `
      <div class="search-section"><h3>People</h3>${users || '<p class="muted small">No people found.</p>'}</div>
      <div class="search-section"><h3>Hashtags</h3><div class="tag-row">${tags || '<p class="muted small">No hashtags found.</p>'}</div></div>
      <div class="search-section"><h3>Threads</h3><div class="search-grid">${posts || '<p class="muted small">No threads found.</p>'}</div></div>`;
    bindSearchUserActions(results);
    $$("[data-tag]", results).forEach((b) => (b.onclick = () => searchFor(b.dataset.tag)));
    $$("[data-post]", results).forEach((b) => (b.onclick = () => nav(`#/post/${b.dataset.post}`)));
  } catch (e) {
    results.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

let pageSearchTimer;
function bindSearchPage() {
  const input = $("#search-page-input");
  if (!input) return;
  input.addEventListener("input", () => {
    clearTimeout(pageSearchTimer);
    const q = input.value.trim();
    pageSearchTimer = setTimeout(() => {
      if (q) history.replaceState(null, "", `#/search/${encodeURIComponent(q)}`);
      loadSearchPage(q);
    }, 250);
  });
}

// ── Modal helpers & Routing ───────────────────────────────────────────────
function closeModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.add("hidden");
  if (id === "modal") {
    $("#edit-profile-form")?.classList.remove("hidden");
    $("#modal .modal-head h3").textContent = "Edit profile";
    modal?.querySelector(".modal-body-list")?.remove();
  }
  if (id === "story-modal") clearStoryTimer();
  if (id === "create-modal") resetCreate();
}

function closeAllModals() {
  ["modal", "create-modal", "story-modal"].forEach(closeModal);
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
  closeAllModals();
  if (!state.user && !GUEST_ALLOWED_ROUTES.has(state.route.name)) {
    if (location.hash && location.hash !== "#/" && location.hash !== "#/login") {
      state.redirectAfterAuth = location.hash;
    }
    showView("auth");
    setActiveNav("");
    setAuthTab(false);
    return;
  }
  showView(state.route.name);
  switch (state.route.name) {
    case "auth":
      setActiveNav("");
      setAuthTab(state.route.param === "register");
      return;
    case "explore":
      renderSuggestions();
      renderTrending();
      return loadExplore(state.route.param);
    case "reels":
      renderSuggestions();
      renderTrending();
      return loadReels();
    case "messages":
      renderSuggestions();
      renderTrending();
      return loadMessages(state.route.param);
    case "notifications":
      renderSuggestions();
      renderTrending();
      return loadNotifications();
    case "search":
      renderSuggestions();
      renderTrending();
      return loadSearchPage(state.route.param || "");
    case "post":
      renderSuggestions();
      renderTrending();
      return loadPost(state.route.param);
    case "saved":
      renderSuggestions();
      renderTrending();
      return loadSaved();
    case "profile":
      renderSuggestions();
      renderTrending();
      return loadProfile(state.route.param);
    default:
      return loadFeed();
  }
}

function bindAuth() {
  $$(".tab").forEach((tab) => {
    tab.onclick = () => setAuthTab(tab.dataset.authTab === "register");
  });
  $("#switch-to-register")?.addEventListener("click", () => setAuthTab(true));
  $("#switch-to-login")?.addEventListener("click", () => setAuthTab(false));
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
      });
      await loadMe();
      finishAuth("Welcome back!");
    } catch (err) {
      toast(err.message, true);
    }
  };
  $("#register-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: fd.get("username"),
          full_name: fd.get("full_name"),
          phone: fd.get("phone"),
          password: fd.get("password"),
          bio: fd.get("bio"),
        }),
      });
      await loadMe();
      finishAuth("Account created!");
    } catch (err) {
      toast(err.message, true);
    }
  };
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
  $$(".ptab").forEach((btn) => {
    btn.onclick = () => {
      const username = state.route.name === "profile" ? state.route.param : state.user?.username;
      if (username) loadProfile(username, btn.dataset.ptab);
    };
  });
  $("#create-btn").onclick = () => openCreate("post");
  $("#open-composer").onclick = () => openCreate("post");
  $("#new-reel-btn")?.addEventListener("click", () => openCreate("reel"));
  $("#composer-story-btn")?.addEventListener("click", () => openCreate("story"));
  $("#logout-dock-btn")?.addEventListener("click", logoutUser);
  $("#story-prev").onclick = prevStory;
  $("#story-next").onclick = nextStory;
  $("#post-back-btn").onclick = () => (history.length > 1 ? history.back() : nav("#/"));
  $("#mark-read-btn").onclick = async () => {
    try {
      await api("/api/notifications/read", { method: "POST" });
      renderBadges();
      loadNotifications();
    } catch (e) {
      toast(e.message, true);
    }
  };
  document.addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) closeModal(close.dataset.close);
    if (!e.target.closest(".post-menu-wrap")) $$(".post-menu").forEach((m) => m.classList.add("hidden"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
    if (!$("#story-modal").classList.contains("hidden")) {
      if (e.key === "ArrowRight") nextStory();
      if (e.key === "ArrowLeft") prevStory();
    }
  });
  window.addEventListener("hashchange", route);
  bindInlineComposer();
  bindMessageForm();
  bindDmSearch();
  bindSearchPage();
}

(async function init() {
  bindCreate();
  bindAuth();
  bindUI();
  await loadMe();
  await route();
  setInterval(renderBadges, 30000);
  setInterval(() => {
    if (state.user && state.route.name === "messages" && state.conversation) {
      api(`/api/messages/${encodeURIComponent(state.conversation)}`)
        .then((res) => {
          if (res.messages.length !== state.messages.length) {
            state.messages = res.messages;
            renderMessages();
          }
        })
        .catch(() => {});
    }
  }, 5000);
})();
