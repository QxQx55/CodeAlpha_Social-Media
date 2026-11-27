require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { initDb, run, get, all } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_COOKIE = "token";

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

app.use(express.static(FRONTEND_DIR));

const uploadsDir = path.join(FRONTEND_DIR, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
    cb(new Error("Only jpg, png, gif, webp, mp4, webm or mov files are allowed"));
  },
});

function uploadError(req, res, next, fn) {
  fn(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}
function uploadSingle(field) {
  return (req, res, next) => uploadError(req, res, next, upload.single(field));
}
function uploadMedia(req, res, next) {
  uploadError(req, res, next, upload.any());
}

function firstFile(req) {
  return req.file || req.files?.[0] || null;
}
function mediaTypeOf(file) {
  return file && String(file.mimetype || "").startsWith("video/") ? "video" : "image";
}
function uploadedMedia(req) {
  const file = firstFile(req);
  if (!file) return null;
  return { url: `/uploads/${file.filename}`, type: mediaTypeOf(file) };
}
function hasExternalMediaInput(req) {
  return Boolean(String(req.body?.image_url || req.body?.media_url || "").trim());
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}
function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
async function touchLastSeen(userId) {
  if (!userId) return;
  try { await run("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?", [userId]); } catch {}
}
function authRequired(req, res, next) {
  const token = req.cookies[TOKEN_COOKIE];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    touchLastSeen(req.user.id);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}
function optionalAuth(req, _res, next) {
  const token = req.cookies[TOKEN_COOKIE];
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    touchLastSeen(req.user.id);
  } catch {
    req.user = null;
  }
  next();
}

function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(value);
}
function isValidPhone(value) {
  return /^\+?[0-9]{8,15}$/.test(value);
}
function lastSeenLabel(iso) {
  if (!iso) return "Offline";
  const d = new Date(String(iso).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "Offline";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 120) return "Active now";
  if (diff < 3600) return `Active ${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `Active ${Math.floor(diff / 3600)}h ago`;
  return `Active ${Math.floor(diff / 86400)}d ago`;
}

function safeUser(row, viewerId) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name || "",
    bio: row.bio || "",
    website: row.website || "",
    avatar_url: row.avatar_url || "",
    phone: viewerId === row.id ? (row.phone || "") : undefined,
    last_seen: row.last_seen || row.created_at,
    created_at: row.created_at,
    isMe: viewerId === row.id,
    isFollowing: false,
    isRequested: false,
    isPrivate: !!row.is_private,
    last_seen_text: lastSeenLabel(row.last_seen || row.created_at),
  };
}

async function usersWithFollowState(rows, viewerId) {
  if (!rows.length) return [];
  const base = rows.map((r) => safeUser(r, viewerId));
  if (!viewerId) return base;
  const placeholders = rows.map(() => "?").join(",");
  const [followed, requested] = await Promise.all([
    all(`SELECT following_id FROM follows WHERE follower_id = ? AND following_id IN (${placeholders})`, [viewerId, ...rows.map((r) => r.id)]),
    all(`SELECT following_id FROM follow_requests WHERE follower_id = ? AND following_id IN (${placeholders})`, [viewerId, ...rows.map((r) => r.id)]),
  ]);
  const followingIds = new Set(followed.map((r) => r.following_id));
  const requestedIds = new Set(requested.map((r) => r.following_id));
  return base.map((u) => ({ ...u, isFollowing: followingIds.has(u.id), isRequested: requestedIds.has(u.id) }));
}

function parseTags(text) {
  const matches = String(text || "").match(/#[A-Za-z0-9_]{1,30}/g) || [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))].slice(0, 10);
}
function parseMentions(text) {
  const matches = String(text || "").match(/@[A-Za-z0-9_]{3,20}/g) || [];
  return [...new Set(matches.map((m) => m.slice(1)))].slice(0, 10);
}
async function syncPostTags(postId, text) {
  await run("DELETE FROM post_hashtags WHERE post_id = ?", [postId]);
  for (const tag of parseTags(text)) {
    await run("INSERT OR IGNORE INTO hashtags (tag) VALUES (?)", [tag]);
    const row = await get("SELECT id FROM hashtags WHERE tag = ? COLLATE NOCASE", [tag]);
    if (row) await run("INSERT OR IGNORE INTO post_hashtags (post_id, tag_id) VALUES (?, ?)", [postId, row.id]);
  }
}
async function createNotification(userId, actorId, type, meta = {}) {
  if (!userId || !actorId || userId === actorId) return;
  try {
    await run(
      "INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)",
      [userId, actorId, type, meta.post_id || null, meta.comment_id || null]
    );
  } catch {}
}
async function notifyMentions(text, actorId, postId, commentId = null) {
  for (const username of parseMentions(text)) {
    const user = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]);
    if (user) await createNotification(user.id, actorId, commentId ? "mention_comment" : "mention", { post_id: postId, comment_id: commentId });
  }
}

async function getProfile(username, viewerId) {
  const user = await get(
    `SELECT id, username, full_name, bio, avatar_url, phone, website, is_private, last_seen, created_at
     FROM users WHERE username = ? COLLATE NOCASE`,
    [username]
  );
  if (!user) return null;
  const [followers, following, postsCount, reelsCount, isFollowing, isRequested] = await Promise.all([
    get("SELECT COUNT(*) AS count FROM follows WHERE following_id = ?", [user.id]),
    get("SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?", [user.id]),
    get("SELECT COUNT(*) AS count FROM posts WHERE user_id = ? AND kind = 'post'", [user.id]),
    get("SELECT COUNT(*) AS count FROM posts WHERE user_id = ? AND kind = 'reel'", [user.id]),
    viewerId ? get("SELECT 1 AS ok FROM follows WHERE follower_id = ? AND following_id = ?", [viewerId, user.id]) : Promise.resolve(null),
    viewerId ? get("SELECT 1 AS ok FROM follow_requests WHERE follower_id = ? AND following_id = ?", [viewerId, user.id]) : Promise.resolve(null),
  ]);
  return {
    ...safeUser(user, viewerId),
    followers: followers.count,
    following: following.count,
    postsCount: postsCount.count,
    reelsCount: reelsCount.count,
    isFollowing: !!isFollowing,
    isRequested: !!isRequested,
    last_seen_text: lastSeenLabel(user.last_seen),
  };
}

async function canViewUser(targetUser, viewerId) {
  if (!targetUser) return false;
  if (!targetUser.is_private || targetUser.id === viewerId) return true;
  if (!viewerId) return false;
  const f = await get("SELECT 1 AS ok FROM follows WHERE follower_id = ? AND following_id = ?", [viewerId, targetUser.id]);
  return !!f;
}

const VISIBLE_POST_SQL = `
  (u.is_private = 0 OR u.id = ? OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id))
`;

async function getPostWithMeta(postId, viewerId) {
  const post = await get(
    `SELECT p.id, p.content, p.image_url, p.kind, p.media_type, p.created_at,
            u.id AS user_id, u.username, u.full_name, u.avatar_url
     FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [postId]
  );
  if (!post) return null;
  const [likes, liked, saved, comments, tags] = await Promise.all([
    get("SELECT COUNT(*) AS count FROM likes WHERE post_id = ?", [postId]),
    viewerId ? get("SELECT 1 AS ok FROM likes WHERE user_id = ? AND post_id = ?", [viewerId, postId]) : null,
    viewerId ? get("SELECT 1 AS ok FROM saved_posts WHERE user_id = ? AND post_id = ?", [viewerId, postId]) : null,
    all(
      `SELECT c.id, c.content, c.image_url, c.created_at, u.id AS user_id, u.username, u.avatar_url,
              (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS likes,
              ${viewerId ? "EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?)" : "0"} AS liked
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      viewerId ? [viewerId, postId] : [postId]
    ),
    all(`SELECT h.tag FROM post_hashtags ph JOIN hashtags h ON h.id = ph.tag_id WHERE ph.post_id = ? ORDER BY h.tag`, [postId]),
  ]);
  return {
    id: post.id,
    content: post.content,
    image_url: post.image_url || "",
    media_type: post.media_type || "image",
    kind: post.kind || "post",
    tags: tags.map((t) => t.tag),
    created_at: post.created_at,
    author: { id: post.user_id, username: post.username, full_name: post.full_name || "", avatar_url: post.avatar_url || "" },
    likes: likes.count,
    liked: !!liked,
    saved: !!saved,
    comments: comments.map((c) => ({ ...c, image_url: c.image_url || "", liked: !!c.liked })),
  };
}

async function hydratePosts(ids, viewerId) {
  const full = [];
  for (const p of ids) full.push(await getPostWithMeta(p.id, viewerId));
  return full.filter(Boolean);
}

// ── Auth ──────────────────────────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const bio = String(req.body.bio || "").trim().slice(0, 200);
    const full_name = String(req.body.full_name || "").trim().slice(0, 80);
    const phone = String(req.body.phone || "").trim().replace(/[\s()-]/g, "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3-20 chars: letters, numbers, underscore" });
    if (!isValidPhone(phone)) return res.status(400).json({ error: "Enter a valid phone number (8-15 digits, optional +)" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const existing = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    const existingPhone = await get("SELECT id FROM users WHERE phone = ?", [phone]);
    if (existingPhone) return res.status(409).json({ error: "Phone number already registered" });
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      "INSERT INTO users (username, password_hash, bio, full_name, phone, last_seen) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
      [username, hash, bio, full_name, phone]
    );
    setAuthCookie(res, signToken({ id: result.id, username }));
    res.status(201).json({ user: await getProfile(username, result.id) });
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE") && String(err?.message || "").includes("phone")) {
      return res.status(409).json({ error: "Phone number already registered" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const user = await get("SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE", [username]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    setAuthCookie(res, signToken(user));
    res.json({ user: await getProfile(user.username, user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(TOKEN_COOKIE);
  res.json({ ok: true });
});

app.get("/api/auth/me", optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = await get("SELECT username FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.json({ user: null });
  res.json({ user: await getProfile(user.username, req.user.id) });
});

// ── Users ─────────────────────────────────────────────────────────────────
app.get("/api/users/search", authRequired, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ users: [] });
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await all(
      `SELECT id, username, full_name, bio, avatar_url, is_private, last_seen, created_at
       FROM users WHERE (username COLLATE NOCASE LIKE ? ESCAPE '\\' OR full_name COLLATE NOCASE LIKE ? ESCAPE '\\' OR bio COLLATE NOCASE LIKE ? ESCAPE '\\')
       ORDER BY username ASC LIMIT 20`,
      [like, like, like]
    );
    res.json({ users: await usersWithFollowState(rows, req.user?.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/suggested", authRequired, async (req, res) => {
  try {
    const viewerId = req.user?.id || -1;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 30);
    const rows = await all(
      `SELECT u.id, u.username, u.full_name, u.bio, u.avatar_url, u.is_private, u.last_seen, u.created_at
       FROM users u
       WHERE u.id != ?
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.follower_id = ? AND fr.following_id = u.id)
       ORDER BY (SELECT COUNT(*) FROM follows f2 WHERE f2.following_id = u.id) DESC, u.created_at DESC
       LIMIT ?`,
      [viewerId, viewerId, viewerId, limit]
    );
    res.json({ users: await usersWithFollowState(rows, req.user?.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/users/me", authRequired, uploadMedia, async (req, res) => {
  try {
    const bio = String(req.body.bio ?? "").trim().slice(0, 200);
    const full_name = String(req.body.full_name ?? "").trim().slice(0, 80);
    const website = String(req.body.website ?? "").trim().slice(0, 200);
    const is_private = (req.body.is_private === "true" || req.body.is_private === "1" || req.body.is_private === true) ? 1 : 0;
    if (hasExternalMediaInput(req)) return res.status(400).json({ error: "Avatar upload supports files only" });
    const media = uploadedMedia(req);
    const current = await get("SELECT avatar_url FROM users WHERE id = ?", [req.user.id]);
    const avatar_url = media ? media.url : (current?.avatar_url || "");
    const phone = String(req.body.phone ?? "").trim().replace(/[\s()-]/g, "");
    if (!isValidPhone(phone)) return res.status(400).json({ error: "Enter a valid phone number (8-15 digits, optional +)" });
    const existingPhone = await get("SELECT id FROM users WHERE phone = ? AND id != ?", [phone, req.user.id]);
    if (existingPhone) return res.status(409).json({ error: "Phone number already registered" });
    await run(
      "UPDATE users SET bio = ?, full_name = ?, website = ?, is_private = ?, avatar_url = ?, phone = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?",
      [bio, full_name, website, is_private, avatar_url, phone, req.user.id]
    );
    const me = await get("SELECT username FROM users WHERE id = ?", [req.user.id]);
    res.json({ user: await getProfile(me.username, req.user.id) });
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE") && String(err?.message || "").includes("phone")) {
      return res.status(409).json({ error: "Phone number already registered" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/me/follow-requests", authRequired, async (req, res) => {
  const rows = await all(
    `SELECT u.id, u.username, u.full_name, u.bio, u.avatar_url, u.is_private, u.last_seen, u.created_at
     FROM follow_requests fr JOIN users u ON u.id = fr.follower_id
     WHERE fr.following_id = ? ORDER BY fr.created_at DESC`,
    [req.user.id]
  );
  res.json({ users: await usersWithFollowState(rows, req.user.id) });
});

app.post("/api/users/me/follow-requests/:username/accept", authRequired, async (req, res) => {
  const requester = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
  if (!requester) return res.status(404).json({ error: "User not found" });
  await run("INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [requester.id, req.user.id]);
  await run("DELETE FROM follow_requests WHERE follower_id = ? AND following_id = ?", [requester.id, req.user.id]);
  await createNotification(requester.id, req.user.id, "follow_accepted");
  res.json({ ok: true });
});

app.delete("/api/users/me/follow-requests/:username", authRequired, async (req, res) => {
  const requester = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
  if (!requester) return res.status(404).json({ error: "User not found" });
  await run("DELETE FROM follow_requests WHERE follower_id = ? AND following_id = ?", [requester.id, req.user.id]);
  res.json({ ok: true });
});

app.get("/api/users/:username", authRequired, async (req, res) => {
  try {
    const profile = await getProfile(req.params.username, req.user?.id);
    if (!profile) return res.status(404).json({ error: "User not found" });
    res.json({ user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/posts", authRequired, async (req, res) => {
  try {
    const user = await get("SELECT id, is_private FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!(await canViewUser(user, req.user?.id))) return res.json({ posts: [], privateLocked: true });
    const rows = await all(
      `SELECT id FROM posts WHERE user_id = ? AND kind = 'post' ORDER BY created_at DESC, id DESC`,
      [user.id]
    );
    res.json({ posts: await hydratePosts(rows, req.user?.id), privateLocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/reels", authRequired, async (req, res) => {
  try {
    const user = await get("SELECT id, is_private FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!(await canViewUser(user, req.user?.id))) return res.json({ posts: [], privateLocked: true });
    const rows = await all(
      `SELECT id FROM posts WHERE user_id = ? AND kind = 'reel' ORDER BY created_at DESC, id DESC`,
      [user.id]
    );
    res.json({ posts: await hydratePosts(rows, req.user?.id), privateLocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/followers", authRequired, async (req, res) => {
  try {
    const user = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const rows = await all(
      `SELECT u.id, u.username, u.full_name, u.bio, u.avatar_url, u.is_private, u.last_seen, u.created_at
       FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ? ORDER BY f.created_at DESC`,
      [user.id]
    );
    res.json({ users: await usersWithFollowState(rows, req.user?.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/following", authRequired, async (req, res) => {
  try {
    const user = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const rows = await all(
      `SELECT u.id, u.username, u.full_name, u.bio, u.avatar_url, u.is_private, u.last_seen, u.created_at
       FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`,
      [user.id]
    );
    res.json({ users: await usersWithFollowState(rows, req.user?.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/users/:username/follow", authRequired, async (req, res) => {
  try {
    const target = await get("SELECT id, is_private FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.id === req.user.id) return res.status(400).json({ error: "Cannot follow yourself" });
    if (target.is_private) {
      const result = await run("INSERT OR IGNORE INTO follow_requests (follower_id, following_id) VALUES (?, ?)", [req.user.id, target.id]);
      if (result.changes) await createNotification(target.id, req.user.id, "follow_request");
    } else {
      const result = await run("INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [req.user.id, target.id]);
      if (result.changes) await createNotification(target.id, req.user.id, "follow");
    }
    res.json({ user: await getProfile(target.username || req.params.username, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/users/:username/follow", authRequired, async (req, res) => {
  try {
    const target = await get("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!target) return res.status(404).json({ error: "User not found" });
    await run("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, target.id]);
    await run("DELETE FROM follow_requests WHERE follower_id = ? AND following_id = ?", [req.user.id, target.id]);
    res.json({ user: await getProfile(target.username, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Uploads & posts ───────────────────────────────────────────────────────
app.post("/api/uploads", authRequired, uploadSingle("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file is required" });
  res.status(201).json({ url: `/uploads/${req.file.filename}`, media_type: mediaTypeOf(req.file) });
});

app.get("/api/posts", authRequired, async (req, res) => {
  try {
    const feed = String(req.query.feed || "all");
    const viewerId = req.user?.id || -1;
    let rows;
    if (feed === "following" && req.user) {
      rows = await all(
        `SELECT id FROM posts WHERE kind = 'post' AND (user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR user_id = ?)
         ORDER BY created_at DESC, id DESC LIMIT 50`,
        [viewerId, viewerId]
      );
    } else {
      rows = await all(
        `SELECT p.id FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.kind = 'post' AND ${VISIBLE_POST_SQL}
         ORDER BY p.created_at DESC, p.id DESC LIMIT 50`,
        [viewerId, viewerId]
      );
    }
    res.json({ posts: await hydratePosts(rows, viewerId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/posts/explore", authRequired, async (req, res) => {
  try {
    const tag = String(req.query.tag || "").trim().toLowerCase();
    const viewerId = req.user?.id || -1;
    let rows;
    if (tag) {
      rows = await all(
        `SELECT p.id FROM posts p
         JOIN users u ON u.id = p.user_id
         JOIN post_hashtags ph ON ph.post_id = p.id JOIN hashtags h ON h.id = ph.tag_id
         WHERE h.tag = ? COLLATE NOCASE AND ${VISIBLE_POST_SQL} GROUP BY p.id
         ORDER BY (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) DESC, p.created_at DESC LIMIT 50`,
        [tag, viewerId, viewerId]
      );
    } else {
      rows = await all(
        `SELECT p.id FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN likes l ON l.post_id = p.id
         WHERE p.kind = 'post' AND ${VISIBLE_POST_SQL}
         GROUP BY p.id
         ORDER BY COUNT(l.user_id) DESC, p.created_at DESC
         LIMIT 30`,
        [viewerId, viewerId]
      );
    }
    res.json({ posts: await hydratePosts(rows, viewerId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/posts/saved", authRequired, async (req, res) => {
  try {
    const rows = await all(
      `SELECT p.id FROM saved_posts s JOIN posts p ON p.id = s.post_id WHERE s.user_id = ? ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json({ posts: await hydratePosts(rows, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/reels", authRequired, async (req, res) => {
  try {
    const viewerId = req.user?.id || -1;
    const rows = await all(
      `SELECT p.id FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.kind = 'reel' AND ${VISIBLE_POST_SQL}
       ORDER BY p.created_at DESC, p.id DESC LIMIT 50`,
      [viewerId, viewerId]
    );
    res.json({ posts: await hydratePosts(rows, viewerId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/posts", authRequired, uploadMedia, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const kind = String(req.body.kind || "post") === "reel" ? "reel" : "post";
    if (hasExternalMediaInput(req)) return res.status(400).json({ error: "Media upload supports files only" });
    const media = uploadedMedia(req) || { url: "", type: "image" };
    if (!content && !media.url) return res.status(400).json({ error: "Post must have text or an uploaded file" });
    if (content.length > 2200) return res.status(400).json({ error: "Caption must be 2200 characters or less" });
    if (kind === "reel" && !media.url) return res.status(400).json({ error: "Reels need an uploaded video or image file" });
    const result = await run(
      "INSERT INTO posts (user_id, content, image_url, media_type, kind) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, content, media.url, media.type, kind]
    );
    await syncPostTags(result.id, content);
    await notifyMentions(content, req.user.id, result.id);
    res.status(201).json({ post: await getPostWithMeta(result.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/posts/:id", authRequired, async (req, res) => {
  try {
    const owner = await get("SELECT u.id, u.is_private FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?", [req.params.id]);
    if (!owner) return res.status(404).json({ error: "Post not found" });
    if (!(await canViewUser(owner, req.user?.id))) return res.status(403).json({ error: "This account is private" });
    const post = await getPostWithMeta(req.params.id, req.user?.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json({ post });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/posts/:id", authRequired, async (req, res) => {
  try {
    const post = await get("SELECT id, user_id, image_url FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.user_id !== req.user.id) return res.status(403).json({ error: "Not allowed" });
    const content = String(req.body.content || "").trim();
    if (!content && !post.image_url) return res.status(400).json({ error: "Post must have text or media" });
    if (content.length > 2200) return res.status(400).json({ error: "Caption must be 2200 characters or less" });
    await run("UPDATE posts SET content = ? WHERE id = ?", [content, post.id]);
    await syncPostTags(post.id, content);
    res.json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/posts/:id", authRequired, async (req, res) => {
  try {
    const post = await get("SELECT id, user_id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.user_id !== req.user.id) return res.status(403).json({ error: "Not allowed" });
    await run("DELETE FROM posts WHERE id = ?", [post.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

async function postLike(req, res, like) {
  const post = await get("SELECT id, user_id FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Post not found" });
  if (like) {
    const result = await run("INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)", [req.user.id, post.id]);
    if (result.changes) await createNotification(post.user_id, req.user.id, "like", { post_id: post.id });
  } else {
    await run("DELETE FROM likes WHERE user_id = ? AND post_id = ?", [req.user.id, post.id]);
  }
  res.json({ post: await getPostWithMeta(post.id, req.user.id) });
}
app.post("/api/posts/:id/like", authRequired, (req, res) => postLike(req, res, true).catch((e) => { console.error(e); res.status(500).json({ error: "Server error" }); }));
app.delete("/api/posts/:id/like", authRequired, (req, res) => postLike(req, res, false).catch((e) => { console.error(e); res.status(500).json({ error: "Server error" }); }));

async function postSave(req, res, save) {
  const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Post not found" });
  if (save) await run("INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)", [req.user.id, post.id]);
  else await run("DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?", [req.user.id, post.id]);
  res.json({ post: await getPostWithMeta(post.id, req.user.id) });
}
app.post("/api/posts/:id/save", authRequired, (req, res) => postSave(req, res, true).catch((e) => { console.error(e); res.status(500).json({ error: "Server error" }); }));
app.delete("/api/posts/:id/save", authRequired, (req, res) => postSave(req, res, false).catch((e) => { console.error(e); res.status(500).json({ error: "Server error" }); }));

app.post("/api/posts/:id/comments", authRequired, uploadMedia, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    if (hasExternalMediaInput(req)) return res.status(400).json({ error: "Media upload supports files only" });
    const media = uploadedMedia(req) || { url: "", type: "image" };
    if (!content && !media.url) return res.status(400).json({ error: "Comment must have text or an uploaded file" });
    if (content.length > 1000) return res.status(400).json({ error: "Comment must be 1000 characters or less" });
    const post = await get("SELECT id, user_id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    const result = await run(
      "INSERT INTO comments (post_id, user_id, content, image_url) VALUES (?, ?, ?, ?)",
      [post.id, req.user.id, content, media.url]
    );
    await createNotification(post.user_id, req.user.id, "comment", { post_id: post.id, comment_id: result.id });
    await notifyMentions(content, req.user.id, post.id, result.id);
    res.status(201).json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/comments/:id/like", authRequired, async (req, res) => {
  const comment = await get("SELECT id, user_id, post_id FROM comments WHERE id = ?", [req.params.id]);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  const result = await run("INSERT OR IGNORE INTO comment_likes (user_id, comment_id) VALUES (?, ?)", [req.user.id, comment.id]);
  if (result.changes) await createNotification(comment.user_id, req.user.id, "comment_like", { post_id: comment.post_id, comment_id: comment.id });
  res.json({ post: await getPostWithMeta(comment.post_id, req.user.id) });
});
app.delete("/api/comments/:id/like", authRequired, async (req, res) => {
  const comment = await get("SELECT id, post_id FROM comments WHERE id = ?", [req.params.id]);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  await run("DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?", [req.user.id, comment.id]);
  res.json({ post: await getPostWithMeta(comment.post_id, req.user.id) });
});

app.delete("/api/comments/:id", authRequired, async (req, res) => {
  try {
    const comment = await get("SELECT id, user_id, post_id FROM comments WHERE id = ?", [req.params.id]);
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    const post = await get("SELECT user_id FROM posts WHERE id = ?", [comment.post_id]);
    if (comment.user_id !== req.user.id && post?.user_id !== req.user.id) return res.status(403).json({ error: "Not allowed" });
    await run("DELETE FROM comments WHERE id = ?", [comment.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Stories ───────────────────────────────────────────────────────────────
app.get("/api/stories", authRequired, async (req, res) => {
  try {
    const viewerId = req.user?.id || -1;
    const rows = await all(
      `SELECT s.id, s.user_id, s.media_url, s.media_type, s.caption, s.created_at,
              u.username, u.avatar_url,
              (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id) AS views,
              EXISTS(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS seen
       FROM stories s JOIN users u ON u.id = s.user_id
       WHERE s.created_at >= datetime('now', '-1 day')
         AND ${VISIBLE_POST_SQL}
       ORDER BY s.created_at ASC`,
      [viewerId, viewerId, viewerId]
    );
    const groups = [];
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.user_id)) {
        const group = {
          user: { id: r.user_id, username: r.username, avatar_url: r.avatar_url || "" },
          seen: true,
          stories: [],
        };
        byUser.set(r.user_id, group);
        groups.push(group);
      }
      const st = {
        id: r.id,
        media_url: r.media_url,
        media_type: r.media_type,
        caption: r.caption,
        created_at: r.created_at,
        views: r.views,
        seen: !!r.seen,
      };
      byUser.get(r.user_id).stories.push(st);
      if (!st.seen) byUser.get(r.user_id).seen = false;
    }
    groups.sort((a, b) => (a.user.id === viewerId ? -1 : b.user.id === viewerId ? 1 : 0));
    res.json({ stories: groups });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/stories", authRequired, uploadMedia, async (req, res) => {
  try {
    if (hasExternalMediaInput(req)) return res.status(400).json({ error: "Story upload supports files only" });
    const media = uploadedMedia(req);
    if (!media?.url) return res.status(400).json({ error: "Story needs an uploaded image or video file" });
    const caption = String(req.body.caption || "").trim().slice(0, 300);
    const result = await run(
      "INSERT INTO stories (user_id, media_url, media_type, caption) VALUES (?, ?, ?, ?)",
      [req.user.id, media.url, media.type, caption]
    );
    res.status(201).json({ story: { id: result.id, media_url: media.url, media_type: media.type, caption } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/stories/:id/view", authRequired, async (req, res) => {
  await run("INSERT OR IGNORE INTO story_views (story_id, viewer_id) VALUES (?, ?)", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.delete("/api/stories/:id", authRequired, async (req, res) => {
  const story = await get("SELECT id, user_id FROM stories WHERE id = ?", [req.params.id]);
  if (!story) return res.status(404).json({ error: "Story not found" });
  if (story.user_id !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  await run("DELETE FROM stories WHERE id = ?", [story.id]);
  res.json({ ok: true });
});

// ── Direct messages ───────────────────────────────────────────────────────
function messageDTO(row) {
  return {
    id: row.id,
    sender: { id: row.sender_id, username: row.sender_username, avatar_url: row.sender_avatar || "" },
    recipient: { id: row.recipient_id, username: row.recipient_username, avatar_url: row.recipient_avatar || "" },
    body: row.body || "",
    image_url: row.image_url || "",
    created_at: row.created_at,
    read: !!row.read_at,
  };
}
const MESSAGE_SELECT = `
  SELECT m.*, s.username AS sender_username, s.avatar_url AS sender_avatar,
         r.username AS recipient_username, r.avatar_url AS recipient_avatar
  FROM messages m JOIN users s ON s.id = m.sender_id JOIN users r ON r.id = m.recipient_id `;

app.get("/api/messages/unread", authRequired, async (req, res) => {
  const row = await get("SELECT COUNT(*) AS count FROM messages WHERE recipient_id = ? AND read_at IS NULL", [req.user.id]);
  res.json({ count: row.count });
});

app.get("/api/messages/conversations", authRequired, async (req, res) => {
  const partners = await all(
    `SELECT DISTINCT u.id, u.username, u.full_name, u.avatar_url
     FROM messages m JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END
     WHERE m.sender_id = ? OR m.recipient_id = ? ORDER BY u.username`,
    [req.user.id, req.user.id, req.user.id]
  );
  const conversations = [];
  for (const p of partners) {
    const last = await get(`${MESSAGE_SELECT} WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?) ORDER BY m.id DESC LIMIT 1`,
      [req.user.id, p.id, p.id, req.user.id]);
    const unread = await get("SELECT COUNT(*) AS count FROM messages WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL", [p.id, req.user.id]);
    conversations.push({ user: p, last_message: last ? messageDTO(last) : null, unread: unread.count });
  }
  conversations.sort((a, b) => String(b.last_message?.created_at || "").localeCompare(String(a.last_message?.created_at || "")));
  res.json({ conversations });
});

app.get("/api/messages/:username", authRequired, async (req, res) => {
  const user = await get("SELECT id, username, full_name, avatar_url FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
  if (!user) return res.status(404).json({ error: "User not found" });
  const rows = await all(`${MESSAGE_SELECT} WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?) ORDER BY m.id ASC`,
    [req.user.id, user.id, user.id, req.user.id]);
  await run("UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL", [user.id, req.user.id]);
  res.json({ user, messages: rows.map(messageDTO) });
});

app.post("/api/messages/:username", authRequired, uploadMedia, async (req, res) => {
  const user = await get("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
  if (!user) return res.status(404).json({ error: "User not found" });
  const body = String(req.body.body || "").trim().slice(0, 2000);
  if (hasExternalMediaInput(req)) return res.status(400).json({ error: "Media upload supports files only" });
  const media = uploadedMedia(req);
  if (!body && !media?.url) return res.status(400).json({ error: "Write a message or upload a file" });
  const result = await run(
    "INSERT INTO messages (sender_id, recipient_id, body, image_url) VALUES (?, ?, ?, ?)",
    [req.user.id, user.id, body, media?.url || ""]
  );
  await createNotification(user.id, req.user.id, "message");
  const row = await get(`${MESSAGE_SELECT} WHERE m.id = ?`, [result.id]);
  res.status(201).json({ message: messageDTO(row) });
});

app.delete("/api/messages/:id", authRequired, async (req, res) => {
  const msg = await get("SELECT id, sender_id FROM messages WHERE id = ?", [req.params.id]);
  if (!msg) return res.status(404).json({ error: "Message not found" });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: "Not allowed" });
  await run("DELETE FROM messages WHERE id = ?", [msg.id]);
  res.json({ ok: true });
});

// ── Notifications ─────────────────────────────────────────────────────────
const NOTIFICATION_TEXT = {
  like: "liked your post.",
  comment: "commented on your post.",
  comment_like: "liked your comment.",
  follow: "started following you.",
  follow_request: "requested to follow you.",
  follow_accepted: "accepted your follow request.",
  mention: "mentioned you in a post.",
  mention_comment: "mentioned you in a comment.",
  message: "sent you a message.",
};

app.get("/api/notifications", authRequired, async (req, res) => {
  const rows = await all(
    `SELECT n.*, u.username AS actor_username, u.avatar_url AS actor_avatar
     FROM notifications n JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 50`,
    [req.user.id]
  );
  const unreadRow = await get("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", [req.user.id]);
  res.json({
    unread: unreadRow.count,
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      text: NOTIFICATION_TEXT[n.type] || "sent you an activity.",
      actor: { id: n.actor_id, username: n.actor_username, avatar_url: n.actor_avatar || "" },
      post_id: n.post_id,
      comment_id: n.comment_id,
      created_at: n.created_at,
      read: !!n.read_at,
    })),
  });
});

app.post("/api/notifications/read", authRequired, async (req, res) => {
  await run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL", [req.user.id]);
  res.json({ ok: true });
});

app.post("/api/notifications/:id/read", authRequired, async (req, res) => {
  await run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Unified real search ───────────────────────────────────────────────────
app.get("/api/search", authRequired, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ users: [], posts: [], tags: [] });
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const [userRows, postRows, tagRows] = await Promise.all([
      all(
        `SELECT id, username, full_name, bio, avatar_url, is_private, last_seen, created_at
         FROM users WHERE username COLLATE NOCASE LIKE ? ESCAPE '\\' OR full_name COLLATE NOCASE LIKE ? ESCAPE '\\' OR bio COLLATE NOCASE LIKE ? ESCAPE '\\'
         ORDER BY username LIMIT 10`,
        [like, like, like]
      ),
      all(
        `SELECT DISTINCT p.id FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN post_hashtags ph ON ph.post_id = p.id
         LEFT JOIN hashtags h ON h.id = ph.tag_id
         WHERE (p.content COLLATE NOCASE LIKE ? ESCAPE '\\' OR h.tag COLLATE NOCASE LIKE ? ESCAPE '\\')
           AND ${VISIBLE_POST_SQL}
         ORDER BY p.created_at DESC LIMIT 20`,
        [like, `%${q.replace(/^#/, "").replace(/[\\%_]/g, "\\$&")}%`, req.user.id, req.user.id]
      ),
      all(
        `SELECT h.tag, COUNT(ph.post_id) AS posts FROM hashtags h
         LEFT JOIN post_hashtags ph ON ph.tag_id = h.id
         WHERE h.tag LIKE ? ESCAPE '\\' GROUP BY h.id ORDER BY posts DESC, h.tag LIMIT 10`,
        [`%${q.replace(/^#/, "").replace(/[\\%_]/g, "\\$&")}%`]
      ),
    ]);
    res.json({
      users: await usersWithFollowState(userRows, req.user?.id),
      posts: await hydratePosts(postRows, req.user?.id),
      tags: tagRows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/tags/trending", authRequired, async (_req, res) => {
  const rows = await all(
    `SELECT h.tag, COUNT(ph.post_id) AS posts FROM hashtags h
     JOIN post_hashtags ph ON ph.tag_id = h.id GROUP BY h.id ORDER BY posts DESC, h.tag LIMIT 10`
  );
  res.json({ tags: rows });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
