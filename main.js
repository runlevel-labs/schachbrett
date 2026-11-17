const boardEl=document.getElementById("board");
const statusEl=document.getElementById("status");
const movesEl=document.getElementById("moves");
const movePanel=document.getElementById("movePanel");
const trainingToggle=document.getElementById("trainingToggle");
const trainingControls=document.getElementById("trainingControls");
const emptyMovesEl=document.getElementById("emptyMoves");
const clearMovesBtn=document.getElementById("clearmoves");
const undoBtn=document.getElementById("undo");
const pgnBtn=document.getElementById("pgn");
const promotionDialog=document.getElementById("promotion");
const setupPanel=document.getElementById("setupPanel");
const setupPieces=document.getElementById("setupPieces");
const setupErase=document.getElementById("setupErase");
const setupTurn=document.getElementById("setupTurn");
const setupError=document.getElementById("setupError");

const wTimeEl=document.getElementById("wtime");
const bTimeEl=document.getElementById("btime");
const whiteClock=wTimeEl.closest(".clockrow");
const blackClock=bTimeEl.closest(".clockrow");
const moveNoEl=document.getElementById("moveno");
const clockToggleBtn=document.getElementById("clockToggle");

const pgnFile=document.getElementById("pgnfile");
const replayControls=document.getElementById("replayControls");
const pgnError=document.getElementById("pgnError");
const pgnCollection=document.getElementById("pgnCollection");
const pgnNumber=document.getElementById("pgnNumber");
const pgnCount=document.getElementById("pgnCount");
const pgnPrevious=document.getElementById("pgnPrevious");
const pgnNext=document.getElementById("pgnNext");
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

const pieceShapes={k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"};

const game=new Chess();
let setup=null;
let startingFen=null;
let position=describePosition(game);
let selected=null;
let legalMoves=[];
let promotionTarget=null;
const clockHistory=[];
const moves=[];
let hiddenMoveCount=0;

// Replay
let replay=null;
let replayHighlight=null; // {fromIdx,toIdx}
let pgnLoadSequence=0;
let collection=null;
let trainingEnabled=false;
let training=null;

// Engine (Stockfish via WebWorker)
let engine=null;
let engineOk=false;
let engineSeq=0;
let engineSession=null;
let engineStartupTimer=null;
let enginePendingEval=false;
let engineSearch=null;
let localEngineSource=null;

function setReplayUI(on){
  boardEl.classList.toggle("replayMode", !!on);
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
 if(!/^[a-h][1-8]$/i.test(coord)) return null;
 return (8-Number(coord[1]))*8+"abcdefgh".indexOf(coord[0].toLowerCase());
}
function normalizeDash(s){
 return String(s||"").replace(/[–—]/g,"-");
}
function setClockToggleLabel(){
  if(clockToggleBtn) clockToggleBtn.textContent=running ? "Uhr stoppen" : "Uhr starten";
}
function sideName(side){
 return side==="w" ? "Weiß" : "Schwarz";
}
function gameOutcome(chess){
 if(chess.isCheckmate()){
  const whiteWins=chess.turn()==="b";
  return {
   result:whiteWins ? "1-0" : "0-1",
   message:`Schachmatt. ${sideName(whiteWins ? "w" : "b")} gewinnt.`
  };
 }
 let reason;
 if(chess.isStalemate()) reason="Patt";
 else if(chess.isInsufficientMaterial()) reason="unzureichendes Mattmaterial";
 else if(chess.isThreefoldRepetition()) reason="dreifache Stellungswiederholung";
 else if(chess.isDrawByFiftyMoves()) reason="50-Züge-Regel";
 return reason ? {result:"1/2-1/2", message:`Remis (${reason}).`} : null;
}
function describePosition(chess){
 const board=chess.board().flat();
 const turn=chess.turn();
 const hasKings=board.filter(piece=>piece?.type==="k").length===2;
 return {
  board, turn,
  moveNumber:chess.moveNumber(),
  fen:hasKings ? chess.fen() : null,
  checkSquare:hasKings && chess.isCheck()
   ? board.findIndex(piece=>piece?.type==="k" && piece.color===turn) : -1,
  outcome:hasKings ? gameOutcome(chess) : null
 };
}
function currentMoves(){
 return replay ? replay.plies : moves;
}
function renderStatus(){
 if(setup){
  statusEl.textContent="Stellung im Aufbau.";
  return;
 }
 if(training){
  statusEl.textContent=training.message;
  return;
 }
 const parts=[];
 if(position.outcome) parts.push(position.outcome.message);
 else if(position.checkSquare>=0) parts.push(`${sideName(position.turn)} steht im Schach.`);
 else parts.push(position.fen || replay ? `${sideName(position.turn)} am Zug.` : "Brett leer.");
 if(!replay && selected!==null) parts.push(`Feld ${idxToCoord(selected)} ausgewählt.`);
 statusEl.textContent=(replay ? "Wiedergabe · " : "")+parts.join(" ");
}

function setEngineStatus(text){
  engState.textContent=text;
  engState.hidden=text==="aus";
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

function loadLocalEngineSource(){
  if(typeof runStockfish==="function") return Promise.resolve(runStockfish);
  if(!localEngineSource){
    localEngineSource=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="stockfish.js";
      script.onload=()=>{
        script.remove();
        if(typeof runStockfish==="function") resolve(runStockfish);
        else reject(new Error("Stockfish-Startfunktion fehlt"));
      };
      script.onerror=()=>{
        script.remove();
        reject(new Error("stockfish.js konnte nicht geladen werden"));
      };
      document.head.appendChild(script);
    }).finally(()=>{ localEngineSource=null; });
  }
  return localEngineSource;
}

function stopEngine(status="aus"){
  engineSession=null;
  clearTimeout(engineStartupTimer);
  engine?.terminate();
  engine=null;
  engineOk=false;
  enginePendingEval=false;
  engineSearch=null;
  engToggle.textContent="Engine: AUS";
  engToggle.setAttribute("aria-pressed","false");
  engScore.textContent="–";
  setEngineStatus(status);
}

async function startEngine(){
  const session={};
  engineSession=session;
  engToggle.textContent="Engine: AN";
  engToggle.setAttribute("aria-pressed","true");
  setEngineStatus("startet…");
  engineStartupTimer=setTimeout(()=>stopEngine("Stockfish antwortet nicht"), 12000);

  let worker;
  try{
    if(location.protocol==="file:"){
      // Chrome blockiert Worker-Skripte mit file:-URL, erlaubt aber lokale Script-Tags.
      const source=await loadLocalEngineSource();
      if(engineSession!==session) return;
      const url=URL.createObjectURL(new Blob([`(${source.toString()})();`],{type:"text/javascript"}));
      try{
        worker=new Worker(url);
      }finally{
        URL.revokeObjectURL(url);
      }
    }else{
      worker=new Worker("stockfish.js");
    }
  }catch{
    if(engineSession===session) stopEngine("Stockfish konnte nicht geladen werden");
    return;
  }
  engine=worker;

  worker.onmessage=(e)=>{
    if(engine!==worker) return;
    const line=String(e.data||"");
    if(line.includes("uciok")){
      worker.postMessage("isready");
    }
    if(line.includes("readyok")){
      clearTimeout(engineStartupTimer);
      engineOk=true;
      evalCurrentPosition();
    }
    if(engineSearch){
      const mMate=line.match(/score mate (-?\d+)/);
      const mCp=line.match(/score cp (-?\d+)/);
      if(mMate) engineSearch.last={type:"mate", value:parseInt(mMate[1],10)};
      else if(mCp) engineSearch.last={type:"cp", value:parseInt(mCp[1],10)};

      if(line.startsWith("bestmove")){
        const finishedSearch=engineSearch;
        engineSearch=null;
        if(finishedSearch.seq===engineSeq){
          engScore.textContent=fmtScore(finishedSearch.last);
          setEngineStatus("bereit");
        }
        if(enginePendingEval){
          enginePendingEval=false;
          evalCurrentPosition();
        }
      }
    }
  };
  worker.onerror=()=>{
    if(engine===worker) stopEngine("Stockfish-Fehler");
  };
  worker.postMessage("uci");
}

function evalCurrentPosition(){
  if(!engine || !engineOk) return;
  const mySeq=++engineSeq;
  if(setup || !position.fen){
    enginePendingEval=false;
    if(engineSearch) engine.postMessage("stop");
    engScore.textContent="–";
    setEngineStatus(setup ? "wartet auf Stellung" : "keine bewertbare Stellung");
    return;
  }
  if(engineSearch){
    enginePendingEval=true;
    return;
  }

  enginePendingEval=false;
  engineSearch={seq: mySeq, last: null};
  setEngineStatus("rechnet…");
  engScore.textContent="…";

  engine.postMessage("ucinewgame");
  engine.postMessage(`position fen ${position.fen}`);
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
 whiteClock.setAttribute("aria-current",String(position.turn==="w"));
 blackClock.setAttribute("aria-current",String(position.turn==="b"));
 moveNoEl.textContent=position.moveNumber;
 clockToggleBtn.disabled=Boolean(setup || replay || position.outcome || !position.fen);
 setClockToggleLabel();
}
function tick(){
 if(!running)return;
 const now=Date.now();
 const dt=now-lastTick;
 lastTick=now;

 if(position.turn==="w"){
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
 if(running || clockToggleBtn.disabled)return;
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
 renderClock();
 renderStatus();
}

function clearSelection(){
 if(promotionDialog.open) promotionDialog.close();
 promotionTarget=null;
 selected=null;
 legalMoves=[];
}

const setupNames={k:"König",q:"Dame",r:"Turm",b:"Läufer",n:"Springer",p:"Bauer"};

function setupPieceName({color,type}){
 return `${sideName(color)}: ${setupNames[type]}`;
}

function pieceGlyph(piece){
 const glyph=document.createElement("span");
 glyph.className="piece-glyph";
 glyph.dataset.color=piece.color;
 glyph.textContent=pieceShapes[piece.type];
 glyph.setAttribute("aria-hidden","true");
 return glyph;
}

function selectSetupPiece(piece){
 setup.piece=piece;
 for(const button of setupPieces.querySelectorAll("button")){
  button.setAttribute("aria-pressed",String(button.value===piece));
 }
 setupErase.setAttribute("aria-pressed",String(piece===""));
}

function openSetup(){
 if(setup) return;
 stopReplayAuto();
 stopClock();
 clearSelection();
 setup={board:Array(64).fill(null),piece:"wK"};
 setupTurn.value="w";
 setupError.textContent="";
 setupPanel.hidden=false;
 undoBtn.disabled=true;
 pgnBtn.disabled=true;
 setReplayButtonsEnabled(false);
 renderTrainingControls();
 selectSetupPiece(setup.piece);
 renderStatus();
 renderClock();
 render();
 evalCurrentPosition();
 setupPieces.querySelector('[value="wK"]').focus();
}

function closeSetup(){
 if(!setup) return;
 setup=null;
 setupPanel.hidden=true;
 undoBtn.disabled=Boolean(replay || !moves.length);
 pgnBtn.disabled=false;
 setReplayButtonsEnabled(Boolean(replay?.plies.length) && !training);
 renderTrainingControls();
}

function applySetup(){
 const board=setup.board;
 const turn=setupTurn.value;
 for(const color of ["w","b"]){
  const pieces=board.filter(piece=>piece?.color===color);
  if(pieces.filter(piece=>piece.type==="k").length!==1){
   setupError.textContent="Setze genau einen weißen und einen schwarzen König.";
   return;
  }
  if(pieces.length>16 || pieces.filter(piece=>piece.type==="p").length>8){
   setupError.textContent="Pro Farbe sind höchstens 16 Figuren und darunter höchstens 8 Bauern möglich.";
   return;
  }
 }
 if(board.some((piece,i)=>piece?.type==="p" && (i<8 || i>=56))){
  setupError.textContent="Bauern dürfen auf der ersten und achten Reihe nur als umgewandelte Figuren stehen.";
  return;
 }
 const rows=[];
 for(let rank=0;rank<8;rank++){
  const row=board.slice(rank*8,rank*8+8).map(piece=>{
   if(!piece) return "-";
   return piece.color==="w" ? piece.type.toUpperCase() : piece.type;
  });
  rows.push(row.join("").replace(/-+/g,empty=>String(empty.length)));
 }
 const placement=rows.join("/");
 const other=turn==="w" ? "b" : "w";
 if(new Chess(`${placement} ${other} - - 0 1`).isCheck()){
  setupError.textContent=`${sideName(other)} steht im Schach. Prüfe die Figuren und wer am Zug ist.`;
  return;
 }
 resetBoard(`${placement} ${turn} - - 0 1`);
 document.getElementById("clear").focus({preventScroll:true});
}

for(const color of ["w","b"]){
 const row=document.createElement("div");
 row.className="setup-piece-row";
 row.setAttribute("role","group");
 row.setAttribute("aria-label",sideName(color));
 const label=document.createElement("span");
 label.className="setup-color";
 label.textContent=sideName(color);
 label.setAttribute("aria-hidden","true");
 row.appendChild(label);
 for(const type of Object.keys(setupNames)){
  const button=document.createElement("button");
  button.type="button";
  button.className="btn setup-piece";
  button.value=color+type.toUpperCase();
  button.appendChild(pieceGlyph({color,type}));
  button.title=setupPieceName({color,type});
  button.setAttribute("aria-label",button.title);
  button.onclick=()=>selectSetupPiece(button.value);
  row.appendChild(button);
 }
 setupPieces.appendChild(row);
}
setupErase.onclick=()=>selectSetupPiece("");
document.getElementById("setupApply").onclick=applySetup;
document.getElementById("setupCancel").onclick=()=>{
 closeSetup();
 renderStatus();
 renderClock();
 render();
 evalCurrentPosition();
 document.getElementById("clear").focus({preventScroll:true});
};

/* ===== UI Moves ===== */
function renderMoves(){
 movesEl.replaceChildren();
 movePanel.hidden=Boolean(training);
 if(training) return;
 const log=currentMoves();
 const hasVisibleMoves=log.length>hiddenMoveCount;
 movesEl.hidden=!hasVisibleMoves;
 emptyMovesEl.hidden=hasVisibleMoves;
 emptyMovesEl.textContent=hiddenMoveCount ? "Zugliste geleert" : "Noch keine Züge";
 clearMovesBtn.disabled=!hasVisibleMoves;
 movesEl.start=hiddenMoveCount+1;
 const fragment=document.createDocumentFragment();
 for(let k=hiddenMoveCount;k<log.length;k++){
  const li=document.createElement("li");
  const move=log[k];
  const notation=`${move.san} (${move.from.toUpperCase()}–${move.to.toUpperCase()})`;
  if(replay){
   const before=replay.positions[k];
   const button=document.createElement("button");
   button.type="button";
   button.textContent=`${before.moveNumber}${before.turn==="w" ? "." : "…"} ${notation}`;
   button.onclick=()=>seekReplay(k+1);
   li.appendChild(button);
  }else{
   li.textContent=move.color==="w" ? notation : `… ${notation}`;
  }
  fragment.appendChild(li);
 }
 movesEl.appendChild(fragment);
}

function markReplayMove(){
 const previous=movesEl.querySelector(".current-ply");
 if(previous){
  previous.classList.remove("current-ply");
  previous.firstElementChild.removeAttribute("aria-current");
 }
 const current=movesEl.children[replay.ply-1-hiddenMoveCount];
 if(!current) return;
 current.classList.add("current-ply");
 current.firstElementChild.setAttribute("aria-current","step");

 // Nur die Zugliste scrollen, damit das Brett im Blick bleibt.
 const top=current.offsetTop;
 const bottom=top+current.offsetHeight;
 if(top<movesEl.scrollTop) movesEl.scrollTop=top;
 else if(bottom>movesEl.scrollTop+movesEl.clientHeight){
  movesEl.scrollTop=bottom-movesEl.clientHeight;
 }
}

/* ===== Render Board ===== */
function render(){
 const fragment=document.createDocumentFragment();
 for(let i=0;i<64;i++){
  const d=document.createElement(setup || training ? "button" : "div");
  d.className=`sq ${sqColor(i)}`;
  if(i===selected)d.classList.add("selected");
  if(legalMoves.some(move=>move.to===coordLower(i)))d.classList.add("legal");
  if(!setup && i===position.checkSquare)d.classList.add("in-check");
  if(!setup && replayHighlight){
    if(i===replayHighlight.fromIdx) d.classList.add("from");
    if(i===replayHighlight.toIdx) d.classList.add("to");
  }
  d.onclick=()=>{
   clickSq(i);
   if(training && !promotionDialog.open) boardEl.children[i].focus({preventScroll:true});
  };
  const piece=setup ? setup.board[i] : position.board[i];
  if(setup || training){
   d.type="button";
   d.setAttribute("aria-label",`${idxToCoord(i)}, ${piece ? setupPieceName(piece) : "leer"}`);
  }

  if(i%8===0){
   const r=document.createElement("span");
   r.className="coord-rank";
   r.textContent=8-Math.floor(i/8);
   d.appendChild(r);
  }
  if(Math.floor(i/8)===7){
   const f=document.createElement("span");
   f.className="coord-file";
   f.textContent="abcdefgh"[i%8];
   d.appendChild(f);
  }
  if(piece){
   const p=document.createElement("span");
   p.className="piece";
   if(setup || training) p.setAttribute("aria-hidden","true");
   else{
    p.setAttribute("role","img");
    p.setAttribute("aria-label",setupPieceName(piece));
   }
   p.appendChild(pieceGlyph(piece));
   d.appendChild(p);
  }
  fragment.appendChild(d);
 }
 boardEl.replaceChildren(fragment);
}

/* ===== Züge auf dem Brett ===== */
function clickSq(i){
 if(setup){
  setup.board[i]=setup.piece ? {color:setup.piece[0],type:setup.piece[1].toLowerCase()} : null;
  setupError.textContent="";
  render();
  boardEl.children[i].focus({preventScroll:true});
  return;
 }
 if((replay && !training) || training?.done || (!training && position.outcome) ||
    !position.fen || promotionDialog.open) return;
 const target=coordLower(i);
 const move=legalMoves.find(candidate=>candidate.to===target);
 if(move?.promotion){
  promotionTarget=target;
  promotionDialog.showModal();
  return;
 }
 if(move){
  submitBoardMove(move);
  return;
 }

 const piece=position.board[i];
 selected=i!==selected && piece?.color===position.turn ? i : null;
 const chess=training && selected!==null ? new Chess(position.fen) : game;
 legalMoves=selected===null ? [] : chess.moves({square:target, verbose:true});
 renderStatus();
 render();
}

function submitBoardMove(move){
 if(training) submitTrainingMove(move);
 else playMove(move);
}

function playMove(move){
 if(running) tick();
 moves.push(game.move(move));
 clockHistory.push({whiteMs, blackMs});
 position=describePosition(game);
 if(position.outcome) stopClock();
 clearSelection();
 undoBtn.disabled=false;
 renderMoves();
 renderClock();
 renderStatus();
 render();
 evalCurrentPosition();
}

promotionDialog.querySelector("form").onsubmit=event=>{
 event.preventDefault();
 const promotion=event.submitter?.value;
 const move=legalMoves.find(candidate=>candidate.to===promotionTarget && candidate.promotion===promotion);
 promotionDialog.close();
 promotionTarget=null;
 if(move) submitBoardMove(move);
};
promotionDialog.oncancel=()=>{
 promotionTarget=null;
};

/* ===== PGN Export ===== */
function buildPGN(){
  if(replay) return replay.sourcePGN+"\n";
  const d=new Date();
  const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,"0");
  const dd=String(d.getDate()).padStart(2,"0");
  const dateStr=`${yyyy}.${mm}.${dd}`;
  const result=position.outcome?.result ?? "*";
  const header=[
    '[Event "Analyse"]',
    '[Site "Local"]',
    `[Date "${dateStr}"]`,
    '[Round "?"]',
    '[White "Weiß"]',
    '[Black "Schwarz"]',
    `[Result "${result}"]`
  ];
  if(startingFen) header.push('[SetUp "1"]', `[FEN "${startingFen}"]`);

  const body=currentMoves().map((move,i)=>{
    const number=move.before.split(" ")[5];
    const prefix=move.color==="w" ? `${number}. ` : i===0 ? `${number}... ` : "";
    const coord=`${move.from.toUpperCase()}-${move.to.toUpperCase()}`;
    return `${prefix}${move.san} {${coord}}`;
  });
  return header.join("\n")+"\n\n"+[...body,result].join(" ")+"\n";
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
    if(t==="*"||t==="1-0"||t==="0-1"||t==="1/2-1/2"){
      if(tokens.slice(i+1).some(token=>!token.startsWith("{"))) return [];
      break;
    }
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
function describeLegacyReplayMove(position, from, to, ply){
  // Ältere Exporte können Züge enthalten, die die alte Oberflächenprüfung erlaubt hat.
  const board=position.board.slice();
  board[to]=board[from];
  board[from]=null;
  return {
    board,
    turn:ply%2===0 ? "w" : "b",
    moveNumber:Math.floor(ply/2)+1,
    fen:null,
    checkSquare:-1,
    outcome:null
  };
}
function readCoordinateReplay(pgnText){
  const plies=parsePGNWithCoords(pgnText);
  if(!plies.length || plies.some(p=>!p.coord)) return null;

  const chess=new Chess();
  const positions=[describePosition(chess)];
  const meta=[];
  for(const ply of plies){
    const parts=ply.coord.split("-").map(part=>part.trim().toLowerCase());
    const [from,to]=parts;
    const fromIdx=coordToIdx(from);
    const toIdx=coordToIdx(to);
    const previous=positions.at(-1);
    if(parts.length!==2 || fromIdx===null || toIdx===null || !previous.board[fromIdx]){
      return null;
    }
    const promotion=ply.san.match(/=([QRBN])/i)?.[1].toLowerCase();
    let move;
    if(previous.fen){
      move=chess.moves({square:from, verbose:true})
        .find(candidate=>candidate.to===to && candidate.promotion===promotion);
    }
    if(move){
      chess.move(move);
      positions.push(describePosition(chess));
    }else{
      positions.push(describeLegacyReplayMove(previous, fromIdx, toIdx, positions.length));
    }
    meta.push({san:move?.san ?? ply.san, from, to, promotion:move?.promotion});
  }

  return {positions, plies:meta};
}

function normalizeFenTag(header){
  return header.replace(/^(\[\s*FEN\s+")([^"]+)("\s*\])$/i, (_tag, open, fen, close)=>{
    const fields=fen.trim().split(/\s+/);
    if(fields[2]===undefined || fields[2]==="-") return header;
    const chess=new Chess(fen);
    const homes={K:["w","e1","h1"],Q:["w","e1","a1"],k:["b","e8","h8"],q:["b","e8","a8"]};
    fields[2]=Array.from(fields[2]).filter(right=>{
      const [color,king,rook]=homes[right];
      return chess.get(king)?.type==="k" && chess.get(king)?.color===color &&
        chess.get(rook)?.type==="r" && chess.get(rook)?.color===color;
    }).join("") || "-";
    return open+fields.join(" ")+close;
  });
}

function readStandardReplay(pgnText){
  // Für die Wiedergabe zählen die Züge. Metadaten und Kommentare bleiben im Export erhalten.
  const annotations=/(\[\s*[A-Za-z0-9_]+\s+"(?:\\.|[^"\\])*"\s*\])|^%[^\r\n]*|\{[^}]*\}|;[^\r\n]*|\$\d+/gm;
  const chess=new Chess();
  chess.loadPgn(pgnText.replace(annotations, (_token, header)=>header ? normalizeFenTag(header) : " "));
  const headers=chess.getHeaders();
  const isSolver=tag=>headers[tag]?.trim().toLowerCase()==="solver";
  const solver=isSolver("White")!==isSolver("Black") ? (isSolver("White") ? "w" : "b") : null;
  const positions=[];
  const plies=[];
  while(true){
    positions.push(describePosition(chess));
    const move=chess.undo();
    if(!move) break;
    plies.push(move);
  }
  if(!plies.length && !chess.getHeaders().FEN) return null;
  return {positions:positions.reverse(), plies:plies.reverse(), solver};
}

function indexPgn(text){
  const tokens=/\[\s*[A-Za-z0-9_]+\s+"(?:\\.|[^"\\])*"\s*\]|^%[^\r\n]*|\{[^}]*\}|;[^\r\n]*|[()*]|[^\s\[\]{}();*]+/gm;
  const starts=[0];
  let variation=0;
  let moves=false;
  let ended=false;
  for(let match; (match=tokens.exec(text));){
    const token=match[0];
    const first=token[0];
    if(first==="{" || first===";" || first==="%") continue;
    if(first==="("){ variation++; continue; }
    if(first===")"){ variation=Math.max(0, variation-1); continue; }
    if(variation) continue;
    const header=first==="[";
    if(ended || (header && moves)){
      starts.push(match.index);
      moves=ended=false;
    }
    if(!header){
      moves=true;
      ended=token==="*" || token==="1-0" || token==="0-1" || token==="1/2-1/2";
    }
  }
  return starts;
}

function selectPgn(index){
  const {text,starts}=collection;
  if(!Number.isInteger(index) || index<0 || index>=starts.length) return;
  collection.index=index;
  pgnNumber.value=index+1;
  pgnPrevious.disabled=index===0;
  pgnNext.disabled=index===starts.length-1;
  pgnError.textContent="";
  try{
    enterReplay(text.slice(starts[index],starts[index+1]));
  }catch{
    pgnError.textContent=`Partie ${index+1} konnte nicht gelesen werden.`;
  }
}

function enterReplay(pgnText){
  const text=pgnText.replace(/^\uFEFF/,"").trim();
  const coordinates=/\{\s*[a-h][1-8]\s*[-–—]\s*[a-h][1-8]\s*\}/i;
  const hasStartingFen=/^\s*\[\s*FEN\s+/im.test(text);
  const legacy=!hasStartingFen && coordinates.test(text) ? readCoordinateReplay(text) : null;
  const loaded=legacy ?? readStandardReplay(text);
  if(!loaded) throw new Error("Keine Partie gefunden");
  closeSetup();
  training=null;
  stopReplayAuto();
  stopClock();
  clearSelection();
  undoBtn.disabled=true;
  hiddenMoveCount=0;
  replay={...loaded, sourcePGN:text, ply:0, auto:null};
  setReplayUI(true);
  if(trainingEnabled && startTraining()) return;
  setReplayButtonsEnabled(replay.plies.length>0);
  renderTrainingControls();
  renderMoves();
  movesEl.scrollTop=0;
  gotoPly(0);
}

function renderTrainingControls(){
  trainingControls.hidden=!training || Boolean(setup);
  trainingToggle.disabled=Boolean(setup);
  trainingToggle.textContent=trainingEnabled && replay && !training ? "Aufgabe lösen" : "Aufgabenmodus";
  trainingToggle.setAttribute("aria-pressed",String(Boolean(training || (trainingEnabled && !replay))));
  boardEl.classList.toggle("training-mode",Boolean(training && !setup));
}

function startTraining(){
  const side=replay.solver ?? replay.positions[0].turn;
  const first=replay.positions[0].turn===side ? 0 : 1;
  if(first>=replay.plies.length || replay.positions.some(frame=>!frame.fen) ||
     replay.plies.some(move=>move.from===move.to)) return false;
  stopReplayAuto();
  clearSelection();
  training={side,done:false,message:`Aufgabe · ${sideName(side)} am Zug.`};
  setReplayButtonsEnabled(false);
  renderTrainingControls();
  renderMoves();
  gotoPly(first);
  return true;
}

function submitTrainingMove(move){
  const expected=replay.plies[replay.ply];
  clearSelection();
  if(move.from!==expected.from || move.to!==expected.to || move.promotion!==expected.promotion){
    training.message="Dieser Zug gehört nicht zur gespeicherten Lösung. Versuch es noch einmal.";
    renderStatus();
    render();
    return;
  }
  let next=replay.ply+1;
  if(next<replay.plies.length && replay.positions[next].turn!==training.side) next++;
  training.done=next===replay.plies.length;
  training.message=training.done ? "Gelöst! Du hast die gespeicherte Zugfolge gefunden."
    : `Richtig. ${sideName(training.side)} ist wieder am Zug.`;
  gotoPly(next);
}

function revealTraining(){
  training=null;
  clearSelection();
  if(replay) hiddenMoveCount=0;
  setReplayButtonsEnabled(Boolean(replay?.plies.length));
  renderTrainingControls();
  renderMoves();
  if(replay) gotoPly(replay.ply);
}

function exitReplay(){
  stopReplayAuto();
  training=null;
  replay=null;
  replayHighlight=null;
  setReplayUI(false);
  setReplayButtonsEnabled(false);
  renderReplayPos();
  renderTrainingControls();
}
function setReplayButtonsEnabled(on){
  replayControls.hidden=!on;
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
  position=replay.positions[ply];

  if(ply===0){
    replayHighlight=null;
  }else{
    const last=replay.plies[ply-1];
    replayHighlight={fromIdx:coordToIdx(last.from), toIdx:coordToIdx(last.to)};
  }
  renderStatus();
  markReplayMove();
  renderReplayPos();
  renderClock();
  render();
  evalCurrentPosition();
}
function seekReplay(ply){
  if(training) return;
  stopReplayAuto();
  gotoPly(ply);
}
function stopReplayAuto(){
  if(replay && replay.auto){
    clearInterval(replay.auto);
    replay.auto=null;
    rAuto.textContent="⏵ Auto";
  }
}
function toggleReplayAuto(){
  if(!replay || training) return;
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
function resetBoard(fen=null){
 pgnLoadSequence++;
 pgnError.textContent="";
 collection=null;
 pgnCollection.hidden=true;
 if(replay) exitReplay();
 closeSetup();
 startingFen=fen || null;
 if(startingFen) game.load(startingFen);
 else game.reset();
 position=describePosition(game);
 moves.length=0;
 clockHistory.length=0;
 hiddenMoveCount=0;
 clearSelection();
 resetClock();
 renderMoves(); render(); undoBtn.disabled=true;
 evalCurrentPosition();
}
document.getElementById("reset").onclick=()=>resetBoard();
document.getElementById("clear").onclick=openSetup;
clearMovesBtn.onclick=()=>{
 hiddenMoveCount=currentMoves().length;
 renderMoves();
};
undoBtn.onclick=()=>{
 if(replay || !game.undo()) return;
 const clock=clockHistory.pop();
 whiteMs=clock.whiteMs;
 blackMs=clock.blackMs;
 if(running) lastTick=Date.now();
 moves.pop();
 hiddenMoveCount=Math.min(hiddenMoveCount,moves.length);
 position=describePosition(game);
 clearSelection();
 renderStatus();
 renderMoves(); renderClock(); render();
 undoBtn.disabled=!moves.length;
 evalCurrentPosition();
};
document.getElementById("clockToggle").onclick=()=>running?stopClock():startClock();
document.getElementById("clockReset").onclick=resetClock;

pgnBtn.onclick=()=>downloadText("game.pgn", buildPGN());
document.getElementById("pgnLoad").onclick=()=>pgnFile.click();
trainingToggle.onclick=()=>{
  if(training || (!replay && trainingEnabled)){
    trainingEnabled=false;
    revealTraining();
    return;
  }
  trainingEnabled=true;
  if(replay && !startTraining()){
    statusEl.textContent="Diese PGN enthält keine spielbare Lösung.";
  }
  renderTrainingControls();
};
document.getElementById("trainingRestart").onclick=()=>startTraining();
document.getElementById("trainingReveal").onclick=()=>{
  revealTraining();
  rNext.focus({preventScroll:true});
};

pgnFile.onchange=async(e)=>{
  const f=e.target.files?.[0];
  if(!f) return;
  e.target.value="";
  const request=++pgnLoadSequence;
  pgnError.textContent="";
  try{
    const text=await f.text();
    if(request!==pgnLoadSequence) return;
    const starts=indexPgn(text);
    const total=starts.length;
    collection={text,starts,index:0};
    pgnCollection.hidden=total===1;
    pgnNumber.max=total;
    pgnCount.textContent=`von ${total.toLocaleString("de-DE")}`;
    selectPgn(0);
  }catch{
    if(request===pgnLoadSequence){
      pgnError.textContent="Die PGN-Datei konnte nicht geöffnet werden.";
    }
  }
};
document.getElementById("pgnJump").onsubmit=event=>{
  event.preventDefault();
  if(collection) selectPgn(pgnNumber.valueAsNumber-1);
};
pgnPrevious.onclick=()=>selectPgn(collection.index-1);
pgnNext.onclick=()=>selectPgn(collection.index+1);
rFirst.onclick=()=>seekReplay(0);
rPrev.onclick=()=>seekReplay(replay.ply-1);
rNext.onclick=()=>seekReplay(replay.ply+1);
rLast.onclick=()=>seekReplay(replay.plies.length);
rAuto.onclick=()=>toggleReplayAuto();

engToggle.onclick=()=>engineSession ? stopEngine() : startEngine();

/* Init */
setReplayButtonsEnabled(false);
renderMoves();
renderClock();
renderStatus();
render();
