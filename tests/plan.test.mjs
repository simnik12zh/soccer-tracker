import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {planHandler,enforcePlanRules,validatePlanInput,PLAN_MODEL,PLAN_SYSTEM_PROMPT} from '../api/_lib/plan.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T08:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({planWeekInput,applyWeekProposal,undoWeekProposal,coachingFor})',{Date:FixedDate});

const WEEK='2026-11-02';
const basePlan=()=>({
  '2026-11-01':{sessions:['Walking']},
  '2026-11-02':{sessions:['Gym','Mobility'],completed:true},
  '2026-11-03':{sessions:['Walking']},
  '2026-11-04':{sessions:['Gym','Mobility'],notes:'keep my note',protein:40},
  '2026-11-05':{sessions:['Team Training']},
  '2026-11-06':{sessions:['Mobility']},
  '2026-11-07':{sessions:[]},
  '2026-11-08':{sessions:['Match'],match:{opponent:'FC Test',home:true,kickoff:'10:00'}},
});

test('the week input marks games, team training and finished or past days as fixed',()=>{
  const input=app.planWeekInput(basePlan(),WEEK,'2026-11-03');
  assert.equal(input.days.length,7);
  assert.deepEqual(plain(input.days.map(d=>[d.date.slice(-2),d.fixed,d.locked])),
    [['02',true,true],['03',false,false],['04',false,false],['05',true,false],['06',false,false],['07',false,false],['08',true,false]]);
  assert.equal(input.matchDayBefore,false);
  assert.ok(validatePlanInput({...input}),'the server accepts what the app sends');
  assert.equal(validatePlanInput({...input,days:input.days.slice(1)}),null);
});

test('hard rules hold whatever the model proposes',()=>{
  const input=validatePlanInput(app.planWeekInput(basePlan(),WEEK,'2026-11-03'));
  const raw={summary:'Leichte Woche wegen hoher Belastung. ß-Test',days:[
    {date:'2026-11-02',sessions:['Easy run'],title:'x',guidance:'y'},
    {date:'2026-11-03',sessions:['Gym','Mobility','Futsal'],title:'Kraft',guidance:'3×5'},
    {date:'2026-11-04',sessions:['Gym'],title:'Kraft',guidance:'nochmals'},
    {date:'2026-11-05',sessions:['Gym'],title:'Team kurz',guidance:'Vor dem Spiel dosieren'},
    {date:'2026-11-06',sessions:['Match','Pilates','Mobility','Walking'],title:'',guidance:''},
    {date:'2026-11-07',sessions:['Easy run','Mobility'],title:'Vor dem Spiel',guidance:'locker'},
    {date:'2026-11-08',sessions:[],title:'Spiel',guidance:'Vollgas'},
  ]};
  const out=enforcePlanRules(input,raw);
  const by=Object.fromEntries(out.days.map(d=>[d.date.slice(-2),d]));
  assert.deepEqual(plain(by['02'].sessions),['Gym','Mobility'],'finished day unchanged');
  assert.equal(by['02'].title,'','no guidance on finished days');
  assert.deepEqual(plain(by['03'].sessions),['Mobility'],'no Gym right after Monday\'s finished Gym day');
  assert.deepEqual(plain(by['04'].sessions),['Gym'],'Wednesday Gym is fine again');
  assert.deepEqual(plain(by['05'].sessions),['Team Training'],'team training stays');
  assert.equal(by['05'].guidance,'Vor dem Spiel dosieren','guidance on fixed days ahead is allowed');
  assert.deepEqual(plain(by['06'].sessions),['Pilates','Mobility'],'the model cannot add games; at most two sessions');
  assert.deepEqual(plain(by['07'].sessions),['Mobility'],'no run or futsal the day before a game');
  assert.deepEqual(plain(by['08'].sessions),['Match']);
  assert.equal(out.summary,'Leichte Woche wegen hoher Belastung. ss-Test');
});

test('only walking or mobility the day after a game, including a game on the previous Sunday',()=>{
  const plan=basePlan();plan['2026-11-01']={sessions:['Match'],match:{opponent:'X',home:false,kickoff:'15:00'}};
  const input=validatePlanInput(app.planWeekInput(plan,WEEK,'2026-11-02'));
  assert.equal(input.matchDayBefore,true);
  input.days[0]={...input.days[0],fixed:false,locked:false};
  const out=enforcePlanRules(input,{summary:'',days:[{date:'2026-11-02',sessions:['Gym','Walking'],title:'',guidance:''}]});
  assert.deepEqual(plain(out.days[0].sessions),['Walking']);
});

test('applying changes only open days and can be undone without losing later entries',()=>{
  const plan=basePlan();
  const proposal={days:[
    {date:'2026-11-02',sessions:['Easy run'],fixed:true,title:'',guidance:''},
    {date:'2026-11-03',sessions:['Gym','Mobility'],fixed:false,title:'Ganzkörperkraft',guidance:'3 Sätze, 2 Wdh. Reserve'},
    {date:'2026-11-04',sessions:['Walking'],fixed:false,title:'',guidance:''},
    {date:'2026-11-05',sessions:['Team Training'],fixed:true,title:'Team kurz',guidance:'Vor dem Spiel dosieren'},
    {date:'2026-11-08',sessions:['Match'],fixed:true,title:'',guidance:''},
  ]};
  const {plan:next,previous}=app.applyWeekProposal(plan,proposal,'2026-11-03');
  assert.equal(next['2026-11-02'],plan['2026-11-02'],'finished day untouched');
  assert.deepEqual(plain(next['2026-11-03'].sessions),['Gym','Mobility']);
  assert.equal(app.coachingFor(next['2026-11-03']).title,'Ganzkörperkraft','guidance shows in Today');
  assert.equal(next['2026-11-04'].notes,'keep my note');assert.equal(next['2026-11-04'].protein,40);
  assert.deepEqual(plain(next['2026-11-05'].sessions),['Team Training']);
  assert.equal(app.coachingFor(next['2026-11-05']).text,'Vor dem Spiel dosieren');
  assert.equal(next['2026-11-08'],plan['2026-11-08'],'fixed day without guidance untouched');
  assert.deepEqual(Object.keys(previous).sort(),['2026-11-03','2026-11-04','2026-11-05']);
  // Later the player logs Tuesday and adds protein on Wednesday; undo keeps both.
  const later={...next,'2026-11-03':{...next['2026-11-03'],completed:true},'2026-11-04':{...next['2026-11-04'],protein:90}};
  const undone=app.undoWeekProposal(later,previous);
  assert.deepEqual(plain(undone['2026-11-03'].sessions),['Gym','Mobility'],'a finished day is not rolled back');
  assert.deepEqual(plain(undone['2026-11-04'].sessions),['Gym','Mobility']);
  assert.equal(undone['2026-11-04'].protein,90);
  assert.equal(app.coachingFor(undone['2026-11-05']),null);
});

test('the plan endpoint calls Opus 5.5 with a schema and returns the enforced week',async()=>{
  const requests=[];
  const client={beta:{messages:{create:async p=>{requests.push(p);return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({summary:'ok',days:[]})}]};}}}};
  const body={...app.planWeekInput(basePlan(),WEEK,'2026-11-03'),context:{load:{status:'high'}}};
  const res={code:200,body:null,setHeader(){},status(n){this.code=n;return this;},json(o){this.body=o;return this;}};
  await planHandler({env:{APP_ACCESS_CODE:'c'},client})({method:'POST',body,headers:{authorization:'Bearer c'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.proposal.days.length,7);
  assert.deepEqual(plain(res.body.proposal.days[3].sessions),['Team Training']);
  assert.equal(requests[0].model,PLAN_MODEL);assert.equal(PLAN_MODEL,'claude-opus-5-5');
  assert.equal(requests[0].output_config.format.type,'json_schema');
  assert.match(requests[0].system,/<plan_input>/);assert.match(requests[0].system,/"status":"high"/);
  const denied={code:200,status(n){this.code=n;return this;},json(o){this.body=o;return this;},setHeader(){}};
  await planHandler({env:{APP_ACCESS_CODE:'c'},client})({method:'POST',body,headers:{}},denied);
  assert.equal(denied.code,401);
  assert.match(PLAN_SYSTEM_PROMPT,/Day after a game: only Walking or rest/);
});
