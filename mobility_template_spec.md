# Phase Template Update — Add Mobility Sessions

Small targeted update to the weekly plan templates in `App.jsx`. The Mobility session type was added in the previous build but was never included in the phase day templates. This spec defines exactly where Mobility should appear in each phase.

---

## Context

The app has phase templates — day-by-day session suggestions that populate the Week view and Today card. These were written before Mobility was added. The weekly target is already set to 2x Mobility per week. The templates just need to reflect that.

The player's fixed sessions are:
- **Tuesday evening** — Futsal (indoor soccer)
- **Thursday evening** — Team Training (in-season) or flexible (off-season)
- **Gym** — 2x per week, never on Tuesday or Thursday
- **Mobility** — 2x per week, ideally after Gym sessions or on active rest days

Mobility should appear **after Gym on the same day** where possible (player is already warm, already at the gym). Where that's not possible, it goes on an active rest day. It should never be the only thing on a day that already has a hard session (Team Training, Futsal, Match) — those days need recovery, not added load.

---

## Updated templates per phase

### Off-Season (now → Aug 6)
No matches. Priority: gym consistency, body composition, mobility habit.

```
Monday:    Gym + Mobility
Tuesday:   Futsal
Wednesday: Gym + Mobility
Thursday:  Rest
Friday:    Rest
Saturday:  Rest
Sunday:    Rest
```

Note: Thursday is rest in off-season (no team training). Two Gym + Mobility combos on Mon/Wed hit both weekly targets in two sessions.

---

### Pre-Season (Aug 6 → early Sep)
Team training resumes Thursdays. Matches not yet started. Higher intensity ramp-up.

```
Monday:    Gym + Mobility
Tuesday:   Futsal
Wednesday: Gym
Thursday:  Team Training
Friday:    Mobility
Saturday:  Rest
Sunday:    Rest
```

Note: Mobility on Friday as standalone — after the Thu team training load, a dedicated stretch session aids recovery going into the weekend.

---

### In-Season (Sep → mid Nov, Apr → end Jun)
Matches on varying days. Wednesday kept light to protect legs for the weekend.

```
Monday:    Gym + Mobility
Tuesday:   Futsal
Wednesday: Rest
Thursday:  Team Training
Friday:    Mobility
Saturday:  Match
Sunday:    Rest
```

Note: Friday Mobility doubles as pre-match prep — loosening up before Saturday. If match is on a different day, shift Mobility to the day before the match.

---

### Winter Break (mid Nov → early Apr)
Longest block. Prime time for body composition and building the mobility habit properly.

```
Monday:    Gym + Mobility
Tuesday:   Futsal
Wednesday: Gym + Mobility
Thursday:  Rest
Friday:    Rest
Saturday:  Rest
Sunday:    Rest
```

Same as off-season — two Gym + Mobility combos cover all weekly targets efficiently.

---

### Holiday Override — Ibiza (Jul 10–15)
Rest block. No sessions planned. If the player logs something voluntarily, great — but no targets shown.

---

### Holiday Override — Tuscany (Aug 22 – Sep 5)
Week 1 (Aug 22–29): light sessions only.

```
Light Mobility session every 2 days — no gym, no running.
```

Week 2 (Sep 1–5): no targets. Whatever happens, happens.

---

## Implementation notes

- "Gym + Mobility" on the same day should be stored as `sessions: ['gym', 'mobility']` — using the multi-session model already built in the previous update.
- The week template arrays should use the same session type strings already defined in the app (`'gym'`, `'mobility'`, `'futsal'`, `'teamTraining'`, `'match'`, `'rest'`).
- The Today card and Week view should render Gym + Mobility days with both emojis side by side (already supported from the previous build).
- Weekly target counters should show 2/2 Gym and 2/2 Mobility as achievable in a normal week following this template — verify this is the case for each phase.

---

## Acceptance checks

- Every phase template includes exactly 2 Mobility sessions per week.
- Mobility never appears alone on the same day as Futsal, Team Training, or Match.
- Gym + Mobility days render correctly as dual-session entries in all views.
- Weekly target card shows Mobility 0/2 at the start of the week, incrementing correctly as sessions are logged.
- Holiday overrides (Ibiza = no targets, Tuscany week 1 = light only) are respected.
- Build passes with no regressions to existing views.
