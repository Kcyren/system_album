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
3. Go to **Authentication → Users → Add user → Create new user**. Enter Surgthflur's email and a strong password, and tick **Auto Confirm User**.
4. Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Nobody else needs an account.

### 2. Connect the code
1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org).
2. In this folder, copy `.env.example` to `.env` and fill it in. Find the values in Supabase → **Project Settings → API Keys** and **Data API**:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_PUBLISHABLE_KEY`: the publishable key (or the legacy `anon` key)
   - `SUPABASE_SECRET_KEY`: the secret key (or the legacy `service_role` key). **Never share or commit this.**
   - `CREATOR_EMAIL`: the email from step 1.3
3. Run:

```bash
npm install
npm run check   # confirms tables, storage, security and the creator account
npm run dev     # starts the site and restarts it automatically when you edit files
```

4. Open **http://localhost:3000** for the site and **http://localhost:3000/studio** for the Creator Studio.

---

## Put it online (Render, free plan)

1. Push this project to GitHub (repo `system_album`).
2. At [render.com](https://render.com) choose **New → Web Service** and pick the repo.
3. Settings: **Build command** `npm install` · **Start command** `npm start`.
4. Under **Environment**, add the same variables as your `.env`, plus:
   - `NODE_ENV` = `production`
   - `PUBLIC_URL` = your Render address, e.g. `https://system-album.onrender.com`
5. Deploy. Every push to GitHub redeploys automatically.

Good to know:
- Render's free plan sleeps after inactivity, so the first visit can take around 30 seconds. A paid instance (or Railway or Fly.io) avoids that.
- All files live in Supabase, so the server doesn't need its own disk.
- **Supabase Free** allows up to **50 MB per file** and 1 GB of storage in total. Short videos fit well. Upgrade, or export videos at 720p, if you need more.
- Want a custom domain like `systemalbum.com`? Add it in Render, then update `PUBLIC_URL`.

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
- An email follow form, with spam protection and an unsubscribe link for every follower.

**Creator Studio** (`/studio`)
- Upload audio or video with a progress bar, add a cover, and preview the recording and its card before publishing.
- Save drafts, preview drafts on the real site (only he can see them), publish, unpublish, edit or delete. Deleting also removes the files.
- Manage albums, including covers, descriptions, release dates, adding tracks and setting the running order.
- Edit the profile: photo, bio, homepage tagline, System Album intro, and TikTok/YouTube/Facebook links (only filled-in links appear).
- Journey: add or edit milestones and pick the "Then & now" pair.
- Manage categories, see followers and download them as CSV, view play and reaction stats, change the password.

---

## Project layout

```
server.js            starts the app, security headers
src/config.js        reads .env
src/supabase.js      Supabase connection + file URLs
src/auth.js          sign in/out, sessions, "creator only" guard
src/public-api.js    catalog, plays, reactions, follow
src/studio-api.js    everything the Creator Studio can change
src/catalog.js       track/album formatting + journey calculations
src/pages.js         pages + share previews, unsubscribe page
public/              the website, studio, styles, icons, PWA files
supabase/schema.sql  database setup (run once in Supabase)
scripts/check.js     `npm run check` setup checker
scripts/make-icons.js regenerates the app icons
```

---

## Ideas for next steps

1. **Automatic new-release emails.** Connect Resend, Brevo or MailerLite so followers get an email when a track is published. Today you export the CSV.
2. **Video thumbnails and compression.** Make smaller web versions of large phone videos automatically.
3. **Waveform display** on track pages, drawn from the audio.
4. **Lyrics / bars** field for freestyles, shown alongside playback.
5. **Weekly stats chart** in the Studio, showing plays over time.
6. **Comments or shout-outs**, with moderation.
7. **Offline listening** for tracks you've saved in the installed app.

Note: `index-html.html` is the original front-end demo, kept for reference. The live site is in `public/`.
