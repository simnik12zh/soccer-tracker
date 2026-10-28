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
TZ=Europe/Zurich node --test tests/*.test.mjs # storage/model/coach regression checks
npx vercel dev   # serves the UI AND /api/coach (needs ANTHROPIC_API_KEY in .env)
```

`npm run dev` cannot run `/api/coach` (Vite does not execute serverless functions). Use
`npx vercel dev` with `ANTHROPIC_API_KEY` in `.env` to exercise the coach locally.

## Architecture

- **`src/App.jsx`** — entire UI in one file by design. Four bottom-tab views (Heute / Plan /
  Körper / Saison), a full-screen Coach chat (header button "Trainer") and a settings screen
  (gear icon in the header, also linked at the end of Saison). Midnight & Ice dark palette:
  CSS tokens on `:root` in `UI_CSS` (`--bg`, `--surface`, `--panel`, `--line*`, `--text`,
  `--muted`, `--faint`, `--accent*`, `--good`, `--warn`, `--bad`, `--gold*`; radii `--r-s` 12,
  `--r-m` 14, `--r-l` 22, `--r-pill`), legacy inline styles still use `C`. Text is at least
  11 px (labels), explanations 12 px. Inline SVG icons only (games use the pitch icon, no
  emoji), reduced-motion support and a keyboard-accessible session sheet. Sections on Plan,
  Körper and Saison use one heading pattern (`.section-heading` above the card); cards on
  Heute carry their own small eyebrow. No extra UI dependencies.
  The season plan is generated from hard-coded `PHASES` +
  per-phase weekly `TEMPLATES` (with Ibiza and Tuscany holiday overrides) by
  `buildDefaultPlan()`, spanning 2026-06-29 → 2027-08-05.
- **Heute** — compact day strip (‹ › jump a week, swipe moves a day). The ring card starts
  with one status area (recovery line plus active complaints) and then three rings for the
  selected day (Training, Protein vs. target, Wochenziele Kraft + Reha) with a sentence naming
  what is still open (`dayChecklist`; past days say "nicht eingetragen", never "skipped"). The
  session card keeps FERTIG next to the title so it stays above the tab bar on a phone; long
  plan guidance is clamped to two lines, and its title drops a repeated session name
  (`guidanceTitle`). The load card is one line (value, short status, advice) and expands to the
  bar and explanation. The nutrition card: total with a pencil to correct it, photo button plus a
  library button, one "Schnell eintragen" row (favourites, then +20/+30/+40 g protein), meals,
  rating. Below: "Als Nächstes" (next two planned days plus the next game within seven days,
  `upcomingDays`). Choosing "Krank/verletzt" in the session sheet offers to report where it hurts.
- **Nutrition (level A)** — per day, optional `protein` (grams via +20/+30/+40 quick-add,
  correctable, undo for the last add) and `nutrition` (`green` Im Plan / `amber` Gemischt /
  `red` Daneben: viel Süsses, Essen aus Lust statt Hunger, Fast Food). Not logged is never zero
  or red. Future days cannot be logged. Daily protein target defaults to 100 g
  (`DEFAULT_PROTEIN_TARGET`); a changed target is stored top-level as `proteinTarget`.
- **Meal photos** — "Mahlzeit fotografieren" opens the camera (or "oder aus Fotos wählen"); the
  phone downscales to 1280 px JPEG and `POST /api/meal` (access code required) asks Claude Opus 5.5
  (`claude-opus-5-5`, effort medium, structured output via `output_config.format`, server-side
  `fallbacks: "default"`) for components with grams, kcal and protein plus a kcal range and a
  confidence. The server clamps implausible values and recomputes totals from the components.
  The estimate is saved immediately as `meals[]` on the day; opening a meal to correct kcal/protein
  or delete it is optional. Photos are never stored. Day protein = quick-add `protein` + meal
  protein (the pencil corrects the day total; the quick-add part absorbs the difference); day kcal
  comes from photographed meals only. Coach context gets per-day kcal and meals plus 7-day
  averages, with the instruction that photo kcal are rough and cover only photographed meals.
  Day updates build on the latest plan (`planRef`) so results arriving after an await never drop
  newer edits.
- **Meal favourites** — open a meal → "Als Favorit merken" (name, kcal and protein as shown in
  the fields; the name is editable). Favourites appear as a scrollable chip row under the photo
  button, most used first; one tap adds a copy to the viewed day (`source: 'favorite'`,
  `favoriteId`, no photo, no model call) with an inline "Rückgängig". "Verwalten" removes
  favourites (meals already logged stay) or adds one by hand (e.g. a shake). Same name = update,
  max. 12 (the least used one goes). Stored top-level as `mealFavorites` in the `soccer-v3` blob
  (no key bump). Favourite meals count for protein and kcal like photo meals; the coach context
  marks them `fromFavorite`.
- **Plan** — Woche/Monat toggle. The week view marks today, has one edit button per day (swap
  lives in the session sheet: "Mit einem anderen Tag tauschen"), then Plan-Vorschlag,
  Wochenziele, Belastung (six weekly bars with the normal range as one band) and Taktik.
- **Körper** — body-fat 7-day mean as hero with delta vs. the previous 7 days and a 13–14 %
  goal bar; weight, fat mass and lean mass tiles (mass needs weight and body fat in the same
  window, `bodySnapshot`); trend chart (Körperfett/Gewicht, 4 Wochen / 3 Monate / Saison);
  dated measurement editor (any date up to today, empty field removes a value); the last five
  measurements; a seven-day nutrition overview (traffic lights, protein hits, average); steps;
  sleep & recovery with labelled rows (Schlaf, HRV, Puls). Manual entry is a text link, since
  the scale delivers automatically.
- **Saison** ("Deine Saison.") — season progress, weekly reports, phase timeline (earlier phases folded behind
  "Frühere Phasen anzeigen", no "0 / 0" counts) and the settings entry (profile, connections,
  reminders, backup export/restore). The weekly report shows its numbers as tiles per topic
  (`factGroups`).
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
- **Garmin import** — the server pulls the Garmin Connect Personal API (read-only, own
  account) via `GET /api/garmin?from&to` (max 28 days): activity summaries
  (`/activitylist-service/activities/search/activities`) and daily steps
  (`/usersummary-service/stats/steps/daily/{from}/{to}`). For football the summary also yields
  distance, top speed (GPS; values above 40 km/h are dropped as glitches), Garmin training load
  and minutes in heart-rate zones 4–5 — shown under the football entry on the session card and
  sent to the coach. Garmin's API has no sprint count. Already imported activities get updated
  numbers on later syncs without changing the day's status. The personal key
  (`GARMIN_PERSONAL_API_KEY`, from Garmin Connect, expires after the period chosen there) is
  exchanged for a bearer JWT that is cached in Redis; parallel calls share one exchange and a
  rejected token is renewed once. Only id, local date/time, type key, name, minutes, calories
  and average heart rate are returned; nothing is stored server-side. The app syncs on open and
  when it returns to the foreground (at most every 10 minutes, from two days before the last
  sync, first time 14 days). `applyGarminImport` applies each activity once by ID: a type that
  matches the day's plan (football → game, team training or futsal) marks the day done, an
  empty day is filled (unplanned football → Freizeitkick/Futsal), anything else is listed as
  "nicht im Plan". It never un-ticks a day, never changes feelings or notes, and a day the
  player un-ticked stays un-ticked. Per-day `steps` and `garmin` are optional fields
  (no key bump); `garminSync` is stored top-level. Today shows steps next to the date and
  recorded activities on the session card; Körper shows the last seven days of steps. The coach
  context includes `steps` and `watchActivities` for past days.
- **Withings import** — OAuth 2.0 (Public API, scope `user.metrics`). Settings → Verbindungen →
  "Mit Withings verbinden" calls `POST /api/withings {action:"connect"}` (access code required),
  which stores a one-time state (10 min, with the redirect URI) in Redis and returns the
  Withings consent URL. Withings redirects to `/api/withings-callback`, which exchanges the code
  once and keeps the tokens in Redis (`withings:tokens`); access tokens are refreshed shortly
  before expiry or after status 343, and the rotated refresh token is always saved. The callback
  answers a plain request with 200 (URL check). `GET /api/withings?from&to` (max 400 days,
  first sync 180 days, then from three days before the last sync, at most every 10 minutes)
  returns one reading per Zurich day and a hashed account id. The app syncs incrementally only
  after a full 180-day load succeeded for the same account (`withingsWindow`, stored as
  `withingsSync.fullFor`); otherwise — first sync, account switch, or a failed reload — it loads
  the full window again and removes scale values Withings no longer returns. Settings show how
  many scale values are stored and since when. Each reading is the earliest weigh-in, with body fat from the same or
  another group that day (types 1 and 6, category 1, plausibility-checked). `applyWithingsImport`
  never overwrites values entered by hand (`bodySource: "manual"` or older values without a
  source); scale values are marked `bodySource: "withings"` and shown as such in Körper.
  Env: `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`, optional `WITHINGS_REDIRECT_URI`.
- **Sleep and recovery** — the Garmin sync also pulls sleep summaries (31-day max), HRV daily
  summaries and the v2 daily summaries (resting HR, Body Battery max); each is optional and a
  missing source never fails the sync. Per day (`recovery`): sleep minutes and score, overnight
  HRV with Garmin's personal balanced range and status, resting HR, Body Battery. `recoveryStatus`
  rates the day good / caution / low from sleep length, HRV against his own range, resting HR
  against his previous 14 days and Body Battery (two low signals = low; one low or two cautions
  = caution). Heute shows a compact strip (sleep plus anything that stands out); Körper shows
  seven nights with HRV and resting HR. The coach gets the values for past days and today's
  assessment, with instructions to adapt load and not over-read one night. Sync version 3 reloads
  28 days once so baselines exist.
- **Training load** — Garmin's own Acute Load / Training Status are not in the personal API, so
  the app rebuilds them from each activity's Garmin training load (`activityTrainingLoad`):
  acute = last 7 days; normal range = 0.8–1.3 × his average week over the last 4 weeks
  (`loadStatus`, needs 21 days of watch data). `typicalLoads` = his own median per session type
  over 60 days; `plannedLoad` adds today's planned, not yet done sessions; `loadAdvice` gives one
  sentence (low recovery always wins over spare load). Heute shows a load card for today (value,
  range bar with the planned part, advice); Plan → Woche shows six weekly totals with the range.
  The coach gets the whole block (`load`, whitelisted server-side). The Garmin endpoint now
  accepts up to 60 days: activities for the full window (paged by 99), steps/sleep/HRV/daily
  summaries for the last 28 days. Sync version 4 loads six weeks of activities once.
- **Weekly report** — on Monday 7–8 Uhr (Zurich) the cron sends a "weekly" push ("Dein
  Wochenreport ist da", crons `0 5 * * 1` and `0 6 * * 1`, deduplicated like the daily slots);
  tapping it opens `/?report=latest` (or messages an open app). `weeklyReportFacts` computes the
  last completed Monday–Sunday week in the app: training days, goals, games, watch minutes,
  football km and top speed, weekly load against the range, body-fat and weight 7-day means
  versus the week before, nutrition (protein hits, average, traffic lights, kcal on photo days),
  recovery (sleep, HRV, resting HR versus the previous week, caution/low days) and steps.
  The coach (`/api/coach`, `weeklyReport` whitelisted) writes Bilanz / Gut / Besser / Ausblick /
  Fokus around those numbers; Ausblick only for the latest week. Reports are stored under
  `coach-report-<weekStart>` (included in backups). Heute shows a banner on Monday and Tuesday
  until it is read; Saison lists the last six weeks.
- **Weekly plan proposal** — "Plan vorschlagen" under Plan → Woche (current and next week) and at
  the end of the latest weekly report. `planWeekInput` marks fixed days (games, team training,
  sick days, own custom sessions, finished or past days); `POST /api/plan` (access code required)
  asks Claude Opus 5.5 (structured output, server-side fallback) to plan the open days from the
  coach context (goals, load, recovery, recent weeks). `enforcePlanRules` then applies the hard
  rules in code: fixed days keep their sessions, only known session ids, at most two per day, no
  added games or team training, only Walking/Mobility the day after a game (also after a Sunday
  game), no run or futsal the day before, no Gym on consecutive days. The card shows each day
  (fixed / changed with "bisher"), "Übernehmen" writes sessions and guidance (`coaching`, shown
  in Heute) for open days and guidance for fixed days ahead; "Rückgängig" restores the previous
  sessions and guidance only, so later logs, notes and food entries stay. Proposals are stored
  under `coach-plan-<weekStart>`. With a lower-body complaint at Mittel or Stark the server also
  strips Easy run and Futsal from every open day.
- **Complaints (Beschwerden)** — reported only when something hurts: "Beschwerde" next to Ändern /
  Notiz in Heute opens a sheet (body area → optional side for hip, groin, thighs, knee, calf,
  ankle, shoulder → Leicht / Mittel / Stark, which saves). An episode stays active until "Wieder
  gut"; reporting the same area and side again updates its level (log kept for the trend). Active
  episodes show as a row above the rings in Heute (tap → change level or "Wieder gut"; "noch
  aktuell?" after 3 days without an update). Effects: `loadAdvice` puts Mittel/Stark first (also
  without watch data); the coach context gets `complaints` (active with level, days, trend, plus
  resolved in the last 14 days) and the prompt says how to dose, to recommend a professional
  after 7 days or when it gets worse, and never to diagnose; the plan proposal gets them as
  `complaints` (enforced rule above); the weekly report lists complaints active that week with
  their worst level. Stored top-level as `complaints` in the `soccer-v3` blob (no key bump).
- **Access code** — `APP_ACCESS_CODE` (Vercel env) is required for `/api/garmin` and, when set,
  for `/api/coach`. The app sends it as `Authorization: Bearer`; it is entered under Saison →
  Einstellungen → Garmin and stored in its own localStorage key, so exports never contain it.
- **Daily reminders (Web Push)** — opt-in under Saison → Einstellungen → Erinnerungen. Works on
  iPhone only in the home-screen app (iOS 16.4+). `public/sw.js` is a push-only service worker
  (no fetch handler, no offline caching). Vercel Cron (`vercel.json`) calls `/api/remind` at
  10, 11, 19 and 20 UTC; `api/_lib/push.js` sends only when it is 12 or 21 Uhr in
  Europe/Zurich, so both summer and winter time work, and at most once per slot and day
  (Redis `SET NX`; cron can deliver twice). On the Hobby plan a run lands anywhere within the
  hour. The push carries only the slot; the worker builds the text from a two-week snapshot of
  open items (`reminderStatus`, written to Cache Storage `soccer-status` on every change), so
  no training data reaches the server. Midday leaves out the eating rating.
  Storage: Upstash Redis via the Vercel Marketplace (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`). VAPID keys are generated on first use
  and kept in Redis, so no key setup is needed. Up to five devices; only real push-service
  endpoints are accepted; expired devices (404/410) are removed. Optional env vars:
  `CRON_SECRET` (cron requests must then carry it) and `VAPID_SUBJECT` (defaults to the site URL).
  Without Redis the app shows that reminders are not set up and cron runs are skipped.
- **`api/coach.js`** — Vercel Node serverless function. Streams Claude Opus 5.5 (`claude-opus-5-5`)
  replies as `text/plain` via `client.beta.messages.stream`. Opus 5.5 always thinks (thinking
  cannot be disabled, so the parameter is omitted); `output_config.effort: "medium"`,
  `max_tokens: 16000` because thinking counts towards it, and server-side `fallbacks: "default"`
  (beta `server-side-fallback-2026-07-01`). Replies start a few seconds later than with Sonnet;
  a typical request is ~9k input tokens (system prompt plus snapshot).
  The existing Anthropic API key remains unchanged. Persona: a demanding but fair Athletiktrainer —
  short, concrete instructions, holds the player to his plan, praise only when earned, never
  shaming, never through pain or illness. Data rules stay internal: the coach asks about
  missing days instead of talking about data, the snapshot or field names.
  The soccer-specific system prompt plus a per-request context block
  is built server-side. The frontend's pure `buildCoachContext` builds a fresh schema-v2
  snapshot on each send: actual today (distinct from the selected calendar day), previous
  14 calendar days including unlogged/rest-day notes, next seven days, next known match,
  current weekly Gym/Reha goals, eight prior week summaries, all-time logged totals and
  dated weight/body-fat readings with current/previous seven-day means and sample counts,
  and nutrition: per-day `{proteinGrams, rating}` up to today plus `nutrition.last7Days` /
  `previous7Days` (target hits, average on logged days, rating counts) against the target.
  One logged day can contain two session types; days and session totals are separate.
  Future-dated completions/measurements never count as actual history. `not_logged` does
  not mean skipped; `no_entry` does not mean confirmed rest. Match participation is separate
  from fixture presence. Invalid metrics are excluded; missing metrics stay null.
  The Daily Briefing button sends an ordinary chat message, and the prompt also handles
  typed equivalents such as Tagesbriefing. Briefings cover Rückblick / Heute / Ausblick /
  Wochenziele / Tagesfokus. The current day is the reference even when browsing another day.
  Other days' chats, migration backups and retired readiness fields are not sent. Long notes
  are visibly truncated in the context only; original storage stays unchanged. The last 20
  messages (up to 4,000 characters each) are sent; the full per-day conversation stays local.
  Legacy payloads still work during frontend rollout. Prompt data is delimited and treated
  as untrusted; context requests over 160,000 serialized characters are rejected.
  `tests/coach.test.mjs` tests the real context helpers, the server handler using a fake
  Anthropic client, and the installed SDK's request/streaming flow using a mock transport.
  These tests do not spend credits or validate live model answer quality.
  `ANTHROPIC_API_KEY` is read **server-side only** — never prefix it with
  `VITE_` or it leaks into the client bundle.
- **Storage** — one JSON blob under `soccer-v3`: `{ playerName, proteinTarget?, plan, ...archivedFields }`, where `plan` maps
  `YYYY-MM-DD → { sessions, completed, notes, feeling, weight?, bodyFat?, protein?, nutrition? }`.
  The nutrition fields and `proteinTarget` are optional additions; no key bump or migration. Existing `soccer-v2`
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
