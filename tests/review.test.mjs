import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T22:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+'\n({reviewKind,sessionReview,reviewOutlook,buildCoachContext})',{Date:FixedDate});

const soccer=(id,minutes,distanceKm,maxSpeedKmh,avgHr,load,highHrMin)=>({id,type:'soccer',minutes,distanceKm,maxSpeedKmh,avgHr,load,highHrMin,matched:true});
const game=(opponent,g)=>({sessions:['Match'],completed:true,match:{opponent,home:true,kickoff:'20:30'},garmin:[g]});
// Five autumn games before the cup game, and team trainings with much higher numbers
// that must never leak into the game comparison.
function season(){
  return {
    '2026-10-02':game('FC UBS 1 AG',soccer('m1',94,8.9,27.9,148,148,27)),
    '2026-10-12':game('FC Ränte',soccer('m2',96,9.3,28.3,151,162,31)),
    '2026-10-16':game('FC Ristorante Da Carlo',soccer('m3',92,8.7,27.1,146,139,24)),
    '2026-10-26':game('Shamrock Football Club',soccer('m4',95,9.2,27.6,149,155,29)),
    '2026-10-31':game('FC Ränte',soccer('m5',93,9.0,27.8,150,151,28)),
    '2026-10-22':{sessions:['Team Training'],completed:true,garmin:[soccer('t1',90,12,31,170,400,60)]},
    '2026-10-29':{sessions:['Team Training'],completed:true,garmin:[soccer('t2',90,12,31,170,400,60)]},
    '2026-11-02':game('Shamrock Football Club',soccer('m6',97,9.8,27.4,153,186,38)),
  };
}

test('the plan tells a game from a training; only comparable kinds get a review',()=>{
  const plan=season();
  assert.equal(app.reviewKind(plan['2026-11-02'],plan['2026-11-02'].garmin[0]),'match');
  assert.equal(app.reviewKind(plan['2026-10-22'],plan['2026-10-22'].garmin[0]),'training');
  assert.equal(app.reviewKind({sessions:['Futsal']},{type:'soccer'}),'futsal');
  assert.equal(app.reviewKind({sessions:['Easy run']},{type:'trail_running'}),'run');
  assert.equal(app.reviewKind({sessions:['Gym']},{type:'strength_training'}),'gym');
  assert.equal(app.reviewKind({sessions:['Walking']},{type:'walking'}),null);
});

test('a game is compared with earlier games only: verdict, sentence and where each value sits',()=>{
  const r=app.sessionReview(season(),'2026-11-02','m6');
  assert.equal(r.ready,true);
  assert.equal(r.count,6,'the five earlier games plus this one; trainings stay out');
  assert.equal(r.headline,'Intensives Spiel');
  assert.equal(r.level,3);
  const load=r.rows.find(x=>x.key==='load');
  assert.deepEqual([load.med,load.lo,load.hi,load.status],[151,139,186,'Höchstwert von 6']);
  assert.equal(r.rows.find(x=>x.key==='maxSpeedKmh').status,'im Schnitt');
  assert.equal(r.sentence,'Belastung 186, rund 23 % über deinem Schnitt (151). Mehr intensive Minuten (38 statt 28 min). Mehr gelaufen als sonst (9.8 statt 9.0 km).');
});

test('a short game is judged per minute and can be scaled to the usual duration',()=>{
  const plan=season();
  plan['2026-11-02']=game('Shamrock Football Club',soccer('m6',64,6.1,27.9,150,104,21));
  const r=app.sessionReview(plan,'2026-11-02','m6');
  assert.equal(r.short,true);
  assert.equal(r.headline,'Kurzer Einsatz');
  assert.equal(r.level,2,'104 in 64 minutes is a normal intensity');
  assert.equal(r.sentence,'64 statt 94 Minuten. Pro Minute so intensiv wie sonst: Auf deine übliche Dauer hochgerechnet wären es ≈ 153 Belastung und 9.0 km.');
  assert.equal(r.rows.find(x=>x.key==='load').status,'Tiefstwert von 6');
  const scaled=app.sessionReview(plan,'2026-11-02','m6',true);
  assert.equal(Math.round(scaled.rows.find(x=>x.key==='load').v),153);
  assert.equal(scaled.rows.find(x=>x.key==='maxSpeedKmh').v,27.9,'top speed is not scaled');
});

test('too few sessions of a kind: values only; a faster run at a lower pulse says so',()=>{
  const plan={'2026-10-21':{sessions:['Gym'],completed:true,garmin:[{id:'g1',type:'strength_training',minutes:46,avgHr:114,load:55}]},
    '2026-10-28':{sessions:['Gym'],completed:true,garmin:[{id:'g2',type:'strength_training',minutes:48,avgHr:112,load:52}]}};
  const gym=app.sessionReview(plan,'2026-10-28','g2');
  assert.equal(gym.ready,false);
  assert.equal(gym.headline,'Krafttraining');
  assert.deepEqual(plain(gym.plain.map(x=>x.key)),['minutes','avgHr','load']);
  const run=(id,minutes,distanceKm,avgHr,load)=>({sessions:['Easy run'],completed:true,garmin:[{id,type:'running',minutes,distanceKm,avgHr,load}]});
  const runs={'2026-10-06':run('r1',37,5.9,142,55),'2026-10-13':run('r2',35.5,5.6,144,52),'2026-10-20':run('r3',38,6.0,141,57),'2026-10-27':run('r4',37.5,6.2,139,58)};
  const r=app.sessionReview(runs,'2026-10-27','r4');
  assert.equal(r.headline,'Normaler Lauf');
  assert.match(r.sentence,/Schneller als sonst \(6:03 statt 6:20 pro km\)/);
  assert.match(r.sentence,/Ein gutes Zeichen für deine Grundausdauer\.$/);
  assert.equal(r.rows.find(x=>x.key==='pace').status,'schnellster von 4');
});

test('the evening after a game: share of the week, tomorrow is a calm day, and the coach gets the comparison',()=>{
  // Only the game itself: too little watch history for the load, so the calendar decides tomorrow.
  const only={'2026-11-02':season()['2026-11-02']};
  const first=app.reviewOutlook(only,'2026-11-02',186,[],'2026-11-02');
  assert.equal(first.share,null,'no usual week yet');
  assert.deepEqual(plain(first.next),{when:'Morgen',level:'caution',label:'Ruhiger Tag',text:'Nach dem Spiel nur Spazieren oder Mobilität.'});
  // With the two heavy trainings in the same week the load is far above his range: red wins.
  const plan=season();
  const out=app.reviewOutlook(plan,'2026-11-02',186,[],'2026-11-02');
  assert.match(out.share,/^186 sind \d+ % deiner üblichen Woche \(≈ \d+\)\.$/);
  assert.deepEqual(plain(out.next),{when:'Morgen',level:'low',label:'Erholungstag',text:'Du liegst deutlich über deinem Bereich.'});
  assert.equal(app.reviewOutlook(plan,'2026-10-26',155,[],'2026-11-02').next,null,'older sessions get no outlook');
  const ctx=app.buildCoachContext(plan,'Test','2026-11-02','2026-11-02');
  const game=ctx.sessionReviews.find(x=>x.date==='2026-11-02');
  assert.equal(game.kind,'Spiel');
  assert.equal(game.verdict,'Intensives Spiel');
  assert.equal(game.comparedWithPrevious,5);
  assert.deepEqual(plain(game.values[0]),{metric:'Belastung',value:'186',average:'151',range:'139–186',status:'Höchstwert von 6'});
  const coach=readFileSync(new URL('../api/coach.js',import.meta.url),'utf8');
  assert.match(coach,/'trends','sessionReviews','lastWeeklyReport'/,'the server passes the reviews on');
});
