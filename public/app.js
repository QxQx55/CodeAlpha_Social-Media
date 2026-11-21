const state = {
  user: null,
  route: { name: "feed", param: null },
  feedMode: "all",
  profileTab: "posts",
  createKind: "post",
  createFile: null,
  createStream: null,
  createRecorder: null,
  createPreviewUrl: null,
  storyGroups: [],
  storyGroupIndex: 0,
  storyIndex: 0,
  storyTimer: null,
  conversation: null,
  messages: [],
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
  if (!state.user) { setBadge("#msg-badge", 0); setBadge("#notif-badge", 0); return; }
  try {
    const [m, n] = await Promise.all([
      api("/api/messages/unread"),
      api("/api/notifications"),
    ]);
    setBadge("#msg-badge", m.count);
    setBadge("#notif-badge", n.unread);
  } catch {}
}

function renderAuthActions() {
  const el = $("#auth-actions");
  if (state.user) {
    el.innerHTML = `<button class="btn ghost small" id="logout-btn">Log out</button>`;
    $("#logout-btn").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null; state.conversation = null;
      toast("Logged out");
      syncUI(); nav("#/");
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
    el.innerHTML = `<div class="side-user-row"><div class="side-user-info"><span class="name">Welcome to Wave</span><span class="sub">Sign in to share and connect</span></div></div><div style="margin-top:12px"><a class="btn primary btn-block small" href="#/login">Log in</a></div>`;
    return;
  }
  const u = state.user;
  el.innerHTML = `
    <div class="side-user-row">
      ${avatarHTML(u, "avatar")}
      <div class="side-user-info">
        <a href="#/profile/${esc(u.username)}" class="name">${esc(u.username)}</a>
        <span class="sub">${esc(u.full_name || u.bio || "Welcome back")}</span>
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
          <span class="s-sub">${esc(u.full_name || u.bio || "Suggested for you")}</span>
        </div>
        ${state.user && !u.isMe ? `<button class="btn-text" data-follow="${esc(u.username)}" data-following="${u.isFollowing ? "1" : "0"}" data-requested="${u.isRequested ? "1" : "0"}">${u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow"}</button>` : ""}
      </div>`).join("");
    el.querySelectorAll("[data-user]").forEach((n) => n.onclick = () => nav(`#/profile/${encodeURIComponent(n.dataset.user)}`));
    el.querySelectorAll("[data-follow]").forEach((btn) => {
      btn.onclick = async () => {
        if (!state.user) return nav("#/login");
        const username = btn.dataset.follow;
        const following = btn.dataset.following === "1";
        btn.disabled = true;
        try {
          const res = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: following ? "DELETE" : "POST" });
          const u = res.user;
          btn.dataset.following = u.isFollowing ? "1" : "0";
          btn.dataset.requested = u.isRequested ? "1" : "0";
          btn.textContent = u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow";
          if (state.route.name === "profile") refresh();
        } catch (e) { toast(e.message, true); }
        finally { btn.disabled = false; }
      };
    });
  } catch { el.innerHTML = ""; }
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
    if (state.user.avatar_url) {
      const img = document.createElement("img");
      img.src = state.user.avatar_url;
      img.onerror = () => { ca.textContent = state.user.username[0].toUpperCase(); };
      ca.appendChild(img);
    } else ca.textContent = state.user.username[0].toUpperCase();
  }
  renderBadges();
}

async function loadMe() {
  try { state.user = (await api("/api/auth/me")).user; } catch { state.user = null; }
  syncUI();
}

function stopMediaStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

// ── Create post / reel / story ────────────────────────────────────────────
function resetCreate() {
  state.createFile = null;
  $("#create-caption").value = "";
  $("#create-url").value = "";
  $("#create-count").textContent = "0/2200";
  const preview = $("#create-preview");
  if (state.createPreviewUrl) URL.revokeObjectURL(state.createPreviewUrl);
  state.createPreviewUrl = null;
  preview.classList.add("hidden");
  preview.innerHTML = "";
  $("#create-file").value = "";
  stopCreateCamera();
}

function openCreate(kind = "post") {
  if (!state.user) return nav("#/login");
  state.createKind = kind;
  resetCreate();
  $$(".create-tab").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  $("#create-share").textContent = kind === "story" ? "Share story" : "Share";
  $("#create-caption").placeholder = kind === "story"
    ? "Add a caption to your story (optional)"
    : "Write a caption... use #hashtags and @mentions";
  $("#create-modal").classList.remove("hidden");
  setTimeout(() => $("#create-caption").focus(), 50);
}

function setCreateFile(file) {
  if (!file) return;
  state.createFile = file;
  $("#create-url").value = "";
  $("#create-file").value = "";
  const preview = $("#create-preview");
  if (state.createPreviewUrl) URL.revokeObjectURL(state.createPreviewUrl);
  state.createPreviewUrl = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");
  preview.innerHTML = `${isVideo
    ? `<video src="${state.createPreviewUrl}" controls playsinline></video>`
    : `<img src="${state.createPreviewUrl}" alt="Preview">`}
    <button type="button" class="remove-media" aria-label="Remove">&times;</button>`;
  preview.classList.remove("hidden");
  preview.querySelector(".remove-media").onclick = () => {
    state.createFile = null;
    URL.revokeObjectURL(state.createPreviewUrl);
    state.createPreviewUrl = null;
    preview.classList.add("hidden");
    preview.innerHTML = "";
  };
}

async function startCreateCamera() {
  try {
    stopCreateCamera();
    state.createStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
    $("#create-camera-video").srcObject = state.createStream;
    $("#create-camera").classList.remove("hidden");
  } catch {
    toast("Camera unavailable. You can upload a photo or video instead.", true);
  }
}
function stopCreateCamera() {
  stopMediaStream(state.createStream);
  state.createStream = null;
  const video = $("#create-camera-video");
  if (video) video.srcObject = null;
  $("#create-camera")?.classList.add("hidden");
  if (state.createRecorder?.state === "recording") state.createRecorder.stop();
  state.createRecorder = null;
  const recBtn = $("#create-record-video");
  if (recBtn) recBtn.textContent = "Record video";
}
function captureCreatePhoto() {
  const video = $("#create-camera-video");
  if (!video.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) { setCreateFile(new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" })); stopCreateCamera(); }
  }, "image/jpeg", 0.92);
}
function toggleRecordVideo() {
  const btn = $("#create-record-video");
  if (state.createRecorder?.state === "recording") { state.createRecorder.stop(); return; }
  if (!state.createStream) return toast("Open the camera first", true);
  const mime = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
  const chunks = [];
  state.createRecorder = new MediaRecorder(state.createStream, mime ? { mimeType: mime } : undefined);
  state.createRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  state.createRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime || "video/webm" });
    if (blob.size) setCreateFile(new File([blob], `camera-${Date.now()}.webm`, { type: blob.type }));
    btn.textContent = "Record video";
    state.createRecorder = null;
    stopCreateCamera();
  };
  state.createRecorder.start();
  btn.textContent = "Stop recording";
}

function bindCreate() {
  $$(".create-tab").forEach((tab) => tab.onclick = () => openCreate(tab.dataset.kind));
  $("#create-file").onchange = (e) => { const f = e.target.files?.[0]; if (f) setCreateFile(f); };
  $("#create-url").addEventListener("input", (e) => {
    const url = e.target.value.trim();
    if (!url) { state.createFile = null; $("#create-preview").classList.add("hidden"); return; }
    state.createFile = null;
    const preview = $("#create-preview");
    preview.innerHTML = /^https?:\/\/.+/i.test(url)
      ? `<img src="${esc(url)}" alt="Preview" onerror="this.parentElement.classList.add('hidden')">`
      : "";
    preview.classList.toggle("hidden", !/^https?:\/\/.+/i.test(url));
  });
  $("#create-caption").addEventListener("input", (e) => { $("#create-count").textContent = `${e.target.value.length}/2200`; });
  $("#create-camera-btn").onclick = startCreateCamera;
  $("#create-capture-photo").onclick = captureCreatePhoto;
  $("#create-record-video").onclick = toggleRecordVideo;
  $("#create-camera-stop").onclick = stopCreateCamera;
  $("#create-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.user) return nav("#/login");
    const content = $("#create-caption").value.trim();
    const url = $("#create-url").value.trim();
    if (!content && !state.createFile && !url) return toast("Add a caption or media", true);
    if (state.createKind === "story" && !state.createFile && !url) return toast("Stories need a photo or video", true);
    const btn = $("#create-share");
    btn.disabled = true;
    try {
      const fd = new FormData();
      const isStory = state.createKind === "story";
      fd.append(isStory ? "caption" : "content", content);
      if (!isStory) fd.append("kind", state.createKind);
      if (state.createFile) fd.append("media", state.createFile);
      else if (url) fd.append("image_url", url);
      await api(isStory ? "/api/stories" : "/api/posts", { method: "POST", body: fd });
      closeModal("create-modal");
      toast(isStory ? "Story added" : state.createKind === "reel" ? "Reel shared" : "Post shared");
      refresh();
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  };
}

// ── Stories ───────────────────────────────────────────────────────────────
async function loadStories() {
  const bar = $("#stories-bar");
  if (!bar) return;
  try {
    const { stories } = await api("/api/stories");
    state.storyGroups = stories;
    const add = state.user ? `<div class="story story-add" data-add-story><div class="story-ring"><div class="story-ring-inner">+</div></div><span class="story-name">Your story</span></div>` : "";
    bar.innerHTML = add + stories.map((g, i) => `
      <div class="story" data-story-group="${i}">
        <div class="story-ring ${g.seen ? "seen" : ""}"><div class="story-ring-inner">${g.user.avatar_url ? `<img src="${esc(g.user.avatar_url)}" alt="">` : esc(g.user.username[0].toUpperCase())}</div></div>
        <span class="story-name">${esc(g.user.username)}</span>
      </div>`).join("");
    bar.classList.remove("hidden");
    bar.querySelector("[data-add-story]")?.addEventListener("click", () => openCreate("story"));
    $$("[data-story-group]", bar).forEach((el) => el.onclick = () => openStoryViewer(Number(el.dataset.storyGroup), 0));
  } catch { bar.classList.add("hidden"); }
}

function clearStoryTimer() { clearTimeout(state.storyTimer); state.storyTimer = null; }

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
    if (state.storyGroupIndex < state.storyGroups.length - 1) { state.storyGroupIndex++; state.storyIndex = 0; return renderStory(); }
    return closeModal("story-modal");
  }
  const stage = $("#story-stage");
  stage.innerHTML = story.media_type === "video"
    ? `<video src="${esc(story.media_url)}" autoplay playsinline controls></video>`
    : `<img src="${esc(story.media_url)}" alt="Story">`;
  $("#story-progress").innerHTML = group.stories.map((_, i) => `<div class="story-bar ${i <= state.storyIndex ? "active" : ""}"></div>`).join("");
  $("#story-caption").textContent = story.caption || `@${group.user.username}`;
  $("#story-views").textContent = `Views ${story.views}`;
  $("#story-delete").classList.toggle("hidden", group.user.id !== state.user?.id);
  $("#story-delete").onclick = async () => {
    try { await api(`/api/stories/${story.id}`, { method: "DELETE" }); closeModal("story-modal"); refresh(); }
    catch (e) { toast(e.message, true); }
  };
  api(`/api/stories/${story.id}/view`, { method: "POST" }).catch(() => {});
  state.storyTimer = setTimeout(nextStory, 5000);
}

function nextStory() {
  const group = state.storyGroups[state.storyGroupIndex];
  if (!group) return closeModal("story-modal");
  if (state.storyIndex < group.stories.length - 1) state.storyIndex++;
  else if (state.storyGroupIndex < state.storyGroups.length - 1) { state.storyGroupIndex++; state.storyIndex = 0; }
  else return closeModal("story-modal");
  renderStory();
}
function prevStory() {
  const group = state.storyGroups[state.storyGroupIndex];
  if (state.storyIndex > 0) state.storyIndex--;
  else if (state.storyGroupIndex > 0) { state.storyGroupIndex--; state.storyIndex = state.storyGroups[state.storyGroupIndex].stories.length - 1; }
  renderStory();
}

// ── Comments ──────────────────────────────────────────────────────────────
function bindCommentForm(form, postId) {
  const input = form.querySelector('input[name="comment"]');
  const submit = form.querySelector(".comment-submit");
  const fileInput = form.querySelector('input[name="image_file"]');
  const camBtn = form.querySelector(".comment-cam-btn");
  const tools = form.querySelector(".comment-tools");
  const camBox = form.querySelector(".camera-box");
  const video = camBox.querySelector("video");
  const captureBtn = form.querySelector(".comment-capture");
  const camClose = form.querySelector(".comment-cam-close");
  const preview = form.querySelector(".comment-preview");
  let file = null;
  let stream = null;
  let previewUrl = null;

  const syncTools = () => tools.classList.toggle("hidden", !(file || !camBox.classList.contains("hidden")));
  const update = () => { submit.disabled = !(input.value.trim() || file); };
  const setPreview = (f) => {
    file = f;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (!f) { preview.classList.add("hidden"); preview.innerHTML = ""; syncTools(); update(); return; }
    previewUrl = URL.createObjectURL(f);
    const isVideo = f.type.startsWith("video/");
    preview.classList.remove("hidden");
    preview.innerHTML = `${isVideo ? `<video src="${previewUrl}" controls></video>` : `<img src="${previewUrl}" alt="Preview">`}
      <button type="button" class="remove-media" aria-label="Remove">&times;</button>`;
    preview.querySelector(".remove-media").onclick = () => { fileInput.value = ""; setPreview(null); };
    syncTools(); update();
  };

  input.addEventListener("input", update);
  fileInput.addEventListener("change", () => { const f = fileInput.files?.[0]; if (f) setPreview(f); });
  camBtn.onclick = async () => {
    try {
      stopMediaStream(stream);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
      camBox.classList.remove("hidden");
      syncTools();
    } catch { toast("Camera unavailable. You can upload media instead.", true); }
  };
  const closeCam = () => { stopMediaStream(stream); stream = null; video.srcObject = null; camBox.classList.add("hidden"); syncTools(); };
  camClose.onclick = closeCam;
  captureBtn.onclick = () => {
    if (!video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => { if (blob) { setPreview(new File([blob], `comment-camera-${Date.now()}.jpg`, { type: "image/jpeg" })); closeCam(); } }, "image/jpeg", 0.92);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content && !file) return;
    submit.disabled = true;
    try {
      const fd = new FormData();
      fd.append("content", content);
      if (file) fd.append("media", file);
      await api(`/api/posts/${postId}/comments`, { method: "POST", body: fd });
      input.value = ""; fileInput.value = "";
      closeCam(); setPreview(null);
      refresh();
    } catch (err) { toast(err.message, true); update(); }
  };
}

function searchFor(q) {
  const value = String(q || "").trim();
  if (!value) return;
  $("#global-search").value = value;
  nav(`#/search/${encodeURIComponent(value)}`);
}

function renderPost(post, opts = {}) {
  const tpl = $("#post-template").content.cloneNode(true);
  const art = tpl.querySelector(".post");
  art.dataset.postId = post.id;
  const authorUrl = `#/profile/${encodeURIComponent(post.author.username)}`;

  const av = tpl.querySelector(".post-avatar");
  av.innerHTML = (post.author.avatar_url ? `<img src="${esc(post.author.avatar_url)}" alt="" onerror="this.remove()">` : "") + esc(post.author.username[0].toUpperCase());
  av.onclick = () => nav(authorUrl);
  const author = tpl.querySelector(".post-author");
  author.textContent = post.author.username;
  author.onclick = () => nav(authorUrl);
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
    imgWrap.ondblclick = () => { if (state.user && !post.liked) toggleLike(post); };
  }

  const captionAuthor = tpl.querySelector(".caption-author");
  captionAuthor.textContent = post.author.username;
  captionAuthor.onclick = () => nav(authorUrl);
  tpl.querySelector(".post-content").textContent = post.content || "";
  if (!post.content) tpl.querySelector(".post-caption").classList.add("hidden");

  if (post.tags?.length) {
    const tagsEl = tpl.querySelector(".post-tags");
    tagsEl.innerHTML = post.tags.map((t) => `<button class="tag-link" data-tag="${esc(t)}">#${esc(t)}</button>`).join("");
    $$(".tag-link", tagsEl).forEach((b) => b.onclick = () => searchFor(`#${b.dataset.tag}`));
  }

  const likeBtn = tpl.querySelector(".like-btn");
  likeBtn.classList.toggle("liked", !!post.liked);
  tpl.querySelector(".like-count").textContent = post.likes;
  likeBtn.onclick = () => toggleLike(post);
  const saveBtn = tpl.querySelector(".save-btn");
  saveBtn.classList.toggle("saved", !!post.saved);
  saveBtn.onclick = () => toggleSave(post);
  tpl.querySelector(".share-btn").onclick = () => {
    const link = `${location.origin}/#/post/${post.id}`;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast("Link copied")).catch(() => toast(link));
    else toast(link);
  };
  tpl.querySelector(".comment-focus-btn").onclick = () => {
    const input = art.querySelector(".comment-form input");
    if (input) input.focus(); else nav("#/login");
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
      row.innerHTML = `<div class="comment-body">
          <strong data-u="${esc(c.username)}">${esc(c.username)}</strong>
          ${c.content ? `<span class="comment-text">${esc(c.content)}</span>` : ""}
          ${c.image_url ? (c.image_url.match(/\.(mp4|webm|mov)/i) ? `<video class="comment-image" src="${esc(c.image_url)}" controls></video>` : `<img class="comment-image" src="${esc(c.image_url)}" alt="Comment media" loading="lazy">`) : ""}
          <button class="comment-like ${c.liked ? "liked" : ""}" data-clid="${c.id}" title="Like comment">♥ ${c.likes || 0}</button>
        </div>${canDel ? `<button class="comment-del" data-cid="${c.id}" title="Delete">&times;</button>` : ""}`;
      row.querySelector("strong").onclick = () => nav(`#/profile/${encodeURIComponent(c.username)}`);
      row.querySelector(".comment-like").onclick = async () => {
        if (!state.user) return nav("#/login");
        try { await api(`/api/comments/${c.id}/like`, { method: c.liked ? "DELETE" : "POST" }); refresh(); }
        catch (e) { toast(e.message, true); }
      };
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
  if (!state.user) {
    form.innerHTML = `<button type="button" class="muted" style="font-size:14px;background:none;border:none;padding:0;cursor:pointer">Log in to comment</button>`;
    form.querySelector("button").onclick = () => nav("#/login");
  } else bindCommentForm(form, post.id);

  return art;
}

async function toggleLike(post) {
  if (!state.user) { toast("Log in to like posts", true); return nav("#/login"); }
  try { await api(`/api/posts/${post.id}/like`, { method: post.liked ? "DELETE" : "POST" }); refresh(); }
  catch (e) { toast(e.message, true); }
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
  loadStories(); renderSuggestions();
  try {
    const { posts } = await api(`/api/posts?feed=${state.feedMode}`);
    list.innerHTML = "";
    if (!posts.length) {
      list.innerHTML = emptyState(`<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
        state.feedMode === "following" ? "No posts yet" : "Share your first photo",
        state.feedMode === "following" ? "Follow people to see their posts here." : "Use the + button to create a post, reel or story.");
      return;
    }
    posts.forEach((p) => list.appendChild(renderPost(p)));
  } catch (e) { list.innerHTML = emptyState("!", "Couldn't load feed", e.message); }
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
      ? `<button class="tag-pill ${!tag ? "active" : ""}" data-tag="">All</button>` + tagRes.tags.map((t) => `<button class="tag-pill ${tag === t.tag ? "active" : ""}" data-tag="${esc(t.tag)}">#${esc(t.tag)} · ${t.posts}</button>`).join("")
      : "";
    $$(".tag-pill", tagsEl).forEach((b) => b.onclick = () => nav(b.dataset.tag ? `#/explore/${encodeURIComponent(b.dataset.tag)}` : "#/explore"));
    if (!postRes.posts.length) { grid.innerHTML = emptyState("", "No posts to explore", "Posts from the community will show up here."); return; }
    grid.innerHTML = postRes.posts.map((p) => `
      <article class="explore-card" data-post="${p.id}">
        <div class="explore-media">${p.image_url
          ? (p.media_type === "video" ? `<video src="${esc(p.image_url)}" muted playsinline></video>` : `<img src="${esc(p.image_url)}" alt="" loading="lazy">`)
          : `<div class="explore-no-media">${esc((p.content || "Post").slice(0, 80))}</div>`}</div>
        <div class="explore-body">
          <div class="explore-author"><span class="avatar xs">${p.author.avatar_url ? `<img src="${esc(p.author.avatar_url)}" alt="">` : esc(p.author.username[0].toUpperCase())}</span><strong>${esc(p.author.username)}</strong></div>
          <p class="explore-text">${esc(p.content || "Shared a post")}</p>
          <div class="explore-meta muted"><span>♥ ${p.likes}</span><span>💬 ${p.comments.length}</span><span>${esc(fmtDate(p.created_at))}</span></div>
        </div>
      </article>`).join("");
    $$(".explore-card", grid).forEach((el) => el.onclick = () => nav(`#/post/${el.dataset.post}`));
  } catch (e) { grid.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function loadReels() {
  setActiveNav("reels");
  $("#view-reels").classList.remove("hidden");
  const list = $("#reels-list");
  list.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { posts } = await api("/api/reels");
    if (!posts.length) { list.innerHTML = emptyState("", "No reels yet", "Use + → Reel to share a short video."); return; }
    list.innerHTML = "";
    posts.forEach((p) => list.appendChild(renderPost(p, { expandComments: false })));
  } catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
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

async function loadPost(id) {
  const el = $("#post-single");
  el.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { post } = await api(`/api/posts/${encodeURIComponent(id)}`);
    el.innerHTML = "";
    el.appendChild(renderPost(post, { expandComments: true }));
  } catch (e) { el.innerHTML = emptyState("", "Post not found", e.message); }
}

async function loadProfile(username, tab = state.profileTab) {
  const target = username === "me" ? state.user?.username : username;
  if (!target) return nav("#/login");
  state.profileTab = tab;
  setActiveNav(username === "me" || (state.user && target.toLowerCase() === state.user.username.toLowerCase()) ? "profile" : "");
  $("#view-profile").classList.remove("hidden");
  const hero = $("#profile-hero");
  const postsEl = $("#profile-posts");
  hero.innerHTML = `<div class="profile-main" style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>`;
  postsEl.innerHTML = "";
  try {
    const { user: u } = await api(`/api/users/${encodeURIComponent(target)}`);
    let endpoint = `/api/users/${encodeURIComponent(target)}/posts`;
    if (tab === "reels") endpoint = `/api/users/${encodeURIComponent(target)}/reels`;
    if (tab === "saved") endpoint = "/api/posts/saved";
    const { posts } = tab === "saved" && !u.isMe ? { posts: [] } : await api(endpoint);
    const canFollow = state.user && !u.isMe;
    hero.innerHTML = `
      <div class="profile-cover"></div>
      <div class="profile-main">
        <div class="profile-row">
          <div class="profile-avatar-lg">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" onerror="this.remove()">` : esc(u.username[0].toUpperCase())}</div>
          <div class="profile-identity">
            <div class="profile-top-line">
              <h1 class="profile-username">${esc(u.username)}</h1>
              ${u.isPrivate ? '<span class="muted" style="font-size:13px">🔒 Private</span>' : ""}
              ${u.isMe ? `<button class="btn ghost small" id="edit-profile-btn">Edit profile</button>` : ""}
              ${canFollow ? `<button class="btn ${u.isFollowing || u.isRequested ? "ghost" : "primary"} small" id="follow-btn">${u.isRequested ? "Requested" : u.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow"}</button>` : ""}
              ${!state.user && !u.isMe ? `<a class="btn primary small" href="#/login">Log in to follow</a>` : ""}
              ${u.isMe && u.isPrivate ? `<button class="btn ghost small" id="requests-btn">Requests</button>` : ""}
            </div>
            <div class="profile-stats">
              <span><strong>${u.postsCount + u.reelsCount}</strong> posts</span>
              <button id="stat-followers"><strong>${u.followers}</strong> followers</button>
              <button id="stat-following"><strong>${u.following}</strong> following</button>
            </div>
            <div class="profile-meta muted">${esc(u.full_name || "")}${u.full_name && u.website ? " · " : ""}${u.website ? `<a href="${esc(u.website)}" target="_blank" rel="noopener">${esc(u.website)}</a>` : ""}${u.isMe && u.phone ? ` · ${esc(u.phone)}` : ""}</div>
            <div class="profile-bio">${esc(u.bio || (u.isMe ? "Add a bio to tell people about yourself." : ""))}</div>
          </div>
        </div>
      </div>`;
    $$(".ptab").forEach((b) => b.classList.toggle("active", b.dataset.ptab === tab));
    if (u.isMe) $("#edit-profile-btn").onclick = () => openEditProfile(u);
    if (u.isMe && u.isPrivate) $("#requests-btn").onclick = () => showFollowRequests();
    const followBtn = $("#follow-btn");
    if (followBtn) followBtn.onclick = async () => {
      followBtn.disabled = true;
      try {
        const isActive = u.isFollowing || u.isRequested;
        const res = await api(`/api/users/${encodeURIComponent(u.username)}/follow`, { method: isActive ? "DELETE" : "POST" });
        const next = res.user;
        u.isFollowing = next.isFollowing; u.isRequested = next.isRequested;
        followBtn.textContent = next.isRequested ? "Requested" : next.isFollowing ? "Following" : u.isPrivate ? "Request" : "Follow";
        followBtn.classList.toggle("ghost", !!(next.isFollowing || next.isRequested));
        followBtn.classList.toggle("primary", !(next.isFollowing || next.isRequested));
      } catch (e) { toast(e.message, true); }
      finally { followBtn.disabled = false; }
    };
    $("#stat-followers").onclick = () => showUserList(u.username, "followers");
    $("#stat-following").onclick = () => showUserList(u.username, "following");

    if (!posts.length) {
      postsEl.innerHTML = emptyState("", `No ${tab} yet`, tab === "reels" ? "Reels will appear here." : tab === "saved" ? "Save posts to see them here." : `When ${u.username} posts, you'll see it here.`);
    } else posts.forEach((p) => postsEl.appendChild(renderPost(p)));
  } catch (e) { hero.innerHTML = emptyState("", "Profile not found", e.message); }
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
  form.avatar_url.value = u.avatar_url.startsWith("/uploads/") ? "" : u.avatar_url || "";
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
      else fd.append("avatar_url", form.avatar_url.value);
      await api("/api/users/me", { method: "PATCH", body: fd });
      closeModal("modal");
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
  $("#modal .modal-head h3").textContent = type === "followers" ? "Followers" : "Following";
  let body = modal.querySelector(".modal-body-list");
  if (!body) { body = document.createElement("div"); body.className = "modal-body-list"; modal.querySelector(".modal-card").appendChild(body); }
  body.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { users } = await api(`/api/users/${encodeURIComponent(username)}/${type}`);
    body.innerHTML = users.length ? users.map((u) => `<div class="suggest-row" style="padding:6px 0">${avatarHTML(u, "avatar xs")}<div class="s-info"><span class="s-name" data-u="${esc(u.username)}">${esc(u.username)}</span><span class="s-sub">${esc(u.full_name || u.bio || "")}</span></div></div>`).join("") : `<p class="muted">No ${type} yet.</p>`;
    $$("[data-u]", body).forEach((n) => n.onclick = () => { closeModal("modal"); nav(`#/profile/${encodeURIComponent(n.dataset.u)}`); });
  } catch (e) { body.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function showFollowRequests() {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#edit-profile-form").classList.add("hidden");
  $("#modal .modal-head h3").textContent = "Follow requests";
  let body = modal.querySelector(".modal-body-list");
  if (!body) { body = document.createElement("div"); body.className = "modal-body-list"; modal.querySelector(".modal-card").appendChild(body); }
  body.innerHTML = `<p class="muted">Loading...</p>`;
  try {
    const { users } = await api("/api/users/me/follow-requests");
    if (!users.length) { body.innerHTML = `<p class="muted">No pending requests.</p>`; return; }
    body.innerHTML = users.map((u) => `<div class="suggest-row" style="padding:6px 0">${avatarHTML(u, "avatar xs")}<div class="s-info"><span class="s-name" data-u="${esc(u.username)}">${esc(u.username)}</span><span class="s-sub">${esc(u.full_name || "")}</span></div><button class="btn-text" data-accept="${esc(u.username)}">Accept</button><button class="btn-text danger" data-decline="${esc(u.username)}">Decline</button></div>`).join("");
    $$("[data-accept]", body).forEach((b) => b.onclick = async () => { await api(`/api/users/me/follow-requests/${encodeURIComponent(b.dataset.accept)}/accept`, { method: "POST" }); showFollowRequests(); refresh(); });
    $$("[data-decline]", body).forEach((b) => b.onclick = async () => { await api(`/api/users/me/follow-requests/${encodeURIComponent(b.dataset.decline)}`, { method: "DELETE" }); showFollowRequests(); });
  } catch (e) { body.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
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
    list.innerHTML = conversations.length ? conversations.map((c) => `
      <div class="conversation ${state.conversation === c.user.username ? "active" : ""}" data-user="${esc(c.user.username)}">
        ${avatarHTML(c.user, "avatar sm")}
        <div class="c-info">
          <span class="c-name">${esc(c.user.full_name || c.user.username)}</span>
          <span class="c-last">${esc(c.last_message ? (c.last_message.body || "📎 Media") : "No messages yet")}</span>
        </div>
        ${c.unread ? '<span class="unread-dot"></span>' : ""}
      </div>`).join("") : `<p class="muted" style="padding:12px">No conversations yet. Search for someone and message them from their profile.</p>`;
    $$(".conversation", list).forEach((el) => el.onclick = () => nav(`#/messages/${encodeURIComponent(el.dataset.user)}`));
    const target = username || state.conversation || conversations[0]?.user.username;
    if (target) await openConversation(target);
    else { $("#chat-panel").innerHTML = `<div class="chat-empty muted">Select a conversation to start chatting.</div>`; $("#message-form").classList.add("hidden"); }
  } catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function openConversation(username) {
  try {
    const { user, messages } = await api(`/api/messages/${encodeURIComponent(username)}`);
    state.conversation = username;
    state.messages = messages;
    $$(".conversation").forEach((el) => el.classList.toggle("active", el.dataset.user === username));
    const panel = $("#chat-panel");
    panel.innerHTML = `<div class="chat-head">${avatarHTML(user, "avatar sm")}<strong>${esc(user.full_name || user.username)}</strong><button class="btn-text" id="chat-profile-btn">Profile</button></div>
      <div id="chat-messages"></div>`;
    $("#chat-profile-btn").onclick = () => nav(`#/profile/${encodeURIComponent(user.username)}`);
    renderMessages();
    $("#message-form").classList.remove("hidden");
    renderBadges();
    setTimeout(() => { panel.scrollTop = panel.scrollHeight; }, 60);
  } catch (e) { toast(e.message, true); }
}

function renderMessages() {
  const el = $("#chat-messages");
  if (!el) return;
  el.innerHTML = state.messages.map((m) => {
    const mine = state.user && m.sender.id === state.user.id;
    return `<div class="msg-row ${mine ? "mine" : ""}" data-id="${m.id}">
      <div class="msg-bubble">
        ${m.body ? esc(m.body) : ""}
        ${m.image_url ? (/\.(mp4|webm|mov)/i.test(m.image_url) ? `<video src="${esc(m.image_url)}" controls></video>` : `<img src="${esc(m.image_url)}" alt="Attachment">`) : ""}
        <div class="msg-time">${esc(fmtDate(m.created_at))}${mine && m.read ? " · Seen" : ""}</div>
      </div>
    </div>`;
  }).join("");
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
      input.value = ""; fileInput.value = "";
      renderMessages();
      const panel = $("#chat-panel");
      setTimeout(() => { panel.scrollTop = panel.scrollHeight; }, 40);
      loadMessages(state.conversation);
    } catch (err) { toast(err.message, true); }
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
    const { notifications } = await api("/api/notifications");
    list.innerHTML = notifications.length ? notifications.map((n) => `
      <div class="notification ${n.read ? "" : "unread"}" data-id="${n.id}" data-post="${n.post_id || ""}" data-user="${esc(n.actor.username)}">
        ${avatarHTML(n.actor, "avatar sm")}
        <div class="n-text"><strong>${esc(n.actor.username)}</strong> ${esc(n.text)}</div>
        <span class="n-time">${esc(fmtDate(n.created_at))}</span>
      </div>`).join("") : emptyState("", "No activity yet", "Likes, comments and new followers will show up here.");
    $$(".notification", list).forEach((el) => el.onclick = async () => {
      try { await api(`/api/notifications/${el.dataset.id}/read`, { method: "POST" }); } catch {}
      if (el.dataset.post) nav(`#/post/${el.dataset.post}`);
      else if (el.dataset.user) nav(`#/profile/${encodeURIComponent(el.dataset.user)}`);
    });
    renderBadges();
  } catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

// ── Search ────────────────────────────────────────────────────────────────
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
        const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
        const usersHtml = data.users.map((u) => `
          <div class="search-item">
            <button class="search-user" data-u="${esc(u.username)}">
              ${avatarHTML(u, "avatar xs")}
              <div class="s-info"><span class="s-name">${esc(u.username)}</span><span class="s-bio">${esc(u.full_name || u.bio || u.last_seen_text || "")}</span></div>
            </button>
            ${state.user && !u.isMe ? `<button class="btn-text search-follow" data-u="${esc(u.username)}" data-following="${u.isFollowing ? "1" : "0"}">${u.isFollowing ? "Following" : "Follow"}</button>` : ""}
          </div>`).join("");
        const tagsHtml = data.tags.map((tag) => `<button class="search-item search-tag" data-tag="#${esc(tag.tag)}"><span class="muted">#</span> ${esc(tag.tag)} <span class="muted" style="margin-left:auto">${tag.posts} posts</span></button>`).join("");
        const postsHtml = data.posts.slice(0, 3).map((p) => `<button class="search-item search-post" data-post="${p.id}">${avatarHTML(p.author, "avatar xs")}<span class="s-name" style="margin-left:10px">${esc(p.author.username)}</span><span class="s-bio" style="margin-left:8px">${esc((p.content || "Shared media").slice(0, 45))}</span></button>`).join("");
        box.innerHTML = (usersHtml || tagsHtml || postsHtml) + `<button class="search-item search-all" data-q="${esc(q)}" style="color:var(--accent);font-weight:600">See all results for “${esc(q)}”</button>`;
        $$(".search-user", box).forEach((b) => b.onclick = () => { closeSearch(); nav(`#/profile/${encodeURIComponent(b.dataset.u)}`); });
        $$(".search-tag", box).forEach((b) => b.onclick = () => { const q2 = b.dataset.tag; closeSearch(); searchFor(q2); });
        $$(".search-post", box).forEach((b) => b.onclick = () => { closeSearch(); nav(`#/post/${b.dataset.post}`); });
        $(".search-all", box).onclick = () => { const q2 = $(".search-all", box).dataset.q; closeSearch(); searchFor(q2); };
        $$(".search-follow", box).forEach((btn) => btn.onclick = async (e) => {
          e.stopPropagation();
          const username = btn.dataset.u;
          btn.disabled = true;
          try {
            const res = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: btn.dataset.following === "1" ? "DELETE" : "POST" });
            btn.dataset.following = res.user.isFollowing ? "1" : "0";
            btn.textContent = res.user.isRequested ? "Requested" : res.user.isFollowing ? "Following" : "Follow";
          } catch (err) { toast(err.message, true); }
          finally { btn.disabled = false; }
        });
        box.classList.remove("hidden");
      } catch { box.classList.add("hidden"); }
    }, 200);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) box.classList.add("hidden"); });
}
function closeSearch() { $("#search-results").classList.add("hidden"); $("#global-search").value = ""; }

async function loadSearchPage(q) {
  setActiveNav("search");
  $("#view-search").classList.remove("hidden");
  const input = $("#search-page-input");
  const results = $("#search-page-results");
  if (q && input.value !== q) input.value = q;
  if (!q) {
    results.innerHTML = `<p class="muted">Start typing above to search people, posts and hashtags.</p>`;
    const trending = await api("/api/tags/trending").catch(() => ({ tags: [] }));
    if (trending.tags.length) results.innerHTML = `<div class="search-section"><h3>Trending hashtags</h3><div class="tag-row">${trending.tags.map((t) => `<button class="tag-pill" data-tag="#${esc(t.tag)}">#${esc(t.tag)} · ${t.posts}</button>`).join("")}</div></div>`;
    $$(".tag-pill", results).forEach((b) => b.onclick = () => searchFor(b.dataset.tag));
    return;
  }
  results.innerHTML = `<p class="muted">Searching...</p>`;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const clean = q.replace(/^#/, "");
    const users = data.users.map((u) => `<div class="search-user-row">${avatarHTML(u, "avatar sm")}<div class="s-info"><strong>${esc(u.username)}</strong><div class="muted">${esc(u.full_name || u.bio || "")}</div></div><button class="btn-text" data-profile="${esc(u.username)}">View</button></div>`).join("");
    const tags = data.tags.map((t) => `<button class="tag-pill" data-tag="#${esc(t.tag)}">#${esc(t.tag)} · ${t.posts}</button>`).join("");
    const posts = data.posts.map((p) => `<div class="search-grid-item" data-post="${p.id}">${p.image_url ? (p.media_type === "video" ? `<video src="${esc(p.image_url)}" muted></video>` : `<img src="${esc(p.image_url)}" alt="">`) : `<div style="padding:10px;font-size:12px">${esc((p.content || "Post").slice(0, 60))}</div>`}</div>`).join("");
    results.innerHTML = `
      <div class="search-section"><h3>People</h3>${users || '<p class="muted">No people found.</p>'}</div>
      <div class="search-section"><h3>Hashtags</h3><div class="tag-row">${tags || '<p class="muted">No hashtags found.</p>'}</div></div>
      <div class="search-section"><h3>Posts</h3><div class="search-grid">${posts || '<p class="muted">No posts found.</p>'}</div></div>`;
    $$("[data-profile]", results).forEach((b) => b.onclick = () => nav(`#/profile/${encodeURIComponent(b.dataset.profile)}`));
    $$("[data-tag]", results).forEach((b) => b.onclick = () => searchFor(b.dataset.tag));
    $$("[data-post]", results).forEach((b) => b.onclick = () => nav(`#/post/${b.dataset.post}`));
  } catch (e) { results.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

let pageSearchTimer;
function bindSearchPage() {
  const input = $("#search-page-input");
  input.addEventListener("input", () => {
    clearTimeout(pageSearchTimer);
    const q = input.value.trim();
    pageSearchTimer = setTimeout(() => {
      if (q) history.replaceState(null, "", `#/search/${encodeURIComponent(q)}`);
      loadSearchPage(q);
    }, 250);
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────
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
function closeAllModals() { ["modal", "create-modal", "story-modal"].forEach(closeModal); }

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
  showView(state.route.name);
  switch (state.route.name) {
    case "auth": setActiveNav(""); return;
    case "explore": return loadExplore(state.route.param);
    case "reels": return loadReels();
    case "messages": return loadMessages(state.route.param);
    case "notifications": return loadNotifications();
    case "search": return loadSearchPage(state.route.param || "");
    case "post": return loadPost(state.route.param);
    case "saved": return loadSaved();
    case "profile": return loadProfile(state.route.param);
    default: return loadFeed();
  }
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
      await api("/api/auth/register", { method: "POST", body: JSON.stringify({
        username: fd.get("username"), full_name: fd.get("full_name"), phone: fd.get("phone"),
        password: fd.get("password"), bio: fd.get("bio"),
      }) });
      await loadMe(); toast("Account created!"); nav("#/");
    } catch (err) { toast(err.message, true); }
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
  $("#composer-story-btn").onclick = () => openCreate("story");
  $("#story-prev").onclick = prevStory;
  $("#story-next").onclick = nextStory;
  $("#post-back-btn").onclick = () => history.length > 1 ? history.back() : nav("#/");
  $("#mark-read-btn").onclick = async () => {
    try { await api("/api/notifications/read", { method: "POST" }); renderBadges(); loadNotifications(); }
    catch (e) { toast(e.message, true); }
  };
  document.addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) closeModal(close.dataset.close);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
    if (!$("#story-modal").classList.contains("hidden")) {
      if (e.key === "ArrowRight") nextStory();
      if (e.key === "ArrowLeft") prevStory();
    }
  });
  window.addEventListener("hashchange", route);
  bindMessageForm();
  bindSearchPage();
}

(async function init() {
  bindCreate();
  bindAuth();
  bindSearch();
  bindUI();
  await loadMe();
  await route();
  setInterval(renderBadges, 30000);
})();
