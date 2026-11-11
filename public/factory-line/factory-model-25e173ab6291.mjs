// One deterministic inferred packaging-line model; no plant/vision connection or performance claim.
const DT=.01,V=.55,PITCH=.65,SPAWN=-2.7;
const ease=x=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x);};
const lerp=(a,b,t)=>a+(b-a)*ease(t);
export function createFactory(){
 let mode='STOPPED',ticks=0,remainder=0,seq=0,eventSeq=0,estopLatched=false,released=false,fault=null,rejectSensorFault=false;
 let items=[],events=[],dist={main:0,accepted:0,carton:0,tape:0,sealer:[0,0]},nextMiss=false;
 let counts={created:0,labeled:0,inspected:0,failed:0,rejected:0,packed:0,dispatched:0};
 const label={phase:'IDLE',activeId:null,stroke:0,elapsed:0,webDistance:0};
 const reject={phase:'IDLE',activeId:null,stroke:0,confirmed:false,elapsed:0};
 const gantry={phase:'IDLE',activeId:null,x:5.25,y:0,lift:.75,jaw:0,elapsed:0,slot:0};
 const cases=[{id:'CASE-0001',x:5.75,y:1.25,phase:'SUPPLY',contents:[],minor:0,major:0,closed:false,taped:false,tapeProgress:0,dispatched:false}];
 const emit=(type,itemId=null,more={})=>{events.push({id:++eventSeq,time:ticks*DT,type,itemId,...more});};
 const find=id=>items.find(i=>i.id===id);
 const transition=(a,p)=>{a.phase=p;a.elapsed=0;};
 function spawn(){const id='PKG-'+String(++seq).padStart(4,'0');items.push({id,x:SPAWN,y:0,lift:0,owner:'BELT',stage:'infeed',labelApplied:false,labelCycleDone:false,miss:seq===2||nextMiss,result:null,caseId:null});nextMiss=false;counts.created++;emit('created',id);}
 function latch(code){fault=code;mode='FAULT';emit('fault',null,{code});}
 function labeling(){if(label.phase==='IDLE')return;label.elapsed+=DT;const i=find(label.activeId);
  if(label.phase==='FEED'){if(!i.miss)label.webDistance+=.12*DT/.30;if(label.elapsed>=.30-1e-9)transition(label,'EXTEND');}
  else if(label.phase==='EXTEND'){label.stroke=lerp(0,.245,label.elapsed/.45);if(label.elapsed>=.45-1e-9){label.stroke=.245;if(!i.miss){i.labelApplied=true;counts.labeled++;emit('label-applied',i.id);}else emit('label-missed',i.id);transition(label,'DWELL');}}
  else if(label.phase==='DWELL'&&label.elapsed>=.15-1e-9)transition(label,'RETRACT');
  else if(label.phase==='RETRACT'){label.stroke=lerp(.245,0,label.elapsed/.45);if(label.elapsed>=.45-1e-9){label.stroke=0;i.labelCycleDone=true;i.stage='inspection';transition(label,'IDLE');label.activeId=null;}}
 }
 function rejecting(){if(reject.phase==='IDLE')return;reject.elapsed+=DT;const i=find(reject.activeId);
  if(reject.phase==='EXTEND'){reject.stroke=lerp(0,.8,reject.elapsed/1.0);i.y=Math.max(0,reject.stroke-.27);i.stage='reject';if(reject.elapsed>=1-1e-9){reject.stroke=.8;i.y=.53;transition(reject,'CONFIRM');}}
  else if(reject.phase==='CONFIRM'){if(rejectSensorFault){latch('REJECT_CONFIRMATION');return;}reject.confirmed=true;i.owner='REJECT';i.stage='rejected';counts.rejected++;emit('reject-confirmed',i.id);transition(reject,'DWELL');}
  else if(reject.phase==='DWELL'&&reject.elapsed>=.2-1e-9)transition(reject,'RETRACT');
  else if(reject.phase==='RETRACT'){reject.stroke=lerp(.8,0,reject.elapsed/1);if(reject.elapsed>=1-1e-9){reject.stroke=0;transition(reject,'IDLE');reject.activeId=null;}}
 }
 const slot=(n)=>({x:6.25+(n<2?-.11:.11),y:1.25+(n%2? .07:-.07)});
 function packing(){const c=cases[0];if(gantry.phase==='IDLE'){const i=items.find(i=>i.owner==='BELT'&&i.result==='PASS'&&i.x>=5.25-1e-8);if(i&&c.phase==='FILL'&&c.contents.length<4){gantry.activeId=i.id;gantry.slot=c.contents.length;transition(gantry,'LOWER_PICK');}else return;}
  gantry.elapsed+=DT;const i=find(gantry.activeId),p=slot(gantry.slot),t=gantry.elapsed;
  if(gantry.phase==='LOWER_PICK'){gantry.lift=lerp(.75,0,t/.65);if(t>=.65-1e-9){gantry.lift=0;transition(gantry,'GRIP');}}
  else if(gantry.phase==='GRIP'){gantry.jaw=lerp(0,.018,t/.22);if(t>=.22-1e-9){gantry.jaw=.018;i.owner='ROBOT';i.stage='packing';emit('gripped',i.id,{caseId:c.id});transition(gantry,'LIFT_PICK');}}
  else if(gantry.phase==='LIFT_PICK'){gantry.lift=lerp(0,.75,t/.65);if(t>=.65-1e-9){gantry.lift=.75;transition(gantry,'TRANSFER');}}
  else if(gantry.phase==='TRANSFER'){gantry.x=lerp(5.25,p.x,t/.95);gantry.y=lerp(0,p.y,t/.95);if(t>=.95-1e-9){gantry.x=p.x;gantry.y=p.y;transition(gantry,'LOWER_PLACE');}}
  else if(gantry.phase==='LOWER_PLACE'){gantry.lift=lerp(.75,.006,t/.65);if(t>=.65-1e-9){gantry.lift=.006;transition(gantry,'RELEASE');}}
  else if(gantry.phase==='RELEASE'){gantry.jaw=lerp(.018,0,t/.22);if(t>=.22-1e-9){gantry.jaw=0;i.owner='CASE';i.caseId=c.id;i.slot=gantry.slot;i.x=p.x;i.y=p.y;i.lift=.006;c.contents.push(i.id);counts.packed++;emit('packed',i.id,{caseId:c.id,slot:gantry.slot});if(c.contents.length===4){c.phase='FULL';emit('case-full',null,{caseId:c.id,items:[...c.contents]});}transition(gantry,'LIFT_CLEAR');}}
  else if(gantry.phase==='LIFT_CLEAR'){gantry.lift=lerp(.006,.75,t/.65);if(t>=.65-1e-9){gantry.lift=.75;transition(gantry,'RETURN');}}
  else if(gantry.phase==='RETURN'){gantry.x=lerp(p.x,5.25,t/.95);gantry.y=lerp(p.y,0,t/.95);if(t>=.95-1e-9){gantry.x=5.25;gantry.y=0;transition(gantry,'IDLE');gantry.activeId=null;}}
  if(i.owner==='ROBOT'){i.x=gantry.x;i.y=gantry.y;i.lift=gantry.lift;}
 }
 function carton(){const c=cases[0],old=c.x;
  if(c.phase==='SUPPLY'){c.x=Math.min(6.25,c.x+.45*DT);if(c.x>=6.25-1e-9){c.phase='FILL';emit('case-ready',null,{caseId:c.id});}}
  if(c.phase==='FULL'&&gantry.lift>=.749&&['RETURN','IDLE'].includes(gantry.phase))c.phase='OUTFEED';
  if(c.phase==='OUTFEED'){c.x=Math.min(9.1,c.x+.45*DT);c.minor=ease((c.x-6.95)/.18);c.major=ease((c.x-7.13)/.20);if(c.major>=1&&!c.closed){c.closed=true;emit('case-closed',null,{caseId:c.id});}c.tapeProgress=Math.min(1,Math.max(0,(c.x-7.54)/.52));if(c.tapeProgress>=1&&!c.taped){if(!c.closed)throw Error('Cannot tape open case');c.taped=true;emit('tape-applied',null,{caseId:c.id});}if(c.x>=9.1-1e-9){c.dispatched=true;c.phase='DISPATCHED';counts.dispatched++;for(const id of c.contents)find(id).owner='SHIPPED';emit('dispatched',null,{caseId:c.id,items:[...c.contents]});mode='COMPLETE';}}
  dist.carton+=c.x-old;dist.tape+=Math.max(0,Math.min(c.x,8.06)-Math.max(old,7.54));for(const [j,x] of [7.64,7.96].entries())dist.sealer[j]+=Math.max(0,Math.min(c.x,x+.26)-Math.max(old,x-.26));
  for(const id of c.contents){const i=find(id),p=slot(i.slot);i.x=c.x+(p.x-6.25);i.y=p.y;i.lift=.006;}
 }
 function conveying(){const line=items.filter(i=>i.owner==='BELT').sort((a,b)=>b.x-a.x);const held=label.phase!=='IDLE'||reject.phase!=='IDLE';let front=Infinity,mainMoved=false,acceptedMoved=false;
  for(const i of line){let target=i.x+(i.x<4.6&&held?0:V*DT);target=Math.min(target,front-PITCH,5.25);if(!i.labelCycleDone)target=Math.min(target,-.65);if(i.result==='FAIL')target=Math.min(target,3.32);const old=i.x;i.x=Math.max(i.x,target);if(i.x>old+1e-12){if(old<4.6)mainMoved=true;else acceptedMoved=true;}front=i.x;
   if(!i.labelCycleDone&&i.x>=-.65-1e-8&&label.phase==='IDLE'){i.x=-.65;label.activeId=i.id;i.stage='label';transition(label,'FEED');}
   if(!i.triggered&&i.x>=1.586){i.triggered=true;emit('trigger',i.id);}
   if(!i.result&&i.x>=1.872){i.result=i.labelApplied?'PASS':'FAIL';i.inspectionTime=ticks*DT;counts.inspected++;if(i.result==='FAIL')counts.failed++;emit('inspected',i.id,{result:i.result,labelApplied:i.labelApplied,x:1.872});}
   if(i.result==='FAIL'&&i.x>=3.32-1e-8&&reject.phase==='IDLE'){if(counts.rejected){latch('REJECT_TRAY_OCCUPIED');return;}i.x=3.32;reject.activeId=i.id;reject.confirmed=false;transition(reject,'EXTEND');emit('reject-commanded',i.id);}
   if(i.result==='PASS'&&i.x>=5.25-1e-8)i.stage='waiting-pick';
  }
  if(mainMoved)dist.main+=V*DT;if(acceptedMoved)dist.accepted+=V*DT;
  if(counts.created<5&&(!items.some(i=>i.owner==='BELT'&&i.x<SPAWN+PITCH-1e-9)))spawn();
 }
 function step(){ticks++;labeling();rejecting();if(mode!=='RUNNING')return;conveying();if(mode!=='RUNNING')return;packing();carton();}
 function stage(){const c=cases[0];if(mode==='COMPLETE')return'complete';if(c.taped&&c.phase==='OUTFEED')return'outfeed';if(c.phase==='OUTFEED')return'sealing';if(counts.rejected)return'packing';if(items.some(i=>i.result==='FAIL')||reject.phase!=='IDLE')return'reject';if(counts.inspected||find('PKG-0001')?.x>.7)return'inspection';if(label.phase!=='IDLE'||counts.labeled||find('PKG-0001')?.x>-1.2)return'label';return'infeed';}
 function snapshot(){const inventory={onBelt:0,held:0,inCases:0,rejected:0,shipped:0};for(const i of items)inventory[({BELT:'onBelt',ROBOT:'held',CASE:'inCases',REJECT:'rejected',SHIPPED:'shipped'})[i.owner]]++;return structuredClone({mode,time:ticks*DT,stage:stage(),followId:stage()==='reject'?(items.find(i=>i.result==='FAIL')?.id??'PKG-0001'):'PKG-0001',items,cases,label,reject,gantry,counts,inventory,dist,events,fault,estopLatched,rejectSensorFault});}
 function dispatch(action,value){if(action==='start'&&!estopLatched&&!fault&&mode!=='COMPLETE'){mode='RUNNING';if(!counts.created)spawn();}if(action==='pause'&&mode==='RUNNING')mode='PAUSED';if(action==='stop')mode=estopLatched?'ESTOP':fault?'FAULT':'STOPPED';if(action==='estop'){estopLatched=true;released=false;mode='ESTOP';}if(action==='releaseEstop')released=true;if(action==='rejectSensorFault')rejectSensorFault=Boolean(value);if(action==='missNextLabel')nextMiss=true;if(action==='reset'&&(!estopLatched||released)){estopLatched=false;released=false;if(fault==='REJECT_CONFIRMATION'&&rejectSensorFault||fault==='REJECT_TRAY_OCCUPIED'&&counts.rejected)mode='FAULT';else{fault=null;mode='STOPPED';}}if(mode!=='RUNNING')remainder=0;return snapshot();}
 function advance(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid elapsed time');if(mode!=='RUNNING')return snapshot();remainder+=seconds;while(remainder+1e-9>=DT&&mode==='RUNNING'){remainder=Math.max(0,remainder-DT);step();}if(mode!=='RUNNING')remainder=0;return snapshot();}
 return{snapshot,dispatch,advance};
}
