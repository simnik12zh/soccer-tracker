import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({dayLoad,typicalLoads,loadStatus,plannedLoad,loadAdvice,weeklyLoads,buildCoachContext,daysBeforeStr})',{Date:FixedDate});

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
  // Nothing planned: suggest an easy run when it fits.
  plan[TODAY]={sessions:[]};
  assert.match(app.loadAdvice(plan,TODAY,app.loadStatus(plan,TODAY),null),/lockerer Lauf \(≈ 52\)/);
  // Low recovery overrules spare load.
  assert.match(app.loadAdvice(plan,TODAY,app.loadStatus(plan,TODAY),{level:'low'}),/Erholung ist heute niedrig/);
  // Above the range: no extras.
  plan[TODAY]={sessions:[],garmin:[g('z','soccer',260)]};
  assert.match(app.loadAdvice(plan,TODAY,app.loadStatus(plan,TODAY),null),/über deinem Bereich/);
  assert.match(app.loadAdvice({},TODAY,app.loadStatus({},TODAY),null),/Noch zu wenig Daten/);
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
  assert.match(source,/if\(!gLast\|\|gLast\.v!==4\)gFrom=daysBeforeStr\(today,41\)/,'six weeks of activities are loaded once');
});
