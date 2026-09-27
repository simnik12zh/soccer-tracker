import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual single-file app's pure data helpers without a DOM or dependencies.
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'));
const bodyHelpers=source.slice(source.indexOf('function bodyCompReadings'),source.indexOf('// Minimal responsive SVG line chart'));
const FixedDate=class extends Date {
  constructor(...args){super(...(args.length?args:['2026-10-24T12:00:00+02:00']));}
};
const api=vm.runInNewContext(helpers+'\n'+bodyHelpers+'\n({SK,buildDefaultPlan,getSessions,displayName,daysUntil,weekIndexFor,tacticalFor,bodyCompReadings,rollingSeries,PHASE_TARGETS,sessionSubtitle,TIPS,ALTS,TACTICAL_PROMPTS,FEELINGS,MILESTONES,MATCH_SCHEDULE,MATCH_SCHEDULE_VERSION,migrateMatchSchedule,applyMatchSchedule,matchSummary,isMatchDay})',{Date:FixedDate});
const plain=value=>JSON.parse(JSON.stringify(value));
const coaching=vm.runInNewContext(helpers+'\n({COACHED_START,COACHED_END,COACHED_WEEKS,COACHED_DAYS,COACHED_PLAN_VERSION,applyCoachedPlan,migrateCoachedPlan,coachingFor,coachSessionDescription})',{Date:FixedDate});

test('completed training does not mark an added fixture as played',()=>{
  const {calendarDone,calendarStatus,entryDescription}=vm.runInNewContext(helpers+'\n({calendarDone,calendarStatus,entryDescription})',{Date:FixedDate});
  const entry={sessions:['Gym'],completed:true,match:api.MATCH_SCHEDULE[0]};
  assert.equal(calendarDone(entry),false);
  assert.equal(calendarStatus(entry),'Training erledigt · Spielteilnahme offen');
  assert.match(entryDescription(entry),/Spielteilnahme nicht erfasst/);
  assert.equal(calendarDone({...entry,sessions:['Match']}),true);
  assert.equal(calendarDone({sessions:['Gym'],completed:true}),true);
  assert.equal(calendarDone(undefined),false);
});

test('date-reset siblings in TodayView have distinct keys on every day',()=>{
  // Both siblings remount on navigation, but must never share a React key.
  // This guards the exact collision that left previous days' cards in the DOM.
  const today=source.slice(source.indexOf('function TodayView'),source.indexOf('function WeekView'));
  const cardKey=today.match(/<section key=\{([^}]+)\}/)?.[1];
  const bodyKey=today.match(/<BodyCompLine key=\{([^}]+)\}/)?.[1];
  assert.ok(cardKey&&bodyKey);
  const seen=new Set();
  for(const viewKey of ['2026-09-23','2026-09-24','2026-09-25','2026-09-26']){
    for(const expression of [cardKey,bodyKey]){
      const key=vm.runInNewContext(expression,{viewKey});
      assert.equal(seen.has(key),false,'each day/component needs an independent key');
      seen.add(key);
    }
  }
});

test('redesign keeps the storage key, templates and legacy session IDs',()=>{
  assert.equal(api.SK,'soccer-v3');
  const plan=api.buildDefaultPlan();
  assert.deepEqual(plain(plan['2026-09-28'].sessions),['Gym','Mobility']);
  assert.deepEqual(plain(plan['2026-09-29'].sessions),['Walking']);
  assert.equal(plan['2026-07-12'],undefined);
  assert.equal(plan['2027-07-05'],undefined);
  assert.deepEqual(plain(api.getSessions({workout:'Futsal',completed:true})),['Futsal']);
  assert.equal(api.displayName('Futsal'),'Freizeitkick/Futsal');
  assert.equal(api.displayName('Mobility'),'Prävention/Reha');
  assert.equal(api.displayName('Gym'),'Krafttraining');
  assert.equal(api.displayName('⋯ My own session'),'⋯ My own session');
  for(const [phase,targets] of Object.entries(api.PHASE_TARGETS)){
    if(phase==='Summer Break')assert.deepEqual(plain(targets),{});
    else assert.equal(targets.Gym,2,phase+' gym goal');
  }
});

test('every session type has distinct German planned and completed card copy',()=>{
  const planned=new Set(),done=new Set();
  for(const {label} of api.ALTS){
    assert.ok(api.TIPS[label]?.summary,label+' summary');
    assert.ok(api.TIPS[label]?.done,label+' completion summary');
    const entry={sessions:[label],completed:false};
    const before=api.sessionSubtitle(entry),after=api.sessionSubtitle({...entry,completed:true});
    assert.notEqual(before,after);planned.add(before);done.add(after);
    assert.equal(api.sessionSubtitle({workout:label}),before,'legacy model');
  }
  assert.equal(planned.size,api.ALTS.length);assert.equal(done.size,api.ALTS.length);
  const combo={sessions:['Gym','Mobility']};
  assert.match(api.sessionSubtitle(combo),/Kraft aufbauen.*stabilisieren.*Mobilität/);
  assert.equal(api.sessionSubtitle(combo),api.sessionSubtitle({sessions:['Mobility','Gym']}));
  assert.equal(api.sessionSubtitle({sessions:['Match','Walking']}),api.TIPS.Match.summary+' '+api.TIPS.Walking.summary);
  assert.match(api.sessionSubtitle({sessions:['⋯ Schwimmen']}),/Schwimmen/);
  assert.equal(api.sessionSubtitle({sessions:[]}),'Erholung gehört zum Training.');
  assert.deepEqual(combo,{sessions:['Gym','Mobility']},'no plan mutation');
});

test('English built-in copy is replaced; coach is explicitly instructed to answer in German',()=>{
  const copy=JSON.stringify([api.TIPS,api.TACTICAL_PROMPTS,api.FEELINGS.map(f=>f.label),api.MILESTONES.map(m=>[m.title,m.message])]);
  assert.doesNotMatch(copy,/Defensive shape|First session logged|Drained|Game day|How should|On fire/);
  assert.doesNotMatch(source,/>LOG<|>Rest day<|\["journey","Journey"\]|Dein Plan steht\. Mach ihn/);
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/Always respond in German/);
});

test('calendar navigation counts dates rather than DST-dependent hours',()=>{
  assert.equal(api.daysUntil('2026-10-25'),1);
  assert.equal(api.daysUntil('2026-10-26'),2);
  assert.equal(api.daysUntil('2026-10-23'),-1);
  assert.equal(api.weekIndexFor('2026-10-26')-api.weekIndexFor('2026-10-19'),1);
  assert.deepEqual(plain(api.tacticalFor('2026-10-25')),plain(api.tacticalFor('2026-10-19')));
});

test('body trends tolerate future, missing and malformed measurements',()=>{
  const plan={'2026-10-20':{weight:80},'2026-10-22':{weight:78},'2026-10-23':{weight:null},'2026-10-24':{weight:'not a number'},'2026-10-25':{weight:79}};
  const readings=api.bodyCompReadings(plan,'weight');
  assert.equal(readings.length,2);
  const series=api.rollingSeries(readings,'2026-10-20','2026-10-24');
  assert.equal(series.at(-1).value,79);
  assert.deepEqual(plain(api.bodyCompReadings({'2026-10-25':{bodyFat:15}},'bodyFat')),[]);
});

test('retired check-ins are not included in server coach context',()=>{
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  const contextCode=coach.slice(coach.indexOf('function buildContextBlock'),coach.indexOf('// Keep only well-formed'));
  const context=vm.runInNewContext(contextCode+'\nbuildContextBlock');
  const text=context({playerName:'Test',today:{workout:'Pickup/Futsal'},readiness:{hip:'red',legs:'amber'}});
  assert.match(text,/Pickup\/Futsal/);
  assert.doesNotMatch(text,/readiness|Left hip|general freshness/);
});

test('all seven Julius Bär fixtures match the screenshot, including local kickoff times',()=>{
  assert.deepEqual(plain(api.MATCH_SCHEDULE.map(({id,date,kickoff,opponent,home})=>[id,date,kickoff,opponent,home])),[
    ['972321','2026-10-02','20:00','FC UBS 1 AG',false],
    ['972311','2026-10-12','20:30','FC Ränte',true],
    ['972315','2026-10-16','20:15','FC Ristorante Da Carlo',false],
    ['972323','2026-10-26','20:30','Shamrock Football Club',true],
    ['972326','2026-10-31','10:00','FC Ränte',false],
    ['972330','2026-11-09','20:30','FC Ristorante Da Carlo',true],
    ['972331','2026-11-12','19:00','FIFA FOOTBALL CLUB',false],
  ]);
  assert.ok(api.MATCH_SCHEDULE.every(m=>m.team==='FC Julius Bär'&&m.timezone==='Europe/Zurich'));
  assert.equal(api.matchSummary(api.MATCH_SCHEDULE[3]),'Zuhause · 20:30 Uhr · gegen Shamrock Football Club');
});

test('new calendars use real fixtures instead of recurring Saturday matches',()=>{
  const plan=api.buildDefaultPlan();
  const matches=Object.entries(plan).filter(([,e])=>api.getSessions(e).includes('Match')).map(([dk])=>dk).sort();
  assert.deepEqual(matches,plain(api.MATCH_SCHEDULE.map(m=>m.date).sort()));
  assert.deepEqual(plain(plan['2026-10-12'].sessions),['Match'],'open Monday gym and rehab replaced');
  assert.deepEqual(plain(plan['2026-11-12'].sessions),['Match'],'open Thursday team training replaced');
  assert.deepEqual(plain(plan['2026-10-03'].sessions),['Walking'],'recovery instead of Saturday match');
  assert.equal(plan['2027-04-10'],undefined,'spring fixture dates are unknown, not invented');
});

test('fixture migration preserves logged days, metadata and an archive of overwritten planning',()=>{
  const before={playerName:'Test',customMeta:{keep:true},mkLog:[{date:'2026-08-01'}],plan:{
    '2026-09-26':{sessions:['Match'],completed:false,notes:'Historical'},
    '2026-10-02':{sessions:['Mobility'],completed:false,notes:'Keep note',weight:78.6},
    '2026-10-03':{workout:'Match',completed:false,notes:'Saturday note',bodyFat:16},
    '2026-10-06':{sessions:['Match'],completed:false,notes:'User added Tuesday game'},
    '2026-10-10':{sessions:['Match'],completed:true,feeling:4,notes:'Logged match'},
    '2026-10-12':{sessions:['Gym','Mobility'],completed:false,notes:'Old Monday plan'},
    '2026-10-17':{sessions:['Match','Gym'],completed:false,weight:79},
    '2026-10-24':{sessions:['Match'],completed:false,match:{id:'custom',opponent:'Custom club'}},
    '2026-10-26':{sessions:['Gym'],completed:true,feeling:5,notes:'Already trained'},
    '2027-04-10':{sessions:['Match'],completed:false},
  }};
  const snapshot=plain(before), after=api.migrateMatchSchedule(before);
  assert.deepEqual(before,snapshot,'input must not mutate');
  assert.equal(after.matchScheduleVersion,api.MATCH_SCHEDULE_VERSION);
  for(const date of ['2026-09-26','2026-10-06','2026-10-10','2026-10-24'])assert.deepEqual(plain(after.plan[date]),snapshot.plan[date]);
  assert.deepEqual(plain(after.plan['2026-10-03'].sessions),[]);
  assert.equal(after.plan['2026-10-03'].notes,'Saturday note');
  assert.equal(after.plan['2026-10-03'].bodyFat,16);
  assert.deepEqual(plain(after.plan['2026-10-17'].sessions),['Gym']);
  assert.deepEqual(plain(after.plan['2027-04-10'].sessions),[]);
  assert.equal(after.plan['2026-10-02'].notes,'Keep note');assert.equal(after.plan['2026-10-02'].weight,78.6);
  assert.deepEqual(plain(after.plan['2026-10-12'].sessions),['Match']);
  const {match,...loggedTraining}=after.plan['2026-10-26'];
  assert.deepEqual(plain(loggedTraining),snapshot.plan['2026-10-26']);
  assert.equal(match.opponent,'Shamrock Football Club');
  assert.deepEqual(plain(after.matchScheduleBackup.previousEntries['2026-10-12']),snapshot.plan['2026-10-12']);
  assert.deepEqual(plain(after.mkLog),snapshot.mkLog);assert.deepEqual(plain(after.customMeta),snapshot.customMeta);
  assert.equal(api.migrateMatchSchedule(after),after,'import is idempotent');
  after.plan['2026-10-12'].notes='User changed after import';
  assert.equal(api.migrateMatchSchedule(after).plan['2026-10-12'].notes,'User changed after import');
});

test('reviewed plan covers every date through year end and provides two gym days per week',()=>{
  const plan=api.buildDefaultPlan();
  assert.equal(Object.keys(coaching.COACHED_DAYS).length,96);
  assert.equal(coaching.COACHED_DAYS['2027-01-01'],undefined);
  assert.equal(coaching.COACHED_WEEKS.length,14);
  for(const [monday] of coaching.COACHED_WEEKS){
    const end=new Date(monday+'T12:00:00');end.setDate(end.getDate()+6);
    const endKey=end.toISOString().slice(0,10);
    const days=Object.entries(plan).filter(([dk])=>dk>=monday&&dk<=endKey&&dk<=coaching.COACHED_END);
    assert.equal(days.filter(([,e])=>api.getSessions(e).includes('Gym')).length,2,monday+' gym');
    assert.ok(days.filter(([,e])=>api.getSessions(e).includes('Mobility')).length>=2,monday+' rehab');
  }
  for(const dk of Object.keys(coaching.COACHED_DAYS)){
    assert.ok(plan[dk],dk+' entry');
    assert.ok(coaching.coachingFor(plan[dk]),dk+' visible prescription');
    assert.ok(api.getSessions(plan[dk]).length<=2,dk+' at most two sessions');
    const isThursday=new Date(dk+'T12:00:00').getDay()===4;
    if(isThursday&&dk<='2026-11-12')assert.ok(api.getSessions(plan[dk]).includes(dk==='2026-11-12'?'Match':'Team Training'),dk);
    if(dk>'2026-11-12')assert.equal(api.getSessions(plan[dk]).includes('Team Training'),false,dk);
  }
  assert.equal(plan['2027-01-04'].coaching,undefined,'no change to next year');
  assert.deepEqual(plain(plan['2027-01-04'].sessions),['Gym','Mobility']);
});

test('match recovery, light pre-match gym and season-end deload are explicit',()=>{
  const plan=api.buildDefaultPlan();
  for(const match of api.MATCH_SCHEDULE){
    const date=new Date(match.date+'T12:00:00');date.setDate(date.getDate()+1);
    const next=date.toISOString().slice(0,10);
    assert.deepEqual(plain(plan[next].sessions),['Walking'],next+' no futsal or gym after match');
  }
  for(const dk of ['2026-10-14','2026-10-18','2026-10-28','2026-10-30','2026-11-11','2026-11-14']){
    assert.ok(plan[dk].sessions.includes('Gym'));
    assert.match(plan[dk].coaching.text,/Oberkörper|Ziehen, Drücken/);
    assert.match(plan[dk].coaching.text,/Keine Beinbelastung|Keine schweren Beine/);
  }
  for(const dk of ['2026-10-01','2026-10-15'])assert.match(plan[dk].coaching.text,/Morgen ist Spiel/);
  for(const dk of ['2026-11-17','2026-11-19','2026-12-14','2026-12-17'])assert.match(plan[dk].coaching.title,/Entlastungswoche/);
  for(const dk of ['2026-12-24','2026-12-31'])assert.deepEqual(plain(plan[dk].sessions),[]);
});

test('coaching migration preserves logs, personal data and other dates; runs once',()=>{
  const before={playerName:'Test',custom:true,matchScheduleVersion:api.MATCH_SCHEDULE_VERSION,plan:{
    '2026-09-26':{sessions:['Match'],notes:'past'},
    '2026-09-27':{sessions:['Team Training'],completed:true,feeling:5,notes:'Done today'},
    '2026-09-28':{sessions:['Gym'],completed:false,notes:'Keep me',weight:79,bodyFat:16,hip:'old-field'},
    '2026-10-02':{sessions:['Match'],completed:false,match:plain(api.MATCH_SCHEDULE[0])},
    '2026-10-06':{sessions:['Match'],notes:'Extra game'},
    '2026-10-07':{sessions:['Sick/Injured'],completed:false,notes:'Rest required'},
    '2026-10-08':{sessions:['Gym'],completed:true,notes:'Already done'},
    '2027-01-04':{sessions:['Walking'],notes:'My January'},
  }};
  const snapshot=plain(before),after=coaching.migrateCoachedPlan(before,'2026-09-27');
  assert.deepEqual(before,snapshot,'immutable input');
  assert.equal(after.coachedPlanVersion,coaching.COACHED_PLAN_VERSION);
  for(const dk of ['2026-09-26','2026-09-27','2026-10-06','2026-10-07','2026-10-08','2027-01-04'])assert.deepEqual(plain(after.plan[dk]),snapshot.plan[dk],dk+' preserved');
  for(const key of ['notes','weight','bodyFat','hip'])assert.equal(after.plan['2026-09-28'][key],before.plan['2026-09-28'][key]);
  assert.deepEqual(plain(after.plan['2026-10-02'].match),before.plan['2026-10-02'].match);
  assert.deepEqual(plain(after.coachedPlanBackup.previousEntries['2026-09-28']),before.plan['2026-09-28']);
  assert.equal(after.coachedPlanBackup.previousEntries['2026-09-27'],undefined,'do not archive unchanged logs');
  assert.equal(after.coachedPlanBackup.previousEntries['2026-12-31'],null,'archive missing entries as null');
  assert.equal(after.custom,true);
  after.plan['2026-09-28'].sessions=['Walking'];
  assert.equal(coaching.migrateCoachedPlan(after,'2026-09-27'),after,'manual edits survive subsequent loads');
  assert.equal(coaching.coachingFor(after.plan['2026-09-28']),null,'stale guidance is hidden');
  const later=coaching.migrateCoachedPlan(before,'2026-10-24');
  assert.equal(later.plan['2026-09-28'],before.plan['2026-09-28'],'late installs do not rewrite history');
  const previousDraft={...before,coachedPlanVersion:'autumn-winter-2026-v1',coachedPlanBackup:{previousEntries:{'2026-09-28':{sessions:['Gym'],notes:'Original before any overlay'}}}};
  const upgraded=coaching.migrateCoachedPlan(previousDraft,'2026-09-27');
  assert.equal(upgraded.coachedPlanBackup.previousEntries['2026-09-28'].notes,'Original before any overlay','keep earliest archived plan across overlay revisions');
  assert.deepEqual(plain(upgraded.plan['2026-10-30'].sessions),['Gym','Mobility']);
});

test('new coaching guidance reaches the coach without replacing personal notes',()=>{
  const plan=api.buildDefaultPlan();
  const text=coaching.coachSessionDescription(plan['2026-10-30']);
  assert.match(text,/Planhinweis: Kurzer Gym-Termin/);
  assert.match(text,/Keine Beinbelastung/);
  assert.equal(coaching.coachingFor({sessions:['Walking']}),null);
  assert.match(source,/coaching:null/,'manual session edits and swaps invalidate dated instructions');
});

test('browsing the plan uses the selected date for next session and weekly targets',()=>{
  const {nextUp}=vm.runInNewContext(helpers+'\n({nextUp})',{Date:FixedDate});
  const next=nextUp(api.buildDefaultPlan(),'2026-10-30');
  assert.equal(next.label,'Spiel gegen FC Ränte');
  assert.equal(next.when,'morgen · Auswärts · 10:00 Uhr');
  assert.match(source,/<WeeklyTargets plan=\{plan\} date=\{viewKey\}/);
  const targetCode=source.slice(source.indexOf('function WeeklyTargets'),source.indexOf('// ─── Body-comp entry line'));
  assert.match(targetCode,/weekAround\(date\)/);
  assert.doesNotMatch(targetCode,/weekOf\(0\)/);
});
