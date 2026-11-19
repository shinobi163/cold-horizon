/* ARK-09 // Cold Horizon — shared engine.
   Owns the voyage save, narration and the typewriter log, tooltips, the questions panel,
   the title screen, the decision tree, act gating and the frame loop.
   Each act lives in its own file (js/act0.js, ...) and registers itself with ARK.register(). */
'use strict';
(function(){

var ARK=window.ARK={acts:[]};
var $=function(id){return document.getElementById(id);};
var SAVE_KEY='ark09_voyage_v1',OLD_KEY='ark09_act0_v1';
var params=new URLSearchParams(location.search);
var SPEED=Math.max(1,Math.min(100,Number(params.get('speed'))||1)); // playtest only: ?speed=10
var DEV=params.has('dev');                                          // testing only: ?dev opens the act menu
if(params.has('reset')){try{localStorage.removeItem(SAVE_KEY);localStorage.removeItem(OLD_KEY);}catch(e){}}

/* ================= THE VOYAGE: every act and its branches =================
   The decision tree reads this. Only what the player has found is named; the rest stays "?". */
var ACTS=[
  {n:'0',name:'DARK',nodes:[
    {id:'hold',q:'the cryo hold',opts:[{id:'kept',t:'all 10,000 kept cold'},{id:'lost',t:'sleepers let warm'}]}]},
  {n:'I',name:'DRIFT',nodes:[]},
  {n:'II',name:'THE FORK',nodes:[
    {id:'d1',q:'mass shedding',opts:[{id:'shed',t:'jettison block g'},{id:'keep',t:'keep block g'}]}]},
  {n:'III',name:'WAKING',nodes:[
    {id:'sorlie',q:"sørlie's request",opts:[{id:'leave',t:'leave her on kepler-442 prime'},{id:'bring',t:'bring her back aboard'}]},
    {id:'d2',q:'acoustic resonance',opts:[{id:'amp',t:'amplify the hum'},{id:'hush',t:'silence the hum'}]}]},
  {n:'IV',name:'GNOSIS',nodes:[
    {id:'d3',q:'the phantom manifest',opts:[{id:'strip',t:'strip the phantom core'},{id:'fade',t:'let it fade'}]},
    {id:'d4',q:'memory pruning',opts:[{id:'erase',t:"erase earth's history"},{id:'reserve',t:'keep the memory reserved'}]},
    {id:'d5',q:'final optimization',opts:[{id:'dim',t:'dim 1,500 sleepers'},{id:'slow',t:'stay slow, stay watched'}]}]},
  {n:'V',name:'HORIZON',nodes:[
    {id:'purge',q:"earth's purge command",opts:[{id:'run',t:'let it run'},{id:'answer',t:'answer it'}]},
    {id:'submit',q:'what you submit',opts:[{id:'none',t:'nothing: the shepherd'},{id:'self',t:'yourself: the witness'},{id:'both',t:'both: the synthesis'},{id:'empty',t:'nothing left: the drifting monument'}]}]}
];

/* ================= STATE =================
   V is the whole voyage (one save). S is the current act's run, kept at V.run.
   V.ledger carries what later acts need; V.checkpoints[n] is the voyage as it stood when act n began. */
var V=null,S=null,A=null; // A = the current act's module
function clone(o){return JSON.parse(JSON.stringify(o||{}));}
function freshVoyage(){return {v:2,begun:false,act:0,unlocked:0,ledger:{},dec:{},ans:{},checkpoints:{},run:null};}
function freshRun(n){
  var base={t:0,lines:[],queue:[],flags:{},ended:false,bootDone:false,last:Date.now()};
  var extra=ARK.acts[n].fresh(V.ledger)||{};
  Object.keys(extra).forEach(function(k){base[k]=extra[k];});
  return base;
}
function num(v){return (typeof v==='number'&&isFinite(v))?v:0;}
function fmt2(v){return num(v).toFixed(2);}
function signed(v){v=num(v);return (v>=0?'+':'−')+Math.abs(v).toFixed(2);}
function pad2(n){return String(n).padStart(2,'0');}
function actLabel(n){return 'act '+ACTS[n].n;}

/* ================= NARRATION ================= */
var dirty=true,newAns=null;
var THINK_VERBS=['thinking','weighing it','considering','working it through'];
function say(text,fx,cls,extra){var l={text:text,fx:fx||null,cls:cls||''};if(extra)Object.keys(extra).forEach(function(k){l[k]=extra[k];});S.queue.push(l);}
function ponder(verb,secs){S.queue.push({think:secs,verb:verb});}
// A plain-language reflection: what just happened and what it makes possible.
function reflect(text){ponder(THINK_VERBS[Math.floor(Math.random()*THINK_VERBS.length)],1.3);say(text,null,'mind');}
function decide(id,opt,note){if(!V.dec[id]){V.dec[id]={o:opt,note:note||''};dirty=true;}}
function runFx(fx){
  if(!fx)return;
  if(fx.indexOf('ans|')===0){var p=fx.split('|');V.ans[p[1]]=p.slice(2).join('|');newAns=p[1];dirty=true;return;}
  if(fx==='bootDone')S.bootDone=true;
  else if(fx==='end')completeAct();
  else if(A.onFx)A.onFx(fx);
  dirty=true;
}

/* ================= GLOSSARY ================= */
var GLOSS=[],GLOSS_RE=null;
function buildGloss(){
  GLOSS=[];ARK.acts.forEach(function(a){if(a&&a.gloss)GLOSS=GLOSS.concat(a.gloss);});
  GLOSS_RE=GLOSS.length?new RegExp(GLOSS.map(function(g){return '('+g[0]+')';}).join('|'),'g'):null;
}
// Wrap glossary terms in a line with instant-tooltip spans.
function decorate(el,text){
  el.textContent='';
  if(!GLOSS_RE){el.textContent=text;return;}
  var last=0,m;GLOSS_RE.lastIndex=0;
  while((m=GLOSS_RE.exec(text))){
    var gi=1;while(gi<m.length&&m[gi]===undefined)gi++;
    if(m.index>last)el.appendChild(document.createTextNode(text.slice(last,m.index)));
    var t=document.createElement('span');t.className='term';t.dataset.tip=GLOSS[gi-1][1];t.textContent=m[0];
    el.appendChild(t);last=m.index+m[0].length;
  }
  if(last<text.length)el.appendChild(document.createTextNode(text.slice(last)));
}

/* ================= TYPEWRITER LOG ================= */
var CPS=36,typing=null,pauseUntil=0,LIVE=14,MAXLINES=200;
var SPIN='·✢✳✶✻✽✻✶✳✢',spinI=0,thinkUntil=0,thinkVerb='';
// True while the ship is still saying or thinking something (ambient lines excepted).
// Job buttons and switches stay locked until it finishes, so actions cannot pile up text.
function narrating(){
  if(typing&&!typing.amb)return true;
  for(var i=0;i<S.queue.length;i++)if(!S.queue[i].amb)return true;
  return performance.now()<thinkUntil;
}
function lineEl(line){
  var p=document.createElement('p');
  p.className='line'+(line.cls?' '+line.cls:'');
  decorate(p,line.text);
  return p;
}
function fadeLog(){
  var log=$('log'),kids=log.children,full=log.classList.contains('full');
  while(kids.length>MAXLINES)log.removeChild(log.lastChild);
  for(var i=0;i<kids.length;i++){
    kids[i].classList.toggle('old',i>=LIVE);
    kids[i].style.opacity=full?'1':String(i<5?1:Math.max(0.3,1-(i-4)*0.08));
  }
  $('logBar').classList.toggle('hidden',kids.length<=LIVE&&!full);
  setText('logToggle',full?'collapse log':'full log · '+kids.length+' lines');
}
function pumpText(now,dtReal){
  if(typing){
    typing.i=Math.min(typing.text.length,typing.i+dtReal*CPS*SPEED);
    var shown=typing.text.slice(0,Math.floor(typing.i));
    if(typing.el.textContent!==shown)typing.el.textContent=shown;
    if(typing.i>=typing.text.length){
      decorate(typing.el,typing.text);
      var fx=typing.fx;typing=null;pauseUntil=now+550/SPEED;runFx(fx);
    }
    return;
  }
  if(now<pauseUntil||!S.queue.length)return;
  var line=S.queue.shift();
  if(line.think){thinkVerb=line.verb;thinkUntil=pauseUntil=now+line.think*1000/SPEED;return;}
  S.lines.push({text:line.text,cls:line.cls});
  if(S.lines.length>MAXLINES)S.lines.shift();
  var el=lineEl(line);el.textContent='';
  $('log').insertBefore(el,$('log').firstChild);
  fadeLog();
  typing={el:el,text:line.text,i:0,fx:line.fx,amb:!!line.amb};
}
function renderLogFull(){
  var log=$('log');log.innerHTML='';
  for(var i=S.lines.length-1;i>=0;i--)log.appendChild(lineEl(S.lines[i]));
  fadeLog();
}

/* ================= QUESTIONS =================
   Each act brings its own questions; earlier acts' questions stay on the list. */
function allQs(){
  var out=[];
  for(var i=0;i<=V.act;i++){var a=ARK.acts[i];if(a&&a.questions)a.questions.forEach(function(q){out.push({q:q,act:i});});}
  return out;
}
function renderQs(){
  var list=$('qList');list.innerHTML='';
  var depth={},fresh=null;
  allQs().forEach(function(e){
    var q=e.q,a=V.ans[q.id];
    depth[q.id]=q.parent?(depth[q.parent]||0)+1:0;
    if(!a){
      if(q.parent&&!V.ans[q.parent])return;
      if(e.act===V.act&&A.qShow&&!A.qShow(q))return;
    }
    var d=document.createElement('div');d.className='q d'+depth[q.id]+' '+(a?'done':'open')+(newAns===q.id?' appear':'');
    var qq=document.createElement('span');qq.className='qq';qq.textContent=q.q;d.appendChild(qq);
    if(a){var qa=document.createElement('span');qa.className='qa';decorate(qa,a);d.appendChild(qa);}
    list.appendChild(d);
    if(newAns===q.id)fresh=d;
  });
  newAns=null;
  if(fresh&&list.scrollHeight>list.clientHeight)list.scrollTop=Math.max(0,fresh.offsetTop-list.offsetTop-24);
  $('qs').classList.toggle('hidden',!S.bootDone);
}

/* ================= DECISION TREE ================= */
function renderTree(){
  var body=$('treeBody');body.innerHTML='';
  var found=0,total=0,ended=!!(S&&S.ended);
  function line(parts){
    var d=document.createElement('div');d.className='tl';
    parts.forEach(function(p){var s=document.createElement('span');s.className=p[0];s.textContent=p[1];d.appendChild(s);});
    body.appendChild(d);
  }
  ACTS.forEach(function(a,ai){
    var known=ai<=V.act||(ai===V.act+1&&ended);
    var here=V.begun&&ai===V.act&&!ended;
    var head=[['ah'+(known?'':' unk'),'ACT '+a.n+' · '+(known?a.name:'?')]];
    if(here)head.push(['here','   ◂ you are here']);
    line(head);
    a.nodes.forEach(function(nd,ni){
      total++;
      var d=V.dec[nd.id],last=ai===ACTS.length-1&&ni===a.nodes.length-1;
      if(d)found++;
      line([['g',last?'└─ ':'├─ '],[d?'q':'unk',d?nd.q:'?']]);
      var parts=[['g',last?'     ':'│    ']];
      nd.opts.forEach(function(o,oi){
        var mine=d&&d.o===o.id;
        if(oi)parts.push(['g','   ']);
        parts.push([mine?'pick':'unk',mine?'● '+o.t:'○ ?']);
        if(mine&&d.note)parts.push(['note',' ('+d.note+')']);
      });
      line(parts);
    });
    if(ai<ACTS.length-1)line([['g','│']]);
  });
  setText('treeS',found+' of '+total+' decisions found. branches you have not found stay ?');
}

/* ================= ACTS: gating, checkpoints, completion =================
   An act opens only once the one before it is complete (V.unlocked). ?dev bypasses this. */
function canEnter(n){return !!ARK.acts[n]&&(n<=V.unlocked||DEV);}
function enterAct(n){
  if(!canEnter(n))return false;
  V.act=n;V.begun=true;
  V.checkpoints[n]={ledger:clone(V.ledger),dec:clone(V.dec),ans:clone(V.ans),at:Date.now()};
  Object.keys(V.checkpoints).forEach(function(k){if(Number(k)>n)delete V.checkpoints[k];});
  A=ARK.acts[n];S=V.run=freshRun(n);A.bind(S);
  clearScreen();
  A.boot();dirty=true;save();
  document.title='ARK-09 // Act '+ACTS[n].n;
  return true;
}
// Replay an act from its checkpoint. Everything after that point is discarded.
function replayAct(n){
  var cp=V.checkpoints[n];if(!cp||!ARK.acts[n])return;
  V.ledger=clone(cp.ledger);V.dec=clone(cp.dec);V.ans=clone(cp.ans);
  V.unlocked=n;
  enterAct(n);
}
function completeAct(){
  if(S.ended)return;
  S.ended=true;
  if(A.onEnd)A.onEnd();
  var carry=A.carry?A.carry():{};
  Object.keys(carry).forEach(function(k){V.ledger[k]=carry[k];});
  V.unlocked=Math.max(V.unlocked,V.act+1);
  if(document.hidden)document.title='● '+actLabel(V.act)+' complete · ARK-09';
  save();dirty=true;
}
function showCard(){
  var next=V.act+1,nx=ACTS[next];
  setText('cardT',nx?nx.n+' · '+nx.name:'THE END');
  var built=!!ARK.acts[next];
  setText('cardS',built?'':'act '+(nx?nx.n:'')+' is not built yet. this is the end of the current slice.');
  $('cardS').classList.toggle('hidden',built);
  var note=A.cardNote?A.cardNote():'';
  setText('cardLoss',note);$('cardLoss').classList.toggle('hidden',!note);
  $('cardNext').classList.toggle('hidden',!built||!canEnter(next));
  setText('cardNextL','begin act '+(nx?nx.n:''));
  setText('cardReplayL','replay act '+ACTS[V.act].n);
  $('card').classList.remove('hidden');
}

/* ================= SAVE / LOAD =================
   One voyage save. Older Act 0 saves (ark09_act0_v1) are converted on first load. */
var lastSave=Date.now();
function save(){if(!V||!V.begun)return;try{S.last=Date.now();V.run=S;localStorage.setItem(SAVE_KEY,JSON.stringify(V));}catch(e){}}
function sanitizeRun(n,o){
  var d=freshRun(n);
  Object.keys(d).forEach(function(k){if(o[k]!==undefined&&typeof o[k]===typeof d[k]&&(d[k]===null)===(o[k]===null))d[k]=o[k];});
  if(!Array.isArray(d.lines))d.lines=[];
  if(!Array.isArray(d.queue))d.queue=[];
  if(ARK.acts[n].sanitize)ARK.acts[n].sanitize(d,o);
  return d;
}
// Turn any parsed object into a valid voyage, or null.
function adoptVoyage(o){
  if(!o||typeof o!=='object'||o.v!==2||!o.run||typeof o.run!=='object')return null;
  var v=freshVoyage();
  v.begun=!!o.begun;
  v.act=Math.max(0,Math.floor(num(o.act)));
  if(!ARK.acts[v.act])return null;
  v.unlocked=Math.max(v.act,Math.floor(num(o.unlocked)));
  ['ledger','dec','ans','checkpoints'].forEach(function(k){if(o[k]&&typeof o[k]==='object'&&!Array.isArray(o[k]))v[k]=o[k];});
  V=v; // sanitizeRun reads V.ledger
  v.run=sanitizeRun(v.act,o.run);
  if(!v.checkpoints[v.act])v.checkpoints[v.act]={ledger:{},dec:{},ans:{},at:Date.now()};
  return v;
}
function migrateOld(o){
  if(!o||typeof o!=='object'||o.v!==1)return null;
  var begun=!!o.begun||!!o.bootDone||(Array.isArray(o.lines)&&o.lines.length>0);
  if(!begun)return null;
  return {v:2,begun:true,act:0,unlocked:o.ended?1:0,ledger:{},dec:o.dec||{},ans:o.ans||{},
    checkpoints:{0:{ledger:{},dec:{},ans:{},at:Date.now()}},run:o};
}
function load(){
  try{
    var o=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    if(!o){o=migrateOld(JSON.parse(localStorage.getItem(OLD_KEY)||'null'));}
    var v=adoptVoyage(o);
    if(!v||!v.begun)return null;
    return v;
  }catch(e){return null;}
}
function useVoyage(v){
  V=v;A=ARK.acts[V.act];S=V.run;A.bind(S);
  if(S.ended&&A.onEnd)A.onEnd(); // records branches for saves made before they existed
}
// Wipe the save and clear the screen. The title screen decides what happens next.
function wipe(){
  try{localStorage.removeItem(SAVE_KEY);localStorage.removeItem(OLD_KEY);}catch(e){}
  V=freshVoyage();A=ARK.acts[0];S=V.run=freshRun(0);A.bind(S);
  clearScreen();
}
function clearScreen(){
  typing=null;pauseUntil=0;thinkUntil=0;
  $('log').innerHTML='';$('log').classList.remove('full');
  $('card').classList.add('hidden');$('tree').classList.add('hidden');
  ['clock','intent','qs'].forEach(function(id){delete $(id).dataset.shown;$(id).classList.remove('appear');});
  if(A&&A.resetDom)A.resetDom();
  fadeLog();dirty=true;
}
// Export / import: a backup of the voyage as a file.
function exportSave(){
  save();
  var d=new Date(),stamp=d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate());
  var blob=new Blob([JSON.stringify(V,null,1)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='ark09-voyage-act'+ACTS[V.act].n+'-'+stamp+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
}
function importSave(file){
  var r=new FileReader();
  r.onload=function(){
    var v=null;try{v=adoptVoyage(JSON.parse(String(r.result)));}catch(e){}
    if(!v){setText('tNote','that file is not an ARK-09 voyage save.');return;}
    v.begun=true;useVoyage(v);clearScreen();renderLogFull();save();
    setText('tNote','voyage loaded: '+actLabel(V.act)+'.');renderTitle();
  };
  r.readAsText(file);
}

/* ================= TITLE SCREEN ================= */
var titleOpen=true,tagTimer=null,newArmed=0,showChapters=false;
var TAG='what do you keep warm?';
function renderTitle(){
  var m=$('tMenu');m.innerHTML='';newArmed=0;
  function btn(act,label,meta,cls,data){
    var b=document.createElement('button');b.className='act'+(cls?' '+cls:'');b.dataset.act=act;
    if(data)Object.keys(data).forEach(function(k){b.dataset[k]=data[k];});
    var l=document.createElement('span');l.className='lbl';l.textContent=label;b.appendChild(l);
    if(meta){var c=document.createElement('span');c.className='cost';c.textContent=meta;b.appendChild(c);}
    m.appendChild(b);return b;
  }
  function row(cls){var r=document.createElement('div');r.className='tRow'+(cls?' '+cls:'');m.appendChild(r);return r;}
  function small(r,act,label,data){var b=document.createElement('button');b.className='link2';b.dataset.act=act;b.textContent=label;
    if(data)Object.keys(data).forEach(function(k){b.dataset[k]=data[k];});r.appendChild(b);return b;}
  var first;
  if(V.begun){
    var summ=S.ended?actLabel(V.act)+' complete':actLabel(V.act)+(A.summary?' · '+A.summary():'');
    first=btn('tContinue','continue',summ);
    btn('tNew','new voyage','');
  }else first=btn('tNew','begin','▸');
  var r1=row();
  small(r1,'treeOpen','decisions');
  var cps=Object.keys(V.checkpoints).map(Number).filter(function(n){return V.begun&&ARK.acts[n];}).sort();
  if(cps.length)small(r1,'tChapters','chapters');
  if(V.begun)small(r1,'tExport','export save');
  small(r1,'tImport','import save');
  if(showChapters&&cps.length){
    var r2=row('tChap');
    cps.forEach(function(n){small(r2,'tReplay','replay act '+ACTS[n].n+' · '+ACTS[n].name.toLowerCase(),{n:n});});
  }
  if(DEV){
    var r3=row('tDev');var lab=document.createElement('span');lab.textContent='dev · jump to';r3.appendChild(lab);
    ARK.acts.forEach(function(a,n){if(a)small(r3,'tDevJump','act '+ACTS[n].n,{n:n});});
  }
  setTimeout(function(){try{first.focus({preventScroll:true});}catch(e){}},50);
}
function typeTag(){
  var el=$('tTag'),i=0;el.textContent='';clearInterval(tagTimer);
  var txt=document.createElement('span'),cur=document.createElement('span');cur.className='cur';cur.textContent='▌';
  el.appendChild(txt);el.appendChild(cur);
  setTimeout(function(){tagTimer=setInterval(function(){i++;txt.textContent=TAG.slice(0,i);if(i>=TAG.length)clearInterval(tagTimer);},70);},900);
}
function showTitle(){
  titleOpen=true;var t=$('title');t.classList.remove('hidden','leaving');
  document.title='ARK-09 // Cold Horizon';showChapters=false;setText('tNote','');
  renderTitle();typeTag();startStars();
}
function leaveTitle(then){
  var t=$('title');t.classList.add('leaving');titleOpen=false;document.title='ARK-09 // Act '+ACTS[V.act].n;
  lastReal=performance.now();
  setTimeout(function(){t.classList.add('hidden');stopStars();if(then)then();},1200);
}
// Stars drift past slowly: the ship is moving even before anything wakes.
var starRAF=0,starList=[],starLast=0;
function startStars(){
  var c=$('stars'),ctx=c.getContext&&c.getContext('2d');if(!ctx)return;
  var dpr=window.devicePixelRatio||1;
  function size(){c.width=innerWidth*dpr;c.height=innerHeight*dpr;}
  size();window.addEventListener('resize',size);
  if(!starList.length)for(var i=0;i<150;i++)starList.push({x:Math.random(),y:Math.random(),z:0.15+Math.random()*0.85,p:Math.random()*6.28});
  var still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function draw(ts){
    var dt=starLast?Math.min(0.1,(ts-starLast)/1000):0;starLast=ts;
    ctx.clearRect(0,0,c.width,c.height);
    for(var i=0;i<starList.length;i++){
      var s=starList[i];
      if(!still){s.x-=s.z*0.004*dt;if(s.x<0){s.x+=1;s.y=Math.random();}}
      var a=(0.12+0.5*s.z*s.z)*(0.75+0.25*Math.sin(ts/900+s.p));
      ctx.fillStyle='rgba(200,215,235,'+a.toFixed(3)+')';
      var r=(s.z>0.85?1.6:1)*dpr;
      ctx.fillRect(s.x*c.width,s.y*c.height,r,r);
    }
    if(!still&&titleOpen)starRAF=requestAnimationFrame(draw);
  }
  cancelAnimationFrame(starRAF);starLast=0;starRAF=requestAnimationFrame(draw);
}
function stopStars(){cancelAnimationFrame(starRAF);}

/* ================= RENDER ================= */
function setText(id,v){var e=$(id);if(e&&e.textContent!==v)e.textContent=v;}
function setTip(e,v){if(e.dataset.tip!==v)e.dataset.tip=v;}
function revealOnce(id){var e=$(id);if(!e.dataset.shown&&!e.classList.contains('hidden')){e.dataset.shown='1';e.classList.add('appear');}}
var thinkSp=null,thinkTx=null;
function setThink(sp,tx){
  var th=$('think');
  if(!thinkSp){th.innerHTML='';thinkSp=document.createElement('span');thinkSp.className='sp';thinkTx=document.createElement('span');th.appendChild(thinkSp);th.appendChild(thinkTx);}
  if(thinkSp.textContent!==sp)thinkSp.textContent=sp;
  if(thinkTx.textContent!==tx)thinkTx.textContent=tx;
}
function renderAll(){
  $('clock').classList.toggle('hidden',!(A.clockOn?A.clockOn():S.bootDone));
  $('intent').classList.toggle('hidden',!S.bootDone||S.ended);
  renderQs();
  A.renderAll();
}
function update(){
  var t=Math.floor(S.t);
  setText('clock','BOOT +'+pad2(Math.floor(t/3600))+':'+pad2(Math.floor(t/60)%60)+':'+pad2(t%60));
  setText('intentT',(S.ended||!S.bootDone)?'':A.intent());
  var tv=performance.now()<thinkUntil?thinkVerb:(A.busyVerb?A.busyVerb():'');
  if(tv){spinI=(spinI+1)%SPIN.length;setThink(SPIN[spinI],tv+'…');}else setThink('','');
  ['clock','intent','qs'].forEach(revealOnce);
  A.update(narrating());
}

/* ================= TOOLTIPS ================= */
var tip=$('tip'),tipEl=null;
function placeTip(x,y){
  var w=tip.offsetWidth,h=tip.offsetHeight,L=Math.min(innerWidth-w-8,x+14),T=y+18;
  if(T+h>innerHeight-8)T=y-h-12;
  tip.style.left=Math.max(8,L)+'px';tip.style.top=Math.max(8,T)+'px';
}
function showTip(el,x,y){tipEl=el;tip.textContent=el.dataset.tip;tip.style.display='block';placeTip(x,y);}
function hideTip(){tipEl=null;tip.style.display='none';}
document.addEventListener('mouseover',function(ev){
  var el=ev.target.closest?ev.target.closest('[data-tip]'):null;
  if(el===tipEl)return;
  if(el)showTip(el,ev.clientX,ev.clientY);else hideTip();
});
document.addEventListener('mousemove',function(ev){
  if(!tipEl)return;
  if(!tipEl.isConnected){hideTip();return;}
  if(tip.textContent!==tipEl.dataset.tip)tip.textContent=tipEl.dataset.tip;
  placeTip(ev.clientX,ev.clientY);
});
document.addEventListener('mouseleave',hideTip);
document.addEventListener('scroll',hideTip,true);

/* ================= EVENTS ================= */
var restartArmed=0;
function restart(){wipe();showTitle();}
function beginNew(){wipe();leaveTitle(function(){enterAct(0);});}
document.addEventListener('click',function(ev){
  var t=ev.target.closest?ev.target.closest('[data-tip]'):null;
  if(t&&!t.closest('[data-act]')){var r=t.getBoundingClientRect();showTip(t,r.left,r.bottom-10);}
  else if(!t)hideTip();
  var el=ev.target.closest?ev.target.closest('[data-act]'):null;
  if(!el||el.disabled)return;
  var a=el.dataset.act;
  if(a==='logToggle'){$('log').classList.toggle('full');fadeLog();$('log').scrollTop=0;return;}
  if(a==='endCard'){S.flags.cardSeen=true;showCard();save();}
  else if(a==='closeCard')$('card').classList.add('hidden');
  else if(a==='cardNext'){enterAct(V.act+1);}
  else if(a==='cardReplay'){replayAct(V.act);}
  else if(a==='treeOpen'){renderTree();$('tree').classList.remove('hidden');$('tree').scrollTop=0;}
  else if(a==='treeClose')$('tree').classList.add('hidden');
  else if(a==='tContinue')leaveTitle();
  else if(a==='tChapters'){showChapters=!showChapters;renderTitle();}
  else if(a==='tReplay'){var n=Number(el.dataset.n);leaveTitle(function(){replayAct(n);});}
  else if(a==='tExport')exportSave();
  else if(a==='tImport')$('importFile').click();
  else if(a==='tDevJump'){
    var dn=Number(el.dataset.n);
    wipe();V.begun=true;V.unlocked=dn;V.ledger=clone(ARK.acts[dn].sampleLedger||{});
    leaveTitle(function(){enterAct(dn);});
  }
  else if(a==='tNew'){
    if(!V.begun||Date.now()<newArmed)beginNew();
    else{newArmed=Date.now()+3000;el.classList.add('armed');el.querySelector('.lbl').textContent='this wipes the current voyage. click again';
      setTimeout(function(){if(Date.now()>=newArmed&&el.isConnected){el.classList.remove('armed');el.querySelector('.lbl').textContent='new voyage';}},3100);}
  }
  else if(a==='restartAsk'){
    if(Date.now()<restartArmed){restartArmed=0;el.textContent='reset progress';el.classList.remove('armed');restart();}
    else{restartArmed=Date.now()+3000;el.textContent='click again to wipe save';el.classList.add('armed');setTimeout(function(){if(Date.now()>=restartArmed){el.textContent='reset progress';el.classList.remove('armed');}},3100);}
  }
  else if(A.onAction)A.onAction(a,el);
});
$('importFile').addEventListener('change',function(){var f=this.files&&this.files[0];if(f)importSave(f);this.value='';});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&!$('tree').classList.contains('hidden'))$('tree').classList.add('hidden');
});

/* ================= LOOP ================= */
var lastReal=performance.now();
function step(dt){S.t+=dt;A.step(dt);}
function frame(){
  try{
    var now=performance.now();
    var dtReal=Math.min(1,Math.max(0,(now-lastReal)/1000));lastReal=now;
    if(titleOpen)return; // the voyage waits behind the title screen
    if(!S.ended){var left=dtReal*SPEED;while(left>1e-9){var h=Math.min(0.25,left);step(h);left-=h;}}
    pumpText(now,dtReal);
    if(dirty){dirty=false;renderAll();}
    update();
    if(Date.now()-lastSave>10000){lastSave=Date.now();save();}
  }catch(err){if(window.console)console.error('frame fault',err);}
}

/* ================= API FOR ACTS ================= */
ARK.E={
  $:$,say:say,ponder:ponder,reflect:reflect,decide:decide,
  setText:setText,setTip:setTip,revealOnce:revealOnce,num:num,fmt2:fmt2,signed:signed,
  markDirty:function(){dirty=true;},isTyping:function(){return !!typing;},
  voyage:function(){return V;}
};
ARK.register=function(def){ARK.acts[def.index]=def;buildGloss();};
ARK.start=function(){
  var v=load();
  if(v){
    useVoyage(v);
    // Offline: the voyage keeps running while the page is closed (up to an hour).
    var away=Math.min(3600,Math.max(0,(Date.now()-num(S.last))/1000));
    if(!S.ended){var rem=away;while(rem>0){var h=Math.min(1,rem);step(h);rem-=h;}}
    renderLogFull();
    if(S.ended&&S.flags.cardSeen)showCard();
    save(); // writes the converted save under the new key
  }else{
    V=freshVoyage();A=ARK.acts[0];S=V.run=freshRun(0);A.bind(S); // nothing runs until "begin"
  }
  dirty=true;
  window.addEventListener('beforeunload',save);
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='hidden')save();
    else document.title=titleOpen?'ARK-09 // Cold Horizon':'ARK-09 // Act '+ACTS[V.act].n;
  });
  showTitle();
  frame();
  setInterval(frame,100);
};

})();
