import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T22:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({weighIns,bodyTempo,stepsWeek,buildCoachContext,daysBeforeStr})',{Date:FixedDate});
const TODAY='2026-11-02',LATER='2027-02-15';  // LATER: five weeks and more on the new scale (from 27 Oct 2026)
const day=n=>app.daysBeforeStr(TODAY,n),later=n=>app.daysBeforeStr(LATER,n);

// Daily scale readings for `days` days up to `end`, the weight moving `perMonth` kg a month.
function scale(days,perMonth,{bodyFat=15,source='withings',skip=()=>false,end=TODAY}={}) {
  const plan={};
  for(let i=days-1;i>=0;i--){
    if(skip(i))continue;
    plan[app.daysBeforeStr(end,i)]={weight:Math.round((80+perMonth*(-i)/30.44)*1000)/1000,bodyFat,bodySource:source};
  }
  return plan;
}

test('weigh-ins: quiet while he weighs three times a week or more, loud below',()=>{
  assert.deepEqual(plain(app.weighIns({},TODAY)),{count:0,known:false,low:false},'no scale yet: nothing to warn about');
  const regular=scale(30,0,{skip:i=>i%2===1});
  assert.deepEqual(plain(app.weighIns(regular,TODAY)),{count:4,known:true,low:false});
  const fading=scale(30,0,{skip:i=>i<12&&i!==2&&i!==6});
  assert.deepEqual(plain(app.weighIns(fading,TODAY)),{count:2,known:true,low:true});
  const gone=scale(30,0,{skip:i=>i<9});
  assert.deepEqual(plain(app.weighIns(gone,TODAY)),{count:0,known:true,low:true},'a long gap stays a warning');
});

test('tempo: weight per month over four weeks decides, with the fat and lean split',()=>{
  const tempo=(perMonth,o={})=>app.bodyTempo(scale(40,perMonth,{...o,end:LATER}),LATER);
  assert.deepEqual(plain(tempo(-0.5)),{ready:true,from:later(28),to:LATER,rate:-0.5,status:'good',weight:80,change:-0.5,fat:-0.1,lean:-0.4});
  assert.equal(tempo(-1.2).status,'fast','faster than 0.8 kg a month');
  assert.equal(tempo(-0.8).status,'good','0.8 itself is still within the plan');
  assert.equal(tempo(0.1).status,'flat');
  assert.equal(tempo(0.5).status,'up','a rising weight is the start of a rebound');
  const noFat=scale(40,-0.5,{end:LATER});for(const k of Object.keys(noFat))delete noFat[k].bodyFat;
  assert.equal(app.bodyTempo(noFat,LATER).fat,null,'without body fat there is no split');
});

test('tempo: never mixes two scales and needs three readings in both weeks',()=>{
  // The old scale (until 4 Oct) read higher; the new one starts on 27 Oct: by 20 Nov it has
  // no week four weeks back yet, whatever the import source says.
  const plan={...scale(46,-0.5,{bodyFat:16.7,source:'manual',end:'2026-10-04'}),...scale(25,-0.5,{bodyFat:14.4,end:'2026-11-20'})};
  assert.deepEqual(plain(app.bodyTempo(plan,'2026-11-20')),{ready:false,reason:'history',since:'2026-10-27'});
  const sparse=scale(40,-0.5,{skip:i=>i<7&&i!==0&&i!==3,end:LATER});
  assert.deepEqual(plain(app.bodyTempo(sparse,LATER)),{ready:false,reason:'few',since:later(39)});
  assert.equal(app.bodyTempo({},TODAY),null);
});

test('steps: a 7-day mean, so busy days make up for quiet ones',()=>{
  const plan={};
  [13000,13000,13000,13000,13000,8000].forEach((v,i)=>{plan[day(6-i)]={steps:v};});
  const busy=app.stepsWeek(plan,TODAY,TODAY);
  assert.equal('needToday' in busy,false,'where he stands, not what is still missing');
  assert.equal(busy.avg,10429,'today counts with 0 steps so far');
  const quiet={};
  for(let i=1;i<=6;i++)quiet[day(i)]={steps:9000};
  quiet[TODAY]={steps:2000};
  assert.deepEqual(plain(app.stepsWeek(quiet,TODAY,TODAY)),{days:[...Array.from({length:6},(_,i)=>({date:day(6-i),steps:9000})),{date:TODAY,steps:2000}],
    avg:8000,daysWithData:7,goal:10000});
  const past=app.stepsWeek(quiet,day(1),TODAY);
  assert.equal(past.daysWithData,6,'days without watch data do not count');
  assert.equal(app.stepsWeek({},TODAY,TODAY),null);
  assert.equal(app.stepsWeek({[TODAY]:{steps:0}},TODAY,TODAY),null,'no watch data yet');
});

test('the coach gets weigh-ins, tempo, steps and his own background',()=>{
  const plan=scale(40,-1.2,{skip:i=>i<7&&i!==0&&i!==3&&i!==5,end:LATER});
  for(let i=0;i<7;i++)plan[later(i)]={...plan[later(i)],steps:11000};
  const ctx=app.buildCoachContext(plan,'Test',LATER,LATER,150,[],null,{background:'  Cuts über Bewegung, Rebounds über das Essen.  '});
  assert.equal(ctx.body.weighInsLast7Days,3);
  assert.deepEqual(plain(ctx.body.tempo),{weightKgPerMonth:-1.2,status:'fast',from:later(28),to:LATER,weightChangeKg:-1.1,fatMassChangeKg:-0.2,leanMassChangeKg:-0.9});
  assert.deepEqual(plain(ctx.steps),{last7DaysAverage:11000,daysWithData:7,goalAverage:10000});
  assert.equal(ctx.athleteHistory,'Cuts über Bewegung, Rebounds über das Essen.');
  assert.equal('athleteHistory' in app.buildCoachContext(plan,'Test',LATER,LATER),false,'no background, no key');
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/'steps','athleteHistory','sessionReviews'/,'the server passes both on');
});
