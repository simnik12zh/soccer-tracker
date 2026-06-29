# Tracker Update Spec — Multi-Session Logging + Emoji + Mobility

Two connected changes to `src/App.jsx`. Both are data model + UI changes only — no new API routes needed.

---

## 1. Add "Mobility" as a session type

Add a new session type to the existing list of loggable options:

- **Label:** "Mobility"
- **Emoji:** 🧘 (or similar stretch/flexibility icon consistent with the existing set)
- **Weekly target:** 2x per week (same priority as Gym — not optional, not a nice-to-have)

Update the weekly target logic to include `mobility: 2` alongside `gym: 2` in the per-phase targets. In the off-season and winter break phases where gym is the priority, mobility should carry the same weight.

---

## 2. Soccer ball emoji for Futsal and Team Training

In all views where session types are displayed (calendar, week strip, session cards, bottom sheet, anywhere a session emoji appears):

- **Futsal** → ⚽
- **Team Training** → ⚽

Both get the soccer ball emoji. Everything else keeps its existing emoji.

---

## 3. Multi-session logging per day

### Data model change

Each day's log entry should support multiple session types. Change from a single `type` string to a `sessions` array:

```js
// Before
{ date: '2026-06-29', type: 'gym', done: true, feeling: 4 }

// After
{ date: '2026-06-29', sessions: ['gym', 'mobility'], done: true, feeling: 4 }
```

Handle backwards compatibility — any existing entries with a single `type` string should be read as `sessions: [type]` so nothing breaks for users with existing data.

### Bottom sheet change (session type selector)

Change the session type selector from **single-select** to **multi-select**:

- User can tap one or two session types before confirming the log
- Selected types are visually highlighted (filled/active state)
- At least one type must be selected before the confirm button is enabled
- Two is the max (no need to support three — the realistic use case is "Gym + Mobility" or "Team Training + Mobility", not three simultaneous types)
- The confirm button label reflects the selection: "Log Gym + Mobility" rather than just "Log"

### Weekly target counting

When counting toward weekly targets, each session in the `sessions` array counts independently:

```js
// This single log entry counts as:
// - 1x gym toward the gym weekly target
// - 1x mobility toward the mobility weekly target
{ date: '2026-06-29', sessions: ['gym', 'mobility'] }
```

Do not double-count — one day with gym + mobility = 1 gym + 1 mobility, not 2 of either.

### Display in calendar and week views

When a day has two session types, show both emojis on that day's calendar cell and week strip entry. For example a Gym + Mobility day shows 💪🧘 side by side.

The done/planned indicator (green tick, ring etc.) should reflect the combined entry — if the day is logged it's done regardless of how many types.

---

## 4. Acceptance checks

- Existing single-type log entries render correctly after the data model change (backwards compat).
- Selecting two session types in the bottom sheet counts correctly toward two separate weekly targets.
- Futsal and Team Training both display ⚽ in every view where session emojis appear.
- Calendar and week strip correctly show two emojis for dual-session days.
- Confirm button is disabled until at least one session type is selected.
- Weekly summary stats reflect the new mobility target (2x) alongside gym (2x).
- No visual breakage on narrow mobile screens when two emojis are shown on a calendar cell.
