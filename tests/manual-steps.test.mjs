import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-17T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({parseSteps,manualStepsPatch,clearManualStepsPatch,applyGarminImport,stepsWeek,restDay})',{Date:FixedDate});
const TODAY='2026-11-17';
const apply=(entry,patch)=>plain({...entry,...patch});

test('typed steps accept the usual ways of writing a number and nothing else',()=>{
  assert.equal(app.parseSteps("9'800"),9800);
  assert.equal(app.parseSteps('9’800'),9800);
  assert.equal(app.parseSteps('12 400'),12400);
  assert.equal(app.parseSteps('8.400'),8400);
  assert.equal(app.parseSteps('7000'),7000);
  for(const bad of ['','0','-500','abc','100000','9,8k',null])assert.equal(app.parseSteps(bad),null,String(bad));
});

test('a hand-entered count replaces Garmin and keeps Garmin aside',()=>{
  const sunday=apply({steps:1240,sessions:[]},app.manualStepsPatch({steps:1240,sessions:[]},9800));
  assert.deepEqual(sunday,{steps:9800,stepsManual:true,stepsGarmin:1240,sessions:[]});
  const again=apply(sunday,app.manualStepsPatch(sunday,10200));
  assert.equal(again.stepsGarmin,1240,'a second edit keeps the watch number, not the first typed one');
  assert.deepEqual(apply(again,app.clearManualStepsPatch(again)),{steps:1240,sessions:[]},'clearing goes back to Garmin');
  const noWatch=apply({},app.manualStepsPatch({},8000));
  assert.deepEqual(noWatch,{steps:8000,stepsManual:true});
  assert.deepEqual(apply(noWatch,app.clearManualStepsPatch(noWatch)),{},'without Garmin the day has no count again');
});

test('a Garmin sync never overwrites a typed count but updates the number beside it',()=>{
  const plan={'2026-11-15':{steps:9800,stepsManual:true,stepsGarmin:1240},'2026-11-16':{steps:5000}};
  const {plan:next}=app.applyGarminImport(plan,{activities:[],steps:[
    {date:'2026-11-15',steps:1310},{date:'2026-11-16',steps:6100}]},TODAY);
  assert.deepEqual(plain(next['2026-11-15']),{steps:9800,stepsManual:true,stepsGarmin:1310});
  assert.equal(next['2026-11-16'].steps,6100,'other days still follow Garmin');
});

test('the typed count is what the 7-day mean and the rest day use',()=>{
  const plan={};
  for(let d=11;d<=17;d++)plan[`2026-11-${d}`]={steps:8000,sessions:[]};
  plan['2026-11-15']={steps:9800,stepsManual:true,stepsGarmin:400,sessions:[]};
  const week=app.stepsWeek(plan,TODAY,TODAY);
  assert.equal(week.avg,Math.round((8000*6+9800)/7));
  assert.equal(app.restDay(plan['2026-11-15'],'2026-11-15',TODAY).met,true);
});
