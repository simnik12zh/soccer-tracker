import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({dayLoad,typicalLoads,loadStatus,plannedLoad,dayGuidance,loadOutlook,loadSeries,loadOutlookText,acuteLoads,outlookLabel,weeklyLoads,buildCoachContext,daysBeforeStr})',{Date:FixedDate});

const TODAY='2026-10-28';
const g=(id,type,load,matched=true)=>({id,type,load,matched});
// Eight weeks with ~354 load per week: Gym 60 Mon, run 50 Tue, team 170 Thu, run 50 Sat, walk 20 Sun, futsal 50.
function history(weeks=8){
  const plan={};
  for(let w=0;w<weeks;w++){
    const base=app.daysBeforeStr(TODAY,7*w+6); // a Thursday-anchored week ending today
    const days=Array.from({length:7},(_,i)=>app.daysBeforeStr(base,-i));
    plan[days[0]]={sessions:['Gym'],completed:true,garmin:[g('a'+w,'strength_training',60)]};
    plan[days[1]]={sessions:['Easy run'],completed:true,garmin:[g('b'+w,'running',50)]};
    plan[days[3]]={sessions:['Team Training'],completed:true,garmin:[g('c'+w,'soccer',170)]};
    plan[days[5]]={sessions:['Easy run'],completed:true,garmin:[g('d'+w,'trail_running',54)]};
    plan[days[6]]={sessions:['Walking'],completed:true,garmin:[g('e'+w,'walking',20),g('f'+w,'cycling',null,false)]};
  }
  return plan;
}

test('daily and typical loads come from the watch only',()=>{
  assert.equal(app.dayLoad({garmin:[g(1,'soccer',170),g(2,'walking',null),g(3,'running',-5)]}),170);
  assert.equal(app.dayLoad(undefined),0);
  const typical=app.typicalLoads(history(),TODAY);
  assert.deepEqual(plain(typical),{Gym:60,'Easy run':52,soccer:170,training:170,Walking:20},'football also per kind once two of a kind exist');
});

test('a planned game is estimated from earlier games, a training from trainings',()=>{
  const plan=history();
  // Two earlier games, both harder than the team trainings (170).
  plan['2026-10-17']={sessions:['Match'],completed:true,match:{opponent:'A',home:true,kickoff:'20:00'},garmin:[g('x1','soccer',300)]};
  plan['2026-10-24']={sessions:['Match'],completed:true,match:{opponent:'B',home:false,kickoff:'20:00'},garmin:[g('x2','soccer',320)]};
  const typical=app.typicalLoads(plan,TODAY);
  assert.equal(typical.match,310);
  assert.equal(typical.training,170);
  plan['2026-10-29']={sessions:['Match'],match:{opponent:'C',home:true,kickoff:'20:00'}};
  plan['2026-10-30']={sessions:['Team Training']};
  assert.equal(app.plannedLoad(plan,'2026-10-29',typical).load,310,'the game counts like his games');
  assert.equal(app.plannedLoad(plan,'2026-10-30',typical).load,170,'the training like his trainings');
  // With only one game recorded, a planned game falls back to all football together.
  delete plan['2026-10-24'];
  const few=app.typicalLoads(plan,TODAY);
  assert.equal(few.match,undefined);
  assert.equal(app.plannedLoad(plan,'2026-10-29',few).load,few.soccer);
});

test('acute load fades day by day; chronic is its four-week average, on the scale of a usual week',()=>{
  // Eight steady weeks of ~354 per week: the chronic level settles at the weekly total.
  const st=app.loadStatus(history(8),TODAY);
  assert.deepEqual(plain(st),{ready:true,acute:334,weekly:353,low:282,high:512,veryHigh:688,ratio:0.95,status:'optimal',headroom:178});
  // A single session counts fully that day, then loses a seventh per day.
  const one={'2026-10-21':{garmin:[g('s','soccer',140)]}};
  const days=app.acuteLoads(one,'2026-10-21','2026-10-24').map(p=>Math.round(p.load));
  assert.deepEqual(plain(days),[140,120,103,88]);
  const plan=history();
  // A big extra week pushes the ratio up.
  plan[TODAY]={...plan[TODAY],garmin:[...plan[TODAY].garmin,g('x','soccer',250)]};
  const heavy=app.loadStatus(plan,TODAY);
  assert.equal(heavy.status,'high');
  assert.equal(heavy.headroom,0);
  // Not enough history yet.
  const fresh=app.loadStatus({[TODAY]:{garmin:[g('y','running',50)]}},TODAY);
  assert.deepEqual(plain(fresh),{ready:false,historyDays:1,acute:50});
});

test('advice uses the planned session, spare room and recovery',()=>{
  const plan=history();
  plan[TODAY]={sessions:['Team Training'],completed:false,garmin:[]};
  // Remove this week's completed team training so the planned one counts.
  const st=app.loadStatus(plan,TODAY);
  const planned=app.plannedLoad(plan,TODAY,app.typicalLoads(plan,TODAY));
  assert.deepEqual(plain(planned),{sessions:['Team Training'],load:170});
  const advice=app.dayGuidance(plan,TODAY,[],st,null).advice;
  assert.match(advice,/Mannschaftstraining \(≈ 170\)/);
  // Nothing planned, mid-week a little below his usual level: room for an easy run (extras only up to ~1.1 × usual).
  plan[TODAY]={sessions:[]};
  assert.equal(app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),null).advice,'Spielraum ca. 73: Ein lockerer Lauf (≈ 52) liegt noch drin.');
  // Low recovery overrules spare load.
  assert.match(app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),{level:'low'}).advice,/Erholung ist heute niedrig/);
  // Above the range: no extras.
  plan[TODAY]={sessions:[],garmin:[g('z','soccer',260)]};
  assert.match(app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),null).advice,/über deinem Bereich/);
  assert.match(app.dayGuidance({},TODAY,[],app.loadStatus({},TODAY),null).advice,/Noch zu wenig Daten/);
});

test('advice looks ahead: planned team training and games use up the spare room',()=>{
  // An easy last week: drop this week's team training and the Saturday run.
  const plan=history();
  for(const dk of Object.keys(plan))if(dk>app.daysBeforeStr(TODAY,7))plan[dk]={...plan[dk],garmin:(plan[dk].garmin||[]).filter(x=>x.type!=='soccer'&&x.type!=='trail_running')};
  const st=app.loadStatus(plan,TODAY);
  assert.equal(st.status,'low');
  plan[TODAY]={sessions:[]};
  assert.match(app.dayGuidance(plan,TODAY,[],st,null).advice,/^Du liegst unter deinem Bereich\. Ein lockerer Lauf/,'nothing planned ahead: room for a run');
  // Wednesday: team training Thursday, game Friday, game Sunday.
  plan['2026-10-29']={sessions:['Team Training']};
  plan['2026-10-30']={sessions:['Match'],match:{opponent:'X',home:true,kickoff:'20:00'}};
  plan['2026-11-01']={sessions:['Match'],match:{opponent:'Y',home:false,kickoff:'15:00'}};
  const out=app.loadOutlook(plan,TODAY);
  assert.deepEqual(plain(out.upcoming.map(u=>[u.date,u.load])),[['2026-10-29',170],['2026-10-30',170],['2026-11-01',170]]);
  assert.ok(out.peak.load>st.acute+100,'the projected 7-day load rises with the planned sessions');
  assert.equal(app.outlookLabel(out.upcoming),'Mannschaftstraining (Do), Spiel (Fr) und Spiel (So)');
  const advice=app.dayGuidance(plan,TODAY,[],st,null).advice;
  assert.match(advice,/^Du liegst noch unter deinem Bereich, aber mit Mannschaftstraining \(Do\), Spiel \(Fr\) und Spiel \(So\) kommst du auf ≈ \d+/);
  assert.match(advice,/Heute keine Zusatzeinheit\.$/);
  // The day before a game and the day after a game.
  const beforeGame={...plan,'2026-10-29':{sessions:[]}};
  assert.equal(app.dayGuidance(beforeGame,'2026-10-29',[],app.loadStatus(beforeGame,'2026-10-29'),null).advice,'Morgen ist Spiel. Heute keine Zusatzeinheit, höchstens Mobilität oder Spazieren.');
  const afterGame={...plan,'2026-10-31':{sessions:[]}};
  assert.equal(app.dayGuidance(afterGame,'2026-10-31',[],app.loadStatus(afterGame,'2026-10-31'),null).advice,'Morgen ist Spiel. Heute keine Zusatzeinheit, höchstens Mobilität oder Spazieren.','Saturday sits between two games: the next game wins');
  const monday={...plan,'2026-11-02':{sessions:[]}};
  assert.equal(app.dayGuidance(monday,'2026-11-02',[],app.loadStatus(monday,'2026-11-02'),null).advice,'Gestern war Spiel. Heute nur Spazieren oder Mobilität.');
  const ctx=app.buildCoachContext(plan,'Test',TODAY,TODAY);
  assert.equal(ctx.load.outlook.plannedNextDays.length,3);
  assert.equal(ctx.load.outlook.plannedNextDays[1].sessions[0],'Spiel');
  assert.equal(ctx.load.outlook.projectedPeak.load,out.peak.load);
});

test('day light: one colour with a matching sentence, looking ahead to games',()=>{
  const plan=history();
  const good={level:'good',signals:[]};
  plan[TODAY]={sessions:['Gym'],completed:false};
  let r=app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),good);
  assert.deepEqual([r.level,r.label],['good','Bereit']);
  assert.equal(app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),null).level,null,'no night from the watch: no colour');
  // The night counts: two mild signals make it orange, and the sentence names them.
  const caution={level:'caution',signals:[{key:'sleep',level:'caution',why:'nur 6:40 h Schlaf'},{key:'hrv',level:'caution',why:'HRV 44 ms unter deinem Bereich'},{key:'restingHr',level:'good',why:'x'}]};
  r=app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),caution);
  assert.deepEqual([r.level,r.label,r.advice],['caution','Ruhiger Tag','Nur 6:40 h Schlaf und HRV 44 ms unter deinem Bereich. Krafttraining heute kürzer oder lockerer, nichts extra.']);
  const low={level:'low',signals:[{key:'sleep',level:'low',why:'nur 5:40 h Schlaf'},{key:'bodyBattery',level:'low',why:'Body Battery nur 25'}]};
  r=app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),low);
  assert.deepEqual([r.level,r.label,r.advice],['low','Erholungstag','Nur 5:40 h Schlaf und Body Battery nur 25. Heute nur locker oder Pause.']);
  // Games: the day before and the day after are never green, even after a good night.
  plan['2026-10-29']={sessions:['Match'],match:{opponent:'X',home:true,kickoff:'20:00'}};
  r=app.dayGuidance(plan,TODAY,[],app.loadStatus(plan,TODAY),good);
  assert.deepEqual([r.level,r.advice],['caution','Morgen ist Spiel. Krafttraining heute locker halten, nichts extra.']);
  r=app.dayGuidance(plan,'2026-10-30',[],app.loadStatus(plan,'2026-10-30'),good);
  assert.deepEqual([r.level,r.advice],['caution','Gestern war Spiel. Heute nur Spazieren oder Mobilität.']);
  // The game day itself stays green after a good night: the game is played anyway.
  r=app.dayGuidance(plan,'2026-10-29',[],app.loadStatus(plan,'2026-10-29'),good);
  assert.equal(r.level,'good');
  assert.match(r.advice,/^Heute ist Spiel/);
  // Far above his usual week: red, whatever the night says.
  const heavy=history();
  heavy[TODAY]={sessions:[],garmin:[g('z','soccer',520)]};
  const st=app.loadStatus(heavy,TODAY);
  assert.equal(st.status,'veryHigh');
  r=app.dayGuidance(heavy,TODAY,[],st,good);
  assert.equal(r.level,'low');
  assert.match(r.advice,/^Du liegst deutlich über deinem Bereich \(\d+, normal bis \d+\)\. Heute nur locker oder Pause\.$/);
});

test('day light: a second reason of another kind joins the sentence, and the factors show all of them',()=>{
  const plan=history();
  // A game yesterday instead of the easy run: a good night, but the load is above the range.
  plan['2026-10-27']={sessions:['Match'],completed:true,match:{opponent:'X',home:true,kickoff:'20:00'},garmin:[g('m','soccer',400)]};
  plan[TODAY]={sessions:['Walking']};
  const st=app.loadStatus(plan,TODAY);
  assert.equal(st.status,'high');
  const r=app.dayGuidance(plan,TODAY,[],st,{level:'good',signals:[]});
  assert.deepEqual([r.level,r.label],['caution','Ruhiger Tag']);
  assert.equal(r.advice,'Gestern war Spiel, und deine Belastung liegt über dem Bereich. Heute nur Spazieren oder Mobilität.');
  assert.deepEqual(plain(r.factors),[{key:'sleep',level:'good',text:'Schlaf gut'},{key:'load',level:'caution',text:'Belastung über Bereich'},
    {key:'game',level:'caution',text:'Spiel gestern'}]);
  // A limited night after the game: the night joins instead of the load (one second reason only).
  const mild={level:'caution',signals:[{key:'sleep',level:'caution',why:'nur 6:40 h Schlaf'},{key:'hrv',level:'caution',why:'HRV 44 ms unter deinem Bereich'}]};
  assert.equal(app.dayGuidance(plan,TODAY,[],st,mild).advice,'Gestern war Spiel, und dein Schlaf war mässig. Heute nur Spazieren oder Mobilität.');
  // Without a night from the watch: no colour, and sleep says so.
  assert.equal(app.dayGuidance(plan,TODAY,[],st,null).factors[0].text,'Schlaf ohne Daten');
});

test('the load line: measured up to today, then the plan, matching the day light outlook',()=>{
  const plan=history();
  plan[TODAY]={sessions:[]};
  plan['2026-10-29']={sessions:['Team Training']};
  plan['2026-10-30']={sessions:['Match'],match:{opponent:'X',home:true,kickoff:'20:00'}};
  plan['2026-11-01']={sessions:['Match'],match:{opponent:'Y',home:false,kickoff:'15:00'}};
  const st=app.loadStatus(plan,TODAY),series=app.loadSeries(plan,TODAY);
  assert.equal(series.length,29,'21 days back, today and 7 ahead');
  const today=series.find(p=>p.date===TODAY);
  assert.equal(today.load,st.acute);
  assert.equal(today.future,false);
  const out=app.loadOutlook(plan,TODAY);
  for(const p of out.projected.slice(1))assert.equal(series.find(x=>x.date===p.date).load,p.load,'same numbers as the day light looks at');
  const sat=series.find(p=>p.date==='2026-10-31');
  assert.equal(sat.load-sat.base,270,'Thursday training and Friday game, faded by two days and one day; Sunday not yet');
  const text=app.loadOutlookText(plan,TODAY,series,st);
  assert.match(text,/^Mit deinem Plan liegst du bis \w+ über deinem Bereich, am höchsten ≈\u00A0\d+ am \w+\./);
  assert.match(text,/Am meisten trägt dein Plan mit (Spiel|Mannschaftstraining) \(\w+\) und (Spiel|Mannschaftstraining) \(\w+\) bei\.$/);
  // Without the games the week stays inside the range.
  delete plan['2026-10-30'];delete plan['2026-11-01'];
  const calm=app.loadOutlookText(plan,TODAY,app.loadSeries(plan,TODAY),st);
  assert.match(calm,/^Mit deinem Plan kommst du die nächsten 7 Tage nicht über deinen Bereich/);
  assert.equal(app.loadOutlookText({},TODAY,app.loadSeries({},TODAY),app.loadStatus({},TODAY)),null,'no range yet: no sentence');
});

test('weekly totals and coach context',()=>{
  const plan=history(6);
  const weeks=app.weeklyLoads(plan,TODAY,6);
  assert.equal(weeks.length,6);
  assert.equal(weeks.at(-1).from,'2026-10-26','current week starts Monday');
  assert.ok(weeks.every(w=>Number.isInteger(w.load)));
  const ctx=app.buildCoachContext(plan,'Test',TODAY,TODAY);
  assert.equal(ctx.load.ready,true);
  assert.deepEqual(plain(ctx.load.optimalRange),[277,501]);
  assert.equal(ctx.load.typicalLoadBySession.Fussball,170);
  assert.equal(ctx.load.last6Weeks.length,6);
  assert.equal(typeof ctx.load.appAdvice,'string');
  assert.equal(ctx.today.dayLight.advice,ctx.load.appAdvice,'the coach sees the same sentence as the app');
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/'nutrition','load',/,'server accepts the load block');
  assert.match(coach,/always let low recovery overrule spare load/);
  assert.match(coach,/An extra session today counts in every one of these windows/);
  assert.match(source,/if\(!gLast\|\|gLast\.v!==4\)gFrom=daysBeforeStr\(today,41\)/,'six weeks of activities are loaded once');
});
