import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual single-file app's pure data helpers without a DOM or dependencies.
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'));
const bodyHelpers=source.slice(source.indexOf('function bodyCompReadings'),source.indexOf('// Minimal responsive SVG line chart'));
const FixedDate=class extends Date {
  constructor(...args){super(...(args.length?args:['2026-10-24T12:00:00+02:00']));}
};
const api=vm.runInNewContext(helpers+'\n'+bodyHelpers+'\n({SK,buildDefaultPlan,getSessions,displayName,daysUntil,weekIndexFor,tacticalFor,bodyCompReadings,rollingSeries,PHASE_TARGETS,sessionSubtitle,TIPS,ALTS,TACTICAL_PROMPTS,FEELINGS,MILESTONES})',{Date:FixedDate});
const plain=value=>JSON.parse(JSON.stringify(value));

test('date-reset siblings in TodayView have distinct keys on every day',()=>{
  // Both siblings remount on navigation, but must never share a React key.
  // This guards the exact collision that left previous days' cards in the DOM.
  const today=source.slice(source.indexOf('function TodayView'),source.indexOf('function WeekView'));
  const cardKey=today.match(/<section key=\{([^}]+)\}/)?.[1];
  const bodyKey=today.match(/<BodyCompLine key=\{([^}]+)\}/)?.[1];
  assert.ok(cardKey&&bodyKey);
  const seen=new Set();
  for(const viewKey of ['2026-09-23','2026-09-24','2026-09-25','2026-09-26']){
    for(const expression of [cardKey,bodyKey]){
      const key=vm.runInNewContext(expression,{viewKey});
      assert.equal(seen.has(key),false,'each day/component needs an independent key');
      seen.add(key);
    }
  }
});

test('redesign keeps the storage key, templates and legacy session IDs',()=>{
  assert.equal(api.SK,'soccer-v3');
  const plan=api.buildDefaultPlan();
  assert.deepEqual(plain(plan['2026-09-28'].sessions),['Gym','Mobility']);
  assert.deepEqual(plain(plan['2026-09-29'].sessions),['Futsal']);
  assert.equal(plan['2026-07-12'],undefined);
  assert.equal(plan['2027-07-05'],undefined);
  assert.deepEqual(plain(api.getSessions({workout:'Futsal',completed:true})),['Futsal']);
  assert.equal(api.displayName('Futsal'),'Freizeitkick/Futsal');
  assert.equal(api.displayName('Mobility'),'Prävention/Reha');
  assert.equal(api.displayName('Gym'),'Krafttraining');
  assert.equal(api.displayName('⋯ My own session'),'⋯ My own session');
  for(const [phase,targets] of Object.entries(api.PHASE_TARGETS)){
    if(phase==='Summer Break')assert.deepEqual(plain(targets),{});
    else assert.equal(targets.Gym,2,phase+' gym goal');
  }
});

test('every session type has distinct German planned and completed card copy',()=>{
  const planned=new Set(),done=new Set();
  for(const {label} of api.ALTS){
    assert.ok(api.TIPS[label]?.summary,label+' summary');
    assert.ok(api.TIPS[label]?.done,label+' completion summary');
    const entry={sessions:[label],completed:false};
    const before=api.sessionSubtitle(entry),after=api.sessionSubtitle({...entry,completed:true});
    assert.notEqual(before,after);planned.add(before);done.add(after);
    assert.equal(api.sessionSubtitle({workout:label}),before,'legacy model');
  }
  assert.equal(planned.size,api.ALTS.length);assert.equal(done.size,api.ALTS.length);
  const combo={sessions:['Gym','Mobility']};
  assert.match(api.sessionSubtitle(combo),/Kraft aufbauen.*stabilisieren.*Mobilität/);
  assert.equal(api.sessionSubtitle(combo),api.sessionSubtitle({sessions:['Mobility','Gym']}));
  assert.equal(api.sessionSubtitle({sessions:['Match','Walking']}),api.TIPS.Match.summary+' '+api.TIPS.Walking.summary);
  assert.match(api.sessionSubtitle({sessions:['⋯ Schwimmen']}),/Schwimmen/);
  assert.equal(api.sessionSubtitle({sessions:[]}),'Erholung gehört zum Training.');
  assert.deepEqual(combo,{sessions:['Gym','Mobility']},'no plan mutation');
});

test('English built-in copy is replaced; coach is explicitly instructed to answer in German',()=>{
  const copy=JSON.stringify([api.TIPS,api.TACTICAL_PROMPTS,api.FEELINGS.map(f=>f.label),api.MILESTONES.map(m=>[m.title,m.message])]);
  assert.doesNotMatch(copy,/Defensive shape|First session logged|Drained|Game day|How should|On fire/);
  assert.doesNotMatch(source,/>LOG<|>Rest day<|\["journey","Journey"\]|Dein Plan steht\. Mach ihn/);
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/Always respond in German/);
});

test('calendar navigation counts dates rather than DST-dependent hours',()=>{
  assert.equal(api.daysUntil('2026-10-25'),1);
  assert.equal(api.daysUntil('2026-10-26'),2);
  assert.equal(api.daysUntil('2026-10-23'),-1);
  assert.equal(api.weekIndexFor('2026-10-26')-api.weekIndexFor('2026-10-19'),1);
  assert.deepEqual(plain(api.tacticalFor('2026-10-25')),plain(api.tacticalFor('2026-10-19')));
});

test('body trends tolerate future, missing and malformed measurements',()=>{
  const plan={'2026-10-20':{weight:80},'2026-10-22':{weight:78},'2026-10-23':{weight:null},'2026-10-24':{weight:'not a number'},'2026-10-25':{weight:79}};
  const readings=api.bodyCompReadings(plan,'weight');
  assert.equal(readings.length,2);
  const series=api.rollingSeries(readings,'2026-10-20','2026-10-24');
  assert.equal(series.at(-1).value,79);
  assert.deepEqual(plain(api.bodyCompReadings({'2026-10-25':{bodyFat:15}},'bodyFat')),[]);
});

test('retired check-ins are not included in server coach context',()=>{
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  const contextCode=coach.slice(coach.indexOf('function buildContextBlock'),coach.indexOf('// Keep only well-formed'));
  const context=vm.runInNewContext(contextCode+'\nbuildContextBlock');
  const text=context({playerName:'Test',today:{workout:'Pickup/Futsal'},readiness:{hip:'red',legs:'amber'}});
  assert.match(text,/Pickup\/Futsal/);
  assert.doesNotMatch(text,/readiness|Left hip|general freshness/);
});
