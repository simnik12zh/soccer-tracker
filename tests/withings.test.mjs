import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeMeasures,withingsHandler,withingsCallbackHandler,zurichDate} from '../api/_lib/withings.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({applyWithingsImport})',{Date:FixedDate});

const ENV={APP_ACCESS_CODE:'code-123',WITHINGS_CLIENT_ID:'cid',WITHINGS_CLIENT_SECRET:'csecret',KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'t'};
const NOW=Date.parse('2026-10-28T11:00:00Z');
const unix=iso=>Date.parse(iso)/1000;
const grp=(iso,weight,fat,extra={})=>({grpid:Math.random(),date:unix(iso),category:1,measures:[
  ...(weight!=null?[{value:Math.round(weight*100),type:1,unit:-2}]:[]),...(fat!=null?[{value:Math.round(fat*10),type:6,unit:-1}]:[])],...extra});

// Fake Upstash + Withings behind one fetch.
function backend({pages=[{status:0,body:{measuregrps:[]}}],refreshStatus=0}={}){
  const kv=new Map(),calls=[];let measureCall=0,tokenNo=0;
  const fetchImpl=async(url,init={})=>{
    if(url==='https://redis.example'){
      const [cmd,key,value,...args]=JSON.parse(init.body);calls.push({redis:cmd,key,args});
      let result=null;
      if(cmd==='GET')result=kv.get(key)??null;
      else if(cmd==='SET'){kv.set(key,value);result='OK';}
      else if(cmd==='GETDEL'){result=kv.get(key)??null;kv.delete(key);}
      else if(cmd==='DEL'){result=kv.delete(key)?1:0;}
      return {ok:true,json:async()=>({result})};
    }
    const params=Object.fromEntries(new URLSearchParams(init.body));
    calls.push({url,params,auth:init.headers?.Authorization});
    if(url==='https://wbsapi.withings.net/v2/oauth2'){
      if(params.grant_type==='refresh_token'&&refreshStatus!==0)return {ok:true,json:async()=>({status:refreshStatus})};
      tokenNo++;
      return {ok:true,json:async()=>({status:0,body:{userid:'42',access_token:'access-'+tokenNo,refresh_token:'refresh-'+tokenNo,expires_in:10800,scope:'user.metrics',token_type:'Bearer'}})};
    }
    if(url==='https://wbsapi.withings.net/measure'){
      const page=pages[Math.min(measureCall++,pages.length-1)];
      return {ok:true,json:async()=>page};
    }
    throw new Error('unexpected '+url);
  };
  return {fetchImpl,kv,calls,get tokenRequests(){return calls.filter(c=>c.url?.endsWith('/v2/oauth2'));},get measureRequests(){return calls.filter(c=>c.url?.endsWith('/measure'));}};
}
const res=()=>({code:200,statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(o){this.body=o;return this;},end(){this.ended=true;}});
async function call(handler,{method='GET',query={from:'2026-10-01',to:'2026-10-28'},body,auth='Bearer code-123',host='soccer.example'}={}){
  const r=res();await handler({method,query,body,headers:{authorization:auth,host}},r);return r;
}
const connected=(b,expiresAt=NOW/1000+3600)=>b.kv.set('withings:tokens',JSON.stringify({access_token:'access-0',refresh_token:'refresh-0',expires_at:expiresAt,userid:'42'}));

test('scale groups become one morning reading per Zurich day',()=>{
  assert.equal(zurichDate(unix('2026-10-25T23:30:00Z')),'2026-10-26','after the DST change, 00:30 local is the next day');
  const days=normalizeMeasures([
    grp('2026-10-20T05:40:00Z',78.64,15.83),
    grp('2026-10-20T18:00:00Z',79.9,16.4),
    grp('2026-10-21T06:00:00Z',78.2,null),
    grp('2026-10-21T06:01:00Z',null,15.6),
    grp('2026-10-22T06:00:00Z',78,15,{category:2}),
    grp('2026-10-23T06:00:00Z',4,1),
    grp('2026-09-01T06:00:00Z',80,17),
  ],'2026-10-01','2026-10-28');
  assert.deepEqual(days,[
    {date:'2026-10-20',weight:78.6,bodyFat:15.8},
    {date:'2026-10-21',weight:78.2,bodyFat:15.6},
  ]);
  assert.deepEqual(normalizeMeasures(null,'2026-10-01','2026-10-28'),[]);
});

test('every Withings route needs the access code, storage and app credentials',async()=>{
  const b=backend();
  assert.equal((await call(withingsHandler({env:{...ENV,APP_ACCESS_CODE:''},fetchImpl:b.fetchImpl}))).body.error,'access_code_not_configured');
  assert.equal((await call(withingsHandler({env:ENV,fetchImpl:b.fetchImpl}),{auth:'Bearer nope'})).code,401);
  assert.equal((await call(withingsHandler({env:{...ENV,KV_REST_API_URL:''},fetchImpl:b.fetchImpl}))).body.error,'storage_not_configured');
  assert.equal((await call(withingsHandler({env:{...ENV,WITHINGS_CLIENT_SECRET:''},fetchImpl:b.fetchImpl}))).body.error,'withings_not_configured');
  assert.equal(b.calls.length,0);
});

test('connect hands out a one-time state; the callback exchanges the code once',async()=>{
  const b=backend(),deps={env:ENV,fetchImpl:b.fetchImpl,now:()=>NOW};
  const started=await call(withingsHandler(deps),{method:'POST',body:{action:'connect'}});
  const url=new URL(started.body.url);
  assert.equal(url.origin+url.pathname,'https://account.withings.com/oauth2_user/authorize2');
  assert.equal(url.searchParams.get('client_id'),'cid');
  assert.equal(url.searchParams.get('scope'),'user.metrics');
  assert.equal(url.searchParams.get('redirect_uri'),'https://soccer.example/api/withings-callback');
  const state=url.searchParams.get('state');
  assert.equal(b.kv.get('withings:state:'+state),'https://soccer.example/api/withings-callback');
  assert.ok(b.calls.some(c=>c.redis==='SET'&&c.key==='withings:state:'+state&&c.args.join()==='EX,600'),'state expires after 10 minutes');

  const callback=withingsCallbackHandler(deps);
  const done=res();await callback({query:{code:'auth-code',state},headers:{}},done);
  assert.equal(done.statusCode,302);assert.equal(done.headers.Location,'/?withings=connected');
  const exchange=b.tokenRequests[0].params;
  assert.deepEqual([exchange.action,exchange.grant_type,exchange.code,exchange.client_secret,exchange.redirect_uri],
    ['requesttoken','authorization_code','auth-code','csecret','https://soccer.example/api/withings-callback']);
  assert.equal(JSON.parse(b.kv.get('withings:tokens')).refresh_token,'refresh-1');
  const replay=res();await callback({query:{code:'auth-code',state},headers:{}},replay);
  assert.equal(replay.headers.Location,'/?withings=error','state is single-use');
  const forged=res();await callback({query:{code:'x',state:'a'.repeat(48)},headers:{}},forged);
  assert.equal(forged.headers.Location,'/?withings=error');
  const ping=res();await callback({query:{},headers:{}},ping);
  assert.equal(ping.statusCode,200,'URL check by Withings gets a plain 200');
  const denied=res();await callback({query:{error:'access_denied'},headers:{}},denied);
  assert.equal(denied.headers.Location,'/?withings=denied');
  assert.equal(b.tokenRequests.length,1,'no exchange without a valid state');
});

test('measurements: refresh near expiry keeps the rotated token, retries 343 once, follows pages',async()=>{
  const b=backend({pages:[
    {status:343},
    {status:0,body:{more:1,offset:1,measuregrps:[grp('2026-10-27T05:30:00Z',78.1,15.4)]}},
    {status:0,body:{more:0,measuregrps:[grp('2026-10-28T05:30:00Z',77.9,15.3)]}},
  ]});
  connected(b,NOW/1000+120);
  const r=await call(withingsHandler({env:ENV,fetchImpl:b.fetchImpl,now:()=>NOW}));
  assert.equal(r.code,200);
  assert.deepEqual(r.body.days,[{date:'2026-10-27',weight:78.1,bodyFat:15.4},{date:'2026-10-28',weight:77.9,bodyFat:15.3}]);
  assert.equal(b.tokenRequests.length,2,'refresh before expiry, then once more after 343');
  assert.equal(b.tokenRequests[0].params.refresh_token,'refresh-0');
  assert.equal(b.tokenRequests[1].params.refresh_token,'refresh-1','uses the rotated refresh token');
  assert.equal(JSON.parse(b.kv.get('withings:tokens')).refresh_token,'refresh-2');
  const m=b.measureRequests;
  assert.equal(m.at(-1).params.offset,'1');
  assert.deepEqual([m[0].params.action,m[0].params.meastypes,m[0].params.category],['getmeas','1,6','1']);
  assert.equal(m.at(-1).auth,'Bearer access-2');
});

test('not connected, expired refresh, no data, rate limit, bad range and disconnect',async()=>{
  const b=backend();
  assert.deepEqual((await call(withingsHandler({env:ENV,fetchImpl:b.fetchImpl,now:()=>NOW}))).body,{error:'withings_not_connected'});
  const expired=backend({refreshStatus:503});connected(expired,0);
  assert.deepEqual((await call(withingsHandler({env:ENV,fetchImpl:expired.fetchImpl,now:()=>NOW}))).body,{error:'withings_reconnect'});
  const empty=backend({pages:[{status:100}]});connected(empty);
  assert.deepEqual((await call(withingsHandler({env:ENV,fetchImpl:empty.fetchImpl,now:()=>NOW}))).body.days,[]);
  const limited=backend({pages:[{status:601}]});connected(limited);
  assert.equal((await call(withingsHandler({env:ENV,fetchImpl:limited.fetchImpl,now:()=>NOW}))).code,503);
  for(const query of [{from:'2025-01-01',to:'2026-10-28'},{from:'2026-10-28',to:'2026-10-01'},{}])
    assert.equal((await call(withingsHandler({env:ENV,fetchImpl:b.fetchImpl}),{query})).body.error,'invalid_range');
  const d=backend();connected(d);
  assert.equal((await call(withingsHandler({env:ENV,fetchImpl:d.fetchImpl}),{method:'POST',body:JSON.stringify({action:'disconnect'})})).code,200);
  assert.equal(d.kv.has('withings:tokens'),false);
});

test('scale values never overwrite what the player entered by hand',()=>{
  const plan={
    '2026-10-20':{weight:79,bodyFat:16},
    '2026-10-21':{weight:78.8,bodyFat:null,bodySource:'manual'},
    '2026-10-22':{weight:78.5,bodyFat:15.9,bodySource:'withings'},
    '2026-10-23':{sessions:['Gym'],completed:true},
    '2026-10-24':{weight:78.4,bodyFat:15.8,bodySource:'withings'},
  };
  const days=[
    {date:'2026-10-20',weight:78.1,bodyFat:15.1},
    {date:'2026-10-21',weight:78.0,bodyFat:15.0},
    {date:'2026-10-22',weight:78.2,bodyFat:15.7},
    {date:'2026-10-23',weight:78.3,bodyFat:null},
    {date:'2026-10-24',weight:78.4,bodyFat:15.8},
    {date:'2026-10-29',weight:70,bodyFat:10},
    {date:'2026-10-25',weight:-1,bodyFat:200},
  ];
  const before=plain(plan),{plan:next,updated}=app.applyWithingsImport(plan,days,'2026-10-28');
  assert.deepEqual(plain(plan),before,'input not mutated');
  assert.deepEqual(plain(updated),['2026-10-22','2026-10-23']);
  assert.deepEqual(plain(next['2026-10-20']),{weight:79,bodyFat:16},'older manual values without a source stay');
  assert.equal(next['2026-10-21'].weight,78.8,'marked manual stays');
  assert.deepEqual([next['2026-10-22'].weight,next['2026-10-22'].bodyFat],[78.2,15.7],'earlier scale values refresh');
  assert.deepEqual(plain(next['2026-10-23']),{sessions:['Gym'],completed:true,weight:78.3,bodyFat:null,bodySource:'withings'});
  assert.equal(next['2026-10-24'],plan['2026-10-24'],'unchanged: same object');
  assert.equal(next['2026-10-29'],undefined);assert.equal(next['2026-10-25'],undefined);
  assert.match(source,/bodySource:"manual"\}\);onClose\(\)/,'manual editor marks its values');
});
