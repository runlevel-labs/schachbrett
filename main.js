const boardEl=document.getElementById("board");
const statusEl=document.getElementById("status");
const movesEl=document.getElementById("moves");
const undoBtn=document.getElementById("undo");
const pgnBtn=document.getElementById("pgn");

const wTimeEl=document.getElementById("wtime");
const bTimeEl=document.getElementById("btime");
const turnEl=document.getElementById("turn");
const moveNoEl=document.getElementById("moveno");
const clockToggleBtn=document.getElementById("clockToggle");

const pgnFile=document.getElementById("pgnfile");
const rFirst=document.getElementById("rFirst");
const rPrev=document.getElementById("rPrev");
const rNext=document.getElementById("rNext");
const rLast=document.getElementById("rLast");
const rAuto=document.getElementById("rAuto");
const rPos=document.getElementById("rPos");

// Engine
const engToggle=document.getElementById("engToggle");
const engScore=document.getElementById("engScore");
const engState=document.getElementById("engState");

const P={
 wK:"♔",wQ:"♕",wR:"♖",wB:"♗",wN:"♘",wP:"♙",
 bK:"♚",bQ:"♛",bR:"♜",bB:"♝",bN:"♞",bP:"♟"
};

const start=[
"bR","bN","bB","bQ","bK","bB","bN","bR",
"bP","bP","bP","bP","bP","bP","bP","bP",
null,null,null,null,null,null,null,null,
null,null,null,null,null,null,null,null,
null,null,null,null,null,null,null,null,
null,null,null,null,null,null,null,null,
"wP","wP","wP","wP","wP","wP","wP","wP",
"wR","wN","wB","wQ","wK","wB","wN","wR"
];

let state=start.slice();
let selected=null;
let legal=new Set();
let history=[];
let moves=[]; // UI-Log (Strings)

let active="w";
let fullMove=1;

// Replay
let replay=null; // { states: [state0..], plies:[{san,coord,from,to}], ply:0, auto:null }
let replayHighlight=null; // {fromIdx,toIdx}

// Engine (Stockfish via WebWorker)
let engine=null;
let engineOk=false;
let engineBusy=false;
let engineSeq=0;
let engineEnabled=false;
let engineReadyPoll=null;
let enginePendingEval=false;
let engineSearch=null;

function setReplayUI(on){
  boardEl.classList.toggle("replayMode", !!on);
  statusEl.classList.toggle("replayMode", !!on);
  document.body.classList.toggle("replayMode", !!on);
}

/* ===== Helpers ===== */
function sqColor(i){return((Math.floor(i/8)+i)%2)?"dark":"light";}
function idxToCoord(i){
 const file="abcdefgh"[i%8].toUpperCase();
 const rank=8-Math.floor(i/8);
 return file+rank;
}
function coordLower(i){
 const c=idxToCoord(i);
 return c[0].toLowerCase()+c.slice(1);
}
function coordToIdx(coord){
 // accepts "E2" or "e2"
 if(!coord||coord.length<2) return null;
 const f=coord[0].toLowerCase();
 const r=parseInt(coord.slice(1),10);
 const file="abcdefgh".indexOf(f);
 if(file<0||!(r>=1&&r<=8)) return null;
 const row=8-r;
 return row*8+file;
}
function normalizeDash(s){
 return String(s||"").replace(/[–—]/g,"-");
}
function setClockToggleLabel(){
  if(clockToggleBtn) clockToggleBtn.textContent=running ? "Uhr stoppen" : "Uhr starten";
}
function syncTurnAndMoveFromReplayPly(ply){
  active=(ply%2===0) ? "w" : "b";
  fullMove=Math.floor(ply/2)+1;
}

// Stellung -> FEN (minimal, ausreichend für Bewertung)
function stateToFEN(st, sideToMove, ply){
  const map={K:"k",Q:"q",R:"r",B:"b",N:"n",P:"p"};
  let rows=[];
  for(let r=0;r<8;r++){
    let out="", empty=0;
    for(let c=0;c<8;c++){
      const p=st[r*8+c];
      if(!p){ empty++; continue; }
      if(empty){ out+=String(empty); empty=0; }
      const ch=map[p[1]];
      out += (p[0]==="w") ? ch.toUpperCase() : ch;
    }
    if(empty) out+=String(empty);
    rows.push(out);
  }
  const stm = (sideToMove==="w") ? "w" : "b";
  const full = Math.floor((ply||0)/2)+1;
  return `${rows.join("/")} ${stm} - - 0 ${full}`;
}

function setEngineStatus(text){
  engState.textContent=text;
}
function fmtScore(s){
  if(!s) return "–";
  if(s.type==="mate"){
    const n=Math.abs(s.value);
    return (s.value>0?"#":"#-") + n;
  }
  const val=s.value/100;
  const sign=val>0?"+":"";
  return sign+val.toFixed(2);
}

function ensureEngine(){
  if(engineOk && engine) return true;
  try{
    engine=new Worker("stockfish.js");
  }catch(err){
    engine=null; engineOk=false;
    setEngineStatus("kein Stockfish.js");
    return false;
  }
  engineOk=false;
  engineBusy=false;
  enginePendingEval=false;
  engineSearch=null;
  setEngineStatus("initialisiere…");

  // einfache UCI-Handshake + Suchergebnisse
  engine.onmessage=(e)=>{
    const line=String(e.data||"");
    if(line.includes("uciok")){
      engine.postMessage("isready");
    }
    if(line.includes("readyok")){
      engineOk=true;
      setEngineStatus("bereit");
    }
    if(engineSearch){
      const mMate=line.match(/score mate (-?\d+)/);
      const mCp=line.match(/score cp (-?\d+)/);
      if(mMate) engineSearch.last={type:"mate", value:parseInt(mMate[1],10)};
      else if(mCp) engineSearch.last={type:"cp", value:parseInt(mCp[1],10)};

      if(line.startsWith("bestmove")){
        const finishedSearch=engineSearch;
        engineSearch=null;
        engineBusy=false;
        if(engineEnabled && finishedSearch.seq===engineSeq){
          engScore.textContent=fmtScore(finishedSearch.last);
          setEngineStatus("bereit");
        }
        if(enginePendingEval && engineEnabled){
          enginePendingEval=false;
          setTimeout(evalCurrentPosition, 0);
        }
      }
    }
  };
  engine.onerror=()=>{
    engineBusy=false;
    engineOk=false;
    enginePendingEval=false;
    engineSearch=null;
    engineEnabled=false;
    engToggle.textContent="Engine: AUS";
    engScore.textContent="–";
    setEngineStatus("Engine-Fehler");
  };
  engine.postMessage("uci");
  return true;
}

function evalCurrentPosition(){
  if(!engineEnabled) return;
  if(!engine || !engineOk) return;
  if(engineBusy){
    enginePendingEval=true;
    return;
  }

  const stm = replay ? ((replay.ply%2===0)?"w":"b") : active;
  const fen = stateToFEN(state, stm, replay ? replay.ply : (fullMove-1)*2);
  const mySeq=++engineSeq;
  engineBusy=true;
  enginePendingEval=false;
  engineSearch={seq: mySeq, last: null};
  setEngineStatus("rechnet…");
  engScore.textContent="…";

  engine.postMessage("ucinewgame");
  engine.postMessage(`position fen ${fen}`);
  engine.postMessage("go depth 14");
}

/* ===== Uhr ===== */
const CONTROL_MS=2*60*60*1000;
let whiteMs=CONTROL_MS, blackMs=CONTROL_MS;
let running=false, timer=null, lastTick=null;
function fmt(ms){
 const t=Math.max(0,Math.floor(ms/1000));
 const h=Math.floor(t/3600);
 const m=Math.floor((t%3600)/60);
 const s=t%60;
 return`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function renderClock(){
 wTimeEl.textContent=fmt(whiteMs);
 bTimeEl.textContent=fmt(blackMs);
 turnEl.textContent=active==="w"?"Weiß":"Schwarz";
 moveNoEl.textContent=fullMove;
 setClockToggleLabel();
}
function tick(){
 if(!running)return;
 const now=Date.now();
 const dt=now-lastTick;
 lastTick=now;

 if(active==="w"){
   whiteMs-=dt;
   if(whiteMs<=0){
     whiteMs=0;
     stopClock();
     statusEl.textContent="Zeit abgelaufen: Weiß verliert auf Zeit";
   }
 }else{
   blackMs-=dt;
   if(blackMs<=0){
     blackMs=0;
     stopClock();
     statusEl.textContent="Zeit abgelaufen: Schwarz verliert auf Zeit";
   }
 }

 renderClock();
}
function startClock(){
 if(running)return;
 running=true;
 lastTick=Date.now();
 timer=setInterval(tick,250);
 renderClock();
}
function stopClock(){
 running=false;
 clearInterval(timer);
 timer=null;
 lastTick=null;
 renderClock();
}
function resetClock(){
 stopClock();
 whiteMs=blackMs=CONTROL_MS;
 active="w";
 fullMove=1;
 renderClock();
}

/* ===== Regeln (vereinfachtes Move-Checking) ===== */
function isOwn(p){return p&&p[0]===active;}
function isLegal(from,to){
 if(from===to||!state[from])return false;
 const p=state[from], t=state[to];
 if(t&&t[0]===p[0])return false;
 const fr=Math.floor(from/8), fc=from%8;
 const tr=Math.floor(to/8), tc=to%8;
 const dr=tr-fr, dc=tc-fc;
 const adr=Math.abs(dr), adc=Math.abs(dc);
 function clear(sr,sc){
  let r=fr+sr,c=fc+sc;
  while(r!==tr||c!==tc){
   if(state[r*8+c])return false;
   r+=sr;c+=sc;
  }
  return true;
 }
 switch(p[1]){
  case"P":{
   const dir=p[0]==="w"?-1:1;
   const startRow=p[0]==="w"?6:1;
   if(dc===0){
    if(dr===dir&&!t)return true;
    if(fr===startRow&&dr===2*dir&&!t&&!state[(fr+dir)*8+fc])return true;
   }
   if(adr===1&&dr===dir&&t)return true;
   return false;
  }
  case"N":return(adr===2&&adc===1)||(adr===1&&adc===2);
  case"B":return adr===adc&&clear(Math.sign(dr),Math.sign(dc));
  case"R":return(dr===0||dc===0)&&clear(Math.sign(dr),Math.sign(dc));
  case"Q":return((adr===adc)||dr===0||dc===0)&&clear(Math.sign(dr),Math.sign(dc));
  case"K":return Math.max(adr,adc)===1;
 }
 return false;
}

/* ===== SAN ===== */
function san(from,to,piece,captured){
 const dest=coordLower(to);
 if(piece[1]==="P"){
  if(!captured)return dest;
  return coordLower(from)[0]+"x"+dest;
 }
 const map={K:"K",Q:"Q",R:"R",B:"B",N:"N"};
 return map[piece[1]]+(captured?"x":"")+dest;
}

/* ===== Legal Targets ===== */
function computeLegal(i){
 legal.clear();
 for(let j=0;j<64;j++) if(isLegal(i,j)) legal.add(j);
}

/* ===== UI Moves ===== */
function renderMoves(){
 movesEl.replaceChildren();
 const fragment=document.createDocumentFragment();
 for(let k=0;k<moves.length;k++){
  const li=document.createElement("li");
  li.textContent=moves[k];
  if(replay && replay.ply===k+1){
    li.classList.add("current-ply");
  }
  fragment.appendChild(li);
 }
 movesEl.appendChild(fragment);
}

/* ===== Render Board ===== */
function render(){
 const fragment=document.createDocumentFragment();
 for(let i=0;i<64;i++){
  const d=document.createElement("div");
  d.className=`sq ${sqColor(i)}`;
  if(i===selected)d.classList.add("selected");
  if(legal.has(i))d.classList.add("legal");
  if(replayHighlight){
    if(i===replayHighlight.fromIdx) d.classList.add("from");
    if(i===replayHighlight.toIdx) d.classList.add("to");
  }
  d.onclick=()=>clickSq(i);

  if(i%8===0){
   const r=document.createElement("div");
   r.className="coord-rank";
   r.textContent=8-Math.floor(i/8);
   d.appendChild(r);
  }
  if(Math.floor(i/8)===7){
   const f=document.createElement("div");
   f.className="coord-file";
   f.textContent="abcdefgh"[i%8];
   d.appendChild(f);
  }
  if(state[i]){
   const p=document.createElement("div");
   p.className="piece";
   p.textContent=P[state[i]];
   d.appendChild(p);
  }
  fragment.appendChild(d);
 }
 boardEl.replaceChildren(fragment);
}

/* ===== Klick (Edit-Modus) ===== */
function clickSq(i){
 if(replay){
  // Im Replay-Modus nicht klicken (keine Seiteneffekte)
  return;
 }
 if(selected==null){
  if(isOwn(state[i])){
   selected=i; computeLegal(i);
   statusEl.textContent="Feld: "+idxToCoord(i)+" (Ausgewählt)";
  }else statusEl.textContent="Feld: "+idxToCoord(i);
  render(); return;
 }
 if(!isLegal(selected,i)){
  selected=null; legal.clear(); render(); return;
 }

 history.push({
  state:state.slice(), moves:moves.slice(),
  whiteMs, blackMs, active, fullMove
 });
 undoBtn.disabled=false;

 const piece=state[selected];
 const cap=state[i];
 state[i]=piece; state[selected]=null;

 const sanTxt=san(selected,i,piece,cap);
 const coordTxt=`${idxToCoord(selected)}–${idxToCoord(i)}`;
 moves.push(piece[0]==="w" ? `${sanTxt} (${coordTxt})` : `… ${sanTxt} (${coordTxt})`);

 if(active==="b") fullMove++;
 active=active==="w"?"b":"w";

 selected=null; legal.clear();
 renderMoves(); renderClock(); render();
 evalCurrentPosition();
}

/* ===== PGN Export (Weg A: mit Koordinaten-Kommentaren) ===== */
function moveMetaFromUI(m){
 // m: "… e5 (E7–E5)" oder "e4 (E2–E4)"
 const txt=String(m||"");
 const clean=txt.replace(/^…\s*/,"");
 const cut=clean.indexOf(" (");
 const sanTok=cut>-1 ? clean.slice(0,cut) : clean;
 const coord=cut>-1 ? clean.slice(cut+2).replace(/[()]/g,"") : "";
 // coord ist z.B. "E2–E4" -> "E2-E4"
 return { san:sanTok.trim(), coord: normalizeDash(coord).trim() };
}
function buildPGN(){
  const d=new Date();
  const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,"0");
  const dd=String(d.getDate()).padStart(2,"0");
  const dateStr=`${yyyy}.${mm}.${dd}`;
  const header=[
    '[Event "Analyse"]',
    '[Site "Local"]',
    `[Date "${dateStr}"]`,
    '[White "Weiß"]',
    '[Black "Schwarz"]',
    '[Result "*"]'
  ].join("\n");

  const meta=moves.map(moveMetaFromUI);
  let body=[];
  for(let i=0;i<meta.length;i+=2){
    const no=(i/2)+1;
    const w=meta[i];
    const b=meta[i+1];
    const wStr=w? `${w.san}${w.coord?` {${w.coord}}`:""}` : "";
    const bStr=b? `${b.san}${b.coord?` {${b.coord}}`:""}` : "";
    body.push(b? `${no}. ${wStr} ${bStr}` : `${no}. ${wStr}`);
  }
  return header+"\n\n"+body.join(" ")+" *\n";
}
function downloadText(filename, text){
  const blob=new Blob([text],{type:"application/x-chess-pgn;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

/* ===== PGN Import + Replay ===== */
function stripHeaders(pgn){
  const lines=String(pgn||"").replace(/\r/g,"").split("\n");
  const body=[];
  for(const line of lines){
    if(!line.trim()) continue;
    if(line.trim().startsWith("[")) continue;
    body.push(line.trim());
  }
  return body.join(" ");
}
function tokenizeMovetext(txt){
  const s=String(txt||"");
  let tokens=[];
  let i=0;
  while(i<s.length){
    const ch=s[i];
    if(/\s/.test(ch)){ i++; continue; }
    if(ch==="{"){
      const j=s.indexOf("}", i+1);
      if(j===-1){
        tokens.push(s.slice(i).trim());
        break;
      }
      tokens.push(s.slice(i, j+1));
      i=j+1;
      continue;
    }
    // normal token
    let j=i;
    while(j<s.length && !/\s/.test(s[j]) && s[j]!=="{") j++;
    tokens.push(s.slice(i,j));
    i=j;
  }
  return tokens;
}
function parsePGNWithCoords(pgnText){
  const movetext=stripHeaders(pgnText)
    .replace(/\d+\.(\.\.)?/g,"") // move numbers
    .replace(/\$\d+/g,"")         // NAGs
    .replace(/\([^)]*\)/g,"")     // variations (simple)
    .trim();
  const tokens=tokenizeMovetext(movetext);

  const plies=[];
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(!t) continue;
    if(t==="*"||t==="1-0"||t==="0-1"||t==="1/2-1/2") continue;
    if(t.startsWith("{")) continue; // stray comment
    const sanTok=t;
    let coord=null;
    const next=tokens[i+1];
    if(next && next.startsWith("{")){
      coord=next.slice(1,-1).trim();
      i++;
    }
    plies.push({san:sanTok, coord: normalizeDash(coord)});
  }
  return plies;
}
function applyCoordMove(baseState, coord){
  // coord: "E2-E4"
  const c=normalizeDash(coord||"");
  const parts=c.split("-");
  if(parts.length!==2) return null;
  const from=coordToIdx(parts[0].trim());
  const to=coordToIdx(parts[1].trim());
  if(from==null||to==null) return null;
  if(!baseState[from]) return null; // Fix: ungültiger Quellzug
  const ns=baseState.slice();
  ns[to]=ns[from];
  ns[from]=null;
  return { state: ns, from, to };
}
function enterReplay(pgnText){
  stopReplayAuto();
  const plies=parsePGNWithCoords(pgnText);
  // Nur Weg A: wir erwarten Koordinaten
  const missing=plies.find(p=>!p.coord);
  if(missing){
    alert("Diese PGN hat (mindestens) einen Zug ohne {E2-E4} Kommentar.\nBitte exportiere aus diesem Tool (Weg A) oder ergänze die Koordinaten.");
    return;
  }

  // Build states
  const states=[start.slice()];
  const meta=[];
  for(const ply of plies){
    const prev=states[states.length-1];
    const res=applyCoordMove(prev, ply.coord);
    if(!res){
      alert("Konnte Koordinate nicht lesen: "+ply.coord);
      return;
    }
    states.push(res.state);
    meta.push({san:ply.san, coord:ply.coord, from:res.from, to:res.to});
  }

  // Fill UI moves list
  moves=[];
  for(let k=0;k<meta.length;k++){
    const m=meta[k];
    const coordPretty=normalizeDash(m.coord).replace(/-/g,"–");
    moves.push((k%2===0)? `${m.san} (${coordPretty})` : `… ${m.san} (${coordPretty})`);
  }
  history=[];
  undoBtn.disabled=true;

  replay={states, plies:meta, ply:0, auto:null};
  state=states[0].slice();
  selected=null; legal.clear();
  replayHighlight=null;
  syncTurnAndMoveFromReplayPly(0);

  statusEl.textContent="Replay aktiv: 0 / "+meta.length;
  setReplayUI(true);
  setReplayButtonsEnabled(true);
  renderMoves();
  renderReplayPos();
  renderClock();
  render();
  evalCurrentPosition();
}
function exitReplay(){
  stopReplayAuto();
  replay=null;
  replayHighlight=null;
  statusEl.textContent="Feld: –";
  setReplayUI(false);
  setReplayButtonsEnabled(false);
  renderReplayPos();
  renderClock();
  render();
  evalCurrentPosition();
}
function setReplayButtonsEnabled(on){
  rFirst.disabled=!on;
  rPrev.disabled=!on;
  rNext.disabled=!on;
  rLast.disabled=!on;
  rAuto.disabled=!on;
}
function renderReplayPos(){
  if(!replay){
    rPos.textContent="0 / 0";
    return;
  }
  rPos.textContent=`${replay.ply} / ${replay.plies.length}`;
}
function gotoPly(p){
  if(!replay) return;
  const max=replay.plies.length;
  const ply=Math.max(0, Math.min(max, p));
  replay.ply=ply;
  state=replay.states[ply].slice();
  selected=null; legal.clear();
  syncTurnAndMoveFromReplayPly(ply);

  if(ply===0){
    replayHighlight=null;
  }else{
    const last=replay.plies[ply-1];
    replayHighlight={fromIdx:last.from, toIdx:last.to};
  }
  statusEl.textContent=`Replay aktiv: ${ply} / ${max}`;
  renderMoves();
  renderReplayPos();
  renderClock();
  render();
  evalCurrentPosition();
}
function stopReplayAuto(){
  if(replay && replay.auto){
    clearInterval(replay.auto);
    replay.auto=null;
    rAuto.textContent="⏵ Auto";
  }
}
function toggleReplayAuto(){
  if(!replay) return;
  if(replay.auto){
    stopReplayAuto();
    return;
  }
  rAuto.textContent="⏸ Pause";
  replay.auto=setInterval(()=>{
    if(!replay) return;
    if(replay.ply>=replay.plies.length){
      stopReplayAuto();
      return;
    }
    gotoPly(replay.ply+1);
  }, 700);
}

/* ===== Buttons ===== */
document.getElementById("reset").onclick=()=>{
 if(replay) exitReplay();
 state=start.slice(); moves=[]; history=[];
 resetClock(); selected=null; legal.clear();
 renderMoves(); render(); undoBtn.disabled=true;
 evalCurrentPosition();
};
document.getElementById("clear").onclick=()=>{
 if(replay) exitReplay();
 state=Array(64).fill(null); moves=[]; history=[];
 resetClock(); selected=null; legal.clear();
 renderMoves(); render(); undoBtn.disabled=true;
 evalCurrentPosition();
};
document.getElementById("clearmoves").onclick=()=>{
 if(replay) exitReplay();
 moves=[];
 renderMoves();
 evalCurrentPosition();
};
document.getElementById("undo").onclick=()=>{
 if(replay) return;
 if(!history.length)return;
 const h=history.pop();
 state=h.state; moves=h.moves;
 whiteMs=h.whiteMs; blackMs=h.blackMs;
 active=h.active; fullMove=h.fullMove;
 renderMoves(); renderClock(); render();
 undoBtn.disabled=!history.length;
 evalCurrentPosition();
};
document.getElementById("clockToggle").onclick=()=>running?stopClock():startClock();
document.getElementById("clockReset").onclick=resetClock;

pgnBtn.onclick=()=>downloadText("game.pgn", buildPGN());

pgnFile.onchange=async(e)=>{
  const f=e.target.files && e.target.files[0];
  if(!f) return;
  try{
    const text=await f.text();
    enterReplay(text);
  }finally{
    e.target.value="";
  }
};
rFirst.onclick=()=>gotoPly(0);
rPrev.onclick=()=>gotoPly((replay?replay.ply:0)-1);
rNext.onclick=()=>gotoPly((replay?replay.ply:0)+1);
rLast.onclick=()=>gotoPly(replay?replay.plies.length:0);
rAuto.onclick=()=>toggleReplayAuto();

engToggle.onclick=()=>{
  if(!engineEnabled){
    if(!ensureEngine()){
      engineEnabled=false;
      engToggle.textContent="Engine: AUS";
      engScore.textContent="–";
      return;
    }
    engineEnabled=true;
    engToggle.textContent="Engine: AN";

    if(engineReadyPoll) clearInterval(engineReadyPoll);
    let tries=0;
    engineReadyPoll=setInterval(()=>{
      tries++;
      if(engineOk){
        clearInterval(engineReadyPoll);
        engineReadyPoll=null;
        evalCurrentPosition();
      }else if(tries>40){
        clearInterval(engineReadyPoll);
        engineReadyPoll=null;
        setEngineStatus("Engine nicht bereit");
      }
    }, 150);
  }else{
    engineEnabled=false;
    engineSeq++;
    enginePendingEval=false;
    if(engineBusy && engine){
      engine.postMessage("stop");
    }
    engToggle.textContent="Engine: AUS";
    engScore.textContent="–";
    if(engineReadyPoll){
      clearInterval(engineReadyPoll);
      engineReadyPoll=null;
    }
    setEngineStatus(engineOk?"bereit":"kein Stockfish.js");
  }
};

/* Init */
setReplayButtonsEnabled(false);
setEngineStatus("kein Stockfish.js");
engScore.textContent="–";
renderMoves();
renderClock();
render();
