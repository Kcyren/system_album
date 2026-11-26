# System Album

A music showcase and installable app for **Surgthflur**: freestyles, mixes, short videos and the journey of getting better, one take at a time.

- **Visitors** listen, watch, search, explore albums and follow the journey. No account needed.
- **Surgthflur** signs in to a private **Creator Studio** to upload and manage everything.

---

## How it's built (in plain words)

| Part | What we use | Why |
|---|---|---|
| Website & Studio | Plain HTML, CSS and JavaScript | No build step and easy to read and change. Works on phones and computers. |
| Server | **Node.js + Express** (`server.js`) | Serves the pages and is the only thing allowed to talk to the database with full access. It checks who is signed in before any change. |
| Database | **Supabase Postgres** | Stores tracks, albums, profile, milestones, followers, play counts and reactions. |
| Files | **Supabase Storage** (`media` bucket) | Holds audio, video and images. Uploads go straight from the browser to Supabase, so big videos don't pass through the server. |
| Login | **Supabase Auth** | Real email and password sign-in. Only the email(s) in `CREATOR_EMAIL` can open the Studio. |
| App install | **PWA** (`manifest.webmanifest` + `sw.js`) | "Install app" on Android, desktop Chrome and Edge. On iPhone, use Share → *Add to Home Screen*. |

**How the security works:** the database has Row Level Security on with no public rules, so the public key can't read or change anything. Only the server can, using the **secret key**. The server only accepts Studio changes from a signed-in, allow-listed creator. The session lives in secure, HttpOnly cookies that page scripts can't read.

---

## Setup (about 15 minutes, one time)

### 1. Create the Supabase project
1. Sign in at [supabase.com](https://supabase.com) and click **New project**.
2. Open **SQL Editor → New query**, paste everything from [`supabase/schema.sql`](supabase/schema.sql) and press **Run**. This creates the tables, the default categories (Freestyle, Mix, Video) and the `media` storage bucket.
   Then do the same with each file in [`supabase/migrations/`](supabase/migrations/), in order. `002` adds lyrics, waveforms and weekly play stats.
3. (The creator account is made in step 2 with `npm run creator`, so no real email inbox is needed.)
4. Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Nobody else needs an account.

### 2. Connect the code
1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org).
2. In this folder, copy `.env.example` to `.env` and fill it in. Find the values in Supabase → **Project Settings → API Keys** and **Data API**:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_PUBLISHABLE_KEY`: the publishable key (or the legacy `anon` key)
   - `SUPABASE_SECRET_KEY`: the secret key (or the legacy `service_role` key). **Never share or commit this.**
   - `CREATOR_EMAIL`: his **username**, e.g. `surgthflur` (or a real email if he has one)
3. Run:

```bash
npm install
npm run creator # creates his account, or sets a new password (asks you to type it)
npm run check   # confirms tables, storage, security and the creator account
npm run dev     # starts the site and restarts it automatically when you edit files
```

4. Open **http://localhost:3000** for the site and **http://localhost:3000/studio** for the Creator Studio.

---

## Put it online (Vercel)

The repo includes [`vercel.json`](vercel.json), so Vercel runs the Node server as one serverless function ([`api/index.js`](api/index.js)) and serves `public/` from its CDN.

1. In Vercel, import the GitHub repo `system_album`. Leave Framework Preset as **Other**, with no build command.
2. Go to **Settings → Environment Variables** and add these for Production (and Preview if you use it):
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CREATOR_EMAIL`: the same values as your `.env`
   - `PUBLIC_URL` = `https://studioalbum.vercel.app` (or your custom domain)
3. Redeploy: open **Deployments → ⋯ → Redeploy**, or push to `main`. Environment variable changes only apply to new deployments.
4. Open `https://studioalbum.vercel.app/api/health`. It should show `"configured":true`.

### Connect the Vercel domain to Supabase
In Supabase, open **Authentication → URL Configuration**:
- **Site URL:** `https://studioalbum.vercel.app`
- **Redirect URLs:** add
  - `https://studioalbum.vercel.app/**`
  - `http://localhost:3000/**` (for testing on your computer)

Sign-in uses email and password through the server, so it works without these. They make sure any email Supabase sends, such as a password reset, links back to your site and not to `localhost`. If you add a custom domain later, add it here and update `PUBLIC_URL` in Vercel.

### The creator account (username + password)
- **Sign in:** **Username** = whatever is in `CREATOR_EMAIL` (e.g. `surgthflur`), plus the password.
- **Create the account or reset the password:** run `npm run creator` on your computer (it uses the secret key in `.env`). It works even if he forgot the old password, and it never needs an email inbox.
- **Change the password while signed in:** Studio → **Account**.
- Behind the scenes, a username becomes `username@systemalbum.app`, because Supabase needs an email-shaped login. Nothing is ever emailed there. When he has a real Gmail, set `CREATOR_EMAIL` to it, update the user's email in Supabase → Authentication → Users, and redeploy.

### Where the creator signs in
**https://studioalbum.vercel.app/studio** (also linked as "Creator Studio" in the site footer). Only the email in `CREATOR_EMAIL`, with a matching Supabase Auth user, can get in.

Good to know:
- **Supabase Free** allows up to **50 MB per file** and 1 GB of storage in total. Short videos fit well. Export long ones at 720p.
- Uploads go directly from the browser to Supabase, so Vercel's request size limits don't apply.

---

## What's included

**Public site**
- Latest uploads, plus a "More to discover" set that changes on every visit and avoids repeating the previous set.
- Search across titles, notes and albums, with category filters that come from the database (add more in the Studio).
- A player that keeps going while you browse: play/pause, seek, volume, previous/next, and a full-screen "Now playing" view. Video tracks show the video, and audio tracks show the cover or generated artwork. Lock-screen controls work on phones.
- Card videos play **muted** while they're on screen and pause when they leave. Sound starts only when the visitor presses play, which follows browser autoplay rules. Previews don't autoplay for visitors who prefer reduced motion or have Data Saver on.
- Track pages with the description, "How it was made", the progress note, 🔥/❤️ reactions, and sharing (WhatsApp, Facebook, copy link, phone share sheet). Shared links show a proper preview card with title and cover.
- Album pages with track order, total length and "Play album".
- **Journey**: personal milestones, automatic milestones taken only from real uploads (first track, first mix, first video, 10th/25th/50th track…), a "Then & now" comparison, and a dated timeline. Undated recordings still appear everywhere else.
- **Real play counts**: a play counts after about 5 seconds of actual listening, at most once per listener per track every 30 minutes.
- **Waveforms** on track pages and in the full-screen player. Click to jump to any moment. They're made automatically in the Studio when you upload.
- **Lyrics / bars** on track pages and in the full-screen player, and included in search.
- An email follow form, with spam protection and an unsubscribe link for every follower.

**Creator Studio** (`/studio`)
- Upload audio or video with a progress bar, add a cover, and preview the recording and its card before publishing.
- Save drafts, preview drafts on the real site (only he can see them), publish, unpublish, edit or delete. Deleting also removes the files.
- Manage albums, including covers, descriptions, release dates, adding tracks and setting the running order.
- Edit the profile: photo, bio, homepage tagline, System Album intro, and TikTok/YouTube/Facebook links (only filled-in links appear).
- Journey: add or edit milestones and pick the "Then & now" pair.
- Manage categories, see followers and download them as CSV, view play and reaction stats, change the password.
- A **plays per week** chart (last 12 weeks) and "Top this week" on the Overview.
- Lyrics on each track, and a one-click "Create missing waveforms" for older uploads.

---

## Project layout

```
server.js            local entry point (npm start / npm run dev)
api/index.js         Vercel entry point (same app as a serverless function)
vercel.json          Vercel routing
src/app.js           the Express app, security headers
views/               page templates (home, studio, 404)
src/config.js        reads .env
src/supabase.js      Supabase connection + file URLs
src/auth.js          sign in/out, sessions, "creator only" guard
src/public-api.js    catalog, plays, reactions, follow
src/studio-api.js    everything the Creator Studio can change
src/catalog.js       track/album formatting + journey calculations
src/pages.js         pages + share previews, unsubscribe page
public/              the website, studio, styles, icons, PWA files
supabase/schema.sql  database setup (run once in Supabase)
supabase/migrations/ later database updates (run each once, in order)
scripts/check.js     `npm run check` setup checker
scripts/make-icons.js regenerates the app icons
```

---

## Ideas for next steps

1. **Automatic new-release emails.** Connect Resend, Brevo or MailerLite so followers get an email when a track is published. Today you export the CSV.
2. **Video thumbnails and compression.** Make smaller web versions of large phone videos automatically.
3. **Comments or shout-outs**, with moderation.
4. **Offline listening** for tracks you've saved in the installed app.

Note: `index-html.html` is the original front-end demo, kept for reference. The live site is in `public/`.
