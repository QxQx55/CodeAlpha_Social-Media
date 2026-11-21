# Wave — Instagram-style Social Media Platform

A mini social media app built for **CodeAlpha Task 2**, expanded with an Instagram-like feature set. Everything is real and persisted in SQLite — posts, media, stories, reels, likes, comments, follows, DMs and notifications are stored in the database, not mocked in the browser.

## Features

- **Accounts & profiles**: register/login, full name, bio, website, phone, avatar (URL or upload), public/private accounts, follow requests
- **Real media posts**: create posts with an uploaded image/video, camera capture, or a pasted media URL; hashtags and `@mentions`
- **Stories**: photo/video stories from camera or upload, 24-hour expiry, view counts, seen state, delete your own
- **Reels**: video/image reels with playback, likes and comments
- **Feed**: For you / Following, double-tap to like, likes, comments (text + media), comment likes, saves, share link
- **Explore**: popular posts, trending hashtags, hashtag filtering
- **Direct messages**: conversation list, unread counts, text and media attachments, seen status
- **Activity / notifications**: likes, comments, comment likes, follows, follow requests, mentions and messages
- **Real search**: unified search across people, post captions/hashtags and tags, with instant dropdown and results page
- **Persistence**: SQLite stores users, posts, stories, reels, media metadata, comments, likes, follows, DMs, notifications, hashtags and more

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (vanilla)
- **Backend**: Node.js, Express.js
- **Database**: SQLite (`sqlite3`)
- **Auth**: JWT in HTTP-only cookie + bcrypt password hashing
- **Uploads**: multer (images + video, camera Blob uploads)

## Project Structure

```text
.
├── db.js               # SQLite connection, schema and migrations
├── server.js           # Express API, uploads and static file serving
├── public/
│   ├── index.html      # App layout and views
│   ├── styles.css      # Instagram-style styling
│   ├── app.js          # Frontend logic and API calls
│   └── uploads/        # User-uploaded photos/videos (created automatically)
├── package.json
└── data.db             # Created automatically on first run
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server (default port 3000):

   ```bash
   npm start
   ```

   To run on another port (e.g. 5000):

   ```bash
   # Windows PowerShell
   $env:PORT=5000
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000) (or your chosen port).

For development with auto-restart on Node 18+:

```bash
npm run dev
```

## Docker

Build and run locally (port 5000, persistent data + uploads):

```bash
docker compose up -d --build
```

Then open [http://localhost:5000](http://localhost:5000).

Or build/run the image directly:

```bash
docker build -t wave-social .
docker run -d -p 5000:5000 \
  -e PORT=5000 \
  -e JWT_SECRET=change-me \
  -v wave-data:/app/data \
  -v wave-uploads:/app/public/uploads \
  wave-social
```

SQLite data lives in `/app/data/data.db` and uploaded media in `/app/public/uploads`; both are declared as volumes so they survive container restarts.

## API Overview

### Auth & users
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Register (username, phone, password, full_name, bio) | No |
| POST | `/api/auth/login` | Login | No |
| POST | `/api/auth/logout` | Logout | Yes |
| GET | `/api/auth/me` | Current user profile | Optional |
| GET | `/api/users/search?q=` | Search people | Optional |
| GET | `/api/users/suggested` | Suggested people | Optional |
| GET | `/api/users/:username` | User profile | Optional |
| GET | `/api/users/:username/posts` | Posts by user | Optional |
| GET | `/api/users/:username/reels` | Reels by user | Optional |
| GET | `/api/users/:username/followers` | Followers list | Optional |
| GET | `/api/users/:username/following` | Following list | Optional |
| PATCH | `/api/users/me` | Update profile (supports avatar upload + private flag) | Yes |
| POST | `/api/users/:username/follow` | Follow / request to follow | Yes |
| DELETE | `/api/users/:username/follow` | Unfollow / cancel request | Yes |
| GET | `/api/users/me/follow-requests` | Pending follow requests | Yes |
| POST | `/api/users/me/follow-requests/:username/accept` | Accept request | Yes |
| DELETE | `/api/users/me/follow-requests/:username` | Decline request | Yes |

### Media & posts
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/uploads` | Upload a single image | Yes |
| GET | `/api/posts?feed=all\|following` | Latest posts | Optional |
| GET | `/api/posts/:id` | Single post | Optional |
| GET | `/api/posts/explore?tag=` | Popular posts, optional hashtag filter | Optional |
| GET | `/api/posts/saved` | Saved posts | Yes |
| GET | `/api/reels` | Reels feed | Optional |
| POST | `/api/posts` | Create post/reel (multipart `media` or `image_url`, `kind`, `content`) | Yes |
| DELETE | `/api/posts/:id` | Delete own post | Yes |
| POST / DELETE | `/api/posts/:id/like` | Like / unlike | Yes |
| POST / DELETE | `/api/posts/:id/save` | Save / unsave | Yes |
| POST | `/api/posts/:id/comments` | Add comment (text and/or media) | Yes |
| POST / DELETE | `/api/comments/:id/like` | Like / unlike comment | Yes |
| DELETE | `/api/comments/:id` | Delete comment | Yes |

### Stories, messages, activity & search
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/stories` | Active stories grouped by user | Optional |
| POST | `/api/stories` | Create story (`media`, `caption`) | Yes |
| POST | `/api/stories/:id/view` | Mark story viewed | Yes |
| DELETE | `/api/stories/:id` | Delete own story | Yes |
| GET | `/api/messages/conversations` | Conversation list with unread counts | Yes |
| GET | `/api/messages/unread` | Unread message count | Yes |
| GET | `/api/messages/:username` | Thread with a user (marks read) | Yes |
| POST | `/api/messages/:username` | Send message (`body`, optional `media`) | Yes |
| DELETE | `/api/messages/:id` | Delete own message | Yes |
| GET | `/api/notifications` | Activity list + unread count | Yes |
| POST | `/api/notifications/read` | Mark all read | Yes |
| POST | `/api/notifications/:id/read` | Mark one read | Yes |
| GET | `/api/search?q=` | Unified search: users, posts, tags | Optional |
| GET | `/api/tags/trending` | Trending hashtags | Optional |

## Notes

- `data.db` and `public/uploads/` are created automatically.
- Camera capture works over `localhost` (secure context). Browsers require permission; uploaded/captured media is saved to disk and served from `/uploads/`.
- Set `JWT_SECRET` in a `.env` file for non-development use.
- This is a learning/demo project and does not include production hardening (rate limiting, CSRF protection, virus scanning of uploads, etc.).
