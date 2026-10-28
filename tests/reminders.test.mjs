import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {reminderSlot,validSubscription,redisConfig,pushHandler,remindHandler,REMINDER_SLOTS,WEEKLY_SLOT} from '../api/_lib/push.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const APPLE='https://web.push.apple.com/QGZ-device-token';
const sub=(endpoint=APPLE)=>({endpoint,keys:{p256dh:'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',auth:'tBHItJI5svbpez7KI4CCXg'}});
const ENV={KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'token'};

// In-memory stand-in for the Upstash REST API (only the commands the service uses).
function fakeRedis(){
  const kv=new Map(),hashes=new Map(),commands=[];
  const fetchImpl=async(url,init)=>{
    assert.equal(init.headers.Authorization,'Bearer token');
    const [cmd,key,...args]=JSON.parse(init.body);commands.push(cmd);
    const hash=hashes.get(key)||new Map();hashes.set(key,hash);
    let result=null;
    if(cmd==='GET')result=kv.get(key)??null;
    else if(cmd==='SET'){if(!(args.includes('NX')&&kv.has(key))){kv.set(key,args[0]);result='OK';}}
    else if(cmd==='HSET'){hash.set(args[0],args[1]);result=1;}
    else if(cmd==='HGETALL')result=[...hash].flat();
    else if(cmd==='HDEL')result=hash.delete(args[0])?1:0;
    else throw new Error('unexpected '+cmd);
    return {ok:true,json:async()=>({result})};
  };
  return {fetchImpl,kv,hashes,commands};
}
function fakePush(){
  const sent=[];let generated=0;
  return {sent,get generated(){return generated;},
    generateVAPIDKeys:()=>({publicKey:'PUB'+(++generated),privateKey:'PRIV'+generated}),
    sendNotification:async(subscription,payload,options)=>{
      sent.push({endpoint:subscription.endpoint,payload:JSON.parse(payload),options});
      if(subscription.endpoint.includes('gone'))throw Object.assign(new Error('gone'),{statusCode:410});
    }};
}
function response(){
  return {code:200,body:null,status(n){this.code=n;return this;},json(obj){this.body=obj;return this;}};
}
const call=async(handler,req)=>{const res=response();await handler({headers:{host:'soccer.example'},...req},res);return res;};

test('reminder slots hit 12 and 21 Uhr Zurich time in summer and winter',()=>{
  assert.deepEqual(plain(reminderSlot(new Date('2026-10-26T11:30:00Z'))),{date:'2026-10-26',hour:12,slot:'midday'},'winter: UTC+1');
  assert.deepEqual(plain(reminderSlot(new Date('2026-07-01T10:30:00Z'))),{date:'2026-07-01',hour:12,slot:'midday'},'summer: UTC+2');
  assert.equal(reminderSlot(new Date('2026-10-26T10:30:00Z')),null,'11:30 in winter is skipped');
  assert.equal(reminderSlot(new Date('2026-10-26T20:15:00Z')).slot,'evening');
  assert.equal(reminderSlot(new Date('2026-07-01T19:59:00Z')).slot,'evening');
  assert.equal(reminderSlot(new Date('2026-07-01T20:30:00Z')),null,'22:30 is skipped');
  const crons=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8')).crons;
  const parsed=crons.map(c=>{assert.equal(c.path,'/api/remind');const [m,h,dom,mon,dow]=c.schedule.split(' ');
    assert.deepEqual([m,dom,mon],['0','*','*']);assert.ok(dow==='*'||dow==='1','at most once a day (Hobby plan)');return {hour:Number(h),dow};});
  const daily=parsed.filter(c=>c.dow==='*').map(c=>c.hour),weekly=parsed.filter(c=>c.dow==='1').map(c=>c.hour);
  for(const target of Object.keys(REMINDER_SLOTS).map(Number))
    for(const offset of [1,2])assert.ok(daily.includes(target-offset),`hour ${target} reachable at UTC+${offset}`);
  for(const offset of [1,2])assert.ok(weekly.includes(WEEKLY_SLOT.hour-offset),`Monday ${WEEKLY_SLOT.hour} Uhr reachable at UTC+${offset}`);
  assert.equal(reminderSlot(new Date('2026-11-02T06:20:00Z')).slot,'weekly','Monday 07:20 in winter');
  assert.equal(reminderSlot(new Date('2026-06-29T05:20:00Z')).slot,'weekly','Monday 07:20 in summer');
  assert.equal(reminderSlot(new Date('2026-11-03T06:20:00Z')),null,'Tuesday 07:20 is not a slot');
});

test('only real push services are accepted as endpoints',()=>{
  assert.equal(validSubscription(sub()),true);
  assert.equal(validSubscription(sub('https://fcm.googleapis.com/fcm/send/abc')),true);
  for(const bad of ['http://web.push.apple.com/x','https://evil.example/x','https://web.push.apple.com.evil.example/x','https://169.254.169.254/latest','not a url'])
    assert.equal(validSubscription(sub(bad)),false,bad);
  assert.equal(validSubscription({endpoint:APPLE,keys:{p256dh:'x'}}),false);
  assert.equal(validSubscription(null),false);
  assert.deepEqual(redisConfig({UPSTASH_REDIS_REST_URL:'u',UPSTASH_REDIS_REST_TOKEN:'t'}),{url:'u',token:'t'});
  assert.equal(redisConfig({}),null);
});

test('push endpoint works without storage, then keeps one generated key',async()=>{
  const off=pushHandler({env:{}});
  assert.deepEqual((await call(off,{method:'GET'})).body,{configured:false});
  assert.equal((await call(off,{method:'POST',body:{action:'subscribe',subscription:sub()}})).code,503);
  const redis=fakeRedis(),push=fakePush(),handler=pushHandler({env:ENV,fetchImpl:redis.fetchImpl,push});
  const first=(await call(handler,{method:'GET'})).body,second=(await call(handler,{method:'GET'})).body;
  assert.deepEqual(first,{configured:true,publicKey:'PUB1'});
  assert.deepEqual(second,first,'key generated once and reused');
  assert.equal(push.generated,1);
});

test('subscriptions are validated, capped at five and removable',async()=>{
  const redis=fakeRedis(),push=fakePush(),handler=pushHandler({env:ENV,fetchImpl:redis.fetchImpl,push});
  assert.equal((await call(handler,{method:'POST',body:{action:'subscribe',subscription:sub('https://evil.example/x')}})).code,400);
  for(let i=0;i<7;i++){
    const res=await call(handler,{method:'POST',body:JSON.stringify({action:'subscribe',subscription:sub(APPLE+i)})});
    assert.equal(res.code,200);
    await new Promise(r=>setTimeout(r,2));
  }
  const stored=[...redis.hashes.get('push:subs').values()].map(v=>JSON.parse(v).subscription.endpoint);
  assert.equal(stored.length,5);
  assert.ok(stored.includes(APPLE+6)&&!stored.includes(APPLE+0),'newest five kept');
  assert.equal((await call(handler,{method:'POST',body:{action:'unsubscribe',endpoint:APPLE+6}})).code,200);
  assert.equal(redis.hashes.get('push:subs').size,4);
  assert.equal((await call(handler,{method:'POST',body:{action:'nope',endpoint:APPLE}})).code,400);
});

test('test push reaches only the asking device and is rate limited',async()=>{
  const redis=fakeRedis(),push=fakePush(),handler=pushHandler({env:ENV,fetchImpl:redis.fetchImpl,push});
  await call(handler,{method:'POST',body:{action:'subscribe',subscription:sub(APPLE+'a')}});
  await call(handler,{method:'POST',body:{action:'subscribe',subscription:sub(APPLE+'b')}});
  assert.equal((await call(handler,{method:'POST',body:{action:'test',endpoint:APPLE+'a'}})).code,200);
  assert.deepEqual(push.sent.map(s=>s.endpoint),[APPLE+'a']);
  assert.deepEqual(push.sent[0].payload,{slot:'test'});
  assert.equal(push.sent[0].options.vapidDetails.subject,'https://soccer.example');
  assert.equal((await call(handler,{method:'POST',body:{action:'test',endpoint:APPLE+'a'}})).code,429);
  assert.equal((await call(handler,{method:'POST',body:{action:'test',endpoint:APPLE+'unknown'}})).code,404);
});

test('cron sends once per slot and day, removes expired devices and carries no personal data',async()=>{
  const redis=fakeRedis(),push=fakePush(),deps={env:{...ENV,CRON_SECRET:'s3cret'},fetchImpl:redis.fetchImpl,push};
  const subscribe=pushHandler(deps);
  await call(subscribe,{method:'POST',body:{action:'subscribe',subscription:sub(APPLE)}});
  await call(subscribe,{method:'POST',body:{action:'subscribe',subscription:sub('https://web.push.apple.com/gone')}});
  const noon=remindHandler({...deps,now:()=>new Date('2026-10-26T11:20:00Z')});
  assert.equal((await call(noon,{method:'GET',headers:{authorization:'Bearer wrong'}})).code,401);
  const auth={authorization:'Bearer s3cret',host:'soccer.example'};
  const first=await call(noon,{method:'GET',headers:auth});
  assert.deepEqual({...first.body,results:[...first.body.results].sort()},{slot:'midday',date:'2026-10-26',results:['expired','sent']});
  assert.deepEqual(push.sent.map(s=>s.payload),[{slot:'midday',date:'2026-10-26'},{slot:'midday',date:'2026-10-26'}]);
  assert.equal(redis.hashes.get('push:subs').size,1,'410 removes the dead subscription');
  assert.deepEqual((await call(noon,{method:'GET',headers:auth})).body,{skipped:'already_sent'},'duplicate cron delivery');
  const early=remindHandler({...deps,now:()=>new Date('2026-10-26T10:20:00Z')});
  assert.deepEqual((await call(early,{method:'GET',headers:auth})).body,{skipped:'outside_window'});
  const unconfigured=remindHandler({env:{},now:()=>new Date('2026-10-26T20:20:00Z')});
  assert.deepEqual((await call(unconfigured,{method:'GET'})).body,{skipped:'not_configured'});
});

test('service worker text names what is open and is gentler at midday',()=>{
  const listeners={};
  const ctx={self:{addEventListener:(type,fn)=>{listeners[type]=fn;},clients:{},registration:{}},caches:{}};
  vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),ctx);
  const text=(slot,open)=>plain(ctx.reminderText(slot,open?{days:{'2026-10-26':{open}}}:null,'2026-10-26'));
  assert.deepEqual(text('evening',['Training','36 g Protein','Ernährung bewerten']),{title:'Tagesabschluss',body:'Noch offen: Training · 36 g Protein · Ernährung bewerten'});
  assert.deepEqual(text('midday',['Training','Ernährung bewerten']),{title:'Zwischenstand',body:'Noch offen: Training'});
  assert.equal(text('midday',['Ernährung bewerten']).body,'Gut unterwegs. Am Abend noch die Ernährung bewerten.');
  assert.equal(text('evening',[]).body,'Alles eingetragen. Stark.');
  assert.equal(text('evening',null).body,'Trag Training, Protein und Ernährung ein.','no snapshot yet');
  assert.match(text('test',[]).title,/Test/);
  assert.deepEqual(plain(ctx.reminderText('weekly',null,'2026-11-02')),{title:'Dein Wochenreport ist da',body:'Was lief, was fehlt und der Fokus für die neue Woche.',url:'/?report=latest'});
  assert.ok(listeners.push&&listeners.notificationclick);
  assert.equal(listeners.fetch,undefined,'no fetch handler: the app is never served from a stale cache');
});

test('app writes a two-week reminder snapshot using the open-items logic',()=>{
  const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'));
  const {reminderStatus}=vm.runInNewContext(helpers+'\n({reminderStatus})',{Date});
  const plan={'2026-10-26':{sessions:['Gym'],protein:64,nutrition:'green'},'2026-10-27':{sessions:['Walking'],completed:true,protein:120,nutrition:'amber'}};
  const status=reminderStatus(plan,'2026-10-26',100);
  assert.equal(Object.keys(status.days).length,16);
  assert.ok(status.days['2026-10-25']&&status.days['2026-11-09']);
  assert.deepEqual(plain(status.days['2026-10-26'].open),['Training','36 g Protein']);
  assert.deepEqual(plain(status.days['2026-10-27'].open),[],'future days are evaluated as of that day');
  assert.deepEqual(plain(status.days['2026-10-28'].open),['Protein','Ernährung bewerten']);
  assert.match(source,/writeReminderStatus\(reminderStatus\(plan,todayStr\(\),proteinTarget\)\)/);
  const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  for(const name of ['soccer-status','/__reminder-status'])assert.ok(source.includes(name)&&sw.includes(name),name+' shared by app and worker');
});
