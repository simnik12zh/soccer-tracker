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
const api=vm.runInNewContext(helpers+'\n'+bodyHelpers+'\n({SK,buildDefaultPlan,getSessions,displayName,daysUntil,weekIndexFor,tacticalFor,bodyCompReadings,rollingSeries,PHASE_TARGETS})',{Date:FixedDate});
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
  assert.equal(api.displayName('Futsal'),'Pickup/Futsal');
  assert.equal(api.displayName('Mobility'),'Prehab/Rehab');
  assert.equal(api.PHASE_TARGETS['Autumn Season'].Gym,1);
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
