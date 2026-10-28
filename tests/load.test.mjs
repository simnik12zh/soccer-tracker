import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({dayLoad,typicalLoads,loadStatus,plannedLoad,loadAdvice,loadOutlook,outlookLabel,weeklyLoads,buildCoachContext,daysBeforeStr})',{Date:FixedDate});

const TODAY='2026-10-28';
const g=(id,type,load,matched=true)=>({id,type,load,matched});
// Four weeks with ~400 load per week: Gym 60 Mon, run 50 Tue, team 170 Thu, run 50 Sat, walk 20 Sun, futsal 50.
function history(weeks=4){
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
  assert.deepEqual(plain(typical),{Gym:60,'Easy run':52,soccer:170,Walking:20});
});

test('acute load is compared with his own four-week average',()=>{
  const plan=history();
  const st=app.loadStatus(plan,TODAY);
  assert.deepEqual(plain(st),{ready:true,acute:354,weekly:354,low:283,high:460,veryHigh:531,ratio:1,status:'optimal',headroom:106});
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
  const advice=app.loadAdvice(plan,TODAY,st,null);
  assert.match(advice,/Mannschaftstraining \(≈ 170\)/);
  // Nothing planned and right at his average: no extra needed (extras only up to ~1.1 × average).
  plan[TODAY]={sessions:[]};
  assert.equal(app.loadAdvice(plan,TODAY,app.loadStatus(plan,TODAY),null),'Du bist im Bereich. Mehr braucht es heute nicht.');
  // Low recovery overrules spare load.
  assert.match(app.loadAdvice(plan,TODAY,app.loadStatus(plan,TODAY),{level:'low'}),/Erholung ist heute niedrig/);
  // Above the range: no extras.
  plan[TODAY]={sessions:[],garmin:[g('z','soccer',260)]};
  assert.match(app.loadAdvice(plan,TODAY,app.loadStatus(plan,TODAY),null),/über deinem Bereich/);
  assert.match(app.loadAdvice({},TODAY,app.loadStatus({},TODAY),null),/Noch zu wenig Daten/);
});

test('advice looks ahead: planned team training and games use up the spare room',()=>{
  // An easy last week: drop this week's team training and the Saturday run.
  const plan=history();
  for(const dk of Object.keys(plan))if(dk>app.daysBeforeStr(TODAY,7))plan[dk]={...plan[dk],garmin:(plan[dk].garmin||[]).filter(x=>x.type!=='soccer'&&x.type!=='trail_running')};
  const st=app.loadStatus(plan,TODAY);
  assert.equal(st.status,'low');
  plan[TODAY]={sessions:[]};
  assert.match(app.loadAdvice(plan,TODAY,st,null),/^Du liegst unter deinem Bereich\. Ein lockerer Lauf/,'nothing planned ahead: room for a run');
  // Wednesday: team training Thursday, game Friday, game Sunday.
  plan['2026-10-29']={sessions:['Team Training']};
  plan['2026-10-30']={sessions:['Match'],match:{opponent:'X',home:true,kickoff:'20:00'}};
  plan['2026-11-01']={sessions:['Match'],match:{opponent:'Y',home:false,kickoff:'15:00'}};
  const out=app.loadOutlook(plan,TODAY);
  assert.deepEqual(plain(out.upcoming.map(u=>[u.date,u.load])),[['2026-10-29',170],['2026-10-30',170],['2026-11-01',170]]);
  assert.ok(out.peak.load>st.acute+100,'the projected 7-day load rises with the planned sessions');
  assert.equal(app.outlookLabel(out.upcoming),'Mannschaftstraining (Do), Spiel (Fr) und Spiel (So)');
  const advice=app.loadAdvice(plan,TODAY,st,null);
  assert.match(advice,/^Du liegst noch unter deinem Bereich, aber mit Mannschaftstraining \(Do\), Spiel \(Fr\) und Spiel \(So\) kommst du auf ≈ \d+/);
  assert.match(advice,/Heute keine Zusatzeinheit\.$/);
  // The day before a game and the day after a game.
  const beforeGame={...plan,'2026-10-29':{sessions:[]}};
  assert.equal(app.loadAdvice(beforeGame,'2026-10-29',app.loadStatus(beforeGame,'2026-10-29'),null),'Morgen ist Spiel. Heute keine Zusatzeinheit, höchstens Mobilität oder Spazieren.');
  const afterGame={...plan,'2026-10-31':{sessions:[]}};
  assert.equal(app.loadAdvice(afterGame,'2026-10-31',app.loadStatus(afterGame,'2026-10-31'),null),'Morgen ist Spiel. Heute keine Zusatzeinheit, höchstens Mobilität oder Spazieren.','Saturday sits between two games: the next game wins');
  const monday={...plan,'2026-11-02':{sessions:[]}};
  assert.equal(app.loadAdvice(monday,'2026-11-02',app.loadStatus(monday,'2026-11-02'),null),'Gestern war Spiel. Heute nur Spazieren oder Mobilität.');
  const ctx=app.buildCoachContext(plan,'Test',TODAY,TODAY);
  assert.equal(ctx.load.outlook.plannedNextDays.length,3);
  assert.equal(ctx.load.outlook.plannedNextDays[1].sessions[0],'Spiel');
  assert.equal(ctx.load.outlook.projectedPeak.load,out.peak.load);
});

test('weekly totals and coach context',()=>{
  const plan=history(6);
  const weeks=app.weeklyLoads(plan,TODAY,6);
  assert.equal(weeks.length,6);
  assert.equal(weeks.at(-1).from,'2026-10-26','current week starts Monday');
  assert.ok(weeks.every(w=>Number.isInteger(w.load)));
  const ctx=app.buildCoachContext(plan,'Test',TODAY,TODAY);
  assert.equal(ctx.load.ready,true);
  assert.deepEqual(plain(ctx.load.optimalRange),[283,460]);
  assert.equal(ctx.load.typicalLoadBySession.Fussball,170);
  assert.equal(ctx.load.last6Weeks.length,6);
  assert.equal(typeof ctx.load.appAdvice,'string');
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/'nutrition','load',/,'server accepts the load block');
  assert.match(coach,/always let low recovery overrule spare load/);
  assert.match(coach,/An extra session today counts in every one of these windows/);
  assert.match(source,/if\(!gLast\|\|gLast\.v!==4\)gFrom=daysBeforeStr\(today,41\)/,'six weeks of activities are loaded once');
});
