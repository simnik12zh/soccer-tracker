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
function titleBreaks(label) { return String(label).replace(/(Mannschafts|Kraft)(training)/,'$1\u00AD$2'); }
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
function reminderStatus(plan,today=todayStr(),target=DEFAULT_PROTEIN_TARGET) {
  const days={};
  for(let i=-1;i<=14;i++){const dk=daysBeforeStr(today,-i);days[dk]={open:dayChecklist(plan[dk],dk,dk,target).open};}
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
function buildCoachContext(plan,playerName,viewKey,referenceDate=todayStr(),proteinTarget=DEFAULT_PROTEIN_TARGET,complaints=[]) {
  const dates=Object.keys(plan).filter(dk=>validCoachDate(dk)&&plan[dk]&&typeof plan[dk]==='object').sort();
  const types=dk=>[...new Set(getSessions(plan[dk]))];
  const logged=dk=>dk<=referenceDate&&plan[dk]?.completed===true&&types(dk).length>0;
  const target=validProteinTarget(proteinTarget)?proteinTarget:DEFAULT_PROTEIN_TARGET;
  // Self-reported eating; never sent for future dates. Missing stays null, not zero.
  const eating=dk=>{
    const e=plan[dk]||{},protein=dayProtein(e),rating=nutritionLevel(e.nutrition)?e.nutrition:null,meals=dayMeals(e);
    if(dk>referenceDate||(protein==null&&!rating&&!meals.length))return null;
    return {proteinGrams:protein,rating,...(meals.length?{kcal:dayKcal(e),
      meals:meals.slice(0,8).map(m=>({title:coachText(m.title,40),kcal:Math.round(m.kcal),proteinGrams:Math.round(m.protein)}))}:{})};
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
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101A25;color:#EDF2F5;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button{color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:disabled{cursor:default;opacity:.45}button:not(:disabled):active{transform:scale(.98)}button{transition:background .18s,border-color .18s,transform .15s}
input,textarea{min-width:0;font-size:16px!important}input::placeholder,textarea::placeholder{color:#839BAD}
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #B3DCE2!important;outline-offset:4px}
button,a,input,summary{touch-action:manipulation}h1,h2,h3,p{margin:0}h1,h2,h3{font-weight:600;letter-spacing:-.035em}
.app-shell{max-width:560px;margin:auto;min-height:100dvh;background:radial-gradient(ellipse 100% 500px at 80% 0%,#223B50 0%,#101A25 85%);padding-bottom:calc(96px + env(safe-area-inset-bottom))}
.app-header{position:relative;isolation:isolate;overflow:hidden;padding:calc(12px + env(safe-area-inset-top)) 22px 12px}
.pitch-texture{position:absolute;inset:0;width:100%;height:100%;color:#9CCBD3;opacity:.14;z-index:-1;pointer-events:none}
.brand-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}
.brand{font-size:10px;letter-spacing:.26em;color:#B3DCE2;font-weight:600}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:0;border-radius:12px;background:transparent;color:#A5B8C8}
.app-header h1{font-size:clamp(28px,7.6vw,38px);line-height:1.1;margin-bottom:4px;letter-spacing:-.05em}
.subtitle{color:#A5B8C8;font-size:13px;line-height:1.5}
.phase-link{display:inline-flex;gap:8px;align-items:center;color:#A5B8C8;background:none;border:0;padding:4px 0;min-height:44px;font-size:12px}
.view{padding:0 20px 24px}.eyebrow{font-size:10px;letter-spacing:.17em;text-transform:uppercase;color:#B3DCE2;font-weight:600}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 0 14px}.section-heading h2{font-size:20px}.section-heading small{font-size:11px;color:#A5B8C8}
.panel{background:linear-gradient(135deg,#1C2C3A,#192632);border:1px solid #2A3C4B;border-radius:22px}
.day-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;flex:1;min-width:0}
.day-chip{border:1px solid transparent;background:transparent;border-radius:14px;padding:8px 0 6px;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px}
.day-chip .day-label{font-size:10px;text-transform:uppercase;color:#A5B8C8;letter-spacing:.06em}
.day-chip strong{font-size:18px;font-weight:500}.day-chip[aria-pressed=true]{background:#9CCBD3;color:#101A25}
.day-chip[aria-pressed=true] .day-label{color:#233B47}.day-marker{height:5px;width:5px;border-radius:50%;background:#577184}.day-chip[aria-pressed=true] .day-marker{background:#274854}
.session-card{padding:20px;position:relative;overflow:hidden;scroll-margin-top:16px}.session-card h2{font-size:clamp(25px,7vw,34px);line-height:1.12;overflow-wrap:anywhere;-webkit-hyphens:manual;hyphens:manual}
.session-sub{font-size:14px;color:#A5B8C8;line-height:1.6}.session-card-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.session-art{color:#9CCBD3;opacity:.65;display:flex;gap:5px}.session-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
.action-links{display:flex;gap:8px;flex-wrap:wrap}.text-btn{display:inline-flex;gap:8px;align-items:center;min-height:44px;padding:6px 0;border:0;background:transparent;color:#A5B8C8;font-size:12px}
.log-circle{width:74px;height:74px;flex-shrink:0;border-radius:50%;border:2px solid #9CCBD3;background:transparent;color:#B3DCE2;font-size:13px;letter-spacing:.1em;font-weight:700;display:flex;align-items:center;justify-content:center}
.log-circle.logged{background:#9CCBD3;color:#101A25;animation:checkPop .3s ease-out}
.session-details{border-top:1px solid #344858;margin-top:20px;padding-top:4px}.session-details summary{font-size:12px;color:#A5B8C8;cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between}
.session-details summary:after{content:"+";font-size:18px}.session-details[open] summary:after{content:"−"}
.notes{width:100%;padding:12px;background:#101A25;color:#EDF2F5;border:1px solid #344858;border-radius:12px;margin-top:12px;line-height:1.5}
.target-panel{padding:0 18px}.target-row{display:flex;align-items:center;gap:14px;padding:18px 0}.target-row+.target-row{border-top:1px solid #344858}
.target-content{flex:1;min-width:0}.target-label{display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:11px}.target-label span:last-child{font-variant-numeric:tabular-nums;color:#B3DCE2}
.target-track{display:flex;gap:5px}.target-segment{height:9px;border:1px solid #486171;border-radius:20px;flex:1;background:#263C4D}.target-segment.filled{background:#9CCBD3;border-color:#9CCBD3}
.focus-card{padding:21px;margin:0 0 18px;position:relative}.focus-card:before{content:"";position:absolute;top:23px;bottom:23px;left:0;background:#9CCBD3;width:3px;border-radius:5px}
.focus-card h3{font-size:19px;line-height:1.3;margin:10px 0}.focus-card p{color:#A5B8C8;font-size:13px;line-height:1.65}
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
.week-controls{display:flex;flex-direction:column}.week-controls .icon-btn{min-height:36px}.date-tile.current{color:#B3DCE2}
.swap-banner{border:1px solid #648694;background:#203944;border-radius:14px;padding:12px;display:flex;align-items:center;gap:8px;font-size:12px}
.helper-text{font-size:13px;color:#A5B8C8;line-height:1.7;margin:12px 0}
.body-editor{margin-top:14px;padding:18px}.field-label{display:block;font-size:11px;color:#A5B8C8;margin-top:12px}.body-fields{display:flex;gap:12px;margin-top:12px}.body-fields label{min-width:0;flex:1;font-size:11px;color:#A5B8C8}
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
.plan-guidance{border-left:2px solid #9CCBD3;padding:2px 0 2px 12px;margin:12px 0 4px}.plan-guidance strong{display:block;font-size:13px;line-height:1.5;color:#B3DCE2}.plan-guidance p{font-size:12px;line-height:1.6;color:#A5B8C8;margin:6px 0 0}.week-plan-focus{display:block;font-size:11px;line-height:1.5;color:#B3DCE2;margin-top:5px}
.fixture-list-date{flex-shrink:0;width:32px;text-align:center;font-size:10px;color:#F0CF95}.fixture-list-date strong{display:block;font-size:22px;font-weight:500;margin-top:3px}
.fixture-list-item>span:nth-child(2){flex:1;min-width:0}.fixture-list-item>span:nth-child(2)>strong{font-size:14px;font-weight:500;overflow-wrap:anywhere;display:block;line-height:1.4}
.fixture-list-item small{display:block;font-size:12px;color:#C7BDAB;margin-top:5px}.fixture-list-item>svg{flex-shrink:0;color:#F0CF95}
@media(max-width:360px){.calendar-kickoff{font-size:8px}.week-row.match-row{padding-left:4px;padding-right:2px}.match-row .week-open{gap:8px}.fixture-detail h3{font-size:20px}}

/* Today: compact day navigation, rings, nutrition and up next. */
.coach-pill{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:1px solid #648694;border-radius:99px;background:rgba(156,203,211,.08);color:#B3DCE2;font-size:13px;font-weight:500}
.day-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;font-size:12px;color:#A5B8C8}
.day-head .text-btn{min-height:32px;padding:0;color:#B3DCE2}
.day-nav{display:flex;align-items:center;gap:2px;margin:0 0 12px}
.week-step{flex-shrink:0;width:26px;min-height:44px;border:0;background:transparent;color:#839BAD;font-size:22px;padding:0;border-radius:10px}
.rings{padding:14px 8px 12px;margin-bottom:12px}
.ring-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.ring{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;border:0;background:transparent;padding:4px 0;border-radius:16px;min-width:0}
.ring>svg{width:64px;height:64px;display:block}
.ring-track{fill:none;stroke:#2A3C4B;stroke-width:6}.ring-value{fill:none;stroke-width:6;transition:stroke-dasharray .4s ease-out}
.ring-center{position:absolute;top:4px;left:50%;transform:translateX(-50%);width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.ring-center small{font-size:10px;font-weight:500;color:#A5B8C8;margin-left:1px}
.ring-label{font-size:12px;margin-top:6px;color:#EDF2F5}.ring>small{font-size:10px;color:#A5B8C8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ring-badge{position:absolute;top:2px;right:calc(50% - 38px);width:19px;height:19px;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#101A25;border:2px solid #1B2935}
.day-summary{font-size:12px;line-height:1.5;color:#A5B8C8;text-align:center;margin-top:10px;padding:0 8px}.day-summary strong{color:#EDF2F5;font-weight:500}
.session-main{display:flex;align-items:center;gap:14px;margin:14px 0 8px}.session-main h2{flex:1;min-width:0}
.plan-guidance:not(.open) p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more-btn{min-height:32px;padding:0;font-size:11px;color:#B3DCE2!important}
.nutrition-card{padding:20px;margin-top:12px;scroll-margin-top:16px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:24px}
.protein-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:10px}
.protein-head strong{font-size:28px;font-weight:500;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.protein-head strong span{font-size:13px;color:#A5B8C8;letter-spacing:0;font-weight:400}
.protein-head>span{font-size:12px;color:#A5B8C8}.protein-head>span.reached{color:#A9D8B8}
.protein-bar{height:8px;border-radius:99px;background:#263C4D;margin:10px 0 14px;overflow:hidden}.protein-bar span{display:block;height:100%;border-radius:99px;background:#A9D8B8;transition:width .3s ease-out}
.protein-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) 48px;gap:8px}
.chip{min-height:44px;border:1px solid #486171;border-radius:12px;background:#15222F;color:#EDF2F5;font-size:14px;font-variant-numeric:tabular-nums}
.chip.ghost{color:#A5B8C8;display:flex;align-items:center;justify-content:center}
.protein-edit{display:flex;gap:8px;align-items:center}.protein-edit .modal-input{margin:0;flex:1}.protein-edit button{flex-shrink:0;padding-left:14px;padding-right:14px}
.protein-hint{font-size:11px;color:#839BAD;line-height:1.5;margin-top:8px}.undo-btn{min-height:36px;padding:0;margin-top:4px;color:#B3DCE2!important}
.rating{border-top:1px solid #344858;margin-top:16px;padding-top:14px}.rating-q{font-size:12px;color:#A5B8C8}
.ampel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
.ampel-btn{min-height:48px;border:1px solid #344858;border-radius:12px;background:transparent;color:#A5B8C8;font-size:12px;display:flex;align-items:center;justify-content:center;gap:7px;padding:6px}
.ampel-dot{width:19px;height:19px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#101A25}
.ampel-dot.green,.ring-badge.green{background:#8FD19E}.ampel-dot.amber,.ring-badge.amber{background:#E9C46A}.ampel-dot.red,.ring-badge.red{background:#E58A7E}.ampel-dot.none{background:transparent;border:1px dashed #486171}
.ampel-btn[aria-pressed=true]{color:#EDF2F5}.ampel-btn.green[aria-pressed=true]{border-color:#8FD19E;background:rgba(143,209,158,.12)}.ampel-btn.amber[aria-pressed=true]{border-color:#E9C46A;background:rgba(233,196,106,.12)}.ampel-btn.red[aria-pressed=true]{border-color:#E58A7E;background:rgba(229,138,126,.12)}
.rating-hint{font-size:11px;color:#839BAD;line-height:1.5;margin-top:8px}.ampel-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#A5B8C8}
.upnext{padding:16px 18px 6px;margin-top:12px}.upnext-row{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:0;border-top:1px solid #2D4151;background:transparent;padding:10px 0;min-height:58px}
.upnext .eyebrow+.upnext-row{border-top:0}
.upnext-date{width:34px;flex-shrink:0;text-align:center;color:#A5B8C8}.upnext-date small{display:block;font-size:10px}.upnext-date strong{font-size:20px;font-weight:400}
.upnext-info{flex:1;min-width:0}.upnext-info strong{display:block;font-size:14px;font-weight:500;line-height:1.4;overflow-wrap:anywhere}.upnext-info small{display:block;font-size:11px;color:#A5B8C8;margin-top:3px}
.upnext-row.match .upnext-date,.upnext-row.match small,.upnext-row.match .session-marks{color:#F0CF95}

/* Plan, Körper, Saison */
.plan-switch{padding:0 20px 14px}.segmented{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid #344858;border-radius:14px;background:#15222F}
.segmented button{min-height:40px;border:0;border-radius:10px;background:transparent;color:#A5B8C8;font-size:13px}.segmented button[aria-pressed=true]{background:#29424E;color:#EDF2F5}
.body-hero{padding:22px}.hero-value{font-size:56px;font-weight:500;letter-spacing:-.06em;line-height:1;margin-top:14px;font-variant-numeric:tabular-nums}.hero-value span{font-size:20px;color:#A5B8C8;letter-spacing:0}
.hero-delta{font-size:13px;color:#B3DCE2;margin-top:8px}.hero-meta{font-size:11px;color:#839BAD;margin-top:10px;line-height:1.5}
.goal-bar{position:relative;height:10px;border-radius:99px;background:#263C4D;margin:22px 0 8px}
.goal-band{position:absolute;top:0;bottom:0;background:rgba(169,216,184,.35);border-left:1px solid #A9D8B8;border-right:1px solid #A9D8B8}
.goal-marker{position:absolute;top:-5px;width:4px;height:20px;border-radius:4px;background:#EDF2F5;transform:translateX(-50%);box-shadow:0 0 0 3px #1B2935}
.goal-legend{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#A5B8C8}
.body-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
.body-tile{padding:14px 12px;border-radius:16px;min-width:0}.body-tile small{display:block;font-size:10px;color:#A5B8C8;letter-spacing:.04em}.body-tile strong{display:block;font-size:20px;font-weight:500;margin-top:6px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.body-tile strong span{font-size:11px;color:#A5B8C8;letter-spacing:0}.body-tile em{display:block;font-style:normal;font-size:10px;color:#839BAD;margin-top:4px}
.add-measure{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:18px}
.trend-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}.trend-head .metric-switch{margin:0}
.range-switch{display:flex;gap:6px}.range-switch button{min-height:36px;padding:0 12px;border:1px solid #344858;border-radius:99px;background:transparent;color:#A5B8C8;font-size:11px}.range-switch button[aria-pressed=true]{border-color:#9CCBD3;color:#EDF2F5;background:#29424E}
.measure-list{padding:0 16px}.measure-row{display:grid;grid-template-columns:1fr auto auto 18px;gap:14px;align-items:center;width:100%;border:0;border-top:1px solid #2D4151;background:transparent;text-align:left;min-height:52px;font-size:13px;font-variant-numeric:tabular-nums;color:#EDF2F5}.measure-row:first-child{border-top:0}.measure-row>span:first-child{color:#A5B8C8}.measure-row svg{color:#839BAD}
.nutri-week{padding:18px 14px}.nutri-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center}
.nutri-day{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#A5B8C8}.nutri-day b{font-weight:500;font-variant-numeric:tabular-nums;color:#839BAD}.nutri-day b.hit{color:#A9D8B8}
.nutri-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid #344858;margin-top:16px;padding-top:14px}
.nutri-stats strong{display:block;font-size:18px;font-weight:500;font-variant-numeric:tabular-nums}.nutri-stats>div>span{display:block;font-size:10px;color:#A5B8C8;line-height:1.4;margin-top:3px}
.ampel-counts{display:flex!important;gap:6px;align-items:center;font-size:14px;font-weight:500}
.settings-link{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:18px;margin-top:24px;color:#EDF2F5}.settings-link>span{flex:1;min-width:0}.settings-link small{display:block;font-size:11px;color:#A5B8C8;margin-top:3px}
.recovery{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding:0 8px 10px;margin-bottom:8px;border-bottom:1px solid #2D4151}
.recovery-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;padding:5px 10px;border-radius:99px;background:#15222F;color:#EDF2F5}
.recovery-dot{width:9px;height:9px;border-radius:50%;background:#8FD19E}.recovery.caution .recovery-dot{background:#E9C46A}.recovery.low .recovery-dot{background:#E58A7E}
.recovery-signals{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;color:#A5B8C8}.recovery-signals .flag{color:#E9C46A}.recovery.low .recovery-signals .flag{color:#F0A99F}
.sleep-fill{background:#9CCBD3!important}.sleep-fill.good{background:#8FD19E!important}.sleep-fill.caution{background:#E9C46A!important}.sleep-fill.low{background:#E58A7E!important}
.night-metric{font-size:10px;color:#A5B8C8;font-variant-numeric:tabular-nums}
.load-card{padding:18px 20px;margin-top:12px}
.load-tag{font-size:11px;padding:4px 9px;border-radius:99px;background:#15222F;color:#A5B8C8}.load-tag.optimal{color:#8FD19E}.load-tag.high{color:#E9C46A}.load-tag.veryHigh{color:#F0A99F}.load-tag.low{color:#B3DCE2}
.load-value{display:flex;align-items:baseline;gap:10px;margin-top:10px}.load-value strong{font-size:30px;font-weight:500;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.load-value span{font-size:12px;color:#A5B8C8}
.load-bar{position:relative;height:12px;border-radius:99px;background:#263C4D;margin:12px 0 10px;overflow:visible}
.load-bar .zone{position:absolute;top:0;bottom:0}.load-bar .optimal{background:rgba(143,209,158,.35)}.load-bar .high{background:rgba(233,196,106,.3)}.load-bar .very{background:rgba(229,138,126,.28);border-radius:0 99px 99px 0}
.load-bar .planned{position:absolute;top:3px;bottom:3px;background:repeating-linear-gradient(90deg,#9CCBD3 0 4px,transparent 4px 7px);opacity:.8}
.load-bar .marker{position:absolute;top:-5px;width:4px;height:22px;border-radius:4px;background:#EDF2F5;transform:translateX(-50%);box-shadow:0 0 0 3px #1B2935}
.load-advice{font-size:13px;line-height:1.5;color:#EDF2F5}
.load-weeks .steps-bar{position:relative}.load-weeks .band{position:absolute;left:0;right:0;background:rgba(143,209,158,.3)}
.load-fill{position:relative;z-index:1;background:#647F93!important}.load-fill.current{background:#9CCBD3!important}
.report-banner{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 16px;margin-bottom:12px;color:#B3DCE2;border-color:#648694}
.report-banner span{flex:1}.report-banner strong{display:block;font-size:14px;font-weight:500;color:#EDF2F5}.report-banner small{display:block;font-size:11px;color:#A5B8C8;margin-top:2px}
.report-facts{padding:6px 18px}.report-line{display:grid;grid-template-columns:86px 1fr;gap:12px;padding:12px 0;border-top:1px solid #2D4151}.report-line:first-child{border-top:0}
.report-line>span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#B3DCE2;padding-top:2px}.report-line p{font-size:13px;line-height:1.55;color:#EDF2F5}
.report-coach{padding:20px;margin-top:14px}.report-text{white-space:pre-wrap;font-size:15px;line-height:1.65;color:#EDF2F5;margin-top:12px}
.report-row{grid-template-columns:1fr auto 0 18px}.report-row>span:nth-child(2){font-size:11px;color:#B3DCE2}
.plan-proposal{padding:18px}.proposal-summary{font-size:13px;line-height:1.55;color:#EDF2F5;margin:10px 0 4px}
.proposal-days{list-style:none;margin:10px 0 12px;padding:0}.proposal-days li{display:flex;gap:12px;padding:9px 0;border-top:1px solid #2D4151}
.proposal-date{width:44px;flex-shrink:0;font-size:12px;color:#A5B8C8;padding-top:1px}.proposal-body{flex:1;min-width:0}
.proposal-body strong{display:block;font-size:13px;font-weight:500;color:#EDF2F5}.proposal-body small{display:block;font-size:11px;color:#A5B8C8;line-height:1.45;margin-top:2px}
.proposal-days li.fixed .proposal-body strong{color:#B3DCE2}.proposal-days li.changed{background:linear-gradient(90deg,rgba(156,203,211,.08),transparent)}
.proposal-days li.changed .proposal-date{color:#B3DCE2}.proposal-was{color:#E9C46A!important}
.proposal-body strong small{display:inline;font-size:11px;font-weight:400;color:#A5B8C8}.plan-proposal .sheet-footer .primary{flex:2;white-space:nowrap}
.complaint-strip{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.complaint-row{border:1px solid #6B5A3E;border-radius:14px;background:rgba(233,196,106,.07)}.complaint-row.l3{border-color:#8E4E46;background:rgba(229,138,126,.08)}.complaint-row.l1{border-color:#3E5A4A;background:rgba(143,209,158,.06)}
.complaint-summary{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;font-size:13px;color:#EDF2F5}
.complaint-summary>span:nth-child(2){flex:1;min-width:0}.complaint-summary strong{font-weight:500}.complaint-summary small{display:block;font-size:11px;color:#A5B8C8;margin-top:2px}
.complaint-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;background:#E9C46A}.complaint-row.l1 .complaint-dot{background:#8FD19E}.complaint-row.l3 .complaint-dot{background:#E58A7E}
.complaint-update{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 12px}.complaint-update .chip{flex:1;min-width:0;padding:0 6px;font-size:12px;white-space:nowrap}.chip[aria-pressed=true]{border-color:#9CCBD3;background:#29424E}.chip.good{border-color:#5E8A6A;color:#A9D8B8}
.complaint-areas{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 10px}.complaint-areas .chip{padding:0 12px;font-size:13px}
.complaint-sides{display:flex;gap:8px;margin-bottom:6px}.complaint-sides .chip{flex:1}
.complaint-levels{display:grid;gap:8px}.complaint-level{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;min-height:56px;padding:10px 14px;border-radius:14px;border:1px solid #344858;background:#15222F;color:#EDF2F5}
.complaint-level strong{font-size:14px;font-weight:500}.complaint-level small{font-size:11px;color:#A5B8C8}.complaint-level.l1{border-color:#3E5A4A}.complaint-level.l2{border-color:#6B5A3E}.complaint-level.l3{border-color:#8E4E46}
.kcal-line{font-size:12px;color:#B3DCE2;margin:-6px 0 12px}
.meal-photo{display:flex;flex-direction:column;align-items:stretch;margin-bottom:8px}.meal-photo .secondary{display:flex;align-items:center;justify-content:center;gap:8px;border-color:#9CCBD3;white-space:nowrap}
.meal-photo .text-btn{align-self:center;min-height:36px;font-size:12px;color:#B3DCE2}
.meal-list{list-style:none;margin:0 0 12px;padding:0;border-top:1px solid #344858}
.meal-row{border-bottom:1px solid #2D4151}.meal-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;border:0;background:transparent;padding:10px 0;min-height:52px}
.meal-summary>span{min-width:0}.meal-summary strong{display:block;font-size:13px;font-weight:500;color:#EDF2F5;overflow-wrap:anywhere}.meal-summary small{display:block;font-size:11px;color:#A5B8C8;margin-top:2px}
.meal-summary>b{flex-shrink:0;text-align:right;font-size:13px;font-weight:500;color:#EDF2F5;font-variant-numeric:tabular-nums}.meal-summary>b small{display:block;font-size:11px;font-weight:400;color:#A9D8B8}
.meal-detail{padding:0 0 12px}.meal-detail ul{list-style:none;margin:0 0 8px;padding:0}.meal-detail li{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#A5B8C8;padding:3px 0}
.meal-edit{display:flex;gap:12px}.meal-edit label{flex:1;min-width:0;font-size:11px;color:#A5B8C8}.meal-edit .modal-input{margin:6px 0 0}
.meal-pending{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #2D4151;font-size:12px;color:#B3DCE2}.meal-pending img{width:44px;height:44px;object-fit:cover;border-radius:10px;flex-shrink:0}.meal-pending span{flex:1}
.connection-row{display:flex;gap:12px;align-items:flex-start;border-top:1px solid #344858;margin-top:16px;padding-top:14px;color:#B3DCE2}
.connection-row strong{display:block;font-size:14px;font-weight:500;color:#EDF2F5}.connection-row small{display:block;font-size:12px;color:#B3DCE2;margin-top:3px}.connection-row p{font-size:12px;color:#A5B8C8;margin-top:3px}
.watch-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.watch-list li{display:flex;align-items:center;gap:8px;font-size:12px;color:#B3DCE2}.watch-list li svg{flex-shrink:0}.watch-list li span{flex:1;min-width:0}.watch-stats{display:block;font-style:normal;font-size:11px;color:#EDF2F5;margin-top:3px;font-variant-numeric:tabular-nums}.watch-stats i{font-style:normal;white-space:nowrap}.watch-list li small{flex-shrink:0;white-space:nowrap;font-size:11px;color:#E9C46A}
.steps-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;padding:16px 12px 12px}
.steps-day{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#A5B8C8}.steps-day b{font-weight:500;color:#EDF2F5;font-variant-numeric:tabular-nums}
.steps-bar{height:64px;width:14px;border-radius:7px;background:#263C4D;display:flex;align-items:flex-end;overflow:hidden}.steps-bar span{display:block;width:100%;border-radius:7px;background:#9CCBD3}
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
  return <section className="panel focus-card"><div className="eyebrow">Dein taktischer Fokus</div>
    <h3>{t.focus}</h3><p>{t.detail}</p></section>;
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
    <input id="access-code" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} className="modal-input" value={code}
      placeholder="Wie APP_ACCESS_CODE in Vercel" onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
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
function DayRings({plan,viewKey,target,onOpenPlan}) {
  const today=todayStr(),e=plan[viewKey]||{},sessions=getSessions(e);
  const protein=dayProtein(e),level=nutritionLevel(e.nutrition);
  const phase=phaseForDate(viewKey),week=isHoliday(viewKey)?{done:0,goal:0}:weekTargetProgress(plan,weekAround(viewKey),phase?.name);
  const status=!sessions.length?"Ruhetag":e.completed?"erledigt":viewKey>today?"geplant":viewKey<today?"nicht eingetragen":"offen";
  const check=dayChecklist(e,viewKey,today,target);
  const summary=check.future?"Vorschau. Ernährung trägst du am Tag selbst ein."
    :check.open.length?<>{viewKey===today?"Noch offen: ":"Nicht eingetragen: "}<strong>{check.open.join(" · ")}</strong></>
    :viewKey===today?"Alles erledigt für heute. Stark.":"Alles eingetragen.";
  const recovery=viewKey<=today?recoveryStatus(plan,viewKey):null;
  return <section className="panel rings" aria-label="Tagesübersicht">
    {recovery&&<div className={"recovery "+recovery.level} role="status"
      aria-label={"Erholung: "+RECOVERY_LABELS[recovery.level]+". "+recovery.signals.map(x=>x.text).join(", ")}>
      <span className="recovery-badge"><span className="recovery-dot" aria-hidden="true"/>{RECOVERY_LABELS[recovery.level]}</span>
      {/* Compact: sleep always, other signals only when they stand out. Details live in Körper. */}
      <span className="recovery-signals" aria-hidden="true">{recovery.signals.filter(x=>x.key==='sleep'||x.level!=='good').map(x=>
        <span key={x.key} className={x.level!=='good'?'flag':''}>{x.short}</span>)}</span>
    </div>}
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
function LoadCard({plan,dk,complaints}) {
  const status=loadStatus(plan,dk),advice=loadAdvice(plan,dk,status,recoveryStatus(plan,dk),complaints);
  if(!status.ready&&!status.historyDays)return null;
  const typical=status.ready?typicalLoads(plan,dk):{},planned=status.ready?plannedLoad(plan,dk,typical):{load:0};
  const scaleMax=status.ready?Math.max(status.veryHigh*1.15,status.acute+planned.load)*1.05:1;
  const pos=v=>Math.max(0,Math.min(100,v/scaleMax*100))+"%";
  return <section className="panel load-card" aria-label="Trainingsbelastung">
    <div className="card-head"><span className="eyebrow">Belastung · 7 Tage</span>
      {status.ready&&<span className={"load-tag "+status.status}>{LOAD_LABELS[status.status]}</span>}</div>
    {status.ready?<>
      <div className="load-value"><strong>{status.acute}</strong><span>dein Bereich {status.low}–{status.high}</span></div>
      <div className="load-bar" aria-hidden="true">
        <span className="zone optimal" style={{left:pos(status.low),width:`calc(${pos(status.high)} - ${pos(status.low)})`}}/>
        <span className="zone high" style={{left:pos(status.high),width:`calc(${pos(status.veryHigh)} - ${pos(status.high)})`}}/>
        <span className="zone very" style={{left:pos(status.veryHigh),right:0}}/>
        {planned.load>0&&<span className="planned" style={{left:pos(status.acute),width:`calc(${pos(status.acute+planned.load)} - ${pos(status.acute)})`}}/>}
        <span className="marker" style={{left:pos(status.acute)}}/>
      </div>
    </>:null}
    <p className="load-advice">{advice}</p>
    {status.ready&&<p className="chart-caption">Garmin-Trainingsbelastung der letzten 7 Tage. Bereich: dein Wochenschnitt der letzten 4 Wochen × 0.8–1.3. Zählt nur, was die Uhr aufzeichnet.</p>}
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
function MealRow({meal,onSave,onRemove}) {
  const [open,setOpen]=useState(false),[kcal,setKcal]=useState(String(meal.kcal)),[protein,setProtein]=useState(String(meal.protein));
  const num=v=>v.trim()===""?NaN:Number(v.replace(",","."));
  const k=num(kcal),p=num(protein),valid=Number.isFinite(k)&&k>=0&&k<=5000&&Number.isFinite(p)&&p>=0&&p<=300;
  const save=()=>{if(!valid)return;onSave({kcal:Math.round(k),protein:Math.round(p),edited:true});setOpen(false);};
  const range=meal.kcalLow!=null&&meal.kcalHigh!=null&&meal.kcalHigh>meal.kcalLow?`${meal.kcalLow}–${meal.kcalHigh} kcal`:"";
  return <li className={"meal-row"+(open?" open":"")}>
    <button className="meal-summary" aria-expanded={open} onClick={()=>{setKcal(String(meal.kcal));setProtein(String(meal.protein));setOpen(o=>!o);}}>
      <span><strong>{meal.title}</strong><small>{meal.at}{meal.edited?" · angepasst":range?` · ${range}`:""}{!meal.edited&&meal.confidence==="low"?" · unsicher":""}</small></span>
      <b>{meal.kcal} kcal<small>{meal.protein} g Protein</small></b>
    </button>
    {open&&<div className="meal-detail">
      {Array.isArray(meal.items)&&meal.items.length>0&&<ul>{meal.items.map((i,n)=><li key={n}><span>{i.name}{i.grams?` · ${i.grams} g`:""}</span><span>{i.kcal} kcal · {Math.round(i.protein)} g</span></li>)}</ul>}
      <div className="meal-edit">
        <label>kcal<input className="modal-input" inputMode="numeric" value={kcal} onChange={e=>setKcal(e.target.value)}/></label>
        <label>Protein (g)<input className="modal-input" inputMode="numeric" value={protein} onChange={e=>setProtein(e.target.value)}/></label>
      </div>
      {!valid&&<p role="alert" className="protein-hint">Bitte gültige Werte eingeben.</p>}
      <div className="sheet-footer"><button className="primary" disabled={!valid} onClick={save}>Speichern</button><button className="secondary" onClick={onRemove}>Löschen</button></div>
    </div>}
  </li>;
}
function NutritionCard({entry,dateKey:dk,updDay,target,onAddMeal,onUpdateMeal,onRemoveMeal}) {
  const today=todayStr(),future=dk>today;
  const quick=validProtein(entry.protein)?entry.protein:null,meals=dayMeals(entry);
  const protein=dayProtein(entry),kcal=dayKcal(entry),mealProtein=meals.reduce((n,m)=>n+m.protein,0),level=nutritionLevel(entry.nutrition);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(""),[lastAdd,setLastAdd]=useState(null),[pending,setPending]=useState([]);
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
        <span className={protein!=null&&protein>=target?"reached":""}>{protein==null?"noch nicht erfasst":protein>=target?"Ziel erreicht ✓":`noch ${target-protein} g`}</span></div>
      <div className="protein-bar" role="progressbar" aria-label="Protein" aria-valuemin={0} aria-valuemax={target} aria-valuenow={protein||0}>
        <span style={{width:Math.min(100,(protein||0)/target*100)+"%"}}/></div>
      {kcal!=null&&<p className="kcal-line">≈ {kcal.toLocaleString("de-CH")} kcal aus {meals.length} {meals.length===1?"Foto":"Fotos"}</p>}
      <div className="meal-photo">
        <button className="secondary" disabled={!hasCode} onClick={()=>cameraRef.current?.click()}><Icon name="camera" size={19}/> Mahlzeit fotografieren</button>
        <button className="text-btn" disabled={!hasCode} onClick={()=>libraryRef.current?.click()}>oder aus Fotos wählen</button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto}/>
        <input ref={libraryRef} type="file" accept="image/*" hidden onChange={onPhoto}/>
      </div>
      {!hasCode&&<p className="protein-hint">Für Fotos zuerst den Zugangscode unter Saison → Einstellungen speichern.</p>}
      {(pending.length>0||meals.length>0)&&<ul className="meal-list" aria-label="Mahlzeiten">
        {meals.map(m=><MealRow key={m.id} meal={m} onSave={patch=>onUpdateMeal(dk,m.id,patch)} onRemove={()=>onRemoveMeal(dk,m.id)}/>)}
        {pending.map(p=><li key={p.key} className="meal-pending" role="status">
          {p.preview&&<img src={p.preview} alt=""/>}
          <span>{p.status==="preparing"?"Foto wird vorbereitet …":p.status==="analyzing"?"Wird geschätzt …":p.message}</span>
          {p.status==="error"&&<>{p.image&&<button className="text-btn" onClick={()=>analyze(p)}>Erneut</button>}
            <button className="text-btn" onClick={()=>setPending(list=>list.filter(x=>x.key!==p.key))}>Verwerfen</button></>}
        </li>)}
      </ul>}
      {editing?<div className="protein-edit">
        <input className="modal-input" aria-label="Protein in Gramm" inputMode="numeric" autoFocus value={draft} placeholder="z. B. 85"
          onChange={ev=>setDraft(ev.target.value)} onKeyDown={ev=>{if(ev.key==="Enter")saveDraft();if(ev.key==="Escape")setEditing(false);}}/>
        <button className="primary" disabled={!draftOk} onClick={saveDraft}>OK</button>
        <button className="secondary" onClick={()=>setEditing(false)}>Abbrechen</button></div>
      :<div className="protein-actions">
        {PROTEIN_STEPS.map(g=><button key={g} className="chip" aria-label={g+" Gramm Protein hinzufügen"} onClick={()=>add(g)}>+{g} g</button>)}
        <button className="chip ghost" aria-label="Protein korrigieren" onClick={startEdit}><Icon name="edit" size={16}/></button></div>}
      {editing&&!draftOk&&<p role="alert" className="protein-hint">Bitte 0 bis 500 g eingeben.</p>}
      {lastAdd&&!editing&&<button className="text-btn undo-btn" onClick={undo}>Rückgängig (+{lastAdd.g} g)</button>}
      {protein==null&&!editing&&!pending.length&&<p className="protein-hint">Ohne Foto: Joghurt/Skyr ≈ 20 g · Portion Fleisch/Fisch ≈ 30 g · grosse Portion ≈ 40 g</p>}
      <div className="rating"><span className="rating-q">Wie hast du {dk===today?"heute":"an diesem Tag"} gegessen?</span>
        <div className="ampel" role="group" aria-label="Ernährung bewerten">{NUTRITION_LEVELS.map(l=>
          <button key={l.key} className={"ampel-btn "+l.key} aria-pressed={entry.nutrition===l.key}
            onClick={()=>updDay(dk,{nutrition:entry.nutrition===l.key?null:l.key})}>
            <span className={"ampel-dot "+l.key} aria-hidden="true">{l.mark}</span>{l.label}</button>)}</div>
        <p className="rating-hint">{level?level.hint:"Rot heisst: viel Süsses, Essen aus Lust statt Hunger, Fast Food."}</p>
      </div></>}
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
function TodayView({plan,updDay,dayOff,setDayOff,proteinTarget,onOpenPlan,meals,onOpenReport,complaints,onReportComplaint,onResolveComplaint}) {
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
          <span className="day-marker">{calendarDone(plan[dk])?"✓":isMatchDay(plan[dk])?"⚽":getSessions(plan[dk]).length?"·":" "}</span>
        </button>)}
      </div>
      <button className="week-step" aria-label="Nächste Woche" onClick={()=>navDay(7)}>›</button>
    </div>
    {dayOff===0&&[1,2].includes(new Date().getDay())&&!readReport(lastCompletedWeek())?.read&&
      <button className="panel report-banner" onClick={()=>onOpenReport(lastCompletedWeek())}><Icon name="note" size={20}/>
        <span><strong>Dein Wochenreport ist da</strong><small>{weekLabel(lastCompletedWeek())}</small></span><Icon name="arrow" size={18}/></button>}
    {dayOff===0&&<ComplaintStrip complaints={complaints} onReport={onReportComplaint} onResolve={onResolveComplaint}/>}
    <DayRings plan={plan} viewKey={viewKey} target={proteinTarget} onOpenPlan={onOpenPlan}/>
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
        <h2>{sessions.length?sessions.map((s,i)=><span key={s}>{i>0&&<><br/><span style={{fontWeight:300,color:C.muted}}>+ </span></>}{titleBreaks(displayName(s))}</span>):"Ruhetag"}</h2>
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
      {guidance&&<aside className={"plan-guidance"+(guideOpen?" open":"")} aria-label="Planhinweis"><strong>{guidance.title}</strong><p>{guidance.text}</p>
        {guidance.text.length>110&&<button className="text-btn more-btn" aria-expanded={guideOpen} onClick={()=>setGuideOpen(o=>!o)}>{guideOpen?"Weniger":"Mehr lesen"}</button>}</aside>}
      <div className="session-actions">
        <div><button className="text-btn" onClick={()=>setSheetOpen(true)}><Icon name="edit" size={16}/> Ändern</button>
          <button className="text-btn" onClick={()=>setNotesOpen(o=>!o)} aria-expanded={notesOpen}><Icon name="note" size={16}/> {e.notes?"Notiz":"Notiz hinzufügen"}</button>
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
    <NutritionCard key={"nutrition-"+viewKey} entry={e} dateKey={viewKey} updDay={updDay} target={proteinTarget} {...meals}/>
    <UpNextCard plan={plan} from={viewKey} onSelect={go}/>
    {sheetOpen&&<WorkoutSheet dateKey={viewKey} entry={e} updDay={updDay} onClose={()=>setSheetOpen(false)}/>}
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
    {planner&&wkOff>=0&&wkOff<=1&&<div style={{marginTop:18}}><PlanProposal plan={plan} weekStart={days[0]} {...planner}/></div>}
    <WeeklyTargets plan={plan} date={days[0]}/>
    <WeeklyLoad plan={plan} dk={days[6]<today?days[6]:today}/>
    <div style={{marginTop:14}}><TacticalCard dk={days[0]}/></div>
    {sheetDk&&<WorkoutSheet dateKey={sheetDk} entry={plan[sheetDk]||{}} updDay={updDay} onClose={()=>setSheetDk(null)}/>}
  </div>;
}

function WeeklyLoad({plan,dk}) {
  const weeks=weeklyLoads(plan,dk,6),status=loadStatus(plan,dk);
  if(!weeks.some(w=>w.load>0))return null;
  const max=Math.max(...weeks.map(w=>w.load),status.ready?status.high:0,1);
  return <section aria-label="Belastung der letzten sechs Wochen">
    <div className="section-heading"><h2>Belastung</h2><small>{status.ready?`Bereich ${status.low}–${status.high} pro Woche`:"letzte 6 Wochen"}</small></div>
    <div className="panel steps-week load-weeks">{weeks.map((w,i)=><div key={w.from} className="steps-day" role="img" aria-label={`Woche ab ${shortDate(w.from)}: Belastung ${w.load}`}>
      <span className="steps-bar">{status.ready&&<span className="band" style={{bottom:status.low/max*100+"%",height:(status.high-status.low)/max*100+"%"}}/>}
        <span className={"load-fill"+(i===weeks.length-1?" current":"")} style={{height:Math.max(w.load?4:0,w.load/max*100)+"%"}}/></span>
      <b>{w.load}</b><small>{new Date(w.from+"T12:00:00").toLocaleDateString("de-CH",{day:"numeric",month:"numeric"})}</small></div>)}</div>
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
function weeklyReportFacts(plan,weekStart,target=DEFAULT_PROTEIN_TARGET,complaints=[]) {
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
    complaints:complaintsInRange(complaints,weekStart,weekEnd)};
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
function BodyView({plan,updDay,proteinTarget}) {
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
      {!editor&&<button className="primary add-measure" onClick={()=>setEditor(today)}><Icon name="plus" size={18}/> Messung eintragen</button>}
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
        {nut.kcalDays>0&&<p className="chart-caption">Ø {nut.avgKcal.toLocaleString("de-CH")} kcal an {nut.kcalDays} {nut.kcalDays===1?"Tag":"Tagen"} mit Essensfotos (Schätzung, nur fotografierte Mahlzeiten)</p>}
      </div>
    </section>
    {stepDays.some(d=>d.steps!=null)&&<section aria-label="Schritte der letzten sieben Tage">
      <div className="section-heading"><h2>Schritte</h2><span>Ø {stepAvg.toLocaleString("de-CH")} · letzte 7 Tage</span></div>
      <div className="panel steps-week">{stepDays.map(d=><div key={d.date} className="steps-day" role="img"
        aria-label={shortDate(d.date)+": "+(d.steps!=null?d.steps+" Schritte":"keine Daten")}>
        <span className="steps-bar"><span style={{height:(d.steps!=null?Math.max(4,d.steps/stepMax*100):0)+"%"}}/></span>
        <b>{d.steps!=null?(d.steps>=1000?Math.round(d.steps/100)/10+"k":d.steps):"–"}</b><small>{DN[dow0(new Date(d.date+"T12:00:00"))]}</small></div>)}</div>
    </section>}
    {nights.some(n=>n.r)&&<section aria-label="Schlaf und Erholung der letzten sieben Tage">
      <div className="section-heading"><h2>Schlaf & Erholung</h2><span>{sleepAvg!=null?`Ø ${fmtHM(sleepAvg)} Schlaf`:"letzte 7 Tage"}</span></div>
      <div className="panel steps-week">{nights.map(n=>{const st=n.r?recoveryStatus(plan,n.date):null;
        return <div key={n.date} className="steps-day" role="img" aria-label={shortDate(n.date)+": "+(st?st.signals.map(x=>x.text).join(", "):"keine Daten")}>
          <span className="steps-bar"><span className={"sleep-fill "+(st?.level||"")} style={{height:(n.r?.sleepMin?Math.max(6,Math.min(100,n.r.sleepMin/540*100)):0)+"%"}}/></span>
          <b>{n.r?.sleepMin?fmtHM(n.r.sleepMin).replace(" h",""):"–"}</b>
          <small className="night-metric">{n.r?.hrv!=null?n.r.hrv:"–"}</small><small className="night-metric">{n.r?.restingHr!=null?n.r.restingHr:"–"}</small>
          <small>{DN[dow0(new Date(n.date+"T12:00:00"))]}</small></div>;})}</div>
      <p className="chart-caption">Balken: Schlafdauer · darunter HRV (ms) und Ruhepuls · Farbe: Erholung des Tages</p>
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
  const entries=Object.values(plan), planned=entries.filter(e=>getSessions(e).length).length;
  const done=entries.filter(e=>e.completed&&getSessions(e).length).length;
  const current=phaseForDate(today), idx=PHASES.indexOf(current), next=PHASES[idx+1];
  return <div className="view">
    <section className="panel journey-summary"><div className="eyebrow">Deine Saison · 2026 / 27</div>
      <div><strong>{done}</strong><span>Trainingstage erledigt<br/>von {planned} geplant</span></div>
      <progress aria-label="Saisonfortschritt" max={Math.max(planned,1)} value={done}/>
      <p>{current?(next?daysUntil(next.start)+" Tage bis "+phaseLabel(next.name):daysUntil(current.end)+" Tage bis Saisonende"):today<SEASON_START?"Deine Saison startet am "+shortDate(SEASON_START):"Saison abgeschlossen."}</p>
    </section>
    <div className="section-heading"><h2>Wochenreports</h2><span>Montags neu</span></div>
    <div className="panel measure-list">{Array.from({length:6},(_,i)=>daysBeforeStr(lastCompletedWeek(today),7*i)).map((w,i)=>{const stored=readReport(w);
      return <button key={w} className="measure-row report-row" onClick={()=>onOpenReport(w)}><span>{weekLabel(w)}</span>
        <span>{stored?.text?"Gelesen":i===0?"Neu":""}</span><span/><Icon name="arrow" size={15}/></button>;})}</div>
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
    <button className="panel settings-link" onClick={onOpenSettings}><Icon name="settings" size={22}/>
      <span>Einstellungen<small>Name, Proteinziel, Datensicherung</small></span><Icon name="arrow" size={18}/></button>
  </div>;
}

// ─── Coach screen (full-screen chat) ─────────────────────────────────────────────
function CoachScreen({viewKey,plan,playerName,proteinTarget,complaints,onBack}) {
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
      const resp=await fetch("/api/coach",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",...authHeaders()},
        body:JSON.stringify({...buildCoachContext(plan,playerName,viewKey,todayStr(),proteinTarget,complaints),messages:base.slice(-20)})});
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
        <p style={{fontSize:11,color:C.muted,lineHeight:1.5,margin:0}}>Berücksichtigt Trainingslogs und Notizen, kommende Termine, Wochenziele, Ernährung und vorhandene Körperwerte. Chats anderer Tage sind nicht enthalten.{viewKey!==todayStr()?` Geöffneter Trainingstag: ${shortDate(viewKey)}. Das Daily Briefing bezieht sich auf heute.`:''}</p>
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
              {coachError==="auth"?"Der Zugangscode fehlt oder stimmt nicht. Trag ihn unter Saison → Einstellungen → Garmin ein.":"Der Trainer ist gerade nicht erreichbar. Prüfe deine Verbindung und versuche es erneut."}
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



// ─── Weekly plan proposal card ───────────────────────────────────────────────────
const proposalKey=weekStart=>`coach-plan-${weekStart}`;
function readProposal(weekStart) { try { return JSON.parse(localStorage.getItem(proposalKey(weekStart))||"null"); } catch { return null; } }
function writeProposal(weekStart,data) { try { data?localStorage.setItem(proposalKey(weekStart),JSON.stringify(data)):localStorage.removeItem(proposalKey(weekStart)); } catch {} }
const PLAN_ERRORS={access_denied:"Der Zugangscode stimmt nicht.",access_code_not_configured:"In Vercel fehlt noch APP_ACCESS_CODE.",
  model_not_configured:"Auf dem Server fehlt der Anthropic-Schlüssel.",plan_busy:"Gerade viele Anfragen. Gleich erneut versuchen.",
  plan_refused:"Für diese Woche gibt es keinen Vorschlag.",invalid_week:"Diese Woche kann nicht geplant werden."};
function PlanProposal({plan,weekStart,playerName,proteinTarget,complaints,onApply,onUndo}) {
  const [record,setRecord]=useState(()=>readProposal(weekStart)),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setRecord(readProposal(weekStart));setError("");},[weekStart]);
  const save=r=>{writeProposal(weekStart,r);setRecord(r);};
  const today=todayStr(),weekEnd=daysBeforeStr(weekStart,-6);
  if(weekEnd<today)return null;
  const generate=async()=>{
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/plan",{method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},
        body:JSON.stringify({...planWeekInput(plan,weekStart,today,complaints),context:buildCoachContext(plan,playerName,today,today,proteinTarget,complaints)})});
      const body=await res.json().catch(()=>({}));
      if(!res.ok||!body.proposal){setError(PLAN_ERRORS[body.error]||"Der Vorschlag hat nicht geklappt. Versuch es erneut.");return;}
      save({proposal:body.proposal,createdAt:new Date().toISOString(),applied:null});
    }catch{setError("Keine Verbindung.");}
    finally{setBusy(false);}
  };
  const p=record?.proposal,applied=record?.applied;
  const changed=p?p.days.filter(d=>!d.fixed&&d.date>=today&&!plan[d.date]?.completed&&JSON.stringify(d.sessions)!==JSON.stringify(getSessions(plan[d.date]))).length:0;
  return <section className="panel plan-proposal" aria-label="Wochenplan-Vorschlag">
    <div className="card-head"><span className="eyebrow">Plan-Vorschlag · {weekLabel(weekStart)}</span>{applied&&<span className="load-tag optimal">Übernommen</span>}</div>
    {!p&&<>
      <p className="helper-text">Der Trainer plant die offenen Tage passend zu deinen Zielen, deiner Belastung und Erholung. Spiele und Mannschaftstrainings bleiben fix.</p>
      {readAccessCode()?<button className="secondary" disabled={busy} onClick={generate}>{busy?"Der Trainer plant …":"Plan vorschlagen"}</button>
        :<p className="protein-hint">Zuerst den Zugangscode unter Saison → Einstellungen speichern.</p>}
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
  </section>;
}

// ─── Weekly report screen ────────────────────────────────────────────────────────
// Stored under coach-report-<weekStart> so backups (coach-*) include it.
const reportKey=weekStart=>`coach-report-${weekStart}`;
function readReport(weekStart) { try { return JSON.parse(localStorage.getItem(reportKey(weekStart))||"null"); } catch { return null; } }
function writeReport(weekStart,data) { try { localStorage.setItem(reportKey(weekStart),JSON.stringify(data)); } catch {} }
const weekLabel=from=>`${shortDate(from)} – ${shortDate(daysBeforeStr(from,-6))}`;
function factLines(f) {
  const t=f.training,n=f.nutrition,r=f.recovery,sign=v=>v>0?`+${v}`:v<0?`−${Math.abs(v)}`:"±0",lines=[];
  lines.push(["Training",[`${t.loggedDays} von ${t.plannedDays} Trainingstagen`,...t.goals.map(g=>`${g.type} ${g.done}/${g.goal}`),
    t.games.length?`${t.games.length} ${t.games.length===1?"Spiel":"Spiele"}`:null,t.watch.footballKm?`${t.watch.footballKm} km Fussball`:null].filter(Boolean).join(" · ")]);
  if(f.load.week)lines.push(["Belastung",`${f.load.week}${f.load.range?` · Bereich ${f.load.range[0]}–${f.load.range[1]} · ${LOAD_LABELS[f.load.status]}`:""}`]);
  const body=[f.body.bodyFat&&`Körperfett ${f.body.bodyFat.value.toFixed(1)} %${f.body.bodyFat.deltaVsPrevWeek!=null?` (${sign(f.body.bodyFat.deltaVsPrevWeek)})`:""}`,
    f.body.weight&&`Gewicht ${f.body.weight.value.toFixed(1)} kg${f.body.weight.deltaVsPrevWeek!=null?` (${sign(f.body.weight.deltaVsPrevWeek)})`:""}`].filter(Boolean);
  if(body.length)lines.push(["Körper",body.join(" · ")]);
  const food=[n.proteinDays?`Protein-Ziel ${n.proteinHitDays}/7 Tage · Ø ${n.avgProtein} g`:null,
    n.ratings.green+n.ratings.amber+n.ratings.red?`Ampel ${n.ratings.green} grün · ${n.ratings.amber} gelb · ${n.ratings.red} rot`:null,
    n.avgKcal?`Ø ${n.avgKcal.toLocaleString("de-CH")} kcal (${n.kcalDays} Tage mit Fotos)`:null].filter(Boolean);
  if(food.length)lines.push(["Ernährung",food.join(" · ")]);
  const rec=[r.avgSleepMin?`Ø Schlaf ${fmtHM(r.avgSleepMin)}`:null,r.avgHrv?`Ø HRV ${r.avgHrv}`:null,
    r.avgRestingHr?`Ø Ruhepuls ${r.avgRestingHr}${r.prevAvgRestingHr?` (${sign(r.avgRestingHr-r.prevAvgRestingHr)})`:""}`:null,
    r.cautionDays+r.lowDays?`${r.cautionDays+r.lowDays} Tage eingeschränkt`:null].filter(Boolean);
  if(rec.length)lines.push(["Erholung",rec.join(" · ")]);
  if(f.steps.avg)lines.push(["Bewegung",`Ø ${f.steps.avg.toLocaleString("de-CH")} Schritte`]);
  if(f.complaints?.length)lines.push(["Beschwerden",f.complaints.map(c=>`${c.area}${c.level?` (${c.level})`:""}${c.resolved?" · wieder gut":""}`).join(" · ")]);
  return lines;
}
function ReportScreen({plan,weekStart,playerName,proteinTarget,onBack,planner}) {
  const facts=weeklyReportFacts(plan,weekStart,proteinTarget,planner?.complaints),latest=weekStart===lastCompletedWeek();
  const [text,setText]=useState(()=>readReport(weekStart)?.text||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const requestRef=useRef(null);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  const generate=async()=>{
    setBusy(true);setError("");setText("");
    const controller=new AbortController();requestRef.current=controller;
    try{
      const resp=await fetch("/api/coach",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",...authHeaders()},
        body:JSON.stringify({...buildCoachContext(plan,playerName,todayStr(),todayStr(),proteinTarget,planner?.complaints),weeklyReport:{...facts,isLatest:latest},
          messages:[{role:"user",content:`Wochenreport für die Woche ${weekLabel(weekStart)}`}]})});
      if(resp.status===401)throw Object.assign(new Error("access"),{auth:true});
      // Only the coach's plain-text stream counts (never an HTML error page).
      if(!resp.ok||!resp.body||!(resp.headers.get("content-type")||"").startsWith("text/plain"))throw new Error("bad response");
      const reader=resp.body.getReader(),decoder=new TextDecoder();let acc="";
      for(;;){const {done,value}=await reader.read();if(done)break;acc+=decoder.decode(value,{stream:true});setText(acc);}
      if(!acc.trim())throw new Error("empty");
      writeReport(weekStart,{weekStart,facts,text:acc,createdAt:new Date().toISOString(),read:true});
    }catch(err){if(err.name!=="AbortError")setError(err.auth?"Der Zugangscode fehlt oder stimmt nicht (Saison → Einstellungen).":"Der Trainer ist gerade nicht erreichbar. Versuch es erneut.");}
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
      <section className="panel report-facts" aria-label="Zahlen der Woche">{factLines(facts).map(([k,v])=><div key={k} className="report-line"><span>{k}</span><p>{v}</p></div>)}</section>
      <section className="panel report-coach" aria-label="Einschätzung vom Trainer"><div className="eyebrow">Einschätzung vom Trainer</div>
        {text?<p className="report-text">{text}</p>:busy?<p className="helper-text">Der Trainer schreibt …</p>:null}
        {!text&&!busy&&!error&&!readAccessCode()&&<p className="helper-text">Für die Einschätzung zuerst den Zugangscode unter Saison → Einstellungen speichern.</p>}
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
  const [reportWeek,setReportWeek]=useState(null),[complaints,setComplaints]=useState([]);
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
  useEffect(()=>{if(!loading&&!loadError)writeReminderStatus(reminderStatus(plan,todayStr(),proteinTarget));},[plan,proteinTarget,loading,loadError]);
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
  const planner={playerName,proteinTarget,complaints,onApply:applyProposal,onUndo:undoProposal};
  const mealHandlers={
    onAddMeal:(dk,meal)=>updDayWith(dk,e=>({meals:[...(Array.isArray(e.meals)?e.meals:[]),meal]})),
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
  const headings={today:dayOff===0?"Heute zählt.":dayOff<0?"Rückblick.":"Vorschau.",plan:"Dein Plan.",body:"Dein Körper.",season:"Dein Weg."};
  let content;
  if(loading)content=<main className="app-shell"><p className="loading-state">Dein Plan wird geladen …</p></main>;
  else if(loadError)content=<main className="app-shell"><div className="view" style={{paddingTop:80}}><h1>Daten nicht lesbar.</h1>
    <p className="helper-text">Deine gespeicherten Daten wurden nicht verändert. Bitte prüfe den Browser-Zugriff oder sichere die vorhandenen Daten, bevor du eine Sicherung wiederherstellst.</p>
    <button className="secondary" onClick={()=>window.location.reload()}>Erneut versuchen</button></div></main>;
  else if(screen==="setup")content=<SetupScreen initName={playerName} initProteinTarget={proteinTarget} isEdit={!!playerName} onBack={playerName?()=>setScreen("main"):null}
    connections={{garmin,withings,scale:scaleSummary(plan),onSync:syncSources,onWithingsConnect:connectWithings,onWithingsDisconnect:disconnectWithings}}
    onSave={(n,target)=>{const pt=target===DEFAULT_PROTEIN_TARGET&&proteinSetting==null?null:target;setPlayerName(n);setProteinSetting(pt);save(plan,n,pt);setScreen("main");}}/>;
  else if(screen==="report")content=<ReportScreen plan={plan} weekStart={reportWeek||lastCompletedWeek()} playerName={playerName} proteinTarget={proteinTarget} onBack={()=>setScreen("main")} planner={planner}/>;
  else if(screen==="coach")content=<CoachScreen viewKey={view==="today"?offsetDate(dayOff):today} plan={plan} playerName={playerName} proteinTarget={proteinTarget} complaints={complaints} onBack={()=>setScreen("main")}/>;
  else content=<main className="app-shell">
    <header className="app-header"><PitchTexture/><div className="brand-row"><span className="brand">Soccer Tracker</span>
      <button className="coach-pill" aria-label="KI-Trainer öffnen" onClick={()=>setScreen("coach")}><Icon name="coach" size={17}/><span>Trainer</span></button></div>
      <h1>{headings[view]}</h1>
      <p className="subtitle">{playerName} <span style={{color:C.borderSt}}> / </span> {phase?phaseLabel(phase.name):today<SEASON_START?"Deine Saison beginnt bald":"Saison abgeschlossen"}</p>
    </header>
    {view==="today"&&<TodayView plan={plan} updDay={updDay} dayOff={dayOff} setDayOff={setDayOff} proteinTarget={proteinTarget} meals={mealHandlers} onOpenReport={openReport} complaints={complaints} onReportComplaint={reportComplaintNow} onResolveComplaint={resolveComplaintNow}
      onOpenPlan={()=>{setWkOff(Math.floor((dow0(new Date())+dayOff)/7));setPlanMode("week");setView("plan");window.scrollTo(0,0);}}/>}
    {view==="plan"&&<PlanView mode={planMode} setMode={setPlanMode} today={today} plan={plan} wkOff={wkOff} setWkOff={setWkOff}
      moOff={moOff} setMoOff={setMoOff} onGoToDay={goToDay} updDay={updDay} onSwapDays={swapDays} planner={planner}/>}
    {view==="body"&&<BodyView plan={plan} updDay={updDay} proteinTarget={proteinTarget}/>}
    {view==="season"&&<JourneyView today={today} plan={plan} onGoToDay={goToDay} onOpenSettings={()=>setScreen("setup")} onOpenReport={openReport}/>}
    <nav className="nav" aria-label="Hauptnavigation">{tabs.map(([key,label,icon])=><button key={key} aria-label={label} aria-current={view===key?"page":undefined}
      onClick={()=>{setView(key);if(key==="today")setDayOff(0);window.scrollTo(0,0);}}><TabIcon name={icon}/><span>{label}</span></button>)}</nav>
  </main>;
  return <><style>{UI_CSS}</style>{content}
    {restoredToast&&<div className="toast" role="status">✓ Sicherung wiederhergestellt</div>}
    {syncToast&&!restoredToast&&!storageError&&<div className="toast" role="status">{syncToast}</div>}
    {storageError&&<div className="toast" role="alert"><p>{storageError}</p><button className="text-btn" onClick={()=>save()}>Erneut speichern</button></div>}
    {celebration&&!storageError&&<div className="toast milestone-toast" role="status"><span>{celebration.emoji}</span><div><strong>{celebration.title}</strong><p>{celebration.message}</p></div>
      <button className="icon-btn" aria-label="Hinweis schließen" onClick={()=>setCelebration(null)}><Icon name="close" size={18}/></button></div>}
  </>;
}
