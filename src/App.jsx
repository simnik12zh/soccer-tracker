import { useState, useEffect, useRef } from "react";

const SK = "soccer-v3";
const SK_PREV = "soccer-v2";   // migrated from on first load of this version
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const DN = ["Mo","Di","Mi","Do","Fr","Sa","So"];

function pad(n) { return String(n).padStart(2,"0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayStr() { return dateKey(new Date()); }
function offsetDate(off) { const d=new Date(); d.setDate(d.getDate()+off); return dateKey(d); }

function daysUntil(ds) {
  if (!ds) return null;
  const [y,m,d]=ds.split("-").map(Number), n=new Date();
  return Math.round((Date.UTC(y,m-1,d)-Date.UTC(n.getFullYear(),n.getMonth(),n.getDate()))/86400000);
}
// Mon=0 … Sun=6 weekday index.
function dow0(d) { return (d.getDay()+6)%7; }
function weekOf(off=0) {
  const n=new Date(), mon=new Date(n);
  mon.setDate(n.getDate()-dow0(n)+off*7);
  return Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return dateKey(d); });
}
function monthGrid(y,m) {
  const skip=(new Date(y,m,1).getDay()+6)%7, total=new Date(y,m+1,0).getDate();
  return [...Array(skip).fill(null),...Array.from({length:total},(_,i)=>`${y}-${pad(m+1)}-${pad(i+1)}`)];
}
// YYYY-MM-DD string n days before the given date string.
function daysBeforeStr(dateStr, n) {
  const d=new Date(dateStr+"T00:00:00"); d.setDate(d.getDate()-n); return dateKey(d);
}

// ─── Season phases ──────────────────────────────────────────────────────────────
const PHASES = [
  { name:'Off-Season',   start:'2026-06-29', end:'2026-08-05',
    description:"Regelmässiges Krafttraining und Körperentwicklung. Baue deine athletische Basis auf – mindestens zwei Krafteinheiten pro Woche.", color:'#9CCBD3' },
  { name:'Pre-Season',   start:'2026-08-06', end:'2026-09-06',
    description:"Steigere deine Kondition. Das Mannschaftstraining beginnt wieder. Bleib aufmerksam und starte fit in die Saison.", color:'#9CCBD3' },
  { name:'Autumn Season',start:'2026-09-07', end:'2026-11-15',
    description:"Leistung bringen, erholen, fit bleiben. Stimme deine Belastung auf die eingetragenen Spieltermine ab.", color:'#9CCBD3' },
  { name:'Winter Break', start:'2026-11-16', end:'2027-04-04',
    description:"Nutze die Pause für deine Körperentwicklung. Trainiere regelmässig Kraft und schaffe die Grundlage für den Frühling.", color:'#9CCBD3' },
  { name:'Spring Season',start:'2027-04-05', end:'2027-06-30',
    description:"Leistung bringen, Fitness erhalten und Belastung steuern. Beende die Saison stark.", color:'#9CCBD3' },
  { name:'Summer Break', start:'2027-07-01', end:'2027-08-05',
    description:"Ausruhen, erholen, neue Energie tanken. Du hast es dir verdient.", color:'#9CCBD3' },
];
const SEASON_START = '2026-06-29';
const SEASON_END = '2027-08-05';

// Confirmed FC Julius Bär fixtures, transcribed from the user's 27 Sep 2026 screenshot.
// Times are local Europe/Zurich wall-clock times, NOT UTC (DST changes on 25 Oct).
const MATCH_SCHEDULE_VERSION = 'julius-baer-autumn-2026-v1';
const MATCH_IMPORT_FROM = '2026-09-27';
const MATCH_SCHEDULE = [
  { id:'972321', date:'2026-10-02', kickoff:'20:00', opponent:'FC UBS 1 AG', home:false },
  { id:'972311', date:'2026-10-12', kickoff:'20:30', opponent:'FC Ränte', home:true },
  { id:'972315', date:'2026-10-16', kickoff:'20:15', opponent:'FC Ristorante Da Carlo', home:false },
  { id:'972323', date:'2026-10-26', kickoff:'20:30', opponent:'Shamrock Football Club', home:true },
  { id:'972326', date:'2026-10-31', kickoff:'10:00', opponent:'FC Ränte', home:false },
  { id:'972330', date:'2026-11-09', kickoff:'20:30', opponent:'FC Ristorante Da Carlo', home:true },
  { id:'972331', date:'2026-11-12', kickoff:'19:00', opponent:'FIFA FOOTBALL CLUB', home:false },
].map(match=>({...match,team:'FC Julius Bär',timezone:'Europe/Zurich'}));

function isMatchDay(entry) { return !!entry?.match || getSessions(entry).includes('Match'); }
function calendarDone(entry) { return !!entry?.completed && (!entry.match || getSessions(entry).includes('Match')); }
function calendarStatus(entry) {
  if(entry?.completed && !calendarDone(entry))return 'Training erledigt · Spielteilnahme offen';
  return entry?.completed?'Erledigt':isMatchDay(entry)||getSessions(entry).length?'Geplant':'Erholung';
}
function matchVenue(match) { return match.home?'Zuhause':'Auswärts'; }
function matchSummary(match) { return matchVenue(match)+' · '+match.kickoff+' Uhr · gegen '+match.opponent; }
function entryDescription(entry) {
  const label=sessionsLabel(entry)||'Ruhetag';
  return entry?.match?label+' · '+matchSummary(entry.match)+(entry.completed&&!calendarDone(entry)?' · Training erledigt, Spielteilnahme nicht erfasst':''):label;
}

// One-time, immutable schedule import. Backups retain the original entries,
// including overridden open training, notes and body values. Logged days are never rewritten.
function applyMatchSchedule(plan) {
  const next={...plan}, previousEntries={};
  const fixtureDates=new Set(MATCH_SCHEDULE.map(m=>m.date));
  const replace=(dk,entry)=>{if(!(dk in previousEntries))previousEntries[dk]=plan[dk]??null;next[dk]=entry;};
  for (const [dk,entry] of Object.entries(plan)) {
    const phase=phaseForDate(dk)?.name;
    if(dk<MATCH_IMPORT_FROM||fixtureDates.has(dk)||entry.completed||entry.match||
      !['Autumn Season','Spring Season'].includes(phase)||dow0(new Date(dk+'T12:00:00'))!==5)continue;
    if(getSessions(entry).includes('Match'))replace(dk,{...entry,sessions:getSessions(entry).filter(s=>s!=='Match'),workout:''});
  }
  for (const match of MATCH_SCHEDULE) {
    const entry=next[match.date]||{};
    // Completed non-match training remains the actual log; the fixture is calendar context only.
    replace(match.date,{...entry,
      ...(!entry.completed?{sessions:['Match'],workout:'',completed:false}:{}),
      match:{...match},
    });
  }
  return {plan:next,previousEntries};
}
function migrateMatchSchedule(data) {
  if(data.matchScheduleVersion===MATCH_SCHEDULE_VERSION)return data;
  const result=applyMatchSchedule(data.plan);
  return {...data,plan:result.plan,matchScheduleVersion:MATCH_SCHEDULE_VERSION,
    matchScheduleBackup:{version:MATCH_SCHEDULE_VERSION,previousEntries:result.previousEntries}};
}

// Reviewed calendar, not a recurring rule: only 27 Sep–31 Dec 2026.
// Two gym visits do not mean two hard lower-body sessions in congested weeks.
const COACHED_PLAN_VERSION = 'autumn-winter-2026-v2';
const COACHED_START = '2026-09-27';
const COACHED_END = '2026-12-31';
const COACHED_SESSIONS = {
  rest: {sessions:[],title:'Trainingsfrei',text:'Erholung ist heute der Plan. Schlaf und regelmässige Mahlzeiten priorisieren; keine ausgefallenen Einheiten nachholen.'},
  recover: {sessions:['Walking'],title:'Erholung nach dem Spiel',text:'Nur entspannt spazieren, wenn es dir guttut. Kein Futsal, keine Intervalle, kein schweres Beintraining. Bei Beschwerden lieber Ruhe und fachlich abklären lassen.'},
  walk: {sessions:['Walking'],title:'Locker bewegen',text:'Entspannt spazieren. Kein zusätzlicher Trainingsreiz nötig; Krafttraining und Fussball haben Vorrang.'},
  prehab: {sessions:['Mobility'],title:'Sanfte Prävention und Mobilität',text:'Nur vertraute, schmerzfreie Übungen mit geringer Belastung. Keine ermüdenden Kraftübungen oder neuen Reize kurz vor dem Spiel.'},
  gym: {sessions:['Gym','Mobility'],title:'Ganzkörperkraft · kontrollierter Aufbau',text:'Vertraute Kniebeuge-/Ausfallschritt-, Hüftstreck-, Zug- und Druckbewegungen: je 2–3 saubere Sätze, 2–3 Wiederholungen Reserve. Danach dosierte Prävention. Bei Restmüdigkeit Beinumfang reduzieren; kein Muskelversagen.'},
  upper: {sessions:['Gym','Mobility'],title:'Oberkörper & Rumpf · Beine entlasten',text:'Kurze Einheit mit kontrolliertem Ziehen, Drücken und Rumpfstabilität. Je 1–2 leichte bis moderate Sätze, mindestens 3 Wiederholungen Reserve. Keine schweren Beine, Sprünge oder Sprints; Prävention heute nur sanft.'},
  primer: {sessions:['Gym','Mobility'],title:'Kurzer Gym-Termin · frisch bleiben',text:'Vor dem nächsten Spiel nur leichtes Oberkörper- und Rumpftraining: wenige vertraute Übungen, 1–2 leichte Sätze und viel Reserve. Prävention heute nur sanft. Keine Beinbelastung und kein Muskelkater provozieren. Bei Müdigkeit auslassen – die Zielzahl ist kein Zwang.'},
  deload: {sessions:['Gym','Mobility'],title:'Entlastungswoche · halber Umfang',text:'Vertraute Ganzkörperübungen mit ungefähr halber üblicher Satzzahl, leichten Gewichten und viel Reserve. Keine Leistungssteigerung erzwingen. Prävention und Mobilität locker anschliessen.'},
  team: {sessions:['Team Training'],title:'Mannschaftstraining · Qualität vor Zusatzlast',text:'Mit der Mannschaft trainieren, Schulterblick und Abstände bewusst üben. Keine zusätzlichen Konditionsblöcke danach; Belastung bei Restmüdigkeit mit dem Trainer abstimmen.'},
  teamLight: {sessions:['Team Training'],title:'Mannschaftstraining · vor dem Spiel dosieren',text:'Morgen ist Spiel: mit dem Trainer eine kurze, technische/taktische Teilnahme vereinbaren. Keine harten Zweikämpfe, langen Spielformen oder Zusatzläufe. Das Teamprogramm nicht unverändert durchziehen, wenn es dich ermüdet.'},
  match: {sessions:['Match'],title:'Spiel hat Priorität',text:'Kein zusätzliches Kraft- oder Konditionstraining heute. Vertraut aufwärmen, vor der Ballannahme orientieren und danach essen, trinken und Schlaf priorisieren.'},
  futsal: {sessions:['Futsal'],title:'Zusätzliche Ballkontakte · dosiert',text:'Nur teilnehmen, wenn du dich vom letzten Training erholt hast. Qualität und schnelle Entscheidungen statt maximalem Umfang. Bei müden Beinen durch Spaziergang oder Ruhe ersetzen.'},
  aerobic: {sessions:['Easy run'],title:'Lockere Ausdauerbasis',text:'Ruhig und im Gesprächstempo laufen, keine Intervalle oder Sprints. Nur so viel, dass du dich danach frisch fühlst. Bei müden Beinen spazieren statt laufen.'},
};
// Monday … Sunday; even rest days are explicit so old open sessions are removed.
const COACHED_WEEKS = [
  ['2026-09-28',['gym','walk','upper','teamLight','match','recover','rest']],
  ['2026-10-05',['gym','futsal','rest','team','gym','prehab','rest']],
  ['2026-10-12',['match','recover','upper','teamLight','match','recover','upper']],
  ['2026-10-19',['walk','gym','rest','team','upper','prehab','rest']],
  ['2026-10-26',['match','recover','upper','team','primer','match','recover']],
  ['2026-11-02',['upper','walk','rest','team','gym','prehab','rest']],
  ['2026-11-09',['match','recover','primer','match','recover','upper','rest']],
  ['2026-11-16',['walk','deload','rest','deload','walk','aerobic','rest']],
  ['2026-11-23',['gym','futsal','rest','gym','rest','aerobic','rest']],
  ['2026-11-30',['gym','futsal','rest','gym','rest','aerobic','rest']],
  ['2026-12-07',['gym','futsal','rest','gym','rest','aerobic','rest']],
  ['2026-12-14',['deload','walk','rest','deload','rest','aerobic','rest']],
  ['2026-12-21',['gym','walk','gym','rest','rest','aerobic','rest']],
  ['2026-12-28',['gym','walk','gym','rest','rest','rest','rest']],
];
const COACHED_DAYS = { [COACHED_START]:'recover' };
for(const [monday,slots] of COACHED_WEEKS)slots.forEach((slot,i)=>{
  const dk=daysBeforeStr(monday,-i);
  if(dk<=COACHED_END)COACHED_DAYS[dk]=slot;
});
function coachingFor(entry) {
  const c=entry?.coaching;
  return c&&typeof c.title==='string'&&typeof c.text==='string'&&
    JSON.stringify(c.sessions)===JSON.stringify(getSessions(entry))?c:null;
}
function coachSessionDescription(entry) {
  const guidance=coachingFor(entry);
  return entryDescription(entry)+(guidance?' · Planhinweis: '+guidance.title+' — '+guidance.text:'');
}
function applyCoachedPlan(plan,from=COACHED_START) {
  const next={...plan},previousEntries={};
  for(const [dk,slot] of Object.entries(COACHED_DAYS)) {
    if(dk<from)continue;
    const entry=plan[dk]||{notes:'',feeling:null};
    // Keep actual logs, illness/injury and any independently added games intact.
    if(entry.completed||getSessions(entry).includes('Sick/Injured'))continue;
    if(isMatchDay(entry)&&slot!=='match')continue;
    const prescription=COACHED_SESSIONS[slot];
    previousEntries[dk]=plan[dk]??null;
    next[dk]={...entry,sessions:[...prescription.sessions],workout:'',completed:false,
      coaching:{...prescription,sessions:[...prescription.sessions]}};
  }
  return {plan:next,previousEntries};
}
function migrateCoachedPlan(data,from=todayStr()) {
  if(data.coachedPlanVersion===COACHED_PLAN_VERSION)return data;
  const result=applyCoachedPlan(data.plan,from>COACHED_START?from:COACHED_START);
  return {...data,plan:result.plan,coachedPlanVersion:COACHED_PLAN_VERSION,
    coachedPlanBackup:{version:COACHED_PLAN_VERSION,
      previousEntries:{...result.previousEntries,...(data.coachedPlanBackup?.previousEntries||{})}}};
}


function phaseForDate(dk) {
  for (const p of PHASES) if (dk>=p.start && dk<=p.end) return p;
  return null;
}

// Weekly templates per phase — [Mon…Sun]. A day is a single session string, an
// array of sessions (e.g. Gym + Mobility — same day so he's already warm), or null
// (rest). Mobility lands twice a week: paired after Gym, else on an active rest day,
// never sharing a day with a hard session (Futsal / Team Training / Match).
const TEMPLATES = {
  'Off-Season':    [['Gym','Mobility'],'Futsal',['Gym','Mobility'],null,null,null,null],
  'Pre-Season':    [['Gym','Mobility'],'Futsal','Gym','Team Training','Mobility',null,null],
  'Autumn Season': [['Gym','Mobility'],'Futsal',null,'Team Training','Mobility',null,null],
  'Winter Break':  [['Gym','Mobility'],'Futsal',['Gym','Mobility'],null,null,null,null],
  'Spring Season': [['Gym','Mobility'],'Futsal',null,'Team Training','Mobility',null,null],
  'Summer Break':  [null,null,null,null,null,null,null],
};
// Holiday overrides ([Mon…Sun]). Tuscany week 1: light Mobility every other day
// (lands on Aug 22 / 24 / 26 / 28); week 2: nothing planned — whatever happens, happens.
const TUSCANY_W1 = ['Mobility',null,'Mobility',null,'Mobility','Mobility',null];
const TUSCANY_W2 = [null,null,null,null,null,null,null];

// Holiday windows — no weekly targets are shown during these.
function isIbiza(dk)   { return dk>='2026-07-10'&&dk<='2026-07-15'; }
function isTuscany(dk) { return dk>='2026-08-22'&&dk<='2026-09-05'; }
function isHoliday(dk) { return isIbiza(dk)||isTuscany(dk); }

// Build the full day-by-day plan from SEASON_START through SEASON_END by applying
// the correct weekly template for each phase, with Ibiza and Tuscany overrides.
// Each planned day is stored with a `sessions` array (the multi-session model).
function buildDefaultPlan() {
  const plan={};
  const d=new Date(2026,5,29);
  while (dateKey(d)<=SEASON_END) {
    const dk=dateKey(d), phase=phaseForDate(dk);
    if (phase) {
      const wd=dow0(d);
      let w=TEMPLATES[phase.name][wd];
      if (isIbiza(dk)) w=null;                                        // Ibiza: rest
      else if (dk>='2026-08-22'&&dk<='2026-08-28') w=TUSCANY_W1[wd];  // Tuscany week 1
      else if (dk>='2026-08-29'&&dk<='2026-09-05') w=TUSCANY_W2[wd];  // Tuscany week 2
      if (w) plan[dk]={ sessions:Array.isArray(w)?w:[w], completed:false, notes:'', feeling:null };
    }
    d.setDate(d.getDate()+1);
  }
  return applyCoachedPlan(applyMatchSchedule(plan).plan).plan;
}

// ─── Session types ──────────────────────────────────────────────────────────────
const TIPS = {
  'Match': { emoji:'⚽', label:'Spieltag', color:'#9CCBD3',
    summary:'Kopf hoch, Schulterblick, klare Entscheidungen – heute zählt es auf dem Platz.',
    done:'Spiel absolviert. Halte deine wichtigsten Entscheidungen und Lernmomente fest.',
    text:'Spieltag. Sei früh da und wärme dich gründlich auf. Orientiere dich vor jedem Ballkontakt – entscheide, bevor du den Ball bekommst. Verteidige zuerst mit dem Kopf.' },
  'Team Training': { emoji:'👥', label:'Mannschaftstraining', color:'#9CCBD3',
    summary:'Abstände, Abstimmung und Orientierung: Schärfe dein Zusammenspiel mit der Mannschaft.',
    done:'Gemeinsam trainiert. Nimm gute Absprachen und klare Laufwege mit ins nächste Spiel.',
    text:'Arbeite an deinem Stellungsspiel und deiner Kommunikation. Übe den Schulterblick konsequent, damit du dich auch im Spiel vor der Ballannahme automatisch orientierst.' },
  'Futsal': { emoji:'⚽', label:'Freizeitkick/Futsal', color:'#9CCBD3',
    summary:'Zusätzliche Ballkontakte, enge Räume, schnelle Entscheidungen – frei vom Liga-Alltag.',
    done:'Zusätzliche Ballkontakte gesammelt. Was hat beim ersten Kontakt besonders gut funktioniert?',
    text:'Schnelles Spiel, wenig Raum. Ideal für den ersten Kontakt und schnelle Entscheidungen – ob in der Halle oder beim Freizeitkick draussen. Schau dich vor der Ballannahme kurz um.' },
  'Gym': { emoji:'🏋️', label:'Krafttraining', color:'#9CCBD3',
    summary:'Baue Kraft und Explosivität für Zweikämpfe, Antritte und einen belastbaren Körper auf.',
    done:'Krafttraining erledigt. Ein weiterer Baustein für stabile Zweikämpfe und explosive Antritte.',
    text:'Krafttraining für den ganzen Körper. Aktiviere beim Aufwärmen den mittleren Gesässmuskel und arbeite an deiner Hüftstabilität. Zwei Einheiten pro Woche – Regelmässigkeit macht den Unterschied.' },
  'Pilates': { emoji:'🤸', label:'Pilates', color:'#B3DCE2',
    summary:'Rumpfkontrolle, Haltung und Hüftstabilität – die Basis für saubere Bewegungen.',
    done:'Rumpf und Bewegungskontrolle trainiert. Diese Basis begleitet dich auf den Platz.',
    text:'Rumpfkraft, Stabilität und Haltung. Besonders wichtig für eine stabile Hüfte und langfristige Belastbarkeit. Diese Einheit gehört zu deiner Verletzungsprävention.' },
  'Mobility': { emoji:'🦵', label:'Prävention/Reha', color:'#B3DCE2',
    summary:'Stärke gezielt belastete Bereiche und schliesse mit Mobilität ab.',
    done:'Gezielt an Belastbarkeit und Beweglichkeit gearbeitet. Bleib regelmässig dran.',
    text:'Stärke, was Fussball überlastet: den mittleren Gesässmuskel links und die innere Muskelkette rechts. Zum Abschluss Mobilität. Zweimal pro Woche – damit du Beschwerden nicht nur verwaltest, sondern langfristig hinter dir lässt.' },
  'Easy run': { emoji:'🏃', label:'Lockerer Lauf', color:'#B3DCE2',
    summary:'Locker laufen, ruhig atmen – heute geht es um aktive Erholung.',
    done:'Locker bewegt. Lass die Erholung weiterwirken und halte die restliche Belastung gering.',
    text:'Nur lockeres Tempo. Das ist aktive Erholung, kein Konditionstraining. Halte den Lauf kurz und so entspannt, dass du dich dabei unterhalten kannst.' },
  'Walking': { emoji:'🚶', label:'Spazieren', color:'#B3DCE2',
    summary:'Bewegung ohne Trainingsdruck – komm an die Luft und lass den Körper erholen.',
    done:'Bewegung und Erholung verbunden. Auch diese ruhigen Einheiten zählen.',
    text:'Aktive Erholung. Bleib in Bewegung, ohne den Körper zusätzlich zu belasten.' },
  'Sick/Injured': { emoji:'🤒', label:'Krank/verletzt', color:'#B3DCE2',
    summary:'Heute hat Erholung Vorrang. Gib deinem Körper die nötige Ruhe.',
    done:'Erholung dokumentiert. Der Wiedereinstieg darf warten, bis du wieder bereit bist.',
    text:'Nimm Beschwerden ernst und hole dir bei anhaltenden Schmerzen oder Unsicherheit fachlichen Rat. Heute musst du keine Trainingsziele erfüllen.' },
};

function getTip(workout) {
  if (!workout) return null;
  if (TIPS[workout]) return TIPS[workout];
  const w=workout.toLowerCase();
  if (w.includes('match')) return TIPS['Match'];
  if (w.includes('team training')) return TIPS['Team Training'];
  if (w.includes('futsal')) return TIPS['Futsal'];
  if (w.includes('gym')) return TIPS['Gym'];
  if (w.includes('mobility')) return TIPS['Mobility'];
  if (w.includes('pilates')) return TIPS['Pilates'];
  if (w.includes('easy run')) return TIPS['Easy run'];
  if (w.includes('walking')) return TIPS['Walking'];
  return null;
}

// Emoji for a session label (also covers swapped / non-template sessions).
// Pitch sessions: Match and Pickup/Futsal both read as ⚽; Team Training is 👥.
const EMOJI = {
  'Match':'⚽','Team Training':'👥','Futsal':'⚽','Gym':'🏋️',
  'Pilates':'🤸','Mobility':'🦵','Walking':'🚶','Easy run':'🏃','Sick/Injured':'🤒',
};
function sessionEmoji(w) {
  if (!w || !w.trim()) return '';
  if (EMOJI[w]) return EMOJI[w];
  if (w.startsWith('⋯')) return '⋯';
  for (const k in EMOJI) if (w.includes(k)) return EMOJI[k];
  return '⚡';
}

// ─── Multi-session model ─────────────────────────────────────────────────────────
// A day's entry holds one or two sessions in a `sessions` array. Legacy entries
// (and the generated plan) carry a single `workout` string — read both shapes
// through getSessions so old localStorage data keeps working.
function getSessions(e) {
  if (!e) return [];
  if (Array.isArray(e.sessions)) return e.sessions.filter(s=>typeof s==="string"&&s.trim());
  if (typeof e.workout==="string" && e.workout.trim()) return [e.workout.trim()];
  return [];
}
// Display-only localization. Internal IDs and user-written session names remain unchanged.
const TYPE_LABELS = {
  'Match':'Spiel', 'Team Training':'Mannschaftstraining', 'Futsal':'Freizeitkick/Futsal',
  'Gym':'Krafttraining', 'Mobility':'Prävention/Reha', 'Pilates':'Pilates',
  'Walking':'Spazieren', 'Easy run':'Lockerer Lauf', 'Sick/Injured':'Krank/verletzt',
};
function displayName(type) { return TYPE_LABELS[type] || type; }
function sessionsLabel(e) { return getSessions(e).map(displayName).join(' + '); }
function sessionsEmojiStr(e) { return getSessions(e).map(sessionEmoji).join(''); }

// Short card copy is derived from all selected types, never stored in the plan.
function sessionSubtitle(entry) {
  const sessions=getSessions(entry);
  if (!sessions.length) return 'Erholung gehört zum Training.';
  if (sessions.length===2&&sessions.includes('Gym')&&sessions.includes('Mobility')) {
    return entry.completed
      ? 'Kraft und Stabilität trainiert, mit Mobilität abgeschlossen – ein kompletter Aufbau-Tag.'
      : 'Kraft aufbauen, gezielt stabilisieren – und mit Mobilität abschliessen.';
  }
  return sessions.map(type=>{
    const tip=TIPS[type];
    if (tip) return entry.completed?tip.done:tip.summary;
    return entry.completed
      ? '«'+displayName(type)+'» erledigt. Halte fest, was du aus dieser Einheit mitnimmst.'
      : '«'+displayName(type)+'»: Setze dir einen klaren Schwerpunkt für diese Einheit.';
  }).join(' ');
}


// The next scheduled non-rest session after the date being viewed.
function nextUp(plan,from=todayStr()) {
  const d=new Date(from+'T12:00:00');
  for (let i=1;i<=120;i++) {
    d.setDate(d.getDate()+1);
    const dk=dateKey(d);
    if (getSessions(plan[dk]).length>0||plan[dk]?.match) {
      const day=new Date(dk+"T00:00:00");
      const when=i===1?'morgen'
        :i<=6?day.toLocaleDateString('de-CH',{weekday:'long'})
        :day.toLocaleDateString('de-CH',{month:'short',day:'numeric'});
      return { label:plan[dk].match?"Spiel gegen "+plan[dk].match.opponent:sessionsLabel(plan[dk]), when:plan[dk].match?when+" · "+matchVenue(plan[dk].match)+" · "+plan[dk].match.kickoff+" Uhr":when };
    }
  }
  return null;
}

// Goals are independent of the existing calendar: two gym sessions in every
// active phase. Do not rewrite saved plans or silently schedule an extra session.
const PHASE_TARGETS = {
  'Off-Season':    { Gym:2, Mobility:2 },
  'Pre-Season':    { Gym:2, Mobility:2 },
  'Autumn Season': { Gym:2, Mobility:2 },
  'Winter Break':  { Gym:2, Mobility:2 },
  'Spring Season': { Gym:2, Mobility:2 },
  'Summer Break':  {},
};


// Bottom-sheet options. Every change is a draft until Save, including Ruhetag.
const ALTS = [
  { emoji:'⚽', label:'Match' },
  { emoji:'👥', label:'Team Training' },
  { emoji:'⚽', label:'Futsal' },
  { emoji:'🏋️', label:'Gym' },
  { emoji:'🤸', label:'Pilates' },
  { emoji:'🦵', label:'Mobility' },
  { emoji:'🚶', label:'Walking' },
  { emoji:'🏃', label:'Easy run' },
  { emoji:'🤒', label:'Sick/Injured' },
];

const FEELINGS = [
  { value:1, emoji:"😫", label:"Erschöpft" },
  { value:2, emoji:"😕", label:"Anstrengend" },
  { value:3, emoji:"😐", label:"In Ordnung" },
  { value:4, emoji:"😊", label:"Gut" },
  { value:5, emoji:"🔥", label:"In Topform" },
];


// ─── Tactical prompt of the week ─────────────────────────────────────────────────
const TACTICAL_PROMPTS = [
  { focus:'Vor jedem Ballkontakt orientieren', detail:'Wisse schon vor der Ballannahme, was du als Nächstes tust. Kopf hoch und über beide Schultern schauen.' },
  { focus:'Einen starken Rechtsverteidiger beobachten', detail:'Schau dir zehn Minuten von Trent Alexander-Arnold oder Reece James an. Achte auf ihr Stellungsspiel, bevor der Ball ankommt.' },
  { focus:'Früh kommunizieren', detail:'Fordere den Ball oder gib Hinweise, bevor sich die Situation entwickelt. Sei auf dem Platz hörbar.' },
  { focus:'Die Abwehrkette kompakt halten', detail:'Prüfe deinen Abstand zum Innenverteidiger. Lass keine Lücken und verenge die Räume frühzeitig.' },
  { focus:'Zweite Bälle entschlossen gewinnen', detail:'Sei zuerst am freien Ball. Nutze deine Athletik, um zweite Bälle für deine Mannschaft zu gewinnen.' },
  { focus:'Das Spiel kurz nachbereiten', detail:'Notiere nach dem nächsten Spiel zwei Situationen, in denen du dich gut vororientiert hast, und eine, in der es gefehlt hat.' },
  { focus:'Den ersten Kontakt bewusst lenken', detail:'Dein erster Kontakt soll dich vom Druck wegführen. Übe, den Ball mit offener Körperstellung mitzunehmen.' },
  { focus:'Sofort zurückarbeiten', detail:'Sei nach einem Ballverlust der erste Verteidiger. Sprinte sofort zurück in deine Position.' },
  { focus:'Vorausahnen statt nur reagieren', detail:'Lies die Körperstellung des Stürmers vor seiner Ballannahme. Entscheide dich früh für deine Position.' },
  { focus:'Eigene Spielszenen ansehen', detail:'Schau dir diese Woche fünf Minuten deiner eigenen Spielaufnahmen an. Achte dabei nur auf dein Stellungsspiel.' },
];


// Week index counted from the season-start Monday; rotates every Monday.
function weekIndexFor(dk) {
  const start=new Date(2026,5,29);
  const d=new Date(dk+"T00:00:00"); d.setDate(d.getDate()-dow0(d)); // Monday of dk's week
  return Math.round((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(start.getFullYear(),start.getMonth(),start.getDate()))/(7*86400000));
}
function tacticalFor(dk) {
  const len=TACTICAL_PROMPTS.length;
  return TACTICAL_PROMPTS[((weekIndexFor(dk)%len)+len)%len];
}

// ─── Milestone celebrations ──────────────────────────────────────────────────────
// check(all, entry, phase) → boolean. `all` is every completed day
// ({...entry, date, phase, sessions}); `entry` is the just-logged one. Each day's
// `sessions` array may hold one or two types. One milestone fires per log.
const MILESTONES = [
  { id:'first-session', check:(all)=>all.length===1,
    emoji:'⚽', title:"Erste Einheit eingetragen!",
    message:"Jeder gute Spieler hat irgendwann angefangen. Das ist dein Anfang." },
  { id:'first-match', check:(all,entry)=>entry.sessions.includes('Match')&&all.filter(e=>e.sessions.includes('Match')).length===1,
    emoji:'🏟️', title:"Erstes Spiel eingetragen!",
    message:"Anpfiff. Dafür trainierst du." },
  { id:'first-gym-week', check:(all)=>all.filter(e=>e.sessions.includes('Gym')).length===2,
    emoji:'🏋️', title:"Zweimal Krafttraining geschafft!",
    message:"Zwei Krafteinheiten eingetragen. Mit Regelmässigkeit legst du die Grundlage für Fortschritt." },
  { id:'sessions-10', check:(all)=>all.length===10,
    emoji:'🔟', title:"10 Einheiten eingetragen!",
    message:"Zehn Einheiten geschafft. Deine Gewohnheit wächst." },
  { id:'sessions-25', check:(all)=>all.length===25,
    emoji:'💪', title:"25 Einheiten!",
    message:"Dranbleiben ist die schwierigste Disziplin. Du wirst darin immer besser." },
  { id:'sessions-50', check:(all)=>all.length===50,
    emoji:'🌟', title:"50 Einheiten eingetragen!",
    message:"50 Einheiten. Das ist keine kurze Phase mehr – Training gehört zu deinem Alltag." },
  { id:'first-preseason', check:(all,entry,phase)=>phase==='Pre-Season'&&all.filter(e=>e.phase==='Pre-Season').length===1,
    emoji:'🚀', title:"Die Vorbereitung beginnt!",
    message:"Deine Arbeit in der Saisonpause beginnt sich auszuzahlen." },
  { id:'first-match-season', check:(all,entry,phase)=>phase==='Autumn Season'&&all.filter(e=>e.sessions.includes('Match')&&e.phase==='Autumn Season').length===1,
    emoji:'🏆', title:"Erstes Saisonspiel!",
    message:"Die Saison läuft. Jetzt bringst du deine erarbeitete Grundlage auf den Platz." },
  { id:'gym-streak-4', check:(all)=>all.filter(e=>e.sessions.includes('Gym')).length>=8,
    emoji:'🔥', title:"Acht Krafteinheiten geschafft!",
    message:"Achtmal an deiner Kraft gearbeitet. Mach weiter und bleib regelmässig dran." },
];

// Fresh, bounded context on every send. Never include storage archives or retired check-ins.
function coachText(value,max=1200) {
  if(typeof value!=='string')return null;
  const text=value.trim();
  return text.length>max?text.slice(0,max)+' … [gekürzt]':text||null;
}
function validCoachDate(dk) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dk)&&dateKey(new Date(dk+'T12:00:00'))===dk;
}
function buildCoachContext(plan,playerName,viewKey,referenceDate=todayStr()) {
  const dates=Object.keys(plan).filter(dk=>validCoachDate(dk)&&plan[dk]&&typeof plan[dk]==='object').sort();
  const types=dk=>[...new Set(getSessions(plan[dk]))];
  const logged=dk=>dk<=referenceDate&&plan[dk]?.completed===true&&types(dk).length>0;
  const day=dk=>{
    const e=plan[dk]||{},sessions=types(dk),guidance=coachingFor(e);
    return {date:dk,sessions:sessions.map(displayName),
      status:logged(dk)?'logged':sessions.length?(dk<referenceDate?'not_logged':'planned'):plan[dk]?'rest':'no_entry',
      feeling:logged(dk)?FEELINGS.find(f=>f.value===e.feeling)?.label||null:null,
      notes:coachText(e.notes),
      guidance:guidance?{title:coachText(guidance.title,150),text:coachText(guidance.text,900)}:null,
      match:isMatchDay(e)?{opponent:coachText(e.match?.opponent,180),venue:e.match?matchVenue(e.match):null,
        kickoff:coachText(e.match?.kickoff,5),timezone:'Europe/Zurich',
        participation:logged(dk)&&sessions.includes('Match')?'logged':'not_recorded'}:null};
  };
  const stats=(from,to)=>{
    const keys=dates.filter(dk=>dk>=from&&dk<=to),done=keys.filter(logged);
    const byType={};
    for(const dk of done)for(const type of types(dk)){const label=displayName(type);byType[label]=(byType[label]||0)+1;}
    return {from,to,plannedDays:keys.filter(dk=>types(dk).length).length,loggedDays:done.length,
      notLoggedPastDays:keys.filter(dk=>dk<referenceDate&&types(dk).length&&!logged(dk)).length,
      loggedSessions:done.reduce((n,dk)=>n+types(dk).length,0),byType};
  };
  const weekDays=weekAround(referenceDate),phase=phaseForDate(referenceDate);
  const next=phase?PHASES[PHASES.indexOf(phase)+1]:null;
  const phaseEnd=next?.start||phase?.end;
  const dayDistance=dk=>{
    const utc=s=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d);};
    return (utc(dk)-utc(referenceDate))/86400000;
  };
  const goals=isHoliday(referenceDate)?{}:PHASE_TARGETS[phase?.name]||{};
  const targets=Object.entries(goals).map(([type,goal])=>({type:displayName(type),goal,
    done:weekDays.filter(dk=>logged(dk)&&types(dk).includes(type)).length,
    planned:weekDays.filter(dk=>types(dk).includes(type)).length}));
  const bodyMetric=field=>{
    const readings=dates.filter(dk=>dk<=referenceDate).map(date=>({date,value:plan[date][field]}))
      .filter(r=>typeof r.value==='number'&&Number.isFinite(r.value)&&r.value>0&&(field==='weight'?r.value<=500:r.value<100));
    const average=(from,to)=>{const points=readings.filter(r=>r.date>=from&&r.date<=to);
      return {from,to,count:points.length,value:points.length?Math.round(points.reduce((n,r)=>n+r.value,0)/points.length*100)/100:null};};
    return {unit:field==='weight'?'kg':'%',latest:readings.at(-1)||null,
      last7Days:average(daysBeforeStr(referenceDate,6),referenceDate),
      previous7Days:average(daysBeforeStr(referenceDate,13),daysBeforeStr(referenceDate,7))};
  };
  const nextMatchDate=dates.find(dk=>dk>=referenceDate&&isMatchDay(plan[dk])&&!(logged(dk)&&types(dk).includes('Match')));
  return {schemaVersion:2,referenceDate,timezone:'Europe/Zurich',playerName:coachText(playerName,100),
    phase:phase?{name:phaseLabel(phase.name),description:phase.description}:null,
    nextPhase:next?phaseLabel(next.name):null,daysToNextPhase:phaseEnd?dayDistance(phaseEnd):null,
    today:day(referenceDate),selectedDay:viewKey!==referenceDate?day(viewKey):null,
    recentDays:Array.from({length:14},(_,i)=>day(daysBeforeStr(referenceDate,14-i))),
    upcoming:Array.from({length:7},(_,i)=>day(daysBeforeStr(referenceDate,-i-1))),
    nextMatch:nextMatchDate?{...day(nextMatchDate),daysAway:dayDistance(nextMatchDate)}:null,
    week:{...stats(weekDays[0],weekDays[6]),targets},
    history:{allTime:stats(dates[0]&&dates[0]<referenceDate?dates[0]:referenceDate,referenceDate),
      last8Weeks:Array.from({length:8},(_,i)=>{const from=daysBeforeStr(weekDays[0],(8-i)*7);return stats(from,daysBeforeStr(from,-6));})},
    body:{weight:bodyMetric('weight'),bodyFat:bodyMetric('bodyFat')},tactical:tacticalFor(referenceDate)};
}

// Midnight & Ice. Legacy token aliases keep every existing view on one palette.
const C = {
  bg:"#101A25", card:"#1C2937", surface:"#1C2937",
  border:"#344858", borderSt:"#647F93",
  text:"#EDF2F5", muted:"#A5B8C8",
  sage:"#9CCBD3", sageLt:"rgba(156,203,211,.10)", sageDk:"#B3DCE2",
  warm:"#344858", done:"#9CCBD3", doneLt:"rgba(156,203,211,.08)",
  accent:"#9CCBD3", subtle:"#243746", ink:"#101A25",
};
const PHASE_LABELS = {"Off-Season":"Saisonpause","Pre-Season":"Vorbereitung","Autumn Season":"Herbstsaison","Winter Break":"Winterpause","Spring Season":"Frühlingssaison","Summer Break":"Sommerpause"};
const phaseLabel = p => PHASE_LABELS[p] || p;
const shortDate = dk => new Date(dk+"T12:00:00").toLocaleDateString("de-CH",{day:"numeric",month:"short"});
function weekAround(dk) {
  const d=new Date(dk+"T12:00:00"); d.setDate(d.getDate()-dow0(d));
  return Array.from({length:7},(_,i)=>{const n=new Date(d);n.setDate(d.getDate()+i);return dateKey(n);});
}
function Icon({name,size=22,...props}) {
  const paths={
    today:<><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,
    week:<><path d="M4 21V12h3v9M11 21V3h3v18M18 21V8h3v13"/></>,
    month:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
    journey:<><path d="m2 21 8-17 5 10 3-5 5 12z"/><path d="m7 11 3 3 3-3"/></>,
    edit:<><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/></>,
    note:<><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5"/></>,
    coach:<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/>,
    arrow:<path d="m7 17 10-10M7 7h10v10"/>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    swap:<path d="M7 20V4m-4 4 4-4 4 4M17 4v16m-4-4 4 4 4-4"/>,
    Gym:<><path d="m6 9 12 6M3 7l-2 5 4 2 3-7-4-2-1 2M21 17l2-5-4-2-3 7 4 2 1-2"/></>,
    Mobility:<><circle cx="14" cy="4" r="2"/><path d="m9 8 5 1 4-2M14 9l-3 6 6 6M11 15l-5 5M10 8 6 12"/></>,
    ball:<><circle cx="12" cy="12" r="9"/><path d="m12 7 5 4-2 5H9l-2-5zM12 3v4M3 10l4 1M6 19l3-3M18 19l-3-3M21 10l-4 1"/></>,
    "Team Training":<><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/></>,
    rest:<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="m9 2-1 3-3 1-3 3 2 3-2 3 3 3 3 1 1 3h6l1-3 3-1 3-3-2-3 2-3-3-3-3-1-1-3z"/></>,
    focus:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 9-9"/></>,
  };
  const resolved=name==="Match"||name==="Futsal"?"ball":name==="Walking"||name==="Easy run"||name==="Pilates"?"Mobility":name==="Sick/Injured"?"rest":name;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[resolved]||paths.Mobility}</svg>;
}
function SessionMarks({entry,size=16}) {
  return <span className="session-marks">{getSessions(entry).map(s=><Icon key={s} name={s} size={size}/>)}</span>;
}
function PitchTexture() {
  return <svg className="pitch-texture" viewBox="0 0 500 300" fill="none" aria-hidden="true">
    <g transform="translate(270 -95) rotate(28)" stroke="currentColor" strokeWidth="1">
      <rect x="0" y="0" width="220" height="340" rx="2"/><path d="M0 170h220"/>
      <circle cx="110" cy="170" r="38"/><path d="M45 0v65h130V0M45 340v-65h130v65"/>
    </g></svg>;
}
const UI_CSS = `
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101A25;color:#EDF2F5;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button{color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:disabled{cursor:default;opacity:.45}button:not(:disabled):active{transform:scale(.98)}button{transition:background .18s,border-color .18s,transform .15s}
input,textarea{min-width:0;font-size:16px!important}input::placeholder,textarea::placeholder{color:#839BAD}
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #B3DCE2!important;outline-offset:4px}
button,a,input,summary{touch-action:manipulation}h1,h2,h3,p{margin:0}h1,h2,h3{font-weight:600;letter-spacing:-.035em}
.app-shell{max-width:560px;margin:auto;min-height:100dvh;background:radial-gradient(ellipse 100% 500px at 80% 0%,#223B50 0%,#101A25 85%);padding-bottom:calc(96px + env(safe-area-inset-bottom))}
.app-header{position:relative;isolation:isolate;overflow:hidden;padding:calc(22px + env(safe-area-inset-top)) 22px 18px}
.pitch-texture{position:absolute;inset:0;width:100%;height:100%;color:#9CCBD3;opacity:.14;z-index:-1;pointer-events:none}
.brand-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}
.brand{font-size:10px;letter-spacing:.26em;color:#B3DCE2;font-weight:600}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:0;border-radius:12px;background:transparent;color:#A5B8C8}
.app-header h1{font-size:clamp(34px,9vw,46px);line-height:1.1;margin-bottom:10px;letter-spacing:-.055em}
.subtitle{color:#A5B8C8;font-size:15px;line-height:1.5}
.phase-link{display:inline-flex;gap:8px;align-items:center;color:#A5B8C8;background:none;border:0;padding:4px 0;min-height:44px;font-size:12px}
.view{padding:0 20px 24px}.eyebrow{font-size:10px;letter-spacing:.17em;text-transform:uppercase;color:#B3DCE2;font-weight:600}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 0 14px}.section-heading h2{font-size:20px}.section-heading small{font-size:11px;color:#A5B8C8}
.panel{background:linear-gradient(135deg,#1C2C3A,#192632);border:1px solid #2A3C4B;border-radius:22px}
.day-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin:8px 0 20px}
.day-chip{border:1px solid transparent;background:transparent;border-radius:16px;padding:12px 0 9px;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px}
.day-chip .day-label{font-size:10px;text-transform:uppercase;color:#A5B8C8;letter-spacing:.06em}
.day-chip strong{font-size:20px;font-weight:500}.day-chip[aria-pressed=true]{background:#9CCBD3;color:#101A25}
.day-chip[aria-pressed=true] .day-label{color:#233B47}.day-marker{height:5px;width:5px;border-radius:50%;background:#577184}.day-chip[aria-pressed=true] .day-marker{background:#274854}
.session-card{padding:23px 20px;position:relative;overflow:hidden}.session-card h2{font-size:clamp(26px,7.2vw,36px);line-height:1.12;margin:20px 0 12px;max-width:95%;overflow-wrap:anywhere}
.session-sub{font-size:14px;color:#A5B8C8;line-height:1.6}.session-card-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.session-art{color:#9CCBD3;opacity:.65;display:flex;gap:5px}.session-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:22px}
.action-links{display:flex;gap:8px;flex-wrap:wrap}.text-btn{display:inline-flex;gap:8px;align-items:center;min-height:44px;padding:6px 0;border:0;background:transparent;color:#A5B8C8;font-size:12px}
.log-circle{width:78px;height:78px;flex-shrink:0;border-radius:50%;border:2px solid #9CCBD3;background:transparent;color:#B3DCE2;font-size:13px;letter-spacing:.1em;font-weight:700;display:flex;align-items:center;justify-content:center}
.log-circle.logged{background:#9CCBD3;color:#101A25;animation:checkPop .3s ease-out}
.session-details{border-top:1px solid #344858;margin-top:20px;padding-top:4px}.session-details summary{font-size:12px;color:#A5B8C8;cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between}
.session-details summary:after{content:"+";font-size:18px}.session-details[open] summary:after{content:"−"}
.notes{width:100%;padding:12px;background:#101A25;color:#EDF2F5;border:1px solid #344858;border-radius:12px;margin-top:12px;line-height:1.5}
.target-panel{padding:0 18px}.target-row{display:flex;align-items:center;gap:14px;padding:18px 0}.target-row+.target-row{border-top:1px solid #344858}
.target-content{flex:1;min-width:0}.target-label{display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:11px}.target-label span:last-child{font-variant-numeric:tabular-nums;color:#B3DCE2}
.target-track{display:flex;gap:5px}.target-segment{height:9px;border:1px solid #486171;border-radius:20px;flex:1;background:#263C4D}.target-segment.filled{background:#9CCBD3;border-color:#9CCBD3}
.next-line{display:flex;align-items:center;gap:12px;font-size:12px;color:#A5B8C8;padding:21px 4px}
.focus-card{padding:21px;margin:0 0 18px;position:relative}.focus-card:before{content:"";position:absolute;top:23px;bottom:23px;left:0;background:#9CCBD3;width:3px;border-radius:5px}
.focus-card h3{font-size:19px;line-height:1.3;margin:10px 0}.focus-card p{color:#A5B8C8;font-size:13px;line-height:1.65}
.coach-entry{display:flex;align-items:center;justify-content:space-between;width:100%;border:1px solid #789BAF;border-radius:16px;background:transparent;color:#B3DCE2;padding:12px 16px;min-height:48px;font-size:14px}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:560px;z-index:40;display:flex;gap:4px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(16,26,37,.95);backdrop-filter:blur(18px);border-top:1px solid #344858}
.nav button{flex:1;min-width:0;min-height:56px;background:none;border:0;color:#A5B8C8;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:10px}
.nav button[aria-current=page]{color:#B3DCE2;background:rgba(156,203,211,.08)}.nav button[aria-current=page] svg{stroke-width:2}
.session-marks{display:inline-flex;align-items:center;justify-content:center;gap:3px;vertical-align:middle;color:#9CCBD3}
.primary{background:#9CCBD3;color:#101A25;border:0;border-radius:14px;min-height:48px;padding:12px 18px;font-weight:600}
.secondary{background:transparent;color:#B3DCE2;border:1px solid #486171;border-radius:14px;min-height:48px;padding:12px 18px}
.range-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:20px}.range-nav>div{text-align:center;min-width:0;display:flex;flex-direction:column;align-items:center}.range-nav strong{display:block;font-size:16px;font-weight:500}.range-nav small{display:block;color:#A5B8C8;font-size:12px;margin-top:5px}
.week-row{display:flex;align-items:center;gap:4px;border-bottom:1px solid #2D4151;padding:7px 0}.week-row:first-child{border-top:1px solid #2D4151}
.week-open{min-width:0;flex:1;display:flex;align-items:center;gap:14px;text-align:left;border:0;background:transparent;padding:12px 0;min-height:70px}
.date-tile{flex-shrink:0;text-align:center;width:42px;color:#A5B8C8}.date-tile small{display:block;font-size:10px;margin-bottom:5px}.date-tile strong{font-size:22px;font-weight:400}
.week-info{flex:1;min-width:0}.week-info strong{display:block;font-size:14px;line-height:1.4;font-weight:500}.week-info small{display:flex;gap:6px;align-items:center;margin-top:5px;color:#A5B8C8;font-size:11px}
.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.calendar button{min-width:0;min-height:57px;border:1px solid transparent;border-radius:13px;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;position:relative;font-size:14px}
.calendar button.planned{background:#1C2937}.calendar button.done{border-color:#769CA9;background:#203944}.calendar button.today{outline:2px solid #9CCBD3;outline-offset:-2}.calendar-label{text-align:center;font-size:10px;color:#A5B8C8;padding:10px 0}
.done-dot{position:absolute;right:3px;top:3px;color:#9CCBD3}.legend{display:flex;flex-wrap:wrap;gap:16px;margin:18px 0;color:#A5B8C8;font-size:11px}.legend span{display:flex;align-items:center;gap:6px}
.journey-summary{padding:22px;margin-bottom:22px}.journey-summary strong{font-size:42px;letter-spacing:-.06em;font-weight:500;display:block;margin:12px 0 3px}
.phase-item{position:relative;padding:0 0 24px 23px;border-left:1px solid #344858;margin-left:5px}.phase-item:before{content:"";position:absolute;left:-5px;top:14px;width:9px;height:9px;border-radius:50%;background:#344858;border:2px solid #101A25}
.phase-item.current:before{background:#9CCBD3;box-shadow:0 0 0 4px rgba(156,203,211,.1)}.phase-item button{width:100%;text-align:left;background:none;border:0;padding:10px 0;color:#A5B8C8}
.phase-item.current button{background:#1C2937;border:1px solid #648694;border-radius:18px;padding:18px}.phase-item h3{font-size:20px;color:#EDF2F5;margin:8px 0}.phase-item p{font-size:13px;line-height:1.6;margin-top:10px}.phase-item small{font-size:11px}
.sheet-backdrop{position:fixed;inset:0;z-index:50;background:rgba(4,10,17,.75);backdrop-filter:blur(5px)}.sheet{position:fixed;left:50%;transform:translateX(-50%);bottom:0;z-index:51;width:100%;max-width:560px;max-height:90dvh;overflow:auto;background:#1C2937;border:1px solid #344858;border-radius:26px 26px 0 0;padding:12px 20px calc(24px + env(safe-area-inset-bottom));box-shadow:0 -12px 70px #0006}
.sheet-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.sheet h2{font-size:22px}.sheet-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:20px 0}
.session-option{position:relative;min-height:90px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;border-radius:14px;border:1px solid #344858;background:#15222F;color:#A5B8C8;padding:12px 5px;font-size:11px;overflow-wrap:anywhere;hyphens:auto}
.session-option[aria-pressed=true]{border-color:#9CCBD3;background:#29424E;color:#EDF2F5}.sheet-footer{display:flex;gap:12px;margin-top:12px}.sheet-footer>*{flex:1}
.modal-input{width:100%;background:#101A25;color:#EDF2F5;border:1px solid #486171;border-radius:12px;padding:14px;margin:12px 0}
.toast{position:fixed;top:calc(14px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:max-content;max-width:90vw;z-index:80;background:#29424E;color:#EDF2F5;border:1px solid #9CCBD3;border-radius:16px;padding:14px 20px;box-shadow:0 10px 40px #0006}
@keyframes enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.view{animation:enter .25s ease-out}
@keyframes checkPop{50%{transform:scale(1.08)}}@media(min-width:600px){.app-shell{border-left:1px solid #263C4D;border-right:1px solid #263C4D}.view{padding-left:26px;padding-right:26px}.app-header{padding-left:28px;padding-right:28px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
.header-subtitle{color:#A5B8C8;font-size:15px;line-height:1.6}.app-header h1{white-space:pre-line}
.day-chip small{font-size:10px;color:#A5B8C8;letter-spacing:.06em}.day-chip[aria-pressed=true] small{color:#233B47}
.day-marker{height:12px;width:auto;min-width:5px;background:none!important;font-size:14px;line-height:10px}
.session-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.session-subtitle{font-size:13px;color:#A5B8C8;line-height:1.6}
.session-actions>div{display:flex;gap:12px;flex-wrap:wrap}.session-actions .text-btn{font-size:11px}
.notes{background:transparent;padding:0;border:0}.notes textarea{width:100%;display:block;margin-top:10px;padding:12px;color:#EDF2F5;background:#101A25;border:1px solid #486171;border-radius:12px;resize:vertical}
.saved-note{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6;color:#A5B8C8;border-top:1px solid #344858;padding-top:16px;margin-top:16px}
.inline-confirm{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid #344858;margin-top:16px;font-size:13px}
.feeling-row{border-top:1px solid #344858;margin-top:20px;padding-top:16px;font-size:12px;color:#A5B8C8}
.feeling-row>div{display:flex;gap:6px;margin-top:10px}.feeling-row button{min-width:44px;height:44px;background:transparent;border:1px solid #344858;border-radius:12px;font-size:22px}
.feeling-row button[aria-pressed=true]{border-color:#9CCBD3;background:#29424E}
.next-line{flex-wrap:wrap;gap:5px 10px;line-height:1.6}.next-line strong{font-weight:500;color:#EDF2F5}.next-line>span:last-child{margin-left:auto}
.week-controls{display:flex;flex-direction:column}.week-controls .icon-btn{min-height:36px}.date-tile.current{color:#B3DCE2}
.swap-banner{border:1px solid #648694;background:#203944;border-radius:14px;padding:12px;display:flex;align-items:center;gap:8px;font-size:12px}
.helper-text{font-size:13px;color:#A5B8C8;line-height:1.7;margin:12px 0}.body-entry{margin-top:12px;font-size:12px}
.body-editor{margin-top:16px;padding:18px}.body-fields{display:flex;gap:12px;margin-top:12px}.body-fields label{min-width:0;flex:1;font-size:11px;color:#A5B8C8}
.journey-summary>div:nth-child(2){display:flex;align-items:center;gap:20px}.journey-summary span{font-size:13px;color:#A5B8C8;line-height:1.6}
.journey-summary p{font-size:12px;color:#A5B8C8;margin-top:14px}
progress{width:100%;height:5px;display:block;margin-top:18px;border:0;border-radius:99px;overflow:hidden;background:#344858}
progress::-webkit-progress-bar{background:#344858}progress::-webkit-progress-value{background:#9CCBD3}progress::-moz-progress-bar{background:#9CCBD3}
.section-heading>span{font-size:11px;color:#A5B8C8}
.phase-timeline{padding-left:6px}.phase-item{display:block;width:calc(100% - 5px);text-align:left;color:#A5B8C8;background:transparent;border:0;border-left:1px solid #344858;padding:16px 16px 28px 24px}
.phase-item.current{background:#1C2937;box-shadow:inset 0 0 0 1px #648694;border-radius:0 18px 18px 0;margin-bottom:16px}
.phase-item:before{top:21px}.phase-count{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-size:12px;color:#B3DCE2}
.trend-panel{padding:22px}.metric-switch{display:flex;gap:8px;margin:16px 0}.metric-switch button{padding:10px 16px;min-height:44px;border:1px solid #344858;border-radius:99px;background:transparent;font-size:12px;color:#A5B8C8}
.metric-switch button[aria-pressed=true]{background:#29424E;border-color:#9CCBD3;color:#EDF2F5}.trend-value{font-size:32px;letter-spacing:-.04em}.trend-value span{font-size:16px;color:#A5B8C8}
.chart-caption{font-size:10px;color:#A5B8C8;line-height:1.5;margin-top:10px}
.sheet-handle{width:32px;height:4px;background:#648694;border-radius:4px;margin:0 auto 18px}.sheet h2{margin-top:8px}.option-check{position:absolute;right:7px;top:5px;color:#B3DCE2}
.settings-card{padding:22px}.settings-backup>.secondary{display:block;width:100%;margin-top:12px}.settings-backup{margin-top:30px}
.settings-screen{padding-bottom:calc(40px + env(safe-area-inset-bottom))}.loading-state{padding:80px 24px;color:#A5B8C8;text-align:center}
.milestone-toast{display:flex;align-items:center;gap:12px;max-width:520px;width:90vw}.milestone-toast>span{font-size:26px}.milestone-toast strong{font-size:14px}.milestone-toast p{font-size:12px;line-height:1.6;color:#B6C9D5;margin-top:3px}
@keyframes slideLeft{from{opacity:.3;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@keyframes slideRight{from{opacity:.3;transform:translateX(-16px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:360px){.view{padding-left:14px;padding-right:14px}.session-card{padding:20px 16px}.log-circle{width:68px;height:68px}.session-actions>div{gap:2px;flex-direction:column}.sheet{padding-left:14px;padding-right:14px}.feeling-row>div{gap:3px}}

/* Confirmed games: warm gold, ball + H/A markers, not colour alone. */
.match-card{border-color:#9F8358;background:linear-gradient(135deg,#30302A,#1C2937)}
.fixture-detail{border-bottom:1px solid #76664D;padding-bottom:18px;margin-top:16px}
.fixture-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#F0CF95}
.fixture-meta>strong{font-size:18px;font-variant-numeric:tabular-nums}
.match-badge{display:inline-block;color:#F0CF95;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;line-height:1.5}
.fixture-detail h3{font-size:22px;line-height:1.3;margin:12px 0 6px;overflow-wrap:anywhere}
.fixture-detail p,.fixture-sheet-note{font-size:12px;line-height:1.6;color:#C7BDAB}
.fixture-sheet-note{padding:12px;border:1px solid #9F8358;border-radius:12px;margin-bottom:12px}
.day-chip.match-day:not([aria-pressed=true]){border-color:#9F8358;color:#F0CF95;background:#2C2D29}
.week-row.match-row{border:1px solid #9F8358;border-left:3px solid #E4C18D;border-radius:16px;background:linear-gradient(110deg,#32322B,#1C2937);padding:8px 10px;margin:8px 0}
.match-row .date-tile,.match-row .session-marks{color:#F0CF95}.match-row .match-badge{margin-bottom:5px}.fixture-existing{display:block;font-size:11px;color:#A5B8C8;margin-top:4px}
.calendar button.match-day{background:#403B2D;border:1px solid #D7B580;color:#FFE4B4;gap:4px;min-height:77px}
.calendar button.match-day.done{background:#403B2D}.calendar button.match-day.today{outline:2px solid #B3DCE2}
.calendar-ball{font-size:16px;line-height:1.2}.calendar-kickoff{font-size:9px;font-weight:600;white-space:nowrap;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.match-legend{color:#F0CF95}.fixture-list-item{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:16px 12px;margin-top:10px;border:1px solid #806E50;border-left:3px solid #E4C18D;border-radius:16px;background:#282D2E}
.plan-guidance{border-left:2px solid #9CCBD3;padding:2px 0 2px 12px;margin:16px 0 20px}.plan-guidance strong{display:block;font-size:13px;line-height:1.5;color:#B3DCE2}.plan-guidance p{font-size:12px;line-height:1.6;color:#A5B8C8;margin:6px 0 0}.week-plan-focus{display:block;font-size:11px;line-height:1.5;color:#B3DCE2;margin-top:5px}
.fixture-list-date{flex-shrink:0;width:32px;text-align:center;font-size:10px;color:#F0CF95}.fixture-list-date strong{display:block;font-size:22px;font-weight:500;margin-top:3px}
.fixture-list-item>span:nth-child(2){flex:1;min-width:0}.fixture-list-item>span:nth-child(2)>strong{font-size:14px;font-weight:500;overflow-wrap:anywhere;display:block;line-height:1.4}
.fixture-list-item small{display:block;font-size:12px;color:#C7BDAB;margin-top:5px}.fixture-list-item>svg{flex-shrink:0;color:#F0CF95}
@media(max-width:360px){.calendar-kickoff{font-size:8px}.week-row.match-row{padding-left:4px;padding-right:2px}.match-row .week-open{gap:8px}.fixture-detail h3{font-size:20px}}

`;

// ─── Small chrome ────────────────────────────────────────────────────────────────
function Chk({size=14,color=C.ink}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M3 8.5l3.5 3.5 6.5-7" stroke={color} strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
function NavArrow({onClick,dir}) {
  return (
    <button onClick={onClick} aria-label={dir==="left"?"Zurück":"Weiter"} style={{
      width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",
      background:"none",border:`1px solid ${C.border}`,borderRadius:12,
      cursor:"pointer",color:C.muted,fontSize:20,flexShrink:0,
      WebkitTapHighlightColor:"transparent"}}>{dir==="left"?"‹":"›"}</button>
  );
}
function TabIcon({name,size=23}) { return <Icon name={name} size={size}/>; }


function TipCard({workout}) {
  const tip=getTip(workout);
  if (!tip) return null;
  return (
    <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
      <span style={{display:'inline-block',fontSize:11,fontWeight:700,color:tip.color,
        background:'rgba(156,203,211,0.1)',borderRadius:20,padding:'4px 11px',marginBottom:9}}>
        {tip.emoji} {tip.label}
      </span>
      <p style={{margin:0,fontSize:13,color:C.muted,lineHeight:1.6,letterSpacing:"0.01em"}}>{tip.text}</p>
    </div>
  );
}

// ─── Tactical prompt card ────────────────────────────────────────────────────────
function TacticalCard({dk}) {
  const t=tacticalFor(dk);
  return <section className="panel focus-card"><div className="eyebrow">Dein taktischer Fokus</div>
    <h3>{t.focus}</h3><p>{t.detail}</p></section>;
}

// ─── Setup / settings ────────────────────────────────────────────────────────────
function SetupScreen({initName,isEdit,onBack,onSave}) {
  const [n,setN]=useState(initName||"");
  const ok=n.trim();

  // Backup: export / import all local data.
  const fileRef=useRef(null);
  const [pendingImport,setPendingImport]=useState(null);
  const [importError,setImportError]=useState("");
  const exportData=()=>{
    const coach={};
    Object.keys(localStorage).filter(k=>k.startsWith('coach-')).forEach(k=>{ coach[k]=localStorage.getItem(k); });
    const data={ exportedAt:new Date().toISOString(), version:SK, plan:localStorage.getItem(SK), coach };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url; link.download=`soccer-backup-${new Date().toISOString().slice(0,10)}.json`;
    link.click(); URL.revokeObjectURL(url);
  };
  const onFilePick=(ev)=>{
    const file=ev.target.files&&ev.target.files[0];
    ev.target.value="";
    if (!file) return;
    setImportError("");
    const reader=new FileReader();
    reader.onload=()=>{
      try {
        const parsed=JSON.parse(reader.result);
        if (!parsed||!parsed.plan||!parsed.version) throw new Error("invalid");
        const data=typeof parsed.plan==="string"?JSON.parse(parsed.plan):parsed.plan;
        if(!data||typeof data.playerName!=="string"||!data.plan||typeof data.plan!=="object"||Array.isArray(data.plan))throw new Error("invalid");
        if(Object.values(data.plan).some(e=>!e||typeof e!=="object"||Array.isArray(e)))throw new Error("invalid");
        setPendingImport(parsed);
      } catch(e) { setPendingImport(null); setImportError("Die Sicherung konnte nicht gelesen oder gespeichert werden. Bitte prüfe die Datei und den verfügbaren Speicher."); }
    };
    reader.onerror=()=>{ setPendingImport(null); setImportError("Die Sicherung konnte nicht gelesen oder gespeichert werden. Bitte prüfe die Datei und den verfügbaren Speicher."); };
    reader.readAsText(file);
  };
  const confirmImport=()=>{
    const d=pendingImport;
    if (!d) return;
    try {
      localStorage.setItem(SK, typeof d.plan==='string'?d.plan:JSON.stringify(d.plan));
      if (d.coach&&typeof d.coach==='object') {
        Object.keys(d.coach).forEach(k=>{ if (k.startsWith('coach-')) localStorage.setItem(k, d.coach[k]); });
      }
      try { sessionStorage.setItem('justRestored','1'); } catch {}
      window.location.reload();
    } catch(e) { setPendingImport(null); setImportError("Die Sicherung konnte nicht gelesen oder gespeichert werden. Bitte prüfe die Datei und den verfügbaren Speicher."); }
  };

  return <main className="app-shell settings-screen">
    <header className="app-header"><PitchTexture/><div className="brand-row"><span className="brand">Soccer Tracker</span>
      {onBack&&<button className="icon-btn" aria-label="Zurück" onClick={onBack}><Icon name="close"/></button>}</div>
      <h1>{isEdit?"Dein Profil.":"Deine Saison.\nDein Fortschritt."}</h1>
      <p className="header-subtitle">{isEdit?"Deine Daten bleiben bei dir.":"Trainiere bewusst. Bleib im Spiel."}</p></header>
    <div className="view"><section className="panel settings-card"><label htmlFor="player-name" className="eyebrow">Wie heißt du?</label>
      <input id="player-name" className="modal-input" autoComplete="given-name" value={n} placeholder="Dein Name" maxLength={80}
        onChange={e=>setN(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&ok)onSave(n.trim());}}/>
      <button className="primary" style={{width:"100%",marginTop:20}} disabled={!ok} onClick={()=>onSave(n.trim())}>{isEdit?"Speichern":"Los geht’s →"}</button>
    </section>
    <section className="settings-backup"><div className="section-heading"><h2>Deine Daten</h2></div>
      <p className="helper-text">Alles wird nur auf diesem Gerät gespeichert. Speichere eine Sicherung zum Beispiel in iCloud Drive.</p>
      {isEdit&&<button className="secondary" onClick={exportData}>Daten exportieren</button>}
      <button className="secondary" onClick={()=>fileRef.current?.click()}>Sicherung wiederherstellen</button>
      <input ref={fileRef} type="file" accept=".json" onChange={onFilePick} hidden/>
      {importError&&<p role="alert" className="helper-text">{importError}</p>}
      {pendingImport&&<div className="panel settings-card" role="alert"><p>Die Sicherung ersetzt die aktuellen Trainingsdaten. Fortfahren?</p>
        <div className="sheet-footer"><button className="secondary" onClick={()=>setPendingImport(null)}>Abbrechen</button><button className="primary" onClick={confirmImport}>Wiederherstellen</button></div></div>}
    </section></div>
  </main>;
}

// ─── Swipe ───────────────────────────────────────────────────────────────────────
function useSwipe(onLeft,onRight) {
  const start=useRef(null);
  return {
    onTouchStart:e=>{start.current=null;if(e.target.closest("button,input,textarea,summary,[role=dialog]"))return;start.current={x:e.touches[0].clientX,y:e.touches[0].clientY};},
    onTouchEnd:e=>{if(!start.current)return;const dx=e.changedTouches[0].clientX-start.current.x,dy=e.changedTouches[0].clientY-start.current.y;
      start.current=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)(dx<0?onLeft:onRight)();},
    onTouchCancel:()=>{start.current=null;}
  };
}

// ─── Workout bottom sheet ────────────────────────────────────────────────────────
// Shared by Today and Week views. Core session types are MULTI-select (tap up to
// two — e.g. "Gym + Mobility"); confirm writes a `sessions` array. Other prompts
// for free text, Rest clears the day — both require Save. Pre-seeds
// the selection from the day's current sessions so editing keeps what's there.
const SHEET_MAX = 2;
function WorkoutSheet({dateKey:dk,entry,updDay,onClose}) {
  const [otherMode,setOtherMode]=useState(false), [otherText,setOtherText]=useState("");
  const [selected,setSelected]=useState(()=>getSessions(entry).slice(0,SHEET_MAX));
  const fixedMatch=!!entry.match&&getSessions(entry).includes("Match");
  const dialog=useRef(null), closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement, overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";dialog.current?.focus();
    const key=ev=>{
      if(ev.key==="Escape"){ev.preventDefault();closeRef.current();return;}
      if(ev.key!=="Tab")return;
      const items=[...dialog.current.querySelectorAll('button:not(:disabled),input,textarea,[tabindex="0"]')];
      const first=items[0],last=items.at(-1);
      if(ev.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){ev.preventDefault();last?.focus();}
      else if(!ev.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){ev.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",key);
    return ()=>{document.body.style.overflow=overflow;document.removeEventListener("keydown",key);previous?.focus();};
  },[]);
  const toggle=label=>setSelected(sel=>sel.includes(label)?sel.filter(s=>s!==label):sel.length<SHEET_MAX?[...sel,label]:sel);
  const save=()=>{
    if(otherMode&&!otherText.trim())return;
    if(fixedMatch&&(otherMode||!selected.includes("Match")))return;
    const sessions=otherMode?["⋯ "+otherText.trim()]:selected;
    updDay(dk,{sessions,workout:"",...(JSON.stringify(sessions)!==JSON.stringify(getSessions(entry))?{coaching:null}:{}),...(!sessions.length?{completed:false,feeling:null}:{})});
    closeRef.current();
  };
  const options=[...ALTS,...selected.filter(s=>!ALTS.some(a=>a.label===s)).map(label=>({label}))];
  return <>
    <div className="sheet-backdrop" onClick={onClose}/>
    <section className="sheet" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1}>
      <div className="sheet-handle"/>
      <div className="sheet-heading"><div><div className="eyebrow">{shortDate(dk)} · Dein Plan</div>
        <h2 id="sheet-title">Was steht an?</h2></div><button className="icon-btn" onClick={onClose} aria-label="Schließen"><Icon name="close"/></button></div>
      {entry.match&&<p className="fixture-sheet-note">⚽ {matchSummary(entry.match)}<br/>Der Spieltermin bleibt an diesem Datum und wird nicht mit Trainingstagen getauscht.</p>}
      {otherMode?<div><label htmlFor="custom-session" className="helper-text">Deine eigene Einheit</label>
        <input id="custom-session" className="modal-input" autoFocus value={otherText} maxLength={100} onChange={e=>setOtherText(e.target.value)}
          placeholder="Zum Beispiel Schwimmen, Physio …" onKeyDown={e=>{if(e.key==="Enter")save();}}/>
        <button className="text-btn" onClick={()=>setOtherMode(false)}>← Zur Auswahl</button></div>
      :<><p className="helper-text">Bis zu zwei Einheiten. Speichern ändert nur den Plan. Über FERTIG trägst du das absolvierte Training ein.</p>
        <div className="sheet-grid">{options.map(opt=><button key={opt.label} className="session-option" onClick={()=>toggle(opt.label)}
          aria-pressed={selected.includes(opt.label)} disabled={(fixedMatch&&opt.label==="Match")||(!selected.includes(opt.label)&&selected.length>=SHEET_MAX)}>
          <Icon name={opt.label} size={25}/><span>{displayName(opt.label)}</span>{selected.includes(opt.label)&&<span className="option-check">✓</span>}
        </button>)}</div>
        <div className="sheet-footer"><button className="secondary" disabled={fixedMatch} onClick={()=>setOtherMode(true)}>Andere Einheit</button>
          <button className="secondary" disabled={fixedMatch} aria-pressed={selected.length===0} onClick={()=>setSelected([])}>Ruhetag</button></div>
      </>}
      <button className="primary" style={{width:"100%",marginTop:16}} onClick={save} disabled={otherMode&&!otherText.trim()}>
        Speichern{!otherMode&&!selected.length?" · Ruhetag":""}
      </button>
    </section>
  </>;
}

// ─── Weekly targets ──────────────────────────────────────────────────────────────
// Priority session types for the current phase (Gym + Mobility, 2×/week each).
// Each session in a day's array counts once toward its own target — no double count.
function WeeklyTargets({plan,date=todayStr()}) {
  const phase=phaseForDate(date),days=weekAround(date);
  const targets=phase?PHASE_TARGETS[phase.name]:null;
  if(isHoliday(date)||!targets||!Object.keys(targets).length)return null;
  const counts={};
  days.forEach(dk=>{if(plan[dk]?.completed)new Set(getSessions(plan[dk])).forEach(s=>{counts[s]=(counts[s]||0)+1;});});
  return <section aria-label="Wochenziele">
    <div className="section-heading"><h2>Wochenziele</h2><small>{shortDate(days[0])} – {shortDate(days[6])}</small></div>
    <div className="panel target-panel">{Object.entries(targets).map(([type,goal])=><div className="target-row" key={type}>
      <Icon name={type} size={26}/><div className="target-content">
        <div className="target-label"><span>{displayName(type)}</span><span>{counts[type]||0} / {goal}{counts[type]>=goal?" ✓":""}</span></div>
        <div className="target-track" aria-hidden="true">{Array.from({length:goal},(_,i)=><span key={i} className={"target-segment"+(i<(counts[type]||0)?" filled":"")}/>)}</div>
      </div></div>)}</div>
  </section>;
}

// ─── Body-comp entry line (Today) ───────────────────────────────────────────────
// Quiet, optional line — not a card, no target, no nagging. Collapsed it shows
// either "＋ Log weight" or the day's logged values; tapping opens two small
// inputs. Weight and body fat are independent (either alone is valid). Saving
// only writes weight/bodyFat — it never touches sessions or completion.
function BodyCompLine({entry,dateKey:dk,updDay}) {
  const [open,setOpen]=useState(false),[w,setW]=useState(""),[bf,setBf]=useState("");
  const parse=value=>value.trim()===""?null:Number(value.replace(",","."));
  const weight=parse(w),fat=parse(bf);
  const valid=(weight===null||Number.isFinite(weight)&&weight>0&&weight<=500)&&(fat===null||Number.isFinite(fat)&&fat>0&&fat<100);
  const start=()=>{setW(entry.weight==null?"":String(entry.weight));setBf(entry.bodyFat==null?"":String(entry.bodyFat));setOpen(true);};
  const save=()=>{if(!valid)return;updDay(dk,{weight:weight==null?null:Math.round(weight*10)/10,bodyFat:fat==null?null:Math.round(fat*10)/10});setOpen(false);};
  if(!open)return <button className="text-btn body-entry" onClick={start}><Icon name="journey" size={17}/>
    {entry.weight!=null||entry.bodyFat!=null?[entry.weight!=null?entry.weight+" kg":null,entry.bodyFat!=null?entry.bodyFat+" %":null].filter(Boolean).join(" · "):"Körperwerte eintragen"}
  </button>;
  return <section className="panel body-editor"><div className="eyebrow">Körperwerte · optional</div><div className="body-fields">
    <label>Gewicht (kg)<input className="modal-input" inputMode="decimal" value={w} onChange={e=>setW(e.target.value)} placeholder="78,4"/></label>
    <label>Körperfett (%)<input className="modal-input" inputMode="decimal" value={bf} onChange={e=>setBf(e.target.value)} placeholder="15,8"/></label>
    </div>{!valid&&<p role="alert" className="helper-text">Bitte gültige Werte eingeben.</p>}
    <div className="sheet-footer"><button className="primary" disabled={!valid} onClick={save}>Speichern</button><button className="secondary" onClick={()=>setOpen(false)}>Abbrechen</button></div>
  </section>;
}

// ─── Today view ──────────────────────────────────────────────────────────────────
function TodayView({plan,updDay,dayOff,setDayOff,onOpenCoach}) {
  const viewKey=offsetDate(dayOff), e=plan[viewKey]||{};
  const [sheetOpen,setSheetOpen]=useState(false);
  const [notesOpen,setNotesOpen]=useState(false);
  const [confirmUnlog,setConfirmUnlog]=useState(false);
  const [direction,setDirection]=useState(1);
  useEffect(()=>{setNotesOpen(false);setConfirmUnlog(false);setSheetOpen(false);},[viewKey]);
  const navDay=delta=>{setDirection(delta);setDayOff(o=>o+delta);};
  const swipe=useSwipe(()=>navDay(1),()=>navDay(-1));
  const sessions=getSessions(e), next=nextUp(plan,viewKey), match=e.match, guidance=coachingFor(e);
  const go=dk=>{setDirection(dk>viewKey?1:-1);setDayOff(daysUntil(dk));};
  return <div className="view" {...swipe}>
    <div className="range-nav">
      <NavArrow dir="left" onClick={()=>navDay(-1)}/>
      <div><span>{dayOff===0?"Heute · ":""}{shortDate(viewKey)}</span>
        {dayOff!==0&&<button className="text-btn" onClick={()=>setDayOff(0)}>Zu heute</button>}</div>
      <NavArrow dir="right" onClick={()=>navDay(1)}/>
    </div>
    <div className="day-strip" aria-label="Tag auswählen">
      {weekAround(viewKey).map((dk,i)=><button key={dk} className={"day-chip"+(isMatchDay(plan[dk])?" match-day":"")} aria-pressed={dk===viewKey}
        aria-label={shortDate(dk)+(plan[dk]?.match?" · "+entryDescription(plan[dk]):"")+(calendarDone(plan[dk])?" · erledigt":"")} onClick={()=>go(dk)}>
        <small>{DN[i]}</small><strong>{Number(dk.slice(-2))}</strong>
        <span className="day-marker">{calendarDone(plan[dk])?"✓":isMatchDay(plan[dk])?"⚽":getSessions(plan[dk]).length?"·":" "}</span>
      </button>)}
    </div>
    <section key={"session-"+viewKey} className={"panel session-card"+(isMatchDay(e)?" match-card":"")} aria-label="Training"
      style={{animation:direction>0?"slideLeft .22s ease-out":"slideRight .22s ease-out"}}>
      <div className="session-top"><span className="eyebrow">{e.completed?"Training erledigt":sessions.length?"Dein Training":"Zeit zum Auftanken"}</span>
        <div className="session-art">{sessions.length?sessions.map(s=><Icon key={s} name={s} size={28}/>):<Icon name="rest" size={28}/>}</div></div>
      {match&&<div className="fixture-detail" aria-label="Spieltermin">
        <div className="fixture-meta"><span className="match-badge">{match.home?'Heimspiel':'Auswärtsspiel'}</span><strong>{match.kickoff} Uhr</strong></div>
        <h3>Gegen {match.opponent}</h3><p>FC Julius Bär · {shortDate(match.date)} · Zeit in der Schweiz</p>
        {e.completed&&!sessions.includes('Match')&&<p>Spieltermin laut Spielplan. Dein bereits abgeschlossenes Training bleibt unverändert.</p>}
      </div>}
      <h2>{sessions.length?sessions.map((s,i)=><span key={s}>{i>0&&<><br/><span style={{fontWeight:300,color:C.muted}}>+ </span></>}{displayName(s)}</span>):"Ruhetag"}</h2>
      <p className="session-subtitle">{sessionSubtitle(e)}</p>
      {guidance&&<aside className="plan-guidance" aria-label="Planhinweis"><strong>{guidance.title}</strong><p>{guidance.text}</p></aside>}
      <div className="session-actions">
        <div><button className="text-btn" onClick={()=>setSheetOpen(true)}><Icon name="edit" size={16}/> Ändern</button>
          <button className="text-btn" onClick={()=>setNotesOpen(o=>!o)} aria-expanded={notesOpen}><Icon name="note" size={16}/> {e.notes?"Notiz":"Notiz hinzufügen"}</button></div>
        {sessions.length>0&&<button className={"log-circle"+(e.completed?" logged":"")}
          aria-label={e.completed?"Eintrag rückgängig machen":"Training als erledigt eintragen"}
          onClick={()=>e.completed?setConfirmUnlog(true):updDay(viewKey,{completed:true})}>
          {e.completed?<Chk size={26} color={C.ink}/>:<span>FERTIG</span>}
        </button>}
      </div>
      {confirmUnlog&&<div className="inline-confirm"><p>Diesen Trainingseintrag entfernen?</p>
        <button className="text-btn" onClick={()=>{updDay(viewKey,{completed:false,feeling:null});setConfirmUnlog(false);}}>Entfernen</button>
        <button className="text-btn" onClick={()=>setConfirmUnlog(false)}>Abbrechen</button></div>}
      {notesOpen?<div className="notes"><label htmlFor="day-note" className="eyebrow">Deine Notiz</label>
        <textarea id="day-note" autoFocus rows={3} placeholder="Was lief gut? Was nimmst du mit?"
          value={e.notes||""} onChange={ev=>updDay(viewKey,{notes:ev.target.value})}/></div>
        :e.notes&&<p className="saved-note">{e.notes}</p>}
      {e.completed&&<div className="feeling-row"><span>Wie war das Training?</span><div>
        {FEELINGS.map(f=><button key={f.value} title={f.label} aria-label={f.label} aria-pressed={e.feeling===f.value}
          onClick={()=>updDay(viewKey,{feeling:e.feeling===f.value?null:f.value})}>{f.emoji}</button>)}
      </div></div>}
      {sessions.length>0&&<details className="session-details"><summary>Hinweise zur Einheit</summary>
        {sessions.map(s=><TipCard key={s} workout={s}/>)}</details>}
    </section>
    <WeeklyTargets plan={plan} date={viewKey}/>
    {next&&<div className="next-line"><span>Als Nächstes</span><strong>{next.label}</strong><span>{next.when}</span></div>}
    <TacticalCard dk={viewKey}/>
    <button className="coach-entry" onClick={onOpenCoach}><Icon name="coach" size={20}/><span>Frag deinen Trainer</span><Icon name="arrow" size={18}/></button>
    <BodyCompLine key={"body-"+viewKey} entry={e} dateKey={viewKey} updDay={updDay}/>
    {sheetOpen&&<WorkoutSheet dateKey={viewKey} entry={e} updDay={updDay} onClose={()=>setSheetOpen(false)}/>}
  </div>;
}

// ─── Week view ───────────────────────────────────────────────────────────────────
function WeekView({today,plan,wkOff,setWkOff,onGoToDay,updDay,onSwapDays}) {
  const days=weekOf(wkOff);
  const planned=days.filter(d=>getSessions(plan[d]).length).length;
  const done=days.filter(d=>plan[d]?.completed&&getSessions(plan[d]).length).length;
  const [sheetDk,setSheetDk]=useState(null), [swapFrom,setSwapFrom]=useState(null), [flashed,setFlashed]=useState([]);
  const [direction,setDirection]=useState(1);
  const timer=useRef(null);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const nav=delta=>{setSwapFrom(null);setDirection(delta);setWkOff(o=>o+delta);};
  const swipe=useSwipe(()=>nav(1),()=>nav(-1));
  const pick=dk=>{
    if(!swapFrom){onGoToDay(dk);return;}
    if(plan[dk]?.match){setSwapFrom(null);return;}
    if(swapFrom!==dk){onSwapDays(swapFrom,dk);setFlashed([swapFrom,dk]);clearTimeout(timer.current);timer.current=setTimeout(()=>setFlashed([]),1800);}
    setSwapFrom(null);
  };
  return <div className="view" {...swipe}>
    <div className="range-nav"><NavArrow dir="left" onClick={()=>nav(-1)}/><div>
      <strong>{shortDate(days[0])} – {shortDate(days[6])}</strong>
      <small>{done} / {planned} Trainingstage erledigt</small>
      {wkOff!==0&&<button className="text-btn" onClick={()=>setWkOff(0)}>Aktuelle Woche</button>}
    </div><NavArrow dir="right" onClick={()=>nav(1)}/></div>
    {swapFrom&&<div className="swap-banner" role="status"><span>Zweiten Tag zum Tauschen wählen.</span><button className="text-btn" onClick={()=>setSwapFrom(null)}>Abbrechen</button></div>}
    {flashed.length>0&&<p role="status" style={{color:C.accent,fontSize:13}}>✓ Einheiten getauscht. Notizen und Einträge bleiben beim Datum.</p>}
    <div key={wkOff} style={{animation:direction>0?"slideLeft .22s ease-out":"slideRight .22s ease-out"}}>
      {days.map((dk,i)=>{const e=plan[dk]||{};return <div className={"week-row"+(isMatchDay(e)?" match-row":"")} key={dk}
        style={{borderColor:swapFrom===dk||flashed.includes(dk)?C.accent:undefined}}>
        <button className="week-open" disabled={!!swapFrom&&!!e.match} onClick={()=>pick(dk)} aria-label={shortDate(dk)+" · "+entryDescription(e)+(calendarDone(e)?" · erledigt":"")}>
          <span className={"date-tile"+(dk===today?" current":"")}><small>{DN[i]}</small><strong>{Number(dk.slice(-2))}</strong></span>
          <span className="week-info">
            {isMatchDay(e)&&<span className="match-badge">{e.match?(e.match.home?"Heimspiel":"Auswärtsspiel"):"Spieltag"}{e.match?" · "+e.match.kickoff+" Uhr":""}</span>}
            <strong>{e.match?"Gegen "+e.match.opponent:sessionsLabel(e)||"Ruhetag"}</strong>
            {e.match&&getSessions(e).some(s=>s!=="Match")&&<span className="fixture-existing">{sessionsLabel(e)}</span>}
            {coachingFor(e)&&<span className="week-plan-focus">{coachingFor(e).title}</span>}
            <small><SessionMarks entry={e}/>{calendarStatus(e)}</small></span>
          {calendarDone(e)&&<span style={{color:C.accent}}><Chk size={16} color={C.accent}/></span>}
        </button>
        <div className="week-controls">
          <button className="icon-btn" aria-label={"Einheiten tauschen: "+shortDate(dk)} disabled={!!e.match} title={e.match?"Spieltermin steht fest":undefined} aria-pressed={swapFrom===dk} onClick={()=>setSwapFrom(swapFrom===dk?null:dk)}><Icon name="swap" size={17}/></button>
          <button className="icon-btn" aria-label={"Training ändern: "+shortDate(dk)} onClick={()=>{setSwapFrom(null);setSheetDk(dk);}}><Icon name="edit" size={17}/></button>
        </div>
      </div>;})}
    </div>
    <p className="helper-text">Tag öffnen, um Training einzutragen. Über ⇅ kannst du zwei Trainingstage tauschen. Eingetragene Spieltermine bleiben fix.</p>
    {sheetDk&&<WorkoutSheet dateKey={sheetDk} entry={plan[sheetDk]||{}} updDay={updDay} onClose={()=>setSheetDk(null)}/>}
  </div>;
}

// ─── Month view ──────────────────────────────────────────────────────────────────
function MonthView({today,plan,moOff,setMoOff,onGoToDay}) {
  const now=new Date(), month=new Date(now.getFullYear(),now.getMonth()+moOff,1);
  const days=monthGrid(month.getFullYear(),month.getMonth()), real=days.filter(Boolean);
  const done=real.filter(d=>plan[d]?.completed&&getSessions(plan[d]).length).length;
  const planned=real.filter(d=>getSessions(plan[d]).length).length;
  const [direction,setDirection]=useState(1);
  const nav=delta=>{setDirection(delta);setMoOff(o=>o+delta);};
  const swipe=useSwipe(()=>nav(1),()=>nav(-1));
  return <div className="view" {...swipe}>
    <div className="range-nav"><NavArrow dir="left" onClick={()=>nav(-1)}/><div>
      <strong>{MONTHS[month.getMonth()]} {month.getFullYear()}</strong><small>{done} / {planned} Trainingstage erledigt</small>
      {moOff!==0&&<button className="text-btn" onClick={()=>setMoOff(0)}>Aktueller Monat</button>}
    </div><NavArrow dir="right" onClick={()=>nav(1)}/></div>
    <section className="panel" style={{padding:"20px 10px"}}>
      <div key={moOff} className="calendar" style={{animation:direction>0?"slideLeft .22s ease-out":"slideRight .22s ease-out"}}>
        {DN.map((d,i)=><span className="calendar-label" key={i}>{d}</span>)}
        {days.map((dk,i)=>{if(!dk)return <span key={"empty"+i}/>;const e=plan[dk]||{}, has=getSessions(e).length>0;
          return <button key={dk} className={(has?"planned ":"")+(calendarDone(e)?"done ":"")+(dk===today?"today ":"")+(isMatchDay(e)?"match-day":"")}
            onClick={()=>onGoToDay(dk)} title={shortDate(dk)+" · "+entryDescription(e)}
            aria-label={shortDate(dk)+" · "+entryDescription(e)+(calendarDone(e)?" · erledigt":"")}>
            <span>{Number(dk.slice(-2))}</span>
            {isMatchDay(e)?<span className="calendar-ball" aria-hidden="true">⚽</span>:<SessionMarks entry={e} size={13}/>}
            {e.match&&<small className="calendar-kickoff">{e.match.home?"H":"A"} {e.match.kickoff}</small>}
            {calendarDone(e)&&<span className="done-dot">✓</span>}
          </button>;})}
      </div>
    </section>
    <div className="legend"><span className="match-legend">⚽ Spieltag</span><span>H: Zuhause · A: Auswärts</span><span>✓ Erledigt</span><span>Hell umrandet: heute</span></div>
    {real.some(dk=>plan[dk]?.match)&&<section aria-label="Spiele in diesem Monat">
      <div className="section-heading"><h2>Deine Spiele</h2><span>FC Julius Bär</span></div>
      {real.filter(dk=>plan[dk]?.match).map(dk=>{const match=plan[dk].match;return <button className="fixture-list-item" key={dk} onClick={()=>onGoToDay(dk)}>
        <span className="fixture-list-date">{new Date(dk+"T12:00:00").toLocaleDateString("de-CH",{weekday:"short"})}<strong>{Number(dk.slice(-2))}</strong></span>
        <span><strong>{match.opponent}</strong><small>{matchVenue(match)} · {match.kickoff} Uhr</small></span><Icon name="arrow" size={17}/>
      </button>;})}
    </section>}
    <p className="helper-text">Ein Tag, dein Plan. Tippe auf ein Datum für Training, Notizen und Einträge.</p>
  </div>;
}

// ─── Body composition ────────────────────────────────────────────────────────────
// Optional per-day `weight` (kg) and `bodyFat` (%) fields. Smart-scale readings
// are individually noisy, so the 7-day rolling average is always the headline;
// raw readings are background dots. Gaps in logging are normal — never an error.
const BF_GOAL = 14;   // upper end of the 13–14% target band

function bodyCompReadings(plan, field) {
  return Object.keys(plan).filter(dk=>dk<=todayStr()&&Number.isFinite(plan[dk]?.[field])&&plan[dk][field]>0).sort()
    .map(dk=>({date:dk, value:plan[dk][field]}));
}

// One point per day from `fromDk`..`toDk`: avg of raw readings in the trailing
// 7 days, or null (a gap) when the window holds none. Sparse data is fine.
function rollingSeries(readings, fromDk, toDk) {
  const out=[];
  const d=new Date(fromDk+"T00:00:00");
  while (dateKey(d)<=toDk) {
    const dk=dateKey(d), cut=daysBeforeStr(dk,6);
    const inWin=readings.filter(r=>r.date>=cut&&r.date<=dk);
    out.push({date:dk, value:inWin.length?inWin.reduce((s,r)=>s+r.value,0)/inWin.length:null});
    d.setDate(d.getDate()+1);
  }
  return out;
}

// Minimal responsive SVG line chart: rolling-average line (gap-aware), raw
// readings as de-emphasized dots, optional dashed horizontal target.
function TrendChart({readings, series, target}) {
  const W=340,H=150, L=34,R=10,T=12,B=22;
  const days=series.map(p=>p.date);
  const vals=[...series.map(p=>p.value),...readings.map(r=>r.value)].filter(v=>v!=null);
  if (target!=null) vals.push(target);
  let lo=Math.min(...vals), hi=Math.max(...vals);
  const pad=Math.max((hi-lo)*0.15,0.4); lo-=pad; hi+=pad;
  const x=(dk)=>{ const i=days.indexOf(dk); return L+(i/Math.max(days.length-1,1))*(W-L-R); };
  const y=(v)=>T+(1-(v-lo)/(hi-lo))*(H-T-B);
  // Split the average line into segments at gaps.
  const segs=[]; let cur=[];
  for (const p of series) {
    if (p.value==null) { if (cur.length>1) segs.push(cur); cur=[]; }
    else cur.push(p);
  }
  if (cur.length>1) segs.push(cur);
  const fmtD=(dk)=>new Date(dk+"T00:00:00").toLocaleDateString("de-CH",{month:"short",day:"numeric"});
  const midDk=days[Math.floor(days.length/2)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{display:"block",width:"100%",height:"auto"}}>
      {/* y labels */}
      {[lo+pad,hi-pad].map((v,i)=>(
        <text key={i} x={L-5} y={y(v)+3} fontSize="9" fill={C.muted} textAnchor="end">{v.toFixed(1)}</text>
      ))}
      {/* target reference */}
      {target!=null&&(<>
        <line x1={L} x2={W-R} y1={y(target)} y2={y(target)} stroke={C.muted} strokeWidth="1" strokeDasharray="4 4" opacity="0.7"/>
        <text x={W-R} y={y(target)-4} fontSize="9" fill={C.muted} textAnchor="end">{target}% Ziel</text>
      </>)}
      {/* raw readings — visible noise, clearly secondary */}
      {readings.filter(r=>days.includes(r.date)).map(r=>(
        <circle key={r.date} cx={x(r.date)} cy={y(r.value)} r="2.2" fill={C.sage} opacity="0.45"/>
      ))}
      {/* rolling-average line (hero) */}
      {segs.map((seg,i)=>(
        <path key={i} fill="none" stroke={C.done} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          d={seg.map((p,j)=>`${j===0?"M":"L"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}/>
      ))}
      {/* x labels */}
      <text x={L} y={H-6} fontSize="9" fill={C.muted}>{fmtD(days[0])}</text>
      {days.length>20&&<text x={x(midDk)} y={H-6} fontSize="9" fill={C.muted} textAnchor="middle">{fmtD(midDk)}</text>}
      <text x={W-R} y={H-6} fontSize="9" fill={C.muted} textAnchor="end">{fmtD(days[days.length-1])}</text>
    </svg>
  );
}

// Journey section: metric toggle, rolling-average summary line, trend chart.
function BodyCompTrend({plan}) {
  const [metric,setMetric]=useState("bodyFat");
  const readings=bodyCompReadings(plan,metric), today=todayStr();
  const from=readings.length&&readings[0].date<daysBeforeStr(today,13)?readings[0].date:daysBeforeStr(today,13);
  const series=readings.length?rollingSeries(readings,from,today):[];
  const points=series.filter(p=>p.value!=null),latest=points.at(-1);
  return <section className="panel trend-panel">
    <div className="eyebrow">Körperentwicklung</div>
    <div className="metric-switch">{[["bodyFat","Körperfett"],["weight","Gewicht"]].map(([key,label])=>
      <button key={key} aria-pressed={metric===key} onClick={()=>setMetric(key)}>{label}</button>)}</div>
    {latest?<><div className="trend-value">{latest.value.toFixed(1)}<span>{metric==="bodyFat"?" %":" kg"}</span></div>
      <p className="helper-text">7-Tage-Mittel · Stand {shortDate(latest.date)}{metric==="bodyFat"?" · Ziel 14 %":""}</p>
      <TrendChart readings={readings} series={series} target={metric==="bodyFat"?BF_GOAL:null}/>
      <p className="chart-caption">Linie: 7-Tage-Mittel · Punkte: einzelne Messungen</p></>
      :<p className="helper-text">Trage unter Heute deine Körperwerte ein. Hier siehst du die Entwicklung — ohne tägliches Rauschen.</p>}
  </section>;
}

// ─── Journey view ────────────────────────────────────────────────────────────────
function JourneyView({plan,today,onGoToDay}) {
  const entries=Object.values(plan), planned=entries.filter(e=>getSessions(e).length).length;
  const done=entries.filter(e=>e.completed&&getSessions(e).length).length;
  const current=phaseForDate(today), idx=PHASES.indexOf(current), next=PHASES[idx+1];
  return <div className="view">
    <section className="panel journey-summary"><div className="eyebrow">Deine Saison · 2026 / 27</div>
      <div><strong>{done}</strong><span>Trainingstage erledigt<br/>von {planned} geplant</span></div>
      <progress aria-label="Saisonfortschritt" max={Math.max(planned,1)} value={done}/>
      <p>{current?(next?daysUntil(next.start)+" Tage bis "+phaseLabel(next.name):daysUntil(current.end)+" Tage bis Saisonende"):today<SEASON_START?"Deine Saison startet am "+shortDate(SEASON_START):"Saison abgeschlossen."}</p>
    </section>
    <BodyCompTrend plan={plan}/>
    <div className="section-heading"><h2>Deine Saisonphasen</h2><span>Der lange Blick</span></div>
    <div className="phase-timeline">{PHASES.map((p,i)=>{
      const days=Object.entries(plan).filter(([dk])=>dk>=p.start&&dk<=p.end);
      const total=days.filter(([,e])=>getSessions(e).length).length, count=days.filter(([,e])=>e.completed&&getSessions(e).length).length;
      return <button key={p.name} className={"phase-item"+(p===current?" current":"")} onClick={()=>onGoToDay(p.start)}>
        <div className="eyebrow">Phase {i+1}{p===current?" · Aktuell":""}</div><h3>{phaseLabel(p.name)}</h3>
        <small>{shortDate(p.start)} {p.start.slice(0,4)} — {shortDate(p.end)} {p.end.slice(0,4)}</small>
        <p>{p.description}</p><div className="phase-count"><span>{count} / {total} Trainingstage</span><Icon name="arrow" size={18}/></div>
      </button>;
    })}</div>
  </div>;
}

// ─── Coach screen (full-screen chat) ─────────────────────────────────────────────
function CoachScreen({viewKey,plan,playerName,onBack}) {
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [sending,setSending]=useState(false);
  const [coachError,setCoachError]=useState(false);
  const coachKey=`coach-${viewKey}`;
  const inputRef=useRef(null), requestRef=useRef(null);
  useEffect(()=>()=>requestRef.current?.abort(),[]);

  useEffect(()=>{ const t=setTimeout(()=>inputRef.current?.focus(),300); return ()=>clearTimeout(t); },[]);
  useEffect(()=>{
    let stored=[];
    try { const raw=localStorage.getItem(coachKey); if (raw) stored=JSON.parse(raw); } catch {}
    setMessages(Array.isArray(stored)?stored:[]);
  },[coachKey]);
  const persistCoach=(msgs)=>{ try { localStorage.setItem(coachKey,JSON.stringify(msgs)); } catch {} };

  const e=plan[viewKey]||{};
  const sendToCoach=async(base)=>{
    if(sending)return;
    setSending(true); setCoachError(false);
    const controller=new AbortController();requestRef.current=controller;
    setMessages([...base,{role:"assistant",content:""}]);
    try {
      const resp=await fetch("/api/coach",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...buildCoachContext(plan,playerName,viewKey),messages:base.slice(-20)})});
      if (!resp.ok||!resp.body) throw new Error("bad response");
      const reader=resp.body.getReader(), decoder=new TextDecoder();
      let acc="";
      for (;;) { const {done,value}=await reader.read(); if (done) break; acc+=decoder.decode(value,{stream:true}); setMessages([...base,{role:"assistant",content:acc}]); }
      if (!acc.trim()) throw new Error("empty response");
      const final=[...base,{role:"assistant",content:acc}];
      setMessages(final); persistCoach(final);
    } catch(error) { if(error.name!=="AbortError"){setCoachError(true);setMessages(base);} }
    finally { setSending(false); }
  };
  // Context-aware opener — rest days get a recovery-oriented prompt, not "today's session".
  const viewedDateLabel=new Date(viewKey+'T12:00:00').toLocaleDateString('de-CH',{day:'numeric',month:'long',year:'numeric'});
  const opener=getSessions(e).length>0 ? `Worauf sollte ich bei der Einheit am ${viewedDateLabel} achten?` : `Wie nutze ich den Ruhetag am ${viewedDateLabel} am besten?`;
  const startCoach=()=>sendToCoach([{role:"user",content:opener}]);
  const dailyBriefing=()=>sendToCoach([...messages,{role:'user',content:'Daily Briefing für heute, bitte.'}]);
  const sendCoach=()=>{ const text=input.trim(); if (!text||sending) return; setInput(""); sendToCoach([...messages,{role:"user",content:text}]); };
  const retryCoach=()=>{ if (!sending&&messages.length) sendToCoach(messages); };
  const newCoachChat=()=>{ setMessages([]); setInput(""); setCoachError(false); try { localStorage.removeItem(coachKey); } catch {} };

  return (
    <div style={{position:"fixed",inset:0,maxWidth:560,margin:"0 auto",zIndex:60,background:C.bg,display:"flex",flexDirection:"column",
      fontFamily:"system-ui,sans-serif"}}>
      <style>{"@keyframes coachBlink{0%,80%,100%{opacity:.25}40%{opacity:1}}"}</style>
      <div style={{flexShrink:0,background:C.surface,borderBottom:`1px solid ${C.border}`,
        padding:"env(safe-area-inset-top,0px) 12px 0",display:"flex",alignItems:"center",gap:8,minHeight:56}}>
        <button onClick={onBack} aria-label="Zurück" style={{background:"none",border:"none",cursor:"pointer",
          color:C.muted,fontSize:24,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",
          flexShrink:0,WebkitTapHighlightColor:"transparent"}}>←</button>
        <div style={{flex:1,textAlign:"center",fontSize:16,fontWeight:700,color:C.text}}>KI-Trainer</div>
        {messages.length>0
          ? <button disabled={sending} onClick={newCoachChat} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,
              fontSize:12,fontWeight:600,textDecoration:"underline",minHeight:44,padding:"0 8px",flexShrink:0,
              WebkitTapHighlightColor:"transparent"}}>Neues Gespräch</button>
          : <div style={{width:44,flexShrink:0}}/>}
      </div>

      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:10}}>
        <button className="primary" onClick={dailyBriefing} disabled={sending}>Daily Briefing · {shortDate(todayStr())}</button>
        <p style={{fontSize:11,color:C.muted,lineHeight:1.5,margin:0}}>Berücksichtigt Trainingslogs und Notizen, kommende Termine, Wochenziele und vorhandene Körperwerte. Chats anderer Tage sind nicht enthalten.{viewKey!==todayStr()?` Geöffneter Trainingstag: ${shortDate(viewKey)}. Das Daily Briefing bezieht sich auf heute.`:''}</p>
        {messages.length===0&&!input.trim()&&!coachError&&(
          <button onClick={startCoach} disabled={sending}
            style={{alignSelf:"stretch",padding:"14px",background:C.surface,color:C.sageDk,
              border:`1px solid ${C.sage}`,borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:600,
              cursor:sending?"default":"pointer",WebkitTapHighlightColor:"transparent"}}>
            {opener}
          </button>
        )}
        {messages.map((m,i)=>(
          m.role==="assistant"
            ? <div key={i} style={{alignSelf:"flex-start",maxWidth:"90%",background:C.surface,
                borderLeft:`3px solid ${C.sage}`,borderRadius:"4px 14px 14px 4px",padding:"11px 14px"}}>
                {m.content
                  ? <p style={{margin:0,fontSize:15,lineHeight:1.6,color:C.text,whiteSpace:"pre-wrap"}}>{m.content}</p>
                  : <div style={{display:"flex",gap:5,padding:"2px 0"}}>
                      {[0,1,2].map(j=>(<span key={j} style={{width:7,height:7,borderRadius:"50%",background:C.sage,
                        display:"inline-block",animation:`coachBlink 1.2s ${j*0.16}s infinite ease-in-out`}}/>))}
                    </div>}
              </div>
            : <div key={i} style={{alignSelf:"flex-end",maxWidth:"85%",background:C.surface,
                border:`1px solid ${C.border}`,borderRadius:"14px 14px 4px 14px",padding:"11px 14px"}}>
                <p style={{margin:0,fontSize:15,lineHeight:1.55,color:C.text,whiteSpace:"pre-wrap"}}>{m.content}</p>
              </div>
        ))}
        {coachError&&(
          <div style={{alignSelf:"stretch"}}>
            <p style={{margin:"0 0 8px",fontSize:14,color:C.muted,lineHeight:1.5}}>
              Der Trainer ist gerade nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.
            </p>
            {messages.length>0&&(
              <button onClick={retryCoach} style={{fontSize:14,fontWeight:600,color:C.sageDk,background:C.surface,
                border:`1px solid ${C.sage}`,borderRadius:10,padding:"9px 16px",cursor:"pointer",fontFamily:"inherit",
                WebkitTapHighlightColor:"transparent"}}>Erneut versuchen</button>
            )}
          </div>
        )}
      </div>

      <div style={{flexShrink:0,background:C.surface,borderTop:`1px solid ${C.border}`,
        padding:"10px 16px calc(2px + env(safe-area-inset-bottom,0px))",display:"flex",gap:8,alignItems:"center"}}>
        <input ref={inputRef} type="text" value={input} onChange={ev=>setInput(ev.target.value)}
          onKeyDown={ev=>{ if (ev.key==="Enter"){ ev.preventDefault(); sendCoach(); } }}
          aria-label="Nachricht an deinen Trainer" placeholder="Daily Briefing oder deine Frage …" maxLength={4000} disabled={sending}
          style={{flex:1,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px",fontFamily:"inherit",
            fontSize:15,color:C.text,background:C.bg,outline:"none",boxSizing:"border-box",WebkitAppearance:"none"}}/>
        <button onClick={sendCoach} disabled={sending||!input.trim()}
          style={{padding:"14px 18px",background:input.trim()&&!sending?C.done:C.border,color:C.ink,border:"none",
            borderRadius:12,fontFamily:"inherit",fontSize:14,fontWeight:600,
            cursor:input.trim()&&!sending?"pointer":"default",flexShrink:0,WebkitTapHighlightColor:"transparent"}}>Senden</button>
      </div>
    </div>
  );
}



export default function App() {
  const [loading,setLoading]=useState(true),[playerName,setPlayerName]=useState(""),[plan,setPlan]=useState({});
  const [view,setView]=useState("today"),[screen,setScreen]=useState("main");
  const [wkOff,setWkOff]=useState(0),[moOff,setMoOff]=useState(0),[dayOff,setDayOff]=useState(0);
  const [restoredToast,setRestoredToast]=useState(false),[celebration,setCelebration]=useState(null),[storageError,setStorageError]=useState("");
  const [loadError,setLoadError]=useState(false);
  // Retired feature data is preserved verbatim for backwards-compatible backups.
  const storedExtras=useRef({});
  useEffect(()=>{
    (async()=>{
      try{
        const raw=localStorage.getItem(SK), previous=raw?null:localStorage.getItem(SK_PREV), stored=raw||previous;
        if(stored){
          const d=JSON.parse(stored);
          if(!d||typeof d!=="object"||!d.plan||Array.isArray(d.plan)||typeof d.plan!=="object")throw Error("invalid");
          const updated=migrateCoachedPlan(migrateMatchSchedule(d));
          const {playerName:name,plan:savedPlan,...extras}=updated;
          storedExtras.current=extras;
          setPlayerName(typeof name==="string"?name:"");setPlan(savedPlan);setScreen(name?"main":"setup");
          if(previous||updated!==d)localStorage.setItem(SK,JSON.stringify({...extras,playerName:name||"",plan:savedPlan}));
        }else{storedExtras.current={matchScheduleVersion:MATCH_SCHEDULE_VERSION,coachedPlanVersion:COACHED_PLAN_VERSION};setPlan(buildDefaultPlan());setScreen("setup");}
      }catch{setLoadError(true);}
      setLoading(false);
    })();
    try{if(sessionStorage.getItem("justRestored")){sessionStorage.removeItem("justRestored");setRestoredToast(true);}}catch{}
  },[]);
  useEffect(()=>{if(!restoredToast)return;const t=setTimeout(()=>setRestoredToast(false),3200);return ()=>clearTimeout(t);},[restoredToast]);
  useEffect(()=>{if(!celebration)return;const t=setTimeout(()=>setCelebration(null),5000);return ()=>clearTimeout(t);},[celebration]);
  const save=(np,nn)=>{
    try{localStorage.setItem(SK,JSON.stringify({...storedExtras.current,playerName:nn??playerName,plan:np??plan}));setStorageError("");}
    catch{setStorageError("Änderungen sind noch nicht gespeichert. Bitte Speicherplatz und Browser-Zugriff prüfen.");}
  };
  const checkMilestones=(dk,planState)=>{
    const all=Object.entries(planState).filter(([,e])=>e.completed&&getSessions(e).length)
      .map(([date,e])=>({...e,date,phase:phaseForDate(date)?.name,sessions:getSessions(e)})).sort((a,b)=>a.date.localeCompare(b.date));
    const entry=all.find(e=>e.date===dk);if(!entry)return;
    for(const m of MILESTONES){
      const key="milestone-"+m.id;let already=false;try{already=!!localStorage.getItem(key);}catch{}
      if(!already&&m.check(all,entry,entry.phase)){try{localStorage.setItem(key,"true");}catch{}setCelebration(m);break;}
    }
  };
  const updDay=(dk,patch)=>{
    const np={...plan,[dk]:{...plan[dk],...patch}};setPlan(np);save(np);
    if(patch.completed===true&&getSessions(np[dk]).length)checkMilestones(dk,np);
  };
  // Swap only sessions. Logs, notes, body values and archived check-ins stay dated.
  const swapDays=(a,b)=>{
    if(plan[a]?.match||plan[b]?.match)return;
    const np={...plan,[a]:{...plan[a],sessions:getSessions(plan[b]),workout:"",coaching:null},[b]:{...plan[b],sessions:getSessions(plan[a]),workout:"",coaching:null}};
    setPlan(np);save(np);
  };
  const goToDay=dk=>{setDayOff(daysUntil(dk)??0);setView("today");window.scrollTo(0,0);};
  const today=todayStr(),phase=phaseForDate(today);
  const tabs=[["today","Heute"],["week","Woche"],["month","Monat"],["journey","Entwicklung"]];
  const headings={today:"Heute zählt.",week:"Deine Woche.",month:"Der Überblick.",journey:"Dein Weg."};
  let content;
  if(loading)content=<main className="app-shell"><p className="loading-state">Dein Plan wird geladen …</p></main>;
  else if(loadError)content=<main className="app-shell"><div className="view" style={{paddingTop:80}}><h1>Daten nicht lesbar.</h1>
    <p className="helper-text">Deine gespeicherten Daten wurden nicht verändert. Bitte prüfe den Browser-Zugriff oder sichere die vorhandenen Daten, bevor du eine Sicherung wiederherstellst.</p>
    <button className="secondary" onClick={()=>window.location.reload()}>Erneut versuchen</button></div></main>;
  else if(screen==="setup")content=<SetupScreen initName={playerName} isEdit={!!playerName} onBack={playerName?()=>setScreen("main"):null}
    onSave={n=>{setPlayerName(n);save(plan,n);setScreen("main");}}/>;
  else if(screen==="coach")content=<CoachScreen viewKey={offsetDate(dayOff)} plan={plan} playerName={playerName} onBack={()=>setScreen("main")}/>;
  else content=<main className="app-shell">
    <header className="app-header"><PitchTexture/><div className="brand-row"><span className="brand">Soccer Tracker</span>
      <button className="icon-btn" aria-label="Einstellungen" onClick={()=>setScreen("setup")}><Icon name="settings" size={21}/></button></div>
      <h1>{headings[view]}</h1>
      <p className="subtitle">{playerName} <span style={{color:C.borderSt}}> / </span> {phase?phaseLabel(phase.name):today<SEASON_START?"Deine Saison beginnt bald":"Saison abgeschlossen"}</p>
    </header>
    {view==="today"&&<TodayView plan={plan} updDay={updDay} dayOff={dayOff} setDayOff={setDayOff} onOpenCoach={()=>setScreen("coach")}/>}
    {view==="week"&&<WeekView today={today} plan={plan} wkOff={wkOff} setWkOff={setWkOff} onGoToDay={goToDay} updDay={updDay} onSwapDays={swapDays}/>}
    {view==="month"&&<MonthView today={today} plan={plan} moOff={moOff} setMoOff={setMoOff} onGoToDay={goToDay}/>}
    {view==="journey"&&<JourneyView today={today} plan={plan} onGoToDay={goToDay}/>}
    <nav className="nav" aria-label="Hauptnavigation">{tabs.map(([key,label])=><button key={key} aria-label={label} aria-current={view===key?"page":undefined}
      onClick={()=>{setView(key);if(key==="today")setDayOff(0);window.scrollTo(0,0);}}><TabIcon name={key}/><span>{label}</span></button>)}</nav>
  </main>;
  return <><style>{UI_CSS}</style>{content}
    {restoredToast&&<div className="toast" role="status">✓ Sicherung wiederhergestellt</div>}
    {storageError&&<div className="toast" role="alert"><p>{storageError}</p><button className="text-btn" onClick={()=>save()}>Erneut speichern</button></div>}
    {celebration&&!storageError&&<div className="toast milestone-toast" role="status"><span>{celebration.emoji}</span><div><strong>{celebration.title}</strong><p>{celebration.message}</p></div>
      <button className="icon-btn" aria-label="Hinweis schließen" onClick={()=>setCelebration(null)}><Icon name="close" size={18}/></button></div>}
  </>;
}
