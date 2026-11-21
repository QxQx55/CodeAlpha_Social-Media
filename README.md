# CodeAlpha Social Media Platform

A mini social media app built for **CodeAlpha Task 2**. It includes user profiles, posts, comments, likes, and follow/unfollow functionality.

## Features

- **User profiles**: Register, login, bio, profile stats, and per-user post feed
- **Posts & comments**: Create posts and comment on any post, with photo uploads or camera capture
- **Like/follow system**: Like/unlike posts, save posts, and follow/unfollow users
- **Search & discovery**: Find people, see suggestions, and browse popular posts
- **Persistent database**: SQLite stores users, posts, comments, likes, follows, and saved posts

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (vanilla)
- **Backend**: Node.js, Express.js
- **Database**: SQLite (`sqlite3`)
- **Auth**: JWT in HTTP-only cookie + bcrypt password hashing

## Project Structure

```text
.
├── db.js               # SQLite connection and schema
├── server.js           # Express API and static file serving
├── public/
│   ├── index.html      # App layout
│   ├── styles.css      # Styling
│   └── app.js          # Frontend logic and API calls
├── package.json
└── data.db             # Created automatically on first run
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open the app:

   [http://localhost:3000](http://localhost:3000)

For development with auto-restart on Node 18+:

```bash
npm run dev
```

## API Overview

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Register new user | No |
| POST | `/api/auth/login` | Login | No |
| POST | `/api/auth/logout` | Logout | Yes |
| GET | `/api/auth/me` | Current user profile | Optional |
| GET | `/api/users/search?q=` | Search people | Optional |
| GET | `/api/users/suggested` | Get suggested people | Optional |
| GET | `/api/users/:username` | Get user profile | Optional |
| GET | `/api/users/:username/posts` | Get posts by user | Optional |
| GET | `/api/users/:username/followers` | List followers | Optional |
| GET | `/api/users/:username/following` | List followed users | Optional |
| PATCH | `/api/users/me` | Update own profile | Yes |
| POST | `/api/users/:username/follow` | Follow user | Yes |
| DELETE | `/api/users/:username/follow` | Unfollow user | Yes |
| POST | `/api/uploads` | Upload an image (jpg, png, gif, webp) | Yes |
| GET | `/api/posts` | Get latest posts | Optional |
| GET | `/api/posts/explore` | Get popular posts | Optional |
| GET | `/api/posts/saved` | Get saved posts | Yes |
| POST | `/api/posts` | Create post | Yes |
| DELETE | `/api/posts/:id` | Delete own post | Yes |
| POST | `/api/posts/:id/like` | Like post | Yes |
| DELETE | `/api/posts/:id/like` | Unlike post | Yes |
| POST | `/api/posts/:id/save` | Save post | Yes |
| DELETE | `/api/posts/:id/save` | Unsave post | Yes |
| POST | `/api/posts/:id/comments` | Add comment | Yes |
| DELETE | `/api/comments/:id` | Delete comment | Yes |

## Notes

- `data.db` is created in the project root when the server starts.
- Set `JWT_SECRET` in a `.env` file for non-development use.
- This is a learning/demo project and does not include production hardening (rate limiting, CSRF protection, input sanitization beyond basics, etc.).
