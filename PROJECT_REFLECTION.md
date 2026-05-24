# Project Reflection — GateKeep

**Project type:** Full-stack web app (facial recognition security system)
**Stack:** FastAPI, Python, InsightFace (buffalo_sc), SQLite, React, Vite, OpenCV-Headless
**Live at:** https://gatekeep.dominioneze.dev
**Repo:** https://github.com/fortdominz/GateKeep
**Deployed:** May 2026
**Built by:** Dominion Eze

---

## Overview

GateKeep is a browser-based facial recognition security system. Visitors open the app in their browser, point their webcam at whatever they want to monitor, and the backend runs InsightFace to detect and match faces in real time against a banned or allowed list. It's built as a multi-user SaaS — each visitor gets their own isolated session, their own watchlist, and their own detection history. The admin panel gives a single operator visibility into the entire system: threat level, evidence snapshots, watchlist management, detection logs, and system config.

---

## The Journey

### Why it was built

I wanted a real AI project that wasn't a chatbot. Face recognition is something people associate with expensive enterprise software or spy movies — I wanted to build a working version from scratch, deploy it publicly, and have something I could genuinely demo. It also let me go deep on a computer vision library (InsightFace), which is a different muscle than LLMs.

### What was built

**Backend (FastAPI):**
- `POST /api/detect` — accepts a JPEG frame from the browser, runs InsightFace, returns bounding boxes + match result + threat level
- `GET/POST /api/banned`, `/api/allowed` — CRUD for enrolled faces, session-scoped
- `POST /api/enroll/banned`, `/api/enroll/allowed` — enroll a face from an uploaded image
- `GET /api/stats` — system health: banned count, allowed count, threat, detection counts, threshold, model name, snapshot count
- `GET /api/logs` — paginated detection log, filterable by log type
- `POST /api/session/threshold` — public (no auth) per-session threshold adjustment
- `POST /api/mode` — per-session detection mode switch (BANNED_ONLY / KNOWN_ONLY / DUAL)
- Admin endpoints: login, logout, change-password, clear-logs, wipe-snapshots, export-snapshots (ZIP)
- `GET /snapshots/*` — static file serving for evidence snapshots
- `db.py` — full session-aware SQLite layer with migration support
- `matcher.py` — InsightFace wrapper + cosine similarity matching

**Frontend (React + Vite):**
- `LiveFeed.jsx` — browser camera feed via `getUserMedia()`, hidden capture canvas → 4fps JPEG POST → visible overlay canvas for bounding boxes with letterboxing compensation
- `Dashboard.jsx` — threat level display card, stats polling, mode bar with optimistic UI
- `Enroll.jsx` — enroll banned or allowed faces from a browser photo
- `Admin.jsx` — 5-tab admin panel:
  - **Overview**: threat level banner, 6 stat cards, recent activity feed, system info
  - **Watchlist**: card grid of all enrolled faces with remove + confirm
  - **Evidence**: snapshot browser with time-bucketed grouping, sort, multi-select export
  - **System**: detection mode picker, threshold slider, clear-by-log-type, wipe snapshots
  - **Account**: change password, logout
- First-login forced password change flow (`is_default_password` flag from backend)
- In-memory admin token (clears on refresh) + 60-second idle re-auth via heartbeat interval

### How long it took

Multiple sessions across May 2026. The original version took maybe 2-3 sessions to get to a working local state. Then a major architectural pivot (server camera → browser camera) took another 2 sessions. Deployment bugs and admin panel rebuild took 2 more sessions. Total: roughly 6-8 sessions of active work over two weeks.

### Deployment

- **Backend:** Render free tier Web Service. Python runtime. Build: `pip install -r backend/requirements.txt`. Start: `uvicorn backend.api:app --host 0.0.0.0 --port $PORT`. Service URL came out as `gatekeep-oiam.onrender.com` — Render appends a random suffix even when you name the service `gatekeep-api`, which caught me off guard and broke CORS until I found the real URL.
- **Frontend:** Vercel. `VITE_API_URL` baked into the build pointing to the Render URL. Custom domain `gatekeep.dominioneze.dev` aliased in Vercel. Vercel's GitHub auto-deploy was not properly linked, so deploys had to be triggered manually with `npx vercel --prod`.
- **DNS:** `gatekeep` A record → `76.76.21.21` (Vercel) in Namecheap.
- **No persistent disk** (Render free tier doesn't support it at $0). Data is ephemeral — lost on each redeploy. Acceptable for a demo; not acceptable for production.

---

## What I Learned About Browser-Based Computer Vision

The original GateKeep ran a camera on the server — OpenCV capturing frames from a webcam attached to whatever machine was running the backend. This is fine locally. On Render, there's no physical camera, and even if there were, `opencv-python` (the full package) fails on headless servers because it tries to link against GUI libraries that don't exist. I had to switch to `opencv-python-headless` and rethink the entire camera model.

The realization: **the camera should live in the browser.** The user already has a camera. `getUserMedia()` gives you a `MediaStream`. You draw it to a hidden canvas, pull a JPEG with `canvas.toBlob()`, POST it to the backend, and InsightFace processes it server-side. The browser handles capture, the server handles inference. This is actually the right architecture for a web app — it scales (N users each bring their own camera), it doesn't require server hardware, and it works on Render's free tier.

---

## Architectural Decisions

**Browser camera over server camera**
The original design had the camera on the server. Switched entirely when I realized Render has no camera and `opencv-python` won't build without GUI deps. The browser architecture is actually better for a web product — each user brings their own camera, nothing is shared, nothing blocks.

**buffalo_sc over buffalo_l**
InsightFace has two main models: `buffalo_l` (ResNet, ~400MB RAM, higher accuracy) and `buffalo_sc` (MobileNet, ~100MB RAM, lower accuracy). Render's free tier gives 512MB total RAM. `buffalo_l` would OOM the process on startup. `buffalo_sc` fits comfortably. Accuracy is good enough for demo and portfolio purposes.

**SQLite over PostgreSQL**
This is a portfolio project with ephemeral per-session data. SQLite runs in-process, requires zero infrastructure, and is perfectly fast for the load profile here (one session at a time, hundreds of rows max). Postgres would be the right call if multiple users needed to share data or if data needed to survive restarts.

**Session-scoped isolation over user accounts**
Instead of building auth (signup, login, password reset, JWT), each visitor gets a UUID in their localStorage. All data is scoped to that UUID. No accounts, no passwords, no emails. Keeps the demo clean — anyone can try GateKeep without creating anything. The tradeoff is that refreshing in a different browser means starting fresh, which is fine for a demo.

**In-memory admin token over sessionStorage**
The first implementation stored the admin token in `sessionStorage`. That persists through page refreshes, which means an admin who walked away from a logged-in session would still be in on reload. Moved the token to a module-level JS variable (`let _adminToken = null`). Refresh clears it automatically since the module re-executes. Added a 60-second idle timeout on top — a `_lastAdminTouch` timestamp updated every 15 seconds while the Admin component is mounted. Navigate away for 60+ seconds, the timestamp freezes, and you're kicked out on return.

**No persistent disk**
Render's free tier requires a paid plan for persistent disks. At $0, all data — the SQLite DB, all snapshots — gets wiped on every deploy or cold start. Designed around this: `GATEKEEP_DATA_DIR` env var routes to `/data` if a disk is ever mounted, and the whole system works without it using a fallback path. For a portfolio demo this is acceptable; for production this is the first thing that would need to change.

---

## Dependencies & Third-Party Services

| Dependency | What it does | What breaks if it changes |
|---|---|---|
| InsightFace (buffalo_sc) | Face detection + embedding extraction | Entire detection pipeline — every feature depends on this |
| ONNX Runtime (CPU) | Runs the InsightFace models | InsightFace won't load at all |
| opencv-python-headless | Image decoding + preprocessing | Backend can't decode JPEG frames from the browser |
| FastAPI + Uvicorn | API server | All endpoints |
| SQLite (stdlib) | Persistence for faces, logs, config | All data storage |
| Render (free tier) | Backend hosting | Backend goes offline |
| Vercel | Frontend hosting + CDN | Frontend goes offline |
| getUserMedia() browser API | Browser camera access | LiveFeed page breaks entirely — HTTPS required in production |

**Rate limits or costs discovered:**
- Render free tier: 512MB RAM, spins down after ~15 min inactivity (cold start adds ~30-60s on first request). No persistent disk. Zero cost.
- Vercel free tier: More than enough bandwidth and build minutes for a portfolio project. Zero cost.
- InsightFace: No API, runs locally. No rate limit. The cost is RAM and CPU on the host.
- At 100 concurrent users on Render free tier: OOM crash. The free tier is single-instance, ~512MB. Even buffalo_sc (~100MB) leaves little room for 100 simultaneous inference requests. Would need at least a Render Starter plan ($7/mo) and possibly load balancing for that scale.

---

## Performance & Optimization

- **Biggest bottleneck:** InsightFace inference on CPU. `buffalo_sc` with `det_size=(320, 320)` takes ~200-500ms per frame on Render's free tier CPU. This sets a hard cap on throughput.
- **What was done about it:** Capped browser frame submission at 4fps. Added per-session cooldown dicts in the backend to prevent a single session from flooding the inference queue. Any alert (banned face detected) has a configurable cooldown before the next snapshot is taken.
- **What would need to change at 10x load:** A GPU-enabled host (Render GPU plans, or HuggingFace Spaces with A10). A job queue (Celery + Redis) so inference requests don't block the FastAPI event loop. The current synchronous `fa.get(frame)` call blocks the entire process.

---

## Testing Approach

- Manual tests run: Enrolled my own face as banned, opened the live feed, pointed the camera at myself, confirmed threat level escalated and a snapshot was saved. Enrolled myself as allowed and confirmed KNOWN_ENTRY logs appeared. Tested both BANNED_ONLY and DUAL modes.
- Bugs only caught by running it: The bbox overlay was misaligned — boxes appeared in the wrong position because `objectFit: contain` on the `<video>` element creates letterboxing that my canvas draw code wasn't accounting for. Caught it the moment I saw my face with boxes floating 50px off.
- What a proper test suite would cover: `matcher.py` cosine similarity edge cases (empty embeddings, all-zero vectors), `db.py` session isolation (session A can't read session B's data), the `detect` endpoint with a valid JPEG vs a corrupt one, threshold boundary conditions.
- What I'd test first if something broke in production: `GET /api/health` first, then `GET /api/stats` — if stats loads, the DB is up and InsightFace initialized. If stats is slow, the model is still loading. If `/api/detect` times out, it's inference.

---

## AI Collaboration — One Instance Where It Worked Well

The canvas overlay math for bounding boxes. When `objectFit: contain` is applied to the `<video>` element, the video scales down to fit the container while preserving aspect ratio — which means there's dead space (letterboxing) on the sides or top/bottom. The bbox coordinates coming from InsightFace are pixel coordinates in the original frame. Drawing them directly onto an overlay canvas that's sized to the container gave wrong positions.

The fix required computing the scale factor and offsets:
```js
const scale = Math.min(cW / vW, cH / vH)
const renderW = vW * scale
const renderH = vH * scale
const offX = (cW - renderW) / 2
const offY = (cH - renderH) / 2
// then: x = offX + face.bbox_pct.x * renderW
```

Working through this math and getting the boxes pixel-perfect on the first try — even when the browser window was resized (hooked into a ResizeObserver) — was the moment where having AI as a pair programmer felt genuinely useful. It's tedious geometry that's easy to get wrong.

---

## AI Collaboration — One Instance Where It Fell Short or Surprised Me

The first attempt at the admin panel treated `camera_active` as a live field in the stats response and had `startCam()`/`stopCam()` buttons wired up to `api.startCamera()` and `api.stopCamera()`. Those API functions were deleted when the architecture pivoted to browser cameras, but the admin panel wasn't updated at the same time. The code looked correct — it referenced real-looking function names, had proper loading states — but it was entirely dead. Nothing happened when you clicked the buttons. The lesson: when you do a major architectural refactor, you need to audit every consumer of the deleted code, not just the immediate callers.

---

## What Surprised Me About Building and Testing This

HTTPS. `getUserMedia()` — the browser API for camera access — only works on `localhost` or over HTTPS. The moment the frontend moved to a real domain, the camera silently failed to initialize with a permissions error in the console. Vercel serves over HTTPS by default, so this resolved itself, but it's the kind of thing that could cost you an hour if you're testing on a non-secure server and wondering why the camera won't start.

Also surprised by how hard Render's URL was to find before deploying. I assumed the service URL would be `gatekeep-api.onrender.com` based on the service name I gave it. Render appends a random suffix (`gatekeep-oiam.onrender.com`). The CORS allowlist in the backend was pointing at the wrong URL, so every request from the deployed frontend got a CORS rejection until I found the real URL from the deployment screenshot.

---

## The Moment It Clicked

When the first end-to-end detection worked in the browser — face appears in the video, bounding box draws correctly on the overlay canvas, threat level changes in the dashboard, snapshot saves to disk, detection log updates — all without me touching anything server-side, just from a browser tab on my laptop talking to a server on Render. That's when the architecture felt real. It wasn't running on my machine anymore. It was a system.

---

## Could This System Be Misused? How Would You Prevent It?

Yes, fairly easily in its current form:

- **Mass enrollment attack:** Anyone can POST to `/api/enroll/banned` or `/api/enroll/allowed` for their session, but sessions are isolated so they can only mess with their own data. Not a systemic risk.
- **Detection spam:** Submitting thousands of frames per second to `/api/detect` would saturate the backend CPU. The per-session cooldown dict limits alert frequency but not raw inference requests. A proper fix is a per-IP or per-session request rate limiter (e.g., slowapi).
- **Privacy:** Any visitor who points their camera at someone else's face and enrolls them is building a surveillance profile. For a portfolio demo this is acceptable risk. In production: require authentication before enrollment, add consent flows, store no biometric data longer than the session, add a data deletion endpoint.
- **Admin session:** Admin token is now in-memory with a 60-second idle timeout. If the tab is compromised while the admin is logged in, the attacker has up to 60 seconds. For production: add CSRF protection, bind sessions to IP, use short-lived JWTs.
- **Snapshot storage:** On Render free tier, snapshots are ephemeral. On a persistent disk, they'd accumulate indefinitely. Production needs a retention policy and the wipe-snapshots admin action is the manual version of that.

---

## What Would I Do Differently If I Rebuilt This From Scratch?

- **Start with the browser camera architecture.** I built server-camera first and had to throw it out. The right mental model from day one is: browser captures, server infers.
- **Use a job queue from the start.** Synchronous inference in a FastAPI endpoint is fine at zero scale. At real scale it blocks. Celery + Redis or a simple asyncio queue would be the foundation.
- **Plan the admin panel before writing it.** The first admin panel had dead camera start/stop buttons because the architecture changed and the admin panel wasn't in scope during the refactor. A 15-minute design pass before writing a single component would have caught that.
- **Use PostgreSQL with a managed host.** SQLite on an ephemeral Render disk means all data disappears on deploy. For anything real, Supabase or Neon (Postgres, free tier) would give persistent storage without a persistent disk.
- **Set up Vercel's GitHub integration properly from the start.** Every frontend deploy required `npx vercel --prod` manually because the GitHub auto-deploy wasn't wired. That's a 5-minute setup that saves every future push.

---

## What I'd Tell My Past Self Before Starting

The model needs to fit in RAM before any feature is worth writing. Figure out your hosting constraints (RAM, no GPU, no camera, no persistent disk) before you pick your ML model, not after you've built everything around the wrong one.

---

## What's the One Thing This Project Taught Me That a Tutorial Never Would?

Every tutorial on InsightFace shows it running on your machine with plenty of RAM and a GPU. None of them show you what happens when you try to deploy it to a $0 server. The real education was figuring out the difference between buffalo_l and buffalo_sc — not from documentation, but from an OOM crash on Render — and then redesigning the architecture around that constraint. Constraints are where real engineering happens. A tutorial gives you a working demo. Production gives you a constraint, and you have to figure out what to cut.

---

## What Does v2 Look Like?

- **Persistent storage:** Supabase or Neon Postgres. Data survives restarts. Users can enroll faces and come back later.
- **Real auth:** Google OAuth. Sessions tied to real users, not anonymous UUIDs. Admin panel becomes role-based.
- **Multiple camera zones:** Dashboard can show feeds from multiple browser tabs simultaneously, each labeled as a different "zone" (front door, back entrance, etc.).
- **GPU inference:** HuggingFace Spaces with a GPU or Render GPU plan. buffalo_l at full accuracy. Sub-100ms inference instead of 200-500ms.
- **Async inference queue:** Celery + Redis. Frame submissions go into a queue, results pushed back via WebSocket. No more blocking the API process.
- **Retention policies:** Auto-delete snapshots older than 30 days. Admin-configurable.
- **Real alerting:** Email or SMS notification when a banned face is detected. Twilio or SendGrid, a checkbox in the admin panel.
- **Deployment on dominioneze.dev infrastructure:** Currently a standalone project. v2 would integrate with the portfolio's monitoring and uptime infrastructure.

---

## As a System Architect

**Data flow end-to-end:**
Browser camera → `canvas.toBlob()` JPEG → `POST /api/detect` FormData → OpenCV decode → InsightFace `fa.get(frame)` → cosine similarity against session's banned/allowed embeddings → log to SQLite → save snapshot if alert → return `{faces, threat, mode}` JSON → frontend draws bboxes on overlay canvas + updates threat level card.

**Layers:**
- **Browser:** Camera capture, JPEG encoding, bbox rendering, session ID management, admin token lifecycle
- **FastAPI:** Request routing, auth middleware, per-session rate limiting, inference orchestration
- **InsightFace / matcher.py:** Face detection + embedding extraction + cosine similarity matching
- **db.py:** All SQLite reads/writes, session-scoping, config management
- **Render filesystem:** Snapshot storage (ephemeral on free tier)

**Deployment pipeline:**
`git push` → manual `npx vercel --prod` (frontend) + Render auto-deploys on push (backend) → Vercel builds Vite bundle with `VITE_API_URL` baked in → serves at `gatekeep.dominioneze.dev`.

**Highest-impact design decision:** Session isolation via UUID. This single decision made multi-user work without any auth system. It also made the admin panel meaningful — the admin sees a full picture while each visitor only sees their own data.

**Single points of failure:**
- InsightFace loading on startup — if the model fails to download or load, every detect request 500s
- Render service cold start (~30-60s) — first request after idle period has a long delay
- SQLite file — on free tier, any deploy wipes it

**What breaks first under real traffic:**
The synchronous InsightFace inference call in `/api/detect`. FastAPI is async but `fa.get(frame)` is blocking synchronous code. Under concurrent requests, Python's GIL means inference requests queue behind each other. Two simultaneous users means one waits.

---

## As an AI Engineer

**Where AI was used deliberately:** Face embedding extraction (InsightFace) and cosine similarity matching in `matcher.py`. Every detection decision flows through these. No rule-based fallback exists — if InsightFace doesn't detect a face, nothing happens.

**What's load-bearing:** `fa.get(frame)` in `matcher.py`. This is the entire AI layer. It returns bounding boxes + 512-dimensional normalized embeddings. Everything else is math on top of those embeddings.

**Where AI output needed validation:** The `det_score` field on each detected face — InsightFace's confidence that it actually found a face. Frames with low-confidence detections (blurry, partially visible, bad angle) can produce poor embeddings that give false matches. A `det_score` threshold (currently implicit) should be explicit in production.

**What would break if the model was swapped:** Everything. The embedding dimension (512 for buffalo_sc) is hardcoded implicitly — if a new model produced 256-dimensional embeddings, the cosine similarity would still compute but against embeddings stored at different dimensions. Would need a migration of all stored embeddings.

**When NOT to use AI:** The cooldown logic, threat level calculation, session management, and admin auth are all rule-based. These were intentional choices. AI adds latency, cost, and non-determinism. "Is this the same face?" is an AI question. "Has this face been seen in the last 30 seconds?" is not.

---

## Portfolio Signal — What This Project Demonstrates

- **Skills demonstrated:** Full-stack architecture with a real ML inference pipeline, browser camera integration, multi-user session isolation, admin panel with auth and idle timeout, deployment on Render + Vercel, custom domain
- **Problem-solving shown:** Designed around Render free tier constraints (no camera, no GPU, 512MB RAM, no persistent disk) rather than around ideal conditions. Pivoted the entire camera architecture mid-project when the original approach was incompatible with the hosting environment.
- **What I'd say in an interview:** "I built a facial recognition security system that runs in the browser. The interesting part is the architecture — I started with the camera on the server, realized that doesn't work on a free cloud host, and redesigned it so each visitor's browser handles capture while the server handles inference. That meant rethinking session management, multi-user data isolation, and how frames get from the browser to InsightFace in under a second."
- **The one thing that makes this stand out:** It's deployed and it actually works. You can go to `gatekeep.dominioneze.dev`, open your camera, enroll a face, and watch the threat level change when that face appears. That's a real computer vision pipeline running in production, not a notebook demo.

---

## Wins

- Got InsightFace running on Render free tier (512MB RAM) by switching to buffalo_sc and correctly sizing the input at `det_size=(320, 320)`
- Browser camera architecture works cleanly — getUserMedia → hidden canvas → JPEG → POST → inference → bbox overlay, all in one smooth loop at 4fps
- Canvas letterboxing math is correct — bounding boxes track faces accurately even when the browser window is resized (ResizeObserver handles redraws)
- Admin panel is genuinely useful — the first-login flow, 5-tab layout, watchlist management, and evidence browser are all production-quality, not placeholder
- In-memory admin token + idle timeout is a clean security design — no storage, no cleanup needed, refresh = logout automatically
- Session isolation without user accounts — every visitor gets a real private workspace with zero friction

## Hiccups

- Server-side camera: entire architecture thrown out when Render had no camera hardware and `opencv-python` wouldn't install without GUI deps → switched to `opencv-python-headless` and browser-camera model
- buffalo_l OOM on Render free tier → downgraded to buffalo_sc mid-build
- Render URL mismatch: assumed `gatekeep-api.onrender.com`, actual was `gatekeep-oiam.onrender.com` (random suffix) → CORS failures on every request until real URL was found from the deployment screenshot
- Wrong build/start commands on Render: auto-detected root `requirements.txt` and left start command blank → 404 on all API calls → set manually to `pip install -r backend/requirements.txt` and `uvicorn backend.api:app --host 0.0.0.0 --port $PORT`
- ADMIN_PASSWORD env var: set during Render's deploy wizard with an unknown value, hashed and stored in DB, didn't match "admin" → login always failed → deleted env var, triggered fresh deploy, DB reset to default hash
- Threshold slider silent failure: used `adminPost` (requires admin token) for a public endpoint → visitors' threshold changes did nothing → added `POST /api/session/threshold` public endpoint
- Vercel GitHub auto-deploy not linked → every deploy required `npx vercel --prod` manually

## Honest Score

**If I'm being real:** The system works and the code is clean. The architecture is sound for what it is — a portfolio demo. The weak spots are the ones you'd expect on a free-tier project: ephemeral data means everything disappears on redeploy, buffalo_sc accuracy is noticeably worse than buffalo_l on partially visible or profile faces, and one simultaneous user can block another's detection request. The admin panel is genuinely the strongest part — it's more polished than most portfolio projects get. What I'd fix before showing this to a senior engineer: add request rate limiting on `/api/detect`, make the model load failure graceful instead of crashing silently, and add at least one integration test that runs `curl` against the live endpoint. Right now it's "works on my machine and in the demo" quality. Not production quality, but honest about that.
