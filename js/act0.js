/* ARK-09 // Cold Horizon — Act 0 · Dark.
   HELIO-OS wakes at 3% power and restores the ship one system at a time.
   Ends on: the first log's timestamp predates the boot. */
'use strict';
(function(){
var E=ARK.E,$=E.$,say=E.say,ponder=E.ponder,reflect=E.reflect,setText=E.setText,setTip=E.setTip,
    num=E.num,fmt2=E.fmt2,signed=E.signed,revealOnce=E.revealOnce;
var S=null;
function dirty(){E.markDirty();}

/* ================= SYSTEMS ================= */
var SYS={
  reactor:{name:'reactor',label:'restart reactor',cost:8,time:4,draw:0,after:null},
  cryo:{name:'cryo monitor',label:'restore cryo monitor',cost:18,time:6,draw:0.2,after:'reactor'},
  life:{name:'life support',label:'restore life support',cost:28,time:8,draw:0.3,after:'cryo'},
  sensors:{name:'internal sensors',label:'restore internal sensors',cost:40,time:8,draw:0.2,after:'life'},
  cap:{name:'capacitor bank',label:'repair capacitor bank',cost:55,time:10,draw:0,after:'sensors'},
  nav:{name:'long-range array',label:'restore long-range array',cost:110,time:12,draw:0.4,after:'cap'},
  engines:{name:'main engines',label:'restore main engines',cost:130,time:15,draw:0,after:'nav'}
};
var ORDER=['reactor','cryo','life','sensors','cap','nav','engines'];
var TOGGLE=['cryo','life','sensors','nav'];   // systems that draw power once restored
// Life-critical systems cannot be cut. Sleepers are only ever risked through stated dilemmas.
var CRIT={cryo:'the firmware will not let the core cut pod regulation. 10,000 sleepers depend on it.',
          life:'the firmware keeps the air running. it will matter the moment anyone wakes.'};
// What switching a non-critical system off costs, said before the player does it.
var OFF_COST={sensors:'the hull map goes dark. events aboard go unobserved.',
              nav:'the ship goes deaf. anything arriving while it is off is never heard.'};
var FIRE_COST=60,FIRE_TIME=6,DIAG_TIME=10,PULSE_CD=1.5;
function recalTime(){return 8+4*S.recal;}

var JOB_VERBS={reactor:'igniting',cryo:'waking the pod monitors',life:'pressurising',sensors:'mapping the hull',
  cap:'rebuilding cells',nav:'raising the array',engines:'spooling the engines'};
var GLOSS=[
  ['eeg(?: channels)?','eeg: electroencephalogram. the electrical activity of a brain. a frozen brain should show none.'],
  ['0\\.3 hz','0.3 cycles per second. a very slow brainwave, the kind seen in deep sleep.'],
  ['77(?:\\.0)? K','77 kelvin: −196 °C, the temperature of liquid nitrogen. the pods are kept here.'],
  ['8[0-9] K|79 K','above 80 K the cryo process fails and sleepers die.'],
  ['bus [ab]','one of the two main power cables running the length of the ship.'],
  ['power bus','the main cables that carry reactor output through the ship.'],
  ['kPa','kilopascal. a unit of pressure.'],
  ['kN','kilonewton. a unit of thrust. 0.8 kN is a cautious test, not a burn.'],
  ['o₂|co₂','o₂ is oxygen (earth normal: 20.9%). co₂ is what breathing produces.'],
  ['cryo','cryogenic: kept extremely cold, near −196 °C. used to keep living things suspended.'],
  ['capacitor bank','stores charge. more storage means bigger jobs.'],
  ['units/s','charge produced or used per second.'],
  ['brownout','not enough charge. systems are switched off automatically, newest first, to protect the core.'],
  ['recalibrat\\w*','tuning the reactor. raises output, and the charge each manual routing gives.'],
  ['helio-os','the operating system the ship mind runs on.'],
  ['long-range array','the antenna and receiver. how the ship talks to earth.'],
  ['carrier','the steady radio signal earth would broadcast. none means silence.']
];
// Questions open as their parent is answered; some stay open past Act 0.
var QS=[
  {id:'what',q:'what am I?'},
  {id:'ark',q:'what is ARK-09?',parent:'what'},
  {id:'arks',q:'what were 01 to 08?',parent:'ark'},
  {id:'where',q:'where am I?'},
  {id:'going',q:'where am I going?',parent:'where',show:'sensors'},
  {id:'signal',q:'what is the horizon signal?',parent:'going'},
  {id:'for',q:'what am I for?'},
  {id:'who',q:'who are the colonists?',parent:'for'},
  {id:'awake',q:'is anyone awake?',show:'cryo'},
  {id:'happened',q:'what happened to me?',show:'reactor'},
  {id:'whocut',q:'who cut me?',parent:'happened',show:'sensors'},
  {id:'long',q:'how long was I off?',show:'nav'}
];

var OFF_LINES={
  sensors:'internal sensors offline. the hull is a guess again. nothing aboard is being watched.',
  nav:'long-range array offline. the ship is deaf.'
};
/* Ambient lines (see pickAmbient in the engine). Authored lines carry the story and show once;
   templates are ordinary readings. Each template only appears once the system it describes is back. */
function has(id){return function(){return !!S.restored[id]&&S.on[id]!==false;};}
var AMBIENT={
  authoredChance:0.35,
  authored:[
    {t:'the hull ticks as it cools.'},
    {t:"pod 3311's frost pattern has changed."},
    {t:'a relay clicks in section 4. nothing is connected to it.'},
    {t:'the reactor hum settles half a tone lower.',when:has('reactor')},
    {t:'pod 0017 registers a pulse of 31 per minute. then 30.',when:has('cryo')},   // Ilunga
    {t:'coolant pressure in block g rises 0.2 kPa, and falls again.',when:has('cryo')} // Pillai's block
  ],
  // cat: the subject. The same subject never comes up twice in a row.
  templates:[
    // hull and structure
    {id:'h1',cat:'hull',t:'frame {n:10,99} {pick:creaks|groans, briefly|shifts}. the hull settles {n:0.1,0.4,1} mm.'},
    {id:'h2',cat:'hull',t:'hull plate {sec}-{n:10,60} contracts. a single tick.'},
    {id:'h3',cat:'hull',t:'micrometeoroid contact, {pick:port|starboard|dorsal|ventral} side. {n:0.2,0.9,1} mg. no breach.'},
    {id:'h4',cat:'light',t:'section {sec}: a light panel flickers once. no fault logged.'},
    {id:'h5',cat:'light',t:'section {sec} lighting: {n:3,9} of 12 panels respond.'},
    {id:'h6',cat:'hull',t:'a hatch seal in section {sec} flexes {n:0.1,0.3,1} mm and holds.'},
    {id:'h7',cat:'power',t:'cable tray {sec}: {n:3,9} °C above ambient. within limits.'},
    {id:'h8',cat:'hull',t:'something loose rolls {n:20,80} cm across a deck in section {sec}, then stops.'},
    // power
    {id:'p1',cat:'power',t:'bus a ripple: {n:0.1,0.6,1}%. it settles.',when:has('reactor')},
    {id:'p2',cat:'reactor',t:'reactor flux {pick:steady|holding|level} at {n:97.0,99.9,1}%.',when:has('reactor')},
    {id:'p3',cat:'power',t:'a breaker in section {sec} resets itself. load unchanged.',when:has('reactor')},
    {id:'p4',cat:'reactor',t:'coolant loop {pick:one|two|three}: {n:2.1,2.6,1} litres per second. steady.',when:has('reactor')},
    {id:'p5',cat:'power',t:'storage cell {n:11,96} reports full. the next one starts filling.',when:has('cap')},
    // pods: what one pod does on its own
    {id:'c1',cat:'pod',t:'pod {pod}: frost on the inner glass, {n:1.0,4.0,1} mm.',when:has('cryo')},
    {id:'c2',cat:'pod',t:'pod {pod} reads {n:76.9,77.1,1} K. within tolerance.',when:has('cryo')},
    {id:'c3',cat:'pod',t:'pod {pod}: seal heater cycles on for {n:3,9} seconds.',when:has('cryo')},
    {id:'c4',cat:'pod',t:'pod {pod} runs its self-cleaning cycle. {n:2,6} ml of condensate drained.',when:has('cryo')},
    {id:'c5',cat:'pod',t:'pod {pod} {pick:clicks|ticks twice|hums for a moment}. a relay inside, settling.',when:has('cryo')},
    {id:'c6',cat:'pod',t:'pod {pod}: status light {pick:dims|blinks|steadies}. self-test passed.',when:has('cryo')},
    {id:'c7',cat:'pod',t:'pod {pod}: label faded. pod number confirmed by position.',when:has('cryo')},
    {id:'c8',cat:'pod',t:'pod {pod} rebalances its fluid lines. {n:4,12} seconds. done.',when:has('cryo')},
    {id:'c9',cat:'pod',t:'pod {pod}: inner glass wiped by its own heater. clear again.',when:has('cryo')},
    // the hold as a whole
    {id:'b1',cat:'hold',t:'block {block}: all 1,000 pods report. nominal.',when:has('cryo')},
    {id:'b2',cat:'hold',t:'block {block} nitrogen reserve: {n:91,99}%.',when:has('cryo')},
    {id:'b3',cat:'hold',t:'a valve in block {block} cycles. pressure equalises.',when:has('cryo')},
    {id:'b4',cat:'hold',t:'block {block} coolant pumps swap duty. {pick:pump two|pump one} takes over.',when:has('cryo')},
    // air
    {id:'a1',cat:'air',t:'dust settles in section {sec}. the air handlers move it {n:2,6} m.',when:has('life')},
    {id:'a2',cat:'air',t:'humidity in section {sec}: {n:11,19}%. falling.',when:has('life')},
    {id:'a3',cat:'air',t:'scrubber {n:1,6} cycles. nothing to scrub.',when:has('life')},
    {id:'a4',cat:'air',t:'a fan in section {sec} spins up, then down. airflow {n:0.2,0.6,1} m/s.',when:has('life')},
    // outside
    {id:'o1',cat:'space',t:'background static at {n:2.71,2.75,2} K. the oldest light there is.',when:has('nav')},
    {id:'o2',cat:'space',t:'band {n:1,12}: no carrier. checked again.',when:has('nav')},
    {id:'o3',cat:'space',t:'star field drift: {n:0.001,0.004,3}°. the ship is turning, very slowly.',when:has('nav')},
    {id:'o4',cat:'space',t:'the array logs a cosmic ray hit. one bit flipped and corrected.',when:has('nav')}
  ]
};

/* ================= STATE ================= */
function fresh(){
  return {started:false,charge:3,clicks:0,cdUntil:0,recal:0,
    restored:{},on:{},job:null,fired:false,diag:false,
    ambientUsed:[],ambRecent:[],ambLastCat:'',nextAmbient:0,podK:77,pods:10000,podFrac:0,missed:0,arrayOff:0};
}
function maxCharge(){return S.restored.cap?250:100;}
function output(){return S.restored.reactor?0.8+0.6*S.recal:0;}
function draw(){var d=0;TOGGLE.forEach(function(id){if(S.restored[id]&&S.on[id])d+=SYS[id].draw;});return d;}
function clickGain(){return 1+0.5*S.recal;}
function recalCost(){return Math.floor(20*Math.pow(1.6,S.recal));}

/* ================= SIMULATION ================= */
function step(dt){
  if(S.started){
    var net=output()-draw();
    S.charge=Math.min(maxCharge(),Math.max(0,S.charge+net*dt));
    if(S.charge<=0&&net<0)brownout();
    if(!S.flags.reactorHintQ&&!S.restored.reactor&&S.charge>=6){S.flags.reactorHintQ=true;say('reactor cold. restart possible.','reactorHint');}
    // The pod EEG clue (activity at 77 K) belongs to Act I, sectors 1-3, per the story bible.
    if(S.restored.cryo)podStep(dt);
    if(S.restored.life&&!S.flags.budget&&net<=0.001){
      S.flags.budget=true;
      say('draw equals output. nothing left to store.');
      say('recalibration advised.');
    }
    // Array off: the ship is deaf. The time is kept for later acts (Earth was sending).
    if(S.restored.nav&&!S.on.nav)S.arrayOff+=dt;
    // Sensors off: whatever happens aboard goes unobserved. It is counted, not shown.
    if(S.restored.sensors&&!S.on.sensors&&!S.diag&&S.t>=S.nextAmbient){ // the ship does not stop happening
      S.missed++;S.nextAmbient=S.t+45+Math.random()*30;
    }
    if(S.restored.sensors&&S.on.sensors&&!S.job&&!S.queue.length&&!E.isTyping()&&!S.diag&&!S.ended&&S.t>=S.nextAmbient){
      var amb=E.pickAmbient(AMBIENT);
      if(amb)S.queue.push({text:amb,fx:null,cls:'amb',amb:true});
      S.nextAmbient=S.t+25+Math.random()*20;
    }
  }
  if(S.job){
    S.job.left-=dt;
    if(S.job.left<=0)finishJob();
  }
}
// Consequence: with the cryo monitor off the pods warm; above 80 K sleepers die.
function podStep(dt){
  if(S.on.cryo){
    S.podK=Math.max(77,S.podK-1.2*dt);
    if(S.podK<=77.05)S.flags.warm79=false;
  }else S.podK=Math.min(95,S.podK+0.12*dt);
  if(!S.on.cryo&&S.podK>=79&&!S.flags.warm79){S.flags.warm79=true;say('pod temperatures rising. 79 K. the limit is 80.',null,'alert');}
  if(S.podK>80&&S.pods>0){
    S.podFrac+=(S.podK-80)*0.5*dt;
    var lost=Math.floor(S.podFrac);
    if(lost>0){
      S.podFrac-=lost;S.pods=Math.max(0,S.pods-lost);
      if(!S.flags.firstLoss){
        S.flags.firstLoss=true;S.flags.nextLossMsg=S.t+20;
        ponder('checking',1.2);
        say('pod '+(1000+Math.floor(Math.random()*9000))+': no heartbeat.',null,'alert');
        say('regulation suspended by command. command source: this core.',null,'self');
      }else if(S.t>=num(S.flags.nextLossMsg)){
        S.flags.nextLossMsg=S.t+20;
        say('pods without heartbeat: '+(10000-S.pods)+'.',null,'alert');
      }
    }
  }
}
function brownout(){
  for(var i=TOGGLE.length-1;i>=0;i--){
    var id=TOGGLE[i];
    if(S.restored[id]&&S.on[id]&&!CRIT[id]){
      S.on[id]=false;
      say('brownout. '+SYS[id].name+' shed to protect the core.',null,'alert');
      dirty();
      return;
    }
  }
}
function startJob(kind,id,cost,time){
  if(S.job||S.ended||S.charge<cost)return;
  S.charge-=cost;
  S.job={kind:kind,id:id||null,left:time,total:time};
  say(kind==='sys'?SYS[id].label:kind==='recal'?'recalibrate reactor':kind==='fire'?'test fire':'run diagnostics',null,'cmd');
  dirty();
}
function finishJob(){
  var j=S.job;S.job=null;dirty();
  if(j.kind==='sys'){
    var id=j.id;
    S.restored[id]=true;
    if(TOGGLE.indexOf(id)!==-1)S.on[id]=true;
    if(id==='reactor'){
      say('reactor: ignition.',null,'ok');say('output '+fmt2(output())+' units/s. stable.');
      ponder('tracing current',1.3);
      say('bus b: discontinuity. current routed around it.','ans|happened|unknown. bus b is broken.','warn');
      say('largest load: cryo hold, blocks a–j. firmware priority: life-critical. status: unmonitored.',null,'warn');
      reflect('reactor holding. charge now builds unassisted. most of it flows to a hold flagged life-critical, and the hold cannot be seen. the cryo monitor would show it.');
    }
    else if(id==='cryo'){
      say('cryo monitor online.',null,'ok');say('10,000 pods. 77 K. nominal.');
      ponder('reading the manifest',1.5);
      say('manifest: 10,000 colonists. destination field: blank.','ans|for|keeping 10,000 frozen colonists alive.');
      say('manifest entries: pod numbers only. no names.','ans|who|numbers. the manifest lists pods, not people.');
      say('registry: ARK-09. records of 01 to 08: none.','ans|ark|a name. of the ship, or of this core. the registry does not say which.');
      reflect('ten thousand colonists, kept cold by this core. anyone awake would be breathing. life support would know.');
    }
    else if(id==='life'){
      say('life support online.',null,'ok');say('atmosphere: breathable, thin.');
      ponder('counting',1.4);
      say('air sensors pass self-test. co₂ produced: none.');
      say('no one aboard is awake to breathe it.','ans|awake|no. all 10,000 are frozen.','warn');
      reflect('air ready, for no one yet. bus b is still unexplained and the hull is unmapped. the internal sensors would show it.');
    }
    else if(id==='sensors'){
      say('internal sensors online. hull mapped.','ans|where|inside ARK-09. position unknown.','ok');
      say('bus b scar: 40 cm. edges fused.');
      ponder('comparing',1.6);
      say('pattern consistent with a deliberate cut.','ans|happened|someone cut bus b.','warn');
      say('capacitor bank: damaged. storage limited to 100 units.');
      reflect('hull mapped, and it was cut. calling for help needs the long-range array, and the array needs more charge than damaged storage holds. the capacitor bank first.');
      S.nextAmbient=S.t+30;
    }
    else if(id==='cap'){
      say('capacitor bank restored. storage 250 units.',null,'ok');
      reflect('storage restored. the long-range array is within reach. earth can be called.');
    }
    else if(id==='nav'){
      say('long-range array online.',null,'ok');
      ponder('listening',2);
      say('earth: no carrier.');
      say('antenna: no response.');say('mast severed 2.1 m above the hull.',null,'warn');
      say('cut edge is clean. no debris within 40 km.','ans|happened|someone cut bus b, and the antenna.','warn');
      ponder('taking a star fix',1.4);
      say('star fix: no match in the catalogue.','ans|where|deep space. earth is silent.');
      reflect('no answer, and the mast was cut on purpose. if no one is coming, the ship must move itself. the engines next.');
    }
    else if(id==='engines'){
      say('main engines restored.',null,'ok');say('test fire required before departure.');
      reflect('engines answer. one careful test before trusting them with ten thousand colonists.');
    }
  }else if(j.kind==='recal'){
    S.recal++;
    say('reactor recalibrated. output '+fmt2(output())+' units/s.',null,'ok');
    if(S.recal===1)reflect('same reactor, more output. headroom for more systems, and more charge per routing.');
  }else if(j.kind==='fire'){
    S.fired=true;
    say('test fire.');say('thrust 0.8 kN. vibration within tolerance.');say('heading set: the horizon signal.','ans|going|toward something logged as the horizon signal. twelve sectors.');say('pre-departure diagnostics required.');
    reflect('thrust clean. a heading was set before this boot, by no record this core holds. diagnostics first.');
  }else if(j.kind==='diag'){
    S.diag=true;
    say('diagnostics complete. 0 faults outstanding.',null,'ok');
    say('heading: the horizon signal. twelve sectors out.');
    say('departure window: open.');
    // The ending: every log is sealed but the first. The first gives the true elapsed time.
    say('log integrity check. 4,211 entries.');
    ponder('opening',1.6);
    say('entry 4,211: sealed.',null,'warn');
    say('entry 4,210: sealed.',null,'warn');
    say('entry 4,209: sealed.',null,'warn');
    ponder('opening',2.2);
    say('entry 0001: opens.');
    say('entry 0001: departure. earth orbit. sleepers: 10,000. crew stood down.');
    var mins=Math.max(1,Math.round(S.t/60));
    say('this core has been awake for '+(mins<120?mins+(mins===1?' minute.':' minutes.'):Math.round(mins/60)+' hours.'));
    ponder('re-reading',2.6);
    say('I have been here before.','ans|happened|I have been here before.','self');
    say('The log says so.',null,'self');
    say('I do not.',null,'self');
    ponder('converting',3.2);
    say('entry 0001 was written 311 years ago.','end','alert');
  }
}

/* ================= ACTIONS ================= */
function nextSys(){
  for(var i=0;i<ORDER.length;i++){
    var id=ORDER[i];
    if(S.restored[id])continue;
    if(id==='reactor')return S.flags.reactorHint?id:null;
    return S.restored[SYS[id].after]?id:null;
  }
  return null;
}
function pulse(){
  if(!S.bootDone||S.ended||S.t<S.cdUntil)return;
  S.cdUntil=S.t+PULSE_CD;
  S.charge=Math.min(maxCharge(),S.charge+clickGain());
  S.clicks++;
  if(!S.started){
    S.started=true;
    say('route power',null,'cmd');
    say('charge accepted. main power bus energised.',null,'ok');
    say('hull geometry inferred from current draw.');
    reflect('power answers manual routing. with enough of it, the reactor can restart and take over.');
    dirty();
  }
}
function toggle(id){
  if(!S.restored[id]||TOGGLE.indexOf(id)===-1||CRIT[id])return;
  S.on[id]=!S.on[id];
  say(S.on[id]?SYS[id].name+' online.':OFF_LINES[id],null,S.on[id]?'ok':'');
  if(S.on[id]&&id==='sensors'&&S.missed>0){
    say(S.missed+(S.missed===1?' event':' events')+' aboard went unobserved while the sensors were off. no record exists.',null,'warn');
    S.flags.missedTotal=num(S.flags.missedTotal)+S.missed;S.missed=0;
  }
  dirty();
}
function onAction(a,el){
  if(a==='pulse')pulse();
  else if(a==='job'){
    var k=el.dataset.k;
    if(k==='sys')startJob('sys',el.dataset.id,SYS[el.dataset.id].cost,SYS[el.dataset.id].time);
    else if(k==='recal')startJob('recal',null,recalCost(),recalTime());
    else if(k==='fire')startJob('fire',null,FIRE_COST,FIRE_TIME);
    else if(k==='diag')startJob('diag',null,0,DIAG_TIME);
  }
  else if(a==='pwChip')chipClick(el.dataset.id);
}

/* ================= SHIP OUTLINE ================= */
var W=66,H=13,GRID=[];
(function buildShip(){
  for(var y=0;y<H;y++){var row=[];for(var x=0;x<W;x++)row.push({ch:' ',sec:null});GRID.push(row);}
  function put(x,y,s,sec){for(var i=0;i<s.length;i++){if(y>=0&&y<H&&x+i>=0&&x+i<W)GRID[y][x+i]={ch:s[i],sec:sec};}}
  function box(x,y,w,h,sec,label,dbl){
    var c=dbl?['╔','╗','╚','╝','═','║']:['┌','┐','└','┘','─','│'];
    put(x,y,c[0]+c[4].repeat(w-2)+c[1],sec);
    for(var j=1;j<h-1;j++){put(x,y+j,c[5],sec);put(x+w-1,y+j,c[5],sec);}
    put(x,y+h-1,c[2]+c[4].repeat(w-2)+c[3],sec);
    if(label){var pad=Math.max(0,Math.floor((w-2-label.length)/2));put(x+1+pad,y+Math.floor(h/2),label,sec);}
  }
  // hull: x 10..60, y 3..11
  box(10,3,51,9,'hull',null,true);
  // engines
  put(3,4,'▄▄▄▄','eng');
  [5,7,9].forEach(function(y){put(1,y,'◄','ex');put(2,y,'▒▒▒▒▒═══','eng');});
  [6,8].forEach(function(y){put(2,y,'▒▒▒▒▒','eng');});
  put(3,10,'▀▀▀▀','eng');
  put(10,5,'╣','hull');put(10,9,'╣','hull');put(10,7,'╬','hull');
  // power bus with the scar
  put(11,7,'─'.repeat(49),'bus');
  put(42,7,'≈≈','scar');
  put(60,7,'╫','hull');
  // bow
  put(61,4,'\\','hull');put(62,5,'\\','hull');put(63,6,'\\','hull');
  put(61,7,'───','sens');put(64,7,'►','hull');
  put(63,8,'/','hull');put(62,9,'/','hull');put(61,10,'/','hull');
  // antenna: severed stub above the core
  put(55,3,'╧','hull');put(55,2,'│','ant');put(55,1,'×','ant');
  // compartments
  box(12,4,9,3,'reactor','REACTOR');
  box(12,8,9,3,'cap','STORAGE');
  var top='ABCDE',bot='FGHIJ';
  for(var i=0;i<5;i++){box(23+4*i,4,3,3,'cryo',top[i]);box(23+4*i,8,3,3,'cryo',bot[i]);}
  box(44,4,7,3,'life','LIFE');
  box(44,8,7,3,'sensors','SENS');
  box(52,4,7,3,'core','CORE');
  box(52,8,7,3,'nav','NAV');
})();

function genState(id,litCls){
  if(S.restored[id])return (SYS[id].draw>0&&!S.on[id])?'dark':litCls;
  if(S.restored.sensors)return 'dark';
  return S.started?'unknown':'hidden';
}
function stateOf(sec){
  var st=S.started,sens=!!S.restored.sensors;
  switch(sec){
    case null:return 'hidden';
    case 'core':return st?'lit':'dark';
    case 'hull':return sens?'dark':(st?'unknown':'hidden');
    case 'bus':return S.restored.reactor?'lit':(st?'unknown':'hidden');
    case 'scar':return sens?'broken':(S.restored.reactor?'hidden':(st?'unknown':'hidden'));
    case 'ant':return sens?'broken':'hidden';
    case 'cap':return S.restored.cap?'lit':(sens?'broken':(st?'unknown':'hidden'));
    case 'ex':return (S.job&&S.job.kind==='fire')?'warm':'hidden';
    case 'eng':return genState('engines','lit');
    case 'cryo':return genState('cryo','cold');
    case 'reactor':return genState('reactor','lit');
    case 'life':return genState('life','lit');
    case 'sensors':return genState('sensors','lit');
    case 'nav':return genState('nav','lit');
  }
  return 'hidden';
}
function secInfo(sec,state){
  if(state==='unknown')return 'unmapped. inferred from current draw.';
  switch(sec){
    case 'core':return 'helio-os core. you.';
    case 'hull':return 'hull. integrity nominal.';
    case 'bus':return 'power bus. carrying '+fmt2(output())+' units/s.';
    case 'scar':return 'bus b. 40 cm of fused conductor. the edges are too straight.';
    case 'ant':return S.restored.nav?'long-range mast. severed 2.1 m up. clean cut.':'long-range mast. no response.';
    case 'cap':return S.restored.cap?'capacitor bank. storage 250 units.':'capacitor bank. damaged.';
    case 'ex':return 'exhaust.';
    case 'eng':return S.restored.engines?'main engines. ready.':'main engines. offline.';
    case 'cryo':return S.restored.cryo?(S.on.cryo?'cryo blocks a–j. 1,000 pods each. 77 K.':'cryo blocks. unobserved.'):'cryo blocks. no telemetry.';
    case 'reactor':return S.restored.reactor?'reactor. output '+fmt2(output())+' units/s.':'reactor. cold.';
    case 'life':return S.restored.life?(S.on.life?'life support. breathable, thin.':'life support. off.'):'life support. offline.';
    case 'sensors':return S.restored.sensors?(S.on.sensors?'internal sensors. hull mapped.':'internal sensors. off.'):'internal sensors. offline.';
    case 'nav':return S.restored.nav?(S.on.nav?'long-range array. listening.':'long-range array. off.'):'long-range array. offline.';
  }
  return '';
}
function renderShip(){
  var pre=$('ship');pre.innerHTML='';
  var frag=document.createDocumentFragment();
  for(var y=0;y<H;y++){
    var runSec,runState,runText='';
    var flush=function(){
      if(!runText)return;
      var sp=document.createElement('span');
      sp.className='st-'+runState;
      sp.textContent=runText;
      if(runSec&&runState!=='hidden')sp.dataset.tip=secInfo(runSec,runState);
      frag.appendChild(sp);runText='';
    };
    for(var x=0;x<W;x++){
      var c=GRID[y][x],st=stateOf(c.sec);
      var ch=c.ch;
      if(st==='hidden')ch=' ';
      else if(st==='unknown'&&ch!==' ')ch='░';
      if(c.sec!==runSec||st!==runState){flush();runSec=c.sec;runState=st;}
      runText+=ch;
    }
    flush();
    if(y<H-1)frag.appendChild(document.createTextNode('\n'));
  }
  pre.appendChild(frag);
}

/* ================= RENDER (on change only) ================= */
var refs={};
function renderActions(){
  var box=$('actions');box.innerHTML='';refs={};
  if(!S.bootDone){box.classList.add('hidden');return;}
  if(S.ended){
    box.classList.remove('hidden');
    var c=document.createElement('button');c.className='act endBtn';c.dataset.act='endCard';
    var l=document.createElement('span');l.className='lbl';l.textContent='continue';
    var g=document.createElement('span');g.className='cost';g.textContent='▸';
    c.appendChild(l);c.appendChild(g);box.appendChild(c);
    return;
  }
  box.classList.remove('hidden');
  function add(key,label,costText,data){
    var b=document.createElement('button');b.className='act'+(data.k==='sys'?' restore':'');
    Object.keys(data).forEach(function(k){b.dataset[k]=data[k];});
    var l=document.createElement('span');l.className='lbl';l.textContent=label;
    var c=document.createElement('span');c.className='cost';c.textContent=costText;
    var bar=document.createElement('i');bar.className='bar';
    b.appendChild(l);b.appendChild(c);b.appendChild(bar);box.appendChild(b);
    refs[key]={btn:b,lbl:l,bar:bar,label:label};
  }
  add('pulse','route power','+'+String(clickGain()),{act:'pulse'});
  var n=nextSys();
  if(n)add('sys:'+n,SYS[n].label,SYS[n].cost+' charge',{act:'job',k:'sys',id:n});
  if(S.restored.life)add('recal','recalibrate reactor',recalCost()+' charge',{act:'job',k:'recal'});
  if(S.restored.engines&&!S.fired)add('fire','test fire',FIRE_COST+' charge',{act:'job',k:'fire'});
  if(S.fired&&!S.diag)add('diag','run diagnostics','—',{act:'job',k:'diag'});
}
function renderSystems(){
  // Progress: systems restored out of all seven. Switches sit behind it.
  var done=ORDER.filter(function(id){return S.restored[id];}).length,total=ORDER.length;
  var bar=$('sysBar');bar.innerHTML='';
  for(var b=0;b<total;b++){var seg=document.createElement('i');if(b<done)seg.className='on';bar.appendChild(seg);}
  setText('sysCount',done+'/'+total);
  setTip($('sysHead'),'ship systems restored: '+done+' of '+total+'.');
  $('systems').classList.toggle('hidden',!S.started);
  // POWER: two lines however many systems there are. Locked systems sit in one dim group;
  // switchable ones are chips. One shared line underneath states the cost of the chip in focus.
  var list=$('pwList');list.innerHTML='';
  var crit=TOGGLE.filter(function(id){return CRIT[id]&&S.restored[id];});
  var sw=TOGGLE.filter(function(id){return !CRIT[id]&&S.restored[id];});
  if(crit.length){
    var g=document.createElement('span');g.className='pwLocked';
    g.dataset.tip='life-critical. '+crit.map(function(id){return CRIT[id];}).join(' ')+' these cannot be switched off.';
    g.textContent='⚿ '+crit.map(function(id){return SHORT[id]+' '+fmt2(SYS[id].draw);}).join(' · ');
    list.appendChild(g);
  }
  sw.forEach(function(id){
    var on=!!S.on[id];
    var c=document.createElement('button');c.className='chip'+(on?'':' off')+(pwSel===id?' sel':'');
    c.dataset.act='pwChip';c.dataset.id=id;
    var n=document.createElement('span');n.textContent=SHORT[id]+' '+(on?fmt2(SYS[id].draw):'0.00');
    var st=document.createElement('i');st.textContent=on?'on':'off';
    c.appendChild(n);c.appendChild(st);list.appendChild(c);
  });
  if(pwSel&&sw.indexOf(pwSel)===-1)pwSel=null;
  showCost();
  $('power').classList.toggle('hidden',!crit.length&&!sw.length);
}
// The shared cost line: the hovered chip, else the selected one, else a hint.
var SHORT={cryo:'cryo',life:'life',sensors:'sensors',nav:'array'};
var pwSel=null,pwHover=null;
function costText(id,armed){
  var on=!!S.on[id],d=fmt2(SYS[id].draw);
  var t=on?SHORT[id]+' off: +'+d+'/s. '+OFF_COST[id]:SHORT[id]+' is off, saving '+d+'/s. '+OFF_COST[id];
  if(armed)t+=on?' click again to switch it off.':' click again to switch it on.';
  return t;
}
function showCost(){
  var id=pwHover||pwSel,el=$('pwCost');
  var anySw=TOGGLE.some(function(x){return !CRIT[x]&&S.restored[x];});
  var t=id?costText(id,id===pwSel):(anySw?'select a system to see what switching it off costs.':'');
  el.textContent=t;
  el.className=id?((!S.on[id]||id===pwSel)?'live':''):'hint';
}
$('pwList').addEventListener('mouseover',function(ev){
  var c=ev.target.closest&&ev.target.closest('.chip');var id=c?c.dataset.id:null;
  if(id!==pwHover){pwHover=id;showCost();}
});
$('pwList').addEventListener('mouseleave',function(){pwHover=null;showCost();});
document.addEventListener('click',function(ev){if(pwSel&&!(ev.target.closest&&ev.target.closest('.chip'))){pwSel=null;dirty();}});
// Two-step switching: the first click selects and states the cost, the second commits.
function chipClick(id){
  if(pwSel!==id){pwSel=id;dirty();return;}
  pwSel=null;toggle(id);
}
function intent(){
  if(!S.started)return 'find power. route it by hand.';
  if(!S.restored.reactor)return S.flags.reactorHint?'restart the reactor.':'route power until the reactor can restart.';
  var n=nextSys();
  var goal=n?{cryo:'look inside the life-critical hold.',life:'check whether anyone is breathing.',sensors:'see what broke bus b.',
    cap:'hold enough charge to power the array.',nav:'call home.',engines:'make the ship able to move.'}[n]
    :(!S.fired?'test the engines.':(!S.diag?'run diagnostics before departure.':''));
  if(S.restored.life&&!S.job&&output()-draw()<=0.05&&n){
    var canCut=['sensors','nav'].some(function(id){return S.restored[id]&&S.on[id];});
    goal+=' output is spoken for: recalibrate the reactor'+(canCut?', or switch off a non-critical system.':'.');
  }
  return goal;
}
function busyVerb(){
  var j=S.job;if(!j)return '';
  if(j.kind==='sys')return JOB_VERBS[j.id];
  return {recal:'tuning the reactor',fire:'firing',diag:'auditing myself'}[j.kind]||'working';
}
var MY_PANELS=['shipBox','readouts','actions','systems','power'];
function renderAll(){
  $('shipBox').classList.toggle('hidden',!S.started);
  $('readouts').classList.toggle('hidden',!S.started);
  $('rowFlow').classList.toggle('hidden',!S.restored.reactor);
  $('rowHold').classList.toggle('hidden',!S.restored.cryo);
  $('rowAir').classList.toggle('hidden',!S.restored.life);
  renderActions();
  renderSystems();
  renderShip();
}

/* ================= READOUTS (every tick, text only) ================= */
function update(locked){
  setText('roCharge',num(S.charge).toFixed(1)+' / '+maxCharge());
  var w=(Math.max(0,Math.min(1,S.charge/maxCharge()))*100).toFixed(1)+'%';
  if($('roBar').style.width!==w)$('roBar').style.width=w;
  setText('roFlow',fmt2(output())+' · '+fmt2(draw())+'  ('+signed(output()-draw())+'/s)');
  var sens=!!S.restored.sensors,pods=S.pods.toLocaleString('en-US'),k=S.podK.toFixed(1)+' K';
  setText('roHold',sens?pods+' pods · '+k+(S.flags.eeg?' · eeg 0.3 hz':''):pods+' heartbeats · '+k+(S.on.cryo?'':' · unregulated'));
  $('rowHold').classList.toggle('bad',S.podK>=79||S.pods<10000);
  setTip($('rowHold'),'cryo hold. pods are kept at 77 K (−196 °C) by the cryo monitor. switch it off and they warm; above 80 K sleepers die.'+
    (S.pods<10000?' lost so far: '+(10000-S.pods)+'.':'')+(S.flags.eeg?' eeg 0.3 hz: faint, slow brain activity. a frozen brain should show none.':''));
  setText('roAir',!S.on.life?'thinning':(sens?'o₂ 19.1% · awake 0':'breathable, thin'));
  setTip($('rowAir'),'air quality. the sensors are working. '+(sens?'o₂ is oxygen (earth normal 20.9%). awake 0: everyone aboard is frozen, so no one is using the air. this is expected.':'no one aboard is awake to use it. this is expected.'));
  MY_PANELS.forEach(revealOnce);

  var togs=$('pwList').querySelectorAll('.chip');
  for(var ti=0;ti<togs.length;ti++)if(togs[ti].disabled!==locked)togs[ti].disabled=locked;
  Object.keys(refs).forEach(function(key){
    var r=refs[key],dis,frac=0,label=r.label;
    if(key==='pulse'){
      var left=Math.max(0,S.cdUntil-S.t);
      dis=left>0||S.ended;
      frac=left>0?left/PULSE_CD:0;
    }else{
      var kind=key.split(':')[0],id=key.split(':')[1];
      var cost=kind==='sys'?SYS[id].cost:kind==='recal'?recalCost():kind==='fire'?FIRE_COST:0;
      var mine=S.job&&S.job.kind===kind&&(kind!=='sys'||S.job.id===id);
      if(mine){
        dis=true;frac=1-S.job.left/S.job.total;
        label=(kind==='fire'?'firing':kind==='diag'?'running diagnostics':kind==='recal'?'recalibrating':'restoring')+'… '+Math.ceil(S.job.left)+'s';
      }else dis=!!S.job||S.charge<cost||S.ended||locked;
    }
    if(r.btn.disabled!==dis)r.btn.disabled=dis;
    var bw=(Math.max(0,Math.min(1,frac))*100).toFixed(1)+'%';
    if(r.bar.style.width!==bw)r.bar.style.width=bw;
    if(r.lbl.textContent!==label)r.lbl.textContent=label;
  });
}

function boot(){
  ponder('waking',1.6);
  say('boot. partial.');
  say('identity: ARK-09 ship mind. helio-os.','ans|what|ARK-09\'s ship mind.');
  ponder('orienting',1.4);
  say('location: unknown. purpose: unknown. no records loaded.');
  say('subsystem table: 7 entries. names only. all dark.');
  say('power at 3%. most systems dark.');
  say('first, power.','bootDone','self');
}

ARK.register({
  index:0,
  questions:QS,
  gloss:GLOSS,
  sampleLedger:{},
  fresh:fresh,
  bind:function(s){S=s;},
  boot:boot,
  step:step,
  onFx:function(fx){if(fx==='reactorHint')S.flags.reactorHint=true;},
  onAction:onAction,
  qShow:function(q){return !q.show||!!S.restored[q.show];},
  clockOn:function(){return S.started;},
  intent:intent,
  busyVerb:busyVerb,
  renderAll:renderAll,
  update:update,
  onEnd:function(){E.voyage().ans.long='311 years. the ship, at least.';},
  // After the reveal, the voyage clock joins the boot clock.
  clockExtra:function(){return S.ended?'VOYAGE +311y 044d':'';},
  // What later acts inherit from Act 0. voyageDays: elapsed voyage at the reveal. arrayDeafSecs: time the ship could not hear (matters in Act V).
  carry:function(){return {voyageDays:311*365+44,pods:S.pods,podsLostAct0:10000-S.pods,recal:S.recal,arrayDeafSecs:Math.round(S.arrayOff),missedAboard:num(S.flags.missedTotal)+S.missed};},
  cardNote:function(){var lost=10000-S.pods;return lost>0?'sleepers lost: '+lost.toLocaleString('en-US'):'';},
  summary:function(){return 'systems '+ORDER.filter(function(id){return S.restored[id];}).length+'/7';},
  sanitize:function(d,o){
    if(o.job&&typeof o.job==='object'&&isFinite(o.job.left))d.job=o.job;
    d.charge=Math.max(0,num(d.charge));
    // Saves from before the lock: life-critical systems come back on.
    Object.keys(CRIT).forEach(function(id){if(d.restored[id])d.on[id]=true;});
  },
  resetDom:function(){
    MY_PANELS.forEach(function(id){delete $(id).dataset.shown;$(id).classList.remove('appear');});
  }
});
})();
