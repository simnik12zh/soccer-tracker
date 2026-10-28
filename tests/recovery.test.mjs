import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeRecovery,garminHandler} from '../api/_lib/garmin.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({recoveryStatus,applyGarminImport,buildCoachContext,fmtHM})',{Date:FixedDate});

test('sleep, HRV, resting HR and Body Battery are merged per day and checked',()=>{
  const days=normalizeRecovery({
    sleep:[{calendarDate:'2026-10-27',sleepTimeSeconds:26100,sleepScores:{overall:{value:78}}},{dailySleepDTO:{calendarDate:'2026-10-28',sleepTimeSeconds:20400}},
      {calendarDate:'2026-10-26',sleepTimeSeconds:120},{calendarDate:'2026-09-01',sleepTimeSeconds:28000}],
    hrv:{hrvSummaries:[{calendarDate:'2026-10-28',lastNightAvg:39,weeklyAvg:50,status:'UNBALANCED',baseline:{lowUpper:41,balancedLow:46,balancedUpper:60}},
      {calendarDate:'2026-10-27',lastNightAvg:900,status:'balanced lol'}]},
    summaries:{data:[{calendarDate:'2026-10-28',heartRate:{restingValue:55},bodyBattery:{maxValue:44}},{calendarDate:'2026-10-27',heartRate:{restingValue:300}}]},
  },'2026-10-01','2026-10-28');
  assert.deepEqual(days,[
    {date:'2026-10-27',sleepMin:435,sleepScore:78},
    {date:'2026-10-28',sleepMin:340,hrv:39,hrvWeekly:50,hrvStatus:'UNBALANCED',hrvLow:46,hrvHigh:60,hrvFloor:41,restingHr:55,bodyBattery:44},
  ]);
  assert.deepEqual(normalizeRecovery({},'2026-10-01','2026-10-28'),[]);
});

test('a missing recovery source never breaks the Garmin sync',async()=>{
  const fetchImpl=async(url)=>{
    if(url.endsWith('/token'))return {ok:true,status:200,text:async()=>'h.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+86400})).toString('base64url')+'.s'};
    if(url.includes('/hrv-service/'))return {ok:false,status:404,text:async()=>''};
    if(url.includes('/sleep-service/'))return {ok:true,status:204,text:async()=>''};
    if(url.includes('/v2/dailysummaries'))return {ok:true,status:200,text:async()=>JSON.stringify({data:[{calendarDate:'2026-10-27',heartRate:{restingValue:50}}]})};
    return {ok:true,status:200,text:async()=>'[]'};
  };
  const res={code:200,body:null,setHeader(){},status(n){this.code=n;return this;},json(o){this.body=o;return this;}};
  await garminHandler({env:{APP_ACCESS_CODE:'c',GARMIN_PERSONAL_API_KEY:'k'},fetchImpl})({method:'GET',query:{from:'2026-10-20',to:'2026-10-28'},headers:{authorization:'Bearer c'}},res);
  assert.equal(res.code,200);
  assert.deepEqual(res.body.recovery,[{date:'2026-10-27',restingHr:50}]);
});

test('recovery read-out compares with his own baselines',()=>{
  const plan={};
  for(let d=14;d<=27;d++)plan['2026-10-'+d]={recovery:{restingHr:49}};
  plan['2026-10-28']={recovery:{sleepMin:455,hrv:52,hrvLow:46,hrvHigh:60,hrvFloor:41,restingHr:50,bodyBattery:85}};
  assert.equal(app.recoveryStatus(plan,'2026-10-28').level,'good');
  plan['2026-10-28']={recovery:{sleepMin:400,hrv:44,hrvLow:46,hrvHigh:60,hrvFloor:41,restingHr:50,bodyBattery:80}};
  const caution=app.recoveryStatus(plan,'2026-10-28');
  assert.equal(caution.level,'caution','two mild signals');
  assert.deepEqual(plain(caution.signals.map(x=>x.text)),['Schlaf 6:40 h','HRV 44 ms (unter Normalbereich)','Ruhepuls 50','Body Battery 80']);
  plan['2026-10-28']={recovery:{sleepMin:330,hrv:38,hrvLow:46,hrvHigh:60,hrvFloor:41,restingHr:56,bodyBattery:25}};
  const low=app.recoveryStatus(plan,'2026-10-28');
  assert.equal(low.level,'low');
  assert.equal(low.signals.find(x=>x.key==='restingHr').text,'Ruhepuls 56 (+7)');
  assert.equal(app.recoveryStatus({'2026-10-28':{recovery:{hrv:40,hrvStatus:'LOW'}}},'2026-10-28').level,'caution','one low signal alone = caution');
  assert.equal(app.recoveryStatus({'2026-10-28':{recovery:{restingHr:60}}},'2026-10-28').level,'good','no baseline yet: no alarm');
  assert.equal(app.recoveryStatus({},'2026-10-28'),null);
  assert.equal(app.fmtHM(455),'7:35 h');
});

test('recovery is imported per day, and the coach gets values plus the assessment for today',()=>{
  const plan={'2026-10-27':{sessions:['Gym'],completed:true}};
  const {plan:next}=app.applyGarminImport(plan,{recovery:[{date:'2026-10-27',sleepMin:430,hrv:51,hrvStatus:'BALANCED',restingHr:49,bodyBattery:'x'},
    {date:'2026-10-28',sleepMin:340,hrv:39,hrvLow:46,hrvHigh:60,hrvFloor:41,restingHr:55,bodyBattery:28},{date:'2026-10-29',sleepMin:500}]},'2026-10-28');
  assert.deepEqual(plain(next['2026-10-27']),{sessions:['Gym'],completed:true,recovery:{sleepMin:430,hrv:51,restingHr:49,hrvStatus:'BALANCED'}});
  assert.equal(next['2026-10-29'],undefined,'no future data');
  const same=app.applyGarminImport(next,{recovery:[{date:'2026-10-27',sleepMin:430,hrv:51,hrvStatus:'BALANCED',restingHr:49}]},'2026-10-28');
  assert.equal(same.plan['2026-10-27'],next['2026-10-27'],'unchanged values keep the same object');
  const ctx=app.buildCoachContext(next,'Test','2026-10-28','2026-10-28');
  assert.deepEqual(plain(ctx.today.recovery),{sleepMinutes:340,sleepScore:null,hrvMs:39,hrvBalancedRange:[46,60],hrvStatus:null,restingHr:55,bodyBatteryMax:28});
  assert.equal(ctx.today.recoveryAssessment.level,'low');
  assert.ok(ctx.today.recoveryAssessment.signals.some(x=>x.signal==='hrv'&&x.level==='low'));
  assert.equal(ctx.upcoming[0].recovery,null);
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/One poor night is not a trend/);
  assert.match(source,/garminSync:\{at:Date\.now\(\),through:today,v:3\}/,'sync version bumped for the backfill');
});
