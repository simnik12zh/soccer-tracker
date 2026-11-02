import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Anthropic from '@anthropic-ai/sdk';
import {accessDenied} from '../api/_lib/access.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-04T19:30:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({weeklyTrends,buildCoachContext,daysBeforeStr})',{Date:FixedDate});
const TODAY='2026-11-04'; // Wednesday

// Eight weeks of slowly falling body fat, steady weight, football on Thursdays.
function history(){
  const plan={};
  for(let n=1;n<=60;n++){
    const dk=app.daysBeforeStr(TODAY,n),wd=(new Date(dk+'T12:00:00').getDay()+6)%7,week=Math.floor(n/7);
    const e={steps:9000,recovery:{sleepMin:420,sleepScore:75,hrv:55,restingHr:52}};
    if(n%2===0){e.weight=82;e.bodyFat=Math.round((15+week*0.15)*10)/10;}
    if(wd===0){e.sessions=['Gym','Mobility'];e.completed=true;e.protein=110;}
    if(wd===3){e.sessions=['Team Training'];e.completed=true;e.garmin=[{id:dk,type:'soccer',load:150,distanceKm:6+week*0.1,maxSpeedKmh:27,highHrMin:15,matched:true}];}
    if(wd===5)e.nutrition='red';
    plan[dk]=e;
  }
  plan[TODAY]={sessions:['Gym','Mobility'],weight:81.8,bodyFat:14.2,recovery:{sleepMin:400,sleepScore:70,hrv:50,restingHr:53}};
  return plan;
}

test('weekly trends: eight completed weeks plus the current one, with the key numbers',()=>{
  const weeks=app.weeklyTrends(history(),TODAY,100,null);
  assert.equal(weeks.length,9);
  assert.equal(weeks[0].from,'2026-09-07');assert.equal(weeks.at(-1).from,'2026-11-02');
  assert.deepEqual([weeks.at(-1).currentWeekSoFar,weeks.at(-1).daysSoFar],[true,3]);
  const full=weeks[7];
  assert.equal(full.currentWeekSoFar,undefined);
  assert.deepEqual([full.trainingDays,full.gym,full.reha,full.games],[2,1,1,0]);
  assert.equal(full.load,150);assert.equal(full.footballKm,6);assert.equal(full.topSpeedKmh,27);assert.equal(full.highHrMin,15);
  assert.equal(full.weightKg,82);
  assert.equal(full.leanMassKg,Math.round(82*(1-full.bodyFatPct/100)*10)/10);
  assert.ok(weeks[0].bodyFatPct>full.bodyFatPct,'body fat falls over the weeks');
  assert.deepEqual([full.avgSleepMin,full.avgSleepScore,full.avgHrvMs,full.avgRestingHr,full.avgSteps],[420,75,55,52,9000]);
  assert.deepEqual([full.avgProteinG,full.proteinTargetDays,full.proteinLoggedDays,full.redDays],[110,1,1,1]);
  const empty=app.weeklyTrends({},TODAY)[0];
  assert.deepEqual([empty.weightKg,empty.load,empty.footballKm,empty.avgSleepMin],[null,null,null,null],'no data is null, never zero');
});

test('the coach gets the time, the trends and his last weekly report; the server passes them on',()=>{
  const ctx=app.buildCoachContext(history(),'Niko',TODAY,TODAY,100,[],null,{localTime:'19:30',lastReport:{week:'26. Okt. – 1. Nov.',text:'Bilanz: … Fokus: Zweimal Gym, Montag und Freitag fix.'}});
  assert.equal(ctx.localTime,'19:30');
  assert.equal(ctx.trends.weeks.length,9);
  assert.match(ctx.lastWeeklyReport.text,/Fokus: Zweimal Gym/);
  const bare=app.buildCoachContext(history(),'Niko',TODAY,TODAY,100,[],null,{localTime:'nonsense'});
  assert.equal(bare.localTime,undefined);assert.equal(bare.lastWeeklyReport,undefined);
  assert.ok(JSON.stringify(ctx).length<60000,'still far below the 160 kB server limit');
  const backend=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'').replace('export default async function handler','async function handler');
  const api=vm.runInNewContext(backend+'\n({buildContextBlock,SYSTEM_PROMPT})',{Anthropic,accessDenied,process:{env:{}},console});
  const block=api.buildContextBlock(plain(ctx));
  assert.match(block,/"localTime":"19:30"/);assert.match(block,/"trends":\{"weeks":\[/);assert.match(block,/"lastWeeklyReport":\{"week"/);
  assert.match(api.SYSTEM_PROMPT,/Judge direction over three or more weeks/);
  assert.match(api.SYSTEM_PROMPT,/Keep its Fokus as the line for the current week/);
  assert.match(source,/coachExtras\(\)\),messages:base\.slice\(-20\)/,'the chat sends time and report');
});
