// Illustrative settings only, not measured throughput or vision performance.
// Coordinates: X along conveyor; +Y toward receiver; belt height .940 m.
const DT = .01, SPEED = .45, PITCH = .70;
const SEQUENCE = [0,4,1,2,3,5];
const VARIANTS = {
  'pack-check': {halfDepth:.050, reason:'missing front label'},
  'cap-check': {halfDepth:.043, reason:'missing closure'},
  'case-read': {halfDepth:.100, reason:'blank illustrative unencoded mark panel'},
  'part-check': {halfDepth:.060, reason:'missing upright bore'}
};
export function createSimulation({variant='pack-check'}={}) {
  const config = VARIANTS[variant] || VARIANTS['pack-check'];
  let mode='STOPPED', phase='FEED', ticks=0, remainder=0, beltDistance=0;
  let sequence=0, nextSpawn=PITCH, eventSequence=0, followedId=null, injected=0;
  let items=[], records=[], events=[];
  const reject={stroke:0,command:false,confirmed:false,activeId:null};
  const counters={spawned:0,inspected:0,pass:0,fail:0,rejectedConfirmed:0,passedOut:0,unresolved:0,onBelt:0,inTray:0,clearedTray:0};
  let phaseTicks=0, estopLatched=false, estopReleased=false, fault=null, rejectSensorFault=false;
  function latchFault(code,item) {fault=code;mode='FAULT';emit('fault',item,{code});}
  function confirm(item) {
    if(reject.confirmed)return;
    reject.confirmed=true;item.disposition='REJECTED';counters.rejectedConfirmed++;counters.unresolved--;
    const r=recordFor(item);if(r)r.disposition='REJECTED';
    emit('reject-confirmed',item);phase='REJECT_DWELL';phaseTicks=0;
  }
  const emit=(type,item,extra={})=>{
    events.push({id:`event-${++eventSequence}`,type,itemId:item?.id??null,templateIndex:item?.templateIndex??null,time:ticks*DT,...extra});
    if(events.length>512) events.shift();
  };
  function spawn() {
    const slot=SEQUENCE[sequence++%6],templateIndex=injected>0?4:slot;if(injected>0)injected--;
    const item={id:`item-${String(++counters.spawned).padStart(4,'0')}`,templateIndex,x:.35,y:0,stage:'FEED',result:null,reason:null,disposition:'ON_BELT'};
    items.push(item); counters.onBelt++;if(!followedId)followedId=item.id;emit('spawned',item);
  }
  function inspect(item) {
    item.result=item.templateIndex===4?'FAIL':'PASS'; item.reason=item.result==='FAIL'?config.reason:({'pack-check':'front label present','cap-check':'closure present','case-read':'illustrative mark present','part-check':'both upright bores present'}[variant]||'required feature present');
    item.stage='INSPECTED'; counters.inspected++; counters[item.result==='FAIL'?'fail':'pass']++;
    if(item.result==='FAIL') counters.unresolved++;
    records.push({id:item.id,templateIndex:item.templateIndex,inspectionTime:ticks*DT,result:item.result,reason:item.reason,disposition:'ON_BELT'});
    if(records.length>256) records.shift();
    emit('inspected',item,{result:item.result,reason:item.reason});
  }
  const recordFor=item=>records.find(r=>r.id===item.id);
  function step() {
    ticks++;
    if(phase==='FEED') {
      let travel=SPEED*DT;
      const failed=items.find(i=>i.result==='FAIL'&&i.disposition==='ON_BELT'&&i.x<=3.32);
      if(failed) travel=Math.min(travel,Math.max(0,3.32-failed.x));
      beltDistance+=travel;
      for(const item of items.filter(i=>i.disposition==='ON_BELT')) {
        item.x+=travel;
        if(item.stage==='FEED'&&item.x>=1.586) {item.stage='TRIGGERED';emit('trigger',item);}
        if(!item.result&&item.x>=1.872) inspect(item);
        if(item.x>=4.65) {item.disposition='PASSED_OUT';item.stage='OUTFEED';counters.passedOut++;counters.onBelt--; const r=recordFor(item);if(r)r.disposition='PASSED_OUT';emit('passed-out',item);}
      }
      items=items.filter(i=>i.disposition!=='PASSED_OUT');
      if(beltDistance+1e-9>=nextSpawn) {spawn();nextSpawn+=PITCH;}
      if(failed&&failed.x>=3.32-1e-9) {
        if(counters.inTray){latchFault('REJECT_TRAY_OCCUPIED',failed);return;}
        phase='REJECT_EXTEND';phaseTicks=0;reject.command=true;reject.confirmed=false;reject.activeId=failed.id;failed.stage='REJECTING';emit('reject-commanded',failed);
      }
    } else {
      phaseTicks++;
      const item=items.find(i=>i.id===reject.activeId);
      if(phase==='REJECT_EXTEND') {
        reject.stroke=.8*Math.min(phaseTicks/120,1);
        item.y=Math.max(0,reject.stroke-(.320-config.halfDepth));
        if(phaseTicks>=120) {
          item.stage='TRAY';counters.onBelt--;counters.inTray++;
          item.disposition='UNRESOLVED';const r=recordFor(item);if(r)r.disposition='UNRESOLVED';
          phase='REJECT_CONFIRM';phaseTicks=0;emit('receiver-arrival',item);
          if(rejectSensorFault) latchFault('REJECT_CONFIRMATION',item);
          else confirm(item);
        }
      } else if(phase==='REJECT_CONFIRM') {
        if(rejectSensorFault) latchFault('REJECT_CONFIRMATION',item); else confirm(item);
      } else if(phase==='REJECT_DWELL'&&phaseTicks>=25) {phase='REJECT_RETRACT';phaseTicks=0;reject.command=false;emit('reject-retracting',item);}
      else if(phase==='REJECT_RETRACT') {
        reject.stroke=.8*Math.max(0,1-phaseTicks/120);
        if(phaseTicks>=120) {phase='FEED';reject.activeId=null;emit('reject-home',item);}
      }
    }
  }
  function snapshot() {return structuredClone({mode,phase,time:ticks*DT,beltDistance,items,reject,counters,records,events,followedId,fault,estopLatched,rejectSensorFault});}
  function dispatch(action,payload) {
    const blocked=reason=>emit('command-blocked',null,{action,reason});
    if(action==='setRejectSensorFault') rejectSensorFault=Boolean(payload);
    if(action==='estop') {estopLatched=true;estopReleased=false;mode='ESTOP';remainder=0;emit('estop');}
    if(action==='releaseEstop'&&estopLatched) {estopReleased=true;emit('estop-released');}
    if(action==='reset') {
      const cause=(fault==='REJECT_CONFIRMATION'&&rejectSensorFault)||(fault==='REJECT_TRAY_OCCUPIED'&&counters.inTray>0);
      if(estopLatched&&!estopReleased)blocked('Release E-stop before reset');
      else {estopLatched=false;estopReleased=false;remainder=0;if(cause){mode='FAULT';blocked('Clear the active process cause before reset');}else{fault=null;mode='STOPPED';emit('reset');}}
    }
    if(action==='start') {
      if(estopLatched||fault)blocked('A latched E-stop or fault requires reset');
      else {mode='RUNNING';if(!counters.spawned)spawn();emit('started');}
    }
    if(action==='pause'&&mode==='RUNNING') {mode='PAUSED';remainder=0;emit('paused');}
    if(action==='stop') {mode=estopLatched?'ESTOP':fault?'FAULT':'STOPPED';remainder=0;emit('stopped');}
    if(action==='injectBad') {injected++;emit('bad-sample-queued');}
    if(action==='follow') {if(payload===null)followedId=null;else if(items.some(i=>i.id===payload)||records.some(r=>r.id===payload))followedId=payload;}
    if(action==='clearTray') {
      if(phase!=='FEED'||reject.stroke>1e-9||estopLatched)blocked('Retract and stop the pusher before clearing the receiving slot');
      else {const removed=items.filter(i=>i.stage==='TRAY');items=items.filter(i=>i.stage!=='TRAY');counters.inTray-=removed.length;counters.clearedTray+=removed.length;for(const i of removed)emit('tray-cleared',i);}
    }
    if(action==='rewind') {
      if(mode==='RUNNING'||estopLatched||fault)blocked('Stop and clear active latches before rewinding');
      else {mode='STOPPED';phase='FEED';ticks=0;remainder=0;beltDistance=0;sequence=0;nextSpawn=PITCH;eventSequence=0;items=[];records=[];events=[];followedId=null;injected=0;phaseTicks=0;rejectSensorFault=false;Object.assign(reject,{stroke:0,command:false,confirmed:false,activeId:null});for(const k of Object.keys(counters))counters[k]=0;}
    }
    return snapshot();
  }
  function advance(seconds) {
    if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('Advance requires finite nonnegative seconds');
    if(mode!=='RUNNING')return snapshot();
    remainder+=seconds;
    while(remainder+1e-9>=DT&&mode==='RUNNING') {remainder=Math.max(0,remainder-DT);step();}
    if(mode!=='RUNNING')remainder=0;
    return snapshot();
  }
  return {dispatch,advance,snapshot};
}
