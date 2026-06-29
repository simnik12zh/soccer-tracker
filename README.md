# Soccer Tracker

Mobile-first, full-season training tracker for a soccer player. React + Vite single-file
frontend (`src/App.jsx`), one Vercel serverless function for the AI coach. All data lives in
`localStorage` (key `soccer-v1`) — no backend database. Installable as a PWA.

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
  Month / Journey / Trainer), a full-screen Coach chat, and a setup/settings screen. Pink/red
  palette in the `C` token object. The season plan is generated from hard-coded `PHASES` +
  per-phase weekly `TEMPLATES` (with Ibiza and Tuscany holiday overrides) by
  `buildDefaultPlan()`, spanning 2026-06-29 → 2027-08-05.
- **Decision Trainer** (`TrainerView`) — a tactical decision trainer for the right back / centre
  back. Claude generates a game situation rendered on an SVG pitch (`Pitch`), the player types
  their pre-scan and decision, and Claude assesses both. State machine:
  `idle → gen → scan → decide → assessing → done`. Rep count persists under
  `soccer-trainer-count`.
- **`api/coach.js`** — Vercel Node serverless function. Streams Claude (`claude-sonnet-4-6`)
  replies as `text/plain`. The soccer-specific system prompt plus a per-request context block
  (current phase, today's session, last 14 days of logs, this week's sessions, tactical focus)
  is built server-side. `ANTHROPIC_API_KEY` is read **server-side only** — never prefix it with
  `VITE_` or it leaks into the client bundle.
- **`api/generate-situation.js`** — returns a single JSON situation object for the trainer
  (not streamed). Defensively parses the model output (raw → de-fenced → first `{…}` block),
  returning HTTP 502 on failure so the client shows a clean retry message.
- **`api/assess-decision.js`** — streams the trainer assessment as `text/plain`, same pattern as
  the coach. Both trainer endpoints use `claude-sonnet-4-6` and read the key server-side only.
- **Storage** — one JSON blob under `soccer-v1`: `{ playerName, plan }`, where `plan` maps
  `YYYY-MM-DD → { sessions, completed, notes, feeling }`. A day holds one or two session
  types in `sessions` (e.g. `['Gym','Mobility']`); legacy entries with a single `workout`
  string are still read transparently via `getSessions`. Sessions are done or not done — no
  distance/duration tracking. Gym and Mobility each carry a 2×/week target (`PHASE_TARGETS`),
  surfaced in the Today view's weekly-targets card. Per-day coach chats live under
  `coach-YYYY-MM-DD`; the trainer rep count under `soccer-trainer-count`; one-time milestone
  flags under `milestone-<id>`.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (auto-detects Vite, no config needed).
2. Add the `ANTHROPIC_API_KEY` environment variable in the Vercel project settings.
3. Every push to the default branch auto-deploys.
