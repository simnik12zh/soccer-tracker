import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Anthropic from '@anthropic-ai/sdk';
import {accessDenied} from '../api/_lib/access.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'))
  +source.slice(source.indexOf('const BF_GOAL ='),source.indexOf('// Minimal responsive SVG line chart'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+`\n({planSocialMatch,cancelSocialMatch,evaluateSocialMatch,socialPending,socialTable,socialRules,friendlyAllowed,
  addHoliday,removeHoliday,holidayTournaments,socialForCoach,socialStarted,reminderStatus,weeklyReportFacts,buildCoachContext,DEFAULT_SOCIAL_RULES})`,{Date:FixedDate});

// Friday 30 Oct 2026, 12:00 in Zurich.
const NOON=new FixedDate('2026-10-30T12:00:00+01:00');
const at=iso=>new FixedDate(iso);
const RULES=['Maximal zwei Drinks','Ein Extra: Brot, Vorspeise oder Dessert','Ein Teller, kein Nachschöpfen'];
const plan=(list,input,holidays=[],now=NOON)=>app.planSocialMatch(list,input,holidays,now);

test('a match needs three different rules, a future kick-off and its own day',()=>{
  const r=plan([],{date:'2026-10-30',kickoff:'19:30',occasion:'restaurant',rules:RULES});
  assert.equal(r.error,undefined);
  assert.deepEqual(plain({...r.match,id:undefined}),{date:'2026-10-30',kickoff:'19:30',occasion:'restaurant',rules:RULES,friendly:false,result:null,created:'2026-10-30'});
  assert.match(plan([],{date:'2026-10-31',rules:RULES.slice(0,2)}).error,/drei verschiedene/);
  assert.match(plan([],{date:'2026-10-31',rules:[RULES[0],RULES[0],RULES[1]]}).error,/drei verschiedene/);
  assert.match(plan([],{date:'2026-10-30',kickoff:'11:00',rules:RULES}).error,/Anpfiff muss noch vor dir liegen/,'no planning after kick-off');
  assert.match(plan([],{date:'2026-10-29',rules:RULES}).error,/heute oder einen späteren Tag/);
  assert.match(plan(r.list,{date:'2026-10-30',kickoff:'21:00',rules:RULES}).error,/schon ein Social Match/);
  assert.equal(plan([],{date:'2026-10-31',rules:RULES}).match.kickoff,'19:00','default kick-off');
  assert.deepEqual(plain(app.socialRules(null)),RULES);
});

test('rules can change until kick-off, never after; scoring only after kick-off',()=>{
  const {list,match}=plan([],{date:'2026-10-30',kickoff:'19:00',occasion:'bar',rules:RULES});
  const edited=plan(list,{...match,rules:[RULES[0],RULES[1],'Kein Snack danach']},[],at('2026-10-30T18:30:00+01:00'));
  assert.equal(edited.error,undefined);assert.equal(edited.list.length,1);
  const late=plan(edited.list,{...edited.match,rules:RULES},[],at('2026-10-30T19:05:00+01:00'));
  assert.match(late.error,/läuft schon/);
  assert.equal(app.evaluateSocialMatch(edited.list,match.id,[true,true,true],at('2026-10-30T18:59:00+01:00'))[0].result,null,'not before kick-off');
  const after=at('2026-10-30T23:10:00+01:00');
  assert.equal(app.socialPending(edited.list,after).length,1,'waits for the result');
  const draw=app.evaluateSocialMatch(edited.list,match.id,[true,false,true],after);
  assert.deepEqual(plain(draw[0].result),{kept:[true,false,true],outcome:'draw',points:1,at:'2026-10-30'});
  assert.equal(app.evaluateSocialMatch(edited.list,match.id,[true,false],after)[0].result,null,'three answers needed');
  assert.equal(app.socialPending(draw,after).length,0);
  assert.equal(app.cancelSocialMatch(draw,match.id).length,1,'a scored match cannot be removed');
  assert.equal(app.cancelSocialMatch(edited.list,match.id).length,0,'an unscored one can (did not happen)');
});

test('table: win 3, draw 1, loss 0; Testspiele never count',()=>{
  let list=[],day=0;
  const add=(kept,friendly=false)=>{
    const date=`2026-11-${String(2+day++).padStart(2,'0')}`;
    const r=plan(list,{date,kickoff:'19:00',rules:RULES,friendly},[],at('2026-11-01T10:00:00+01:00'));
    assert.equal(r.error,undefined,date);list=r.list;
    if(kept)list=app.evaluateSocialMatch(list,r.match.id,kept,at(`${date}T23:00:00+01:00`));
  };
  add([true,true,true]);add([true,true,false]);add([false,true,false]);add(null,true);add([true,true,true]);
  const t=app.socialTable(list,null,null,'2026-11-30');
  assert.equal(app.socialTable(list).friendlies,0,'a Testspiel still ahead is not counted yet');
  assert.deepEqual(plain({...t,brokenRules:undefined}),{played:4,wins:2,draws:1,losses:1,points:7,avg:1.8,form:['win','draw','loss','win'],friendlies:1});
  assert.deepEqual(plain(t.brokenRules[0]),{rule:'Ein Teller, kein Nachschöpfen',times:2});
});

test('Testspiele: one per week, in holidays one every three days',()=>{
  const now=at('2026-11-02T08:00:00+01:00');
  const first=plan([],{date:'2026-11-03',friendly:true},[],now);
  assert.equal(first.error,undefined);
  assert.match(plan(first.list,{date:'2026-11-07',friendly:true},[],now).error,/Höchstens eins pro Woche/);
  assert.equal(plan(first.list,{date:'2026-11-09',friendly:true},[],now).error,undefined,'next week is fine');
  const hol=app.addHoliday([],{name:'Skiferien',start:'2026-12-26',end:'2027-01-03'});
  assert.equal(hol.error,undefined);
  let list=plan([],{date:'2026-12-27',friendly:true},hol.list,now).list;
  assert.match(plan(list,{date:'2026-12-29',friendly:true},hol.list,now).error,/eins alle drei Tage/);
  assert.equal(plan(list,{date:'2026-12-30',friendly:true},hol.list,now).error,undefined);
  assert.match(app.addHoliday(hol.list,{name:'X',start:'2027-01-02',end:'2027-01-05'}).error,/Überschneidet/);
  assert.match(app.addHoliday([],{start:'2027-01-05',end:'2027-01-02'}).error,/gültige Daten/);
  assert.equal(app.removeHoliday(hol.list,hol.list[0].id).length,0);
});

test('holiday tournaments, coach context, weekly report and reminders see the matches',()=>{
  const holidays=app.addHoliday([],{name:'Skiferien',start:'2026-12-26',end:'2027-01-03'}).list;
  const before=at('2026-12-20T10:00:00+01:00');
  let {list,match}=plan([],{date:'2026-12-27',kickoff:'19:00',occasion:'restaurant',rules:RULES},holidays,before);
  list=app.evaluateSocialMatch(list,match.id,[false,false,true],at('2026-12-27T23:30:00+01:00'));
  list=plan(list,{date:'2026-12-28',kickoff:'20:00',occasion:'bar',rules:RULES},holidays,before).list;
  const tour=app.holidayTournaments(list,holidays)[0];
  assert.equal(tour.name,'Skiferien');assert.deepEqual([tour.table.played,tour.table.losses,tour.table.points],[1,1,0]);

  const now=at('2026-12-28T12:00:00+01:00');
  const coach=app.socialForCoach(list,holidays,'2026-12-28',now);
  assert.equal(coach.goalAvgPoints,2);
  assert.equal(coach.holiday.name,'Skiferien');
  assert.deepEqual(plain(coach.upcoming[0]),{date:'2026-12-28',kickoff:'20:00',occasion:'Bar',friendly:false,rules:RULES});
  assert.deepEqual(plain(coach.recent[0].brokenRules),RULES.slice(0,2));
  assert.equal(coach.recent[0].outcome,'Niederlage');
  const ctx=app.buildCoachContext({},'Niko','2026-12-28','2026-12-28',100,[],{matches:list,holidays});
  assert.equal(ctx.social.holiday.table.played,1);
  const backend=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'').replace('export default async function handler','async function handler');
  const api=vm.runInNewContext(backend+'\n({buildContextBlock,SYSTEM_PROMPT})',{Anthropic,accessDenied,process:{env:{}},console});
  assert.match(api.buildContextBlock(plain(ctx)),/"social":\{"goalAvgPoints":2/);
  assert.match(api.SYSTEM_PROMPT,/one broken rule is a goal conceded, not a lost game/);

  const facts=app.weeklyReportFacts({},'2026-12-21',100,[],{matches:list,holidays});
  assert.deepEqual([facts.social.played,facts.social.losses,facts.social.avg],[1,1,0]);
  assert.equal(facts.social.form,undefined);

  const status=app.reminderStatus({},'2026-12-28',100,{matches:list,holidays});
  assert.deepEqual(plain(status.days['2026-12-28'].social),{kickoff:'20:00',friendly:false,rules:RULES});
  assert.equal(status.days['2026-12-29'].evaluate,1,'the 28th is not scored yet the next day');
  assert.equal(status.days['2026-12-28'].evaluate,undefined,'the 27th was scored');

  const listeners={},sw={self:{addEventListener:(type,fn)=>{listeners[type]=fn;},clients:{},registration:{}},caches:{}};
  vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),sw);
  const text=(slot,day)=>plain(sw.reminderText(slot,{days:{'2026-12-28':day}},'2026-12-28'));
  assert.deepEqual(text('midday',status.days['2026-12-28']),{title:'Matchtag · Anpfiff 20:00',body:RULES.join(' · ')});
  assert.deepEqual(text('evening',status.days['2026-12-28']),{title:'Social Match läuft',body:RULES.join(' · ')+'. Zu Hause auswerten.'});
  assert.deepEqual(text('midday',{open:['Training','Ernährung bewerten'],evaluate:1}),{title:'Zwischenstand',body:'Social Match auswerten. Noch offen: Training'});
  assert.deepEqual(text('midday',{open:['Training'],social:{kickoff:'19:00',friendly:true,rules:[]}}),{title:'Zwischenstand',body:'Noch offen: Training'},'a Testspiel is not announced');
});
