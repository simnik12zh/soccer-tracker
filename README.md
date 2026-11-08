# Athlete

Mobile-first, full-season athletic coach for an amateur football player: training, recovery,
load, nutrition and body composition. Formerly "Soccer Tracker"; the web address, the repository
and the storage keys (`soccer-v3`, …) keep the old name on purpose, so existing data stays.
React + Vite single-file frontend (`src/App.jsx`), one Vercel serverless function for the AI coach. All data lives in
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
  (gear icon in the header, also linked at the end of Saison). The header logo is the runner
  from the app icon next to the Athlete wordmark (drawn with GPT Image): two transparent ice-blue
  PNGs in `src/assets/brand/`, cut out of their navy backgrounds, a little smaller on screens
  under 360 px. Midnight & Ice dark palette:
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
- **Heute** — compact day strip (‹ › jump a week, swipe moves a day). The ring card opens with
  the first glance: for today the day light (`dayGuidance`, see Training load) with its colour,
  name and one sentence; past days show sleep, Garmin sleep score and HRV instead
  (`recoveryGlance`), future days nothing. Active complaints sit right
  below. Then four rings: Erholung (the night only: watch values in their normal range, coloured and
  labelled Gut erholt / Eingeschränkt / Wenig erholt from `recoveryStatus`),
  Protein vs. target, Schritte (`stepsWeek`: the 7-day mean against Ø 10'000, today counting with its
  steps so far; it shows where he stands, never how many steps are still missing today) and
  Körperfett (7-day mean on the current scale; the arc follows his plan, `goalPath`: during the
  start phase the 14 days, then the way from the start value to the June goal, with "auf Kurs ✓",
  "vor dem Plan", "0.4 über Plan" or "Festtage +0.3" below; before the scale change it was the way
  from 16 % to 13 %, `BF_START`). The
  Körperfett ring is the body early warning: it stays quiet while he weighs at least 3 times in
  7 days and the weight moves at a good pace, otherwise it shows "2× gewogen", "zu schnell" or
  "steigt" with an "!" (`weighIns`, `bodyTempo`). Each ring opens a sheet: Erholung lists sleep, HRV, resting HR and Body Battery with
  the last 7 nights against his normal range (tap a row for the nightly values); Protein has
  +20/+30/+40 g with undo and a link to the meal card; Schritte shows the mean
  and the 7 days as bars with the goal line; Körperfett shows the change over 4 weeks,
  the goal bar, the weigh-in warning, the tempo and the last 4 weeks as a line, with a link to the Körper tab. Below the rings a
  sentence names what is still open (`dayChecklist`; past days say "nicht eingetragen", never
  "skipped") plus Wochenziele x/4, which opens the plan. The session card keeps FERTIG next to the
  title so it stays above the tab bar on a phone; long plan guidance is clamped to two lines, and
  its title drops a repeated session name (`guidanceTitle`). The load card is one line (value,
  short status) and expands to the bar and explanation; its advice lives in the ring card. The nutrition card: protein total with a pencil to correct it, +20/+30/+40 g buttons
  right under the bar, Foto · Beschreiben · Mediathek, the saved meals as a list that folds open
  (open/closed remembered on the device), the day's meals, rating. No calorie totals anywhere: he
  does not log every meal, so sums and averages would mislead; single meals keep their kcal. Below: "Als Nächstes" (next two planned days plus the next game within seven days,
  `upcomingDays`). Choosing "Krank/verletzt" in the session sheet offers to report where it hurts.
- **Auswertung einer Einheit** — a recorded game, team training, Freizeitkick, run or strength
  session in the training card opens a review ("Auswertung ›", `SessionReviewSheet`). It compares
  only with the up to 8 earlier sessions of the same kind (`reviewHistory`; Garmin calls all
  football "Fussball", so the day's plan tells a game from a training). Per value a bar from his
  lowest to his highest: the field is his range before, the tick his average (median), the point
  this session, sliding out from the average. Verdict Locker / Normal / Intensiv from Garmin load
  vs. his average (≥ 1.15 intensive, ≤ 0.85 easy), judged per minute when the session was much
  shorter than usual ("Kurzer Einsatz"; values can be scaled to the usual duration). One sentence
  names the load and the two values that stood out. Below: the session's share of his usual week
  and the day light of the next day (today for yesterday's session, tomorrow for today's).
  "Trainer fragen" opens the coach with the question filled in; the coach context carries the same
  comparisons for the last 7 days (`sessionReviews`). From three sessions of a kind; before that
  the sheet shows the values only. Walks, mobility, Velo, Langlauf and Padel have no review.
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
  protein (the pencil corrects the day total; the quick-add part absorbs the difference). Coach
  context gets the day's meals (title, kcal, protein) and the instruction never to add meal kcal
  up to a daily intake or judge energy balance from them.
  Day updates build on the latest plan (`planRef`) so results arriving after an await never drop
  newer edits.
- **Describe and correct meals** — "Beschreiben" next to "Foto" takes a short text ("Chicken
  Burrito mit Reis", several items separated by commas); `POST /api/meal` with `description`
  estimates it like a photo (typical Swiss portions unless amounts are given; saved with
  `source: 'text'`, shown as "beschrieben"). An opened meal offers "Stimmt nicht? Richtigstellen":
  his words count as fact for what he ate, and the model re-estimates name, components, kcal and
  protein (`correction` + `previous` title/items; shown as "richtiggestellt"). The downscaled
  photo stays in memory while the app is open (`mealPhotoMemory`, never stored), so a correction
  right after a photo sends it again; later corrections use the earlier portions instead. His text
  is passed inside tags as a description only, never as instructions.
- **Meal favourites** — open a meal → "Als Favorit merken" (name, kcal and protein as shown in
  the fields; the name is editable). Favourites appear under "Gespeicherte Mahlzeiten", a list that
  folds open, most used first; one tap adds a copy to the viewed day (`source: 'favorite'`,
  `favoriteId`, no photo, no model call) with an inline "Rückgängig". "Bearbeiten" removes
  favourites (meals already logged stay) or adds one by hand (e.g. a shake). Same name = update,
  max. 12 (the least used one goes). Stored top-level as `mealFavorites` in the `soccer-v3` blob
  (no key bump). Favourite meals count for protein like photo meals; the coach context
  marks them `fromFavorite`.
- **Plan** — Woche/Monat toggle. The week view marks today, has one edit button per day (swap
  lives in the session sheet: "Mit einem anderen Tag tauschen"), then Plan-Vorschlag,
  Wochenziele, Belastung (a line of the acute load day by day: three weeks measured, the next 7 days dashed from the plan, inside his range, with a sentence on when the plan takes him over it and which sessions add most; `LoadTrend`, `loadSeries`, `loadOutlookText`) and Taktik.
- **Scale change and goal path** — a new Withings scale since 27 Oct 2026 (`SCALE_SINCE`) reads
  about 2 points lower than the old one (last reading 4 Oct). Body values are only compared within
  one scale (`scaleEra`): the snapshot, weekly deltas, tempo, weekly trends, the coach and the
  report. His plan (`goalPath`): the first 14 days on the new scale with at least 10 readings
  give the start value (the window grows until there are 10), then −0.5 points a month until
  30 June 2027 (about 13 % on the old scale). Within 0.3 points of the plan is on track. Over the
  festive days (20 Dec – 6 Jan) the check is against the week before: at most +0.5 points.
- **Körper** — body-fat 7-day mean as hero with delta vs. the previous 7 days and his plan
  (`PathBlock`): during the start phase 14 day marks (filled when he weighed), then a bar with the
  June goal, the start value, today's plan value and where he is; weight, fat mass and lean mass tiles (mass needs weight and body fat in the same
  window, `bodySnapshot`); Tempo (`bodyTempo`: weight per month, the 7-day mean today against the
  one four weeks earlier, at least 3 readings in each week and from one scale only, so an old and
  a new scale never mix; Zu schnell below −0.8, Gutes Tempo to −0.3, Stabil, Steigt from +0.3;
  with the fat and lean split. Weight is the alarm, lean mass only context, because the scale's
  lean mass moves with water); trend chart (Körperfett/Gewicht, 4 Wochen / 3 Monate / Saison);
  dated measurement editor (any date up to today, empty field removes a value); the last five
  measurements with "N× in 7 Tagen" (warning colour and a note below 3). Charts mark the scale
  change ("neue Waage"), show old-scale values faintly only when they lie in view and draw the
  plan as a dashed line instead of the flat 13 % line; a seven-day nutrition
  overview (traffic lights, protein hits, average); steps as a 7-day mean with the goal line;
  sleep & recovery with labelled rows (Schlaf, HRV, Puls). Manual entry is a text link, since
  the scale delivers automatically.
- **Saison** ("Deine Saison.") — season progress, weekly reports, phase timeline (earlier phases folded behind
  "Frühere Phasen anzeigen", no "0 / 0" counts) and the settings entry (profile, connections,
  reminders, backup export/restore). The weekly report shows its numbers as tiles per topic
  (`factGroups`).
- **Fixtures** — `MATCH_SCHEDULE` contains the seven FC Julius Bär league games from the user's
  27 September 2026 screenshot plus the cup game of 2 November (Cup · Zwischenrunde 1, Juchhof 2,
  Schlieren, match 515893), including opponent, home/away, kickoff, match ID and
  `Europe/Zurich` timezone; optional `competition` and `place` show in Today and Week. Kickoffs are local clock strings so the October DST change
  does not shift them. There is no automatic online fixture sync.
  Games replace open training on their dates. A one-time import into the existing v3
  blob removes unlogged generic Saturday match placeholders from 27 September onwards;
  past entries, completed days, notes, body values and explicitly detailed matches remain.
  Overwritten entries are retained in `matchScheduleBackup.previousEntries` (included
  in exports), and `matchScheduleVersion` prevents repeated imports. Later schedule versions
  only add fixtures that are not there yet (no clean-up, known match days keep his edits); a
  fixture can carry `reshape` dates whose untouched coached days take the new prescription
  (the cup week: Tuesday recovery, Wednesday upper body). Restoring a pre-import backup runs
  the same migration. Dated games cannot be moved by the training-day swap.
  Gold match markers distinguish games in Today, Week and Month; the month also lists
  all known fixtures with their details. Unknown spring games are not invented.
- **Reviewed end-of-year plan** — `COACHED_WEEKS` / `COACHED_SESSIONS` define a dated
  coaching overlay for 27 September–31 December 2026, not a permanent template change.
  Every full week from 28 September has two Gym days and at least two gentle Mobility
  slots. The already-started week is not retroactively filled. Thursday team sessions
  continue through the last known game (12 November, replacing training); there are no
  team sessions after that assumed club shutdown. Games and completed logs take priority.
  Day-after-match plans are rest days, not futsal or heavy strength. Double-game weeks use
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
- **Rest days (Ruhetag)** — a day without sessions means no training, but at least
  `REST_STEPS` (7'000) easy steps over the day. Walking is no longer a session to tick off
  ("Spazieren" left the picker and the planner): the watch's step count decides (`restDay`).
  The Today card shows a bar with "3'200 von 7'000 Schritten" and "7'400 Schritte ✓" once
  reached; the week list shows the same line, future rest days "mind. 7'000 Schritte". Nothing
  is ticked off and "Noch offen" stays unchanged. Sick days have no goal. A recorded walk or
  hike never ticks or fills a day; it counts through the steps and is not "nicht im Plan".
  `migrateRestDays` (once, `restDaysVersion`) turns open walking days into rest days and gives
  the old rest guidance the step goal; logged walks stay as history. The coach and the weekly
  planner know the rule.
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
  "nicht im Plan". Rides (`cycl`, `bik`, `ride`) map to Velo, `cross_country_skiing` and
  `skate_skiing` to Langlauf (alpine skiing stays unmapped), `padel` to Padel. It never un-ticks a day, never changes feelings or notes, and a day the
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
  the app rebuilds them from each activity's Garmin training load (`activityTrainingLoad`) the
  way Garmin describes Acute Load (a weighted sum of recent days): each day's load counts fully
  that day and fades by a seventh per day (`acuteLoads`, `LOAD_DECAY`, fitted to his Garmin
  chart, where acute load drops about 13–17 % a day after a game); chronic = the average acute
  load of the last 28 days, which settles at his usual weekly total; optimal = 0.8–1.4 × chronic,
  high from 1.5, very high from 2.0 (Garmin's load-ratio bands at one decimal, `LOAD_BANDS`)
  (`loadStatus`, needs 28 days of watch data). Sync version 5 loads 90 days of activities once (`/api/garmin` allows up to 90), so the chronic load and its warm-up are right from the first day of the chart. Values should be close to Garmin's, not identical:
  Garmin does not publish its weights. `typicalLoads` = his own median per session type
  over 60 days; football also per kind (Spiel, Mannschaftstraining, Freizeitkick, told apart by the plan) once two of a kind are recorded, so a planned game counts like his games; `plannedLoad` adds planned, not yet done sessions. `loadOutlook` looks ahead:
  the acute load for today and the next 4 days with planned sessions at his typical load
  (peak = highest window). `dayGuidance` turns all of it into one traffic light for today with a
  sentence that names the deciding reason, so colour and words never disagree; the strictest reason
  wins. Red (Erholungstag, only easy or rest): complaint Stark, low recovery, load very high (from 2.0 ×
  his chronic load). Orange (Ruhiger Tag, keep quality, trim volume, nothing extra): complaint Mittel,
  the day before a game (the next game wins), the day after a game, limited recovery, load above
  the range, today's plan or the next 4 days pushing above it. Green (Bereit, do the plan fully)
  otherwise; the game day itself stays green after a good night. Without a night from the watch
  there is no colour, only the sentence. Green may still say nothing extra is needed; an extra
  session only if the projected peak plus the extra stays at most ~1.1 × his average week
  (`LOAD_EXTRA_TARGET`), otherwise it names the planned sessions that fill the week. The coach gets
  the same light (`today.dayLight`) and must not contradict it. When another reason of a different kind also holds the colour
  back, the sentence names it too ("Gestern war Spiel, und deine Belastung liegt über dem
  Bereich."). Under the sentence a factor line shows what the colour is made of: Schlaf (gut /
  mässig / schlecht / ohne Daten, from the night's watch values), Belastung (unter / im / über
  Bereich, bald über Bereich, deutlich darüber), and Spiel gestern / heute / morgen or an active
  complaint when they apply. The Erholung ring keeps showing the night only. The expanded
  card shows the projected peak as a hollow marker. Heute shows the advice at the top of the ring card and a load card for today (value,
  range bar with the planned part); Plan → Woche shows the same acute load as a line, with his range moving along with the chronic load like in Garmin's chart, and a tap (or a drag along the line, or the arrow keys) on a day shows what moved it: the sessions done or planned that day with their load, today's still open plan for tomorrow, and the fading of the day before, adding up to the change, measured and planned, so chart and day light always agree; past weeks show the measured part only.
  The coach gets the whole block (`load`, whitelisted server-side). The Garmin endpoint now
  accepts up to 60 days: activities for the full window (paged by 99), steps/sleep/HRV/daily
  summaries for the last 28 days. Sync version 4 loads six weeks of activities once.
- **Weekly report** — on Monday 7–8 Uhr (Zurich) the cron sends a "weekly" push ("Dein
  Wochenreport ist da", crons `0 5 * * 1` and `0 6 * * 1`, deduplicated like the daily slots);
  tapping it opens `/?report=latest` (or messages an open app). `weeklyReportFacts` computes the
  last completed Monday–Sunday week in the app: training days, goals, games, watch minutes,
  football km and top speed, weekly load against the range, body-fat and weight 7-day means
  versus the week before, nutrition (protein hits, average, traffic lights),
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
  added games or team training, only a rest day or Mobility the day after a game (also after a Sunday
  game), no run or futsal the day before, no Gym on consecutive days. The card shows each day
  (fixed / changed with "bisher"), "Übernehmen" writes sessions and guidance (`coaching`, shown
  in Heute) for open days and guidance for fixed days ahead; "Rückgängig" restores the previous
  sessions and guidance only, so later logs, notes and food entries stay. Proposals are stored
  under `coach-plan-<weekStart>`. With a lower-body complaint at Mittel or Stark the server also
  strips Easy run and Futsal from every open day. Velo (`Cycling`), Langlauf (`Cross-country
  skiing`) and Padel are his own sports: picked in "Was steht an?", they make a day fixed; the
  planner counts them as load (Padel like Futsal) but never plans them. They count as hard
  sessions for the day light (e.g. "Morgen ist Spiel. Padel heute locker halten").
- **Complaints (Beschwerden)** — reported only when something hurts: "Beschwerde" next to Ändern /
  Notiz in Heute opens a sheet (body area → optional side for hip, groin, thighs, knee, calf,
  ankle, shoulder → Leicht / Mittel / Stark, which saves). An episode stays active until "Wieder
  gut"; reporting the same area and side again updates its level (log kept for the trend). Active
  episodes show as a row above the rings in Heute (tap → change level or "Wieder gut"; "noch
  aktuell?" after 3 days without an update). Effects: `dayGuidance` puts Mittel/Stark first (also
  without watch data); the coach context gets `complaints` (active with level, days, trend, plus
  resolved in the last 14 days) and the prompt says how to dose, to recommend a professional
  after 7 days or when it gets worse, and never to diagnose; the plan proposal gets them as
  `complaints` (enforced rule above); the weekly report lists complaints active that week with
  their worst level. Stored top-level as `complaints` in the `soccer-v3` blob (no key bump).
- **Coach context: time, trends, last report** — every coach, report and plan call adds the
  local time (`localTime`), `trends.weeks` (`weeklyTrends`: the last eight completed weeks plus
  the current one so far, with training days, gym/reha, games, load, weight, body fat, fat and
  lean mass, protein, red days, sleep, sleep score, HRV, resting HR, steps, football km, top
  speed, high-HR minutes and social match points; null = no data) and `lastWeeklyReport`
  (`coachExtras`; a new report gets the one before it). The prompt asks for trends over three or
  more weeks with numbers, and to keep the last report's Fokus as the line for the week.
- **Social matches** — his game against losing control at restaurants, bars, parties and family
  dinners. Before the event: "Social Match planen" (link at the bottom of the nutrition card, or
  under Körper) with day, kick-off (default 19:00), occasion and exactly three yes/no rules; his
  standard rules are preselected and can be saved as new standard. Rules can change only before
  kick-off; planning after kick-off is refused; one match per day. A Testspiel is a free evening
  declared beforehand that never counts: at most one per week (Mon–Sun), during holidays one
  every three days (`friendlyAllowed`). A match shows on its own day in Heute (planned on
  Wednesday for Friday → Friday's view; a toast confirms where it landed); the planning sheet keeps
  its header and save button fixed while the middle scrolls. After kick-off Heute shows the rules ("Match läuft",
  "Zu Hause? Jetzt auswerten"); from the next day the evaluation: ✓/✗ per rule → Sieg 3,
  Unentschieden 1, Niederlage 0 (`evaluateSocialMatch`), or "Fand nicht statt". Körper shows the
  table: Ø points vs. goal 2.0, record, form of the last five, most broken rule, recent matches,
  and holiday tournaments: holidays are entered under "Ferien eintragen" (name, from, to); during
  a holiday Heute asks each day whether the evening is a match (or Testspiel, or "Heute nicht").
  Push: on match day the midday push lists the three rules, the evening push reminds of them and
  to score at home; an unscored match shows up in the next midday push (no extra push slot: web
  push must always show something). Coach context gets `social` (season table, upcoming,
  awaiting result, recent with broken rules, current/next holiday); the weekly report shows the
  week's record and average. Stored top-level as `socialMatches`, `socialRules` and
  `socialHolidays` in the `soccer-v3` blob (no key bump).
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
  `bodyGoal` carries the scale change (`newScaleSince`, last old reading) and the goal path (start
  phase, or start value and date, end value, plan today, current mean, deviation, status, the
  festive check); `trends.weeks` marks each week's scale.
  The early warning goes along: `body.weighInsLast7Days`, `body.tempo` and `steps` (7-day mean,
  goal); the weekly report adds weigh-ins and tempo for its week. Settings →
  "Hintergrund für den Coach" holds his own background (for example his analysis of cuts and
  rebounds and his rules), stored only on the device under `coach-background` (part of backups)
  and sent as `athleteHistory`. Personal history never goes into the code: the repository is public.
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
  → Krafttraining, `Futsal` → Freizeitkick/Futsal, `Mobility` → Prävention/Reha, `Cycling` → Velo,
  `Cross-country skiing` → Langlauf).
  Session-specific card summaries cover both planned and completed days and two-session
  combinations. New coach replies are instructed to be German; existing notes and chats
  are preserved verbatim. The brand name Athlete stays English.
  Per-day coach chats live under
  `coach-YYYY-MM-DD`; one-time milestone flags under `milestone-<id>`.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (auto-detects Vite, no config needed).
2. Add the `ANTHROPIC_API_KEY` environment variable in the Vercel project settings.
3. Every push to the default branch auto-deploys.
