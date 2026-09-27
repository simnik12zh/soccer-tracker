# Soccer Tracker

Mobile-first, full-season training tracker for a soccer player. React + Vite single-file
frontend (`src/App.jsx`), one Vercel serverless function for the AI coach. All data lives in
`localStorage` (key `soccer-v3`) — no backend database. Installable as a PWA.
The app currently has no service worker; offline app loading is not guaranteed.

## Commands

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173 — UI only
npm run build    # production build → dist/
npm run preview  # preview the production build
TZ=Europe/Zurich node --test tests/redesign.test.mjs # storage/model/date regression checks
npx vercel dev   # serves the UI AND /api/coach (needs ANTHROPIC_API_KEY in .env)
```

`npm run dev` cannot run `/api/coach` (Vite does not execute serverless functions). Use
`npx vercel dev` with `ANTHROPIC_API_KEY` in `.env` to exercise the coach locally.

## Architecture

- **`src/App.jsx`** — entire UI in one file by design. Four bottom-tab views (Heute / Woche /
  Monat / Entwicklung), a full-screen Coach chat, and a setup/settings screen. Midnight & Ice
  dark palette in `C`; shared responsive styles in `UI_CSS`, inline SVG icons, reduced-motion
  support and a keyboard-accessible session sheet. No extra UI dependencies.
  The season plan is generated from hard-coded `PHASES` +
  per-phase weekly `TEMPLATES` (with Ibiza and Tuscany holiday overrides) by
  `buildDefaultPlan()`, spanning 2026-06-29 → 2027-08-05.
- **Fixtures** — `MATCH_SCHEDULE` contains the seven FC Julius Bär games from the user's
  27 September 2026 screenshot, including opponent, home/away, kickoff, match ID and
  `Europe/Zurich` timezone. Kickoffs are local clock strings so the October DST change
  does not shift them. There is no automatic online fixture sync.
  Games replace open training on their dates. A one-time import into the existing v3
  blob removes unlogged generic Saturday match placeholders from 27 September onwards;
  past entries, completed days, notes, body values and explicitly detailed matches remain.
  Overwritten entries are retained in `matchScheduleBackup.previousEntries` (included
  in exports), and `matchScheduleVersion` prevents repeated imports. Restoring a pre-import
  backup runs the same migration. Dated games cannot be moved by the training-day swap.
  Gold match markers distinguish games in Today, Week and Month; the month also lists
  all known fixtures with their details. Unknown spring games are not invented.
- **Reviewed end-of-year plan** — `COACHED_WEEKS` / `COACHED_SESSIONS` define a dated
  coaching overlay for 27 September–31 December 2026, not a permanent template change.
  Every full week from 28 September has two Gym days and at least two gentle Mobility
  slots. The already-started week is not retroactively filled. Thursday team sessions
  continue through the last known game (12 November, replacing training); there are no
  team sessions after that assumed club shutdown. Games and completed logs take priority.
  Day-after-match plans are walks, not futsal or heavy strength. Double-game weeks use
  light upper-body/core Gym visits; pre-game Thursday training explicitly asks for a
  reduced session agreed with the team coach. These are targets, not instructions to
  train through fatigue or pain. 16–22 November and 14–20 December are lower-volume
  weeks. Winter normally uses Monday/Thursday strength, selected Tuesday futsal and
  easy Saturday aerobic work. The final two weeks use Monday/Wednesday strength.
  `coaching: {sessions, title, text}` is separate from personal notes, visible in Today
  and Week, and included in coach context. Editing/swapping sessions clears dated advice.
  A one-time `coachedPlanVersion` migration follows the fixture import, retains overwritten
  entries in `coachedPlanBackup.previousEntries`, and preserves completed days, illness,
  extra matches, personal notes, measurements and unknown fields. Late installation only
  changes dates from the actual load date onward. January and later remain unchanged.
  Exports include both migration archives; the storage key stays `soccer-v3`.
  Planning rationale (not a claim of individualized medical validation):
  [post-match recovery review](https://pubmed.ncbi.nlm.nih.gov/29098658/) and
  [low-load upper-body work around matches](https://pubmed.ncbi.nlm.nih.gov/33440333/).
- **Retired features** — Hip/Legs check-ins, Mediale Kette and the Routine tab are removed.
  Existing check-ins and top-level rehab fields remain untouched in stored data and backups,
  but are no longer shown or sent to the coach. Exercise image source files are retained.
- **`api/coach.js`** — Vercel Node serverless function. Streams Claude (`claude-sonnet-4-6`)
  replies as `text/plain`. The soccer-specific system prompt plus a per-request context block
  (current phase, today's session, last 14 days of logs, this week's sessions, tactical focus)
  is built server-side. `ANTHROPIC_API_KEY` is read **server-side only** — never prefix it with
  `VITE_` or it leaks into the client bundle.
- **Storage** — one JSON blob under `soccer-v3`: `{ playerName, plan, ...archivedFields }`, where `plan` maps
  `YYYY-MM-DD → { sessions, completed, notes, feeling, weight?, bodyFat? }`. Existing `soccer-v2`
  data migrates when v3 is absent. The redesign does not change the storage key or reset data.
  A day holds one or two session
  types in `sessions` (e.g. `['Gym','Mobility']`); legacy entries with a single `workout`
  string are still read transparently via `getSessions`. Sessions are done or not done — no
  distance/duration tracking. Session editing only saves the plan; the FERTIG circle logs it.
  Swaps move session lists and clear dated coaching guidance, retaining each day's notes,
  completion and body values. Confirmed games cannot be swapped.
  Gym and Mobility targets are both 2×/week in every active phase (`PHASE_TARGETS`).
  Holidays and the summer break stay exempt. Only the explicitly reviewed date range
  above is rescheduled; target changes alone never regenerate a stored calendar.
  Display labels and built-in copy are German. Internal IDs remain unchanged (e.g. `Gym`
  → Krafttraining, `Futsal` → Freizeitkick/Futsal, `Mobility` → Prävention/Reha).
  Session-specific card summaries cover both planned and completed days and two-session
  combinations. New coach replies are instructed to be German; existing notes and chats
  are preserved verbatim. The Soccer Tracker brand name is unchanged.
  Per-day coach chats live under
  `coach-YYYY-MM-DD`; one-time milestone flags under `milestone-<id>`.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (auto-detects Vite, no config needed).
2. Add the `ANTHROPIC_API_KEY` environment variable in the Vercel project settings.
3. Every push to the default branch auto-deploys.
