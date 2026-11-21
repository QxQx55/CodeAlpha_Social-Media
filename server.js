require("dotenv").config();
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { initDb, run, get, all } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_COOKIE = "token";

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

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

function authRequired(req, res, next) {
  const token = req.cookies[TOKEN_COOKIE];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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
  } catch {
    req.user = null;
  }
  next();
}

function safeUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, bio: row.bio || "", created_at: row.created_at };
}

async function getProfile(username, viewerId) {
  const user = await get(
    "SELECT id, username, bio, created_at FROM users WHERE username = ? COLLATE NOCASE",
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
  return {
    ...safeUser(user),
    followers: followers.count,
    following: following.count,
    postsCount: postsCount.count,
    isFollowing: !!isFollowing,
    isMe: viewerId === user.id,
  };
}

async function getPostWithMeta(postId, viewerId) {
  const post = await get(
    `SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username
     FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [postId]
  );
  if (!post) return null;
  const [likes, liked, comments] = await Promise.all([
    get("SELECT COUNT(*) AS count FROM likes WHERE post_id = ?", [postId]),
    viewerId ? get("SELECT 1 AS ok FROM likes WHERE user_id = ? AND post_id = ?", [viewerId, postId]) : null,
    all(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      [postId]
    ),
  ]);
  return {
    id: post.id,
    content: post.content,
    created_at: post.created_at,
    author: { id: post.user_id, username: post.username },
    likes: likes.count,
    liked: !!liked,
    comments,
  };
}

// Auth
app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const bio = String(req.body.bio || "").trim().slice(0, 200);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3-20 chars: letters, numbers, underscore" });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const existing = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    const hash = await bcrypt.hash(password, 10);
    const result = await run("INSERT INTO users (username, password_hash, bio) VALUES (?, ?, ?)", [username, hash, bio]);
    const user = { id: result.id, username };
    setAuthCookie(res, signToken(user));
    res.status(201).json({ user: await getProfile(username, result.id) });
  } catch (err) {
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
      `SELECT p.id FROM posts p WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC`,
      [user.id]
    );
    const full = [];
    for (const p of posts) full.push(await getPostWithMeta(p.id, req.user?.id));
    res.json({ posts: full });
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

// Posts
app.get("/api/posts", optionalAuth, async (req, res) => {
  try {
    const posts = await all(
      `SELECT id FROM posts ORDER BY created_at DESC, id DESC LIMIT 50`
    );
    const full = [];
    for (const p of posts) full.push(await getPostWithMeta(p.id, req.user?.id));
    res.json({ posts: full });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/posts", authRequired, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    if (!content) return res.status(400).json({ error: "Post content is required" });
    if (content.length > 500) return res.status(400).json({ error: "Post must be 500 characters or less" });
    const result = await run("INSERT INTO posts (user_id, content) VALUES (?, ?)", [req.user.id, content]);
    res.status(201).json({ post: await getPostWithMeta(result.id, req.user.id) });
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

app.post("/api/posts/:id/comments", authRequired, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    if (!content) return res.status(400).json({ error: "Comment content is required" });
    if (content.length > 300) return res.status(400).json({ error: "Comment must be 300 characters or less" });
    const post = await get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post not found" });
    await run("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)", [post.id, req.user.id, content]);
    res.status(201).json({ post: await getPostWithMeta(post.id, req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// SPA-ish fallback
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
