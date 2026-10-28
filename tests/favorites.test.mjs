import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const SK ='),source.indexOf('// Midnight & Ice.'))
  +source.slice(source.indexOf('const PHASE_LABELS'),source.indexOf('function Icon'));
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-04T08:00:00+01:00']));}};
const app=vm.runInNewContext(helpers+`\n({saveFavorite,removeFavorite,useFavorite,favoriteList,findFavorite,mealFromFavorite,
  dayProtein,dayKcal,buildCoachContext,MAX_FAVORITES})`,{Date:FixedDate});

const shake={id:'m1',at:'07:30',title:'Proteinshake',kcal:180,protein:30.4};
const muesli={id:'m2',at:'08:00',title:'Müesli mit Quark',kcal:520,protein:34,items:[{name:'Quark',grams:250,kcal:170,protein:28}],confidence:'high',kcalLow:450,kcalHigh:600};

test('saving a meal creates a favourite; the same name updates it instead of duplicating',()=>{
  let list=app.saveFavorite([],muesli,'2026-11-01');
  assert.equal(list.length,1);
  assert.deepEqual(plain({...list[0],id:undefined}),{title:'Müesli mit Quark',kcal:520,protein:34,items:muesli.items,uses:0,lastUsed:null,created:'2026-11-01'});
  const id=list[0].id;
  list=app.saveFavorite(list,{title:'  müesli mit quark ',kcal:480,protein:36},'2026-11-03');
  assert.equal(list.length,1,'case and spaces do not matter');
  assert.equal(list[0].id,id);assert.equal(list[0].kcal,480);assert.equal(list[0].created,'2026-11-01');
  assert.equal(app.saveFavorite(list,{title:'  ',kcal:100,protein:5}).length,1,'no name → unchanged');
  assert.equal(app.saveFavorite(list,{title:'X',kcal:-1,protein:5}).length,1,'invalid values are ignored');
  assert.equal(app.saveFavorite(list,{title:'Shake',kcal:150,protein:30.6}).find(f=>f.title==='Shake').protein,31,'rounded');
});

test('using a favourite counts it, sorts it first and adds a meal that counts like any other',()=>{
  let list=app.saveFavorite(app.saveFavorite([],muesli,'2026-11-01'),shake,'2026-11-02');
  const shakeFav=list.find(f=>f.title==='Proteinshake');
  list=app.useFavorite(list,shakeFav.id,'2026-11-04');
  list=app.useFavorite(list,shakeFav.id,'2026-11-04');
  assert.deepEqual(plain(list.map(f=>[f.title,f.uses])),[['Proteinshake',2],['Müesli mit Quark',0]]);
  assert.equal(list[0].lastUsed,'2026-11-04');
  const meal=app.mealFromFavorite(list[1],'12:10','f1');
  assert.deepEqual(plain(meal),{id:'f1',at:'12:10',title:'Müesli mit Quark',kcal:520,protein:34,items:muesli.items,favoriteId:list[1].id,source:'favorite'});
  const day={protein:20,meals:[meal,app.mealFromFavorite(list[0],'','f2')]};
  assert.equal(app.dayProtein(day),20+34+30);
  assert.equal(app.dayKcal(day),700);
  assert.equal(app.findFavorite(list,meal).title,'Müesli mit Quark','found by id');
  assert.equal(app.findFavorite(list,{title:'PROTEINSHAKE'}).uses,2,'found by name');
  assert.equal(app.findFavorite(app.removeFavorite(list,list[1].id),meal),null,'removed');
});

test('the list keeps at most twelve favourites and drops the least used one',()=>{
  let list=[];
  for(let i=0;i<app.MAX_FAVORITES;i++)list=app.saveFavorite(list,{title:'Essen '+i,kcal:100+i,protein:10},'2026-11-01');
  for(const f of list.filter(f=>f.title!=='Essen 3'))list=app.useFavorite(list,f.id,'2026-11-02');
  list=app.saveFavorite(list,{title:'Neu',kcal:300,protein:20},'2026-11-03');
  assert.equal(list.length,app.MAX_FAVORITES);
  assert.ok(list.some(f=>f.title==='Neu'));
  assert.ok(!list.some(f=>f.title==='Essen 3'),'the only unused one goes');
  assert.equal(app.favoriteList([{id:'x',title:'',kcal:1,protein:1},null,{id:'y',title:'ok',kcal:1,protein:1}]).length,1,'invalid entries are skipped');
});

test('the coach sees which meals came from favourites',()=>{
  const fav=app.saveFavorite([],shake,'2026-11-01')[0];
  const plan={'2026-11-04':{meals:[{...muesli},app.mealFromFavorite(fav,'10:00','f1')]}};
  const ctx=app.buildCoachContext(plan,'Niko','2026-11-04','2026-11-04');
  assert.deepEqual(plain(ctx.today.nutrition.meals),[
    {title:'Müesli mit Quark',kcal:520,proteinGrams:34},
    {title:'Proteinshake',kcal:180,proteinGrams:30,fromFavorite:true}]);
  assert.match(readFileSync(new URL('../api/coach.js',import.meta.url),'utf8'),/meals with fromFavorite were added with one tap/);
});
