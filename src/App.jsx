import { useState, useEffect, useRef } from "react";

const SK = "soccer-v1";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DL = ["M","T","W","T","F","S","S"];
const DN = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function pad(n) { return String(n).padStart(2,"0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayStr() { return dateKey(new Date()); }
function offsetDate(off) { const d=new Date(); d.setDate(d.getDate()+off); return dateKey(d); }

// Storage: localStorage works in published artifacts with no login required.
async function storeGet(key) { try { return localStorage.getItem(key); } catch(e) { return null; } }
async function storeSet(key, value) { try { localStorage.setItem(key, value); } catch(e) {} }

function daysUntil(ds) {
  if (!ds) return null;
  const t=new Date(ds+"T00:00:00"), n=new Date(); n.setHours(0,0,0,0);
  return Math.ceil((t-n)/86400000);
}
// Mon=0 … Sun=6 weekday index.
function dow0(d) { return (d.getDay()+6)%7; }
function weekOf(off=0) {
  const n=new Date(), mon=new Date(n);
  mon.setDate(n.getDate()-dow0(n)+off*7);
  return Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return dateKey(d); });
}
function monthGrid(y,m) {
  const skip=(new Date(y,m,1).getDay()+6)%7, total=new Date(y,m+1,0).getDate();
  return [...Array(skip).fill(null),...Array.from({length:total},(_,i)=>`${y}-${pad(m+1)}-${pad(i+1)}`)];
}
// YYYY-MM-DD string n days before the given date string.
function daysBeforeStr(dateStr, n) {
  const d=new Date(dateStr+"T00:00:00"); d.setDate(d.getDate()-n); return dateKey(d);
}

// ─── Season phases ──────────────────────────────────────────────────────────────
const PHASES = [
  { name:'Off-Season',   start:'2026-06-29', end:'2026-08-05',
    description:'Gym consistency and body composition. Build the athletic base. Two gym sessions per week minimum.', color:'#E8174A' },
  { name:'Pre-Season',   start:'2026-08-06', end:'2026-09-06',
    description:'Conditioning ramp-up. Team training resumes. Stay sharp and arrive fit.', color:'#E8174A' },
  { name:'Autumn Season',start:'2026-09-07', end:'2026-11-15',
    description:'Perform. Recover. Maintain fitness. Matches on Mondays — manage your load around them.', color:'#E8174A' },
  { name:'Winter Break', start:'2026-11-16', end:'2027-04-04',
    description:'Prime body composition window. Gym consistency block. Build strength for spring.', color:'#E8174A' },
  { name:'Spring Season',start:'2027-04-05', end:'2027-06-30',
    description:'Perform. Maintain. Manage load. Finish the season strong.', color:'#E8174A' },
  { name:'Summer Break', start:'2027-07-01', end:'2027-08-05',
    description:'Rest. Recover. Recharge. You earned it.', color:'#E8174A' },
];
const SEASON_START = '2026-06-29';
const SEASON_END = '2027-08-05';

function phaseForDate(dk) {
  for (const p of PHASES) if (dk>=p.start && dk<=p.end) return p;
  return null;
}

// Weekly templates per phase — [Mon…Sun].
const TEMPLATES = {
  'Off-Season':    ['Pilates','Futsal','Gym',null,'Gym',null,null],
  'Pre-Season':    ['Pilates','Futsal','Gym','Team Training',null,'Gym',null],
  'Autumn Season': ['Match','Futsal','Gym','Team Training',null,'Gym','Pilates'],
  'Winter Break':  ['Gym','Futsal','Gym','Pilates',null,'Gym',null],
  'Spring Season': ['Match','Futsal','Gym','Team Training',null,'Gym','Pilates'],
  'Summer Break':  [null,null,null,null,null,null,null],
};
// Holiday overrides ([Mon…Sun]).
const TUSCANY_W1 = [null,'Easy run',null,'Easy run',null,null,'Easy run']; // Aug 22–28: light only
const TUSCANY_W2 = [null,'Easy run',null,null,null,null,null];             // Aug 29–Sep 5: minimal

// Build the full day-by-day plan from SEASON_START through SEASON_END by applying
// the correct weekly template for each phase, with Ibiza and Tuscany overrides.
function buildDefaultPlan() {
  const plan={};
  const d=new Date(2026,5,29);
  while (dateKey(d)<=SEASON_END) {
    const dk=dateKey(d), phase=phaseForDate(dk);
    if (phase) {
      const wd=dow0(d);
      let w=TEMPLATES[phase.name][wd];
      if (dk>='2026-07-10'&&dk<='2026-07-15') w=null;                 // Ibiza: rest
      else if (dk>='2026-08-22'&&dk<='2026-08-28') w=TUSCANY_W1[wd];  // Tuscany week 1
      else if (dk>='2026-08-29'&&dk<='2026-09-05') w=TUSCANY_W2[wd];  // Tuscany week 2
      if (w) plan[dk]={ workout:w, completed:false, notes:'', feeling:null };
    }
    d.setDate(d.getDate()+1);
  }
  return plan;
}

// ─── Session types ──────────────────────────────────────────────────────────────
const TIPS = {
  'Match': { emoji:'⚽', label:'Match day', color:'#E8174A',
    text:'Game day. Arrive early, warm up properly. Focus on scanning before every touch — decide before you receive. Defend with your brain first.' },
  'Team Training': { emoji:'🏃', label:'Team session', color:'#E8174A',
    text:'Team session. Work on your positioning and communication. Practice scanning constantly — build the habit in training so it\'s automatic in matches.' },
  'Futsal': { emoji:'🏟️', label:'Futsal', color:'#E8174A',
    text:'Fast game, small spaces. Perfect for sharpening your first touch and decision speed. Focus on quick scanning before receiving.' },
  'Gym': { emoji:'🏋️', label:'Gym session', color:'#E8174A',
    text:'Full body strength work. Include glute med activation and hip stability in your warm-up. Consistency here is what separates you from where you want to be.' },
  'Pilates': { emoji:'🤸', label:'Pilates', color:'#FF6B9D',
    text:'Core strength, stability, posture. Especially important for hip stability and longevity. This is your injury prevention session — don\'t skip it.' },
  'Easy run': { emoji:'🏃', label:'Light run', color:'#FF6B9D',
    text:'Easy pace only. This is active recovery, not fitness work. Keep it conversational and short.' },
  'Walking': { emoji:'🚶', label:'Walking', color:'#FF6B9D',
    text:'Active recovery. Keep moving without loading the body.' },
};
function getTip(workout) {
  if (!workout) return null;
  const w=workout.toLowerCase();
  if (w.includes('match')) return TIPS['Match'];
  if (w.includes('team training')) return TIPS['Team Training'];
  if (w.includes('futsal')) return TIPS['Futsal'];
  if (w.includes('gym')) return TIPS['Gym'];
  if (w.includes('pilates')) return TIPS['Pilates'];
  if (w.includes('easy run')) return TIPS['Easy run'];
  if (w.includes('walking')) return TIPS['Walking'];
  return null;
}

// Emoji for a session label (also covers swapped / non-template sessions).
const EMOJI = {
  'Match':'⚽','Team Training':'🏃','Futsal':'🏟️','Gym':'🏋️',
  'Pilates':'🤸','Walking':'🚶','Easy run':'🏃','Sick/Injured':'🤒',
};
function workoutEmoji(w) {
  if (!w || !w.trim()) return '';
  if (EMOJI[w]) return EMOJI[w];
  if (w.startsWith('⋯')) return '⋯';
  for (const k in EMOJI) if (w.includes(k)) return EMOJI[k];
  return '⚡';
}

// Bottom-sheet options for changing a session.
const ALTS = [
  { emoji:'⚽', label:'Match' },
  { emoji:'🏃', label:'Team Training' },
  { emoji:'🏟️', label:'Futsal' },
  { emoji:'🏋️', label:'Gym' },
  { emoji:'🤸', label:'Pilates' },
  { emoji:'🚶', label:'Walking' },
  { emoji:'🏃', label:'Easy run' },
  { emoji:'⋯', label:'Other', action:'other' },
  { emoji:'🤒', label:'Sick/Injured' },
  { emoji:'😴', label:'Rest day', action:'rest' },
];

const FEELINGS = [
  { value:1, emoji:"😫", label:"Drained" },
  { value:2, emoji:"😕", label:"Tough" },
  { value:3, emoji:"😐", label:"OK" },
  { value:4, emoji:"😊", label:"Good" },
  { value:5, emoji:"🔥", label:"On fire" },
];

// ─── Tactical prompt of the week ─────────────────────────────────────────────────
const TACTICAL_PROMPTS = [
  { focus:'Scan before every touch', detail:'Before receiving the ball, know your next action. Head up, check shoulders.' },
  { focus:'Watch a top right back', detail:'Find 10 minutes of Trent Alexander-Arnold or Reece James. Watch their positioning before the ball arrives.' },
  { focus:'Communicate early', detail:'Call for the ball or give instructions before the play develops. Be vocal.' },
  { focus:'Defensive shape', detail:'Check your distance from the centre back. Don\'t leave gaps. Compress space early.' },
  { focus:'Second ball aggression', detail:'Win the loose balls. Get there first. Your athleticism is an advantage — use it.' },
  { focus:'Post-match review', detail:'After your next match, note 2 moments where you scanned well and 1 where you didn\'t.' },
  { focus:'First touch direction', detail:'Your first touch should move you away from pressure. Practice receiving across your body.' },
  { focus:'Recovery runs', detail:'When possession is lost, be the first defender. Sprint back into shape immediately.' },
  { focus:'Anticipate, don\'t react', detail:'Read the striker\'s body position before they receive. Commit to your line early.' },
  { focus:'Watch your own footage', detail:'Review 5 minutes of your own match footage this week. Focus only on your positioning.' },
];
// Week index counted from the season-start Monday; rotates every Monday.
function weekIndexFor(dk) {
  const start=new Date(2026,5,29);
  const d=new Date(dk+"T00:00:00"); d.setDate(d.getDate()-dow0(d)); // Monday of dk's week
  return Math.floor((d-start)/(7*86400000));
}
function tacticalFor(dk) {
  const len=TACTICAL_PROMPTS.length;
  return TACTICAL_PROMPTS[((weekIndexFor(dk)%len)+len)%len];
}

// ─── Milestone celebrations ──────────────────────────────────────────────────────
// check(all, entry, phase) → boolean. `all` is every completed session
// ({...entry, date, phase}); `entry` is the just-logged one. One fires per log.
const MILESTONES = [
  { id:'first-session', check:(all)=>all.length===1,
    emoji:'⚽', title:'First session logged!',
    message:'Every elite player started somewhere. This is your somewhere.' },
  { id:'first-match', check:(all,entry)=>entry.workout==='Match'&&all.filter(e=>e.workout==='Match').length===1,
    emoji:'🏟️', title:'First match logged!',
    message:'Game on. This is what all the training is for.' },
  { id:'first-gym-week', check:(all)=>all.filter(e=>e.workout==='Gym').length===2,
    emoji:'🏋️', title:'First double gym week!',
    message:'Two gym sessions in a week. This is the pattern that changes everything.' },
  { id:'sessions-10', check:(all)=>all.length===10,
    emoji:'🔟', title:'10 sessions logged!',
    message:'10 sessions in. The habit is forming.' },
  { id:'sessions-25', check:(all)=>all.length===25,
    emoji:'💪', title:'25 sessions!',
    message:'Consistency is the hardest skill. You\'re building it.' },
  { id:'sessions-50', check:(all)=>all.length===50,
    emoji:'🌟', title:'50 sessions logged!',
    message:'50 sessions. This isn\'t a phase — it\'s who you are now.' },
  { id:'first-preseason', check:(all,entry,phase)=>phase==='Pre-Season'&&all.filter(e=>e.phase==='Pre-Season').length===1,
    emoji:'🚀', title:'Pre-season starts!',
    message:'The work you did in the off-season starts paying off now.' },
  { id:'first-match-season', check:(all,entry,phase)=>phase==='Autumn Season'&&all.filter(e=>e.workout==='Match'&&e.phase==='Autumn Season').length===1,
    emoji:'🏆', title:'First competitive match!',
    message:'Season is live. Everything you built in the off-season is for this.' },
  { id:'gym-streak-4', check:(all)=>all.filter(e=>e.workout==='Gym').length>=8,
    emoji:'🔥', title:'4 weeks of gym consistency!',
    message:'Four straight weeks in the gym. The on/off pattern is broken.' },
];

// ─── Colours (pink/red palette) ──────────────────────────────────────────────────
const C = {
  bg:"#FFF0F5", card:"#FFFFFF", surface:"#FFFFFF",
  border:"#F0C0D0", borderSt:"#E8174A",
  text:"#1A0A10", muted:"#9E6070",
  sage:"#FF6B9D", sageLt:"rgba(255,107,157,0.15)", sageDk:"#C0134A",
  warm:"#F0C0D0", done:"#E8174A", doneLt:"rgba(232,23,74,0.06)",
  accent:"#E8174A", subtle:"#FDE0EA",
};

// ─── Small chrome ────────────────────────────────────────────────────────────────
function Chk({size=14,color="#fff"}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M3 8.5l3.5 3.5 6.5-7" stroke={color} strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
function NavArrow({onClick,dir}) {
  return (
    <button onClick={onClick} aria-label={dir==="left"?"Previous":"Next"} style={{
      width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",
      background:"none",border:`1px solid ${C.border}`,borderRadius:12,
      cursor:"pointer",color:C.muted,fontSize:20,flexShrink:0,
      WebkitTapHighlightColor:"transparent"}}>{dir==="left"?"‹":"›"}</button>
  );
}
function TabIcon({name,size=23}) {
  const p={width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",
    strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};
  if (name==="today") return <svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2.5"/>
    <path d="M3 9h18M8 2.5v3.5M16 2.5v3.5"/>
    <circle cx="12" cy="15" r="1.7" fill="currentColor" stroke="none"/></svg>;
  if (name==="week") return <svg {...p}>
    <path d="M8 6h12M8 12h12M8 18h12"/>
    <circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none"/></svg>;
  if (name==="month") return <svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
  return <svg {...p}><path d="M5 21V3M5 4h12l-2 3.5L17 11H5"/></svg>;   // journey — flag
}

// ─── Tip card ────────────────────────────────────────────────────────────────────
function TipCard({workout}) {
  const tip=getTip(workout);
  if (!tip) return null;
  return (
    <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
      <span style={{display:'inline-block',fontSize:11,fontWeight:700,color:tip.color,
        background:'rgba(232,23,74,0.1)',borderRadius:20,padding:'4px 11px',marginBottom:9}}>
        {tip.emoji} {tip.label}
      </span>
      <p style={{margin:0,fontSize:13,color:C.muted,lineHeight:1.6,letterSpacing:"0.01em"}}>{tip.text}</p>
    </div>
  );
}

// ─── Tactical prompt card ────────────────────────────────────────────────────────
function TacticalCard({dk}) {
  const t=tacticalFor(dk);
  return (
    <div style={{marginTop:16,padding:'14px 16px',background:'rgba(255,107,157,0.07)',
      border:`1px solid ${C.border}`,borderRadius:14}}>
      <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em',
        color:C.sage,marginBottom:6}}>This week's focus</div>
      <div style={{fontSize:15,fontWeight:700,color:C.text,lineHeight:1.3,marginBottom:5}}>{t.focus}</div>
      <div style={{fontSize:13,color:C.muted,lineHeight:1.55}}>{t.detail}</div>
    </div>
  );
}

// ─── Setup / settings ────────────────────────────────────────────────────────────
function SetupScreen({initName,isEdit,onBack,onSave}) {
  const [n,setN]=useState(initName||"");
  const ok=n.trim();

  // Backup: export / import all local data.
  const fileRef=useRef(null);
  const [pendingImport,setPendingImport]=useState(null);
  const [importError,setImportError]=useState("");
  const exportData=()=>{
    const coach={};
    Object.keys(localStorage).filter(k=>k.startsWith('coach-')).forEach(k=>{ coach[k]=localStorage.getItem(k); });
    const data={ exportedAt:new Date().toISOString(), version:SK, plan:localStorage.getItem(SK), coach };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url; link.download=`soccer-backup-${new Date().toISOString().slice(0,10)}.json`;
    link.click(); URL.revokeObjectURL(url);
  };
  const onFilePick=(ev)=>{
    const file=ev.target.files&&ev.target.files[0];
    ev.target.value="";
    if (!file) return;
    setImportError("");
    const reader=new FileReader();
    reader.onload=()=>{
      try {
        const parsed=JSON.parse(reader.result);
        if (!parsed||!parsed.plan||!parsed.version) throw new Error("invalid");
        setPendingImport(parsed);
      } catch(e) { setPendingImport(null); setImportError("Invalid backup file — please select a valid soccer backup"); }
    };
    reader.onerror=()=>{ setPendingImport(null); setImportError("Invalid backup file — please select a valid soccer backup"); };
    reader.readAsText(file);
  };
  const confirmImport=()=>{
    const d=pendingImport;
    if (!d) return;
    try {
      localStorage.setItem(SK, typeof d.plan==='string'?d.plan:JSON.stringify(d.plan));
      if (d.coach&&typeof d.coach==='object') {
        Object.keys(d.coach).forEach(k=>{ if (k.startsWith('coach-')) localStorage.setItem(k, d.coach[k]); });
      }
      try { sessionStorage.setItem('justRestored','1'); } catch {}
      window.location.reload();
    } catch(e) { setPendingImport(null); setImportError("Invalid backup file — please select a valid soccer backup"); }
  };

  const inp={
    width:"100%",border:`1px solid ${C.border}`,borderRadius:12,
    padding:"14px 16px",fontFamily:"inherit",fontSize:16,color:C.text,
    background:C.bg,outline:"none",boxSizing:"border-box",WebkitAppearance:"none",
  };
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"system-ui,sans-serif",
      position:"relative",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",
      padding:"env(safe-area-inset-top,20px) 20px env(safe-area-inset-bottom,20px)"}}>
      {isEdit&&onBack&&(
        <div style={{position:"absolute",top:0,left:0,right:0,background:C.surface,
          borderBottom:`1px solid ${C.border}`,padding:"env(safe-area-inset-top,0px) 20px 0",
          display:"flex",alignItems:"center",gap:12,minHeight:56}}>
          <button onClick={onBack} aria-label="Back" style={{background:"none",border:"none",cursor:"pointer",
            color:C.muted,fontSize:24,width:44,height:44,display:"flex",alignItems:"center",
            justifyContent:"center",flexShrink:0,marginLeft:-10,WebkitTapHighlightColor:"transparent"}}>←</button>
          <span style={{fontSize:17,fontWeight:600,color:C.text}}>Settings</span>
        </div>
      )}
      {!isEdit&&<>
        <div style={{fontSize:56,marginBottom:20}}>⚽</div>
        <div style={{fontSize:28,fontWeight:700,textAlign:"center",marginBottom:10,
          lineHeight:1.25,color:C.text}}>Your season,<br/>your edge</div>
        <div style={{fontSize:15,color:C.muted,textAlign:"center",marginBottom:40,
          lineHeight:1.6,maxWidth:280}}>
          Your full-season plan is ready. Train smart, log every session, play for life.
        </div>
      </>}
      <div style={{background:C.surface,border:`1px solid ${C.border}`,
        borderRadius:20,padding:24,width:"100%",maxWidth:400}}>
        <label style={{fontSize:12,textTransform:"uppercase",letterSpacing:".08em",
          color:C.muted,display:"block",marginBottom:8}}>What's your name?</label>
        <input style={inp} placeholder="e.g. Nikola" value={n}
          onChange={e=>setN(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&ok) onSave(n.trim()); }}/>
        <button disabled={!ok} onClick={()=>onSave(n.trim())} style={{
          width:"100%",padding:16,background:ok?C.done:C.muted,color:"#fff",
          border:"none",borderRadius:14,fontFamily:"inherit",fontSize:17,fontWeight:600,
          cursor:ok?"pointer":"default",marginTop:24,WebkitTapHighlightColor:"transparent"}}>
          {isEdit?"Save changes":"Let's go →"}
        </button>
      </div>

      {isEdit&&(
        <div style={{width:"100%",maxWidth:400,marginTop:18}}>
          <button onClick={exportData} style={{width:"100%",padding:16,background:C.done,
            color:"#fff",border:"none",borderRadius:14,fontFamily:"inherit",fontSize:16,
            fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
            📥 Export my data
          </button>
          <div style={{display:"flex",flexDirection:"column",gap:5,margin:"16px 4px 20px"}}>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>Your data is stored on this device only.</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>After exporting, tap “More…” → “Save to Files” → iCloud Drive to keep a safe backup.</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>Restore anytime from the same file.</div>
          </div>
          <button onClick={()=>fileRef.current&&fileRef.current.click()} style={{width:"100%",padding:16,
            background:C.surface,color:C.sage,border:`1.5px solid ${C.sage}`,borderRadius:14,
            fontFamily:"inherit",fontSize:16,fontWeight:600,cursor:"pointer",
            WebkitTapHighlightColor:"transparent"}}>
            📤 Restore from backup
          </button>
          <input ref={fileRef} type="file" accept=".json" onChange={onFilePick} style={{display:"none"}}/>
          {importError&&(
            <div style={{marginTop:12,fontSize:13,color:"#c05050",textAlign:"center",lineHeight:1.4}}>{importError}</div>
          )}
          {pendingImport&&(
            <div style={{marginTop:14,padding:16,background:C.surface,border:`1px solid ${C.border}`,borderRadius:14}}>
              <div style={{fontSize:14,color:C.text,lineHeight:1.5,marginBottom:14}}>
                This will restore your training data. Your current data will be replaced. Continue?
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setPendingImport(null)} style={{flex:1,padding:13,
                  background:C.bg,border:`1px solid ${C.border}`,borderRadius:12,fontFamily:"inherit",
                  fontSize:15,cursor:"pointer",color:C.muted,WebkitTapHighlightColor:"transparent"}}>Cancel</button>
                <button onClick={confirmImport} style={{flex:1,padding:13,background:C.done,
                  color:"#fff",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,
                  fontWeight:600,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>Confirm</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Swipe ───────────────────────────────────────────────────────────────────────
function useSwipe(onLeft, onRight) {
  const touchStartX = useRef(null);
  return {
    onTouchStart: (e) => { touchStartX.current = e.touches[0].clientX; },
    onTouchEnd: (e) => {
      if (touchStartX.current === null) return;
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(delta) > 50) (delta < 0 ? onLeft : onRight)();
      touchStartX.current = null;
    },
  };
}

// ─── Workout bottom sheet ────────────────────────────────────────────────────────
// "What are you doing today?" grid, shared by Today and Week views. Operates on a
// single dateKey. Rest clears the day, Other prompts for free text, the rest store
// the plain session label so tips & emoji resolve cleanly.
function WorkoutSheet({dateKey:dk,entry,updDay,onClose}) {
  const [otherMode,setOtherMode]=useState(false);
  const [otherText,setOtherText]=useState("");
  const confirmOther=()=>{
    const t=otherText.trim();
    if (!t) return;
    updDay(dk,{workout:`⋯ ${t}`,completed:false,feeling:null});
    onClose();
  };
  const onSheetOption=(opt)=>{
    if (opt.action==="other") { setOtherMode(true); return; }
    if (opt.action==="rest") { updDay(dk,{workout:'',completed:false,feeling:null}); onClose(); return; }
    updDay(dk,{workout:opt.label,completed:false,feeling:null});
    onClose();
  };
  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",
        zIndex:50,WebkitTapHighlightColor:"transparent"}}/>
      <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:51,maxWidth:480,margin:"0 auto",
        background:C.surface,borderRadius:"20px 20px 0 0",boxShadow:"0 -8px 30px rgba(0,0,0,0.18)",
        padding:"8px 16px calc(20px + env(safe-area-inset-bottom))",animation:"sheetUp .25s ease-out"}}>
        <style>{"@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}"}</style>
        <button onClick={onClose} aria-label="Close"
          style={{display:"block",width:"100%",background:"none",border:"none",cursor:"pointer",
            padding:"6px 0 14px",WebkitTapHighlightColor:"transparent"}}>
          <div style={{width:40,height:5,borderRadius:3,background:C.borderSt,margin:"0 auto"}}/>
        </button>
        {otherMode ? (
          <>
            <div style={{fontSize:16,fontWeight:600,color:C.text,margin:"4px 4px 16px"}}>What are you doing?</div>
            <div style={{display:"flex",gap:10}}>
              <input autoFocus value={otherText} onChange={ev=>setOtherText(ev.target.value)}
                onKeyDown={ev=>{ if(ev.key==="Enter") confirmOther(); }}
                placeholder="e.g. Swim, Run, Physio"
                style={{flex:1,border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 15px",
                  fontFamily:"inherit",fontSize:16,color:C.text,background:C.bg,outline:"none",
                  boxSizing:"border-box",WebkitAppearance:"none"}}/>
              <button onClick={confirmOther} disabled={!otherText.trim()}
                style={{flexShrink:0,padding:"0 20px",background:otherText.trim()?C.done:C.muted,
                  color:"#fff",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,
                  fontWeight:600,cursor:otherText.trim()?"pointer":"default",WebkitTapHighlightColor:"transparent"}}>Confirm</button>
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:16,fontWeight:600,color:C.text,margin:"4px 4px 16px"}}>What are you doing today?</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {ALTS.map(opt=>(
                <button key={opt.label} onClick={()=>onSheetOption(opt)}
                  style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                    gap:5,minHeight:64,padding:"12px 4px",background:C.bg,border:`1px solid ${C.border}`,
                    borderRadius:14,cursor:"pointer",fontFamily:"inherit",WebkitTapHighlightColor:"transparent"}}>
                  <span style={{fontSize:24,lineHeight:1}}>{opt.emoji}</span>
                  <span style={{fontSize:11,color:C.muted,textAlign:"center",lineHeight:1.15}}>{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Today view ──────────────────────────────────────────────────────────────────
function TodayView({plan,updDay,dayOff,setDayOff,onOpenCoach}) {
  const viewKey=offsetDate(dayOff);
  const e=plan[viewKey]||{};
  const isToday=dayOff===0;
  const [sheetOpen,setSheetOpen]=useState(false);
  const [direction,setDirection]=useState(null);
  const [animating,setAnimating]=useState(false);
  const [notesOpen,setNotesOpen]=useState(false);
  const [confirmUnlog,setConfirmUnlog]=useState(false);
  useEffect(()=>{ setNotesOpen(false); setConfirmUnlog(false); },[viewKey]);

  const navDay=(delta)=>{
    setSheetOpen(false);
    setDirection(delta>0?'left':'right');
    setDayOff(o=>o+delta);
    setAnimating(true);
    setTimeout(()=>setAnimating(false),250);
  };
  const swipe=useSwipe(()=>navDay(1),()=>navDay(-1));
  const handleUnlog=()=>{ updDay(viewKey,{completed:false,feeling:null}); setConfirmUnlog(false); };

  const d=new Date(viewKey+"T00:00:00");
  const dayName=d.toLocaleDateString("en-US",{weekday:"long"});
  const dayFull=d.toLocaleDateString("en-US",{month:"long",day:"numeric"});
  const hasWorkout=!!e.workout?.trim();

  // Weekly / monthly session counts.
  const wk=weekOf(0);
  const wkPlanned=wk.filter(dk=>plan[dk]?.workout?.trim()).length;
  const wkDone=wk.filter(dk=>plan[dk]?.completed).length;
  const now=new Date();
  const mDays=monthGrid(now.getFullYear(),now.getMonth()).filter(Boolean);
  const mDone=mDays.filter(dk=>plan[dk]?.completed).length;
  const monthLbl=now.toLocaleDateString('en-US',{month:'long'}).toUpperCase();

  return (
    <div {...swipe} style={{padding:"16px 16px 24px"}}>
      <style>{"@keyframes checkPop{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}@keyframes slideInLeft{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideInRight{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}"}</style>
      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
        {[
          { node: hasWorkout
              ? (e.completed
                  ? <span style={{color:C.done}}>✓</span>
                  : <span style={{fontSize:18}}>{workoutEmoji(e.workout)}</span>)
              : 'Rest',
            lbl:"Today" },
          { node: <><span style={{color:wkDone>0?C.done:C.text}}>{wkDone}</span>/{wkPlanned}</>, lbl:"This week" },
          { node: <span style={{color:mDone>0?C.done:C.text}}>{mDone}</span>, lbl:monthLbl },
        ].map(({node,lbl},i)=>(
          <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:14,padding:"12px 6px",textAlign:"center"}}>
            <div style={{fontFamily:"monospace",fontSize:16,fontWeight:700,color:C.text,lineHeight:1.2}}>{node}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:4,textTransform:"uppercase",letterSpacing:".05em"}}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Day content — slides on day change; stats above stay fixed. */}
      <div style={{overflow:"hidden"}}>
      <div key={dayOff} style={{animation:animating?`${direction==="left"?"slideInLeft":"slideInRight"} 220ms ease-out`:undefined}}>
      {/* Day navigation */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <NavArrow onClick={()=>navDay(-1)} dir="left"/>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,marginBottom:2,color:isToday?C.sage:C.muted,
            textTransform:"uppercase",letterSpacing:".1em"}}>
            {isToday?"Today":dayOff<0?`${Math.abs(dayOff)} day${Math.abs(dayOff)>1?"s":""} ago`:`In ${dayOff} day${dayOff>1?"s":""}`}
          </div>
          <div style={{fontSize:17,fontWeight:600,color:C.text}}>{dayName}, {dayFull}</div>
          {!isToday&&<button onClick={()=>setDayOff(0)} style={{
            fontSize:11,fontWeight:700,color:C.sage,background:C.sageLt,border:"none",borderRadius:20,
            padding:"4px 12px",cursor:"pointer",marginTop:4,display:"inline-flex",alignItems:"center",gap:4,
            WebkitTapHighlightColor:"transparent"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Today</button>}
        </div>
        <NavArrow onClick={()=>navDay(1)} dir="right"/>
      </div>

      {/* Workout card */}
      <div style={{background:e.completed?C.doneLt:C.surface,
        border:`1px solid ${e.completed?"rgba(232,23,74,0.3)":C.border}`,borderRadius:18,padding:"20px 20px 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:600,lineHeight:1.35,
              color:hasWorkout?C.text:C.muted,fontStyle:hasWorkout?"normal":"italic"}}>
              {hasWorkout?<><span style={{marginRight:8}}>{workoutEmoji(e.workout)}</span>{e.workout.trim()}</>:"Rest day"}
            </div>
          </div>
          {hasWorkout&&(e.completed
            ? <button onClick={()=>setConfirmUnlog(true)} aria-label="Completed — tap to undo"
                style={{width:64,height:64,borderRadius:"50%",border:"none",background:C.done,cursor:"pointer",
                  display:"flex",flexShrink:0,alignItems:"center",justifyContent:"center",
                  animation:"checkPop .35s ease-out",WebkitTapHighlightColor:"transparent"}}><Chk size={22}/></button>
            : <button onClick={()=>updDay(viewKey,{completed:true})} aria-label="Mark as done"
                style={{width:64,height:64,borderRadius:"50%",border:`2.5px solid ${C.done}`,background:C.sageLt,
                  cursor:"pointer",display:"flex",flexShrink:0,alignItems:"center",justifyContent:"center",
                  WebkitTapHighlightColor:"transparent"}}>
                <span style={{fontSize:11,fontWeight:700,color:C.sageDk,letterSpacing:'.08em'}}>LOG</span>
              </button>
          )}
          <button onClick={()=>setSheetOpen(true)} aria-label="Change session"
            style={{width:44,height:44,border:"none",background:"transparent",color:C.muted,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:10,
              WebkitTapHighlightColor:"transparent"}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
            </svg>
          </button>
        </div>

        {confirmUnlog && (
          <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderTop:`1px solid ${C.border}`}}>
            <span style={{fontSize:13,color:C.muted,flex:1}}>Remove this log entry?</span>
            <button onClick={handleUnlog} style={{fontSize:12,fontWeight:700,color:'#E8174A',background:'none',
              border:'none',padding:'4px 8px',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>Remove</button>
            <button onClick={()=>setConfirmUnlog(false)} style={{fontSize:12,fontWeight:600,color:C.muted,background:'none',
              border:'none',padding:'4px 8px',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>Cancel</button>
          </div>
        )}

        <TipCard workout={e.workout}/>

        {/* Feeling rating — shown when completed */}
        {e.completed&&(
          <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid rgba(232,23,74,0.2)`}}>
            {e.feeling
              ? <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:24}}>{FEELINGS.find(f=>f.value===e.feeling)?.emoji}</span>
                  <span style={{fontSize:13,color:C.muted}}>{FEELINGS.find(f=>f.value===e.feeling)?.label}</span>
                  <button onClick={()=>updDay(viewKey,{feeling:null})} style={{fontSize:11,color:C.muted,
                    background:"none",border:"none",cursor:"pointer",marginLeft:"auto",
                    WebkitTapHighlightColor:"transparent"}}>change</button>
                </div>
              : <div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".06em"}}>How did it feel?</div>
                  <div style={{display:"flex",gap:8}}>
                    {FEELINGS.map(f=>(
                      <button key={f.value} onClick={()=>updDay(viewKey,{feeling:f.value})} title={f.label} aria-label={f.label}
                        style={{fontSize:22,background:"none",border:`1px solid ${C.border}`,borderRadius:12,
                          width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",
                          flexShrink:0,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>{f.emoji}</button>
                    ))}
                  </div>
                </div>}
          </div>
        )}

        {/* Notes — collapsible */}
        {notesOpen ? (
          <textarea rows={2} autoFocus placeholder="Notes — how it felt, what you worked on…"
            value={e.notes||""} onChange={ev=>updDay(viewKey,{notes:ev.target.value})}
            onBlur={()=>setNotesOpen(false)}
            style={{width:"100%",marginTop:14,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",
              fontFamily:"inherit",fontSize:15,color:C.text,background:e.completed?"rgba(255,255,255,.5)":C.bg,
              resize:"none",outline:"none",lineHeight:1.5,boxSizing:"border-box"}}/>
        ) : (e.notes||"").trim() ? (
          <div onClick={()=>setNotesOpen(true)} style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:14,
            cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
            <p style={{margin:0,flex:1,fontSize:14,color:C.text,lineHeight:1.55,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{e.notes}</p>
            <span style={{fontSize:13,color:C.muted,flexShrink:0,lineHeight:1.55}}>✏️</span>
          </div>
        ) : hasWorkout ? (
          <button onClick={()=>setNotesOpen(true)} style={{marginTop:14,background:"none",border:"none",cursor:"pointer",
            color:C.muted,fontSize:13,fontWeight:500,padding:"4px 0",WebkitTapHighlightColor:"transparent"}}>📝 Add note</button>
        ) : null}
      </div>
      </div>{/* /key wrapper */}
      </div>{/* /overflow wrapper */}

      {/* Tactical prompt of the week */}
      <TacticalCard dk={viewKey}/>

      {/* Ask the coach */}
      {hasWorkout&&(
        <button onClick={onOpenCoach} style={{width:"100%",marginTop:16,padding:"14px",background:C.done,
          color:"#fff",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:600,cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",gap:8,WebkitTapHighlightColor:"transparent"}}>
          💬 Ask the coach
        </button>
      )}

      {sheetOpen&&(
        <WorkoutSheet dateKey={viewKey} entry={e} updDay={updDay} onClose={()=>setSheetOpen(false)}/>
      )}
    </div>
  );
}

// ─── Week view ───────────────────────────────────────────────────────────────────
function WeekView({today,plan,wkOff,setWkOff,onGoToDay,updDay,onSwapDays}) {
  const days=weekOf(wkOff);
  const fmt=dk=>new Date(dk+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const wkPlanned=days.filter(dk=>plan[dk]?.workout?.trim()).length;
  const wkDone=days.filter(dk=>plan[dk]?.completed).length;
  const [direction,setDirection]=useState(null);
  const [animating,setAnimating]=useState(false);
  const [sheetDk,setSheetDk]=useState(null);
  const [swapFrom,setSwapFrom]=useState(null);
  const [swapConfirmed,setSwapConfirmed]=useState(null);
  const swapTimer=useRef(null);
  useEffect(()=>()=>{ if (swapTimer.current) clearTimeout(swapTimer.current); },[]);
  const navWeek=(delta)=>{
    setSwapFrom(null);
    setDirection(delta>0?'left':'right');
    setWkOff(w=>w+delta);
    setAnimating(true);
    setTimeout(()=>setAnimating(false),250);
  };
  const swipe=useSwipe(()=>navWeek(1),()=>navWeek(-1));
  const onCardTap=(dk)=>{
    if (swapFrom===null) setSwapFrom(dk);
    else if (swapFrom===dk) setSwapFrom(null);
    else {
      onSwapDays(swapFrom,dk); setSwapFrom(null);
      setSwapConfirmed([swapFrom,dk]);
      if (swapTimer.current) clearTimeout(swapTimer.current);
      swapTimer.current=setTimeout(()=>setSwapConfirmed(null),1500);
    }
  };
  const openSheet=(dk)=>{ setSwapFrom(null); setSheetDk(dk); };

  return (
    <div {...swipe} onClick={()=>{ if(swapFrom!==null) setSwapFrom(null); }} style={{padding:"16px 16px 0"}}>
      <style>{"@keyframes slideInLeft{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideInRight{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes swapFlash{0%{background:rgba(232,23,74,0.15)}50%{background:rgba(232,23,74,0.25)}100%{background:transparent}}"}</style>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <NavArrow onClick={()=>navWeek(-1)} dir="left"/>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontSize:13,color:C.muted}}>{fmt(days[0])} – {fmt(days[6])}</div>
          {wkPlanned>0&&(
            <div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",marginTop:2}}>
              <span style={{color:wkDone>0?C.done:C.muted}}>{wkDone}</span>
              <span style={{color:C.muted}}> / {wkPlanned} sessions</span>
            </div>
          )}
          {wkOff!==0&&<button onClick={()=>setWkOff(0)} style={{fontSize:11,fontWeight:700,color:C.sage,
            background:C.sageLt,border:"none",borderRadius:20,padding:"4px 12px",cursor:"pointer",marginTop:4,
            display:"inline-flex",alignItems:"center",gap:4,WebkitTapHighlightColor:"transparent"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            This week</button>}
        </div>
        <NavArrow onClick={()=>navWeek(1)} dir="right"/>
      </div>

      {swapFrom!==null&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14,
          padding:"10px 14px",background:C.sageLt,borderRadius:12}}>
          <span style={{fontSize:13,fontWeight:600,color:C.sageDk}}>Tap another day to swap sessions</span>
          <button onClick={(ev)=>{ ev.stopPropagation(); setSwapFrom(null); }} style={{flexShrink:0,fontSize:12,
            fontWeight:700,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,
            padding:"5px 12px",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>✕ Cancel swap</button>
        </div>
      )}
      {swapConfirmed && (
        <div style={{textAlign:'center',fontSize:13,fontWeight:600,color:'#E8174A',padding:'6px 0',marginBottom:8,
          animation:'swapFlash 1.5s ease forwards'}}>✓ Sessions swapped</div>
      )}

      <div style={{overflow:"hidden"}}>
      <div key={wkOff} style={{animation:animating?`${direction==="left"?"slideInLeft":"slideInRight"} 220ms ease-out`:undefined}}>
      {/* Strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:5,marginBottom:16}}>
        {days.map((dk,i)=>{
          const en=plan[dk]||{};
          const isT=dk===today;
          const has=!!en.workout?.trim();
          return (
            <button key={dk} onClick={()=>onGoToDay(dk)}
              aria-label={`${DN[i]}, ${fmt(dk)} — ${en.workout?.trim()||"Rest"}`}
              style={{display:"block",width:"100%",fontFamily:"inherit",
                background:en.completed?C.doneLt:isT?C.sageLt:C.surface,
                border:`1.5px solid ${en.completed?C.done:isT?C.sage:C.border}`,borderRadius:12,
                padding:"13px 2px 11px",textAlign:"center",cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".04em",
                color:isT?C.sage:C.muted,fontWeight:isT?600:400,marginBottom:3}}>{DL[i]}</div>
              <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>{new Date(dk+"T00:00:00").getDate()}</div>
              <div style={{fontSize:12,lineHeight:1}}>{has?workoutEmoji(en.workout):<span style={{color:C.muted}}>·</span>}</div>
            </button>
          );
        })}
      </div>

      {/* Day list */}
      {days.map((dk,i)=>{
        const en=plan[dk]||{};
        const isT=dk===today;
        const d=new Date(dk+"T00:00:00");
        const has=!!en.workout?.trim();
        const picked=swapFrom===dk;
        const flashing=swapConfirmed?.includes(dk);
        return (
          <div key={dk} style={{background:picked?C.sageLt:en.completed?C.doneLt:C.surface,
            border:`${picked?2:1}px solid ${picked?C.sage:en.completed?C.done:C.border}`,borderRadius:16,
            padding:"14px 18px",marginBottom:10,animation:flashing?'swapFlash 1.5s ease forwards':undefined,
            display:"flex",alignItems:"center",gap:8}}>
            <button onClick={(ev)=>{ ev.stopPropagation(); onCardTap(dk); }}
              aria-label={`${DN[i]}, ${fmt(dk)} — ${en.workout?.trim()||"Rest"}${picked?" (selected — tap another day to swap)":""}`}
              style={{flex:1,minWidth:0,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,
                background:"none",border:"none",padding:0,textAlign:"left",fontFamily:"inherit",cursor:"pointer",
                WebkitTapHighlightColor:"transparent"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:".07em",
                  color:isT?C.sageDk:C.muted,fontWeight:isT?700:400,marginBottom:4}}>
                  {isT?"● Today  ·  ":""}{DN[i]}, {fmt(dk)}
                </div>
                <div style={{fontSize:15,fontWeight:500,color:has?C.text:C.muted,fontStyle:has?"normal":"italic",
                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  {has?<><span style={{marginRight:7}}>{workoutEmoji(en.workout)}</span>{en.workout.trim()}</>:"Rest"}
                </div>
              </div>
              <div style={{width:22,display:"flex",justifyContent:"center",alignItems:"center",flexShrink:0}}>
                {en.completed
                  ? <div style={{width:22,height:22,borderRadius:"50%",background:C.done,display:"flex",
                      alignItems:"center",justifyContent:"center"}}><Chk size={12}/></div>
                  : <div style={{width:8,height:8,borderRadius:"50%",background:C.border}}/>}
              </div>
            </button>
            <button onClick={(ev)=>{ ev.stopPropagation(); openSheet(dk); }} aria-label="Change session"
              style={{width:40,height:40,flexShrink:0,border:"none",background:"transparent",color:C.muted,
                cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                WebkitTapHighlightColor:"transparent"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
              </svg>
            </button>
          </div>
        );
      })}
      </div>{/* /week-slide */}
      </div>{/* /overflow */}

      {sheetDk&&(
        <WorkoutSheet dateKey={sheetDk} entry={plan[sheetDk]||{}} updDay={updDay} onClose={()=>setSheetDk(null)}/>
      )}
    </div>
  );
}

// ─── Month view ──────────────────────────────────────────────────────────────────
function MonthView({today,plan,moOff,setMoOff,onGoToDay}) {
  const now=new Date();
  const t=new Date(now.getFullYear(),now.getMonth()+moOff,1);
  const y=t.getFullYear(), m=t.getMonth();
  const days=monthGrid(y,m);
  const real=days.filter(Boolean);
  const mPlanned=real.filter(dk=>plan[dk]?.workout?.trim()).length;
  const mDone=real.filter(dk=>plan[dk]?.completed).length;
  const [direction,setDirection]=useState(null);
  const [animating,setAnimating]=useState(false);
  const navMonth=(delta)=>{
    setDirection(delta>0?'left':'right');
    setMoOff(o=>o+delta);
    setAnimating(true);
    setTimeout(()=>setAnimating(false),250);
  };
  const swipe=useSwipe(()=>navMonth(1),()=>navMonth(-1));

  return (
    <div {...swipe} style={{padding:"16px 16px 0"}}>
      <style>{"@keyframes slideInLeft{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideInRight{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}"}</style>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <NavArrow onClick={()=>navMonth(-1)} dir="left"/>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontSize:18,fontWeight:700,color:C.text}}>{MONTHS[m]} {y}</div>
          {mPlanned>0&&(
            <div style={{fontSize:13,color:C.muted,marginTop:2,fontFamily:"monospace"}}>
              <span style={{color:mDone>0?C.done:C.muted,fontWeight:700}}>{mDone}</span>
              <span> / {mPlanned} sessions</span>
            </div>
          )}
          {moOff!==0&&<button onClick={()=>setMoOff(0)} style={{fontSize:11,fontWeight:700,color:C.sage,
            background:C.sageLt,border:"none",borderRadius:20,padding:"4px 12px",cursor:"pointer",marginTop:4,
            display:"inline-flex",alignItems:"center",gap:4,WebkitTapHighlightColor:"transparent"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            This month</button>}
        </div>
        <NavArrow onClick={()=>navMonth(1)} dir="right"/>
      </div>
      <div style={{overflow:"hidden"}}>
      <div key={moOff} style={{animation:animating?`${direction==="left"?"slideInLeft":"slideInRight"} 220ms ease-out`:undefined}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {DL.map((l,i)=>(
          <div key={i} style={{fontSize:10,textTransform:"uppercase",letterSpacing:".04em",
            color:C.muted,textAlign:"center",padding:"4px 0",fontWeight:500}}>{l}</div>
        ))}
        {days.map((dk,i)=>{
          if (!dk) return <div key={`e${i}`}/>;
          const en=plan[dk]||{};
          const has=!!en.workout?.trim();
          const isT=dk===today;
          return (
            <button key={dk} onClick={()=>onGoToDay(dk)}
              aria-label={`${new Date(dk+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} — ${en.workout?.trim()||"Rest"}`}
              style={{width:"100%",padding:0,fontFamily:"inherit",aspectRatio:"1",borderRadius:10,display:"flex",
                flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,cursor:"pointer",
                background:en.completed?C.doneLt:has?C.surface:"transparent",
                border:`1.5px solid ${en.completed?C.done:isT?C.sage:has?C.border:"transparent"}`,
                outline:isT?`2px solid ${C.sage}`:"none",outlineOffset:-1,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:13,fontWeight:(has||isT)?600:400,color:(has||isT)?C.text:C.borderSt,lineHeight:1}}>
                {new Date(dk+"T00:00:00").getDate()}
              </div>
              {has&&<div style={{fontSize:12,lineHeight:1,opacity:en.completed?1:0.9}}>{workoutEmoji(en.workout)}</div>}
            </button>
          );
        })}
      </div>
      </div>{/* /month-slide */}
      </div>{/* /overflow */}
    </div>
  );
}

// ─── Journey view ────────────────────────────────────────────────────────────────
function JourneyView({plan,today,onGoToDay}) {
  const phaseDays=(p)=>{
    const days=[]; const d=new Date(p.start+"T00:00:00");
    while (dateKey(d)<=p.end) { days.push(dateKey(d)); d.setDate(d.getDate()+1); }
    return days;
  };
  const fmtMD=(s)=>new Date(s+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  const curPhase=phaseForDate(today);

  return (
    <div style={{padding:"16px 16px 32px"}}>
      {PHASES.map((phase,pi)=>{
        const days=phaseDays(phase);
        const planned=days.filter(dk=>plan[dk]?.workout?.trim()).length;
        const done=days.filter(dk=>plan[dk]?.completed).length;
        const isCurrent=phase===curPhase;
        const isPast=today>phase.end;
        const pct=planned>0?Math.round(done/planned*100):0;
        return (
          <button key={phase.name} onClick={()=>onGoToDay(phase.start)}
            aria-label={`${phase.name}, ${fmtMD(phase.start)} to ${fmtMD(phase.end)}`}
            style={{display:"block",width:"100%",textAlign:"left",fontFamily:"inherit",cursor:"pointer",
              background:isCurrent?C.doneLt:C.surface,
              border:`${isCurrent?2:1}px solid ${isCurrent?C.done:C.border}`,borderRadius:18,
              padding:"18px 18px",marginBottom:14,WebkitTapHighlightColor:"transparent"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:20,fontWeight:800,color:C.text}}>{phase.name}</span>
              <span style={{fontSize:11,fontWeight:700,color:C.sage,textTransform:"uppercase",letterSpacing:".08em"}}>Phase {pi+1}</span>
              {isCurrent&&<span style={{fontSize:10,fontWeight:700,color:"#fff",background:C.done,
                borderRadius:20,padding:"2px 9px"}}>NOW</span>}
            </div>
            <div style={{fontSize:12,color:C.muted,fontFamily:"monospace",marginTop:5}}>{fmtMD(phase.start)} – {fmtMD(phase.end)}</div>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.5,marginTop:8}}>{phase.description}</div>
            <div style={{height:6,background:"rgba(255,107,157,0.18)",borderRadius:3,marginTop:12,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${isPast||isCurrent?pct:0}%`,background:C.done}}/>
            </div>
            <div style={{fontSize:12,color:C.muted,fontFamily:"monospace",marginTop:8}}>
              {(isPast||isCurrent)
                ? <><span style={{color:C.done}}>{done}</span> / {planned} sessions{planned>0?` · ${pct}%`:""}</>
                : `${planned} sessions planned`}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Coach screen (full-screen chat) ─────────────────────────────────────────────
function CoachScreen({viewKey,plan,playerName,onBack}) {
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [sending,setSending]=useState(false);
  const [coachError,setCoachError]=useState(false);
  const coachKey=`coach-${viewKey}`;
  const inputRef=useRef(null);

  useEffect(()=>{ const t=setTimeout(()=>inputRef.current?.focus(),300); return ()=>clearTimeout(t); },[]);
  useEffect(()=>{
    let stored=[];
    try { const raw=localStorage.getItem(coachKey); if (raw) stored=JSON.parse(raw); } catch {}
    setMessages(Array.isArray(stored)?stored:[]);
  },[coachKey]);
  const persistCoach=(msgs)=>{ try { localStorage.setItem(coachKey,JSON.stringify(msgs)); } catch {} };

  const e=plan[viewKey]||{};
  const d=new Date(viewKey+"T00:00:00");
  const dayName=d.toLocaleDateString("en-US",{weekday:"long"});
  const dayFull=d.toLocaleDateString("en-US",{month:"long",day:"numeric"});
  const feelingLabel=(v)=>FEELINGS.find(f=>f.value===v)?.label||null;

  const buildCoachContext=()=>{
    const today=todayStr();
    const cut=daysBeforeStr(today,14);
    const completed=Object.keys(plan).filter(dk=>plan[dk]?.workout?.trim()&&plan[dk].completed).sort();
    const recentSessions=completed.filter(dk=>dk>=cut).map(dk=>({
      date:dk, workout:plan[dk].workout.trim(),
      feeling:feelingLabel(plan[dk].feeling), notes:plan[dk].notes?.trim()||null,
    }));
    const wk=weekOf(0);
    const week={ done:wk.filter(dk=>plan[dk]?.completed).length, planned:wk.filter(dk=>plan[dk]?.workout?.trim()).length };
    const curPhase=phaseForDate(today);
    const idx=PHASES.findIndex(p=>p===curPhase);
    const next=curPhase?PHASES[idx+1]:null;
    const daysToNextPhase=next?daysUntil(next.start):(curPhase?daysUntil(curPhase.end):null);
    return {
      playerName:playerName?.trim()||null,
      phase:curPhase?{name:curPhase.name,description:curPhase.description}:null,
      nextPhase:next?.name||null, daysToNextPhase,
      today:{date:viewKey,label:`${dayName}, ${dayFull}`,workout:e.workout?.trim()||"Rest day",
        completed:!!e.completed,feeling:feelingLabel(e.feeling)},
      recentSessions, week, tactical:tacticalFor(viewKey),
    };
  };

  const sendToCoach=async(base)=>{
    setSending(true); setCoachError(false);
    setMessages([...base,{role:"assistant",content:""}]);
    try {
      const resp=await fetch("/api/coach",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...buildCoachContext(),messages:base})});
      if (!resp.ok||!resp.body) throw new Error("bad response");
      const reader=resp.body.getReader(), decoder=new TextDecoder();
      let acc="";
      for (;;) { const {done,value}=await reader.read(); if (done) break; acc+=decoder.decode(value,{stream:true}); setMessages([...base,{role:"assistant",content:acc}]); }
      if (!acc.trim()) throw new Error("empty response");
      const final=[...base,{role:"assistant",content:acc}];
      setMessages(final); persistCoach(final);
    } catch { setCoachError(true); setMessages(base); }
    finally { setSending(false); }
  };
  const startCoach=()=>sendToCoach([{role:"user",content:"Tell me about today's session"}]);
  const sendCoach=()=>{ const text=input.trim(); if (!text||sending) return; setInput(""); sendToCoach([...messages,{role:"user",content:text}]); };
  const retryCoach=()=>{ if (!sending&&messages.length) sendToCoach(messages); };
  const newCoachChat=()=>{ setMessages([]); setInput(""); setCoachError(false); try { localStorage.removeItem(coachKey); } catch {} };

  return (
    <div style={{position:"fixed",inset:0,zIndex:60,background:C.bg,display:"flex",flexDirection:"column",
      fontFamily:"system-ui,sans-serif"}}>
      <style>{"@keyframes coachBlink{0%,80%,100%{opacity:.25}40%{opacity:1}}"}</style>
      <div style={{flexShrink:0,background:C.surface,borderBottom:`1px solid ${C.border}`,
        padding:"env(safe-area-inset-top,0px) 12px 0",display:"flex",alignItems:"center",gap:8,minHeight:56}}>
        <button onClick={onBack} aria-label="Back" style={{background:"none",border:"none",cursor:"pointer",
          color:C.muted,fontSize:24,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",
          flexShrink:0,WebkitTapHighlightColor:"transparent"}}>←</button>
        <div style={{flex:1,textAlign:"center",fontSize:16,fontWeight:700,color:C.text}}>Coach</div>
        {messages.length>0
          ? <button onClick={newCoachChat} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,
              fontSize:12,fontWeight:600,textDecoration:"underline",padding:"0 6px",flexShrink:0,
              WebkitTapHighlightColor:"transparent"}}>New conversation</button>
          : <div style={{width:44,flexShrink:0}}/>}
      </div>

      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:10}}>
        {messages.length===0&&!input.trim()&&!coachError&&(
          <button onClick={startCoach} disabled={sending}
            style={{alignSelf:"stretch",padding:"14px",background:C.surface,color:C.sageDk,
              border:`1px solid ${C.sage}`,borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:600,
              cursor:sending?"default":"pointer",WebkitTapHighlightColor:"transparent"}}>
            Tell me about today's session
          </button>
        )}
        {messages.map((m,i)=>(
          m.role==="assistant"
            ? <div key={i} style={{alignSelf:"flex-start",maxWidth:"90%",background:C.surface,
                borderLeft:`3px solid ${C.sage}`,borderRadius:"4px 14px 14px 4px",padding:"11px 14px"}}>
                {m.content
                  ? <p style={{margin:0,fontSize:15,lineHeight:1.6,color:C.text,whiteSpace:"pre-wrap"}}>{m.content}</p>
                  : <div style={{display:"flex",gap:5,padding:"2px 0"}}>
                      {[0,1,2].map(j=>(<span key={j} style={{width:7,height:7,borderRadius:"50%",background:C.sage,
                        display:"inline-block",animation:`coachBlink 1.2s ${j*0.16}s infinite ease-in-out`}}/>))}
                    </div>}
              </div>
            : <div key={i} style={{alignSelf:"flex-end",maxWidth:"85%",background:C.surface,
                border:`1px solid ${C.border}`,borderRadius:"14px 14px 4px 14px",padding:"11px 14px"}}>
                <p style={{margin:0,fontSize:15,lineHeight:1.55,color:C.text,whiteSpace:"pre-wrap"}}>{m.content}</p>
              </div>
        ))}
        {coachError&&(
          <div style={{alignSelf:"stretch"}}>
            <p style={{margin:"0 0 8px",fontSize:14,color:C.muted,lineHeight:1.5}}>
              Couldn't reach the coach right now. Check your connection and try again.
            </p>
            {messages.length>0&&(
              <button onClick={retryCoach} style={{fontSize:14,fontWeight:600,color:C.sageDk,background:C.surface,
                border:`1px solid ${C.sage}`,borderRadius:10,padding:"9px 16px",cursor:"pointer",fontFamily:"inherit",
                WebkitTapHighlightColor:"transparent"}}>↻ Try again</button>
            )}
          </div>
        )}
      </div>

      <div style={{flexShrink:0,background:C.surface,borderTop:`1px solid ${C.border}`,
        padding:"10px 16px calc(2px + env(safe-area-inset-bottom,0px))",display:"flex",gap:8,alignItems:"center"}}>
        <input ref={inputRef} type="text" value={input} onChange={ev=>setInput(ev.target.value)}
          onKeyDown={ev=>{ if (ev.key==="Enter"){ ev.preventDefault(); sendCoach(); } }}
          placeholder="Ask the coach…" disabled={sending}
          style={{flex:1,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px",fontFamily:"inherit",
            fontSize:15,color:C.text,background:C.bg,outline:"none",boxSizing:"border-box",WebkitAppearance:"none"}}/>
        <button onClick={sendCoach} disabled={sending||!input.trim()}
          style={{padding:"14px 18px",background:input.trim()&&!sending?C.done:C.border,color:"#fff",border:"none",
            borderRadius:12,fontFamily:"inherit",fontSize:14,fontWeight:600,
            cursor:input.trim()&&!sending?"pointer":"default",flexShrink:0,WebkitTapHighlightColor:"transparent"}}>Send</button>
      </div>
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [loading,setLoading]=useState(true);
  const [playerName,setPlayerName]=useState("");
  const [plan,setPlan]=useState({});
  const [view,setView]=useState("today");
  const [screen,setScreen]=useState("main");
  const [wkOff,setWkOff]=useState(0);
  const [moOff,setMoOff]=useState(0);
  const [dayOff,setDayOff]=useState(0);
  const [restoredToast,setRestoredToast]=useState(false);
  const [celebration,setCelebration]=useState(null);

  useEffect(()=>{
    (async()=>{
      let stored=null;
      try { stored=await storeGet(SK); } catch(e) {}
      if (stored) {
        try {
          const d=JSON.parse(stored);
          if (d.playerName) setPlayerName(d.playerName);
          const lp=(d.plan&&Object.keys(d.plan).length>0)?d.plan:buildDefaultPlan();
          setPlan(lp);
          setScreen(d.playerName?"main":"setup");
        } catch(e) { setPlan(buildDefaultPlan()); setScreen("setup"); }
      } else {
        setPlan(buildDefaultPlan());
        setScreen("setup");
      }
      setLoading(false);
    })();
  },[]);

  // Respect prefers-reduced-motion globally + keyboard focus ring. Injected once.
  useEffect(()=>{
    if (document.getElementById("a11y-global-style")) return;
    const s=document.createElement("style");
    s.id="a11y-global-style";
    s.textContent="@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important;scroll-behavior:auto !important}}:focus-visible{outline:2px solid #E8174A !important;outline-offset:2px !important}@keyframes celebFadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}";
    document.head.appendChild(s);
  },[]);

  useEffect(()=>{
    try { if (sessionStorage.getItem("justRestored")) { sessionStorage.removeItem("justRestored"); setRestoredToast(true); } } catch {}
  },[]);
  useEffect(()=>{
    if (!restoredToast) return;
    const t=setTimeout(()=>setRestoredToast(false),3200);
    return ()=>clearTimeout(t);
  },[restoredToast]);
  useEffect(()=>{
    if (!celebration) return;
    const t=setTimeout(()=>setCelebration(null),4000);
    return ()=>clearTimeout(t);
  },[celebration]);

  // After a session is logged, fire the first not-yet-shown milestone whose check passes.
  const checkMilestones=(dk,planState)=>{
    const all=Object.entries(planState)
      .filter(([k,e])=>e.completed&&e.workout?.trim())
      .map(([k,e])=>({...e,date:k,phase:phaseForDate(k)?.name}))
      .sort((a,b)=>a.date<b.date?-1:1);
    const entry=all.find(e=>e.date===dk);
    if (!entry) return;
    for (const m of MILESTONES) {
      const sk=`milestone-${m.id}`;
      let already=false;
      try { already=!!localStorage.getItem(sk); } catch {}
      if (already) continue;
      if (m.check(all,entry,entry.phase)) {
        try { localStorage.setItem(sk,'true'); } catch {}
        setCelebration({emoji:m.emoji,title:m.title,message:m.message});
        break;
      }
    }
  };

  const save=(np,nn)=>storeSet(SK,JSON.stringify({ playerName:nn??playerName, plan:np??plan })).catch(()=>{});
  const updDay=(dk,u)=>{
    const np={...plan,[dk]:{...plan[dk],...u}}; setPlan(np); save(np);
    if (u.completed===true&&np[dk]?.workout?.trim()) checkMilestones(dk,np);
  };
  // Swap two days' session in a single atomic update. Logged status/notes/feeling stay with their date.
  const swapDays=(a,b)=>{
    const ea=plan[a]||{}, eb=plan[b]||{};
    const np={...plan,
      [a]:{...plan[a],workout:eb.workout||''},
      [b]:{...plan[b],workout:ea.workout||''}};
    setPlan(np); save(np);
  };
  const goToDay=(dk)=>{ setDayOff(daysUntil(dk)??0); setView("today"); };

  const today=todayStr();

  // Header: current phase, phase progress ring, days until next phase / season end.
  const curPhase=phaseForDate(today);
  const phaseIdx=curPhase?PHASES.findIndex(p=>p===curPhase):-1;
  const nextPhase=curPhase?PHASES[phaseIdx+1]:null;
  let phaseProg=0, daysToNext=null, nextLabel="";
  const beforeSeason=today<SEASON_START;
  const afterSeason=today>SEASON_END;
  if (curPhase) {
    const ps=new Date(curPhase.start+"T00:00:00").getTime();
    const pe=new Date(curPhase.end+"T00:00:00").getTime();
    const tn=new Date(today+"T00:00:00").getTime();
    phaseProg=Math.max(0,Math.min(1,(tn-ps)/(pe-ps||1)));
    if (nextPhase) { daysToNext=daysUntil(nextPhase.start); nextLabel=nextPhase.name; }
    else { daysToNext=daysUntil(curPhase.end); nextLabel="season end"; }
  } else if (beforeSeason) {
    daysToNext=daysUntil(SEASON_START); nextLabel=PHASES[0].name;
  }

  // Overall season progress (all sessions).
  const allE=Object.values(plan);
  const totalPlanned=allE.filter(e=>e.workout?.trim()).length;
  const totalDone=allE.filter(e=>e.completed).length;
  const pct=totalPlanned>0?Math.round(totalDone/totalPlanned*100):0;
  const circ=2*Math.PI*30;
  const ringOff=circ*(1-(afterSeason?1:beforeSeason?0:phaseProg));

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",
      color:C.muted,fontFamily:"system-ui",background:C.bg}}>Loading…</div>
  );
  if (screen==="setup") return (
    <SetupScreen initName={playerName} isEdit={!!playerName}
      onBack={playerName?()=>setScreen("main"):null}
      onSave={(n)=>{ setPlayerName(n); save(plan,n); setScreen("main"); }}/>
  );
  if (screen==="coach") return (
    <CoachScreen viewKey={offsetDate(dayOff)} plan={plan} playerName={playerName} onBack={()=>setScreen("main")}/>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif",color:C.text,
      paddingBottom:"env(safe-area-inset-bottom,0px)",WebkitFontSmoothing:"antialiased"}}>

      {restoredToast&&(
        <div role="status" style={{position:"fixed",left:0,right:0,zIndex:70,
          top:"calc(env(safe-area-inset-top,0px) + 12px)",display:"flex",justifyContent:"center",pointerEvents:"none"}}>
          <div style={{background:C.done,color:"#fff",fontSize:14,fontWeight:600,padding:"10px 18px",borderRadius:99,
            display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(0,0,0,0.18)"}}>
            <Chk size={15}/> Backup restored
          </div>
        </div>
      )}

      {celebration && (
        <div onClick={()=>setCelebration(null)} style={{position:'fixed',inset:0,zIndex:1000,
          background:'rgba(232,23,74,0.92)',display:'flex',flexDirection:'column',alignItems:'center',
          justifyContent:'center',padding:40,textAlign:'center',animation:'celebFadeIn 0.3s ease'}}>
          <div style={{fontSize:72,marginBottom:24}}>{celebration.emoji}</div>
          <div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:16,lineHeight:1.2}}>{celebration.title}</div>
          <div style={{fontSize:17,color:'rgba(255,255,255,0.85)',lineHeight:1.6,maxWidth:280}}>{celebration.message}</div>
          <div style={{marginTop:40,fontSize:13,color:'rgba(255,255,255,0.6)'}}>tap to continue</div>
        </div>
      )}

      {/* Header */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,paddingTop:"env(safe-area-inset-top,0px)"}}>
        <div style={{padding:"14px 20px 0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:".08em",color:C.muted,marginBottom:3}}>Soccer tracker</div>
              <div style={{fontSize:22,fontWeight:700,color:C.text,lineHeight:1.15}}>{playerName||"Player"}</div>
            </div>
            <button onClick={()=>setScreen("setup")} aria-label="Settings" style={{background:"none",
              border:`1px solid ${C.border}`,borderRadius:10,width:44,height:44,cursor:"pointer",display:"flex",
              alignItems:"center",justifyContent:"center",color:C.muted,flexShrink:0,WebkitTapHighlightColor:"transparent"}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>

          <div style={{display:"flex",gap:16,alignItems:"center",paddingBottom:16}}>
            <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
              <svg width="72" height="72" style={{transform:"rotate(-90deg)"}}>
                <circle cx="36" cy="36" r="30" fill="none" stroke={C.border} strokeWidth="5.5"/>
                <circle cx="36" cy="36" r="30" fill="none" stroke={C.done} strokeWidth="5.5"
                  strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={ringOff}
                  style={{transition:"stroke-dashoffset .8s ease"}}/>
              </svg>
              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
                alignItems:"center",justifyContent:"center"}}>
                {afterSeason
                  ? <span style={{fontSize:26,lineHeight:1}}>🏆</span>
                  : <>
                      <span style={{fontFamily:"monospace",fontSize:20,fontWeight:700,lineHeight:1,color:C.text}}>
                        {daysToNext!=null?Math.max(0,daysToNext):"–"}
                      </span>
                      <span style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>days</span>
                    </>}
              </div>
            </div>
            <div style={{flex:1}}>
              {afterSeason
                ? <>
                    <div style={{fontSize:17,fontWeight:700,color:C.done,marginBottom:4}}>Season complete 🎉</div>
                    <div style={{fontSize:13,color:C.muted}}>{totalDone} sessions logged · {pct}% of plan</div>
                  </>
                : <>
                    <div style={{fontSize:18,fontWeight:700,color:C.text,lineHeight:1.15,marginBottom:4}}>
                      {curPhase?curPhase.name:beforeSeason?"Pre-season":""}
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginBottom:7}}>
                      {daysToNext!=null
                        ? <>{Math.max(0,daysToNext)} day{Math.max(0,daysToNext)===1?"":"s"} to {nextLabel}</>
                        : ""}
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginBottom:7}}>
                      <span style={{color:C.done,fontFamily:"monospace",fontWeight:700}}>{totalDone}</span>
                      <span> / {totalPlanned} sessions · {pct}%</span>
                    </div>
                    <div style={{height:5,background:C.border,borderRadius:99,overflow:"hidden"}}>
                      <div style={{height:"100%",background:C.done,borderRadius:99,width:`${pct}%`,transition:"width .6s ease"}}/>
                    </div>
                  </>}
            </div>
          </div>
        </div>
      </div>

      <div style={{paddingBottom:"calc(80px + env(safe-area-inset-bottom,0px))"}}>
        {view==="today"&&<TodayView plan={plan} updDay={updDay} dayOff={dayOff} setDayOff={setDayOff} onOpenCoach={()=>setScreen("coach")}/>}
        {view==="week"&&<WeekView today={today} plan={plan} wkOff={wkOff} setWkOff={setWkOff} onGoToDay={goToDay} updDay={updDay} onSwapDays={swapDays}/>}
        {view==="month"&&<MonthView today={today} plan={plan} moOff={moOff} setMoOff={setMoOff} onGoToDay={goToDay}/>}
        {view==="journey"&&<JourneyView plan={plan} today={today} onGoToDay={goToDay}/>}
      </div>

      {/* Bottom tab bar */}
      <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:40,background:C.surface,
        borderTop:`1px solid ${C.border}`,display:"flex",paddingTop:6,paddingBottom:"env(safe-area-inset-bottom,0px)",
        boxShadow:"0 -2px 14px rgba(0,0,0,0.05)"}}>
        {[["today","Today"],["week","Week"],["month","Month"],["journey","Journey"]].map(([v,label])=>{
          const active=view===v;
          return (
            <button key={v} onClick={()=>{ setView(v); if(v==="today") setDayOff(0); }}
              aria-label={label} aria-current={active?"page":undefined}
              style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",
                gap:3,minHeight:48,padding:"6px 0 2px",background:"none",border:"none",cursor:"pointer",
                fontFamily:"inherit",color:active?C.done:C.muted,WebkitTapHighlightColor:"transparent"}}>
              <TabIcon name={v}/>
              <span style={{fontSize:11,fontWeight:active?700:500,letterSpacing:".01em"}}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
