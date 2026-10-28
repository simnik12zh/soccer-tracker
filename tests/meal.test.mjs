import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mealHandler,normalizeMeal,MEAL_MODEL,MEAL_SYSTEM_PROMPT} from '../api/_lib/meal.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({dayProtein,dayKcal,dayMeals,nutritionSummary,dayChecklist,buildCoachContext})',{Date:FixedDate});

const ENV={APP_ACCESS_CODE:'code-123',ANTHROPIC_API_KEY:'test-only'};
const IMAGE='A'.repeat(400);
const MODEL_JSON={isFood:true,title:'Poulet mit Reis und Gemüse',items:[
  {name:'Pouletbrust',grams:180,kcal:297,proteinGrams:55.8},{name:'Reis',grams:200,kcal:260,proteinGrams:5.4},{name:'Olivenöl',grams:10,kcal:88,proteinGrams:0}],
  kcalLow:560,kcalHigh:760,confidence:'medium'};
function fakeClient(response){
  const requests=[];
  return {requests,beta:{messages:{create:async params=>{requests.push(params);return typeof response==='function'?response(params):response;}}}};
}
const reply=(json,extra={})=>({stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:JSON.stringify(json)}],...extra});
async function call(handler,{body={image:IMAGE,mediaType:'image/jpeg'},auth='Bearer code-123',method='POST'}={}){
  const res={code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(o){this.body=o;return this;}};
  await handler({method,body,headers:{authorization:auth}},res);return res;
}

test('meal photo goes to Opus 5.5 with a fixed JSON schema and comes back as checked numbers',async()=>{
  const client=fakeClient(reply(MODEL_JSON));
  const res=await call(mealHandler({env:ENV,client}));
  assert.equal(res.code,200);
  assert.deepEqual(res.body.meal,{title:'Poulet mit Reis und Gemüse',items:[
    {name:'Pouletbrust',grams:180,kcal:297,protein:55.8},{name:'Reis',grams:200,kcal:260,protein:5.4},{name:'Olivenöl',grams:10,kcal:88,protein:0}],
    kcal:645,protein:61,kcalLow:560,kcalHigh:760,confidence:'medium'});
  const req=client.requests[0];
  assert.equal(req.model,'claude-opus-5-5');assert.equal(MEAL_MODEL,'claude-opus-5-5');
  assert.equal(req.output_config.format.type,'json_schema');
  assert.equal(req.output_config.format.schema.additionalProperties,false);
  assert.equal(req.output_config.effort,'medium');
  assert.equal(req.thinking,undefined,'thinking stays on (it cannot be disabled on Opus 5.5)');
  assert.deepEqual(plain(req.betas),['server-side-fallback-2026-07-01']);assert.equal(req.fallbacks,'default');
  assert.equal(req.temperature,undefined);
  const [image,text]=req.messages[0].content;
  assert.deepEqual(plain(image),{type:'image',source:{type:'base64',media_type:'image/jpeg',data:IMAGE}});
  assert.equal(text.type,'text');
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.match(MEAL_SYSTEM_PROMPT,/saved automatically/);assert.match(MEAL_SYSTEM_PROMPT,/never ß/);
});

test('totals are recomputed and implausible numbers clamped',()=>{
  const m=normalizeMeal({isFood:true,title:'Grosses Menü mit sehr langem Namen, der abgeschnitten wird',items:[
    {name:'Pizza ß',grams:5000,kcal:9000,proteinGrams:900},{name:'Wasser',grams:500,kcal:0,proteinGrams:0},{name:'Salat',grams:100,kcal:40,proteinGrams:2}],
    kcalLow:9999,kcalHigh:10,confidence:'sure'});
  assert.equal(m.title.length,40);
  assert.deepEqual(plain(m.items.map(i=>[i.name,i.grams,i.kcal,i.protein])),[['Pizza ss',2000,3000,200],['Salat',100,40,2]],'water without energy dropped');
  assert.equal(m.kcal,3040);assert.equal(m.protein,202);
  assert.ok(m.kcalLow<=m.kcal&&m.kcalHigh>=m.kcal,'range always contains the estimate');
  assert.equal(m.confidence,'medium');
  assert.throws(()=>normalizeMeal({isFood:false,title:'',items:[],kcalLow:0,kcalHigh:0,confidence:'low'}),/no_food/);
});

test('access code, image checks and model failures give clear errors',async()=>{
  const ok=fakeClient(reply(MODEL_JSON));
  assert.equal((await call(mealHandler({env:{...ENV,APP_ACCESS_CODE:''},client:ok}))).body.error,'access_code_not_configured');
  assert.equal((await call(mealHandler({env:ENV,client:ok}),{auth:'Bearer nope'})).code,401);
  assert.equal((await call(mealHandler({env:ENV,client:ok}),{method:'GET'})).code,405);
  for(const body of [{},{image:'short'},{image:IMAGE,mediaType:'image/gif'},{image:'x'.repeat(200)+'<script>'},{image:'A'.repeat(3_000_001)}])
    assert.equal((await call(mealHandler({env:ENV,client:ok}),{body})).body.error,'invalid_image');
  assert.equal(ok.requests.length,0,'nothing reaches the model without a valid request');
  assert.equal((await call(mealHandler({env:{APP_ACCESS_CODE:'code-123'}}))).body.error,'model_not_configured');
  const cases=[[reply({...MODEL_JSON,isFood:false,items:[]}),422,'no_food'],[{stop_reason:'refusal',content:[]},422,'meal_refused'],
    [{stop_reason:'max_tokens',content:[]},502,'meal_unreadable'],[{stop_reason:'end_turn',content:[{type:'text',text:'not json'}]},502,'meal_unreadable'],
    [()=>{throw new Error('network');},502,'meal_unavailable']];
  for(const [response,code,error] of cases){
    const res=await call(mealHandler({env:ENV,client:fakeClient(response)}));
    assert.deepEqual([res.code,res.body.error],[code,error]);
  }
});

test('day totals combine photographed meals and quick-add protein',()=>{
  const meal=(id,kcal,protein)=>({id,at:'12:30',title:'M'+id,kcal,protein});
  const e={protein:20,meals:[meal('a',645,61),meal('b',380,24),{id:'bad',kcal:'x'}]};
  assert.equal(app.dayProtein(e),105);assert.equal(app.dayKcal(e),1025);assert.equal(app.dayMeals(e).length,2);
  assert.equal(app.dayProtein({meals:[meal('a',500,30)]}),30,'meals alone');
  assert.equal(app.dayKcal({protein:40}),null,'no kcal without photos');
  assert.equal(app.dayProtein({}),null);
  const plan={'2026-10-27':e,'2026-10-28':{protein:30}};
  const s=app.nutritionSummary(plan,['2026-10-27','2026-10-28'],100);
  assert.deepEqual([s.hits,s.avgProtein,s.kcalDays,s.avgKcal],[1,68,1,1025]);
  assert.deepEqual(plain(app.dayChecklist({meals:[meal('a',700,90)]},'2026-10-28','2026-10-28',100).open),['10 g Protein','Ernährung bewerten']);
  const ctx=app.buildCoachContext(plan,'Test','2026-10-28','2026-10-28');
  const day=ctx.recentDays.find(d=>d.date==='2026-10-27');
  assert.deepEqual(plain(day.nutrition),{proteinGrams:105,rating:null,kcal:1025,meals:[{title:'Ma',kcal:645,proteinGrams:61},{title:'Mb',kcal:380,proteinGrams:24}]});
  assert.deepEqual(plain(ctx.today.nutrition),{proteinGrams:30,rating:null},'no kcal fields without photos');
  assert.equal(ctx.nutrition.last7Days.avgKcal,1025);
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/never that he fasted/);
});

test('meal updates build on the latest plan, so results arriving later never drop edits',()=>{
  assert.match(source,/const updDayWith=\(dk,fn\)=>\{const cur=planRef\.current/);
  assert.match(source,/const cur=planRef\.current,np=\{\.\.\.cur,\[dk\]:\{\.\.\.cur\[dk\],\.\.\.patch\}\};planRef\.current=np/);
  const card=source.slice(source.indexOf('function NutritionCard'),source.indexOf('// ─── Up next'));
  assert.doesNotMatch(card,/sessions|completed/,'nutrition logging never touches training data');
  assert.match(card,/capture="environment"/,'camera opens directly');
  assert.doesNotMatch(card,/localStorage\.setItem\([^)]*image/,'photos are not stored');
});
