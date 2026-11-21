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
app.use(express.static(path.join(__dirname, "public")));

const uploadsDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || "").toLowerCase().match(/\.(jpe?g|png|gif|webp)$/) || [""])[0] || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only image files (jpg, png, gif, webp) are allowed"));
  },
});

function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "Upload failed" });
      next();
    });
  };
}

function normalizeImageUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.startsWith("/uploads/")) return v;
  if (isHttpUrl(v)) return v.slice(0, 500);
  return null;
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

function safeUser(row, viewerId) {
  if (!row) return null;
  const isMe = viewerId === row.id;
  return {
    id: row.id,
    username: row.username,
    bio: row.bio || "",
    avatar_url: row.avatar_url || "",
    phone: isMe ? (row.phone || "") : undefined,
    last_seen: row.last_seen || row.created_at,
    created_at: row.created_at,
  };
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

async function getProfile(username, viewerId) {
  const user = await get(
    "SELECT id, username, bio, avatar_url, phone, last_seen, created_at FROM users WHERE username = ? COLLATE NOCASE",
    [username]
  );
  if (!user) return null;
  const [followers, following, postsCount, isFollowing] = await Promise.all([
    get("SELECT COUNT(*) AS count FROM follows WHERE following_id = ?", [user.id]),
    get("SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?", [user.id]),
    get("SELECT COUNT(*) AS count FROM posts WHERE user_id = ?", [user.id]),
    viewerId
      ? get("SELECT 1 AS ok FROM follows WHERE follower_id = ? AND following_id = ?", [viewerId, user.id])
      : Promise.resolve(null),
  ]);
  const base = safeUser(user, viewerId);
  return {
    ...base,
    followers: followers.count,
    following: following.count,
    postsCount: postsCount.count,
    isFollowing: !!isFollowing,
    isMe: viewerId === user.id,
    last_seen_text: lastSeenLabel(user.last_seen),
  };
}

async function getPostWithMeta(postId, viewerId) {
  const post = await get(
    `SELECT p.id, p.content, p.image_url, p.created_at, u.id AS user_id, u.username, u.avatar_url
     FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [postId]
  );
  if (!post) return null;
  const [likes, liked, saved, comments] = await Promise.all([
    get("SELECT COUNT(*) AS count FROM likes WHERE post_id = ?", [postId]),
    viewerId ? get("SELECT 1 AS ok FROM likes WHERE user_id = ? AND post_id = ?", [viewerId, postId]) : null,
    viewerId ? get("SELECT 1 AS ok FROM saved_posts WHERE user_id = ? AND post_id = ?", [viewerId, postId]) : null,
    all(
      `SELECT c.id, c.content, c.image_url, c.created_at, u.id AS user_id, u.username, u.avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      [postId]
    ),
  ]);
  return {
    id: post.id,
    content: post.content,
    image_url: post.image_url || "",
    created_at: post.created_at,
    author: { id: post.user_id, username: post.username, avatar_url: post.avatar_url || "" },
    likes: likes.count,
    liked: !!liked,
    saved: !!saved,
    comments: comments.map((c) => ({ ...c, image_url: c.image_url || "" })),
  };
}

async function hydratePosts(ids, viewerId) {
  const full = [];
  for (const p of ids) full.push(await getPostWithMeta(p.id, viewerId));
  return full.filter(Boolean);
}

// Auth
app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const bio = String(req.body.bio || "").trim().slice(0, 200);
    const phone = String(req.body.phone || "").trim().replace(/[\s()-]/g, "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3-20 chars: letters, numbers, underscore" });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: "Enter a valid phone number (8-15 digits, optional +)" });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const existing = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    const existingPhone = await get("SELECT id FROM users WHERE phone = ?", [phone]);
    if (existingPhone) return res.status(409).json({ error: "Phone number already registered" });
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      "INSERT INTO users (username, password_hash, bio, phone, last_seen) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
      [username, hash, bio, phone]
    );
    const user = { id: result.id, username };
    setAuthCookie(res, signToken(user));
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

// Users / profiles
app.get("/api/users/search", optionalAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ users: [] });
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const rows = await all(
      `SELECT id, username, bio, avatar_url, last_seen, created_at FROM users WHERE username LIKE ? COLLATE NOCASE ORDER BY username ASC LIMIT 20`,
      [like]
    );
    res.json({ users: rows.map((r) => safeUser(r, req.user?.id)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/suggested", optionalAuth, async (req, res) => {
  try {
    const viewerId = req.user?.id || -1;
    const rows = await all(
      `SELECT u.id, u.username, u.bio, u.avatar_url, u.last_seen, u.created_at
       FROM users u
       WHERE u.id != ?
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id)
       ORDER BY (SELECT COUNT(*) FROM follows f2 WHERE f2.following_id = u.id) DESC, u.created_at DESC
       LIMIT 5`,
      [viewerId, viewerId]
    );
    res.json({ users: rows.map((r) => safeUser(r, req.user?.id)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/users/me", authRequired, async (req, res) => {
  try {
    const bio = String(req.body.bio ?? "").trim().slice(0, 200);
    const avatar_url = String(req.body.avatar_url ?? "").trim().slice(0, 500);
    const phone = String(req.body.phone ?? "").trim().replace(/[\s()-]/g, "");
    if (avatar_url && !isHttpUrl(avatar_url)) return res.status(400).json({ error: "Avatar must be a valid http(s) URL" });
    if (!isValidPhone(phone)) return res.status(400).json({ error: "Enter a valid phone number (8-15 digits, optional +)" });
    const existingPhone = await get("SELECT id FROM users WHERE phone = ? AND id != ?", [phone, req.user.id]);
    if (existingPhone) return res.status(409).json({ error: "Phone number already registered" });
    await run("UPDATE users SET bio = ?, avatar_url = ?, phone = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?", [bio, avatar_url, phone, req.user.id]);
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

app.get("/api/users/:username", optionalAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.params.username, req.user?.id);
    if (!profile) return res.status(404).json({ error: "User not found" });
    res.json({ user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/posts", optionalAuth, async (req, res) => {
  try {
    const user = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const posts = await all(
      `SELECT id FROM posts WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
      [user.id]
    );
    res.json({ posts: await hydratePosts(posts, req.user?.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/followers", optionalAuth, async (req, res) => {
  try {
    const user = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const rows = await all(
      `SELECT u.id, u.username, u.bio, u.avatar_url, u.last_seen, u.created_at FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=? ORDER BY f.created_at DESC`,
      [user.id]
    );
    res.json({ users: rows.map((r) => safeUser(r, req.user?.id)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:username/following", optionalAuth, async (req, res) => {
  try {
    const user = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const rows = await all(
      `SELECT u.id, u.username, u.bio, u.avatar_url, u.last_seen, u.created_at FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=? ORDER BY f.created_at DESC`,
      [user.id]
    );
    res.json({ users: rows.map((r) => safeUser(r, req.user?.id)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/users/:username/follow", authRequired, async (req, res) => {
  try {
    const target = await get("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE", [req.params.username]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.id === req.user.id) return res.status(400).json({ error: "Cannot follow yourself" });
    await run("INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [req.user.id, target.id]);
    res.json({ user: await getProfile(target.username, req.user.id) });
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
    res.json({ user: await getProfile(target.username, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Uploads
app.post("/api/uploads", authRequired, uploadSingle("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file is required" });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// Posts
app.get("/api/posts", optionalAuth, async (req, res) => {
  try {
    const feed = String(req.query.feed || "all");
    let rows;
    if (feed === "following" && req.user) {
      rows = await all(
        `SELECT id FROM posts WHERE user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR user_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 50`,
        [req.user.id, req.user.id]
      );
    } else {
      rows = await all(`SELECT id FROM posts ORDER BY created_at DESC, id DESC LIMIT 50`);
    }
    res.json({ posts: await hydratePosts(rows, req.user?.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/posts/explore", optionalAuth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT p.id FROM posts p
       LEFT JOIN likes l ON l.post_id = p.id
       GROUP BY p.id
       ORDER BY COUNT(l.user_id) DESC, p.created_at DESC
       LIMIT 30`
    );
    res.json({ posts: await hydratePosts(rows, req.user?.id) });
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

app.post("/api/posts", authRequired, uploadSingle("image"), async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const uploaded = req.file ? `/uploads/${req.file.filename}` : "";
    const rawImage = uploaded || String(req.body.image_url || "").trim();
    const image_url = normalizeImageUrl(rawImage);
    if (image_url === null) return res.status(400).json({ error: "Image must be a valid URL or uploaded file" });
    if (!content && !image_url) return res.status(400).json({ error: "Post must have text or an image" });
    if (content.length > 700) return res.status(400).json({ error: "Post must be 700 characters or less" });
    const result = await run("INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)", [req.user.id, content, image_url]);
    res.status(201).json({ post: await getPostWithMeta(result.id, req.user.id) });
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

app.post("/api/posts/:id/like", authRequired, async (req, res) => {
  try {
    const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    await run("INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)", [req.user.id, post.id]);
    res.json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/posts/:id/like", authRequired, async (req, res) => {
  try {
    const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    await run("DELETE FROM likes WHERE user_id = ? AND post_id = ?", [req.user.id, post.id]);
    res.json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/posts/:id/save", authRequired, async (req, res) => {
  try {
    const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    await run("INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)", [req.user.id, post.id]);
    res.json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/posts/:id/save", authRequired, async (req, res) => {
  try {
    const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    await run("DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?", [req.user.id, post.id]);
    res.json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/posts/:id/comments", authRequired, uploadSingle("image"), async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const uploaded = req.file ? `/uploads/${req.file.filename}` : "";
    const rawImage = uploaded || String(req.body.image_url || "").trim();
    const image_url = normalizeImageUrl(rawImage);
    if (image_url === null) return res.status(400).json({ error: "Image must be a valid URL or uploaded file" });
    if (!content && !image_url) return res.status(400).json({ error: "Comment must have text or an image" });
    if (content.length > 300) return res.status(400).json({ error: "Comment must be 300 characters or less" });
    const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    await run("INSERT INTO comments (post_id, user_id, content, image_url) VALUES (?, ?, ?, ?)", [post.id, req.user.id, content, image_url]);
    res.status(201).json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/comments/:id", authRequired, async (req, res) => {
  try {
    const comment = await get("SELECT id, user_id, post_id FROM comments WHERE id = ?", [req.params.id]);
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    const post = await get("SELECT user_id FROM posts WHERE id = ?", [comment.post_id]);
    if (comment.user_id !== req.user.id && post?.user_id !== req.user.id) {
      return res.status(403).json({ error: "Not allowed" });
    }
    await run("DELETE FROM comments WHERE id = ?", [comment.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
