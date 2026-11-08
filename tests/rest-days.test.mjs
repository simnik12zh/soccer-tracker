import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-08T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({restDay,restDayText,fmtSteps,migrateRestDays,applyGarminImport,planWeekInput,ALTS,PLAN_SESSIONS,REST_STEPS})',{Date:FixedDate});
const TODAY='2026-11-08';

test('a rest day has no training but a step goal of 7000, decided by the watch',()=>{
  assert.equal(app.REST_STEPS,7000);
  assert.equal(app.restDay({sessions:['Gym']},TODAY,TODAY),null,'training days have no step goal');
  assert.equal(app.restDay({sessions:['Sick/Injured']},TODAY,TODAY),null,'sick days neither');
  const future=app.restDay({sessions:[]},'2026-11-10',TODAY);
  assert.deepEqual(plain(future),{goal:7000,steps:null,met:false,future:true});
  assert.equal(app.restDayText(future),'mind. '+app.fmtSteps(7000)+' Schritte');
  const open=app.restDay({sessions:[],steps:3200},TODAY,TODAY);
  assert.deepEqual([open.steps,open.met],[3200,false]);
  assert.equal(app.restDayText(open),app.fmtSteps(3200)+' von '+app.fmtSteps(7000)+' Schritten');
  const done=app.restDay({steps:8100},'2026-11-06',TODAY);
  assert.equal(done.met,true,'a day without any entry is a rest day too');
  assert.equal(app.restDayText(done),app.fmtSteps(8100)+' Schritte ✓');
  assert.equal(app.restDay(undefined,'2026-11-07',TODAY).steps,null,'no watch data, no count');
});

test('stored walking days become rest days once, logged days keep their history',()=>{
  const data={plan:{
    '2026-11-09':{sessions:['Walking'],coaching:{sessions:['Walking'],title:'Locker bewegen',text:'Entspannt spazieren.'}},
    '2026-11-10':{sessions:['Walking','Mobility'],coaching:{sessions:['Walking','Mobility'],title:'Sanft',text:'Eigener Hinweis'}},
    '2026-11-11':{workout:'Walking'},
    '2026-11-12':{sessions:[],coaching:{sessions:[],title:'Trainingsfrei',text:'Erholung ist heute der Plan.'}},
    '2026-11-02':{sessions:['Walking'],completed:true,feeling:4},
    '2026-11-13':{sessions:['Gym']},
  },playerName:'Test'};
  const out=app.migrateRestDays(data);
  assert.equal(out.restDaysVersion,1);
  assert.deepEqual(plain(out.plan['2026-11-09'].sessions),[]);
  assert.equal(out.plan['2026-11-09'].coaching.title,'Locker bewegen');
  assert.match(out.plan['2026-11-09'].coaching.text,/7'000 Schritte/,'the old walking guidance gets the step goal');
  assert.deepEqual(plain(out.plan['2026-11-10'].sessions),['Mobility']);
  assert.deepEqual(plain(out.plan['2026-11-10'].coaching),{sessions:['Mobility'],title:'Sanft',text:'Eigener Hinweis'},'own guidance stays');
  assert.deepEqual([plain(out.plan['2026-11-11'].sessions),out.plan['2026-11-11'].workout],[[],''],'legacy workout field');
  assert.match(out.plan['2026-11-12'].coaching.text,/mindestens 7'000 Schritte/,'rest guidance gets the step goal');
  assert.equal(out.plan['2026-11-02'],data.plan['2026-11-02'],'a logged walk is history');
  assert.equal(out.plan['2026-11-13'],data.plan['2026-11-13']);
  assert.deepEqual(plain(data.plan['2026-11-09'].sessions),['Walking'],'input is not mutated');
  assert.equal(app.migrateRestDays(out),out,'runs once');
});

test('a recorded walk counts through the steps, it never ticks or fills a day',()=>{
  const plan={'2026-11-06':{sessions:[]},'2026-11-07':{sessions:['Gym']}};
  const {plan:next,completed}=app.applyGarminImport(plan,{activities:[
    {id:'w1',date:'2026-11-06',type:'walking',minutes:35},
    {id:'w2',date:'2026-11-07',type:'hiking',minutes:90},
  ],steps:[{date:'2026-11-06',steps:8400}]},TODAY);
  assert.deepEqual(plain(completed),[]);
  assert.deepEqual(plain(next['2026-11-06'].sessions),[],'still a rest day');
  assert.equal(next['2026-11-06'].completed,undefined);
  assert.equal(next['2026-11-06'].garmin[0].matched,false);
  assert.equal(app.restDay(next['2026-11-06'],'2026-11-06',TODAY).met,true);
  assert.equal(next['2026-11-07'].completed,undefined,'a hike does not tick off the gym');
});

test('walking can no longer be picked or planned',()=>{
  assert.ok(!app.ALTS.some(a=>a.label==='Walking'));
  assert.ok(!app.PLAN_SESSIONS.includes('Walking'));
  const input=app.planWeekInput({'2026-11-10':{sessions:['Walking']},'2026-11-03':{sessions:['Walking'],completed:true}},'2026-11-09','2026-11-08');
  const day=input.days.find(d=>d.date==='2026-11-10');
  assert.deepEqual([plain(day.sessions),day.fixed],[[],false],'an old open walking day is an open rest day');
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/status rest \(no sessions\) is a rest day: no training, but at least 7,000 easy steps/);
});
