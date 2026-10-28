import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Anthropic from '@anthropic-ai/sdk';
import {accessDenied} from '../api/_lib/access.js';
import {enforcePlanRules,validatePlanInput,PLAN_SYSTEM_PROMPT} from '../api/_lib/plan.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'))
  +source.slice(source.indexOf('const BF_GOAL ='),source.indexOf('// Minimal responsive SVG line chart'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-04T08:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+`\n({reportComplaint,resolveComplaint,activeComplaints,complaintLabel,complaintTrend,complaintDays,
  complaintsForCoach,complaintsInRange,loadAdvice,planWeekInput,buildCoachContext,weeklyReportFacts})`,{Date:FixedDate});

test('reporting the same area and side updates the episode; another side starts a new one',()=>{
  let list=app.reportComplaint([],{area:'hip',side:'links',level:2},'2026-11-01');
  assert.equal(list.length,1);
  assert.equal(app.complaintLabel(list[0]),'Hüfte links');
  list=app.reportComplaint(list,{area:'hip',side:'links',level:1},'2026-11-03');
  assert.equal(list.length,1,'same episode');
  assert.equal(list[0].level,1);assert.equal(list[0].since,'2026-11-01');assert.equal(list[0].updated,'2026-11-03');
  assert.equal(app.complaintTrend(list[0]),'better');
  list=app.reportComplaint(list,{area:'hip',side:'rechts',level:1},'2026-11-03');
  assert.equal(list.length,2,'the other side is its own episode');
  list=app.reportComplaint(list,{area:'back',side:'links',level:3},'2026-11-03');
  assert.equal(list.at(-1).side,null,'the back has no side');
  assert.equal(app.reportComplaint(list,{area:'knee',level:5},'2026-11-03'),list,'invalid levels are ignored');
  assert.equal(app.complaintDays(list[0],'2026-11-04'),4);
});

test('a resolved episode is no longer active; a new report afterwards starts fresh',()=>{
  let list=app.reportComplaint([],{area:'calf',side:'rechts',level:2},'2026-11-01');
  list=app.resolveComplaint(list,list[0].id,'2026-11-03');
  assert.equal(app.activeComplaints(list,'2026-11-03').length,0);
  assert.equal(list[0].resolved,'2026-11-03');
  list=app.reportComplaint(list,{area:'calf',side:'rechts',level:1},'2026-11-04');
  assert.equal(list.length,2);
  assert.equal(app.activeComplaints(list,'2026-11-04')[0].since,'2026-11-04');
  const coach=app.complaintsForCoach(list,'2026-11-04');
  assert.deepEqual(plain(coach.active.map(c=>[c.area,c.level,c.lowerBody,c.trend])),[['Wade/Achilles rechts','Leicht',true,'new']]);
  assert.deepEqual(plain(coach.recentlyResolved.map(c=>c.resolved)),['2026-11-03']);
  assert.equal(app.complaintsForCoach(list,'2026-11-20').recentlyResolved.length,0,'older than 14 days drops out');
});

test('load advice: Mittel and Stark override everything, Leicht does not; works without watch data',()=>{
  const status={ready:false,historyDays:3,acute:0};
  assert.match(app.loadAdvice({},'2026-11-04',status,null,[]),/zu wenig Daten/);
  let list=app.reportComplaint([],{area:'knee',side:'links',level:1},'2026-11-04');
  assert.match(app.loadAdvice({},'2026-11-04',status,null,list),/zu wenig Daten/);
  list=app.reportComplaint(list,{area:'knee',side:'links',level:2},'2026-11-04');
  assert.equal(app.loadAdvice({},'2026-11-04',status,null,list),'Wegen Knie links: keine Zusatzeinheit, nur schmerzfreie Bewegungen.');
  list=app.reportComplaint(list,{area:'shoulder',side:'rechts',level:3},'2026-11-04');
  assert.match(app.loadAdvice({},'2026-11-04',status,null,list),/^Wegen Schulter rechts \(stark\)/,'the strongest complaint wins');
});

test('the week input carries complaints and the server strips runs and futsal for leg complaints',()=>{
  const plan={'2026-11-08':{sessions:['Match'],match:{opponent:'X',home:true,kickoff:'10:00'}}};
  const legs=app.reportComplaint([],{area:'groin',side:'links',level:2},'2026-11-02');
  const input=app.planWeekInput(plan,'2026-11-02','2026-11-02',legs);
  assert.deepEqual(plain(input.complaints),[{area:'Leiste links',level:2,lowerBody:true}]);
  const valid=validatePlanInput({...input,complaints:[...input.complaints,{area:'<x>',level:9},null]});
  assert.equal(valid.complaints.length,1,'invalid complaints are dropped');
  const raw={summary:'',days:input.days.map(d=>({date:d.date,sessions:['Easy run','Gym'],title:'',guidance:''}))};
  raw.days[2].sessions=['Futsal'];
  const out=enforcePlanRules(valid,raw);
  for(const d of out.days.filter(d=>!d.fixed))assert.ok(!d.sessions.some(s=>s==='Easy run'||s==='Futsal'),d.date);
  assert.deepEqual(plain(out.days[0].sessions),['Gym'],'Gym stays (upper body is up to the model)');
  // A light leg complaint or a shoulder complaint keeps runs.
  for(const c of [{area:'Leiste links',level:1,lowerBody:true},{area:'Schulter rechts',level:3,lowerBody:false}]){
    const other=enforcePlanRules(validatePlanInput({...input,complaints:[c]}),raw);
    assert.deepEqual(plain(other.days[0].sessions),['Easy run','Gym']);
  }
  assert.match(PLAN_SYSTEM_PROMPT,/lower-body complaint at Mittel or Stark → no Easy run and no Futsal/);
});

test('the coach gets complaints in its context and the prompt knows how to treat them',()=>{
  const list=app.reportComplaint([],{area:'hip',side:'links',level:2},'2026-11-01');
  const ctx=app.buildCoachContext({},'Niko','2026-11-04','2026-11-04',100,list);
  assert.deepEqual(plain(ctx.complaints.active[0]),
    {area:'Hüfte links',level:'Mittel',lowerBody:true,since:'2026-11-01',daysActive:4,lastUpdate:'2026-11-01',trend:'new'});
  assert.equal(ctx.load.ready,false,'no watch data: the complaint still reaches the coach directly');
  const backend=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8')
    .replace(/^import [^\n]*\n/gm,'').replace('export default async function handler','async function handler');
  const api=vm.runInNewContext(backend+'\n({buildContextBlock,SYSTEM_PROMPT})',{Anthropic,accessDenied,process:{env:{}},console});
  assert.match(api.buildContextBlock(plain(ctx)),/"complaints":\{"active":\[\{"area":"Hüfte links"/);
  assert.match(api.SYSTEM_PROMPT,/Never diagnose, never name a likely injury/);
  assert.match(api.SYSTEM_PROMPT,/more than 7 days or trend is worse/);
});

test('the weekly report lists complaints active that week with their worst level',()=>{
  let list=app.reportComplaint([],{area:'hamstring',side:'rechts',level:1},'2026-10-22');
  list=app.reportComplaint(list,{area:'hamstring',side:'rechts',level:3},'2026-10-28');
  list=app.reportComplaint(list,{area:'hamstring',side:'rechts',level:1},'2026-10-31');
  list=app.resolveComplaint(list,list[0].id,'2026-11-03');
  list=app.reportComplaint(list,{area:'back',level:2},'2026-10-01');
  list=app.resolveComplaint(list,list[1].id,'2026-10-10');
  assert.deepEqual(plain(app.complaintsInRange(list,'2026-10-26','2026-11-01')),
    [{area:'Oberschenkel hinten rechts',level:'Stark',since:'2026-10-22',resolved:null}],'resolved after the week, back resolved before it');
  assert.deepEqual(plain(app.complaintsInRange(list,'2026-11-02','2026-11-08')[0]),
    {area:'Oberschenkel hinten rechts',level:'Leicht',since:'2026-10-22',resolved:'2026-11-03'},'level carried into the week');
  const facts=app.weeklyReportFacts({},'2026-10-26',100,list);
  assert.equal(facts.complaints.length,1);
  assert.equal(app.weeklyReportFacts({},'2026-10-26').complaints.length,0,'no complaints passed → empty');
});
