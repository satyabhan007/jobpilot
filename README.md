# 🛰️ JobPilot — Satyabhan's Local AI Job Agent

A single-page web app that runs **entirely in your browser** and finds jobs relevant to your
experience. It connects to **your Gmail** (read-only OAuth), pulls live postings from free
**job-board APIs**, and scores everything **0–100** against your profile with human-readable
reasons. Optionally, it can re-rank the top matches with any OpenAI-compatible LLM
(OpenAI / DeepSeek / Groq / Ollama).

No backend, no database, no telemetry — your data lives in your browser's localStorage.

---

## Your profile, pre-loaded

The app ships with **Satyabhan's real profile**, integrated from
<https://satyabhan007.github.io> (Senior AI Engineer — Production GenAI, LLMs & Agents,
8+ YOE, Pune / hybrid-remote):

- **Profile summary card** in the sidebar: headline, 8+ yrs / Pune / remote chips, summary,
  and quick links (site, résumé PDF, GitHub, LinkedIn, email, phone)
- **Matching defaults**: 56 job-search-friendly skills (genai, rag, langchain, langgraph,
  vertex ai, gemini, vllm, qdrant, pytorch, docker, kubernetes, terraform, …) and 16 target
  roles (senior AI engineer, genai engineer, llm engineer, mlops engineer, …)
- **AI re-ranking prompt** includes the full career context (CLINIRISE, 400+ curriculum
  chapters, multi-agent + RAG depth) so the LLM judges fit like a recruiter, not a keyword filter
- **Demo data** is themed to his profile — Senior AI Engineer / GenAI / LLM / MLOps roles at
  Indian and remote companies — so scores look realistic out of the box

**Single source of truth: `js/portfolio.js`.** Edit that file (name, skills, roles, links,
summary) and everything — form defaults, summary card, matcher, AI prompt — updates together.
The sidebar also has **↺ Reset to my portfolio profile** to undo any manual tweaks.

Matcher notes for this profile:

- Short skills like `rag` / `llm` / `gcp` are matched as **whole words**, so "Storage
  Administrator" never counts as a RAG hit
- Role tokens are expanded with **synonyms** (`genai ↔ generative ai`, `ml ↔ machine
  learning`, `llm ↔ large language`), so job titles match target roles in either phrasing

---

## Quick start

```bash
cd /workspace/satyabhan-ai-app
python3 -m http.server 8000
```

Then open **http://localhost:8000**

> ⚠️ You must use `http://localhost:8000` (not `file://`) — Google OAuth only works on an
> http origin, and `localhost` is an allowed origin by default.

### Try it in 10 seconds

1. Click **Demo data** (top right) — loads sample AI/GenAI jobs + sample recruiter emails
2. Your profile is already loaded from the portfolio (tweak any sidebar field to re-score)
3. Watch every card get a match score with reasons

---

## Connecting Gmail — one-click sign-in

**The easy path:** open the app → click **Sign in with Google** → pick your account → done.
Repeat the same button for each additional Gmail account, then hit **Scan all inboxes**.

The first time (no Client ID yet), the button opens a **setup wizard** that walks you
through a one-time ~5 minute configuration and shows the exact values to register,
with copy buttons:

1. Go to <https://console.cloud.google.com/> → create a project (any name)
2. **APIs & Services → Library** → search **"Gmail API"** → **Enable**
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name, your email — defaults are fine
   - Under **Test users**, add your own Gmail address
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `http://localhost:8000`
   - **Authorized redirect URIs**: `http://localhost:8000/`
   - Copy the **Client ID** (looks like `1234-abc.apps.googleusercontent.com`)
5. Paste it in the wizard → **Save & Connect** → pick your account → allow

> The Client ID is **not secret** — it's safe in this local file (only Google's
> `client_secret` is secret, and browser sign-in never uses it). You can also bake it
> into `js/portfolio.js` (`gmailClientId`) so the field disappears forever.

### The login link (no popups needed / phone)

**🔗 Copy login link** copies a direct Google consent URL for this app. Use it when:

- popups are blocked (private windows, hardened browsers) — the app also falls back to
  it **automatically** if the popup fails
- you want to connect Gmail from your **phone's browser** — paste the link there, sign in,
  and Google redirects straight back into the app

The redirect back is handled automatically (`#access_token=…` is validated, the account is
registered, and the URL is cleaned). A CSRF `state` value guards the round-trip.

### Why not the APK?

Google only accepts OAuth from registered `http(s)` origins — a bare `file://` page can
never be one. That is exactly why the APK is **connected to GitHub Pages** (see next
section): when online it loads the hosted app, so Gmail sign-in works right inside the
APK once you add `https://satyabhan007.github.io` as an Authorized JavaScript origin in
Google Cloud. Only the offline fallback copy is limited (boards, matching, saved jobs —
no Gmail sign-in).

Then hit **📥 Scan all inboxes**. It searches each connected inbox from the last 45 days
(configurable) for recruiter outreach, application confirmations, and interview invites,
extracts the company, role, and any apply links, and scores them like regular jobs.

**Read-only**: the app requests `gmail.readonly` only. Emails are read by Google's API from
your browser and never sent anywhere else.

---

## Hosting on GitHub Pages — owner-only access 🔒

The app is 100% static, so GitHub Pages hosts it perfectly. A built-in **identity gate**
makes the hosted build exclusive: a lock screen only admits **@satyabhan007** (set
`githubOwner` in `js/portfolio.js`). Everyone else sees the lock, not your data.

### Deploy (2 options)

**Option A — dedicated repo + Actions (recommended, auto-deploys on push):**

```bash
cd JobPilot
git init && git add -A && git commit -m "JobPilot"
gh repo create jobpilot --public --source=. --push   # or create on github.com and push manually
```
Then in the repo: **Settings → Pages → Source: GitHub Actions**. The included workflow
(`.github/workflows/deploy-pages.yml`) builds `dist/` and deploys on every push.
Site: `https://satyabhan007.github.io/jobpilot/`

**Option B — drop into your existing user site:**

```bash
bash scripts/build-dist.sh          # creates dist/ (index.html + css/ + js/)
# copy dist/* into satyabhan007.github.io under a jobpilot/ folder, commit, push
```
Site: `https://satyabhan007.github.io/jobpilot/`

### The lock screen (how you get in)

On any hosted `http(s)` origin the gate arms itself automatically — including `localhost`
(you sign in once per browser; the session is remembered). The **Android APK** is never
gated, because the app is local to your device there.

1. **Sign in with GitHub (one click)** — OAuth **Device Flow**, no client secret needed:
   - create an OAuth App at `github.com/settings/developers` → New OAuth App →
     any homepage URL → tick **“Enable Device Flow”** → copy the **Client ID**
   - paste it on the lock screen once (or pre-set `githubClientId` in `js/portfolio.js`)
   - click **Sign in with GitHub** → open `github.com/login/device` → enter the code → done
2. **Personal Access Token** — always works, even if your network blocks the OAuth flow:
   - create a classic token with only the `read:user` scope (link is on the lock screen)
   - paste → verified against `api.github.com/user`

The verified session is remembered per browser and re-checked against GitHub's API on
every load. **Settings → 🔒 Private access** shows who is verified, can re-verify, or
lock the app instantly. A visitor signed into the wrong account is refused by name.

### Gmail on Pages

Add `https://satyabhan007.github.io` under *Authorized JavaScript origins* in the same
Google OAuth client — the setup wizard auto-detects and suggests exactly this origin.

### The APK ↔ Pages connection (hybrid shell)

The APK's WebView is **remote-first, local-fallback**:

1. **Online** → it loads `https://satyabhan007.github.io/jobpilot/` — the newest hosted
   build, with working Gmail sign-in (https origin) and the owner-only gate. Push to the
   repo and every device updates on next open: **no APK rebuild, no reinstall**.
2. **Offline / site not deployed yet** → it automatically falls back to the copy bundled
   in the APK (`assets/www`): job boards (cached), demo data, local 0–100 matching,
   saved/dismissed jobs. Gmail sign-in needs the online version.
3. **Navigation is locked** to the app origin plus Google/GitHub sign-in; every other
   link (apply pages, company sites) opens in your real browser instead of breaking
   the app.

Rebuild the APK only when the *shell* changes (rare) — all app logic, UI, sources and
scoring updates flow through git push. If you deploy under a different repo/user, change
one constant: `REMOTE_URL` in `MainActivity.java`.

### Honest privacy note

GitHub Pages serves **public code** — the gate verifies *who is using the app in a
browser*, it cannot hide the JS itself. That is fine in practice: your Gmail tokens,
AI API keys, saved jobs and profile live only in your own browser's localStorage and are
never synced anywhere. If you ever need code-level privacy, host `dist/` on any private
static host (or GitHub Pages with an Enterprise access-control policy).

---

## Job boards (no keys needed)

| Source | What it gives |
|---|---|
| **Arbeitnow** | Global + EU postings (60 latest) |
| **Remotive** | Remote-first jobs (60 latest) |
| **Hacker News** | Latest "Ask HN: Who is hiring?" thread comments |

Add your own source by appending to `JobSources.sources` in `js/jobs.js`:

```js
{
  id: 'mysource', name: 'My Source', note: 'whatever it is',
  fetch: async () => {
    const res = await fetch('https://my-api.example/jobs');
    const data = await res.json();
    return data.map(j => ({
      id: 'mysource-' + j.id, source: 'mysource',
      title: j.title, company: j.company, location: j.location || '',
      remote: !!j.remote, url: j.url, postedAt: Date.now(),
      tags: [], description: j.description || ''
    }));
  }
}
```

Then add an `<option>` for it in the **source filter** in `index.html`.
Note: the browser can only call APIs that allow CORS. If a source fails, JobPilot shows it
as failed in the sidebar and keeps everything else working.

---

## How matching works

Each job is scored 0–100 from four components:

| Component | Max | How |
|---|---|---|
| **Skills** | 40 | Each of your skills found in the title scores 9, in the body 5 |
| **Role fit** | 30 | Token overlap between the job title and your target roles |
| **Experience** | 20 | Parses "N+ years" from the description and compares with your years |
| **Location/remote** | 10 | Remote-friendly or matches one of your preferred locations |

Every card shows **why** it matched ("Your skill *react, typescript* appears in the job
title", "Requires 4+ yrs — you have 4", …). Tune weights in `js/matcher.js` to taste.

### Optional: AI re-ranking

Fill the **AI section** in the sidebar with any OpenAI-compatible endpoint:

- DeepSeek: base `https://api.deepseek.com/v1`, model `deepseek-chat`
- OpenAI: base `https://api.openai.com/v1`, model `gpt-4o-mini`
- Local Ollama: base `http://localhost:11434/v1`, model e.g. `llama3.1`

Then **✨ Re-rank top matches** sends the top 30 matches + your profile to the model and
blends an AI score/reason into each card. The API key is stored only in your browser and is
sent only to the endpoint you chose.

---

## Features

- 🎯 **Matches / Saved tabs**, live filter bar (keyword, min score, source, remote-only, sort)
- 📊 **Live dashboard stats** — jobs found, strong matches (≥70), saved, sources live
- ⭕ **Score rings** on every card, color-coded (green ≥70, amber ≥40) + company avatars
- 🌗 **Dark / light theme** toggle, remembered across sessions
- 📱 **Mobile-first UX** — settings slide in as a drawer, bottom nav bar (Matches / Saved / Setup), 44px+ touch targets
- ⏳ **Skeleton loading** while scanning, staggered card animations, animated toasts
- 📄 **"Show more" pagination** (60 cards at a time) so huge scans stay fast
- ⌨️ Keyboard shortcuts: `/` focuses search · `Esc` clears it or closes the drawer
- 🙈 Collapsible sidebar sections; 💾 save / ✕ dismiss with instant feedback
- ⚡ **Scan everything** — boards + Gmail in one click; per-source status + scan log
- ♻️ **Cached results** — last scan is restored on reload so the app opens with data
- 📧 **Gmail leads** get a special badge; deduped against board jobs
- ♿ Focus-visible outlines, aria labels, `prefers-reduced-motion` support
- 🔒 localStorage only — clear it from DevTools → Application → Local Storage to reset

## Project layout

```
index.html          page skeleton (stats row, drawer, bottom nav, skeletons)
css/styles.css      design system — dark + light themes, drawer, rings, responsive
js/portfolio.js     YOUR profile from satyabhan007.github.io (edit this!)
js/util.js          escaping, base64url, html→text, link extraction
js/storage.js       localStorage persistence (defaults = portfolio profile, + theme)
js/jobs.js          job-board fetchers (add yours here)
js/gmail.js         Google OAuth + inbox scanner
js/githubauth.js    GitHub identity gate — Device Flow + PAT verify + lock screen
js/matcher.js       local scoring engine (tune weights here)
js/llm.js           optional AI re-ranking (prompt includes portfolio context)
js/app.js           UI controller (stats, drawer, pagination, job cards, theme)
js/demo.js          sample data themed to your profile
scripts/build-dist.sh          build the GitHub-Pages-ready dist/ folder
.github/workflows/  auto-deploy to GitHub Pages on push
tests/              node sanity tests (node tests/profile.test.js, tests/matcher.test.js, …)
```

## Troubleshooting

- **"origin_mismatch" on Gmail connect** → the Authorized JavaScript origin in Google Cloud
  must exactly match the URL you're using, including the port.
- **Token expired / 401** → tokens last ~1h; just click **Connect Gmail** again.
- **A board shows "failed"** → that API's CORS policy or availability changed; the others
  keep working. Check the scan log at the bottom of the page.
- **AI rerank fails** → verify base URL (must end before `/chat/completions`), model name,
  and that the endpoint allows browser (CORS) requests.
- **Lock screen refuses you** → you're signed into a different GitHub account than
  `githubOwner` in `js/portfolio.js`. Switch accounts at github.com/login/device, or use
  the token method with a token from the right account.
- **"GitHub rejected this Client ID"** → the OAuth App must have **“Enable Device Flow”**
  ticked (github.com/settings/developers → your app).
- **Gate blocks local dev** → you only sign in once per browser (session persists). To
  disable entirely, set `gateEnabled: false` in `js/portfolio.js` and rebuild `dist/`.
