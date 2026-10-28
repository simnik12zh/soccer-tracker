import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'))
  +source.slice(source.indexOf('const BF_GOAL ='),source.indexOf('// Minimal responsive SVG line chart'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T08:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({weeklyReportFacts,lastCompletedWeek})',{Date:FixedDate});

test('the report covers the last completed Monday–Sunday week',()=>{
  assert.equal(app.lastCompletedWeek('2026-11-02'),'2026-10-26','on Monday: the week that just ended');
  assert.equal(app.lastCompletedWeek('2026-11-08'),'2026-10-26','on Sunday the current week is not finished');
});

test('week facts are computed exactly from the plan',()=>{
  const g=(type,extra={})=>({id:type+Math.random(),type,matched:true,minutes:60,...extra});
  const plan={
    '2026-10-26':{sessions:['Match'],completed:true,match:{opponent:'Shamrock Football Club',home:true,kickoff:'20:30'},
      garmin:[g('soccer',{distanceKm:8.4,maxSpeedKmh:27.9,load:190})],steps:9000,protein:60,nutrition:'green',
      recovery:{sleepMin:420,hrv:50,restingHr:50}},
    '2026-10-27':{sessions:['Walking'],completed:true,garmin:[g('walking',{load:15})],protein:110,nutrition:'amber',recovery:{sleepMin:480,hrv:54,restingHr:49}},
    '2026-10-28':{sessions:['Gym','Mobility'],completed:true,garmin:[g('strength_training',{load:60})],weight:78.6,bodyFat:15.8,
      meals:[{id:'m1',kcal:700,protein:60},{id:'m2',kcal:900,protein:45}]},
    '2026-10-29':{sessions:['Team Training'],completed:false},
    '2026-10-31':{sessions:['Match'],completed:false,match:{opponent:'FC Ränte',home:false,kickoff:'10:00'}},
    '2026-10-21':{weight:79.0,bodyFat:16.1},'2026-10-20':{recovery:{restingHr:52}},
  };
  const f=app.weeklyReportFacts(plan,'2026-10-26',100);
  assert.equal(f.from,'2026-10-26');assert.equal(f.to,'2026-11-01');
  assert.deepEqual([f.training.plannedDays,f.training.loggedDays],[5,3]);
  assert.deepEqual(plain(f.training.sessions),{Spiel:1,Spazieren:1,Krafttraining:1,'Prävention/Reha':1});
  assert.deepEqual(plain(f.training.goals),[{type:'Krafttraining',done:1,goal:2},{type:'Prävention/Reha',done:1,goal:2}]);
  assert.deepEqual(plain(f.training.games),[{date:'2026-10-26',opponent:'Shamrock Football Club',venue:'Zuhause',played:true},
    {date:'2026-10-31',opponent:'FC Ränte',venue:'Auswärts',played:false}]);
  assert.deepEqual(plain(f.training.watch),{activities:3,minutes:180,footballKm:8.4,topSpeedKmh:27.9});
  assert.equal(f.load.week,265);
  assert.deepEqual(plain(f.body.weight),{value:78.6,readings:1,deltaVsPrevWeek:-0.4});
  assert.deepEqual(plain(f.body.bodyFat),{value:15.8,readings:1,deltaVsPrevWeek:-0.3});
  assert.deepEqual([f.nutrition.proteinHitDays,f.nutrition.avgProtein,f.nutrition.avgKcal,f.nutrition.kcalDays],[2,92,1600,1]);
  assert.deepEqual(plain(f.nutrition.ratings),{green:1,amber:1,red:0});
  assert.deepEqual([f.recovery.nights,f.recovery.avgSleepMin,f.recovery.avgRestingHr,f.recovery.prevAvgRestingHr],[2,450,50,52]);
  assert.deepEqual(plain(f.steps),{avg:9000,days:1});
});

test('the coach writes the report around these numbers, triggered by the Monday push',()=>{
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/'weeklyReport'/,'server accepts the report facts');
  assert.match(coach,/labelled Bilanz, Gut, Besser, Ausblick, Fokus/);
  assert.match(coach,/never blame him for rest taken because of illness, pain or low recovery/);
  assert.match(source,/weeklyReport:\{\.\.\.facts,isLatest:latest\}/);
  assert.match(source,/coach-report-\$\{weekStart\}/,'stored with the coach- prefix so backups include it');
  assert.match(source,/get\("report"\)/,'opening from the push lands on the report');
});
