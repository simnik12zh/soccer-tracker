import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {garminHandler,normalizeActivities,normalizeSteps,jwtExpiry} from '../api/_lib/garmin.js';
import {accessDenied} from '../api/_lib/access.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({applyGarminImport,garminSessionType,garminLabel,garminStats,buildCoachContext})',{Date:FixedDate});

const jwt=exp=>'h.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.s';
const NOW=Date.parse('2026-10-28T12:00:00Z');
const garminActivity=(id,typeKey,startTimeLocal,extra={})=>({activityId:id,activityName:'Session '+id,startTimeLocal,activityType:{typeKey,typeId:1,parentTypeId:17},duration:3125.4,calories:410.6,averageHR:131.2,...extra});

// Fake Garmin + Upstash behind one fetch.
function fakeBackend({tokenStatus=200,dataStatus=[],activities=[],steps=[]}={}){
  const calls=[],kv=new Map();let exchanges=0;const statuses=[...dataStatus];
  const fetchImpl=async(url,init={})=>{
    calls.push({url,auth:init.headers?.Authorization});
    if(url==='https://redis.example'){
      const [cmd,key,value]=JSON.parse(init.body);
      if(cmd==='GET')return {ok:true,json:async()=>({result:kv.get(key)??null})};
      if(cmd==='SET'){kv.set(key,value);return {ok:true,json:async()=>({result:'OK'})};}
    }
    if(url.endsWith('/personal-api-key/token')){
      exchanges++;
      return {ok:tokenStatus===200,status:tokenStatus,text:async()=>jwt(NOW/1000+86400)+'\n'};
    }
    const status=statuses.length?statuses.shift():200;
    const body=url.includes('/activitylist-service/')?activities:steps;
    return {ok:status===200,status,text:async()=>JSON.stringify(body)};
  };
  return {fetchImpl,calls,kv,get exchanges(){return exchanges;}};
}
const ENV={APP_ACCESS_CODE:'code-123',GARMIN_PERSONAL_API_KEY:'garmin-key',KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'t'};
async function call(handler,{query={from:'2026-10-20',to:'2026-10-28'},auth='Bearer code-123'}={}){
  const res={code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(o){this.body=o;return this;}};
  await handler({method:'GET',query,headers:{authorization:auth}},res);
  return res;
}

test('access code is required for Garmin data and compared exactly',async()=>{
  assert.equal(accessDenied({headers:{}},{}),false,'no configured code: nothing is refused');
  assert.equal(accessDenied({headers:{authorization:'Bearer code-123'}},ENV),false);
  for(const auth of ['Bearer code-12','Bearer code-1234','code-123','',undefined])
    assert.equal(accessDenied({headers:{authorization:auth}},ENV),true,String(auth));
  const backend=fakeBackend();
  assert.equal((await call(garminHandler({env:{...ENV,APP_ACCESS_CODE:''},fetchImpl:backend.fetchImpl}))).body.error,'access_code_not_configured');
  assert.equal((await call(garminHandler({env:ENV,fetchImpl:backend.fetchImpl}),{auth:'Bearer nope'})).code,401);
  assert.equal((await call(garminHandler({env:{...ENV,GARMIN_PERSONAL_API_KEY:''},fetchImpl:backend.fetchImpl}))).body.error,'garmin_not_configured');
  assert.equal(backend.calls.length,0,'nothing reaches Garmin without access');
});

test('Garmin key is exchanged once, cached in Redis and only the needed fields are returned',async()=>{
  const backend=fakeBackend({
    activities:[garminActivity(11,'strength_training','2026-10-26 18:05:00'),
      garminActivity(12,'soccer','2026-10-26 20:30:00',{averageHR:undefined,distance:8412,maxSpeed:7.75,activityTrainingLoad:186.4,hrTimeInZone_4:900,hrTimeInZone_5:480}),
      garminActivity(14,'soccer','2026-10-27 20:30:00',{maxSpeed:12,hrTimeInZone_5:61}),{activityId:13}],
    steps:[{calendarDate:'2026-10-26',totalSteps:8432,totalDistance:6100,stepGoal:7000},{calendarDate:'2026-10-27',totalSteps:null}],
  });
  const deps={env:ENV,fetchImpl:backend.fetchImpl,now:()=>NOW};
  const res=await call(garminHandler(deps));
  assert.equal(res.code,200);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.deepEqual(res.body.activities[0],{id:'11',date:'2026-10-26',start:'18:05',type:'strength_training',name:'Session 11',minutes:52,calories:411,avgHr:131,
    distanceKm:null,maxSpeedKmh:null,load:null,highHrMin:null});
  const game=res.body.activities[1];
  assert.equal(game.avgHr,null);
  assert.deepEqual([game.distanceKm,game.maxSpeedKmh,game.load,game.highHrMin],[8.4,27.9,186,23]);
  assert.equal(res.body.activities[2].maxSpeedKmh,null,'43 km/h GPS spike discarded');
  assert.equal(res.body.activities[2].highHrMin,1,'zone 5 alone counts');
  assert.equal(res.body.activities.length,3,'malformed activity dropped');
  assert.deepEqual(res.body.steps,[{date:'2026-10-26',steps:8432}]);
  const token=backend.calls.find(c=>c.url.endsWith('/token'));
  assert.equal(token.auth,'ApiKey garmin-key');
  assert.ok(backend.calls.some(c=>c.url.includes('/activitylist-service/activities/search/activities?')&&c.url.includes('startDate=2026-10-20')&&c.url.includes('endDate=2026-10-28')));
  assert.ok(backend.calls.some(c=>c.url.endsWith('/usersummary-service/stats/steps/daily/2026-10-20/2026-10-28')));
  assert.ok(backend.calls.filter(c=>c.url.startsWith('https://personal.connectapi.garmin.com/')&&!c.url.endsWith('/token')).every(c=>c.auth.startsWith('Bearer h.')));
  await call(garminHandler(deps));
  assert.equal(backend.exchanges,1,'second request (new instance) reuses the cached token');
});

test('a rejected token is renewed once; bad keys and ranges give clear errors',async()=>{
  const retry=fakeBackend({dataStatus:[401]});
  assert.equal((await call(garminHandler({env:ENV,fetchImpl:retry.fetchImpl,now:()=>NOW}))).code,200);
  assert.equal(retry.exchanges,2);
  const badKey=fakeBackend({tokenStatus:401});
  assert.deepEqual((await call(garminHandler({env:ENV,fetchImpl:badKey.fetchImpl,now:()=>NOW}))).body,{error:'garmin_key_invalid'});
  const limited=fakeBackend({dataStatus:[429,429]});
  assert.equal((await call(garminHandler({env:ENV,fetchImpl:limited.fetchImpl,now:()=>NOW}))).body.error,'garmin_rate_limited');
  const backend=fakeBackend();
  for(const query of [{from:'2026-09-01',to:'2026-10-28'},{from:'2026-10-28',to:'2026-10-20'},{from:'2026-02-30',to:'2026-03-01'},{}])
    assert.equal((await call(garminHandler({env:ENV,fetchImpl:backend.fetchImpl}),{query})).body.error,'invalid_range',JSON.stringify(query));
  assert.equal(jwtExpiry('not-a-jwt'),null);
  assert.deepEqual(normalizeActivities(null),[]);assert.deepEqual(normalizeSteps({}),[]);
});

test('Garmin activity types map to session types by pattern',()=>{
  const cases={strength_training:'Gym',running:'Easy run',trail_running:'Easy run',treadmill_running:'Easy run',walking:'Walking',casual_walking:'Walking',hiking:'Walking',
    yoga:'Pilates',pilates:'Pilates',soccer:'soccer',mobility:'Mobility',breathwork:'Mobility',cycling:null,indoor_cardio:null,'':null};
  for(const [key,type] of Object.entries(cases))assert.equal(app.garminSessionType(key),type,key);
  assert.equal(app.garminLabel({type:'soccer'}),'Fussball');
  assert.equal(app.garminLabel({type:'cycling',name:'Velo zur Arbeit'}),'Velo zur Arbeit');
});

test('import marks planned days done, fills empty days and never undoes the player',()=>{
  const plan={
    '2026-10-20':{sessions:['Gym','Mobility']},
    '2026-10-21':{sessions:['Team Training'],notes:'keep'},
    '2026-10-22':{sessions:['Gym']},
    '2026-10-23':{sessions:[]},
    '2026-10-24':{sessions:['Match'],match:{opponent:'FC Test',home:true,kickoff:'10:00'}},
    '2026-10-25':{sessions:['Walking'],completed:true,feeling:4},
  };
  const data={activities:[
    {id:'1',date:'2026-10-20',type:'strength_training',minutes:55,avgHr:120},
    {id:'2',date:'2026-10-21',type:'soccer',minutes:90},
    {id:'3',date:'2026-10-22',type:'walking',minutes:40},
    {id:'4',date:'2026-10-23',type:'soccer',minutes:75},
    {id:'5',date:'2026-10-24',type:'soccer',minutes:95},
    {id:'6',date:'2026-10-25',type:'walking',minutes:30},
    {id:'7',date:'2026-10-29',type:'running',minutes:30},
    {id:8,date:'2026-10-26',type:'running'},
  ],steps:[{date:'2026-10-21',steps:9000},{date:'2026-10-29',steps:5},{date:'2026-10-22',steps:-1}]};
  const before=plain(plan),{plan:next,completed}=app.applyGarminImport(plan,data,'2026-10-28');
  assert.deepEqual(plain(plan),before,'input is not mutated');
  assert.deepEqual(plain(completed),['2026-10-20','2026-10-21','2026-10-23','2026-10-24']);
  assert.equal(next['2026-10-20'].completed,true);
  assert.equal(next['2026-10-21'].completed,true);assert.equal(next['2026-10-21'].notes,'keep');
  assert.equal(next['2026-10-22'].completed,undefined,'walk on a gym day does not tick the gym session');
  assert.equal(next['2026-10-22'].garmin[0].matched,false);
  assert.deepEqual(plain(next['2026-10-23'].sessions),['Futsal'],'unplanned football fills an empty day as Freizeitkick');
  assert.equal(next['2026-10-24'].completed,true,'game logged');
  assert.equal(next['2026-10-25'].feeling,4);assert.deepEqual(plain(completed).includes('2026-10-25'),false);
  assert.equal(next['2026-10-29'],undefined,'future activity ignored');
  assert.equal(next['2026-10-26'],undefined,'non-string id ignored');
  assert.equal(next['2026-10-21'].steps,9000);assert.equal(next['2026-10-22'].steps,undefined);
  // Numbers arriving later (or corrected) refresh the stored entry without touching the day.
  const withStats={activities:[{id:'2',date:'2026-10-21',type:'soccer',minutes:90,distanceKm:8.4,maxSpeedKmh:27.9,load:186,highHrMin:23}]};
  const unticked={...next,'2026-10-21':{...next['2026-10-21'],completed:false}};
  const refreshed=app.applyGarminImport(unticked,withStats,'2026-10-28');
  assert.deepEqual(plain(refreshed.completed),[]);
  assert.equal(refreshed.plan['2026-10-21'].completed,false,'refresh never re-ticks');
  assert.equal(refreshed.plan['2026-10-21'].garmin.length,1);
  assert.equal(refreshed.plan['2026-10-21'].garmin[0].load,186);
  assert.equal(app.garminStats(refreshed.plan['2026-10-21'].garmin[0]),'8.4 km · max. 27.9 km/h · Belastung 186 · 23 min intensiv');
  assert.equal(app.applyGarminImport(refreshed.plan,withStats,'2026-10-28').plan['2026-10-21'],refreshed.plan['2026-10-21'],'unchanged numbers: same object');
  // Player removes the auto-log; the next sync with the same activity must not bring it back.
  const edited={...next,'2026-10-20':{...next['2026-10-20'],completed:false}};
  const again=app.applyGarminImport(edited,data,'2026-10-28');
  assert.equal(again.plan['2026-10-20'].completed,false);
  assert.deepEqual(plain(again.completed),[]);
  assert.equal(again.plan['2026-10-20'].garmin.length,1,'listed once');
});

test('coach sees steps and watch activities for past days only',()=>{
  const plan={'2026-10-27':{sessions:['Gym'],completed:true,steps:7000,garmin:[{id:'1',type:'soccer',minutes:50,avgHr:118,distanceKm:6.2,maxSpeedKmh:26.1,load:150,highHrMin:12,matched:true}]},
    '2026-10-29':{sessions:['Gym'],steps:12,garmin:[{id:'2',type:'running',minutes:5,matched:false}]}};
  const ctx=app.buildCoachContext(plan,'Test','2026-10-28','2026-10-28');
  const day=ctx.recentDays.find(d=>d.date==='2026-10-27');
  assert.equal(day.steps,7000);
  assert.deepEqual(plain(day.watchActivities),[{type:'soccer',minutes:50,avgHr:118,distanceKm:6.2,maxSpeedKmh:26.1,trainingLoad:150,highHrMinutes:12,matchedPlan:true}]);
  const future=ctx.upcoming.find(d=>d.date==='2026-10-29');
  assert.equal(future.steps,null);assert.equal(future.watchActivities,null);
  const prompt=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(prompt,/watchActivities lists recorded activities/);
  assert.match(prompt,/maxSpeedKmh is GPS-based/);
  assert.match(prompt,/accessDenied\(req, process\.env\)/);
});
