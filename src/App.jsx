import { Fragment, useState, useEffect, useRef } from "react";

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
// Large titles: break compound words at the word joint (soft hyphen), not mid-syllable.
function titleBreaks(label) { return String(label).replace(/(Mannschafts|Kraft)(training)/,'$1\u00AD$2').replace(/\//g,'/\u200B'); }
function sessionsLabel(e) { return getSessions(e).map(displayName).join(' + '); }
function guidanceTitle(e) {
  const title=coachingFor(e)?.title;
  if(!title)return null;
  for(const name of [sessionsLabel(e),...getSessions(e).map(displayName)].filter(Boolean)){
    if(title===name)return null;
    if(title.startsWith(name+' · '))return title.slice(name.length+3);
  }
  return title;
}
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


// "morgen", a weekday within the next six days, otherwise a short date.
function whenLabel(dk,offset) {
  const day=new Date(dk+'T12:00:00');
  return offset===1?'morgen'
    :offset<=6?day.toLocaleDateString('de-CH',{weekday:'long'})
    :day.toLocaleDateString('de-CH',{month:'short',day:'numeric'});
}
function upcomingLabel(entry) { return entry?.match?'Spiel gegen '+entry.match.opponent:sessionsLabel(entry); }
function upcomingWhen(item) {
  const m=item.entry?.match,when=whenLabel(item.date,item.offset);
  return m?when+' · '+matchVenue(m)+' · '+m.kickoff+' Uhr':when;
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

// Week ring: completed sessions per priority type, each capped at its goal.
// A day counts once per type even if the same type appears twice.
function weekTargetProgress(plan,days,phaseName) {
  const goals=PHASE_TARGETS[phaseName]||{},counts={};
  days.forEach(dk=>{if(plan[dk]?.completed)new Set(getSessions(plan[dk])).forEach(s=>{counts[s]=(counts[s]||0)+1;});});
  const rows=Object.entries(goals).map(([type,goal])=>({type,goal,done:Math.min(counts[type]||0,goal)}));
  return {rows,done:rows.reduce((n,r)=>n+r.done,0),goal:rows.reduce((n,r)=>n+r.goal,0)};
}

// The next planned days after `from` (within a week), always including the next game.
function upcomingDays(plan,from=todayStr(),limit=2) {
  const out=[],d=new Date(from+'T12:00:00');let game=null;
  for(let i=1;i<=7;i++){
    d.setDate(d.getDate()+1);
    const dk=dateKey(d),e=plan[dk];
    if(!getSessions(e).length&&!e?.match)continue;
    if(out.length<limit)out.push({date:dk,offset:i,entry:e});
    else if(!game&&isMatchDay(e))game={date:dk,offset:i,entry:e};
  }
  if(game)out.push(game);
  return out;
}

// ─── Nutrition (optional, per day) ───────────────────────────────────────────────
// `protein` = grams logged that day via quick-add. `nutrition` = self-rating of the
// whole day's eating. Both optional: missing means "not logged" — never zero, never red.
const DEFAULT_PROTEIN_TARGET = 100;
const PROTEIN_STEPS = [20,30,40];
const NUTRITION_LEVELS = [
  {key:'green', label:'Im Plan',  mark:'✓', hint:'Bewusst gegessen, kaum Süsses.'},
  {key:'amber', label:'Gemischt', mark:'~', hint:'Teils im Plan, ein paar Ausrutscher.'},
  {key:'red',   label:'Daneben',  mark:'✕', hint:'Viel Süsses, Essen aus Lust statt Hunger, Fast Food.'},
];
function validProtein(v) { return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=500; }
function validProteinTarget(v) { return typeof v==='number'&&Number.isInteger(v)&&v>=30&&v<=400; }
function nutritionLevel(key) { return NUTRITION_LEVELS.find(l=>l.key===key)||null; }
// Photographed meals per day: {id, at, title, kcal, protein, kcalLow, kcalHigh, confidence, items, edited?}.
// Day protein = quick-add grams (`protein`) + meal protein. Day kcal comes from meals only.
function validMeal(m) { return !!m&&typeof m.id==='string'&&Number.isFinite(m.kcal)&&m.kcal>=0&&m.kcal<=5000&&Number.isFinite(m.protein)&&m.protein>=0&&m.protein<=300; }
function dayMeals(e) { return Array.isArray(e?.meals)?e.meals.filter(validMeal):[]; }
function dayProtein(e) {
  const quick=validProtein(e?.protein)?e.protein:null,meals=dayMeals(e);
  if(quick==null&&!meals.length)return null;
  return Math.round((quick||0)+meals.reduce((n,m)=>n+m.protein,0));
}
function dayKcal(e) { const meals=dayMeals(e); return meals.length?Math.round(meals.reduce((n,m)=>n+m.kcal,0)):null; }
// Favourite meals, stored top-level as `mealFavorites`: [{id, title, kcal, protein, items?, uses, lastUsed, created}].
// One tap adds a copy to the day (source 'favorite'); no photo, no model call.
const MAX_FAVORITES=12;
const favoriteKey=t=>String(t||'').trim().toLowerCase();
function validFavorite(f) { return !!f&&typeof f.id==='string'&&typeof f.title==='string'&&f.title.trim()!==''&&validMeal({id:f.id,kcal:f.kcal,protein:f.protein}); }
// Most used first, then most recently used or created.
function favoriteList(list) {
  return (Array.isArray(list)?list:[]).filter(validFavorite)
    .sort((a,b)=>(b.uses||0)-(a.uses||0)||String(b.lastUsed||b.created||'').localeCompare(String(a.lastUsed||a.created||'')));
}
function findFavorite(list,meal) {
  return favoriteList(list).find(f=>(meal?.favoriteId&&f.id===meal.favoriteId)||favoriteKey(f.title)===favoriteKey(meal?.title))||null;
}
// A favourite with the same name is updated, not duplicated. When full, the least used one goes.
function saveFavorite(list,meal,today=todayStr()) {
  const all=favoriteList(list),title=String(meal?.title||'').trim().replace(/\s+/g,' ').slice(0,40);
  if(!title||!validMeal({id:'x',kcal:meal.kcal,protein:meal.protein}))return all;
  const existing=all.find(f=>favoriteKey(f.title)===favoriteKey(title)),rest=all.filter(f=>f!==existing);
  const items=Array.isArray(meal.items)?meal.items.slice(0,12):[];
  const fav={id:existing?.id||`fav-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,title,
    kcal:Math.round(meal.kcal),protein:Math.round(meal.protein),...(items.length?{items}:{}),
    uses:existing?.uses||0,lastUsed:existing?.lastUsed||null,created:existing?.created||today};
  return favoriteList([fav,...rest.slice(0,MAX_FAVORITES-1)]);
}
function removeFavorite(list,id) { return favoriteList(list).filter(f=>f.id!==id); }
function useFavorite(list,id,today=todayStr()) { return favoriteList(list).map(f=>f.id===id?{...f,uses:(f.uses||0)+1,lastUsed:today}:f); }
function mealFromFavorite(f,at,id) {
  return {id,at,title:f.title,kcal:f.kcal,protein:f.protein,...(Array.isArray(f.items)&&f.items.length?{items:f.items}:{}),favoriteId:f.id,source:'favorite'};
}
// Summary over an explicit list of date keys (e.g. the last seven days).
function nutritionSummary(plan,days,target=DEFAULT_PROTEIN_TARGET) {
  const rows=days.map(date=>{
    const e=plan[date]||{},protein=dayProtein(e);
    return {date,protein,kcal:dayKcal(e),nutrition:nutritionLevel(e.nutrition)?e.nutrition:null,hit:protein!=null&&protein>=target};
  });
  const logged=rows.filter(r=>r.protein!=null),withKcal=rows.filter(r=>r.kcal!=null),counts={green:0,amber:0,red:0};
  rows.forEach(r=>{if(r.nutrition)counts[r.nutrition]++;});
  return {target,days:rows,proteinDays:logged.length,hits:rows.filter(r=>r.hit).length,
    avgProtein:logged.length?Math.round(logged.reduce((n,r)=>n+r.protein,0)/logged.length):null,
    ratedDays:counts.green+counts.amber+counts.red,counts,
    kcalDays:withKcal.length,avgKcal:withKcal.length?Math.round(withKcal.reduce((n,r)=>n+r.kcal,0)/withKcal.length):null};
}

// What is still open on a day: training, protein, eating rating. Future days have nothing open.
// For past days this means "not logged", not "skipped".
function dayChecklist(entry,dk,today=todayStr(),target=DEFAULT_PROTEIN_TARGET) {
  const e=entry||{},open=[];
  if(dk>today)return {future:true,open};
  if(getSessions(e).length&&!e.completed)open.push('Training');
  const protein=dayProtein(e);
  if(protein==null)open.push('Protein');
  else if(protein<target)open.push(`${target-protein} g Protein`);
  if(!nutritionLevel(e.nutrition))open.push('Ernährung bewerten');
  return {future:false,open};
}

// Snapshot for reminder notifications: what is open on each day from yesterday to
// two weeks ahead, so a push is accurate even when the app was not opened that day.
function reminderStatus(plan,today=todayStr(),target=DEFAULT_PROTEIN_TARGET,social=null) {
  const days={},matches=socialMatches(social?.matches);
  for(let i=-1;i<=14;i++){
    const dk=daysBeforeStr(today,-i),m=matches.find(x=>x.date===dk&&!x.result);
    const evaluate=matches.filter(x=>!x.friendly&&!x.result&&x.date<dk&&x.date>=daysBeforeStr(dk,7)).length;
    days[dk]={open:dayChecklist(plan[dk],dk,dk,target).open,...(m?{social:{kickoff:m.kickoff,friendly:!!m.friendly,rules:m.rules}}:{}),...(evaluate?{evaluate}:{})};
  }
  return {version:1,written:today,days};
}

// ─── Garmin import ───────────────────────────────────────────────────────────────
// Garmin type keys → session IDs by pattern (Garmin publishes no fixed list).
// 'soccer' resolves against the day's plan: game, team training or futsal.
const GARMIN_TYPES=[[/strength/,'Gym'],[/pilates|yoga/,'Pilates'],[/mobility|stretch|breath/,'Mobility'],
  [/soccer|futsal|football/,'soccer'],[/run/,'Easy run'],[/walk|hik/,'Walking']];
const GARMIN_LABELS={Gym:'Krafttraining',Pilates:'Pilates/Yoga',Mobility:'Mobilität',soccer:'Fussball','Easy run':'Laufen',Walking:'Gehen'};
function garminSessionType(typeKey) {
  const key=String(typeKey||'').toLowerCase();
  for(const [pattern,type] of GARMIN_TYPES)if(pattern.test(key))return type;
  return null;
}
function garminLabel(item) { const type=garminSessionType(item?.type); return type?GARMIN_LABELS[type]:item?.name||'Aktivität'; }
// Football detail line: distance, top speed, Garmin training load, minutes in HR zones 4–5.
const GARMIN_METRICS=['distanceKm','maxSpeedKmh','load','highHrMin'];
function garminStats(item) {
  if(!item)return '';
  return [item.distanceKm!=null&&item.distanceKm.toFixed(1)+' km',item.maxSpeedKmh!=null&&'max. '+item.maxSpeedKmh.toFixed(1)+' km/h',
    item.load!=null&&'Belastung '+item.load,item.highHrMin!=null&&item.highHrMin+' min intensiv'].filter(Boolean).join(' · ');
}
// Applies a sync without undoing anything the player did: each activity is applied
// once (by ID), can only mark a day done (never undone), fills an empty day, and is
// otherwise just listed as "nicht im Plan". Returns the new plan and completed days.
function applyGarminImport(plan,data,today=todayStr()) {
  const next={...plan},completed=[];
  const num=v=>Number.isFinite(v)?Math.round(v):null;
  const dec=v=>Number.isFinite(v)?Math.round(v*10)/10:null;
  const metrics=a=>({distanceKm:dec(a.distanceKm),maxSpeedKmh:dec(a.maxSpeedKmh),load:num(a.load),highHrMin:num(a.highHrMin)});
  for(const day of Array.isArray(data?.steps)?data.steps:[]){
    if(!day||!validCoachDate(day.date)||day.date>today||!Number.isInteger(day.steps)||day.steps<0)continue;
    if(next[day.date]?.steps!==day.steps)next[day.date]={...next[day.date],steps:day.steps};
  }
  const RECOVERY_FIELDS=['sleepMin','sleepScore','hrv','hrvWeekly','hrvLow','hrvHigh','hrvFloor','restingHr','bodyBattery'];
  for(const day of Array.isArray(data?.recovery)?data.recovery:[]){
    if(!day||!validCoachDate(day.date)||day.date>today)continue;
    const rec={};
    for(const k of RECOVERY_FIELDS)if(Number.isFinite(day[k]))rec[k]=Math.round(day[k]);
    if(typeof day.hrvStatus==='string'&&/^[A-Z]{3,12}$/.test(day.hrvStatus))rec.hrvStatus=day.hrvStatus;
    if(!Object.keys(rec).length||JSON.stringify(next[day.date]?.recovery)===JSON.stringify(rec))continue;
    next[day.date]={...next[day.date],recovery:rec};
  }
  for(const a of Array.isArray(data?.activities)?data.activities:[]){
    if(!a||typeof a.id!=='string'||!validCoachDate(a.date)||a.date>today)continue;
    const e=next[a.date]||{},seen=Array.isArray(e.garmin)?e.garmin:[];
    const known=seen.findIndex(g=>g.id===a.id);
    if(known>=0){
      // Already applied: only refresh the numbers (e.g. metrics added later), never the day's status.
      const m=metrics(a),old=seen[known];
      if(GARMIN_METRICS.some(k=>m[k]!=null&&old[k]!==m[k]))
        next[a.date]={...e,garmin:seen.map((g,i)=>i===known?{...g,...Object.fromEntries(Object.entries(m).filter(([,v])=>v!=null))}:g)};
      continue;
    }
    const type=garminSessionType(a.type),sessions=getSessions(e);
    const planned=type==='soccer'?sessions.find(s=>['Match','Team Training','Futsal'].includes(s))||null:type&&sessions.includes(type)?type:null;
    const fill=!planned&&!!type&&!sessions.length;
    const item={id:a.id,type:String(a.type||'other').slice(0,40),name:typeof a.name==='string'?a.name.slice(0,80):'',
      start:typeof a.start==='string'?a.start.slice(0,5):null,minutes:num(a.minutes),avgHr:num(a.avgHr),...metrics(a),matched:!!planned||fill};
    const patch={garmin:[...seen,item]};
    if(fill){patch.sessions=[type==='soccer'?'Futsal':type];patch.workout='';}
    if((planned||fill)&&!e.completed){patch.completed=true;completed.push(a.date);}
    next[a.date]={...e,...patch};
  }
  return {plan:next,completed};
}

// ─── Recovery ────────────────────────────────────────────────────────────────────
// Watch data for the night before `dk`, compared with his own baselines: HRV with Garmin's
// personal balanced range, resting HR with his previous 14 days, plus sleep length and Body
// Battery. A guide for training load, not a medical assessment.
const RECOVERY_LABELS={good:'Gut erholt',caution:'Eingeschränkt',low:'Wenig erholt'};
function fmtHM(minutes) { return Math.floor(minutes/60)+':'+String(Math.round(minutes%60)).padStart(2,'0')+' h'; }
function recoveryStatus(plan,dk) {
  const r=plan[dk]?.recovery;
  if(!r)return null;
  const signals=[],num=Number.isFinite;
  if(num(r.sleepMin))signals.push({key:'sleep',level:r.sleepMin<360?'low':r.sleepMin<420?'caution':'good',text:'Schlaf '+fmtHM(r.sleepMin),short:'Schlaf '+fmtHM(r.sleepMin)});
  if(num(r.hrv)){
    const level=num(r.hrvLow)?(num(r.hrvFloor)&&r.hrv<r.hrvFloor?'low':r.hrv<r.hrvLow?'caution':'good')
      :['LOW','POOR'].includes(r.hrvStatus)?'low':r.hrvStatus==='UNBALANCED'?'caution':'good';
    signals.push({key:'hrv',level,text:`HRV ${r.hrv} ms${level==='good'?'':' (unter Normalbereich)'}`,short:`HRV ${r.hrv} ↓`});
  }
  if(num(r.restingHr)){
    const prev=Array.from({length:14},(_,i)=>plan[daysBeforeStr(dk,i+1)]?.recovery?.restingHr).filter(num);
    const diff=prev.length>=4?r.restingHr-prev.reduce((n,v)=>n+v,0)/prev.length:null;
    const level=diff==null?'good':diff>=6?'low':diff>=3?'caution':'good';
    signals.push({key:'restingHr',level,text:`Ruhepuls ${r.restingHr}${diff!=null&&diff>=3?` (+${Math.round(diff)})`:''}`,short:`Ruhepuls ${r.restingHr} +${Math.round(diff??0)}`});
  }
  if(num(r.bodyBattery))signals.push({key:'bodyBattery',level:r.bodyBattery<30?'low':r.bodyBattery<50?'caution':'good',text:`Body Battery ${r.bodyBattery}`,short:`Body Battery ${r.bodyBattery}`});
  if(!signals.length)return null;
  const lows=signals.filter(x=>x.level==='low').length,cautions=signals.filter(x=>x.level==='caution').length;
  return {level:lows>=2?'low':lows===1||cautions>=2?'caution':'good',signals};
}

// ─── Complaints ──────────────────────────────────────────────────────────────────
// Reported only when something hurts; an episode stays active until marked as resolved.
// Stored top-level (`complaints`): {id, area, side, level 1–3, since, updated, resolved, log}.
const COMPLAINT_AREAS=[
  {key:'hip',label:'Hüfte',sided:true,lower:true},{key:'groin',label:'Leiste',sided:true,lower:true},
  {key:'hamstring',label:'Oberschenkel hinten',sided:true,lower:true},{key:'quad',label:'Oberschenkel vorne',sided:true,lower:true},
  {key:'knee',label:'Knie',sided:true,lower:true},{key:'calf',label:'Wade/Achilles',sided:true,lower:true},
  {key:'ankle',label:'Sprunggelenk/Fuss',sided:true,lower:true},{key:'back',label:'Rücken',sided:false,lower:true},
  {key:'shoulder',label:'Schulter',sided:true,lower:false},{key:'other',label:'Anderes',sided:false,lower:false},
];
const COMPLAINT_LEVELS=[{level:1,label:'Leicht',hint:'Zwickt, Training geht'},{level:2,label:'Mittel',hint:'Stört, Training nur eingeschränkt'},{level:3,label:'Stark',hint:'Training nicht möglich'}];
function complaintArea(key) { return COMPLAINT_AREAS.find(a=>a.key===key)||COMPLAINT_AREAS.at(-1); }
function complaintLabel(c) { return complaintArea(c.area).label+(c.side?' '+c.side:''); }
function activeComplaints(list,today=todayStr()) { return (Array.isArray(list)?list:[]).filter(c=>c&&!c.resolved&&c.since<=today&&[1,2,3].includes(c.level)); }
// Same area and side while still active = an update of that episode, not a new one.
function reportComplaint(list,{area,side=null,level},today=todayStr()) {
  const all=Array.isArray(list)?list:[],key=complaintArea(area).key,sd=complaintArea(area).sided&&['links','rechts'].includes(side)?side:null;
  if(![1,2,3].includes(level))return all;
  const existing=all.find(c=>!c.resolved&&c.area===key&&(c.side||null)===sd);
  if(existing)return all.map(c=>c===existing?{...c,level,updated:today,log:[...(c.log||[]),{date:today,level}].slice(-30)}:c);
  return [...all,{id:`${today}-${key}-${sd||'x'}-${Math.random().toString(36).slice(2,6)}`,area:key,side:sd,level,since:today,updated:today,resolved:null,log:[{date:today,level}]}].slice(-40);
}
function resolveComplaint(list,id,today=todayStr()) {
  return (Array.isArray(list)?list:[]).map(c=>c.id===id&&!c.resolved?{...c,resolved:today,updated:today,log:[...(c.log||[]),{date:today,level:0}].slice(-30)}:c);
}
function complaintTrend(c) { const l=(c.log||[]).filter(x=>x.level>0);if(l.length<2)return 'new';const a=l.at(-2).level,b=l.at(-1).level;return b<a?'better':b>a?'worse':'same'; }
function complaintDays(c,today=todayStr()) { const u=x=>{const [y,m,d]=x.split('-').map(Number);return Date.UTC(y,m-1,d);};return Math.round((u(today)-u(c.since))/86400000)+1; }
// Worst level within one week, counting the level it had when the week started.
function complaintLevelIn(c,from,to) {
  const log=(c.log||[]).filter(x=>x.level>0),before=log.filter(x=>x.date<from).at(-1);
  const levels=[...(before?[before.level]:[]),...log.filter(x=>x.date>=from&&x.date<=to).map(x=>x.level)];
  return levels.length?Math.max(...levels):c.level;
}
// Complaints that were active at some point between from and to.
function complaintsInRange(list,from,to) {
  return (Array.isArray(list)?list:[]).filter(c=>c&&c.since<=to&&(!c.resolved||c.resolved>=from)).map(c=>({area:complaintLabel(c),
    level:COMPLAINT_LEVELS[complaintLevelIn(c,from,to)-1]?.label||null,since:c.since,resolved:c.resolved&&c.resolved<=to?c.resolved:null}));
}
function complaintsForCoach(list,today=todayStr()) {
  const all=Array.isArray(list)?list:[];
  return {active:activeComplaints(all,today).map(c=>({area:complaintLabel(c),level:COMPLAINT_LEVELS[c.level-1].label,lowerBody:complaintArea(c.area).lower,
      since:c.since,daysActive:complaintDays(c,today),lastUpdate:c.updated,trend:complaintTrend(c)})),
    recentlyResolved:all.filter(c=>c.resolved&&c.resolved>=daysBeforeStr(today,14)).map(c=>({area:complaintLabel(c),since:c.since,resolved:c.resolved}))};
}

// ─── Social matches ──────────────────────────────────────────────────────────────
// Restaurant, bar or dinner with friends: three yes/no rules fixed before kick-off, scored after.
// Sieg 3 (all kept), Unentschieden 1 (two), Niederlage 0. Testspiele are planned free evenings
// and never count. Stored top-level: socialMatches [{id,date,kickoff,occasion,rules,friendly,
// result:{kept,outcome,points,at}|null,created}], socialRules (his three standard rules) and
// socialHolidays [{id,name,start,end}] for holiday tournaments.
const SOCIAL_OCCASIONS=[{key:'restaurant',label:'Restaurant'},{key:'bar',label:'Bar'},{key:'home',label:'Freunde/Familie'},{key:'other',label:'Anderes'}];
const DEFAULT_SOCIAL_RULES=['Maximal zwei Drinks','Ein Extra: Brot, Vorspeise oder Dessert','Ein Teller, kein Nachschöpfen'];
const SOCIAL_RULE_OPTIONS=[...DEFAULT_SOCIAL_RULES,'Kein Snack danach','Kein Dessert','Wasser zwischen den Drinks','Kein Alkohol','Nach 22 Uhr nichts mehr essen'];
const SOCIAL_OUTCOMES={win:{label:'Sieg',short:'S',points:3},draw:{label:'Unentschieden',short:'U',points:1},loss:{label:'Niederlage',short:'N',points:0}};
const SOCIAL_GOAL=2;
const socialText=v=>typeof v==='string'?v.trim().replace(/\s+/g,' ').replace(/ß/g,'ss').slice(0,60):'';
const dayNumber=dk=>{const [y,m,d]=dk.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;};
function occasionLabel(key) { return (SOCIAL_OCCASIONS.find(o=>o.key===key)||SOCIAL_OCCASIONS.at(-1)).label; }
function validSocialMatch(m) {
  return !!m&&typeof m.id==='string'&&validCoachDate(m.date)&&/^\d{2}:\d{2}$/.test(m.kickoff||'')&&Array.isArray(m.rules)&&(m.friendly||m.rules.length===3);
}
function socialMatches(list) { return (Array.isArray(list)?list:[]).filter(validSocialMatch).sort((a,b)=>(a.date+a.kickoff).localeCompare(b.date+b.kickoff)); }
function socialRules(stored) { const r=Array.isArray(stored)?stored.map(socialText).filter(Boolean):[]; return r.length===3&&new Set(r).size===3?r:[...DEFAULT_SOCIAL_RULES]; }
function socialOutcome(kept) { const n=(kept||[]).filter(Boolean).length; return n===3?'win':n===2?'draw':'loss'; }
// Kick-off in local time: from then on the rules are fixed.
function socialStarted(m,now=new Date()) {
  const [y,mo,d]=m.date.split('-').map(Number),[h,mi]=m.kickoff.split(':').map(Number);
  return now.getTime()>=new Date(y,mo-1,d,h,mi).getTime();
}
function holidayPeriods(list) {
  return (Array.isArray(list)?list:[]).filter(h=>h&&typeof h.id==='string'&&validCoachDate(h.start)&&validCoachDate(h.end)&&h.start<=h.end)
    .sort((a,b)=>a.start.localeCompare(b.start));
}
function holidayFor(list,dk) { return holidayPeriods(list).find(h=>dk>=h.start&&dk<=h.end)||null; }
function addHoliday(list,{name,start,end}) {
  const all=holidayPeriods(list);
  if(!validCoachDate(start)||!validCoachDate(end)||start>end||dayNumber(end)-dayNumber(start)>60)return {list:all,error:'Bitte gültige Daten wählen (höchstens 60 Tage).'};
  if(all.some(h=>start<=h.end&&end>=h.start))return {list:all,error:'Überschneidet sich mit eingetragenen Ferien.'};
  const h={id:`hol-${start}-${Math.random().toString(36).slice(2,6)}`,name:socialText(name)||'Ferien',start,end};
  return {list:holidayPeriods([...all,h]).slice(-20)};
}
function removeHoliday(list,id) { return holidayPeriods(list).filter(h=>h.id!==id); }
// Testspiele: one per week (Mon–Sun); during holidays one every three days.
function friendlyAllowed(list,date,holidays=[],excludeId=null) {
  const others=socialMatches(list).filter(m=>m.friendly&&m.id!==excludeId);
  if(holidayFor(holidays,date)){
    const near=others.find(m=>Math.abs(dayNumber(m.date)-dayNumber(date))<=2);
    return near?{ok:false,reason:`Testspiel schon am ${shortDate(near.date)}. In den Ferien eins alle drei Tage.`}:{ok:true};
  }
  const week=weekAround(date),hit=others.find(m=>m.date>=week[0]&&m.date<=week[6]&&!holidayFor(holidays,m.date));
  return hit?{ok:false,reason:`Diese Woche ist schon ein Testspiel geplant (${shortDate(hit.date)}). Höchstens eins pro Woche.`}:{ok:true};
}
// One match per day. Planning and changes only before kick-off.
function planSocialMatch(list,input,holidays=[],now=new Date()) {
  const all=socialMatches(list),today=dateKey(now),date=input?.date;
  const existing=input?.id?all.find(m=>m.id===input.id):null;
  if(existing&&socialStarted(existing,now))return {list:all,error:'Das Match läuft schon. Die Regeln sind fix.'};
  if(!validCoachDate(date)||date<today)return {list:all,error:'Wähle heute oder einen späteren Tag.'};
  if(all.some(m=>m.date===date&&m.id!==existing?.id))return {list:all,error:'An diesem Tag ist schon ein Social Match geplant.'};
  const friendly=!!input.friendly;
  if(friendly){const f=friendlyAllowed(all,date,holidays,existing?.id);if(!f.ok)return {list:all,error:f.reason};}
  const rules=friendly?[]:(Array.isArray(input.rules)?input.rules.map(socialText).filter(Boolean):[]);
  if(!friendly&&(rules.length!==3||new Set(rules).size!==3))return {list:all,error:'Wähle genau drei verschiedene Regeln.'};
  const m={id:existing?.id||`sm-${date}-${Math.random().toString(36).slice(2,6)}`,date,
    kickoff:/^([01]\d|2[0-3]):[0-5]\d$/.test(input.kickoff||'')?input.kickoff:'19:00',
    occasion:SOCIAL_OCCASIONS.some(o=>o.key===input.occasion)?input.occasion:'other',rules,friendly,result:null,created:existing?.created||today};
  if(socialStarted(m,now))return {list:all,error:'Der Anpfiff muss noch vor dir liegen. Regeln gelten nur, wenn sie vorher feststehen.'};
  return {list:socialMatches([...all.filter(x=>x.id!==m.id),m]).slice(-300),match:m};
}
// Cancelled or did not happen: allowed as long as there is no result.
function cancelSocialMatch(list,id) { return socialMatches(list).filter(m=>!(m.id===id&&!m.result)); }
function evaluateSocialMatch(list,id,kept,now=new Date()) {
  const all=socialMatches(list),m=all.find(x=>x.id===id);
  if(!m||m.friendly||!socialStarted(m,now)||!Array.isArray(kept)||kept.length!==3||kept.some(k=>typeof k!=='boolean'))return all;
  const outcome=socialOutcome(kept);
  return all.map(x=>x===m?{...x,result:{kept:[...kept],outcome,points:SOCIAL_OUTCOMES[outcome].points,at:dateKey(now)}}:x);
}
function socialPending(list,now=new Date()) { return socialMatches(list).filter(m=>!m.friendly&&!m.result&&socialStarted(m,now)); }
function socialTable(list,from=null,to=null,today=todayStr()) {
  const all=socialMatches(list).filter(m=>(!from||m.date>=from)&&(!to||m.date<=to));
  const played=all.filter(m=>!m.friendly&&m.result),count=o=>played.filter(m=>m.result.outcome===o).length;
  const points=played.reduce((n,m)=>n+m.result.points,0),broken={};
  for(const m of played)m.rules.forEach((r,i)=>{if(!m.result.kept[i])broken[r]=(broken[r]||0)+1;});
  return {played:played.length,wins:count('win'),draws:count('draw'),losses:count('loss'),points,
    avg:played.length?Math.round(points/played.length*10)/10:null,form:played.slice(-5).map(m=>m.result.outcome),
    friendlies:all.filter(m=>m.friendly&&m.date<=today).length,
    brokenRules:Object.entries(broken).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([rule,times])=>({rule,times}))};
}
function holidayTournaments(list,holidays) { return holidayPeriods(holidays).map(h=>({...h,table:socialTable(list,h.start,h.end)})); }
function socialForCoach(list,holidays,today=todayStr(),now=new Date()) {
  const all=socialMatches(list),holiday=holidayFor(holidays,today),next=holidayPeriods(holidays).find(h=>h.start>today);
  const brief=m=>({date:m.date,kickoff:m.kickoff,occasion:occasionLabel(m.occasion),friendly:!!m.friendly,...(m.friendly?{}:{rules:m.rules})});
  return {goalAvgPoints:SOCIAL_GOAL,season:socialTable(all),
    upcoming:all.filter(m=>!m.result&&!socialStarted(m,now)).slice(0,5).map(brief),
    awaitingResult:socialPending(all,now).map(brief),
    recent:all.filter(m=>m.result||(m.friendly&&socialStarted(m,now))).slice(-6).map(m=>({...brief(m),
      ...(m.result?{outcome:SOCIAL_OUTCOMES[m.result.outcome].label,points:m.result.points,brokenRules:m.rules.filter((r,i)=>!m.result.kept[i])}:{})})),
    holiday:holiday?{name:holiday.name,start:holiday.start,end:holiday.end,table:socialTable(all,holiday.start,holiday.end)}:null,
    nextHoliday:next?{name:next.name,start:next.start,end:next.end}:null,
    friendlyAvailableToday:friendlyAllowed(all,today,holidays).ok};
}

// ─── Training load ───────────────────────────────────────────────────────────────
// Garmin's own Acute Load / Training Status is not in the personal API, so the app
// rebuilds the idea from each activity's Garmin training load: acute = last 7 days,
// normal range = 0.8–1.3 × his average week of the last 4 weeks. An orientation for
// dosing training, not an injury predictor. Only activities recorded on the watch count.
const LOAD_TYPE_FOR_SESSION={Gym:'Gym','Easy run':'Easy run',Walking:'Walking',Match:'soccer','Team Training':'soccer',Futsal:'soccer',Pilates:'Pilates',Mobility:'Mobility'};
const LOAD_LABELS={low:'Unter deinem Bereich',optimal:'Im optimalen Bereich',high:'Über deinem Bereich',veryHigh:'Deutlich über deinem Bereich'};
function dayLoad(e) { return (Array.isArray(e?.garmin)?e.garmin:[]).reduce((n,g)=>n+(Number.isFinite(g.load)&&g.load>0?g.load:0),0); }
// Typical load per session type from his own last 60 days (median).
function typicalLoads(plan,dk=todayStr()) {
  const by={};
  for(let i=0;i<60;i++)for(const g of plan[daysBeforeStr(dk,i)]?.garmin||[]){
    const t=garminSessionType(g.type);
    if(t&&Number.isFinite(g.load)&&g.load>0)(by[t]=by[t]||[]).push(g.load);
  }
  return Object.fromEntries(Object.entries(by).map(([t,v])=>{v.sort((a,b)=>a-b);const m=v.length>>1;return [t,Math.round(v.length%2?v[m]:(v[m-1]+v[m])/2)];}));
}
function loadStatus(plan,dk=todayStr()) {
  const sum=(from,n)=>{let total=0;for(let i=from;i<from+n;i++)total+=dayLoad(plan[daysBeforeStr(dk,i)]);return total;};
  const tracked=Object.keys(plan).filter(d=>d<=dk&&Array.isArray(plan[d]?.garmin)&&plan[d].garmin.length).sort();
  const utc=x=>{const [y,m,d]=x.split('-').map(Number);return Date.UTC(y,m-1,d);};
  const historyDays=tracked.length?Math.round((utc(dk)-utc(tracked[0]))/86400000)+1:0;
  const acute=Math.round(sum(0,7)),weekly=sum(0,28)/4;
  if(historyDays<21||weekly<=0)return {ready:false,historyDays,acute};
  const ratio=acute/weekly,low=Math.round(weekly*0.8),high=Math.round(weekly*1.3);
  return {ready:true,acute,weekly:Math.round(weekly),low,high,veryHigh:Math.round(weekly*1.5),ratio:Math.round(ratio*100)/100,
    status:ratio<0.8?'low':ratio<=1.3?'optimal':ratio<=1.5?'high':'veryHigh',headroom:Math.max(0,high-acute)};
}
// Today's planned sessions that are not done yet, with their typical load (when known).
function plannedLoad(plan,dk,typical) {
  const e=plan[dk]||{};
  if(e.completed||(e.garmin||[]).some(g=>g.matched))return {sessions:[],load:0};
  const sessions=getSessions(e).filter(s=>LOAD_TYPE_FOR_SESSION[s]&&typical[LOAD_TYPE_FOR_SESSION[s]]);
  return {sessions,load:sessions.reduce((n,s)=>n+typical[LOAD_TYPE_FOR_SESSION[s]],0)};
}
function loadAdvice(plan,dk=todayStr(),status=loadStatus(plan,dk),recovery=recoveryStatus(plan,dk),complaints=[]) {
  // A complaint from "Mittel" upwards counts even without enough watch data.
  const hurting=activeComplaints(complaints,dk).filter(c=>c.level>=2).sort((a,b)=>b.level-a.level)[0];
  if(hurting)return hurting.level===3?`Wegen ${complaintLabel(hurting)} (stark): heute keine Belastung für diese Stelle. Hält es an, abklären lassen.`
    :`Wegen ${complaintLabel(hurting)}: keine Zusatzeinheit, nur schmerzfreie Bewegungen.`;
  if(!status.ready)return `Noch zu wenig Daten von der Uhr: ${status.historyDays} von 21 Tagen.`;
  const typical=typicalLoads(plan,dk),planned=plannedLoad(plan,dk,typical);
  const label=planned.sessions.map(displayName).join(' + ');
  if(recovery?.level==='low')return 'Die Erholung ist heute niedrig. Unabhängig von der Belastung: nur locker oder Pause.';
  if(status.status==='high'||status.status==='veryHigh')
    return planned.load?`Du liegst schon über deinem Bereich. ${label} (≈ ${planned.load}) heute kürzer oder lockerer halten.`
      :'Du liegst über deinem Bereich. Heute keine Zusatzeinheit, höchstens Mobilität oder Spazieren.';
  if(planned.load){
    const after=status.acute+planned.load;
    return after<=status.high?`Mit ${label} (≈ ${planned.load}) bleibst du im Bereich.`
      :`Mit ${label} (≈ ${planned.load}) kommst du auf ${after}, knapp über deinem Bereich. Kontrolliert halten.`;
  }
  const run=typical['Easy run'];
  if(status.status==='low')return run&&status.headroom>=run?`Du liegst unter deinem Bereich. Ein lockerer Lauf (≈ ${run}) passt gut.`:'Du liegst unter deinem Bereich. Eine zusätzliche Einheit passt.';
  if(run&&status.headroom>=run)return `Spielraum ca. ${status.headroom}: Ein lockerer Lauf (≈ ${run}) liegt noch drin.`;
  return 'Du bist im Bereich. Mehr braucht es heute nicht.';
}
// Weekly totals (Mon–Sun) for the n weeks up to the week of dk.
function weeklyLoads(plan,dk=todayStr(),n=6) {
  const monday=weekAround(dk)[0];
  return Array.from({length:n},(_,i)=>{const from=daysBeforeStr(monday,(n-1-i)*7);
    let total=0;for(let d=0;d<7;d++)total+=dayLoad(plan[daysBeforeStr(from,-d)]);return {from,load:Math.round(total)};});
}

// ─── Weekly plan proposal ────────────────────────────────────────────────────────
// Fixed: games, team training, sick days, own custom sessions, finished or past days.
// Applying changes only open days (and guidance on fixed days still ahead); the previous
// sessions/guidance are kept so the whole proposal can be undone.
const PLAN_SESSIONS=['Match','Team Training','Futsal','Gym','Pilates','Mobility','Walking','Easy run'];
function planWeekInput(plan,weekStart,today=todayStr(),complaints=[]) {
  const days=Array.from({length:7},(_,i)=>daysBeforeStr(weekStart,-i));
  return {weekStart,matchDayBefore:isMatchDay(plan[daysBeforeStr(weekStart,1)]),
    complaints:activeComplaints(complaints,today).map(c=>({area:complaintLabel(c),level:c.level,lowerBody:complaintArea(c.area).lower})),
    days:days.map(date=>{
      const e=plan[date]||{},sessions=getSessions(e),locked=date<today||!!e.completed;
      const fixed=locked||isMatchDay(e)||sessions.some(x=>x==='Team Training'||x==='Sick/Injured'||!PLAN_SESSIONS.includes(x));
      return {date,sessions,fixed,locked,completed:!!e.completed,match:e.match?{opponent:e.match.opponent,kickoff:e.match.kickoff}:null,currentTitle:coachingFor(e)?.title||''};
    })};
}
function applyWeekProposal(plan,proposal,today=todayStr()) {
  const next={...plan},previous={};
  for(const d of Array.isArray(proposal?.days)?proposal.days:[]){
    const e=plan[d?.date];
    if(!d||!validCoachDate(d.date)||d.date<today||e?.completed)continue;
    const current=getSessions(e),open=!d.fixed;
    const sessions=open?(Array.isArray(d.sessions)?d.sessions:[]).filter(x=>PLAN_SESSIONS.includes(x)).slice(0,2):current;
    const title=typeof d.title==='string'?d.title.slice(0,60):'',text=typeof d.guidance==='string'?d.guidance.slice(0,220):'';
    if(!open&&!title&&!text)continue;
    previous[d.date]={sessions:current,workout:e?.workout??'',coaching:e?.coaching??null};
    next[d.date]={...(e||{}),sessions,workout:'',coaching:title||text?{sessions,title:title||sessionsLabel({sessions})||'Ruhetag',text}:null};
  }
  return {plan:next,previous};
}
// Restores sessions and guidance only; notes, food, body values and logs stay as they are now.
function undoWeekProposal(plan,previous) {
  const next={...plan};
  for(const [date,prev] of Object.entries(previous||{})){
    const e=next[date];
    if(!e||e.completed)continue;
    next[date]={...e,sessions:prev.sessions||[],workout:prev.workout||'',coaching:prev.coaching||null};
  }
  return next;
}

// ─── Withings import ─────────────────────────────────────────────────────────────
const WITHINGS_FULL_DAYS=180;
// Incremental sync only after a full 180-day load succeeded for the same account;
// otherwise (first sync, account switch, failed reload) load the full window again.
function withingsWindow(last,today=todayStr()) {
  const full=daysBeforeStr(today,WITHINGS_FULL_DAYS);
  const incremental=!!(last?.through&&last.account&&last.fullFor===last.account);
  return incremental?{from:daysBeforeStr(last.through,3),full:false}:{from:full,full:true};
}
function scaleSummary(plan) {
  const days=Object.keys(plan).filter(dk=>plan[dk]?.bodySource==='withings'&&(plan[dk].weight!=null||plan[dk].bodyFat!=null)).sort();
  return {count:days.length,since:days[0]||null};
}
// Scale readings fill weight/body fat per day. Anything the player entered or
// corrected by hand (bodySource 'manual', or values without a source) always wins.
// With `cleanFrom`, earlier scale values from cleanFrom..today that Withings no longer
// returns (deleted there, or from another account) are removed.
function applyWithingsImport(plan,days,today=todayStr(),cleanFrom=null) {
  const next={...plan},updated=[],removed=[];
  if(cleanFrom){
    const present=new Set((Array.isArray(days)?days:[]).map(d=>d?.date));
    for(const dk of Object.keys(next)){
      const e=next[dk];
      if(e?.bodySource!=='withings'||dk<cleanFrom||dk>today||present.has(dk))continue;
      const {bodySource,...rest}=e;
      next[dk]={...rest,weight:null,bodyFat:null};removed.push(dk);
    }
  }
  const valid=(v,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<hi;
  for(const d of Array.isArray(days)?days:[]){
    if(!d||!validCoachDate(d.date)||d.date>today)continue;
    const e=next[d.date]||{};
    if(e.bodySource==='manual'||(e.bodySource!=='withings'&&(e.weight!=null||e.bodyFat!=null)))continue;
    const weight=valid(d.weight,500)?d.weight:e.weight??null,bodyFat=valid(d.bodyFat,100)?d.bodyFat:e.bodyFat??null;
    if(weight==null&&bodyFat==null)continue;
    if(e.bodySource==='withings'&&e.weight===weight&&e.bodyFat===bodyFat)continue;
    next[d.date]={...e,weight,bodyFat,bodySource:'withings'};updated.push(d.date);
  }
  return {plan:next,updated,removed};
}

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
function buildCoachContext(plan,playerName,viewKey,referenceDate=todayStr(),proteinTarget=DEFAULT_PROTEIN_TARGET,complaints=[],social=null) {
  const dates=Object.keys(plan).filter(dk=>validCoachDate(dk)&&plan[dk]&&typeof plan[dk]==='object').sort();
  const types=dk=>[...new Set(getSessions(plan[dk]))];
  const logged=dk=>dk<=referenceDate&&plan[dk]?.completed===true&&types(dk).length>0;
  const target=validProteinTarget(proteinTarget)?proteinTarget:DEFAULT_PROTEIN_TARGET;
  // Self-reported eating; never sent for future dates. Missing stays null, not zero.
  const eating=dk=>{
    const e=plan[dk]||{},protein=dayProtein(e),rating=nutritionLevel(e.nutrition)?e.nutrition:null,meals=dayMeals(e);
    if(dk>referenceDate||(protein==null&&!rating&&!meals.length))return null;
    return {proteinGrams:protein,rating,...(meals.length?{kcal:dayKcal(e),
      meals:meals.slice(0,8).map(m=>({title:coachText(m.title,40),kcal:Math.round(m.kcal),proteinGrams:Math.round(m.protein),...(m.source==='favorite'?{fromFavorite:true}:{})}))}:{})};
  };
  const eatingStats=(from,to)=>{
    const keys=Array.from({length:7},(_,i)=>daysBeforeStr(to,6-i)),s=nutritionSummary(plan,keys,target);
    return {from,to,proteinLoggedDays:s.proteinDays,proteinTargetHitDays:s.hits,avgProteinGrams:s.avgProtein,ratedDays:s.ratedDays,ratings:s.counts,
      kcalLoggedDays:s.kcalDays,avgKcal:s.avgKcal};
  };
  const day=dk=>{
    const e=plan[dk]||{},sessions=types(dk),guidance=coachingFor(e);
    const past=dk<=referenceDate;
    return {date:dk,sessions:sessions.map(displayName),nutrition:eating(dk),
      steps:past&&Number.isInteger(e.steps)?e.steps:null,
      recovery:past&&e.recovery?{sleepMinutes:e.recovery.sleepMin??null,sleepScore:e.recovery.sleepScore??null,hrvMs:e.recovery.hrv??null,
        hrvBalancedRange:e.recovery.hrvLow!=null&&e.recovery.hrvHigh!=null?[e.recovery.hrvLow,e.recovery.hrvHigh]:null,hrvStatus:e.recovery.hrvStatus??null,
        restingHr:e.recovery.restingHr??null,bodyBatteryMax:e.recovery.bodyBattery??null}:null,
      watchActivities:past&&Array.isArray(e.garmin)&&e.garmin.length?e.garmin.slice(0,4).map(g=>({type:coachText(g.type,40),minutes:g.minutes??null,avgHr:g.avgHr??null,
        distanceKm:g.distanceKm??null,maxSpeedKmh:g.maxSpeedKmh??null,trainingLoad:g.load??null,highHrMinutes:g.highHrMin??null,matchedPlan:!!g.matched})):null,
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
    today:{...day(referenceDate),recoveryAssessment:(r=>r?{level:r.level,signals:r.signals.map(x=>({signal:x.key,level:x.level,text:x.text}))}:null)(recoveryStatus(plan,referenceDate))},selectedDay:viewKey!==referenceDate?day(viewKey):null,
    recentDays:Array.from({length:14},(_,i)=>day(daysBeforeStr(referenceDate,14-i))),
    upcoming:Array.from({length:7},(_,i)=>day(daysBeforeStr(referenceDate,-i-1))),
    nextMatch:nextMatchDate?{...day(nextMatchDate),daysAway:dayDistance(nextMatchDate)}:null,
    week:{...stats(weekDays[0],weekDays[6]),targets},
    history:{allTime:stats(dates[0]&&dates[0]<referenceDate?dates[0]:referenceDate,referenceDate),
      last8Weeks:Array.from({length:8},(_,i)=>{const from=daysBeforeStr(weekDays[0],(8-i)*7);return stats(from,daysBeforeStr(from,-6));})},
    body:{weight:bodyMetric('weight'),bodyFat:bodyMetric('bodyFat')},
    load:(()=>{const st=loadStatus(plan,referenceDate);if(!st.ready)return {ready:false,daysOfWatchData:st.historyDays,acute7Days:st.acute};
      const typical=typicalLoads(plan,referenceDate),planned=plannedLoad(plan,referenceDate,typical);
      return {ready:true,acute7Days:st.acute,averageWeek4Weeks:st.weekly,optimalRange:[st.low,st.high],ratio:st.ratio,status:st.status,headroomToday:st.headroom,
        plannedTodayLoad:planned.load||null,typicalLoadBySession:Object.fromEntries(Object.entries(typical).map(([k,v])=>[GARMIN_LABELS[k]||k,v])),
        last6Weeks:weeklyLoads(plan,referenceDate,6),appAdvice:loadAdvice(plan,referenceDate,st,recoveryStatus(plan,referenceDate),complaints)};})(),
    complaints:complaintsForCoach(complaints,referenceDate),
    social:socialForCoach(social?.matches,social?.holidays,referenceDate),
    nutrition:{proteinTargetGrams:target,last7Days:eatingStats(daysBeforeStr(referenceDate,6),referenceDate),
      previous7Days:eatingStats(daysBeforeStr(referenceDate,13),daysBeforeStr(referenceDate,7))},
    tactical:tacticalFor(referenceDate)};
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
    // One distinct icon per session type; Futsal and team training share the ball.
    Match:<><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.6"/><path d="M2.5 9.5H5v5H2.5M21.5 9.5H19v5h2.5"/></>,
    ball:<><circle cx="12" cy="12" r="9"/><path d="m12 8.2 3.6 2.6-1.4 4.2H9.8l-1.4-4.2z"/><path d="M12 3v5.2M15.6 10.8l4.9-1.6M14.2 15l3 4.2M9.8 15l-3 4.2M8.4 10.8 3.5 9.2"/></>,
    Gym:<><path d="M7 12h10M2 10v4M22 10v4"/><rect x="4" y="7" width="3" height="10" rx="1"/><rect x="17" y="7" width="3" height="10" rx="1"/></>,
    Pilates:<><circle cx="6.5" cy="8" r="2"/><path d="M2 20h20M8 11.5l3.5 7.5 6.5-9M9 13.5l6.5-3.5"/></>,
    Mobility:<><path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6z"/><path d="M12 9v6M9 12h6"/></>,
    Walking:<><ellipse cx="7.5" cy="7.5" rx="2.7" ry="4.3"/><path d="M5.6 14.2h3.8v1.6a1.9 1.9 0 0 1-3.8 0z"/><ellipse cx="16.5" cy="10.5" rx="2.7" ry="4.3"/><path d="M14.6 17.2h3.8v1.6a1.9 1.9 0 0 1-3.8 0z"/></>,
    "Easy run":<><circle cx="15" cy="4.5" r="1.8"/><path d="M13.6 7.5 11 13l3 3 1.5 4.5M11 13l-2.5 3.5L5 17.5M13 8.5l3 2 2.5-1.5M13 8.5l-3 1.5-2-1.5"/></>,
    "Sick/Injured":<g transform="rotate(-45 12 12)"><rect x="2.5" y="8.5" width="19" height="7" rx="3.5"/><path d="M9.5 8.5v7M14.5 8.5v7"/></g>,
    rest:<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>,
    custom:<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="m9 2-1 3-3 1-3 3 2 3-2 3 3 3 3 1 1 3h6l1-3 3-1 3-3-2-3 2-3-3-3-3-1-1-3z"/></>,
    focus:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 9-9"/></>,
    watch:<><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6V3h6v3M9 18v3h6v-3M12 9.5V12l1.5 1.5"/></>,
    body:<><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7.5 10a6 6 0 0 1 9 0M12 10l1.8-2.2"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,
    back:<path d="M15 18 9 12l6-6"/>,
    send:<path d="M12 19V5M6 11l6-6 6 6"/>,
    image:<><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 15.5-4.5-4.5L8 19.5"/></>,
    chevron:<path d="m6 9 6 6 6-6"/>,
    check:<path d="m5 12.5 4.5 4.5L19 7.5"/>,
    glass:<><path d="M7 3h10l-.6 6.2a4.4 4.4 0 0 1-8.8 0z"/><path d="M12 13.6V20M8.5 20.5h7"/></>,
    star:<path d="m12 3.6 2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62 6.9 19.3l.98-5.68-4.13-4.02 5.7-.83z"/>,
    alert:<><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17h.01"/></>,
    camera:<><path d="M3.5 8.5h3.2L8.5 6h7l1.8 2.5h3.2V19h-17z"/><circle cx="12" cy="13" r="3.4"/></>,
  };
  const resolved=name==="Futsal"||name==="Team Training"?"ball":name==="plan"?"month":name==="season"?"journey":name;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[resolved]||paths.custom}</svg>;
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
:root{--bg:#101A25;--surface:#15222F;--panel:#1C2937;--raised:#29424E;--track:#263C4D;--line:#344858;--line-soft:#2D4151;--line-strong:#486171;--edge:#648694;
--text:#EDF2F5;--muted:#A5B8C8;--faint:#839BAD;--accent:#9CCBD3;--accent-ink:#B3DCE2;--good:#8FD19E;--good-soft:#A9D8B8;--warn:#E9C46A;--bad:#E58A7E;--bad-ink:#F0A99F;
--gold:#F0CF95;--gold-line:#9F8358;--r-s:12px;--r-m:14px;--r-l:22px;--r-pill:99px}
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);font-synthesis:none}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button{color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:disabled{cursor:default;opacity:.45}button:not(:disabled):active{transform:scale(.98)}button{transition:background .18s,border-color .18s,transform .15s}
input,textarea{min-width:0;font-size:16px!important}input::placeholder,textarea::placeholder{color:var(--faint)}
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent-ink)!important;outline-offset:4px}
button,a,input,summary{touch-action:manipulation}h1,h2,h3,p{margin:0}h1,h2,h3{font-weight:600;letter-spacing:-.035em}
.app-shell{max-width:560px;margin:auto;min-height:100dvh;background:radial-gradient(ellipse 100% 500px at 80% 0%,#223B50 0%,var(--bg) 85%);padding-bottom:calc(96px + env(safe-area-inset-bottom))}
.app-header{position:relative;isolation:isolate;overflow:hidden;padding:calc(12px + env(safe-area-inset-top)) 22px 12px}
.pitch-texture{position:absolute;inset:0;width:100%;height:100%;color:var(--accent);opacity:.14;z-index:-1;pointer-events:none}
.brand-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}
.brand{font-size:11px;letter-spacing:.26em;color:var(--accent-ink);font-weight:600}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:0;border-radius:var(--r-s);background:transparent;color:var(--muted)}
.app-header h1{font-size:clamp(28px,7.6vw,38px);line-height:1.1;margin-bottom:4px;letter-spacing:-.05em}
.subtitle{color:var(--muted);font-size:13px;line-height:1.5}
.phase-link{display:inline-flex;gap:8px;align-items:center;color:var(--muted);background:none;border:0;padding:4px 0;min-height:44px;font-size:12px}
.view{padding:0 20px 24px}.eyebrow{font-size:11px;letter-spacing:.17em;text-transform:uppercase;color:var(--accent-ink);font-weight:600}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 0 14px}.section-heading h2{font-size:20px}.section-heading small{font-size:12px;color:var(--muted)}
.panel{background:linear-gradient(135deg,#1C2C3A,#192632);border:1px solid #2A3C4B;border-radius:var(--r-l)}
.day-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;flex:1;min-width:0}
.day-chip{border:1px solid transparent;background:transparent;border-radius:var(--r-m);padding:8px 0 6px;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px}
.day-chip .day-label{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em}
.day-chip strong{font-size:18px;font-weight:500}.day-chip[aria-pressed=true]{background:var(--accent);color:var(--bg)}
.day-chip[aria-pressed=true] .day-label{color:#233B47}.day-marker{height:5px;width:5px;border-radius:50%;background:#577184}.day-chip[aria-pressed=true] .day-marker{background:#274854}
.session-card{padding:20px;position:relative;overflow:hidden;scroll-margin-top:16px}.session-card h2{font-size:clamp(25px,7vw,34px);line-height:1.12;overflow-wrap:anywhere;-webkit-hyphens:manual;hyphens:manual}
.session-sub{font-size:14px;color:var(--muted);line-height:1.6}.session-card-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.session-art{color:var(--accent);opacity:.65;display:flex;gap:5px}.session-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
.action-links{display:flex;gap:8px;flex-wrap:wrap}.text-btn{display:inline-flex;gap:8px;align-items:center;min-height:44px;padding:6px 0;border:0;background:transparent;color:var(--muted);font-size:12px}
.log-circle{width:74px;height:74px;flex-shrink:0;border-radius:50%;border:2px solid var(--accent);background:transparent;color:var(--accent-ink);font-size:13px;letter-spacing:.1em;font-weight:700;display:flex;align-items:center;justify-content:center}
.log-circle.logged{background:var(--accent);color:var(--bg);animation:checkPop .3s ease-out}
.session-details{border-top:1px solid var(--line);margin-top:20px;padding-top:4px}.session-details summary{font-size:12px;color:var(--muted);cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between}
.session-details summary:after{content:"+";font-size:18px}.session-details[open] summary:after{content:"−"}
.notes{width:100%;padding:12px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:var(--r-s);margin-top:12px;line-height:1.5}
.target-panel{padding:0 18px}.target-row{display:flex;align-items:center;gap:14px;padding:18px 0}.target-row+.target-row{border-top:1px solid var(--line)}
.target-content{flex:1;min-width:0}.target-label{display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:11px}.target-label span:last-child{font-variant-numeric:tabular-nums;color:var(--accent-ink)}
.target-track{display:flex;gap:5px}.target-segment{height:9px;border:1px solid var(--line-strong);border-radius:var(--r-pill);flex:1;background:var(--track)}.target-segment.filled{background:var(--accent);border-color:var(--accent)}
.focus-card{padding:21px;margin:0 0 18px;position:relative}.focus-card:before{content:"";position:absolute;top:23px;bottom:23px;left:0;background:var(--accent);width:3px;border-radius:5px}
.focus-card h3{font-size:19px;line-height:1.3;margin:10px 0}.focus-card p{color:var(--muted);font-size:13px;line-height:1.65}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:560px;z-index:40;display:flex;gap:4px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(16,26,37,.95);backdrop-filter:blur(18px);border-top:1px solid var(--line)}
.nav button{flex:1;min-width:0;min-height:56px;background:none;border:0;color:var(--muted);border-radius:var(--r-m);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:11px}
.nav button[aria-current=page]{color:var(--accent-ink);background:rgba(156,203,211,.08)}.nav button[aria-current=page] svg{stroke-width:2}
.session-marks{display:inline-flex;align-items:center;justify-content:center;gap:3px;vertical-align:middle;color:var(--accent)}
.primary{background:var(--accent);color:var(--bg);border:0;border-radius:var(--r-m);min-height:48px;padding:12px 18px;font-weight:600}
.secondary{background:transparent;color:var(--accent-ink);border:1px solid var(--line-strong);border-radius:var(--r-m);min-height:48px;padding:12px 18px}
.range-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:20px}.range-nav>div{text-align:center;min-width:0;display:flex;flex-direction:column;align-items:center}.range-nav strong{display:block;font-size:16px;font-weight:500}.range-nav small{display:block;color:var(--muted);font-size:12px;margin-top:5px}
.week-row{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--line-soft);padding:7px 0}.week-row:first-child{border-top:1px solid var(--line-soft)}
.week-open{min-width:0;flex:1;display:flex;align-items:center;gap:14px;text-align:left;border:0;background:transparent;padding:12px 0;min-height:70px}
.date-tile{flex-shrink:0;text-align:center;width:42px;color:var(--muted)}.date-tile small{display:block;font-size:11px;margin-bottom:5px}.date-tile strong{font-size:22px;font-weight:400}
.week-info{flex:1;min-width:0}.week-info strong{display:block;font-size:14px;line-height:1.4;font-weight:500}.week-info small{display:flex;gap:6px;align-items:center;margin-top:5px;color:var(--muted);font-size:12px}
.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.calendar button{min-width:0;min-height:57px;border:1px solid transparent;border-radius:var(--r-m);background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;position:relative;font-size:14px}
.calendar button.planned{background:var(--panel)}.calendar button.done{border-color:#769CA9;background:#203944}.calendar button.today{outline:2px solid var(--accent);outline-offset:-2}.calendar-label{text-align:center;font-size:11px;color:var(--muted);padding:10px 0}
.done-dot{position:absolute;right:3px;top:3px;color:var(--accent)}.legend{display:flex;flex-wrap:wrap;gap:16px;margin:18px 0;color:var(--muted);font-size:12px}.legend span{display:flex;align-items:center;gap:6px}
.journey-summary{padding:22px;margin-bottom:22px}.journey-summary strong{font-size:42px;letter-spacing:-.06em;font-weight:500;display:block;margin:12px 0 3px}
.phase-item{position:relative;padding:0 0 24px 23px;border-left:1px solid var(--line);margin-left:5px}.phase-item:before{content:"";position:absolute;left:-5px;top:14px;width:9px;height:9px;border-radius:50%;background:var(--line);border:2px solid var(--bg)}
.phase-item.current:before{background:var(--accent);box-shadow:0 0 0 4px rgba(156,203,211,.1)}.phase-item button{width:100%;text-align:left;background:none;border:0;padding:10px 0;color:var(--muted)}
.phase-item.current button{background:var(--panel);border:1px solid var(--edge);border-radius:18px;padding:18px}.phase-item h3{font-size:20px;color:var(--text);margin:8px 0}.phase-item p{font-size:13px;line-height:1.6;margin-top:10px}.phase-item small{font-size:11px}
.sheet-backdrop{position:fixed;inset:0;z-index:50;background:rgba(4,10,17,.75);backdrop-filter:blur(5px)}.sheet{position:fixed;left:50%;transform:translateX(-50%);bottom:0;z-index:51;width:100%;max-width:560px;max-height:90dvh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:26px 26px 0 0;padding:12px 20px calc(24px + env(safe-area-inset-bottom));box-shadow:0 -12px 70px #0006}
.sheet-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.sheet h2{font-size:22px}.sheet-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:20px 0}
.session-option{position:relative;min-height:90px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;border-radius:var(--r-m);border:1px solid var(--line);background:var(--surface);color:var(--muted);padding:12px 5px;font-size:12px;line-height:1.3;text-align:center;overflow-wrap:normal;word-break:normal;hyphens:manual}
.session-option[aria-pressed=true]{border-color:var(--accent);background:var(--raised);color:var(--text)}.sheet-footer{display:flex;gap:12px;margin-top:12px}.sheet-footer>*{flex:1}
.modal-input{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line-strong);border-radius:var(--r-s);padding:14px;margin:12px 0}
.toast{position:fixed;top:calc(14px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:max-content;max-width:90vw;z-index:80;background:var(--raised);color:var(--text);border:1px solid var(--accent);border-radius:var(--r-m);padding:14px 20px;box-shadow:0 10px 40px #0006}
@keyframes enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.view{animation:enter .25s ease-out}
@keyframes checkPop{50%{transform:scale(1.08)}}@media(min-width:600px){.app-shell{border-left:1px solid var(--track);border-right:1px solid var(--track)}.view{padding-left:26px;padding-right:26px}.app-header{padding-left:28px;padding-right:28px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
.header-subtitle{color:var(--muted);font-size:15px;line-height:1.6}.app-header h1{white-space:pre-line}
.day-chip small{font-size:11px;color:var(--muted);letter-spacing:.06em}.day-chip[aria-pressed=true] small{color:#233B47}
.day-marker{height:12px;width:auto;min-width:5px;background:none!important;font-size:14px;line-height:10px}
.session-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.session-subtitle{font-size:13px;color:var(--muted);line-height:1.6}
.session-actions>div{display:flex;gap:12px;flex-wrap:wrap}.session-actions .text-btn{font-size:11px}
.notes{background:transparent;padding:0;border:0}.notes textarea{width:100%;display:block;margin-top:10px;padding:12px;color:var(--text);background:var(--bg);border:1px solid var(--line-strong);border-radius:var(--r-s);resize:vertical}
.saved-note{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6;color:var(--muted);border-top:1px solid var(--line);padding-top:16px;margin-top:16px}
.inline-confirm{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:16px;font-size:13px}
.feeling-row{border-top:1px solid var(--line);margin-top:20px;padding-top:16px;font-size:12px;color:var(--muted)}
.feeling-row>div{display:flex;gap:6px;margin-top:10px}.feeling-row button{min-width:44px;height:44px;background:transparent;border:1px solid var(--line);border-radius:var(--r-s);font-size:22px}
.feeling-row button[aria-pressed=true]{border-color:var(--accent);background:var(--raised)}
.week-edit{flex-shrink:0;color:var(--faint)}.date-tile.current{color:var(--accent-ink)}.date-tile.current small{font-weight:600;letter-spacing:.02em}
.week-row.today{background:linear-gradient(90deg,rgba(156,203,211,.11),rgba(156,203,211,.02) 75%);border-radius:var(--r-m);border-color:transparent;padding-left:8px;box-shadow:inset 3px 0 0 var(--accent)}
.swap-link{width:100%;justify-content:center;color:var(--accent-ink);font-size:13px;margin-top:4px}
.calendar-ball{color:var(--gold)}.match-legend svg{vertical-align:-2px}
.swap-banner{border:1px solid var(--edge);background:#203944;border-radius:var(--r-m);padding:12px;display:flex;align-items:center;gap:8px;font-size:12px}
.helper-text{font-size:13px;color:var(--muted);line-height:1.7;margin:12px 0}
.body-editor{margin-top:14px;padding:18px}.field-label{display:block;font-size:12px;color:var(--muted);margin-top:12px}.body-fields{display:flex;gap:12px;margin-top:12px}.body-fields label{min-width:0;flex:1;font-size:12px;color:var(--muted)}
.journey-summary>div:nth-child(2){display:flex;align-items:center;gap:20px}.journey-summary span{font-size:13px;color:var(--muted);line-height:1.6}
.journey-summary p{font-size:12px;color:var(--muted);margin-top:14px}
progress{width:100%;height:5px;display:block;margin-top:18px;border:0;border-radius:var(--r-pill);overflow:hidden;background:var(--line)}
progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:var(--accent)}progress::-moz-progress-bar{background:var(--accent)}
.section-heading>span{font-size:12px;color:var(--muted)}
.past-toggle{color:var(--accent-ink);font-size:13px;margin:-6px 0 6px}.phase-timeline{padding-left:6px}.phase-item{display:block;width:calc(100% - 5px);text-align:left;color:var(--muted);background:transparent;border:0;border-left:1px solid var(--line);padding:16px 16px 28px 24px}
.phase-item.current{background:var(--panel);box-shadow:inset 0 0 0 1px var(--edge);border-radius:0 18px 18px 0;margin-bottom:16px}
.phase-item:before{top:21px}.phase-count{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-size:12px;color:var(--accent-ink)}
.trend-panel{padding:22px}.metric-switch{display:flex;gap:8px;margin:16px 0}.metric-switch button{padding:10px 16px;min-height:44px;border:1px solid var(--line);border-radius:var(--r-pill);background:transparent;font-size:12px;color:var(--muted)}
.metric-switch button[aria-pressed=true]{background:var(--raised);border-color:var(--accent);color:var(--text)}.trend-value{font-size:32px;letter-spacing:-.04em}.trend-value span{font-size:16px;color:var(--muted)}
.chart-caption{font-size:12px;color:var(--muted);line-height:1.5;margin-top:10px}
.sheet-handle{width:32px;height:4px;background:var(--edge);border-radius:4px;margin:0 auto 18px}.sheet h2{margin-top:8px}.option-check{position:absolute;right:7px;top:5px;color:var(--accent-ink)}
.settings-card{padding:22px}.settings-backup>.secondary{display:block;width:100%;margin-top:12px}.settings-backup{margin-top:30px}
.settings-screen{padding-bottom:calc(40px + env(safe-area-inset-bottom))}.loading-state{padding:80px 24px;color:var(--muted);text-align:center}
.milestone-toast{display:flex;align-items:center;gap:12px;max-width:520px;width:90vw}.milestone-toast>span{font-size:26px}.milestone-toast strong{font-size:14px}.milestone-toast p{font-size:12px;line-height:1.6;color:#B6C9D5;margin-top:3px}
@keyframes slideLeft{from{opacity:.3;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@keyframes slideRight{from{opacity:.3;transform:translateX(-16px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:360px){.view{padding-left:14px;padding-right:14px}.session-card{padding:20px 16px}.log-circle{width:68px;height:68px}.session-actions>div{gap:14px}.wide-only{display:none}.sheet{padding-left:14px;padding-right:14px}.feeling-row>div{gap:3px}}

/* Confirmed games: warm gold, ball + H/A markers, not colour alone. */
.match-card{border-color:var(--gold-line);background:linear-gradient(135deg,#30302A,var(--panel))}
.fixture-detail{border-bottom:1px solid #76664D;padding-bottom:18px;margin-top:16px}
.fixture-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--gold)}
.fixture-meta>strong{font-size:18px;font-variant-numeric:tabular-nums}
.match-badge{display:inline-block;color:var(--gold);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;line-height:1.5}
.fixture-detail h3{font-size:22px;line-height:1.3;margin:12px 0 6px;overflow-wrap:anywhere}
.fixture-detail p,.fixture-sheet-note{font-size:12px;line-height:1.6;color:#C7BDAB}
.fixture-sheet-note{padding:12px;border:1px solid var(--gold-line);border-radius:var(--r-s);margin-bottom:12px}
.day-chip.match-day:not([aria-pressed=true]){border-color:var(--gold-line);color:var(--gold);background:#2C2D29}
.week-row.match-row{border:1px solid var(--gold-line);border-left:3px solid #E4C18D;border-radius:var(--r-m);background:linear-gradient(110deg,#32322B,var(--panel));padding:8px 10px;margin:8px 0}
.match-row .date-tile,.match-row .session-marks{color:var(--gold)}.match-row .match-badge{margin-bottom:5px}.fixture-existing{display:block;font-size:12px;color:var(--muted);margin-top:4px}
.calendar button.match-day{background:#403B2D;border:1px solid #D7B580;color:#FFE4B4;gap:4px;min-height:77px}
.calendar button.match-day.done{background:#403B2D}.calendar button.match-day.today{outline:2px solid var(--accent-ink)}
.calendar-ball{font-size:16px;line-height:1.2}.calendar-kickoff{font-size:9px;font-weight:600;white-space:nowrap;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.match-legend{color:var(--gold)}.fixture-list-item{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:16px 12px;margin-top:10px;border:1px solid #806E50;border-left:3px solid #E4C18D;border-radius:var(--r-m);background:#282D2E}
.plan-guidance{border-left:2px solid var(--accent);padding:2px 0 2px 12px;margin:12px 0 4px}.plan-guidance strong{display:block;font-size:13px;line-height:1.5;color:var(--accent-ink)}.plan-guidance p{font-size:12px;line-height:1.6;color:var(--muted);margin:6px 0 0}.week-plan-focus{display:block;font-size:12px;line-height:1.5;color:var(--accent-ink);margin-top:5px}
.fixture-list-date{flex-shrink:0;width:32px;text-align:center;font-size:11px;color:var(--gold)}.fixture-list-date strong{display:block;font-size:22px;font-weight:500;margin-top:3px}
.fixture-list-item>span:nth-child(2){flex:1;min-width:0}.fixture-list-item>span:nth-child(2)>strong{font-size:14px;font-weight:500;overflow-wrap:anywhere;display:block;line-height:1.4}
.fixture-list-item small{display:block;font-size:12px;color:#C7BDAB;margin-top:5px}.fixture-list-item>svg{flex-shrink:0;color:var(--gold)}
@media(max-width:360px){.calendar-kickoff{font-size:8px}.week-row.match-row{padding-left:4px;padding-right:2px}.match-row .week-open{gap:8px}.fixture-detail h3{font-size:20px}}

/* Today: compact day navigation, rings, nutrition and up next. */
.head-actions{display:flex;align-items:center;gap:4px}.head-settings{color:var(--muted)}
.coach-pill{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:1px solid var(--edge);border-radius:var(--r-pill);background:rgba(156,203,211,.08);color:var(--accent-ink);font-size:13px;font-weight:500}
.day-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;font-size:12px;color:var(--muted)}
.day-head .text-btn{min-height:32px;padding:0;color:var(--accent-ink)}
.day-nav{display:flex;align-items:center;gap:2px;margin:0 0 12px}
.week-step{flex-shrink:0;width:26px;min-height:44px;border:0;background:transparent;color:var(--faint);font-size:22px;padding:0;border-radius:10px}
.rings{padding:14px 8px 12px;margin-bottom:12px}
.ring-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.ring{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;border:0;background:transparent;padding:4px 0;border-radius:var(--r-m);min-width:0}
.ring>svg{width:64px;height:64px;display:block}
.ring-track{fill:none;stroke:#2A3C4B;stroke-width:6}.ring-value{fill:none;stroke-width:6;transition:stroke-dasharray .4s ease-out}
.ring-center{position:absolute;top:4px;left:50%;transform:translateX(-50%);width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.ring-center small{font-size:11px;font-weight:500;color:var(--muted);margin-left:1px}
.ring-label{font-size:12px;margin-top:6px;color:var(--text)}.ring>small{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ring-badge{position:absolute;top:2px;right:calc(50% - 38px);width:19px;height:19px;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;color:var(--bg);border:2px solid #1B2935}
.day-summary{font-size:12px;line-height:1.5;color:var(--muted);text-align:center;margin-top:10px;padding:0 8px}.day-summary strong{color:var(--text);font-weight:500}
.session-main{display:flex;align-items:center;gap:14px;margin:14px 0 8px}.session-main h2{flex:1;min-width:0}
.plan-guidance:not(.open) p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more-btn{min-height:32px;padding:0;font-size:11px;color:var(--accent-ink)!important}
.nutrition-card{padding:20px;margin-top:12px;scroll-margin-top:16px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:24px}
.protein-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:10px}
.protein-head strong{font-size:28px;font-weight:500;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.protein-head strong span{font-size:13px;color:var(--muted);letter-spacing:0;font-weight:400}
.protein-head>span{font-size:12px;color:var(--muted)}.protein-head>span.reached{color:var(--good-soft)}
.protein-bar{height:8px;border-radius:var(--r-pill);background:var(--track);margin:10px 0 14px;overflow:hidden}.protein-bar span{display:block;height:100%;border-radius:var(--r-pill);background:var(--good-soft);transition:width .3s ease-out}
.protein-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) 48px;gap:8px}
.chip{min-height:44px;border:1px solid var(--line-strong);border-radius:var(--r-s);background:var(--surface);color:var(--text);font-size:14px;font-variant-numeric:tabular-nums}
.chip.ghost{color:var(--muted);display:flex;align-items:center;justify-content:center}
.protein-edit{display:flex;gap:8px;align-items:center}.protein-edit .modal-input{margin:0;flex:1}.protein-edit button{flex-shrink:0;padding-left:14px;padding-right:14px}
.protein-hint{font-size:12px;color:var(--faint);line-height:1.5;margin-top:8px}.undo-btn{min-height:36px;padding:0;margin-top:4px;color:var(--accent-ink)!important}
.rating{border-top:1px solid var(--line);margin-top:16px;padding-top:14px}.rating-q{font-size:12px;color:var(--muted)}
.ampel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
.ampel-btn{min-height:48px;border:1px solid var(--line);border-radius:var(--r-s);background:transparent;color:var(--muted);font-size:12px;display:flex;align-items:center;justify-content:center;gap:7px;padding:6px}
.ampel-dot{width:19px;height:19px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--bg)}
.ampel-dot.green,.ring-badge.green{background:var(--good)}.ampel-dot.amber,.ring-badge.amber{background:var(--warn)}.ampel-dot.red,.ring-badge.red{background:var(--bad)}.ampel-dot.none{background:transparent;border:1px dashed var(--line-strong)}
.ampel-btn[aria-pressed=true]{color:var(--text)}.ampel-btn.green[aria-pressed=true]{border-color:var(--good);background:rgba(143,209,158,.12)}.ampel-btn.amber[aria-pressed=true]{border-color:var(--warn);background:rgba(233,196,106,.12)}.ampel-btn.red[aria-pressed=true]{border-color:var(--bad);background:rgba(229,138,126,.12)}
.rating-hint{font-size:12px;color:var(--faint);line-height:1.5;margin-top:8px}.ampel-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
.upnext{padding:16px 18px 6px;margin-top:12px}.upnext-row{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:0;border-top:1px solid var(--line-soft);background:transparent;padding:10px 0;min-height:58px}
.upnext .eyebrow+.upnext-row{border-top:0}
.upnext-date{width:34px;flex-shrink:0;text-align:center;color:var(--muted)}.upnext-date small{display:block;font-size:11px}.upnext-date strong{font-size:20px;font-weight:400}
.upnext-info{flex:1;min-width:0}.upnext-info strong{display:block;font-size:14px;font-weight:500;line-height:1.4;overflow-wrap:anywhere}.upnext-info small{display:block;font-size:12px;color:var(--muted);margin-top:3px}
.upnext-row.match .upnext-date,.upnext-row.match small,.upnext-row.match .session-marks{color:var(--gold)}

/* Plan, Körper, Saison */
.plan-switch{padding:0 20px 14px}.segmented{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--surface)}
.segmented button{min-height:40px;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:13px}.segmented button[aria-pressed=true]{background:var(--raised);color:var(--text)}
.body-hero{padding:22px}.hero-value{font-size:56px;font-weight:500;letter-spacing:-.06em;line-height:1;margin-top:14px;font-variant-numeric:tabular-nums}.hero-value span{font-size:20px;color:var(--muted);letter-spacing:0}
.hero-delta{font-size:13px;color:var(--accent-ink);margin-top:8px}.hero-meta{font-size:12px;color:var(--faint);margin-top:10px;line-height:1.5}
.goal-bar{position:relative;height:10px;border-radius:var(--r-pill);background:var(--track);margin:22px 0 8px}
.goal-band{position:absolute;top:0;bottom:0;background:rgba(169,216,184,.35);border-left:1px solid var(--good-soft);border-right:1px solid var(--good-soft)}
.goal-marker{position:absolute;top:-5px;width:4px;height:20px;border-radius:4px;background:var(--text);transform:translateX(-50%);box-shadow:0 0 0 3px #1B2935}
.goal-legend{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted)}
.body-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
.body-tile{padding:14px 12px;border-radius:var(--r-m);min-width:0}.body-tile small{display:block;font-size:11px;color:var(--muted);letter-spacing:.04em}.body-tile strong{display:block;font-size:20px;font-weight:500;margin-top:6px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.body-tile strong span{font-size:11px;color:var(--muted);letter-spacing:0}.body-tile em{display:block;font-style:normal;font-size:11px;color:var(--faint);margin-top:4px}
.add-measure{margin-top:4px;padding:0;color:var(--accent-ink);font-size:13px}
.trend-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}.trend-head .metric-switch{margin:0}
.range-switch{display:flex;gap:6px}.range-switch button{min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r-pill);background:transparent;color:var(--muted);font-size:11px}.range-switch button[aria-pressed=true]{border-color:var(--accent);color:var(--text);background:var(--raised)}
.measure-list{padding:0 16px}.measure-row{display:grid;grid-template-columns:1fr auto auto 18px;gap:14px;align-items:center;width:100%;border:0;border-top:1px solid var(--line-soft);background:transparent;text-align:left;min-height:52px;font-size:13px;font-variant-numeric:tabular-nums;color:var(--text)}.measure-row:first-child{border-top:0}.measure-row>span:first-child{color:var(--muted)}.measure-row svg{color:var(--faint)}
.nutri-week{padding:18px 14px}.nutri-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center}
.nutri-day{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:var(--muted)}.nutri-day b{font-weight:500;font-variant-numeric:tabular-nums;color:var(--faint)}.nutri-day b.hit{color:var(--good-soft)}
.nutri-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid var(--line);margin-top:16px;padding-top:14px}
.nutri-stats strong{display:block;font-size:18px;font-weight:500;font-variant-numeric:tabular-nums}.nutri-stats>div>span{display:block;font-size:12px;color:var(--muted);line-height:1.4;margin-top:3px}
.ampel-counts{display:flex!important;gap:6px;align-items:center;font-size:14px;font-weight:500}
.settings-link{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:18px;margin-top:24px;color:var(--text)}.settings-link>span{flex:1;min-width:0}.settings-link small{display:block;font-size:12px;color:var(--muted);margin-top:3px}
.day-status{display:flex;flex-direction:column;gap:4px;padding:0 8px 10px;margin-bottom:8px;border-bottom:1px solid var(--line-soft)}
.recovery{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap}
.day-status .complaint-strip{margin:0;gap:4px}.day-status .complaint-row{border-radius:var(--r-s)}.day-status .complaint-row.l1{border-color:transparent;background:transparent}
.day-status .complaint-row.l1 .complaint-summary{padding-left:4px;padding-right:4px}.day-status .complaint-summary{padding:7px 10px;min-height:44px}
.recovery-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;padding:5px 10px;border-radius:var(--r-pill);background:var(--surface);color:var(--text)}
.recovery-dot{width:9px;height:9px;border-radius:50%;background:var(--good)}.recovery.caution .recovery-dot{background:var(--warn)}.recovery.low .recovery-dot{background:var(--bad)}
.recovery-signals{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:12px;color:var(--muted)}.recovery-signals .flag{color:var(--warn)}.recovery.low .recovery-signals .flag{color:var(--bad-ink)}
.sleep-fill{background:var(--accent)!important}.sleep-fill.good{background:var(--good)!important}.sleep-fill.caution{background:var(--warn)!important}.sleep-fill.low{background:var(--bad)!important}
.night-metric{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.steps-week.sleep-week{grid-template-columns:34px repeat(7,minmax(0,1fr));gap:4px;padding-left:10px}
.steps-week .sleep-labels{align-items:flex-start}.steps-week .sleep-labels .steps-bar{background:transparent}.steps-week .sleep-labels b,.steps-week .sleep-labels small{color:var(--faint);font-weight:500}
.load-card{padding:6px 20px 16px;margin-top:12px}.load-card>.card-head{min-height:44px}
.load-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:48px;border:0;background:transparent;padding:0;text-align:left}
.load-inline{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}.load-inline small{font-size:12px;color:var(--muted);margin-left:-3px}.load-tag{white-space:nowrap}
@media(max-width:360px){.load-inline small{display:none}}.load-inline strong{font-size:20px;font-weight:500;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.load-inline .chev{color:var(--muted);transition:transform .2s}.load-inline .chev.up{transform:rotate(180deg)}
.load-details{margin-top:10px}.load-range{font-size:12px;color:var(--muted)}
.load-tag{font-size:11px;padding:4px 9px;border-radius:var(--r-pill);background:var(--surface);color:var(--muted)}.load-tag.optimal{color:var(--good)}.load-tag.high{color:var(--warn)}.load-tag.veryHigh{color:var(--bad-ink)}.load-tag.low{color:var(--accent-ink)}
.load-value{display:flex;align-items:baseline;gap:10px;margin-top:10px}.load-value strong{font-size:30px;font-weight:500;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.load-value span{font-size:12px;color:var(--muted)}
.load-bar{position:relative;height:12px;border-radius:var(--r-pill);background:var(--track);margin:12px 0 10px;overflow:visible}
.load-bar .zone{position:absolute;top:0;bottom:0}.load-bar .optimal{background:rgba(143,209,158,.35)}.load-bar .high{background:rgba(233,196,106,.3)}.load-bar .very{background:rgba(229,138,126,.28);border-radius:0 99px 99px 0}
.load-bar .planned{position:absolute;top:3px;bottom:3px;background:repeating-linear-gradient(90deg,var(--accent) 0 4px,transparent 4px 7px);opacity:.8}
.load-bar .marker{position:absolute;top:-5px;width:4px;height:22px;border-radius:4px;background:var(--text);transform:translateX(-50%);box-shadow:0 0 0 3px #1B2935}
.load-advice{font-size:13px;line-height:1.5;color:var(--text)}
.load-weeks{padding:18px 14px 14px}
.load-plot{position:relative;height:88px;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));align-items:end;border-bottom:1px solid var(--line-soft)}
.load-band{position:absolute;left:0;right:0;background:rgba(143,209,158,.13);border-top:1px dashed rgba(143,209,158,.55);border-bottom:1px dashed rgba(143,209,158,.55)}
.load-col{position:relative;z-index:1;height:100%;display:flex;align-items:flex-end;justify-content:center}.load-col .load-fill{display:block;width:18px;border-radius:6px 6px 2px 2px}
.load-labels{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));text-align:center;margin-top:8px}.load-labels b{display:block;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}.load-labels small{display:block;font-size:11px;color:var(--muted);margin-top:2px}
.band-key{display:inline-block;width:14px;height:8px;margin-right:6px;vertical-align:0;background:rgba(143,209,158,.25);border:1px dashed rgba(143,209,158,.7);border-radius:2px}
.load-fill{position:relative;z-index:1;background:#647F93!important}.load-fill.current{background:var(--accent)!important}
.report-banner{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 16px;margin-bottom:12px;color:var(--accent-ink);border-color:var(--edge)}
.report-banner span{flex:1}.report-banner strong{display:block;font-size:14px;font-weight:500;color:var(--text)}.report-banner small{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.report-group+.report-group{margin-top:18px}.report-group>.eyebrow{margin-bottom:8px}
.report-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.report-tile{padding:12px;border-radius:var(--r-m);min-width:0}.report-tile strong{display:block;font-size:19px;font-weight:500;letter-spacing:-.03em;font-variant-numeric:tabular-nums;white-space:nowrap}
.report-tile small{display:block;font-size:12px;line-height:1.35;color:var(--muted);margin-top:4px}.report-tile.good strong{color:var(--good-soft)}
.report-ampel{display:inline-flex;gap:6px;font-size:16px}.report-ampel>span{display:inline-flex;align-items:center;gap:4px}.report-ampel .ampel-dot{width:8px;height:8px}.report-ampel>span{gap:3px!important}
.report-notes{padding:4px 16px}.report-notes p{font-size:14px;line-height:1.5;padding:10px 0;border-top:1px solid var(--line-soft)}.report-notes p:first-child{border-top:0}
.report-facts{padding:6px 18px}.report-line{display:grid;grid-template-columns:86px 1fr;gap:12px;padding:12px 0;border-top:1px solid var(--line-soft)}.report-line:first-child{border-top:0}
.report-line>span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);padding-top:2px}.report-line p{font-size:13px;line-height:1.55;color:var(--text)}
.report-coach{padding:20px;margin-top:14px}.report-text{white-space:pre-wrap;font-size:15px;line-height:1.65;color:var(--text);margin-top:12px}
.report-row{grid-template-columns:1fr auto 0 18px}.report-row>span:nth-child(2){font-size:11px;color:var(--accent-ink)}
.plan-proposal{padding:18px}.proposal-summary{font-size:13px;line-height:1.55;color:var(--text);margin:10px 0 4px}
.proposal-days{list-style:none;margin:10px 0 12px;padding:0}.proposal-days li{display:flex;gap:12px;padding:9px 0;border-top:1px solid var(--line-soft)}
.proposal-date{width:44px;flex-shrink:0;font-size:12px;color:var(--muted);padding-top:1px}.proposal-body{flex:1;min-width:0}
.proposal-body strong{display:block;font-size:13px;font-weight:500;color:var(--text)}.proposal-body small{display:block;font-size:12px;color:var(--muted);line-height:1.45;margin-top:2px}
.proposal-days li.fixed .proposal-body strong{color:var(--accent-ink)}.proposal-days li.changed{background:linear-gradient(90deg,rgba(156,203,211,.08),transparent)}
.proposal-days li.changed .proposal-date{color:var(--accent-ink)}.proposal-was{color:var(--warn)!important}
.proposal-body strong small{display:inline;font-size:11px;font-weight:400;color:var(--muted)}.plan-proposal .sheet-footer .primary{flex:2;white-space:nowrap}
.complaint-strip{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.complaint-row{border:1px solid #6B5A3E;border-radius:var(--r-m);background:rgba(233,196,106,.07)}.complaint-row.l3{border-color:#8E4E46;background:rgba(229,138,126,.08)}.complaint-row.l1{border-color:var(--line-strong);background:rgba(165,184,200,.05)}
.complaint-summary{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;font-size:13px;color:var(--text)}
.complaint-summary>span:nth-child(2){flex:1;min-width:0}.complaint-summary strong{font-weight:500}.complaint-summary small{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.complaint-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;background:var(--warn)}.complaint-row.l1 .complaint-dot{background:var(--muted)}.complaint-row.l3 .complaint-dot{background:var(--bad)}
.complaint-update{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 12px}.complaint-update .chip{flex:1;min-width:0;padding:0 6px;font-size:12px;white-space:nowrap}.chip[aria-pressed=true]{border-color:var(--accent);background:var(--raised)}.chip.good{border-color:#5E8A6A;color:var(--good-soft)}
.complaint-areas{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 10px}.complaint-areas .chip{padding:0 12px;font-size:13px}
.complaint-sides{display:flex;gap:8px;margin-bottom:6px}.complaint-sides .chip{flex:1}
.complaint-levels{display:grid;gap:8px}.complaint-level{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;min-height:56px;padding:10px 14px;border-radius:var(--r-m);border:1px solid var(--line);background:var(--surface);color:var(--text)}
.complaint-level strong{font-size:14px;font-weight:500}.complaint-level small{font-size:12px;color:var(--muted)}.complaint-level.l1{border-color:var(--line-strong)}.complaint-level.l2{border-color:#6B5A3E}.complaint-level.l3{border-color:#8E4E46}
.kcal-line{font-size:12px;color:var(--accent-ink);margin:-6px 0 12px}
.meal-photo{display:flex;gap:8px;margin-bottom:10px}.meal-photo .secondary{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border-color:var(--accent);white-space:nowrap}
.meal-photo .photo-library{flex:0 0 52px;padding:0}
.protein-head>span{display:inline-flex;align-items:center;gap:2px}.protein-fix{min-width:36px;min-height:36px;margin:-8px -8px -8px 0;color:var(--muted)}
.protein-edit{margin-bottom:10px}
.fav-chip.protein-chip{min-width:64px}.fav-chip.protein-chip span{font-variant-numeric:tabular-nums}
.sheet-link{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;margin:-8px 0 12px;padding:10px 14px;border:1px solid #6B5A3E;border-radius:var(--r-m);background:rgba(233,196,106,.07);color:var(--text);text-align:left;font-size:13px}
.sheet-link span{flex:1}.sheet-link svg:first-child{color:var(--warn)}
.fixture-sheet-note svg{vertical-align:-3px}
.meal-list{list-style:none;margin:0 0 12px;padding:0;border-top:1px solid var(--line)}
.meal-row{border-bottom:1px solid var(--line-soft)}.meal-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;border:0;background:transparent;padding:10px 0;min-height:52px}
.meal-summary>span{min-width:0}.meal-summary strong{display:block;font-size:13px;font-weight:500;color:var(--text);overflow-wrap:anywhere}.meal-summary small{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.meal-summary>b{flex-shrink:0;text-align:right;font-size:13px;font-weight:500;color:var(--text);font-variant-numeric:tabular-nums}.meal-summary>b small{display:block;font-size:11px;font-weight:400;color:var(--good-soft)}
.meal-detail{padding:0 0 12px}.meal-detail ul{list-style:none;margin:0 0 8px;padding:0}.meal-detail li{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted);padding:3px 0}
.meal-edit{display:flex;gap:12px}.meal-edit label{flex:1;min-width:0;font-size:12px;color:var(--muted)}.meal-edit .modal-input{margin:6px 0 0}
.meal-name{display:block;font-size:12px;color:var(--muted);margin-bottom:10px}.meal-name .modal-input{margin:6px 0 0}
.meal-summary strong svg{display:inline-block;vertical-align:-1px;margin-right:5px;color:var(--warn);fill:var(--warn)}
.fav-toggle{display:flex;align-items:center;gap:6px;min-height:40px;margin:6px 0 2px;padding:0;font-size:13px;color:var(--accent-ink)!important}.fav-toggle[aria-pressed=true] svg{fill:var(--warn);color:var(--warn)}
.fav-block{margin:4px 0 12px}.fav-head{display:flex;align-items:center;justify-content:space-between;min-height:32px}.fav-head .text-btn{min-height:32px;padding:0;font-size:12px;color:var(--accent-ink)}
.fav-chips{display:flex;gap:8px;overflow-x:auto;padding:4px 0 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.fav-chips::-webkit-scrollbar{display:none}
.fav-chip{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;max-width:190px;min-height:52px;padding:6px 12px;text-align:left}
.fav-chip span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.fav-chip small{font-size:11px;color:var(--muted);white-space:nowrap}
.fav-chip.remove{flex-direction:row;align-items:center;gap:8px;border-color:#8E4E46;min-height:44px}.fav-chip.remove svg{flex-shrink:0;color:var(--bad)}
.fav-form{margin-top:8px;padding:12px;border:1px solid var(--line);border-radius:var(--r-m)}.fav-form .secondary{width:100%;margin-top:10px}
.meal-pending{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-soft);font-size:12px;color:var(--accent-ink)}.meal-pending img{width:44px;height:44px;object-fit:cover;border-radius:10px;flex-shrink:0}.meal-pending span{flex:1}
/* Social matches */
:root{--social:#B9B4E6}
.social-card{padding:14px 18px 16px;margin-bottom:12px;border-color:#4A4870}
.social-block+.social-block{border-top:1px solid var(--line-soft);margin-top:12px;padding-top:12px}
.social-card .card-head small{font-size:12px;color:var(--muted);white-space:nowrap}
.social-eyebrow{display:inline-flex;align-items:center;gap:6px;color:var(--social)}
.social-rules{margin:10px 0 6px;padding-left:22px;font-size:14px;line-height:1.5;color:var(--text)}.social-rules li+li{margin-top:4px}.social-rules li::marker{color:var(--social);font-weight:600}
.social-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--faint)}.social-foot .text-btn{color:var(--accent-ink);font-size:13px;padding:0}
.social-wide{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px}
.social-eval{margin-top:4px}.social-rule{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-soft)}
.social-rule>span{flex:1;min-width:0;display:flex;gap:8px;font-size:14px;line-height:1.4}.social-rule>span b{color:var(--social)}
.kept-toggle{display:flex;gap:6px;flex-shrink:0}.kept-toggle button{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);color:var(--faint)}
.kept-toggle .kept[aria-pressed=true]{color:var(--good)}.kept-toggle .broken[aria-pressed=true]{color:var(--bad)}
.social-skip{width:100%;justify-content:center;color:var(--muted);font-size:13px}
.social-card .card-head{gap:8px}.social-card .card-head small{overflow:hidden;text-overflow:ellipsis}
.kept-toggle .kept[aria-pressed=true]{border-color:var(--good);background:rgba(143,209,158,.12);color:var(--text)}.kept-toggle .broken[aria-pressed=true]{border-color:var(--bad);background:rgba(229,138,126,.12);color:var(--text)}
.social-preview,.social-score{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:500;margin:12px 0 4px}
.social-score{font-size:20px;margin-top:8px}
.outcome-chip{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0;border-radius:50%;font-size:12px;font-weight:700;color:var(--bg)}
.outcome-chip.win{background:var(--good)}.outcome-chip.draw{background:var(--warn)}.outcome-chip.loss{background:var(--bad)}
.social-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.social-actions .primary,.social-actions .secondary{flex:1;min-width:120px}.social-actions .text-btn{color:var(--muted);padding:0 4px}
.social-link{color:var(--social)!important;font-size:13px;margin-top:6px}
.social-sheet{display:flex;flex-direction:column;overflow:hidden;padding-bottom:0}
.social-sheet .sheet-scroll{flex:1;min-height:0;overflow-y:auto;margin:0 -20px;padding:0 20px 12px;overscroll-behavior:contain}
.social-sheet .sheet-actions{flex-shrink:0;padding:12px 0 calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--line-soft)}
.social-sheet .sheet-actions .helper-text{margin:0 0 10px}.rule-hint{margin-top:4px}
@media(max-width:360px){.social-sheet .sheet-scroll{margin:0 -14px;padding-left:14px;padding-right:14px}}
.social-sheet .field-label{margin-top:14px}.social-mode{margin:8px 0 4px}.social-days,.social-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.social-days .chip,.social-chips .chip{padding:0 12px;font-size:13px;border-radius:var(--r-pill)}.social-chips.rules .chip{display:inline-flex;align-items:center;gap:8px;text-align:left;border-radius:var(--r-s);padding:8px 12px;line-height:1.35}
.social-chips.rules .chip b{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--social);color:var(--bg);font-size:11px;flex-shrink:0}
.kickoff-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;font-size:12px;color:var(--muted)}
.kickoff-input{flex:0 0 112px;width:112px;min-width:0;min-height:48px;margin:0;padding:0 12px;border:1px solid var(--line-strong);border-radius:var(--r-s);background:var(--bg);color:var(--text);text-align:center;-webkit-appearance:none;appearance:none}
.kickoff-input::-webkit-date-and-time-value{text-align:center}.kickoff-input::-webkit-calendar-picker-indicator{filter:invert(.8)}
.rule-slot{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 12px;border:1px dashed var(--social);border-radius:var(--r-s);font-size:13px;color:var(--social)}
.rule-slot b{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--social);font-size:11px}
.social-chips.options{margin-top:10px}.social-chips.options .chip{background:transparent;border-color:var(--line);color:var(--muted)}
.rule-count{float:right;color:var(--social)}.social-custom{margin-top:10px}.social-custom .social-add{flex:0 0 52px;padding:0;display:flex;align-items:center;justify-content:center}.check-row{display:flex;align-items:center;gap:10px;min-height:44px;font-size:13px;color:var(--muted)}
.check-row input{-webkit-appearance:none;appearance:none;flex:0 0 22px;width:22px;height:22px;margin:0;border:1.5px solid var(--line-strong);border-radius:6px;background:var(--surface);display:grid;place-content:center}
.check-row input:checked{background:var(--accent);border-color:var(--accent)}.check-row input:checked::after{content:"";width:10px;height:5px;border:2px solid var(--bg);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}.warn-text{color:var(--warn)!important}
.social-table{padding:18px}.social-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.social-head strong{display:block;font-size:40px;font-weight:500;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums}.social-head strong.good{color:var(--good-soft)}.social-head strong.short{color:var(--warn)}
.social-head div>span{display:block;font-size:12px;color:var(--muted);margin-top:6px}
.social-record{display:flex;gap:12px;font-size:12px;color:var(--muted)}.social-record b{font-size:18px;font-weight:500;color:var(--text);font-variant-numeric:tabular-nums}
.social-form{display:flex;align-items:center;gap:6px;margin:14px 0 4px;font-size:12px;color:var(--muted)}.social-form>span{margin-right:4px}
.social-list{list-style:none;margin:14px 0 0;padding:0}.social-list li{display:flex;align-items:center;gap:10px;min-height:44px;border-top:1px solid var(--line-soft);font-size:13px}
.social-list li>span:first-child{flex:1;min-width:0}.social-list small{font-size:12px;color:var(--muted)}
.social-subhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 8px}.social-subhead .text-btn{color:var(--accent-ink);font-size:13px;padding:0}
.social-holiday-form{padding:16px;margin-bottom:10px}.social-holiday-form .field-label{margin-top:0}
.tour-row{display:flex;align-items:center;gap:10px;min-height:56px;border-top:1px solid var(--line-soft)}.tour-row:first-child{border-top:0}
.tour-row>span:first-child{flex:1;min-width:0}.tour-row strong{display:block;font-size:14px;font-weight:500}.tour-row small{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.tour-score{font-size:13px;color:var(--accent-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
/* Coach */
@keyframes coachBlink{0%,80%,100%{opacity:.25}40%{opacity:1}}
.coach-screen{position:fixed;inset:0;max-width:560px;margin:0 auto;z-index:60;display:flex;flex-direction:column;background:radial-gradient(ellipse 100% 420px at 80% 0%,#223B50 0%,var(--bg) 80%)}
.coach-head{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:calc(8px + env(safe-area-inset-top)) 12px 10px 6px;border-bottom:1px solid var(--line-soft)}
.coach-title{flex:1;min-width:0}.coach-title strong{display:block;font-size:17px;font-weight:600;letter-spacing:-.02em}
.coach-title small{display:block;font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.coach-head .text-btn{padding:0 8px;font-size:13px;color:var(--accent-ink)}.coach-head-spacer{width:44px;flex-shrink:0}
.coach-body{flex:1;min-height:0;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:12px}
.coach-intro{margin-top:auto;color:var(--accent)}.coach-intro p{font-size:16px;line-height:1.55;color:var(--text);margin-top:10px;max-width:34ch}.coach-intro small{display:block;font-size:12px;color:var(--muted);margin-top:8px}
.msg{max-width:88%;padding:12px 15px;font-size:15px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text)}
.msg.assistant{align-self:flex-start;background:linear-gradient(135deg,#1C2C3A,#192632);border:1px solid #2A3C4B;border-radius:6px var(--r-l) var(--r-l) var(--r-l)}
.msg.user{align-self:flex-end;background:var(--raised);border:1px solid #3D5A68;border-radius:var(--r-l) var(--r-l) 6px var(--r-l)}
.typing{display:inline-flex;gap:5px;padding:4px 0}.typing span{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:coachBlink 1.2s infinite ease-in-out}
.typing span:nth-child(2){animation-delay:.16s}.typing span:nth-child(3){animation-delay:.32s}
.coach-error p{font-size:14px;line-height:1.5;color:var(--muted);margin-bottom:10px}
.coach-suggestions{flex-shrink:0;display:flex;gap:8px;overflow-x:auto;padding:10px 16px 0;scrollbar-width:none}.coach-suggestions::-webkit-scrollbar{display:none}
.coach-suggestions .chip{flex:0 0 auto;padding:0 16px;font-size:13px;white-space:nowrap;border-radius:var(--r-pill)}
.coach-suggestions .chip.main{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}
.coach-input{flex-shrink:0;display:flex;gap:8px;align-items:center;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
.coach-input input{flex:1;min-height:48px;border:1px solid var(--line-strong);border-radius:var(--r-pill);padding:0 18px;background:var(--surface);color:var(--text);outline:none}
.coach-send{width:48px;height:48px;flex-shrink:0;border-radius:50%;border:0;background:var(--accent);color:var(--bg);display:flex;align-items:center;justify-content:center}
.field-hint{font-size:12px;color:var(--muted);line-height:1.5;margin-top:6px}
.connection-row{display:flex;gap:12px;align-items:flex-start;border-top:1px solid var(--line);margin-top:16px;padding-top:14px;color:var(--accent-ink)}
.connection-row strong{display:block;font-size:14px;font-weight:500;color:var(--text)}.connection-row small{display:block;font-size:12px;color:var(--accent-ink);margin-top:3px}.connection-row p{font-size:12px;color:var(--muted);margin-top:3px}
.watch-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.watch-list li{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--accent-ink)}.watch-list li svg{flex-shrink:0}.watch-list li span{flex:1;min-width:0}.watch-stats{display:block;font-style:normal;font-size:11px;color:var(--text);margin-top:3px;font-variant-numeric:tabular-nums}.watch-stats i{font-style:normal;white-space:nowrap}.watch-list li small{flex-shrink:0;white-space:nowrap;font-size:11px;color:var(--warn)}
.steps-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;padding:16px 12px 12px}
.steps-day{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:var(--muted)}.steps-day b{font-weight:500;color:var(--text);font-variant-numeric:tabular-nums}
.steps-bar{height:64px;width:14px;border-radius:7px;background:var(--track);display:flex;align-items:flex-end;overflow:hidden}.steps-bar span{display:block;width:100%;border-radius:7px;background:var(--accent)}
@media(min-width:600px){.plan-switch{padding-left:26px;padding-right:26px}}
@media(max-width:360px){.ring>svg{width:56px;height:56px}.ring-center{width:56px;height:56px;font-size:15px}.ring-badge{right:calc(50% - 34px)}.ampel-btn{font-size:11px;gap:4px}.plan-switch{padding-left:14px;padding-right:14px}.body-tile strong{font-size:17px}.protein-actions{gap:6px}}
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
  return <div className="panel focus-card"><h3>{t.focus}</h3><p>{t.detail}</p></div>;
}

// ─── Access code and Garmin ──────────────────────────────────────────────────────
// The code matches APP_ACCESS_CODE in Vercel. Kept in its own localStorage key, so it
// is never part of exported backups.
const ACCESS_KEY="soccer-access-code";
function readAccessCode() { try { return localStorage.getItem(ACCESS_KEY)||""; } catch { return ""; } }
function writeAccessCode(value) { try { value?localStorage.setItem(ACCESS_KEY,value):localStorage.removeItem(ACCESS_KEY); } catch {} }
const authHeaders=()=>{const code=readAccessCode();return code?{Authorization:`Bearer ${code}`}:{};};
const GARMIN_ERRORS={
  access_denied:"Der Zugangscode stimmt nicht.",
  access_code_not_configured:"In Vercel fehlt noch APP_ACCESS_CODE.",
  garmin_not_configured:"In Vercel fehlt noch GARMIN_PERSONAL_API_KEY.",
  garmin_key_invalid:"Der Garmin-Schlüssel ist ungültig oder abgelaufen. Erzeuge in Garmin Connect einen neuen.",
  garmin_rate_limited:"Garmin bremst gerade. Versuch es später erneut.",
  garmin_unavailable:"Garmin ist gerade nicht erreichbar.",
  network:"Keine Verbindung.",
};
const WITHINGS_ERRORS={
  access_denied:"Der Zugangscode stimmt nicht.",
  access_code_not_configured:"In Vercel fehlt noch APP_ACCESS_CODE.",
  storage_not_configured:"In Vercel fehlt der Upstash-Speicher.",
  withings_not_configured:"In Vercel fehlen noch WITHINGS_CLIENT_ID und WITHINGS_CLIENT_SECRET.",
  withings_reconnect:"Die Verbindung zu Withings ist abgelaufen. Bitte neu verbinden.",
  withings_rate_limited:"Withings bremst gerade. Versuch es später erneut.",
  withings_unavailable:"Withings ist gerade nicht erreichbar.",
  network:"Keine Verbindung.",
};
const syncTime=at=>at?new Date(at).toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"}):"";
function sourceStatus(src,stored,offline) {
  if(!stored)return "Zuerst den Zugangscode speichern.";
  return src.state==="syncing"?"Wird abgeglichen …":src.state==="error"?src.message:src.state==="ok"?`Verbunden · letzter Abgleich ${syncTime(src.at)} Uhr`:offline;
}
function ConnectionSettings({garmin,withings,scale,onSync,onWithingsConnect,onWithingsDisconnect}) {
  const [code,setCode]=useState(readAccessCode),[stored,setStored]=useState(()=>!!readAccessCode());
  const save=()=>{const value=code.trim();writeAccessCode(value);setStored(!!value);if(value)onSync(true);};
  const busy=garmin.state==="syncing"||withings.state==="syncing";
  return <section className="settings-backup" aria-label="Verbindungen"><div className="section-heading"><h2>Verbindungen</h2></div>
    <p className="helper-text">Uhr und Waage liefern beim Öffnen der App automatisch. Eigene Einträge werden nie überschrieben.</p>
    <label htmlFor="access-code" className="eyebrow">Zugangscode</label>
    <p className="field-hint">Schaltet Uhr, Waage, Essensfotos und den Trainer frei.</p>
    <input id="access-code" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} className="modal-input" value={code}
      placeholder="Dein Zugangscode" onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
    <button className="secondary" onClick={save}>Code speichern und abgleichen</button>
    <div className="connection-row"><Icon name="watch" size={20}/><div><strong>Garmin</strong>
      <small role="status">{sourceStatus(garmin,stored,"Noch nicht abgeglichen.")}</small><p>Trainings, Fussball-Werte und Schritte.</p></div></div>
    <div className="connection-row"><Icon name="body" size={20}/><div><strong>Withings</strong>
      <small role="status">{withings.state==="disconnected"?"Nicht verbunden.":sourceStatus(withings,stored,"Noch nicht abgeglichen.")}</small><p>Gewicht und Körperfett der Waage.{scale?.count?` Gespeichert: ${scale.count} ${scale.count===1?"Messung":"Messungen"} seit ${shortDate(scale.since)} ${scale.since.slice(0,4)}.`:""}</p></div></div>
    {stored&&withings.state!=="ok"&&withings.state!=="syncing"
      &&<button className="secondary" disabled={busy} onClick={onWithingsConnect}>{withings.state==="error"?"Withings neu verbinden":"Mit Withings verbinden"}</button>}
    {stored&&<button className="secondary" disabled={busy} onClick={()=>onSync(true)}>Jetzt abgleichen</button>}
    {stored&&(withings.state==="ok"||withings.state==="error")&&<button className="text-btn" disabled={busy} onClick={onWithingsDisconnect}>Withings trennen</button>}
  </section>;
}

// ─── Reminders (Web Push) ────────────────────────────────────────────────────────
// The service worker (public/sw.js) reads this cache entry; keep the names in sync.
const REMINDER_CACHE="soccer-status", REMINDER_URL="/__reminder-status";
function writeReminderStatus(status) {
  try {
    if(!("caches" in window))return;
    caches.open(REMINDER_CACHE).then(c=>c.put(REMINDER_URL,new Response(JSON.stringify(status),{headers:{"Content-Type":"application/json"}}))).catch(()=>{});
  } catch {}
}
function base64UrlToBytes(value) {
  const b64=(value+"=".repeat((4-value.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
}
const pushCapable=()=>"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
const postPush=body=>fetch("/api/push",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const REMINDER_COPY={
  loading:"Wird geprüft …",
  install:"Auf dem iPhone funktionieren Erinnerungen nur in der App vom Homescreen. Öffne sie dort und aktiviere sie hier.",
  unsupported:"Dieser Browser kann keine Push-Mitteilungen empfangen.",
  denied:"Mitteilungen sind blockiert. Erlaube sie in den iPhone-Einstellungen unter Mitteilungen → Soccer.",
  unconfigured:"Auf dem Server fehlt noch der Speicher für Erinnerungen (Upstash in Vercel).",
  off:"Täglich zwischen 12 und 13 Uhr und zwischen 21 und 22 Uhr. Die Mitteilung zeigt, was an dem Tag noch offen ist.",
  on:"Aktiv: täglich zwischen 12 und 13 Uhr und zwischen 21 und 22 Uhr.",
};
function ReminderSettings() {
  const [state,setState]=useState("loading"),[busy,setBusy]=useState(false),[note,setNote]=useState("");
  const keyRef=useRef(null);
  useEffect(()=>{
    let live=true;
    (async()=>{
      if(!pushCapable()){setState(/iPad|iPhone|iPod/.test(navigator.userAgent)&&!navigator.standalone?"install":"unsupported");return;}
      if(Notification.permission==="denied"){setState("denied");return;}
      const cfg=await fetch("/api/push").then(r=>r.ok?r.json():null).catch(()=>null);
      if(cfg?.configured)keyRef.current=cfg.publicKey;
      const sub=await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if(live)setState(sub?"on":cfg&&!cfg.configured?"unconfigured":"off");
    })().catch(()=>{if(live)setState("off");});
    return ()=>{live=false;};
  },[]);
  const run=async task=>{setBusy(true);setNote("");try{await task();}catch{setNote("Das hat nicht geklappt. Prüfe die Verbindung und versuche es erneut.");}finally{setBusy(false);}};
  // Permission first, while the tap still counts as a user gesture (required on iOS).
  const enable=()=>run(async()=>{
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){setState(permission==="denied"?"denied":"off");return;}
    if(!keyRef.current){
      const cfg=await fetch("/api/push").then(r=>r.json());
      if(!cfg.configured){setState("unconfigured");return;}
      keyRef.current=cfg.publicKey;
    }
    await navigator.serviceWorker.register("/sw.js");
    const reg=await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(keyRef.current)});
    const res=await postPush({action:"subscribe",subscription:sub.toJSON()});
    if(!res.ok){await sub.unsubscribe();throw new Error("subscribe failed");}
    setState("on");setNote("Erinnerungen sind aktiv. Mit „Test senden“ kannst du es ausprobieren.");
  });
  const currentSub=async()=>(await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  const disable=()=>run(async()=>{
    const sub=await currentSub();
    if(sub){await postPush({action:"unsubscribe",endpoint:sub.endpoint}).catch(()=>{});await sub.unsubscribe();}
    setState("off");setNote("Erinnerungen sind aus.");
  });
  const test=()=>run(async()=>{
    const sub=await currentSub();
    if(!sub){setState("off");return;}
    const res=await postPush({action:"test",endpoint:sub.endpoint});
    setNote(res.ok?"Test gesendet. Die Mitteilung sollte gleich erscheinen.":res.status===429?"Kurz warten, dann erneut testen."
      :res.status===404?"Dieses Gerät ist nicht registriert. Deaktiviere die Erinnerungen und aktiviere sie neu.":"Senden hat nicht geklappt.");
  });
  return <section className="settings-backup" aria-label="Erinnerungen"><div className="section-heading"><h2>Erinnerungen</h2></div>
    <p className="helper-text">{REMINDER_COPY[state]}</p>
    {(state==="off"||state==="unconfigured")&&<button className="secondary" disabled={busy} onClick={enable}>Erinnerungen aktivieren</button>}
    {state==="on"&&<><button className="secondary" disabled={busy} onClick={test}>Test senden</button>
      <button className="secondary" disabled={busy} onClick={disable}>Deaktivieren</button></>}
    {note&&<p role="status" className="helper-text">{note}</p>}
  </section>;
}

// ─── Setup / settings ────────────────────────────────────────────────────────────
function SetupScreen({initName,initProteinTarget=DEFAULT_PROTEIN_TARGET,isEdit,onBack,onSave,connections}) {
  const [n,setN]=useState(initName||"");
  const [target,setTarget]=useState(String(initProteinTarget));
  const targetValue=Number(target.trim());
  const targetOk=target.trim()!==""&&validProteinTarget(targetValue);
  const ok=n.trim()&&targetOk;
  const submit=()=>{if(ok)onSave(n.trim(),targetValue);};

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
        onChange={e=>setN(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submit();}}/>
      <label htmlFor="protein-target" className="eyebrow" style={{display:"block",marginTop:12}}>Proteinziel pro Tag (g)</label>
      <input id="protein-target" className="modal-input" inputMode="numeric" value={target} maxLength={3}
        onChange={e=>setTarget(e.target.value.replace(/[^0-9]/g,""))} onKeyDown={e=>{if(e.key==="Enter")submit();}}/>
      {!targetOk&&<p role="alert" className="helper-text">Bitte einen Wert zwischen 30 und 400 g eingeben.</p>}
      <button className="primary" style={{width:"100%",marginTop:20}} disabled={!ok} onClick={submit}>{isEdit?"Speichern":"Los geht’s →"}</button>
    </section>
    {isEdit&&connections&&<ConnectionSettings {...connections}/>}
    {isEdit&&<ReminderSettings/>}
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
// Break long tile labels at sensible points instead of mid-syllable ("Mannschafts-training", "Prävention/Reha").
const sheetLabel=t=>String(t).replace("Mannschaftstraining","Mannschafts\u00ADtraining").replace(/\//g,"/\u200B");
function WorkoutSheet({dateKey:dk,entry,updDay,onClose,onReportComplaint,onSwap}) {
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
      {entry.match&&<p className="fixture-sheet-note"><Icon name="Match" size={15}/> {matchSummary(entry.match)}<br/>Der Spieltermin bleibt an diesem Datum und wird nicht mit Trainingstagen getauscht.</p>}
      {otherMode?<div><label htmlFor="custom-session" className="helper-text">Deine eigene Einheit</label>
        <input id="custom-session" className="modal-input" autoFocus value={otherText} maxLength={100} onChange={e=>setOtherText(e.target.value)}
          placeholder="Zum Beispiel Schwimmen, Physio …" onKeyDown={e=>{if(e.key==="Enter")save();}}/>
        <button className="text-btn" onClick={()=>setOtherMode(false)}>← Zur Auswahl</button></div>
      :<><p className="helper-text">Bis zu zwei Einheiten. Speichern ändert nur den Plan. Über FERTIG trägst du das absolvierte Training ein.</p>
        <div className="sheet-grid">{options.map(opt=><button key={opt.label} className="session-option" onClick={()=>toggle(opt.label)}
          aria-pressed={selected.includes(opt.label)} disabled={(fixedMatch&&opt.label==="Match")||(!selected.includes(opt.label)&&selected.length>=SHEET_MAX)}>
          <Icon name={opt.label} size={25}/><span>{sheetLabel(displayName(opt.label))}</span>{selected.includes(opt.label)&&<span className="option-check">✓</span>}
        </button>)}</div>
        {selected.includes("Sick/Injured")&&onReportComplaint&&<button className="sheet-link" onClick={()=>{save();onReportComplaint();}}>
          <Icon name="alert" size={18}/><span>Verletzt? Speichern und melden, wo es weh tut</span><Icon name="arrow" size={16}/></button>}
        <div className="sheet-footer"><button className="secondary" disabled={fixedMatch} onClick={()=>setOtherMode(true)}>Andere Einheit</button>
          <button className="secondary" disabled={fixedMatch} aria-pressed={selected.length===0} onClick={()=>setSelected([])}>Ruhetag</button></div>
      </>}
      {onSwap&&!otherMode&&<button className="text-btn swap-link" onClick={onSwap}><Icon name="swap" size={16}/> Mit einem anderen Tag tauschen</button>}
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

// ─── Today: rings ────────────────────────────────────────────────────────────────
// Three glanceable rings for the selected day: training, protein and the week's
// priority sessions. Each ring has a text label and value, never colour alone.
const reduceMotion=()=>{try{return window.matchMedia("(prefers-reduced-motion: reduce)").matches;}catch{return false;}};
const scrollToId=id=>document.getElementById(id)?.scrollIntoView({behavior:reduceMotion()?"auto":"smooth",block:"start"});
function Ring({value,max,color,label,sub,badge,ariaLabel,onClick,children}) {
  const r=27,c=2*Math.PI*r,frac=max>0?Math.max(0,Math.min(1,value/max)):0;
  return <button className="ring" onClick={onClick} aria-label={ariaLabel}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r={r} className="ring-track"/>
      {frac>0&&<circle cx="32" cy="32" r={r} className="ring-value" stroke={color} strokeLinecap="round"
        strokeDasharray={`${(c*frac).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 32 32)"/>}</svg>
    <span className="ring-center" aria-hidden="true">{children}</span>
    {badge&&<span className={"ring-badge "+badge.key} aria-hidden="true">{badge.mark}</span>}
    <span className="ring-label">{label}</span><small>{sub}</small>
  </button>;
}
function DayRings({plan,viewKey,target,onOpenPlan,children}) {
  const today=todayStr(),e=plan[viewKey]||{},sessions=getSessions(e);
  const protein=dayProtein(e),level=nutritionLevel(e.nutrition);
  const phase=phaseForDate(viewKey),week=isHoliday(viewKey)?{done:0,goal:0}:weekTargetProgress(plan,weekAround(viewKey),phase?.name);
  const status=!sessions.length?"Ruhetag":e.completed?"erledigt":viewKey>today?"geplant":viewKey<today?"nicht eingetragen":"offen";
  const check=dayChecklist(e,viewKey,today,target);
  const summary=check.future?"Vorschau. Ernährung trägst du am Tag selbst ein."
    :check.open.length?<>{viewKey===today?"Noch offen: ":"Nicht eingetragen: "}<strong>{check.open.join(" · ")}</strong></>
    :viewKey===today?"Alles erledigt für heute. Stark.":"Alles eingetragen.";
  const recovery=viewKey<=today?recoveryStatus(plan,viewKey):null;
  const hasStatus=!!recovery||!!children;
  return <section className="panel rings" aria-label="Tagesübersicht">
    {hasStatus&&<div className="day-status">
    {recovery&&<div className={"recovery "+recovery.level} role="status"
      aria-label={"Erholung: "+RECOVERY_LABELS[recovery.level]+". "+recovery.signals.map(x=>x.text).join(", ")}>
      <span className="recovery-badge"><span className="recovery-dot" aria-hidden="true"/>{RECOVERY_LABELS[recovery.level]}</span>
      {/* Compact: sleep always, other signals only when they stand out. Details live in Körper. */}
      <span className="recovery-signals" aria-hidden="true">{recovery.signals.filter(x=>x.key==='sleep'||x.level!=='good').map(x=>
        <span key={x.key} className={x.level!=='good'?'flag':''}>{x.short}</span>)}</span>
    </div>}
    {children}</div>}
    <div className="ring-row">
      <Ring value={e.completed&&sessions.length?1:0} max={1} color="#9CCBD3" label="Training" sub={status}
        ariaLabel={"Training: "+status} onClick={()=>scrollToId("today-session")}>
        {e.completed&&sessions.length?<Chk size={20} color="#B3DCE2"/>:<Icon name={sessions.length?(isMatchDay(e)?"Match":sessions[0]):"rest"} size={22}/>}
      </Ring>
      <Ring value={protein||0} max={target} color="#A9D8B8" label="Protein" sub={"von "+target+" g"} badge={level}
        ariaLabel={"Protein: "+(protein==null?"nicht erfasst":protein+" von "+target+" Gramm")+(level?" · Ernährung "+level.label:"")}
        onClick={()=>scrollToId("today-nutrition")}>
        {protein==null?"–":<>{protein}<small>g</small></>}
      </Ring>
      <Ring value={week.done} max={week.goal} color="#B9B4E6" label="Woche" sub={week.goal?"Kraft · Reha":"Pause"}
        ariaLabel={week.goal?`Wochenziele: ${week.done} von ${week.goal}. Plan öffnen`:"Keine Wochenziele. Plan öffnen"} onClick={onOpenPlan}>
        {week.goal?<>{week.done}<small>/{week.goal}</small></>:"–"}
      </Ring>
    </div>
    <p className="day-summary">{summary}</p>
  </section>;
}

// ─── Social matches (Today, Körper) ─────────────────────────────────────────────
function useSheetFocus(onClose) {
  const dialog=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";dialog.current?.focus();
    const key=ev=>{if(ev.key==="Escape"){ev.preventDefault();closeRef.current();}};
    document.addEventListener("keydown",key);
    return ()=>{document.body.style.overflow=overflow;document.removeEventListener("keydown",key);previous?.focus();};
  },[]);
  return dialog;
}
const socialWhen=(m,today=todayStr())=>`${m.date===today?"Heute":m.date===daysBeforeStr(today,-1)?"Morgen":m.date===daysBeforeStr(today,1)?"Gestern":shortDate(m.date)} ${m.kickoff}`;
function OutcomeChip({outcome}) {
  const o=SOCIAL_OUTCOMES[outcome];
  return <span className={"outcome-chip "+outcome} title={o.label} aria-label={o.label}>{o.short}</span>;
}
// Plan or change a match: day, kick-off, occasion, match or Testspiel, three rules.
function SocialSheet({social,match,initialDate,initialFriendly,onSave,onCancel,onClose}) {
  const today=todayStr(),defaults=socialRules(social.rules);
  const days=Array.from({length:8},(_,i)=>daysBeforeStr(today,-i)),taken=new Set(socialMatches(social.matches).map(m=>m.date));
  const [date,setDate]=useState(match?.date||initialDate||days.find(dk=>!taken.has(dk))||today),[kickoff,setKickoff]=useState(match?.kickoff||"19:00");
  const [occasion,setOccasion]=useState(match?.occasion||"restaurant"),[friendly,setFriendly]=useState(match?match.friendly:!!initialFriendly);
  // Three slots; tapping a chosen rule empties its slot, the next rule picked fills that same slot.
  const [slots,setSlots]=useState(()=>[...(match&&!match.friendly?match.rules:defaults)]),[custom,setCustom]=useState("");
  const [asDefault,setAsDefault]=useState(false),[error,setError]=useState("");
  const dialog=useSheetFocus(onClose);
  const rules=slots.filter(Boolean),full=rules.length===3;
  const options=[...new Set([...defaults,...SOCIAL_RULE_OPTIONS])].filter(r=>!rules.includes(r));
  const put=r=>setSlots(sl=>{const i=sl.findIndex(x=>!x);return i>=0?sl.map((x,j)=>j===i?r:x):sl.length<3?[...sl,r]:sl;});
  const pick=r=>{setError("");if(rules.includes(r))setSlots(sl=>sl.map(x=>x===r?null:x));else if(!full)put(r);};
  const addCustom=()=>{const t=socialText(custom);if(!t||rules.includes(t)||full)return;put(t);setCustom("");};
  const differs=full&&rules.join("|")!==defaults.join("|");
  const fa=friendlyAllowed(social.matches,date,social.holidays,match?.id);
  const ready=friendly?fa.ok:full;
  const save=()=>{const err=onSave({id:match?.id,date,kickoff,occasion,friendly,rules},asDefault&&differs&&!friendly);if(err)setError(err);};
  return <>
    <div className="sheet-backdrop" onClick={onClose}/>
    <section className="sheet social-sheet" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="social-title" tabIndex={-1}>
      <div className="sheet-handle"/>
      <div className="sheet-heading"><div><div className="eyebrow">Social Match</div><h2 id="social-title">{match?"Match ändern":"Vor dem Anpfiff"}</h2></div>
        <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><Icon name="close"/></button></div>
      <div className="sheet-scroll">
      <div className="segmented social-mode" role="group" aria-label="Art">
        <button aria-pressed={!friendly} onClick={()=>{setFriendly(false);setError("");}}>Match · zählt</button>
        <button aria-pressed={friendly} onClick={()=>{setFriendly(true);setError("");}}>Testspiel · frei</button></div>
      <div className="field-label">Wann</div>
      <div className="social-days">{days.map((dk,i)=><button key={dk} className="chip" aria-pressed={date===dk} onClick={()=>{setDate(dk);setError("");}}>
        {i===0?"Heute":i===1?"Morgen":`${DN[dow0(new Date(dk+"T12:00:00"))]} ${Number(dk.slice(-2))}.`}</button>)}</div>
      <div className="field-label">Anlass</div>
      <div className="social-chips">{SOCIAL_OCCASIONS.map(o=>
        <button key={o.key} className="chip" aria-pressed={occasion===o.key} onClick={()=>setOccasion(o.key)}>{o.label}</button>)}</div>
      <label className="kickoff-row"><span>Anpfiff</span>
        <input className="kickoff-input" type="time" value={kickoff} onChange={e=>{setKickoff(e.target.value);setError("");}}/></label>
      {friendly?<p className={"helper-text"+(fa.ok?"":" warn-text")}>{fa.ok?"Ein geplanter freier Abend. Zählt nicht für die Tabelle, muss aber vorher feststehen. Höchstens eins pro Woche, in den Ferien eins alle drei Tage.":fa.reason}</p>
      :<>
        <div className="field-label">Deine drei Regeln <span className="rule-count">{rules.length} von 3</span></div>
        <div className="social-chips rules">{slots.map((r,i)=>r?<button key={"s"+i} className="chip" aria-pressed="true"
            aria-label={`Regel ${i+1}: ${r}. Antippen, um sie zu ersetzen`} onClick={()=>pick(r)}><b>{i+1}</b>{r}</button>
          :<span key={"s"+i} className="rule-slot"><b>{i+1}</b>Neue Regel wählen</span>)}</div>
        {full?<p className="protein-hint rule-hint">Regel antippen, um sie zu ersetzen.</p>:<>
          <div className="social-chips rules options">{options.map(r=><button key={r} className="chip" onClick={()=>pick(r)}>{r}</button>)}</div>
          <div className="protein-edit social-custom"><input className="modal-input" maxLength={60} placeholder="Eigene Regel" value={custom}
            onChange={e=>setCustom(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addCustom();}}/>
            <button className="secondary social-add" aria-label="Regel hinzufügen" disabled={!socialText(custom)} onClick={addCustom}><Icon name="plus" size={20}/></button></div></>}
        {differs&&<label className="check-row"><input type="checkbox" checked={asDefault} onChange={e=>setAsDefault(e.target.checked)}/> Als meine Standard-Regeln merken</label>}
      </>}
      </div>
      <div className="sheet-actions">
        {error&&<p role="alert" className="helper-text warn-text">{error}</p>}
        <button className="primary" style={{width:"100%"}} disabled={!ready} onClick={save}>
          {match?"Speichern":friendly?"Testspiel festlegen":"Match planen"}{!friendly&&!full?` (${rules.length}/3 Regeln)`:""}</button>
        {match&&<button className="text-btn" style={{width:"100%",justifyContent:"center"}} onClick={()=>onCancel(match.id)}>Absagen</button>}
      </div>
    </section>
  </>;
}
// Each day shows its own match. Today also lists unscored matches from earlier days, a
// result scored today and, during holidays, a nudge to plan the evening.
function SocialCard({social,viewKey,onPlan,onEdit,onEvaluate,onCancel}) {
  const today=todayStr(),now=new Date(),all=socialMatches(social.matches),isToday=viewKey===today;
  const pending=socialPending(all,now).filter(m=>isToday?m.date<=today:m.date===viewKey);
  const soon=all.filter(m=>m.date===viewKey&&!m.result&&!socialStarted(m,now));
  const scored=isToday?all.filter(m=>m.result&&(m.result.at===today||m.date===today)).at(-1):all.find(m=>m.date===viewKey&&m.result);
  const holiday=isToday?holidayFor(social.holidays,today):null;
  const when=m=>m.date===viewKey&&!isToday?`Anpfiff ${m.kickoff}`:socialWhen(m,today);
  const [kept,setKept]=useState({}),[openId,setOpenId]=useState(null);
  const [skip,setSkip]=useState(()=>{try{return localStorage.getItem("social-skip")===today;}catch{return false;}});
  const nudge=holiday&&!skip&&!all.some(m=>m.date===today)&&new Date().getHours()<22;
  if(!pending.length&&!soon.length&&!scored&&!nudge)return null;
  const season=socialTable(all);
  const evaluate=m=>{const k=kept[m.id]||[];return <div className="social-eval" key={m.id}>
    {m.rules.map((r,i)=><div className="social-rule" key={i}><span><b>{i+1}</b>{r}</span>
      <div className="kept-toggle" role="group" aria-label={r}>
        <button aria-pressed={k[i]===true} className="kept" aria-label="Gehalten" onClick={()=>setKept({...kept,[m.id]:Object.assign([...k],{[i]:true})})}><Icon name="check" size={20}/></button>
        <button aria-pressed={k[i]===false} className="broken" aria-label="Gebrochen" onClick={()=>setKept({...kept,[m.id]:Object.assign([...k],{[i]:false})})}><Icon name="close" size={18}/></button></div></div>)}
    {[0,1,2].every(i=>typeof k[i]==="boolean")?<p className="social-preview"><OutcomeChip outcome={socialOutcome(k)}/>{SOCIAL_OUTCOMES[socialOutcome(k)].label} · {SOCIAL_OUTCOMES[socialOutcome(k)].points} {SOCIAL_OUTCOMES[socialOutcome(k)].points===1?"Punkt":"Punkte"}</p>
      :<p className="protein-hint">✓ gehalten, ✗ gebrochen. Eine gebrochene Regel ist ein Gegentor, kein verlorenes Spiel.</p>}
    <button className="primary social-wide" disabled={![0,1,2].every(i=>typeof k[i]==="boolean")} onClick={()=>onEvaluate(m.id,[0,1,2].map(i=>k[i]))}>Abpfiff: Ergebnis speichern</button>
    <button className="text-btn social-skip" onClick={()=>onCancel(m.id)}>Fand nicht statt</button>
  </div>;};
  return <section className="panel social-card" aria-label="Social Match">
    {pending.map(m=>{const live=m.date===today&&openId!==m.id;
      return <div key={m.id} className="social-block">
        <div className="card-head"><span className="eyebrow social-eyebrow"><Icon name="glass" size={14}/>{live?"Match läuft":"Auswerten"}</span><small>{when(m)} · {occasionLabel(m.occasion)}</small></div>
        {live?<><ol className="social-rules">{m.rules.map(r=><li key={r}>{r}</li>)}</ol>
          <button className="secondary social-wide" onClick={()=>setOpenId(m.id)}>Zu Hause? Jetzt auswerten</button></>:evaluate(m)}
      </div>;})}
    {soon.map(m=><div key={m.id} className="social-block">
      <div className="card-head"><span className="eyebrow social-eyebrow"><Icon name="glass" size={14}/>{m.friendly?"Testspiel":"Social Match"}</span><small>{when(m)} · {occasionLabel(m.occasion)}</small></div>
      {m.friendly?<p className="helper-text">Geplanter freier Abend: zählt nicht für die Tabelle. Geniess ihn bewusst.</p>
        :<ol className="social-rules">{m.rules.map(r=><li key={r}>{r}</li>)}</ol>}
      <div className="social-foot"><span>Bis zum Anpfiff änderbar</span><button className="text-btn" onClick={()=>onEdit(m)}><Icon name="edit" size={15}/> Ändern</button></div>
    </div>)}
    {scored&&!pending.some(m=>m.id===scored.id)&&<div className="social-block social-result">
      <div className="card-head"><span className="eyebrow social-eyebrow"><Icon name="glass" size={14}/>Abpfiff</span><small>{when(scored)}</small></div>
      <p className="social-score"><OutcomeChip outcome={scored.result.outcome}/>{SOCIAL_OUTCOMES[scored.result.outcome].label} · {scored.result.points} {scored.result.points===1?"Punkt":"Punkte"}</p>
      {scored.result.outcome!=="win"&&<p className="helper-text">Gegentor: {scored.rules.filter((r,i)=>!scored.result.kept[i]).join(" · ")}.{isToday?" Abhaken, nächstes Spiel.":""}</p>}
      {isToday&&<p className="protein-hint">Saison: Ø {season.avg?.toFixed(1)} Punkte aus {season.played} {season.played===1?"Match":"Matches"} · Ziel Ø {SOCIAL_GOAL.toFixed(1)}</p>}
    </div>}
    {nudge&&!pending.length&&<div className="social-block">
      <div className="card-head"><span className="eyebrow social-eyebrow"><Icon name="glass" size={14}/>{holiday.name}</span>
        <small>Turnier · Tag {dayNumber(today)-dayNumber(holiday.start)+1}/{dayNumber(holiday.end)-dayNumber(holiday.start)+1}</small></div>
      <p className="helper-text">Heute Abend auswärts essen oder trinken? Dann ist es ein Match, mit drei Regeln vorher.</p>
      <div className="social-actions"><button className="primary" onClick={()=>onPlan(today,false)}>Match planen</button>
        <button className="secondary" onClick={()=>onPlan(today,true)}>Testspiel</button>
        <button className="text-btn" onClick={()=>{try{localStorage.setItem("social-skip",today);}catch{}setSkip(true);}}>Heute nicht</button></div>
    </div>}
  </section>;
}
// Körper: the league table, recent matches and holiday tournaments.
function SocialSection({social,onPlan,onAddHoliday,onRemoveHoliday}) {
  const all=socialMatches(social.matches),t=socialTable(all),today=todayStr();
  const recent=all.filter(m=>m.result||(m.friendly&&m.date<=today)).slice(-5).reverse();
  const tours=holidayTournaments(all,social.holidays).filter(h=>h.end>=daysBeforeStr(today,365));
  const [form,setForm]=useState(null),[error,setError]=useState("");
  const addHoliday=()=>{const err=onAddHoliday(form);if(err)setError(err);else{setForm(null);setError("");}};
  return <section aria-label="Social Matches">
    <div className="section-heading"><h2>Social Matches</h2><span>Ziel Ø {SOCIAL_GOAL.toFixed(1)} Punkte</span></div>
    <div className="panel social-table">
      {t.played?<><div className="social-head">
          <div><strong className={t.avg>=SOCIAL_GOAL?"good":"short"}>{t.avg.toFixed(1)}</strong><span>Ø Punkte pro Match</span></div>
          <div className="social-record"><span><b>{t.wins}</b> S</span><span><b>{t.draws}</b> U</span><span><b>{t.losses}</b> N</span></div></div>
        <div className="social-form"><span>Form</span>{t.form.map((o,i)=><OutcomeChip key={i} outcome={o}/>)}</div>
        {t.brokenRules[0]&&<p className="protein-hint">Häufigstes Gegentor: {t.brokenRules[0].rule} ({t.brokenRules[0].times}×)</p>}</>
        :<p className="helper-text">Noch keine gewerteten Matches. Restaurant, Bar oder Essen bei Freunden: vorher drei Regeln festlegen, danach zählen.</p>}
      <p className="chart-caption">{t.played} {t.played===1?"Match":"Matches"} · {t.friendlies} {t.friendlies===1?"Testspiel":"Testspiele"} · Sieg 3, Unentschieden 1, Niederlage 0</p>
      <button className="secondary social-wide" onClick={()=>onPlan()}><Icon name="glass" size={18}/> Social Match planen</button>
      {recent.length>0&&<ul className="social-list">{recent.map(m=><li key={m.id}>
        <span>{shortDate(m.date)} · {occasionLabel(m.occasion)}</span>
        {m.friendly?<small>Testspiel</small>:<><small>{m.result.points} {m.result.points===1?"Pkt":"Pkt"}</small><OutcomeChip outcome={m.result.outcome}/></>}</li>)}</ul>}
    </div>
    <div className="social-subhead"><span className="eyebrow">Ferien-Turniere</span>
      {!form&&<button className="text-btn" onClick={()=>setForm({name:"",start:today,end:daysBeforeStr(today,-6)})}><Icon name="plus" size={15}/> Ferien eintragen</button>}</div>
    {form&&<div className="panel social-holiday-form">
      <label className="field-label">Name<input className="modal-input" maxLength={40} placeholder="z. B. Skiferien" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <div className="body-fields"><label>Von<input className="modal-input" type="date" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></label>
        <label>Bis<input className="modal-input" type="date" value={form.end} onChange={e=>setForm({...form,end:e.target.value})}/></label></div>
      {error&&<p role="alert" className="helper-text warn-text">{error}</p>}
      <div className="sheet-footer"><button className="primary" onClick={addHoliday}>Speichern</button><button className="secondary" onClick={()=>{setForm(null);setError("");}}>Abbrechen</button></div>
    </div>}
    {tours.length?<div className="panel measure-list">{tours.map(h=><div key={h.id} className="tour-row">
      <span><strong>{h.name}</strong><small>{shortDate(h.start)} – {shortDate(h.end)}</small></span>
      <span className="tour-score">{h.table.played?<>{h.table.wins}-{h.table.draws}-{h.table.losses} · Ø {h.table.avg.toFixed(1)}</>:h.start>today?"steht an":"keine Matches"}</span>
      {!h.table.played&&!h.table.friendlies&&<button className="icon-btn" aria-label={h.name+" entfernen"} onClick={()=>onRemoveHoliday(h.id)}><Icon name="close" size={16}/></button>}
    </div>)}</div>
    :!form&&<p className="protein-hint">In den Ferien zählt jeder Abend auswärts als eigenes Match. Trag deine nächsten Ferien ein, dann wird daraus ein Turnier mit eigener Bilanz.</p>}
  </section>;
}

// ─── Complaints (Today) ──────────────────────────────────────────────────────────
// Two taps: body area, then severity (saves). Side is optional.
function ComplaintSheet({onReport,onClose}) {
  const [area,setArea]=useState(null),[side,setSide]=useState(null);
  const dialog=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";dialog.current?.focus();
    const key=ev=>{if(ev.key==="Escape"){ev.preventDefault();closeRef.current();}};
    document.addEventListener("keydown",key);
    return ()=>{document.body.style.overflow=overflow;document.removeEventListener("keydown",key);previous?.focus();};
  },[]);
  const a=area?complaintArea(area):null;
  return <>
    <div className="sheet-backdrop" onClick={onClose}/>
    <section className="sheet" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="complaint-title" tabIndex={-1}>
      <div className="sheet-handle"/>
      <div className="sheet-heading"><div><div className="eyebrow">Beschwerde melden</div><h2 id="complaint-title">Wo zwickt es?</h2></div>
        <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><Icon name="close"/></button></div>
      <div className="complaint-areas">{COMPLAINT_AREAS.map(x=><button key={x.key} className="chip" aria-pressed={area===x.key}
        onClick={()=>{setArea(x.key);if(!x.sided)setSide(null);}}>{x.label}</button>)}</div>
      {a?.sided&&<div className="complaint-sides" role="group" aria-label="Seite">{["links","rechts"].map(sd=>
        <button key={sd} className="chip" aria-pressed={side===sd} onClick={()=>setSide(side===sd?null:sd)}>{sd[0].toUpperCase()+sd.slice(1)}</button>)}</div>}
      {a&&<><p className="helper-text">Wie stark?</p>
        <div className="complaint-levels">{COMPLAINT_LEVELS.map(l=><button key={l.level} className={"complaint-level l"+l.level}
          onClick={()=>{onReport({area,side,level:l.level});onClose();}}><strong>{l.label}</strong><small>{l.hint}</small></button>)}</div></>}
      <p className="helper-text">Keine Diagnose: Bei starken oder anhaltenden Schmerzen bitte ärztlich oder physiotherapeutisch abklären lassen.</p>
    </section>
  </>;
}
function ComplaintStrip({complaints,onReport,onResolve}) {
  const today=todayStr(),active=activeComplaints(complaints,today),[open,setOpen]=useState(null);
  const stale=c=>complaintDays({since:c.updated},today)>3;
  if(!active.length)return null;
  return <section className="complaint-strip" aria-label="Aktive Beschwerden">{active.map(c=>{const days=complaintDays(c,today);
    return <div key={c.id} className={"complaint-row l"+c.level}>
      <button className="complaint-summary" aria-expanded={open===c.id} onClick={()=>setOpen(open===c.id?null:c.id)}>
        <span className="complaint-dot" aria-hidden="true"/><span><strong>{complaintLabel(c)}</strong> · {COMPLAINT_LEVELS[c.level-1].label}
          <small>{days===1?"seit heute":`seit ${days} Tagen`}{stale(c)?" · noch aktuell?":""}</small></span><Icon name="edit" size={15}/></button>
      {open===c.id&&<div className="complaint-update">{COMPLAINT_LEVELS.map(l=><button key={l.level} className="chip" aria-pressed={c.level===l.level}
          onClick={()=>{onReport({area:c.area,side:c.side,level:l.level});setOpen(null);}}>{l.label}</button>)}
        <button className="chip good" onClick={()=>{onResolve(c.id);setOpen(null);}}>Wieder gut</button></div>}
    </div>;})}</section>;
}

// ─── Load card (Today) ───────────────────────────────────────────────────────────
const LOAD_SHORT={low:'Unter Bereich',optimal:'Im Bereich',high:'Über Bereich',veryHigh:'Deutlich darüber'};
function LoadCard({plan,dk,complaints}) {
  const status=loadStatus(plan,dk),advice=loadAdvice(plan,dk,status,recoveryStatus(plan,dk),complaints),[open,setOpen]=useState(false);
  if(!status.ready&&!status.historyDays)return null;
  const typical=status.ready?typicalLoads(plan,dk):{},planned=status.ready?plannedLoad(plan,dk,typical):{load:0};
  const scaleMax=status.ready?Math.max(status.veryHigh*1.15,status.acute+planned.load)*1.05:1;
  const pos=v=>Math.max(0,Math.min(100,v/scaleMax*100))+"%";
  return <section className="panel load-card" aria-label="Trainingsbelastung">
    {status.ready?<button className="load-summary" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
      <span className="eyebrow">Belastung</span>
      <span className="load-inline"><strong>{status.acute}</strong><small>7 Tage</small><span className={"load-tag "+status.status}>{LOAD_SHORT[status.status]}</span>
        <Icon name="chevron" size={16} className={"chev"+(open?" up":"")}/></span>
    </button>:<div className="card-head"><span className="eyebrow">Belastung · 7 Tage</span></div>}
    <p className="load-advice">{advice}</p>
    {open&&status.ready&&<div className="load-details">
      <div className="load-bar" aria-hidden="true">
        <span className="zone optimal" style={{left:pos(status.low),width:`calc(${pos(status.high)} - ${pos(status.low)})`}}/>
        <span className="zone high" style={{left:pos(status.high),width:`calc(${pos(status.veryHigh)} - ${pos(status.high)})`}}/>
        <span className="zone very" style={{left:pos(status.veryHigh),right:0}}/>
        {planned.load>0&&<span className="planned" style={{left:pos(status.acute),width:`calc(${pos(status.acute+planned.load)} - ${pos(status.acute)})`}}/>}
        <span className="marker" style={{left:pos(status.acute)}}/>
      </div>
      <p className="load-range">Dein Bereich {status.low}–{status.high}{planned.load>0?` · heute geplant ≈ ${planned.load}`:""}</p>
      <p className="chart-caption">Garmin-Trainingsbelastung der letzten 7 Tage. Bereich: dein Wochenschnitt der letzten 4 Wochen × 0.8–1.3. Zählt nur, was die Uhr aufzeichnet.</p>
    </div>}
  </section>;
}

// ─── Nutrition card (Today) ──────────────────────────────────────────────────────
// Photo a meal and the estimate is saved right away; opening a meal to correct it is
// optional. Quick-add protein (+20/+30/+40 g) stays for shakes and snacks. Only writes
// `protein`, `meals` and `nutrition`; never touches sessions.
const MEAL_ERRORS={
  access_denied:"Der Zugangscode stimmt nicht.",
  access_code_not_configured:"In Vercel fehlt noch APP_ACCESS_CODE.",
  model_not_configured:"Auf dem Server fehlt der Anthropic-Schlüssel.",
  invalid_image:"Das Foto konnte nicht gelesen werden.",
  no_food:"Auf dem Foto ist kein Essen zu erkennen.",
  meal_refused:"Dieses Foto kann nicht analysiert werden.",
  meal_busy:"Gerade viele Anfragen. Gleich erneut versuchen.",
  meal_unreadable:"Die Schätzung hat nicht geklappt.",
  meal_unavailable:"Die Schätzung hat nicht geklappt.",
  network:"Keine Verbindung.",
};
const nowTime=()=>new Date().toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"});
// Downscale on the phone: faster upload, cheaper analysis, nothing stored.
async function prepareMealPhoto(file,maxSide=1280) {
  const url=URL.createObjectURL(file);
  try{
    // onload instead of img.decode(): decode() can stay pending in some WebViews.
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error("unreadable"));i.src=url;});
    const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL("image/jpeg",0.82);
    return {base64:dataUrl.slice(dataUrl.indexOf(",")+1),preview:dataUrl};
  }finally{URL.revokeObjectURL(url);}
}
function MealRow({meal,onSave,onRemove,isFavorite,onToggleFavorite}) {
  const [open,setOpen]=useState(false),[kcal,setKcal]=useState(String(meal.kcal)),[protein,setProtein]=useState(String(meal.protein)),[title,setTitle]=useState(meal.title);
  const num=v=>v.trim()===""?NaN:Number(v.replace(",","."));
  const k=num(kcal),p=num(protein),valid=Number.isFinite(k)&&k>=0&&k<=5000&&Number.isFinite(p)&&p>=0&&p<=300&&title.trim()!=="";
  const changed=valid&&(Math.round(k)!==meal.kcal||Math.round(p)!==meal.protein||title.trim()!==meal.title);
  const save=()=>{if(!valid)return;onSave({title:title.trim().slice(0,40),kcal:Math.round(k),protein:Math.round(p),...(changed?{edited:true}:{})});setOpen(false);};
  // Saving as favourite takes the values in the fields, so a corrected portion is what gets reused.
  const toggleFavorite=()=>{if(isFavorite){onToggleFavorite(null);return;}if(!valid)return;
    const values={title:title.trim().slice(0,40),kcal:Math.round(k),protein:Math.round(p)};
    if(changed)onSave({...values,edited:true});onToggleFavorite({...meal,...values});};
  const range=meal.kcalLow!=null&&meal.kcalHigh!=null&&meal.kcalHigh>meal.kcalLow?`${meal.kcalLow}–${meal.kcalHigh} kcal`:"";
  return <li className={"meal-row"+(open?" open":"")}>
    <button className="meal-summary" aria-expanded={open} onClick={()=>{setKcal(String(meal.kcal));setProtein(String(meal.protein));setTitle(meal.title);setOpen(o=>!o);}}>
      <span><strong>{isFavorite&&<Icon name="star" size={12}/>}{meal.title}</strong><small>{meal.at}{meal.source==="favorite"?" · Favorit":meal.edited?" · angepasst":range?` · ${range}`:""}{meal.source!=="favorite"&&!meal.edited&&meal.confidence==="low"?" · unsicher":""}</small></span>
      <b>{meal.kcal} kcal<small>{meal.protein} g Protein</small></b>
    </button>
    {open&&<div className="meal-detail">
      {Array.isArray(meal.items)&&meal.items.length>0&&<ul>{meal.items.map((i,n)=><li key={n}><span>{i.name}{i.grams?` · ${i.grams} g`:""}</span><span>{i.kcal} kcal · {Math.round(i.protein)} g</span></li>)}</ul>}
      <label className="meal-name">Name<input className="modal-input" maxLength={40} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="meal-edit">
        <label>kcal<input className="modal-input" inputMode="numeric" value={kcal} onChange={e=>setKcal(e.target.value)}/></label>
        <label>Protein (g)<input className="modal-input" inputMode="numeric" value={protein} onChange={e=>setProtein(e.target.value)}/></label>
      </div>
      {!valid&&<p role="alert" className="protein-hint">Bitte gültige Werte eingeben.</p>}
      <button className="text-btn fav-toggle" aria-pressed={!!isFavorite} disabled={!isFavorite&&!valid} onClick={toggleFavorite}>
        <Icon name="star" size={16}/> {isFavorite?"Aus Favoriten entfernen":"Als Favorit merken"}</button>
      <div className="sheet-footer"><button className="primary" disabled={!valid} onClick={save}>Speichern</button><button className="secondary" onClick={onRemove}>Löschen</button></div>
    </div>}
  </li>;
}
// Favourites row: one tap adds the meal; "Verwalten" removes favourites or adds one by hand (e.g. a shake).
function FavoriteMeals({favorites,onUse,onSave,onRemove,quick}) {
  const favs=favoriteList(favorites),[manage,setManage]=useState(false),[form,setForm]=useState({title:"",kcal:"",protein:""});
  const num=v=>v.trim()===""?NaN:Number(v.replace(",","."));
  const k=num(form.kcal),p=num(form.protein),valid=form.title.trim()!==""&&Number.isFinite(k)&&k>=0&&k<=5000&&Number.isFinite(p)&&p>=0&&p<=300;
  const add=()=>{if(!valid)return;onSave({title:form.title,kcal:k,protein:p});setForm({title:"",kcal:"",protein:""});};
  return <div className="fav-block">
    <div className="fav-head"><span className="eyebrow">Schnell eintragen</span>
      <button className="text-btn" aria-expanded={manage} onClick={()=>setManage(m=>!m)}>{manage?"Fertig":favs.length?"Verwalten":"Anlegen"}</button></div>
    {!manage||favs.length>0?<div className="fav-chips">{favs.map(f=>manage
      ?<button key={f.id} className="chip fav-chip remove" aria-label={f.title+" aus Favoriten entfernen"} onClick={()=>onRemove(f.id)}>
        <span>{f.title}</span><Icon name="close" size={14}/></button>
      :<button key={f.id} className="chip fav-chip" aria-label={`${f.title} eintragen, ${f.protein} g Protein, ${f.kcal} kcal`} onClick={()=>onUse(f)}>
        <span>{f.title}</span><small>{f.protein} g · {f.kcal} kcal</small></button>)}{!manage&&quick}</div>:null}
    {!manage&&!favs.length&&<p className="protein-hint">Was du oft isst, einmal merken: Mahlzeit antippen → „Als Favorit merken". Danach reicht ein Tipp.</p>}
    {manage&&<div className="fav-form">
      <label className="meal-name">Name<input className="modal-input" maxLength={40} placeholder="z. B. Proteinshake" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <div className="meal-edit">
        <label>kcal<input className="modal-input" inputMode="numeric" value={form.kcal} onChange={e=>setForm({...form,kcal:e.target.value})}/></label>
        <label>Protein (g)<input className="modal-input" inputMode="numeric" value={form.protein} onChange={e=>setForm({...form,protein:e.target.value})}/></label>
      </div>
      <button className="secondary" disabled={!valid} onClick={add}>Favorit hinzufügen</button>
    </div>}
  </div>;
}
function NutritionCard({entry,dateKey:dk,updDay,target,onAddMeal,onUpdateMeal,onRemoveMeal,favorites,onSaveFavorite,onRemoveFavorite,onUseFavorite,onPlanSocial}) {
  const today=todayStr(),future=dk>today;
  const quick=validProtein(entry.protein)?entry.protein:null,meals=dayMeals(entry);
  const protein=dayProtein(entry),kcal=dayKcal(entry),mealProtein=meals.reduce((n,m)=>n+m.protein,0),level=nutritionLevel(entry.nutrition);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(""),[lastAdd,setLastAdd]=useState(null),[pending,setPending]=useState([]),[lastFav,setLastFav]=useState(null);
  const useFav=f=>{const id="f"+Date.now().toString(36)+Math.random().toString(36).slice(2,5);onUseFavorite(dk,f,id,dk===today?nowTime():"");setLastFav({id,title:f.title});};
  const cameraRef=useRef(null),libraryRef=useRef(null),hasCode=!!readAccessCode();
  const add=g=>{updDay(dk,{protein:Math.min(500,(quick||0)+g)});setLastAdd({g,prev:quick});};
  const undo=()=>{if(!lastAdd)return;updDay(dk,{protein:lastAdd.prev});setLastAdd(null);};
  const parsed=draft.trim()===""?null:Number(draft.replace(",","."));
  const draftOk=parsed===null||validProtein(parsed);
  const startEdit=()=>{setDraft(protein==null?"":String(protein));setEditing(true);setLastAdd(null);};
  // The pencil corrects the day total; photographed meals stay, the quick-add part absorbs the difference.
  const saveDraft=()=>{if(!draftOk)return;updDay(dk,{protein:parsed==null?null:Math.max(0,Math.round(parsed-mealProtein))});setEditing(false);};
  const setItem=(key,patch)=>setPending(list=>list.map(x=>x.key===key?{...x,...patch}:x));
  const analyze=async item=>{
    setItem(item.key,{status:"analyzing"});
    try{
      const res=await fetch("/api/meal",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({image:item.image,mediaType:"image/jpeg"})});
      const body=await res.json().catch(()=>({}));
      if(!res.ok||!body.meal){setItem(item.key,{status:"error",message:MEAL_ERRORS[body.error]||MEAL_ERRORS.meal_unavailable});return;}
      const m=body.meal;
      onAddMeal(dk,{id:item.key,at:item.at,title:m.title,kcal:m.kcal,protein:m.protein,kcalLow:m.kcalLow,kcalHigh:m.kcalHigh,confidence:m.confidence,items:m.items});
      setPending(list=>list.filter(x=>x.key!==item.key));
    }catch{setItem(item.key,{status:"error",message:MEAL_ERRORS.network});}
  };
  const onPhoto=async ev=>{
    const file=ev.target.files?.[0];ev.target.value="";
    if(!file)return;
    const key=Date.now().toString(36)+Math.random().toString(36).slice(2,7),at=nowTime();
    setPending(list=>[...list,{key,at,status:"preparing"}]);
    try{
      const {base64,preview}=await prepareMealPhoto(file);
      const item={key,at,image:base64,preview,status:"analyzing"};
      setItem(key,item);analyze(item);
    }catch{setItem(key,{status:"error",message:MEAL_ERRORS.invalid_image});}
  };
  return <section id="today-nutrition" className="panel nutrition-card" aria-label="Ernährung">
    <div className="card-head"><span className="eyebrow">Ernährung</span>
      {level&&<span className="ampel-tag"><span className={"ampel-dot "+level.key} aria-hidden="true">{level.mark}</span>{level.label}</span>}</div>
    {future?<p className="helper-text">Essen, Protein und Bewertung trägst du am Tag selbst ein.</p>:<>
      <div className="protein-head"><strong>{protein??0}<span> / {target} g Protein</span></strong>
        <span className={protein!=null&&protein>=target?"reached":""}>{protein==null?"noch nicht erfasst":protein>=target?"Ziel erreicht ✓":`noch ${target-protein} g`}
          {!editing&&<button className="icon-btn protein-fix" aria-label="Protein korrigieren" onClick={startEdit}><Icon name="edit" size={15}/></button>}</span></div>
      <div className="protein-bar" role="progressbar" aria-label="Protein" aria-valuemin={0} aria-valuemax={target} aria-valuenow={protein||0}>
        <span style={{width:Math.min(100,(protein||0)/target*100)+"%"}}/></div>
      {kcal!=null&&<p className="kcal-line">≈ {kcal.toLocaleString("de-CH")} kcal aus {meals.length} {meals.length===1?"Mahlzeit":"Mahlzeiten"}</p>}
      <div className="meal-photo">
        <button className="secondary" disabled={!hasCode} onClick={()=>cameraRef.current?.click()}><Icon name="camera" size={19}/> Mahlzeit fotografieren</button>
        <button className="secondary photo-library" disabled={!hasCode} aria-label="Foto aus der Mediathek wählen" onClick={()=>libraryRef.current?.click()}><Icon name="image" size={20}/></button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto}/>
        <input ref={libraryRef} type="file" accept="image/*" hidden onChange={onPhoto}/>
      </div>
      {!hasCode&&<p className="protein-hint">Für Fotos zuerst den Zugangscode in den Einstellungen speichern (Zahnrad oben rechts).</p>}
      {editing&&<div className="protein-edit">
        <input className="modal-input" aria-label="Protein in Gramm" inputMode="numeric" autoFocus value={draft} placeholder="z. B. 85"
          onChange={ev=>setDraft(ev.target.value)} onKeyDown={ev=>{if(ev.key==="Enter")saveDraft();if(ev.key==="Escape")setEditing(false);}}/>
        <button className="primary" disabled={!draftOk} onClick={saveDraft}>OK</button>
        <button className="secondary" onClick={()=>setEditing(false)}>Abbrechen</button></div>}
      {editing&&!draftOk&&<p role="alert" className="protein-hint">Bitte 0 bis 500 g eingeben.</p>}
      <FavoriteMeals favorites={favorites} onUse={f=>{setLastAdd(null);useFav(f);}} onSave={onSaveFavorite} onRemove={onRemoveFavorite}
        quick={PROTEIN_STEPS.map(g=><button key={g} className="chip fav-chip protein-chip" aria-label={g+" Gramm Protein hinzufügen"} onClick={()=>{setLastFav(null);add(g);}}>
          <span>+{g} g</span><small>Protein</small></button>)}/>
      {lastFav&&meals.some(m=>m.id===lastFav.id)&&<button className="text-btn undo-btn" onClick={()=>{onRemoveMeal(dk,lastFav.id);setLastFav(null);}}>
        {lastFav.title} eingetragen · Rückgängig</button>}
      {lastAdd&&!editing&&<button className="text-btn undo-btn" onClick={undo}>+{lastAdd.g} g Protein eingetragen · Rückgängig</button>}
      {(pending.length>0||meals.length>0)&&<ul className="meal-list" aria-label="Mahlzeiten">
        {meals.map(m=>{const fav=findFavorite(favorites,m);
          return <MealRow key={m.id} meal={m} onSave={patch=>onUpdateMeal(dk,m.id,patch)} onRemove={()=>onRemoveMeal(dk,m.id)} isFavorite={!!fav}
            onToggleFavorite={values=>{if(values)onSaveFavorite(values);else if(fav)onRemoveFavorite(fav.id);}}/>;})}
        {pending.map(p=><li key={p.key} className="meal-pending" role="status">
          {p.preview&&<img src={p.preview} alt=""/>}
          <span>{p.status==="preparing"?"Foto wird vorbereitet …":p.status==="analyzing"?"Wird geschätzt …":p.message}</span>
          {p.status==="error"&&<>{p.image&&<button className="text-btn" onClick={()=>analyze(p)}>Erneut</button>}
            <button className="text-btn" onClick={()=>setPending(list=>list.filter(x=>x.key!==p.key))}>Verwerfen</button></>}
        </li>)}
      </ul>}
      {protein==null&&!editing&&!pending.length&&<p className="protein-hint">Ohne Foto: Joghurt/Skyr ≈ 20 g · Portion Fleisch/Fisch ≈ 30 g · grosse Portion ≈ 40 g</p>}
      <div className="rating"><span className="rating-q">Wie hast du {dk===today?"heute":"an diesem Tag"} gegessen?</span>
        <div className="ampel" role="group" aria-label="Ernährung bewerten">{NUTRITION_LEVELS.map(l=>
          <button key={l.key} className={"ampel-btn "+l.key} aria-pressed={entry.nutrition===l.key}
            onClick={()=>updDay(dk,{nutrition:entry.nutrition===l.key?null:l.key})}>
            <span className={"ampel-dot "+l.key} aria-hidden="true">{l.mark}</span>{l.label}</button>)}</div>
        <p className="rating-hint">{level?level.hint:"Rot heisst: viel Süsses, Essen aus Lust statt Hunger, Fast Food."}</p>
      </div></>}
      {onPlanSocial&&<button className="text-btn social-link" onClick={onPlanSocial}><Icon name="glass" size={16}/> Auswärts essen oder trinken? Social Match planen</button>}
  </section>;
}

// ─── Up next (Today) ─────────────────────────────────────────────────────────────
function UpNextCard({plan,from,onSelect}) {
  const items=upcomingDays(plan,from,2);
  return <section className="panel upnext" aria-label="Als Nächstes"><div className="eyebrow">Als Nächstes</div>
    {items.length?items.map(item=>{const e=item.entry,day=new Date(item.date+"T12:00:00");
      return <button key={item.date} className={"upnext-row"+(isMatchDay(e)?" match":"")} onClick={()=>onSelect(item.date)}
        aria-label={upcomingLabel(e)+" · "+upcomingWhen(item)}>
        <span className="upnext-date"><small>{DN[dow0(day)]}</small><strong>{day.getDate()}</strong></span>
        <span className="upnext-info"><strong>{upcomingLabel(e)}</strong><small>{upcomingWhen(item)}</small></span>
        <SessionMarks entry={e}/>
      </button>;})
    :<p className="helper-text">In den nächsten sieben Tagen ist nichts geplant.</p>}
  </section>;
}

// ─── Today view ──────────────────────────────────────────────────────────────────
function TodayView({plan,updDay,dayOff,setDayOff,proteinTarget,onOpenPlan,meals,onOpenReport,complaints,onReportComplaint,onResolveComplaint,socialProps}) {
  const viewKey=offsetDate(dayOff), e=plan[viewKey]||{};
  const [sheetOpen,setSheetOpen]=useState(false);
  const [notesOpen,setNotesOpen]=useState(false);
  const [confirmUnlog,setConfirmUnlog]=useState(false);
  const [guideOpen,setGuideOpen]=useState(false),[complaintOpen,setComplaintOpen]=useState(false);
  const [direction,setDirection]=useState(1);
  useEffect(()=>{setNotesOpen(false);setConfirmUnlog(false);setSheetOpen(false);setGuideOpen(false);},[viewKey]);
  const navDay=delta=>{setDirection(Math.sign(delta));setDayOff(o=>o+delta);};
  const swipe=useSwipe(()=>navDay(1),()=>navDay(-1));
  const sessions=getSessions(e), match=e.match, guidance=coachingFor(e);
  const go=dk=>{setDirection(dk>viewKey?1:-1);setDayOff(daysUntil(dk));};
  const dayLabel=new Date(viewKey+"T12:00:00").toLocaleDateString("de-CH",{weekday:"long",day:"numeric",month:"long"});
  return <div className="view" {...swipe}>
    <div className="day-head"><span>{dayLabel}{Number.isInteger(e.steps)&&<> · {e.steps.toLocaleString("de-CH")} Schritte</>}</span>
      {dayOff!==0&&<button className="text-btn" onClick={()=>{setDirection(dayOff>0?-1:1);setDayOff(0);}}>Zu heute</button>}</div>
    <div className="day-nav">
      <button className="week-step" aria-label="Vorherige Woche" onClick={()=>navDay(-7)}>‹</button>
      <div className="day-strip" aria-label="Tag auswählen">
        {weekAround(viewKey).map((dk,i)=><button key={dk} className={"day-chip"+(isMatchDay(plan[dk])?" match-day":"")} aria-pressed={dk===viewKey}
          aria-label={shortDate(dk)+(plan[dk]?.match?" · "+entryDescription(plan[dk]):"")+(calendarDone(plan[dk])?" · erledigt":"")} onClick={()=>go(dk)}>
          <small>{DN[i]}</small><strong>{Number(dk.slice(-2))}</strong>
          <span className="day-marker">{calendarDone(plan[dk])?"✓":isMatchDay(plan[dk])?<Icon name="Match" size={13}/>:getSessions(plan[dk]).length?"·":" "}</span>
        </button>)}
      </div>
      <button className="week-step" aria-label="Nächste Woche" onClick={()=>navDay(7)}>›</button>
    </div>
    {dayOff===0&&[1,2].includes(new Date().getDay())&&!readReport(lastCompletedWeek())?.read&&
      <button className="panel report-banner" onClick={()=>onOpenReport(lastCompletedWeek())}><Icon name="note" size={20}/>
        <span><strong>Dein Wochenreport ist da</strong><small>{weekLabel(lastCompletedWeek())}</small></span><Icon name="arrow" size={18}/></button>}
    <DayRings plan={plan} viewKey={viewKey} target={proteinTarget} onOpenPlan={onOpenPlan}>
      {dayOff===0&&activeComplaints(complaints,viewKey).length>0&&<ComplaintStrip complaints={complaints} onReport={onReportComplaint} onResolve={onResolveComplaint}/>}
    </DayRings>
    {socialProps&&<SocialCard {...socialProps} viewKey={viewKey}/>}
    <section key={"session-"+viewKey} id="today-session" className={"panel session-card"+(isMatchDay(e)?" match-card":"")} aria-label="Training"
      style={{animation:direction>0?"slideLeft .22s ease-out":"slideRight .22s ease-out"}}>
      <div className="session-top"><span className="eyebrow">{e.completed?"Training erledigt":sessions.length?"Dein Training":"Zeit zum Auftanken"}</span>
        <div className="session-art">{sessions.length?sessions.map(s=><Icon key={s} name={s} size={24}/>):<Icon name="rest" size={24}/>}</div></div>
      {match&&<div className="fixture-detail" aria-label="Spieltermin">
        <div className="fixture-meta"><span className="match-badge">{match.home?'Heimspiel':'Auswärtsspiel'}</span><strong>{match.kickoff} Uhr</strong></div>
        <h3>Gegen {match.opponent}</h3><p>FC Julius Bär · {shortDate(match.date)} · Zeit in der Schweiz</p>
        {e.completed&&!sessions.includes('Match')&&<p>Spieltermin laut Spielplan. Dein bereits abgeschlossenes Training bleibt unverändert.</p>}
      </div>}
      <div className="session-main">
        <h2>{sessions.length?sessions.map((s,i)=><span key={s}>{i>0&&<><br/><span style={{fontWeight:300,color:C.muted}}>+{"\u00A0"}</span></>}{titleBreaks(displayName(s))}</span>):"Ruhetag"}</h2>
        {sessions.length>0&&<button className={"log-circle"+(e.completed?" logged":"")}
          aria-label={e.completed?"Eintrag rückgängig machen":"Training als erledigt eintragen"}
          onClick={()=>e.completed?setConfirmUnlog(true):updDay(viewKey,{completed:true})}>
          {e.completed?<Chk size={26} color={C.ink}/>:<span>FERTIG</span>}
        </button>}
      </div>
      <p className="session-subtitle">{sessionSubtitle(e)}</p>
      {Array.isArray(e.garmin)&&e.garmin.length>0&&<ul className="watch-list" aria-label="Von Garmin">{e.garmin.map(g=><li key={g.id}>
        <Icon name="watch" size={16}/><span>{garminLabel(g)}{g.minutes!=null?` · ${g.minutes} min`:""}{g.avgHr?` · Ø ${g.avgHr} bpm`:""}
          {garminSessionType(g.type)==="soccer"&&garminStats(g)&&<em className="watch-stats">{garminStats(g).split(" · ").map((part,i)=><Fragment key={i}>{i?" · ":""}<i>{part}</i></Fragment>)}</em>}</span>
        {!g.matched&&<small>nicht im Plan</small>}</li>)}</ul>}
      {guidance&&<aside className={"plan-guidance"+(guideOpen?" open":"")} aria-label="Planhinweis">{guidanceTitle(e)&&<strong>{guidanceTitle(e)}</strong>}<p>{guidance.text}</p>
        {guidance.text.length>110&&<button className="text-btn more-btn" aria-expanded={guideOpen} onClick={()=>setGuideOpen(o=>!o)}>{guideOpen?"Weniger":"Mehr lesen"}</button>}</aside>}
      <div className="session-actions">
        <div><button className="text-btn" onClick={()=>setSheetOpen(true)}><Icon name="edit" size={16}/> Ändern</button>
          <button className="text-btn" onClick={()=>setNotesOpen(o=>!o)} aria-expanded={notesOpen}><Icon name="note" size={16}/> {e.notes?"Notiz":<span>Notiz<span className="wide-only"> hinzufügen</span></span>}</button>
          {dayOff===0&&<button className="text-btn" onClick={()=>setComplaintOpen(true)}><Icon name="alert" size={16}/> Beschwerde</button>}</div>
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
    {dayOff===0&&<LoadCard plan={plan} dk={viewKey} complaints={complaints}/>}
    <NutritionCard key={"nutrition-"+viewKey} entry={e} dateKey={viewKey} updDay={updDay} target={proteinTarget} {...meals}
      onPlanSocial={dayOff>=0&&socialProps&&!socialMatches(socialProps.social.matches).some(m=>m.date===viewKey)?()=>socialProps.onPlan(dayOff>0?viewKey:undefined):null}/>
    <UpNextCard plan={plan} from={viewKey} onSelect={go}/>
    {sheetOpen&&<WorkoutSheet dateKey={viewKey} entry={e} updDay={updDay} onClose={()=>setSheetOpen(false)}
      onReportComplaint={dayOff===0?()=>setComplaintOpen(true):null}/>}
    {complaintOpen&&<ComplaintSheet onReport={onReportComplaint} onClose={()=>setComplaintOpen(false)}/>}
  </div>;
}

// ─── Week view ───────────────────────────────────────────────────────────────────
function WeekView({today,plan,wkOff,setWkOff,onGoToDay,updDay,onSwapDays,planner}) {
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
      {days.map((dk,i)=>{const e=plan[dk]||{};return <div className={"week-row"+(isMatchDay(e)?" match-row":"")+(dk===today?" today":"")} key={dk}
        style={{borderColor:swapFrom===dk||flashed.includes(dk)?C.accent:undefined}}>
        <button className="week-open" disabled={!!swapFrom&&!!e.match} onClick={()=>pick(dk)} aria-label={shortDate(dk)+" · "+entryDescription(e)+(calendarDone(e)?" · erledigt":"")}>
          <span className={"date-tile"+(dk===today?" current":"")}><small>{dk===today?"Heute":DN[i]}</small><strong>{Number(dk.slice(-2))}</strong></span>
          <span className="week-info">
            {isMatchDay(e)&&<span className="match-badge">{e.match?(e.match.home?"Heimspiel":"Auswärtsspiel"):"Spieltag"}{e.match?" · "+e.match.kickoff+" Uhr":""}</span>}
            <strong>{e.match?"Gegen "+e.match.opponent:sessionsLabel(e)||"Ruhetag"}</strong>
            {e.match&&getSessions(e).some(s=>s!=="Match")&&<span className="fixture-existing">{sessionsLabel(e)}</span>}
            {guidanceTitle(e)&&<span className="week-plan-focus">{guidanceTitle(e)}</span>}
            <small><SessionMarks entry={e}/>{calendarStatus(e)}</small></span>
          {calendarDone(e)&&<span style={{color:C.accent}}><Chk size={16} color={C.accent}/></span>}
        </button>
        <button className="icon-btn week-edit" aria-label={"Training ändern oder tauschen: "+shortDate(dk)} onClick={()=>{setSwapFrom(null);setSheetDk(dk);}}><Icon name="edit" size={17}/></button>
      </div>;})}
    </div>
    {planner&&wkOff>=0&&wkOff<=1&&<PlanProposal plan={plan} weekStart={days[0]} {...planner}/>}
    <WeeklyTargets plan={plan} date={days[0]}/>
    <WeeklyLoad plan={plan} dk={days[6]<today?days[6]:today}/>
    <section aria-label="Taktischer Fokus"><div className="section-heading"><h2>Taktik</h2><small>Fokus der Woche</small></div>
      <TacticalCard dk={days[0]}/></section>
    {sheetDk&&<WorkoutSheet dateKey={sheetDk} entry={plan[sheetDk]||{}} updDay={updDay} onClose={()=>setSheetDk(null)}
      onSwap={plan[sheetDk]?.match?null:()=>{setSwapFrom(sheetDk);setSheetDk(null);}}/>}
  </div>;
}

// Six weekly bars with his normal range as one continuous band behind them.
function WeeklyLoad({plan,dk}) {
  const weeks=weeklyLoads(plan,dk,6),status=loadStatus(plan,dk);
  if(!weeks.some(w=>w.load>0))return null;
  const max=Math.max(...weeks.map(w=>w.load),status.ready?status.high:0,1)*1.08;
  const pct=v=>Math.min(100,v/max*100)+"%";
  const date=from=>new Date(from+"T12:00:00").toLocaleDateString("de-CH",{day:"numeric",month:"numeric"});
  return <section aria-label="Belastung der letzten sechs Wochen">
    <div className="section-heading"><h2>Belastung</h2><small>letzte 6 Wochen</small></div>
    <div className="panel load-weeks">
      <div className="load-plot">
        {status.ready&&<span className="load-band" aria-hidden="true" style={{bottom:pct(status.low),height:`calc(${pct(status.high)} - ${pct(status.low)})`}}/>}
        {weeks.map((w,i)=><div key={w.from} className="load-col" role="img" aria-label={`Woche ab ${shortDate(w.from)}: Belastung ${w.load}`}>
          <span className={"load-fill"+(i===weeks.length-1?" current":"")} style={{height:w.load?`max(4px, ${pct(w.load)})`:0}}/></div>)}
      </div>
      <div className="load-labels" aria-hidden="true">{weeks.map(w=><div key={w.from}><b>{w.load}</b><small>{date(w.from)}</small></div>)}</div>
      {status.ready&&<p className="chart-caption"><span className="band-key" aria-hidden="true"/>Dein Bereich {status.low}–{status.high} pro Woche · hell: diese Woche</p>}
    </div>
  </section>;
}

// ─── Plan view: week / month toggle ──────────────────────────────────────────────
function PlanView({mode,setMode,...props}) {
  return <>
    <div className="plan-switch"><div className="segmented" role="group" aria-label="Ansicht">
      {[["week","Woche"],["month","Monat"]].map(([key,label])=><button key={key} aria-pressed={mode===key} onClick={()=>setMode(key)}>{label}</button>)}
    </div></div>
    {mode==="week"?<WeekView {...props}/>:<MonthView {...props}/>}
  </>;
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
            {isMatchDay(e)?<Icon name="Match" size={16} className="calendar-ball"/>:<SessionMarks entry={e} size={13}/>}
            {e.match&&<small className="calendar-kickoff">{e.match.home?"H":"A"} {e.match.kickoff}</small>}
            {calendarDone(e)&&<span className="done-dot">✓</span>}
          </button>;})}
      </div>
    </section>
    <div className="legend"><span className="match-legend"><Icon name="Match" size={14}/> Spieltag</span><span>H: Zuhause · A: Auswärts</span><span>✓ Erledigt</span><span>Hell umrandet: heute</span></div>
    {real.some(dk=>plan[dk]?.match)&&<section aria-label="Spiele in diesem Monat">
      <div className="section-heading"><h2>Deine Spiele</h2><span>FC Julius Bär</span></div>
      {real.filter(dk=>plan[dk]?.match).map(dk=>{const match=plan[dk].match;return <button className="fixture-list-item" key={dk} onClick={()=>onGoToDay(dk)}>
        <span className="fixture-list-date">{new Date(dk+"T12:00:00").toLocaleDateString("de-CH",{weekday:"short"})}<strong>{Number(dk.slice(-2))}</strong></span>
        <span><strong>{match.opponent}</strong><small>{matchVenue(match)} · {match.kickoff} Uhr</small></span><Icon name="arrow" size={17}/>
      </button>;})}
    </section>}
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

const BF_GOAL_LOW = 13;  // lower end of the target band
// 7-day mean ending at `to` (inclusive), or null when that window holds no readings.
function bodyMean(readings,to) {
  const from=daysBeforeStr(to,6),points=readings.filter(r=>r.date>=from&&r.date<=to);
  return points.length?{value:points.reduce((n,r)=>n+r.value,0)/points.length,count:points.length}:null;
}
// Headline numbers for the Körper tab. Each metric is anchored at its own latest
// reading and reports how old it is; the delta compares with the seven days before.
// Fat and lean mass need weight and body fat within the same window.
function bodySnapshot(plan,today=todayStr()) {
  const utc=s=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d);};
  const weight=bodyCompReadings(plan,'weight').filter(r=>r.date<=today&&r.value<=500);
  const bodyFat=bodyCompReadings(plan,'bodyFat').filter(r=>r.date<=today&&r.value<100);
  const metric=readings=>{const last=readings.at(-1);if(!last)return null;
    return {anchor:last.date,ageDays:Math.round((utc(today)-utc(last.date))/86400000),
      current:bodyMean(readings,last.date),previous:bodyMean(readings,daysBeforeStr(last.date,7))};};
  const anchor=[weight.at(-1)?.date,bodyFat.at(-1)?.date].filter(Boolean).sort().at(-1);
  const mass=to=>{const w=bodyMean(weight,to),f=bodyMean(bodyFat,to);
    return w&&f?{fat:w.value*f.value/100,lean:w.value*(1-f.value/100)}:null;};
  return {weight:metric(weight),bodyFat:metric(bodyFat),
    mass:anchor?{anchor,current:mass(anchor),previous:mass(daysBeforeStr(anchor,7))}:null};
}

// ─── Weekly report facts ─────────────────────────────────────────────────────────
// Numbers for one completed week (Mon–Sun), computed in the app so they are exact;
// the coach only writes the assessment around them.
function lastCompletedWeek(today=todayStr()) { return daysBeforeStr(weekAround(today)[0],7); }
function weeklyReportFacts(plan,weekStart,target=DEFAULT_PROTEIN_TARGET,complaints=[],social=null) {
  const days=Array.from({length:7},(_,i)=>daysBeforeStr(weekStart,-i)),weekEnd=days[6],prevDays=days.map(d=>daysBeforeStr(d,7));
  const types=dk=>[...new Set(getSessions(plan[dk]))],logged=dk=>plan[dk]?.completed===true&&types(dk).length>0;
  const sessions={};
  days.filter(logged).forEach(dk=>types(dk).forEach(t=>{const l=displayName(t);sessions[l]=(sessions[l]||0)+1;}));
  const phase=phaseForDate(weekStart),goals=isHoliday(weekStart)?{rows:[]}:weekTargetProgress(plan,days,phase?.name);
  const acts=days.flatMap(dk=>plan[dk]?.garmin||[]),football=acts.filter(g=>garminSessionType(g.type)==='soccer');
  const total=(arr,k)=>arr.reduce((n,x)=>n+(Number.isFinite(x[k])?x[k]:0),0);
  const speeds=football.map(g=>g.maxSpeedKmh).filter(Number.isFinite);
  const load=loadStatus(plan,weekEnd);
  const metric=field=>{
    const r=bodyCompReadings(plan,field).filter(x=>x.date<=weekEnd&&(field==='weight'?x.value<=500:x.value<100));
    const now=bodyMean(r,weekEnd),prev=bodyMean(r,daysBeforeStr(weekEnd,7));
    return now?{value:Math.round(now.value*10)/10,readings:now.count,deltaVsPrevWeek:prev?Math.round((now.value-prev.value)*10)/10:null}:null;
  };
  const nut=nutritionSummary(plan,days,target);
  const rec=days.map(dk=>plan[dk]?.recovery).filter(Boolean),prevRec=prevDays.map(dk=>plan[dk]?.recovery).filter(Boolean);
  const avg=(arr,k)=>{const v=arr.map(x=>x[k]).filter(Number.isFinite);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null;};
  const levels=days.map(dk=>recoveryStatus(plan,dk)?.level).filter(Boolean);
  const steps=days.map(dk=>plan[dk]?.steps).filter(Number.isInteger);
  return {from:weekStart,to:weekEnd,
    training:{plannedDays:days.filter(dk=>types(dk).length).length,loggedDays:days.filter(logged).length,sessions,
      goals:goals.rows.map(r=>({type:displayName(r.type),done:r.done,goal:r.goal})),
      games:days.filter(dk=>plan[dk]?.match).map(dk=>({date:dk,opponent:plan[dk].match.opponent,venue:matchVenue(plan[dk].match),played:logged(dk)&&types(dk).includes('Match')})),
      watch:{activities:acts.length,minutes:Math.round(total(acts,'minutes')),footballKm:football.length?Math.round(total(football,'distanceKm')*10)/10:null,topSpeedKmh:speeds.length?Math.max(...speeds):null}},
    load:{week:Math.round(days.reduce((n,dk)=>n+dayLoad(plan[dk]),0)),...(load.ready?{range:[load.low,load.high],status:load.status}:{})},
    body:{bodyFat:metric('bodyFat'),weight:metric('weight')},
    nutrition:{proteinTarget:target,proteinHitDays:nut.hits,proteinDays:nut.proteinDays,avgProtein:nut.avgProtein,ratings:nut.counts,avgKcal:nut.avgKcal,kcalDays:nut.kcalDays},
    recovery:{nights:rec.length,avgSleepMin:avg(rec,'sleepMin'),avgHrv:avg(rec,'hrv'),avgRestingHr:avg(rec,'restingHr'),prevAvgRestingHr:avg(prevRec,'restingHr'),
      cautionDays:levels.filter(l=>l==='caution').length,lowDays:levels.filter(l=>l==='low').length},
    steps:{avg:steps.length?Math.round(steps.reduce((a,b)=>a+b,0)/steps.length):null,days:steps.length},
    complaints:complaintsInRange(complaints,weekStart,weekEnd),
    social:(({form,...rest})=>rest)(socialTable(social?.matches,weekStart,weekEnd))};
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

// ─── Körper view ─────────────────────────────────────────────────────────────────
// Body fat (7-day mean) is the hero; weight, fat and lean mass support it. Smart-scale
// readings are estimates, so single readings never drive the headline.
const BODY_RANGES=[["4w","4 Wochen",27],["3m","3 Monate",89],["season","Saison",null]];
const fmt1=v=>v.toFixed(1);
const validBody=v=>typeof v==="number"&&Number.isFinite(v)&&v>0;
function deltaText(cur,prev,unit) {
  if(!cur||!prev)return "Noch kein Vergleich zur Vorwoche";
  const d=cur.value-prev.value;
  return Math.abs(d)<0.05?"Unverändert ggü. Vorwoche":(d<0?"↓ ":"↑ ")+fmt1(Math.abs(d))+" "+unit+" ggü. Vorwoche";
}
function GoalBar({value}) {
  const lo=10,hi=Math.max(22,Math.ceil(value)+1),pos=v=>Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100));
  const status=value>BF_GOAL?"noch "+fmt1(value-BF_GOAL)+" %-Punkte":value>=BF_GOAL_LOW?"Im Zielbereich ✓":"Unter dem Zielbereich";
  return <><div className="goal-bar" aria-hidden="true">
    <span className="goal-band" style={{left:pos(BF_GOAL_LOW)+"%",width:(pos(BF_GOAL)-pos(BF_GOAL_LOW))+"%"}}/>
    <span className="goal-marker" style={{left:pos(value)+"%"}}/></div>
    <div className="goal-legend"><span>Ziel {BF_GOAL_LOW}–{BF_GOAL} %</span><span>{status}</span></div></>;
}
function BodyTile({label,value,cur,prev}) {
  const d=cur&&prev?cur-prev:null;
  return <div className="panel body-tile"><small>{label}</small>
    <strong>{value!=null?<>{fmt1(value)}<span> kg</span></>:"–"}</strong>
    <em>{d==null?"7-Tage-Mittel":Math.abs(d)<0.05?"wie Vorwoche":(d<0?"−":"+")+fmt1(Math.abs(d))+" ggü. Vorwoche"}</em></div>;
}
// Inline editor for one dated measurement. Empty fields remove that value.
function MeasurementEditor({plan,initialDate,updDay,onClose}) {
  const today=todayStr();
  const fill=dk=>{const e=plan[dk]||{};return [validBody(e.weight)?String(e.weight):"",validBody(e.bodyFat)?String(e.bodyFat):""];};
  const [date,setDate]=useState(initialDate);
  const [w,setW]=useState(()=>fill(initialDate)[0]),[bf,setBf]=useState(()=>fill(initialDate)[1]);
  const dateOk=validCoachDate(date)&&date<=today;
  const pickDate=dk=>{setDate(dk);if(validCoachDate(dk)&&dk<=today){const [a,b]=fill(dk);setW(a);setBf(b);}};
  const parse=v=>v.trim()===""?null:Number(v.replace(",","."));
  const weight=parse(w),fat=parse(bf);
  const valid=dateOk&&(weight===null||Number.isFinite(weight)&&weight>0&&weight<=500)&&(fat===null||Number.isFinite(fat)&&fat>0&&fat<100);
  const save=()=>{if(!valid)return;updDay(date,{weight:weight==null?null:Math.round(weight*10)/10,bodyFat:fat==null?null:Math.round(fat*10)/10,bodySource:"manual"});onClose();};
  return <section className="panel body-editor" aria-label="Messung eintragen">
    <div className="eyebrow">Messung eintragen</div>
    <label className="field-label">Datum<input type="date" className="modal-input" max={today} value={date} onChange={e=>pickDate(e.target.value)}/></label>
    <div className="body-fields">
      <label>Gewicht (kg)<input className="modal-input" inputMode="decimal" autoFocus value={w} onChange={e=>setW(e.target.value)} placeholder="78,4"/></label>
      <label>Körperfett (%)<input className="modal-input" inputMode="decimal" value={bf} onChange={e=>setBf(e.target.value)} placeholder="15,8"/></label>
    </div>
    {!valid&&<p role="alert" className="helper-text">{dateOk?"Bitte gültige Werte eingeben.":"Bitte ein Datum bis heute wählen."}</p>}
    <p className="helper-text">Am besten morgens nach dem Aufstehen messen, immer unter gleichen Bedingungen. Leere Felder entfernen den Wert.</p>
    <div className="sheet-footer"><button className="primary" disabled={!valid} onClick={save}>Speichern</button><button className="secondary" onClick={onClose}>Abbrechen</button></div>
  </section>;
}
function BodyView({plan,updDay,proteinTarget,socialProps}) {
  const today=todayStr(),snap=bodySnapshot(plan,today);
  const [editor,setEditor]=useState(null),[metric,setMetric]=useState("bodyFat"),[range,setRange]=useState("3m");
  const editorRef=useRef(null);
  useEffect(()=>{if(editor)editorRef.current?.scrollIntoView({behavior:reduceMotion()?"auto":"smooth",block:"center"});},[editor]);
  const readings=bodyCompReadings(plan,metric).filter(r=>metric==="weight"?r.value<=500:r.value<100);
  const span=BODY_RANGES.find(r=>r[0]===range)[2];
  const from=span!=null?daysBeforeStr(today,span):readings[0]&&readings[0].date<SEASON_START?readings[0].date:SEASON_START;
  const series=from<=today?rollingSeries(readings,from,today):[];
  const hasLine=series.some(p=>p.value!=null);
  const recent=Object.keys(plan).filter(dk=>dk<=today&&(validBody(plan[dk]?.weight)||validBody(plan[dk]?.bodyFat))).sort().reverse().slice(0,5);
  const nut=nutritionSummary(plan,Array.from({length:7},(_,i)=>daysBeforeStr(today,6-i)),proteinTarget);
  const bf=snap.bodyFat,w=snap.weight,m=snap.mass;
  const nights=Array.from({length:7},(_,i)=>{const date=daysBeforeStr(today,6-i);return {date,r:plan[date]?.recovery||null};});
  const sleeps=nights.map(n=>n.r?.sleepMin).filter(Number.isFinite);
  const sleepAvg=sleeps.length?Math.round(sleeps.reduce((a,b)=>a+b,0)/sleeps.length):null;
  const stepDays=Array.from({length:7},(_,i)=>{const date=daysBeforeStr(today,6-i),v=plan[date]?.steps;return {date,steps:Number.isInteger(v)?v:null};});
  const stepValues=stepDays.map(d=>d.steps).filter(v=>v!=null);
  const stepAvg=stepValues.length?Math.round(stepValues.reduce((n,v)=>n+v,0)/stepValues.length):0,stepMax=Math.max(1,...stepValues);
  return <div className="view">
    <section className="panel body-hero" aria-label="Körperfett">
      <div className="eyebrow">Körperfett · 7-Tage-Mittel</div>
      {bf?<>
        <div className="hero-value">{fmt1(bf.current.value)}<span> %</span></div>
        <p className="hero-delta">{deltaText(bf.current,bf.previous,"%-Punkte")}</p>
        <GoalBar value={bf.current.value}/>
        <p className="hero-meta">{bf.current.count} {bf.current.count===1?"Messung":"Messungen"} · Stand {shortDate(bf.anchor)}{plan[bf.anchor]?.bodySource==="withings"?" · Withings":""}{bf.ageDays>7?` · seit ${bf.ageDays} Tagen keine neue Messung`:""}</p>
      </>:<p className="helper-text">Noch keine Körperfett-Messung. Trag deine Waage-Werte ein: Es zählt die Entwicklung, nicht der einzelne Tag.</p>}
      {!editor&&<button className="text-btn add-measure" onClick={()=>setEditor(today)}><Icon name="plus" size={16}/> Messung von Hand eintragen</button>}
    </section>
    {editor&&<div ref={editorRef} style={{scrollMarginTop:16}}><MeasurementEditor key={editor} plan={plan} initialDate={editor} updDay={updDay} onClose={()=>setEditor(null)}/></div>}
    {(w||bf)&&<><div className="body-tiles">
      <BodyTile label="Gewicht" value={w?.current?.value} cur={w?.current?.value} prev={w?.previous?.value}/>
      <BodyTile label="Fettmasse" value={m?.current?.fat} cur={m?.current?.fat} prev={m?.previous?.fat}/>
      <BodyTile label="Magermasse" value={m?.current?.lean} cur={m?.current?.lean} prev={m?.previous?.lean}/>
    </div>
    <p className="chart-caption" style={{marginTop:0}}>Fett- und Magermasse = Gewicht × Körperfett der Waage. Schätzwerte, die Richtung zählt.</p>
    <section className="panel trend-panel" aria-label="Verlauf" style={{marginTop:14}}>
      <div className="trend-head"><div className="metric-switch">{[["bodyFat","Körperfett"],["weight","Gewicht"]].map(([key,label])=>
        <button key={key} aria-pressed={metric===key} onClick={()=>setMetric(key)}>{label}</button>)}</div></div>
      <div className="range-switch" role="group" aria-label="Zeitraum" style={{marginBottom:14}}>{BODY_RANGES.map(([key,label])=>
        <button key={key} aria-pressed={range===key} onClick={()=>setRange(key)}>{label}</button>)}</div>
      {hasLine?<><TrendChart readings={readings} series={series} target={metric==="bodyFat"?BF_GOAL:null}/>
        <p className="chart-caption">Linie: 7-Tage-Mittel · Punkte: einzelne Messungen</p></>
        :<p className="helper-text">Keine Messungen in diesem Zeitraum.</p>}
    </section></>}
    <section aria-label="Ernährung der letzten sieben Tage">
      <div className="section-heading"><h2>Ernährung</h2><span>letzte 7 Tage</span></div>
      <div className="panel nutri-week">
        <div className="nutri-days">{nut.days.map(d=>{const l=nutritionLevel(d.nutrition),day=new Date(d.date+"T12:00:00");
          return <div key={d.date} className="nutri-day" role="img"
            aria-label={shortDate(d.date)+": "+(d.protein!=null?d.protein+" g Protein":"Protein nicht erfasst")+", "+(l?l.label:"nicht bewertet")}>
            <small>{DN[dow0(day)]}</small><span className={"ampel-dot "+(l?l.key:"none")}>{l?l.mark:""}</span>
            <b className={d.hit?"hit":""}>{d.protein??"–"}</b></div>;})}</div>
        <div className="nutri-stats">
          <div><strong>{nut.hits}/7</strong><span>Tage mit ≥ {nut.target} g Protein</span></div>
          <div><strong>{nut.avgProtein!=null?nut.avgProtein+" g":"–"}</strong><span>Ø an {nut.proteinDays} erfassten Tagen</span></div>
          <div><strong className="ampel-counts" aria-label={`${nut.counts.green} grün, ${nut.counts.amber} gelb, ${nut.counts.red} rot`}>
            {["green","amber","red"].map(k=><span key={k} style={{display:"inline-flex",alignItems:"center",gap:3}}>
              <span className={"ampel-dot "+k} style={{width:10,height:10}} aria-hidden="true"/>{nut.counts[k]}</span>)}</strong>
            <span>Bewertete Tage nach Ampel</span></div>
        </div>
        {nut.kcalDays>0&&<p className="chart-caption">Ø {nut.avgKcal.toLocaleString("de-CH")} kcal an {nut.kcalDays} {nut.kcalDays===1?"Tag":"Tagen"} mit erfassten Mahlzeiten · Schätzung, zählt nur Erfasstes</p>}
      </div>
    </section>
    {socialProps&&<SocialSection {...socialProps}/>}
    {stepDays.some(d=>d.steps!=null)&&<section aria-label="Schritte der letzten sieben Tage">
      <div className="section-heading"><h2>Schritte</h2><span>Ø {stepAvg.toLocaleString("de-CH")} · letzte 7 Tage</span></div>
      <div className="panel steps-week">{stepDays.map(d=><div key={d.date} className="steps-day" role="img"
        aria-label={shortDate(d.date)+": "+(d.steps!=null?d.steps+" Schritte":"keine Daten")}>
        <span className="steps-bar"><span style={{height:(d.steps!=null?Math.max(4,d.steps/stepMax*100):0)+"%"}}/></span>
        <b>{d.steps!=null?(d.steps>=1000?Math.round(d.steps/100)/10+"k":d.steps):"–"}</b><small>{DN[dow0(new Date(d.date+"T12:00:00"))]}</small></div>)}</div>
    </section>}
    {nights.some(n=>n.r)&&<section aria-label="Schlaf und Erholung der letzten sieben Tage">
      <div className="section-heading"><h2>Schlaf & Erholung</h2><span>{sleepAvg!=null?`Ø ${fmtHM(sleepAvg)} Schlaf`:"letzte 7 Tage"}</span></div>
      <div className="panel steps-week sleep-week"><div className="steps-day sleep-labels" aria-hidden="true">
          <span className="steps-bar"/><b>Schlaf</b><small className="night-metric">HRV</small><small className="night-metric">Puls</small><small>&nbsp;</small></div>
        {nights.map(n=>{const st=n.r?recoveryStatus(plan,n.date):null;
        return <div key={n.date} className="steps-day" role="img" aria-label={shortDate(n.date)+": "+(st?st.signals.map(x=>x.text).join(", "):"keine Daten")}>
          <span className="steps-bar"><span className={"sleep-fill "+(st?.level||"")} style={{height:(n.r?.sleepMin?Math.max(6,Math.min(100,n.r.sleepMin/540*100)):0)+"%"}}/></span>
          <b>{n.r?.sleepMin?fmtHM(n.r.sleepMin).replace(" h",""):"–"}</b>
          <small className="night-metric">{n.r?.hrv!=null?n.r.hrv:"–"}</small><small className="night-metric">{n.r?.restingHr!=null?n.r.restingHr:"–"}</small>
          <small>{DN[dow0(new Date(n.date+"T12:00:00"))]}</small></div>;})}</div>
      <p className="chart-caption">Balken: Schlafdauer · Farbe: Erholung des Tages (grün gut, gelb eingeschränkt, rot niedrig) · HRV in ms</p>
    </section>}
    {recent.length>0&&<section aria-label="Letzte Messungen">
      <div className="section-heading"><h2>Messungen</h2><span>Antippen zum Bearbeiten</span></div>
      <div className="panel measure-list">{recent.map(dk=>{const e=plan[dk];
        return <button key={dk} className="measure-row" onClick={()=>setEditor(dk)} aria-label={"Messung vom "+shortDate(dk)+" bearbeiten"}>
          <span>{shortDate(dk)}</span><span>{validBody(e.weight)?fmt1(e.weight)+" kg":"–"}</span>
          <span>{validBody(e.bodyFat)?fmt1(e.bodyFat)+" %":"–"}</span><Icon name="edit" size={15}/></button>;})}</div>
    </section>}
  </div>;
}

// ─── Saison view ─────────────────────────────────────────────────────────────────
function JourneyView({plan,today,onGoToDay,onOpenSettings,onOpenReport}) {
  const [showPast,setShowPast]=useState(false);
  const entries=Object.values(plan), planned=entries.filter(e=>getSessions(e).length).length;
  const done=entries.filter(e=>e.completed&&getSessions(e).length).length;
  const current=phaseForDate(today), idx=PHASES.indexOf(current), next=PHASES[idx+1];
  return <div className="view">
    <section className="panel journey-summary"><div className="eyebrow">Saison 2026 / 27</div>
      <div><strong>{done}</strong><span>Trainingstage erledigt<br/>von {planned} geplant</span></div>
      <progress aria-label="Saisonfortschritt" max={Math.max(planned,1)} value={done}/>
      <p>{current?(next?daysUntil(next.start)+" Tage bis "+phaseLabel(next.name):daysUntil(current.end)+" Tage bis Saisonende"):today<SEASON_START?"Deine Saison startet am "+shortDate(SEASON_START):"Saison abgeschlossen."}</p>
    </section>
    <div className="section-heading"><h2>Wochenreports</h2><span>Montags neu</span></div>
    <div className="panel measure-list">{Array.from({length:6},(_,i)=>daysBeforeStr(lastCompletedWeek(today),7*i)).map((w,i)=>{const stored=readReport(w);
      return <button key={w} className="measure-row report-row" onClick={()=>onOpenReport(w)}><span>{weekLabel(w)}</span>
        <span>{stored?.text?"Gelesen":i===0?"Neu":""}</span><span/><Icon name="arrow" size={15}/></button>;})}</div>
    <div className="section-heading"><h2>Deine Saisonphasen</h2><span>Der lange Blick</span></div>
    {PHASES.some(p=>p.end<today)&&<button className="text-btn past-toggle" aria-expanded={showPast} onClick={()=>setShowPast(v=>!v)}>
      {showPast?"Frühere Phasen ausblenden":`Frühere Phasen anzeigen (${PHASES.filter(p=>p.end<today).length})`}</button>}
    <div className="phase-timeline">{PHASES.map((p,i)=>{
      if(p.end<today&&!showPast)return null;
      const days=Object.entries(plan).filter(([dk])=>dk>=p.start&&dk<=p.end);
      const total=days.filter(([,e])=>getSessions(e).length).length, count=days.filter(([,e])=>e.completed&&getSessions(e).length).length;
      return <button key={p.name} className={"phase-item"+(p===current?" current":"")} onClick={()=>onGoToDay(p.start)}>
        <div className="eyebrow">Phase {i+1}{p===current?" · Aktuell":""}</div><h3>{phaseLabel(p.name)}</h3>
        <small>{shortDate(p.start)} {p.start.slice(0,4)} — {shortDate(p.end)} {p.end.slice(0,4)}</small>
        <p>{p.description}</p><div className="phase-count"><span>{total?`${count} / ${total} Trainingstage`:p.start>today?"Noch nicht geplant":""}</span><Icon name="arrow" size={18}/></div>
      </button>;
    })}</div>
    <button className="panel settings-link" onClick={onOpenSettings}><Icon name="settings" size={22}/>
      <span>Einstellungen<small>Profil, Verbindungen, Erinnerungen, Datensicherung</small></span><Icon name="arrow" size={18}/></button>
  </div>;
}

// ─── Coach screen (full-screen chat) ─────────────────────────────────────────────
function CoachScreen({viewKey,plan,playerName,proteinTarget,complaints,social,onBack}) {
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [sending,setSending]=useState(false);
  const [coachError,setCoachError]=useState(false);
  const coachKey=`coach-${viewKey}`;
  const requestRef=useRef(null);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
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
      const resp=await fetch("/api/coach",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",...authHeaders()},
        body:JSON.stringify({...buildCoachContext(plan,playerName,viewKey,todayStr(),proteinTarget,complaints,social),messages:base.slice(-20)})});
      if (resp.status===401) throw Object.assign(new Error("access"),{auth:true});
      if (!resp.ok||!resp.body) throw new Error("bad response");
      const reader=resp.body.getReader(), decoder=new TextDecoder();
      let acc="";
      for (;;) { const {done,value}=await reader.read(); if (done) break; acc+=decoder.decode(value,{stream:true}); setMessages([...base,{role:"assistant",content:acc}]); }
      if (!acc.trim()) throw new Error("empty response");
      const final=[...base,{role:"assistant",content:acc}];
      setMessages(final); persistCoach(final);
    } catch(error) { if(error.name!=="AbortError"){setCoachError(error.auth?"auth":true);setMessages(base);} }
    finally { setSending(false); }
  };
  // Suggestions: a short label on the chip, the full question goes to the coach.
  const viewedDateLabel=new Date(viewKey+'T12:00:00').toLocaleDateString('de-CH',{day:'numeric',month:'long',year:'numeric'});
  const isToday=viewKey===todayStr(),weekday=new Date(viewKey+'T12:00:00').toLocaleDateString('de-CH',{weekday:'long'});
  const hasSession=getSessions(e).length>0;
  const suggestions=[
    {label:"Tagesbriefing",text:"Tagesbriefing für heute, bitte.",main:true},
    {label:hasSession?(isToday?"Worauf heute achten?":`Worauf am ${weekday} achten?`):(isToday?"Wie nutze ich den Ruhetag?":`Ruhetag am ${weekday} nutzen?`),
      text:hasSession?`Worauf sollte ich bei der Einheit am ${viewedDateLabel} achten?`:`Wie nutze ich den Ruhetag am ${viewedDateLabel} am besten?`},
    {label:"Wie läuft meine Woche?",text:"Wie läuft meine Woche bisher, und was muss ich bis Sonntag noch schaffen?"},
  ];
  const ask=text=>sendToCoach([...messages,{role:"user",content:text}]);
  const sendCoach=()=>{ const text=input.trim(); if (!text||sending) return; setInput(""); ask(text); };
  const retryCoach=()=>{ if (!sending&&messages.length) sendToCoach(messages); };
  const newCoachChat=()=>{ setMessages([]); setInput(""); setCoachError(false); try { localStorage.removeItem(coachKey); } catch {} };
  const bodyRef=useRef(null);
  useEffect(()=>{const b=bodyRef.current;if(b)b.scrollTop=b.scrollHeight;},[messages,coachError]);

  return <div className="coach-screen">
    <header className="coach-head">
      <button className="icon-btn" onClick={onBack} aria-label="Zurück"><Icon name="back"/></button>
      <div className="coach-title"><strong>Dein Trainer</strong><small>Kennt Training, Uhr, Waage und Essen</small></div>
      {messages.length>0?<button className="text-btn" disabled={sending} onClick={newCoachChat}>Neu</button>:<span className="coach-head-spacer"/>}
    </header>
    <div className="coach-body" ref={bodyRef} aria-live="polite">
      {messages.length===0&&!coachError&&<div className="coach-intro">
        <Icon name="coach" size={26}/>
        <p>Frag nach heute, deiner Woche, Belastung, Essen oder einer Beschwerde. Kurze Antworten, klare Ansagen.</p>
        {!isToday&&<small>Geöffneter Tag: {shortDate(viewKey)}. Das Tagesbriefing bezieht sich auf heute.</small>}
      </div>}
      {messages.map((m,i)=><div key={i} className={"msg "+(m.role==="assistant"?"assistant":"user")}>
        {m.content||<span className="typing" aria-label="Der Trainer schreibt"><span/><span/><span/></span>}</div>)}
      {coachError&&<div className="coach-error" role="alert">
        <p>{coachError==="auth"?"Der Zugangscode fehlt oder stimmt nicht. Trag ihn in den Einstellungen ein (Zahnrad oben rechts).":"Der Trainer ist gerade nicht erreichbar. Prüf deine Verbindung und versuch es erneut."}</p>
        {messages.length>0&&<button className="secondary" onClick={retryCoach}>Erneut versuchen</button>}
      </div>}
    </div>
    {messages.length===0&&<div className="coach-suggestions" role="group" aria-label="Vorschläge">{suggestions.map(x=>
      <button key={x.label} className={"chip"+(x.main?" main":"")} disabled={sending} onClick={()=>ask(x.text)}>{x.label}</button>)}</div>}
    <div className="coach-input">
      <input type="text" value={input} onChange={ev=>setInput(ev.target.value)}
        onKeyDown={ev=>{ if (ev.key==="Enter"){ ev.preventDefault(); sendCoach(); } }}
        aria-label="Nachricht an deinen Trainer" placeholder="Frag deinen Trainer …" maxLength={4000} disabled={sending}/>
      <button className="coach-send" onClick={sendCoach} disabled={sending||!input.trim()} aria-label="Senden"><Icon name="send" size={20}/></button>
    </div>
  </div>;
}



// ─── Weekly plan proposal card ───────────────────────────────────────────────────
const proposalKey=weekStart=>`coach-plan-${weekStart}`;
function readProposal(weekStart) { try { return JSON.parse(localStorage.getItem(proposalKey(weekStart))||"null"); } catch { return null; } }
function writeProposal(weekStart,data) { try { data?localStorage.setItem(proposalKey(weekStart),JSON.stringify(data)):localStorage.removeItem(proposalKey(weekStart)); } catch {} }
const PLAN_ERRORS={access_denied:"Der Zugangscode stimmt nicht.",access_code_not_configured:"In Vercel fehlt noch APP_ACCESS_CODE.",
  model_not_configured:"Auf dem Server fehlt der Anthropic-Schlüssel.",plan_busy:"Gerade viele Anfragen. Gleich erneut versuchen.",
  plan_refused:"Für diese Woche gibt es keinen Vorschlag.",invalid_week:"Diese Woche kann nicht geplant werden."};
function PlanProposal({plan,weekStart,playerName,proteinTarget,complaints,social,onApply,onUndo}) {
  const [record,setRecord]=useState(()=>readProposal(weekStart)),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setRecord(readProposal(weekStart));setError("");},[weekStart]);
  const save=r=>{writeProposal(weekStart,r);setRecord(r);};
  const today=todayStr(),weekEnd=daysBeforeStr(weekStart,-6);
  if(weekEnd<today)return null;
  const generate=async()=>{
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/plan",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},
        body:JSON.stringify({...planWeekInput(plan,weekStart,today,complaints),context:buildCoachContext(plan,playerName,today,today,proteinTarget,complaints,social)})});
      const body=await res.json().catch(()=>({}));
      if(!res.ok||!body.proposal){setError(PLAN_ERRORS[body.error]||"Der Vorschlag hat nicht geklappt. Versuch es erneut.");return;}
      save({proposal:body.proposal,createdAt:new Date().toISOString(),applied:null});
    }catch{setError("Keine Verbindung.");}
    finally{setBusy(false);}
  };
  const p=record?.proposal,applied=record?.applied;
  const changed=p?p.days.filter(d=>!d.fixed&&d.date>=today&&!plan[d.date]?.completed&&JSON.stringify(d.sessions)!==JSON.stringify(getSessions(plan[d.date]))).length:0;
  return <section aria-label="Wochenplan-Vorschlag">
    <div className="section-heading"><h2>Plan-Vorschlag</h2><small>{applied?"Übernommen · ":""}{weekLabel(weekStart)}</small></div>
    <div className="panel plan-proposal">
    {!p&&<>
      <p className="helper-text">Der Trainer plant die offenen Tage passend zu deinen Zielen, deiner Belastung und Erholung. Spiele und Mannschaftstrainings bleiben fix.</p>
      {readAccessCode()?<button className="secondary" disabled={busy} onClick={generate}>{busy?"Der Trainer plant …":"Plan vorschlagen"}</button>
        :<p className="protein-hint">Zuerst den Zugangscode in den Einstellungen speichern (Zahnrad oben rechts).</p>}
    </>}
    {p&&<>
      {p.summary&&<p className="proposal-summary">{p.summary}</p>}
      <ul className="proposal-days">{p.days.map(d=>{const now=getSessions(plan[d.date]),label=x=>x.length?x.map(displayName).join(" + "):"Ruhetag";
        const diff=!d.fixed&&JSON.stringify(d.sessions)!==JSON.stringify(applied?applied.previous?.[d.date]?.sessions??now:now);
        return <li key={d.date} className={(d.fixed?"fixed ":"")+(diff?"changed":"")}>
          <span className="proposal-date">{DN[dow0(new Date(d.date+"T12:00:00"))]} {Number(d.date.slice(-2))}.</span>
          <span className="proposal-body"><strong>{label(d.sessions)}{d.fixed&&<small> · fix</small>}</strong>
            {diff&&<small className="proposal-was">bisher: {label(applied?applied.previous?.[d.date]?.sessions??[]:now)}</small>}
            {d.title&&<small>{d.title}{d.guidance?` – ${d.guidance}`:""}</small>}</span></li>;})}</ul>
      {applied?<div className="sheet-footer"><button className="secondary" onClick={()=>{onUndo(applied.previous);save({...record,applied:null});}}>Rückgängig</button>
          <button className="text-btn" onClick={generate} disabled={busy}>{busy?"Plant …":"Neu vorschlagen"}</button></div>
        :<div className="sheet-footer"><button className="primary" onClick={()=>{const previous=onApply(p);save({...record,applied:{at:new Date().toISOString(),previous}});}}>
            Übernehmen{changed?` (${changed} ${changed===1?"Tag":"Tage"})`:""}</button>
          <button className="secondary" disabled={busy} onClick={()=>save(null)}>Verwerfen</button></div>}
    </>}
    {error&&<p role="alert" className="helper-text">{error}</p>}
  </div></section>;
}

// ─── Weekly report screen ────────────────────────────────────────────────────────
// Stored under coach-report-<weekStart> so backups (coach-*) include it.
const reportKey=weekStart=>`coach-report-${weekStart}`;
function readReport(weekStart) { try { return JSON.parse(localStorage.getItem(reportKey(weekStart))||"null"); } catch { return null; } }
function writeReport(weekStart,data) { try { localStorage.setItem(reportKey(weekStart),JSON.stringify(data)); } catch {} }
const weekLabel=from=>`${shortDate(from)} – ${shortDate(daysBeforeStr(from,-6))}`;
// Report numbers as small tiles per topic; complaints stay as text.
function factGroups(f) {
  const t=f.training,n=f.nutrition,r=f.recovery,sign=v=>v>0?`+${v}`:v<0?`−${Math.abs(v)}`:"±0",groups=[];
  const plural=(v,one,many)=>v===1?one:many;
  const training=[{value:`${t.loggedDays}/${t.plannedDays}`,label:"Trainingstage",good:t.plannedDays>0&&t.loggedDays>=t.plannedDays},
    ...t.goals.map(g=>({value:`${g.done}/${g.goal}`,label:g.type.replace(/\//g,"/\u200B"),good:g.done>=g.goal})),
    t.games.length?{value:t.games.length,label:plural(t.games.length,"Spiel","Spiele")}:null,
    t.watch.footballKm?{value:`${t.watch.footballKm} km`,label:"Fussball"}:null,
    f.load.week?{value:f.load.week,label:f.load.status?`Belastung · ${LOAD_SHORT[f.load.status]}`:"Belastung"}:null].filter(Boolean);
  groups.push({title:"Training",tiles:training});
  const body=[f.body.bodyFat&&{value:`${f.body.bodyFat.value.toFixed(1)} %`,label:`Körperfett${f.body.bodyFat.deltaVsPrevWeek!=null?` (${sign(f.body.bodyFat.deltaVsPrevWeek)})`:""}`},
    f.body.weight&&{value:`${f.body.weight.value.toFixed(1)} kg`,label:`Gewicht${f.body.weight.deltaVsPrevWeek!=null?` (${sign(f.body.weight.deltaVsPrevWeek)})`:""}`}].filter(Boolean);
  if(body.length)groups.push({title:"Körper",tiles:body});
  const rated=n.ratings.green+n.ratings.amber+n.ratings.red;
  const food=[n.proteinDays?{value:`${n.proteinHitDays}/7`,label:"Tage Protein-Ziel",good:n.proteinHitDays>=5}:null,
    n.proteinDays?{value:`${n.avgProtein} g`,label:"Ø Protein"}:null,
    rated?{value:<span className="report-ampel">{["green","amber","red"].map(k=><span key={k}><span className={"ampel-dot "+k} aria-hidden="true"/>{n.ratings[k]}</span>)}</span>,
      label:"Ampel grün · gelb · rot",aria:`${n.ratings.green} grün, ${n.ratings.amber} gelb, ${n.ratings.red} rot`}:null,
    n.avgKcal?{value:n.avgKcal.toLocaleString("de-CH"),label:`Ø kcal (${n.kcalDays} ${plural(n.kcalDays,"Tag","Tage")})`}:null].filter(Boolean);
  if(food.length)groups.push({title:"Ernährung",tiles:food});
  const limited=r.cautionDays+r.lowDays;
  const rec=[r.avgSleepMin?{value:fmtHM(r.avgSleepMin),label:"Ø Schlaf"}:null,r.avgHrv?{value:`${r.avgHrv} ms`,label:"Ø HRV"}:null,
    r.avgRestingHr?{value:r.avgRestingHr,label:`Ruhepuls${r.prevAvgRestingHr?` (${sign(r.avgRestingHr-r.prevAvgRestingHr)})`:""}`}:null,
    r.avgSleepMin||r.avgHrv?{value:limited,label:`${plural(limited,"Tag","Tage")} eingeschränkt`}:null,
    f.steps.avg?{value:f.steps.avg.toLocaleString("de-CH"),label:"Ø Schritte"}:null].filter(Boolean);
  if(rec.length)groups.push({title:"Erholung & Bewegung",tiles:rec});
  const sm=f.social;
  if(sm&&(sm.played||sm.friendlies))groups.push({title:"Social Matches",tiles:[
    sm.played?{value:`${sm.wins}-${sm.draws}-${sm.losses}`,label:"Sieg · Unent. · Niederl."}:null,
    sm.played?{value:sm.avg.toFixed(1),label:`Ø Punkte (Ziel ${SOCIAL_GOAL.toFixed(1)})`,good:sm.avg>=SOCIAL_GOAL}:null,
    sm.friendlies?{value:sm.friendlies,label:sm.friendlies===1?"Testspiel":"Testspiele"}:null].filter(Boolean)});
  if(f.complaints?.length)groups.push({title:"Beschwerden",lines:f.complaints.map(c=>`${c.area}${c.level?` · ${c.level}`:""}${c.resolved?" · wieder gut":""}`)});
  return groups;
}
function ReportScreen({plan,weekStart,playerName,proteinTarget,onBack,planner}) {
  const facts=weeklyReportFacts(plan,weekStart,proteinTarget,planner?.complaints,planner?.social),latest=weekStart===lastCompletedWeek();
  const [text,setText]=useState(()=>readReport(weekStart)?.text||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const requestRef=useRef(null);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  const generate=async()=>{
    setBusy(true);setError("");setText("");
    const controller=new AbortController();requestRef.current=controller;
    try{
      const resp=await fetch("/api/coach",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",...authHeaders()},
        body:JSON.stringify({...buildCoachContext(plan,playerName,todayStr(),todayStr(),proteinTarget,planner?.complaints,planner?.social),weeklyReport:{...facts,isLatest:latest},
          messages:[{role:"user",content:`Wochenreport für die Woche ${weekLabel(weekStart)}`}]})});
      if(resp.status===401)throw Object.assign(new Error("access"),{auth:true});
      // Only the coach's plain-text stream counts (never an HTML error page).
      if(!resp.ok||!resp.body||!(resp.headers.get("content-type")||"").startsWith("text/plain"))throw new Error("bad response");
      const reader=resp.body.getReader(),decoder=new TextDecoder();let acc="";
      for(;;){const {done,value}=await reader.read();if(done)break;acc+=decoder.decode(value,{stream:true});setText(acc);}
      if(!acc.trim())throw new Error("empty");
      writeReport(weekStart,{weekStart,facts,text:acc,createdAt:new Date().toISOString(),read:true});
    }catch(err){if(err.name!=="AbortError")setError(err.auth?"Der Zugangscode fehlt oder stimmt nicht (Einstellungen, Zahnrad oben rechts).":"Der Trainer ist gerade nicht erreichbar. Versuch es erneut.");}
    finally{setBusy(false);}
  };
  useEffect(()=>{
    const stored=readReport(weekStart);
    if(stored?.text){if(!stored.read)writeReport(weekStart,{...stored,read:true});return;}
    if(readAccessCode())generate();
  },[weekStart]);
  return <main className="app-shell report-screen">
    <header className="app-header"><PitchTexture/><div className="brand-row"><span className="brand">Wochenreport</span>
      <button className="icon-btn" aria-label="Zurück" onClick={onBack}><Icon name="close"/></button></div>
      <h1>{weekLabel(weekStart)}</h1><p className="subtitle">{playerName}{latest?" · letzte Woche":""}</p></header>
    <div className="view">
      <section className="report-groups" aria-label="Zahlen der Woche">{factGroups(facts).map(g=><div key={g.title} className="report-group">
        <div className="eyebrow">{g.title}</div>
        {g.tiles&&<div className="report-tiles">{g.tiles.map(t=><div key={t.label} className={"panel report-tile"+(t.good?" good":"")} aria-label={t.aria?`${t.label}: ${t.aria}`:undefined}>
          <strong>{t.value}</strong><small>{t.label}</small></div>)}</div>}
        {g.lines&&<div className="panel report-notes">{g.lines.map(l=><p key={l}>{l}</p>)}</div>}
      </div>)}</section>
      <section className="panel report-coach" aria-label="Einschätzung vom Trainer"><div className="eyebrow">Einschätzung vom Trainer</div>
        {text?<p className="report-text">{text}</p>:busy?<p className="helper-text">Der Trainer schreibt …</p>:null}
        {!text&&!busy&&!error&&!readAccessCode()&&<p className="helper-text">Für die Einschätzung zuerst den Zugangscode in den Einstellungen speichern (Zahnrad oben rechts).</p>}
        {error&&<p role="alert" className="helper-text">{error}</p>}
        {!busy&&readAccessCode()&&<button className="text-btn" onClick={generate}>{text?"Neu erstellen":"Einschätzung erstellen"}</button>}
      </section>
      {latest&&planner&&<div style={{marginTop:14}}><PlanProposal plan={plan} weekStart={weekAround(todayStr())[0]} playerName={playerName} proteinTarget={proteinTarget} {...planner}/></div>}
    </div>
  </main>;
}

export default function App() {
  const [loading,setLoading]=useState(true),[playerName,setPlayerName]=useState(""),[plan,setPlan]=useState({});
  const [view,setView]=useState("today"),[screen,setScreen]=useState("main"),[planMode,setPlanMode]=useState("week");
  // null = default target; only an explicitly chosen value is stored (top-level, optional).
  const [proteinSetting,setProteinSetting]=useState(null);
  const proteinTarget=proteinSetting??DEFAULT_PROTEIN_TARGET;
  const [wkOff,setWkOff]=useState(0),[moOff,setMoOff]=useState(0),[dayOff,setDayOff]=useState(0);
  const [restoredToast,setRestoredToast]=useState(false),[celebration,setCelebration]=useState(null),[storageError,setStorageError]=useState("");
  const [loadError,setLoadError]=useState(false);
  // Retired feature data is preserved verbatim for backwards-compatible backups.
  const storedExtras=useRef({});
  const planRef=useRef(plan);planRef.current=plan;
  const [garmin,setGarmin]=useState(()=>({state:readAccessCode()?"idle":"off"})),[syncToast,setSyncToast]=useState("");
  const [withings,setWithings]=useState(()=>({state:readAccessCode()?"idle":"off"}));
  const [reportWeek,setReportWeek]=useState(null),[complaints,setComplaints]=useState([]),[favorites,setFavorites]=useState([]);
  const [social,setSocial]=useState({matches:[],rules:null,holidays:[]}),[socialSheet,setSocialSheet]=useState(null);
  const openReport=week=>{setReportWeek(week||lastCompletedWeek());setScreen("report");window.scrollTo(0,0);};
  useEffect(()=>{
    (async()=>{
      try{
        const raw=localStorage.getItem(SK), previous=raw?null:localStorage.getItem(SK_PREV), stored=raw||previous;
        if(stored){
          const d=JSON.parse(stored);
          if(!d||typeof d!=="object"||!d.plan||Array.isArray(d.plan)||typeof d.plan!=="object")throw Error("invalid");
          const updated=migrateCoachedPlan(migrateMatchSchedule(d));
          const {playerName:name,plan:savedPlan,proteinTarget:storedTarget,...extras}=updated;
          storedExtras.current=extras;
          setComplaints(Array.isArray(extras.complaints)?extras.complaints:[]);
          setFavorites(favoriteList(extras.mealFavorites));
          setSocial({matches:socialMatches(extras.socialMatches),rules:extras.socialRules||null,holidays:holidayPeriods(extras.socialHolidays)});
          const target=validProteinTarget(storedTarget)?storedTarget:null;
          setPlayerName(typeof name==="string"?name:"");setPlan(savedPlan);setProteinSetting(target);setScreen(name?"main":"setup");
          if(previous||updated!==d)localStorage.setItem(SK,JSON.stringify({...extras,playerName:name||"",...(target!=null?{proteinTarget:target}:{}),plan:savedPlan}));
        }else{storedExtras.current={matchScheduleVersion:MATCH_SCHEDULE_VERSION,coachedPlanVersion:COACHED_PLAN_VERSION};setPlan(buildDefaultPlan());setScreen("setup");}
      }catch{setLoadError(true);}
      setLoading(false);
    })();
    try{if(sessionStorage.getItem("justRestored")){sessionStorage.removeItem("justRestored");setRestoredToast(true);}}catch{}
    if(new URLSearchParams(window.location.search).get("report")){
      setReportWeek(lastCompletedWeek());setScreen(s=>s==="setup"?s:"report");
      try{window.history.replaceState(null,"",window.location.pathname);}catch{}
    }
    const withingsResult=new URLSearchParams(window.location.search).get("withings");
    if(withingsResult){
      setSyncToast(withingsResult==="connected"?"Withings verbunden":withingsResult==="denied"?"Withings-Verbindung abgebrochen":"Withings-Verbindung hat nicht geklappt");
      try{window.history.replaceState(null,"",window.location.pathname);}catch{}
    }
  },[]);
  useEffect(()=>{if(!loading&&!loadError)writeReminderStatus(reminderStatus(plan,todayStr(),proteinTarget,social));},[plan,proteinTarget,social,loading,loadError]);
  const syncRef=useRef(null);
  useEffect(()=>{
    if(loading||loadError)return;
    syncRef.current?.();
    const onVisible=()=>{if(document.visibilityState==="visible")syncRef.current?.();};
    document.addEventListener("visibilitychange",onVisible);
    return ()=>document.removeEventListener("visibilitychange",onVisible);
  },[loading,loadError]);
  useEffect(()=>{
    if(!("serviceWorker" in navigator))return;
    const onMessage=ev=>{if(ev.data?.type==="open-report"){setReportWeek(lastCompletedWeek());setScreen("report");}};
    navigator.serviceWorker.addEventListener("message",onMessage);
    return ()=>navigator.serviceWorker.removeEventListener("message",onMessage);
  },[]);
  useEffect(()=>{if(!syncToast)return;const t=setTimeout(()=>setSyncToast(""),4500);return ()=>clearTimeout(t);},[syncToast]);
  useEffect(()=>{if(!restoredToast)return;const t=setTimeout(()=>setRestoredToast(false),3200);return ()=>clearTimeout(t);},[restoredToast]);
  useEffect(()=>{if(!celebration)return;const t=setTimeout(()=>setCelebration(null),5000);return ()=>clearTimeout(t);},[celebration]);
  const save=(np,nn,pt)=>{
    const target=pt===undefined?proteinSetting:pt;
    try{localStorage.setItem(SK,JSON.stringify({...storedExtras.current,playerName:nn??playerName,...(target!=null?{proteinTarget:target}:{}),plan:np??plan}));setStorageError("");}
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
  // Pulls Garmin (activities, steps) and Withings (weight, body fat) since the last sync.
  const fetchSource=async url=>{
    try{const res=await fetch(url,{headers:authHeaders()});return {res,body:await res.json().catch(()=>({}))};}
    catch{return {res:null,body:{error:"network"}};}
  };
  const syncSources=async(force=false)=>{
    if(!readAccessCode()){setGarmin({state:"off"});setWithings({state:"off"});return;}
    const now=Date.now(),today=todayStr(),extras=storedExtras.current;
    const gLast=extras.garminSync,wLast=extras.withingsSync;
    const due=last=>force||!(last?.at&&now-last.at<10*60*1000);
    const garminDue=due(gLast?.v===4?gLast:null),withingsDue=due(wLast);
    if(!garminDue&&!withingsDue)return;
    let gFrom=gLast?.through?daysBeforeStr(gLast.through,2):daysBeforeStr(today,13);
    // Version 4 added training load: load six weeks of activities once (health data: last 28 days).
    if(!gLast||gLast.v!==4)gFrom=daysBeforeStr(today,41);
    if(gFrom<daysBeforeStr(today,59))gFrom=daysBeforeStr(today,59);
    const wWindow=withingsWindow(wLast,today),wFrom=wWindow.from;
    if(garminDue)setGarmin(g=>({...g,state:"syncing"}));
    if(withingsDue)setWithings(w=>({...w,state:"syncing"}));
    const [g,w]=await Promise.all([garminDue?fetchSource(`/api/garmin?from=${gFrom}&to=${today}`):null,withingsDue?fetchSource(`/api/withings?from=${wFrom}&to=${today}`):null]);
    let next=planRef.current,changed=false;const notes=[];
    if(g){
      if(g.res?.ok&&Array.isArray(g.body.activities)&&Array.isArray(g.body.steps)){
        const r=applyGarminImport(next,g.body,today);next=r.plan;changed=true;
        storedExtras.current={...storedExtras.current,garminSync:{at:Date.now(),through:today,v:4}};
        setGarmin({state:"ok",at:Date.now()});
        if(r.completed.length)notes.push(r.completed.length>2?`${r.completed.length} Trainings von Garmin eingetragen`
          :"Von Garmin eingetragen: "+r.completed.map(dk=>sessionsLabel(next[dk])+" ("+shortDate(dk)+")").join(", "));
      }else setGarmin({state:"error",message:GARMIN_ERRORS[g.body.error]||GARMIN_ERRORS.garmin_unavailable});
    }
    if(w){
      if(w.res?.ok&&Array.isArray(w.body.days)){
        let body=w.body,full=wWindow.full;
        // Another Withings account than last time: reload the full window. If that second
        // request fails, only the short window is applied and the next sync loads everything.
        const switched=!!(wLast?.account&&body.account&&body.account!==wLast.account);
        if(switched&&!full){
          const again=await fetchSource(`/api/withings?from=${daysBeforeStr(today,WITHINGS_FULL_DAYS)}&to=${today}`);
          if(again.res?.ok&&Array.isArray(again.body.days)){body=again.body;full=true;}
        }
        const cleanFrom=switched&&full?"0000-01-01":full?daysBeforeStr(today,WITHINGS_FULL_DAYS):wFrom;
        const r=applyWithingsImport(next,body.days,today,cleanFrom);next=r.plan;changed=true;
        const account=body.account||null,fullFor=full?account:(wLast?.account===account?wLast?.fullFor||null:null);
        storedExtras.current={...storedExtras.current,withingsSync:{at:Date.now(),through:today,account,fullFor}};
        setWithings({state:"ok",at:Date.now()});
        if(switched)notes.push("Withings-Konto gewechselt: Waagen-Werte neu geladen");
        else if(r.updated.length)notes.push(`Withings: ${r.updated.length} ${r.updated.length===1?"Messung":"Messungen"} übernommen`);
      }else if(w.body.error==="withings_not_connected")setWithings({state:"disconnected"});
      else setWithings({state:"error",message:WITHINGS_ERRORS[w.body.error]||WITHINGS_ERRORS.withings_unavailable});
    }
    if(changed){setPlan(next);save(next);}
    if(notes.length)setSyncToast(notes.join(" · "));
  };
  const connectWithings=async()=>{
    setWithings(w=>({...w,state:"syncing"}));
    try{
      const res=await fetch("/api/withings",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({action:"connect"})});
      const body=await res.json().catch(()=>({}));
      if(res.ok&&typeof body.url==="string"&&body.url.startsWith("https://account.withings.com/")){window.location.href=body.url;return;}
      setWithings({state:"error",message:WITHINGS_ERRORS[body.error]||WITHINGS_ERRORS.withings_unavailable});
    }catch{setWithings({state:"error",message:WITHINGS_ERRORS.network});}
  };
  const disconnectWithings=async()=>{
    try{await fetch("/api/withings",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({action:"disconnect"})});}catch{}
    const {withingsSync,...rest}=storedExtras.current;storedExtras.current=rest;save(planRef.current);
    setWithings({state:"disconnected"});
  };
  syncRef.current=()=>{if(screen!=="setup")syncSources();};
  // Always build on the latest plan (planRef), so updates after an await never drop newer edits.
  const updDay=(dk,patch)=>{
    const cur=planRef.current,np={...cur,[dk]:{...cur[dk],...patch}};planRef.current=np;setPlan(np);save(np);
    if(patch.completed===true&&getSessions(np[dk]).length)checkMilestones(dk,np);
  };
  const updDayWith=(dk,fn)=>{const cur=planRef.current,e=cur[dk]||{},np={...cur,[dk]:{...e,...fn(e)}};planRef.current=np;setPlan(np);save(np);};
  const applyProposal=proposal=>{const {plan:np,previous}=applyWeekProposal(planRef.current,proposal,todayStr());planRef.current=np;setPlan(np);save(np);return previous;};
  const undoProposal=previous=>{const np=undoWeekProposal(planRef.current,previous);planRef.current=np;setPlan(np);save(np);};
  // Complaints live top-level in the stored blob (storedExtras), mirrored in state for rendering.
  const saveComplaints=list=>{storedExtras.current={...storedExtras.current,complaints:list};setComplaints(list);save(planRef.current);};
  const reportComplaintNow=c=>saveComplaints(reportComplaint(storedExtras.current.complaints,c,todayStr()));
  const resolveComplaintNow=id=>saveComplaints(resolveComplaint(storedExtras.current.complaints,id,todayStr()));
  // Social matches: stored top-level like complaints; every change goes through storedExtras.
  const saveSocial=patch=>{storedExtras.current={...storedExtras.current,...patch};const x=storedExtras.current;
    setSocial({matches:socialMatches(x.socialMatches),rules:x.socialRules||null,holidays:holidayPeriods(x.socialHolidays)});save(planRef.current);};
  const saveSocialMatch=(input,asDefault)=>{const r=planSocialMatch(storedExtras.current.socialMatches,input,storedExtras.current.socialHolidays);
    if(r.error)return r.error;saveSocial({socialMatches:r.list,...(asDefault?{socialRules:r.match.rules}:{})});setSocialSheet(null);
    const d=r.match.date,t=todayStr(),day=d===t?"heute":d===daysBeforeStr(t,-1)?"morgen":`${DN[dow0(new Date(d+"T12:00:00"))]} ${shortDate(d)}`;
    setSyncToast(`${r.match.friendly?"Testspiel":"Social Match"} ${day} · ${r.match.kickoff} ${input.id?"geändert":"geplant"}`);return null;};
  const socialProps={social,
    onPlan:(date,friendly)=>setSocialSheet({date,friendly}),onEdit:m=>setSocialSheet({match:m}),
    onEvaluate:(id,kept)=>saveSocial({socialMatches:evaluateSocialMatch(storedExtras.current.socialMatches,id,kept)}),
    onCancel:id=>{saveSocial({socialMatches:cancelSocialMatch(storedExtras.current.socialMatches,id)});setSocialSheet(null);},
    onAddHoliday:form=>{const r=addHoliday(storedExtras.current.socialHolidays,form||{});if(r.error)return r.error;saveSocial({socialHolidays:r.list});return null;},
    onRemoveHoliday:id=>saveSocial({socialHolidays:removeHoliday(storedExtras.current.socialHolidays,id)})};
  const planner={playerName,proteinTarget,complaints,social,onApply:applyProposal,onUndo:undoProposal};
  const saveFavorites=list=>{storedExtras.current={...storedExtras.current,mealFavorites:list};setFavorites(list);save(planRef.current);};
  const addMeal=(dk,meal)=>updDayWith(dk,e=>({meals:[...(Array.isArray(e.meals)?e.meals:[]),meal]}));
  const mealHandlers={
    favorites,
    onSaveFavorite:meal=>saveFavorites(saveFavorite(storedExtras.current.mealFavorites,meal,todayStr())),
    onRemoveFavorite:id=>saveFavorites(removeFavorite(storedExtras.current.mealFavorites,id)),
    onUseFavorite:(dk,f,id,at)=>{storedExtras.current={...storedExtras.current,mealFavorites:useFavorite(storedExtras.current.mealFavorites,f.id,todayStr())};
      setFavorites(storedExtras.current.mealFavorites);addMeal(dk,mealFromFavorite(f,at,id));},
    onAddMeal:addMeal,
    onUpdateMeal:(dk,id,patch)=>updDayWith(dk,e=>({meals:(Array.isArray(e.meals)?e.meals:[]).map(m=>m.id===id?{...m,...patch}:m)})),
    onRemoveMeal:(dk,id)=>updDayWith(dk,e=>({meals:(Array.isArray(e.meals)?e.meals:[]).filter(m=>m.id!==id)})),
  };
  // Swap only sessions. Logs, notes, body values and archived check-ins stay dated.
  const swapDays=(a,b)=>{
    if(plan[a]?.match||plan[b]?.match)return;
    const np={...plan,[a]:{...plan[a],sessions:getSessions(plan[b]),workout:"",coaching:null},[b]:{...plan[b],sessions:getSessions(plan[a]),workout:"",coaching:null}};
    setPlan(np);save(np);
  };
  const goToDay=dk=>{setDayOff(daysUntil(dk)??0);setView("today");window.scrollTo(0,0);};
  const today=todayStr(),phase=phaseForDate(today);
  const tabs=[["today","Heute","today"],["plan","Plan","plan"],["body","Körper","body"],["season","Saison","season"]];
  const headings={today:dayOff===0?"Heute zählt.":dayOff<0?"Rückblick.":"Vorschau.",plan:"Dein Plan.",body:"Dein Körper.",season:"Deine Saison."};
  let content;
  if(loading)content=<main className="app-shell"><p className="loading-state">Dein Plan wird geladen …</p></main>;
  else if(loadError)content=<main className="app-shell"><div className="view" style={{paddingTop:80}}><h1>Daten nicht lesbar.</h1>
    <p className="helper-text">Deine gespeicherten Daten wurden nicht verändert. Bitte prüfe den Browser-Zugriff oder sichere die vorhandenen Daten, bevor du eine Sicherung wiederherstellst.</p>
    <button className="secondary" onClick={()=>window.location.reload()}>Erneut versuchen</button></div></main>;
  else if(screen==="setup")content=<SetupScreen initName={playerName} initProteinTarget={proteinTarget} isEdit={!!playerName} onBack={playerName?()=>setScreen("main"):null}
    connections={{garmin,withings,scale:scaleSummary(plan),onSync:syncSources,onWithingsConnect:connectWithings,onWithingsDisconnect:disconnectWithings}}
    onSave={(n,target)=>{const pt=target===DEFAULT_PROTEIN_TARGET&&proteinSetting==null?null:target;setPlayerName(n);setProteinSetting(pt);save(plan,n,pt);setScreen("main");}}/>;
  else if(screen==="report")content=<ReportScreen plan={plan} weekStart={reportWeek||lastCompletedWeek()} playerName={playerName} proteinTarget={proteinTarget} onBack={()=>setScreen("main")} planner={planner}/>;
  else if(screen==="coach")content=<CoachScreen viewKey={view==="today"?offsetDate(dayOff):today} plan={plan} playerName={playerName} proteinTarget={proteinTarget} complaints={complaints} social={social} onBack={()=>setScreen("main")}/>;
  else content=<main className="app-shell">
    <header className="app-header"><PitchTexture/><div className="brand-row"><span className="brand">Soccer Tracker</span>
      <div className="head-actions"><button className="icon-btn head-settings" aria-label="Einstellungen" onClick={()=>{setScreen("setup");window.scrollTo(0,0);}}><Icon name="settings" size={20}/></button>
        <button className="coach-pill" aria-label="Trainer öffnen" onClick={()=>setScreen("coach")}><Icon name="coach" size={17}/><span>Trainer</span></button></div></div>
      <h1>{headings[view]}</h1>
      <p className="subtitle">{playerName} <span style={{color:C.borderSt}}> / </span> {phase?phaseLabel(phase.name):today<SEASON_START?"Deine Saison beginnt bald":"Saison abgeschlossen"}</p>
    </header>
    {view==="today"&&<TodayView plan={plan} updDay={updDay} dayOff={dayOff} setDayOff={setDayOff} proteinTarget={proteinTarget} meals={mealHandlers} onOpenReport={openReport} complaints={complaints} onReportComplaint={reportComplaintNow} onResolveComplaint={resolveComplaintNow} socialProps={socialProps}
      onOpenPlan={()=>{setWkOff(Math.floor((dow0(new Date())+dayOff)/7));setPlanMode("week");setView("plan");window.scrollTo(0,0);}}/>}
    {view==="plan"&&<PlanView mode={planMode} setMode={setPlanMode} today={today} plan={plan} wkOff={wkOff} setWkOff={setWkOff}
      moOff={moOff} setMoOff={setMoOff} onGoToDay={goToDay} updDay={updDay} onSwapDays={swapDays} planner={planner}/>}
    {view==="body"&&<BodyView plan={plan} updDay={updDay} proteinTarget={proteinTarget} socialProps={socialProps}/>}
    {view==="season"&&<JourneyView today={today} plan={plan} onGoToDay={goToDay} onOpenSettings={()=>setScreen("setup")} onOpenReport={openReport}/>}
    <nav className="nav" aria-label="Hauptnavigation">{tabs.map(([key,label,icon])=><button key={key} aria-label={label} aria-current={view===key?"page":undefined}
      onClick={()=>{setView(key);if(key==="today")setDayOff(0);window.scrollTo(0,0);}}><TabIcon name={icon}/><span>{label}</span></button>)}</nav>
  </main>;
  return <><style>{UI_CSS}</style>{content}
    {socialSheet&&<SocialSheet social={social} match={socialSheet.match} initialDate={socialSheet.date} initialFriendly={socialSheet.friendly}
      onSave={saveSocialMatch} onCancel={socialProps.onCancel} onClose={()=>setSocialSheet(null)}/>}
    {restoredToast&&<div className="toast" role="status">✓ Sicherung wiederhergestellt</div>}
    {syncToast&&!restoredToast&&!storageError&&<div className="toast" role="status">{syncToast}</div>}
    {storageError&&<div className="toast" role="alert"><p>{storageError}</p><button className="text-btn" onClick={()=>save()}>Erneut speichern</button></div>}
    {celebration&&!storageError&&<div className="toast milestone-toast" role="status"><span>{celebration.emoji}</span><div><strong>{celebration.title}</strong><p>{celebration.message}</p></div>
      <button className="icon-btn" aria-label="Hinweis schließen" onClick={()=>setCelebration(null)}><Icon name="close" size={18}/></button></div>}
  </>;
}
