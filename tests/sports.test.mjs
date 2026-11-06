import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PLAN_SYSTEM_PROMPT} from '../api/_lib/plan.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-06T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({displayName,getTip,sessionEmoji,applyGarminImport,typicalLoads,sessionLoad,planWeekInput,ALTS,HARD_SESSIONS})',{Date:FixedDate});
const NEW=['Cycling','Cross-country skiing','Padel'];

test('Velo, Langlauf and Padel can be picked and have their own text',()=>{
  assert.deepEqual(NEW.map(app.displayName),['Velo','Langlauf','Padel']);
  assert.deepEqual(NEW.map(s=>app.sessionEmoji(s)),['🚴','🎿','🎾']);
  for(const s of NEW){
    assert.ok(app.ALTS.some(a=>a.label===s),s+' is in the picker');
    const tip=app.getTip(s);
    assert.ok(tip&&tip.summary&&tip.done&&tip.text,s+' has a card text');
    assert.ok(app.HARD_SESSIONS.includes(s),s+' counts around games');
  }
  assert.equal(app.ALTS.at(-1).label,'Sick/Injured','the sick day stays last');
});

test('the watch marks them done, fills empty days and learns their usual load',()=>{
  const plan={'2026-11-02':{sessions:['Padel']},'2026-11-03':{sessions:[]},'2026-11-04':{sessions:['Cross-country skiing']}};
  const {plan:next,completed}=app.applyGarminImport(plan,{activities:[
    {id:'p',date:'2026-11-02',type:'padel',minutes:80,load:110},
    {id:'c',date:'2026-11-03',type:'road_biking',minutes:60,load:70},
    {id:'s',date:'2026-11-04',type:'skate_skiing_ws',minutes:75,load:95},
  ]},'2026-11-06');
  assert.deepEqual(plain(completed),['2026-11-02','2026-11-03','2026-11-04']);
  assert.deepEqual(plain(next['2026-11-03'].sessions),['Cycling'],'a ride fills an empty day');
  const typical=app.typicalLoads(next,'2026-11-06');
  assert.deepEqual(NEW.map(s=>app.sessionLoad(typical,s)),[70,95,110]);
});

test('the weekly planner keeps them and never plans them itself',()=>{
  const input=app.planWeekInput({'2026-11-10':{sessions:['Padel']},'2026-11-11':{sessions:['Gym']}},'2026-11-09','2026-11-06');
  const byDate=Object.fromEntries(input.days.map(d=>[d.date,d]));
  assert.equal(byDate['2026-11-10'].fixed,true,'his own sport is fixed');
  assert.equal(byDate['2026-11-11'].fixed,false);
  assert.match(PLAN_SYSTEM_PROMPT,/Padel \(intense like Futsal.*Never plan them yourself\./);
});
