# Soccer Tracker

Mobile-first, full-season training tracker for a soccer player. React + Vite single-file
frontend (`src/App.jsx`), one Vercel serverless function for the AI coach. All data lives in
`localStorage` (key `soccer-v2`) — no backend database. Installable as a PWA.

## Commands

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173 — UI only
npm run build    # production build → dist/
npm run preview  # preview the production build
npx vercel dev   # serves the UI AND /api/coach (needs ANTHROPIC_API_KEY in .env)
```

`npm run dev` cannot run `/api/coach` (Vite does not execute serverless functions). Use
`npx vercel dev` with `ANTHROPIC_API_KEY` in `.env` to exercise the coach locally.

## Architecture

- **`src/App.jsx`** — entire UI in one file by design. Five bottom-tab views (Today / Week /
  Month / Journey / Routine), a full-screen Coach chat, and a setup/settings screen. Pink/red
  palette in the `C` token object. The season plan is generated from hard-coded `PHASES` +
  per-phase weekly `TEMPLATES` (with Ibiza and Tuscany holiday overrides) by
  `buildDefaultPlan()`, spanning 2026-06-29 → 2027-08-05.
- **Guided Session** (`GuidedView`) — a click-through exercise program (`PROGRAMS` data:
  name/sets/reps/optional cue+tag per exercise). State machine: start screen → one exercise
  per step with progress → done screen. No images, phases, or tracking yet — deliberately
  minimal so it's easy to extend.
- **`api/coach.js`** — Vercel Node serverless function. Streams Claude (`claude-sonnet-4-6`)
  replies as `text/plain`. The soccer-specific system prompt plus a per-request context block
  (current phase, today's session, last 14 days of logs, this week's sessions, tactical focus)
  is built server-side. `ANTHROPIC_API_KEY` is read **server-side only** — never prefix it with
  `VITE_` or it leaks into the client bundle.
- **Storage** — one JSON blob under `soccer-v2`: `{ playerName, plan }`, where `plan` maps
  `YYYY-MM-DD → { sessions, completed, notes, feeling }`. A day holds one or two session
  types in `sessions` (e.g. `['Gym','Mobility']`); legacy entries with a single `workout`
  string are still read transparently via `getSessions`. Sessions are done or not done — no
  distance/duration tracking. Gym and Mobility each carry a 2×/week target (`PHASE_TARGETS`),
  surfaced in the Today view's weekly-targets card. Per-day coach chats live under
  `coach-YYYY-MM-DD`; one-time milestone flags under `milestone-<id>`.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (auto-detects Vite, no config needed).
2. Add the `ANTHROPIC_API_KEY` environment variable in the Vercel project settings.
3. Every push to the default branch auto-deploys.
