import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-04T08:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({goalPath,pathLine,weeklyTrends,buildCoachContext,daysBeforeStr})',{Date:FixedDate});
const next=(dk,n=1)=>app.daysBeforeStr(dk,-n);

// One reading a day from `from` to `to`; value(date) gives the body fat.
function readings(from,to,value,plan={}) {
  for(let d=from;d<=to;d=next(d))plan[d]={...plan[d],weight:83,bodyFat:value(d),bodySource:'withings'};
  return plan;
}

test('no goal path before the new scale or without its readings',()=>{
  const old=readings('2026-09-01','2026-10-04',()=>16.7);
  assert.equal(app.goalPath(old,'2026-10-20'),null);
  assert.equal(app.goalPath(old,'2026-11-04'),null,'only old-scale values: nothing to start from');
});

test('start phase: the first 14 days on the new scale, at least 10 readings',()=>{
  const plan=readings('2026-10-27','2026-11-04',()=>14.4,readings('2026-09-01','2026-10-04',()=>16.7));
  const gp=app.goalPath(plan,'2026-11-04');
  assert.equal(gp.phase,'start');
  assert.deepEqual([gp.first,gp.day,gp.readings,gp.readyOn],['2026-10-27',9,9,'2026-11-09']);
  assert.deepEqual(plain(gp.days.slice(7,10)),[{date:'2026-11-03',weighed:true},{date:'2026-11-04',weighed:true},{date:'2026-11-05',weighed:false}]);
  assert.deepEqual(plain(app.pathLine(gp)),{text:'Start 9/14'});
  // Every other day: 5 readings by 4 Nov and 5 days left still make 10; 4 would not.
  const gaps=readings('2026-10-27','2026-11-04',()=>14.4);
  for(const d of ['2026-10-28','2026-10-30','2026-11-01','2026-11-03'])delete gaps[d];
  assert.equal(app.goalPath(gaps,'2026-11-04').readyOn,'2026-11-09');
  delete gaps['2026-11-04'];
  assert.equal(app.goalPath(gaps,'2026-11-04').readyOn,null);
  // After 14 days with too few readings the window grows until there are 10.
  const late=app.goalPath(gaps,'2026-11-12');
  assert.deepEqual([late.phase,late.day,late.readings],['start',14,4]);
  assert.deepEqual(plain(app.pathLine(late)),{text:'Start: 6 fehlen'});
});

test('path: from the start value −0.5 points a month to the end of June 2027',()=>{
  const plan=readings('2026-10-27','2026-11-09',()=>14.4);
  const gp=app.goalPath(plan,'2026-11-09');
  assert.deepEqual(plain(gp),{phase:'path',start:14.4,startDate:'2026-11-09',end:10.6,endDate:'2027-06-30',
    planNow:14.4,current:14.4,deviation:0,anchor:'2026-11-09',status:'onTrack'});
  assert.deepEqual(plain(app.pathLine(gp)),{text:'auf Kurs ✓'});
  assert.equal(Math.round(gp.at('2027-12-31')*10)/10,10.6,'the path stops at its end');
  // Standing still for five weeks puts him behind the plan.
  readings('2026-11-10','2026-12-15',()=>14.4,plan);
  const behind=app.goalPath(plan,'2026-12-15');
  assert.deepEqual([behind.planNow,behind.current,behind.deviation,behind.status],[13.8,14.4,0.6,'behind']);
  assert.deepEqual(plain(app.pathLine(behind)),{text:'0.6 über Plan',warn:true});
  readings('2026-12-09','2026-12-15',()=>13.2,plan);
  assert.equal(app.goalPath(plan,'2026-12-15').status,'ahead');
  readings('2026-12-09','2026-12-15',()=>14.0,plan);
  assert.equal(app.goalPath(plan,'2026-12-15').status,'onTrack','within 0.3 of the plan');
});

test('festive days: at most +0.5 points against the week before',()=>{
  const plan=readings('2026-10-27','2026-12-19',d=>d<'2026-11-10'?14.4:14.0);
  readings('2026-12-20','2027-01-03',()=>14.3,plan);
  const ok=app.goalPath(plan,'2027-01-03');
  assert.deepEqual([ok.status,plain(ok.festive)],['festive',{base:14,gain:0.3,allowed:0.5}]);
  assert.deepEqual(plain(app.pathLine(ok)),{text:'Festtage +0.3',warn:false});
  readings('2026-12-28','2027-01-03',()=>14.7,plan);
  assert.equal(app.goalPath(plan,'2027-01-03').status,'festiveOver');
  readings('2027-01-04','2027-01-12',()=>14.5,plan);
  assert.equal(app.goalPath(plan,'2027-01-12').status,'behind','after 6 Jan the plan counts again');
});

test('weekly trends and the coach keep the two scales apart',()=>{
  const plan=readings('2026-10-01','2026-10-04',()=>16.7);
  readings('2026-10-27','2026-11-04',()=>14.4,plan);
  const weeks0=app.weeklyTrends(plan,'2026-11-04');
  plan['2026-10-25']={weight:84,bodyFat:16.9,bodySource:'manual'};  // a late old-scale value
  const weeks=app.weeklyTrends(plan,'2026-11-04');
  const byFrom=Object.fromEntries(weeks.map(w=>[w.from,w]));
  assert.deepEqual([byFrom['2026-09-28'].bodyFatPct,byFrom['2026-09-28'].scale],[16.7,'old']);
  assert.deepEqual([byFrom['2026-10-26'].bodyFatPct,byFrom['2026-10-26'].scale],[14.4,'new']);
  assert.deepEqual([byFrom['2026-10-19'].bodyFatPct,byFrom['2026-10-19'].scale],[16.9,'old'],'its own week, its own scale');
  assert.equal(weeks0.length,weeks.length);
  assert.equal(byFrom['2026-10-12'].scale,undefined,'no values, no scale');
  const ctx=app.buildCoachContext(plan,'Test','2026-11-04','2026-11-04');
  assert.deepEqual(plain(ctx.bodyGoal),{scale:{newScaleSince:'2026-10-27',oldScaleLastReading:'2026-10-25'},
    goalPath:{phase:'start',day:9,of:14,readings:9,minReadings:10,startValueOn:'2026-11-09'}});
  assert.deepEqual(plain(ctx.body.bodyFat.previous7Days),{from:'2026-10-22',to:'2026-10-28',count:2,value:14.4},'27 and 28 Oct; 25 Oct is the old scale');
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/'trends','bodyGoal','steps'/,'the server passes the goal on');
});
