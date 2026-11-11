import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createSimulation} from './sim/model-99d818099235.mjs';

const $=s=>document.querySelector(s), stage=$('#stage');
const titles={'pack-check':'Pack label inspection','cap-check':'Bottle cap inspection','case-read':'Case mark inspection','part-check':'Machined part inspection'};
const params=new URLSearchParams(location.search), requested=params.get('variant');
const variant=titles[requested]?requested:document.body.dataset.variant;
const simulation=createSimulation({variant});
let state=simulation.snapshot(), ready=false, view='Overview', manifest, common, sourceRoot;
const itemGroups=new Map(), captures=new Map(), templates=[], sourceX=[.65,1.28,1.93,2.6,3.32,4.05];
const mechanisms={moving:[],rotating:[],fixed:[],rod:null}, sourceMapping=[];
let frameTime=null, lastText='', manualClock=false;
const scene=new T.Scene();scene.background=new T.Color('#e9eded');
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;stage.prepend(renderer.domElement);
const camera=new T.PerspectiveCamera(36,1,.015,90),controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=.2;controls.maxDistance=22;
const pmrem=new T.PMREMGenerator(renderer),environment=new RoomEnvironment();scene.environment=pmrem.fromScene(environment,.04).texture;environment.dispose();pmrem.dispose();scene.environmentIntensity=.8;
scene.add(new T.HemisphereLight(0xeaf5ff,0x848078,1.8));
for(const [position,intensity,shadow] of [[[1,7,4],3,true],[[5,4,-4],2,false]]){const l=new T.DirectionalLight(0xfff7e9,intensity);l.position.set(...position);l.target.position.set(2,0,0);scene.add(l,l.target);if(shadow){l.castShadow=true;l.shadow.mapSize.set(2048,2048);Object.assign(l.shadow.camera,{left:-5,right:6,top:5,bottom:-5,near:.1,far:18});l.shadow.normalBias=.008;l.shadow.bias=-.0002;}}
const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xdde2e3,roughness:.88,metalness:.05}));floor.rotation.x=-Math.PI/2;floor.position.y=-.012;floor.receiveShadow=true;scene.add(floor);
const presets={Overview:{target:[2.22,.83,0],direction:[1.1,.78,1.3]},Inspection:{target:[1.98,1.08,0],direction:[-.55,.42,1.15],radius:.76},Reject:{target:[3.32,.96,-.2],direction:[.6,.75,1.3],radius:.95},Drive:{target:[4.3,.72,.45],direction:[1,.5,1.3],radius:.85}};
function cameraView(name){const damping=controls.enableDamping;controls.enableDamping=false;controls.update();view=name;
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===name);b.setAttribute('aria-pressed',b.dataset.view===name);});
 const p=presets[name],target=new T.Vector3(...p.target),dir=new T.Vector3(...p.direction).normalize();let distance;
 if(name==='Overview'&&common){const box=new T.Box3().setFromObject(common);target.copy(box.getCenter(new T.Vector3()));const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),dir).normalize(),up=new T.Vector3().crossVectors(dir,right).normalize(),tan=Math.tan(T.MathUtils.degToRad(camera.fov/2));distance=0;common.updateMatrixWorld(true);common.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const v=new T.Vector3(x,y,z).applyMatrix4(o.matrixWorld).sub(target);distance=Math.max(distance,v.dot(dir)+Math.abs(v.dot(right))/(tan*camera.aspect),v.dot(dir)+Math.abs(v.dot(up))/tan);}});distance*=1.08;
 }else distance=p.radius/Math.sin(T.MathUtils.degToRad(camera.fov/2))/Math.min(1,camera.aspect)*1.05;
 controls.target.copy(target);camera.position.copy(target).addScaledVector(dir,distance);controls.update();controls.enableDamping=damping;
}
const loader=new GLTFLoader();
async function load(name){const info=manifest.assets[name];let gltf;if(info.chunks){const buffers=await Promise.all(info.chunks.map(async c=>{const response=await fetch(new URL('assets/'+c.filename,document.baseURI));if(!response.ok)throw Error('Mesh chunk '+response.status);const b=new Uint8Array(await response.arrayBuffer());if(b.length!==c.bytes)throw Error('Mesh chunk length mismatch');return b;}));const bytes=new Uint8Array(info.bytes);let offset=0;for(const b of buffers){bytes.set(b,offset);offset+=b.length;}const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==info.sha256)throw Error('Mesh content hash mismatch');gltf=await loader.parseAsync(bytes.buffer,new URL('assets/',document.baseURI).href);}else gltf=await loader.loadAsync(new URL('assets/'+name+'.glb',document.baseURI).href);
 gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});gltf.scene.updateMatrixWorld(true);return gltf.scene;
}
function bindTemplates(root){
 for(let i=0;i<6;i++){const group=new T.Group();group.name='private-template-'+i;templates.push(group);}
 root.traverse(o=>{const match=o.name.match(/TCAS_concept_(pack|cap|case|part)_sample_(\d+)_/);if(!match||!o.isMesh)return;const i=Number(match[2]);
  const clone=o.clone();o.matrixWorld.decompose(clone.position,clone.quaternion,clone.scale);clone.updateMatrix();templates[i].add(clone);sourceMapping.push({name:o.name,templateIndex:i,worldMatrix:o.matrixWorld.toArray(),sourceX:sourceX[i]});
 });
 if(templates.some(g=>!g.children.length))throw Error('Missing authored sample template');
}
function pivotFor(o,point){const pivot=new T.Group();pivot.name='motion-pivot-'+o.name;pivot.position.copy(point);scene.add(pivot);pivot.updateMatrixWorld(true);pivot.attach(o);return pivot;}
function bindMechanisms(root){const nodes=[];root.traverse(o=>{if(o.isMesh)nodes.push(o);});
 for(const o of nodes){const n=o.name,box=new T.Box3().setFromObject(o),center=box.getCenter(new T.Vector3());
  if(/reject_pusher_(backplate|contact_pad)|reject_guide_shaft_/.test(n)){const p=pivotFor(o,new T.Vector3());mechanisms.moving.push({node:o,pivot:p,initial:p.position.clone()});}
  else if(/pneumatic_piston_rod$/.test(n)){// Browser +Z is the CAD rear (-Y). Scale from the measured rear endpoint.
   const anchor=center.clone();anchor.z=box.max.z;const p=pivotFor(o,anchor);mechanisms.rod={node:o,pivot:p,length:box.max.z-box.min.z,anchor:anchor.toArray()};
  }else if(/(head|tail)_(pulley|shaft)$/.test(n)){const p=pivotFor(o,center);mechanisms.rotating.push({node:o,pivot:p,pivotPoint:center.toArray()});}
  else if(/pneumatic_cylinder_barrel$|reject_linear_bearing_|motor_cylindrical_body$/.test(n))mechanisms.fixed.push(o);
 }
 if(mechanisms.moving.length!==4||!mechanisms.rod||mechanisms.rotating.length!==4)throw Error('Mechanical node binding incomplete');
}
function syncMeshes(s){const active=new Set();for(const item of s.items){active.add(item.id);let group=itemGroups.get(item.id);if(!group){group=templates[item.templateIndex].clone(true);group.name=item.id;group.userData.itemId=item.id;group.traverse(o=>{o.userData={...o.userData,itemId:item.id};});scene.add(group);itemGroups.set(item.id,group);}group.position.set(item.x-sourceX[item.templateIndex],0,-item.y);group.updateMatrixWorld(true);}
 for(const [id,g]of itemGroups)if(!active.has(id)){scene.remove(g);itemGroups.delete(id);}
 for(const m of mechanisms.moving)m.pivot.position.z=m.initial.z-s.reject.stroke;
 if(mechanisms.rod)mechanisms.rod.pivot.scale.z=1+s.reject.stroke/mechanisms.rod.length;
 for(const m of mechanisms.rotating)m.pivot.rotation.z=s.beltDistance/.089;
 scene.updateMatrixWorld(true);
}
// A separate render target captures the real authored template, in station coordinates.
// Never reads a native still. The per-record image remains bound to that ID in memory.
const imageScene=new T.Scene();imageScene.background=new T.Color('#edf1f2');imageScene.environment=scene.environment;
imageScene.add(new T.HemisphereLight(0xffffff,0x78838b,2.5));const imageLight=new T.DirectionalLight(0xffffff,3);imageLight.position.set(1,4,4);imageScene.add(imageLight);
const imageCamera=new T.PerspectiveCamera(30,1.4,.01,20),imageTarget=new T.WebGLRenderTarget(392,280);
const pixels=new Uint8Array(392*280*4),captureCanvas=document.createElement('canvas');captureCanvas.width=392;captureCanvas.height=280;
function captureRecord(record){if(captures.has(record.id))return;const template=templates[record.templateIndex];if(!template)return;const group=template.clone(true);
 const event=state.events.find(e=>e.type==='inspected'&&e.itemId===record.id);const stationX=event?.x??record.inspectionX??1.872;
 group.position.set(stationX-sourceX[record.templateIndex],0,0);imageScene.add(group);group.updateMatrixWorld(true);const box=new T.Box3().setFromObject(group),center=box.getCenter(new T.Vector3()),radius=box.getSize(new T.Vector3()).length()*.5;
 imageCamera.position.copy(center).add(new T.Vector3(.32,.18,1).normalize().multiplyScalar(radius/Math.sin(Math.PI/12)*1.15));imageCamera.lookAt(center);imageCamera.updateMatrixWorld();
 renderer.setRenderTarget(imageTarget);renderer.render(imageScene,imageCamera);renderer.readRenderTargetPixels(imageTarget,0,0,392,280,pixels);renderer.setRenderTarget(null);
 const ctx=captureCanvas.getContext('2d'),image=ctx.createImageData(392,280);for(let y=0;y<280;y++)image.data.set(pixels.subarray(y*392*4,(y+1)*392*4),(279-y)*392*4);ctx.putImageData(image,0,0);
 captures.set(record.id,{url:captureCanvas.toDataURL('image/png'),templateIndex:record.templateIndex,stationX,inspectionTime:record.inspectionTime,sourceNames:template.children.map(o=>o.name),pose:group.matrixWorld.toArray()});imageScene.remove(group);
}
const readable=s=>String(s??'Pending').replaceAll('_',' ').toLowerCase();
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function display(s){$('#mode').textContent=s.mode;$('#mode').dataset.mode=s.mode;$('#phase').textContent=readable(s.phase);
 $('#sensorFault').checked=s.rejectSensorFault;$('#status').textContent='Drag to rotate / scroll or pinch to zoom';
 const notes={STOPPED:'Ready / stopped. Press Start deliberately; reset never starts the line.',RUNNING:'Following modeled arrivals, inspection and reject transfer.',PAUSED:'Paused. Products, belt drive and reject motion are held.',ESTOP:'Simulated E-stop latched. Release, reset, then Start deliberately.',FAULT:'Reject confirmation missing. Clear the cause, reset, then Start deliberately.'};
 $('#runNote').textContent=s.mode==='FAULT'&&s.fault==='REJECT_TRAY_OCCUPIED'?'Receiving slot occupied. Clear the tray, Reset, then Start deliberately.':notes[s.mode]||readable(s.fault);
 for(const record of s.records)captureRecord(record);
 const selected=s.followedId?s.records.find(r=>r.id===s.followedId):s.records.at(-1),live=s.items.find(i=>i.id===s.followedId);
 const r=selected||live;
 if(r){const img=captures.get(r.id);$('#inspectionImage').hidden=!img;$('#imageEmpty').hidden=!!img;if(img){$('#inspectionImage').src=img.url;$('#inspectionImage').alt=`SIMULATED 3D image / ${r.id} / CAD template ${r.templateIndex} / inspection station`;}
 $('#result').innerHTML=`<strong class="result-${String(r.result).toLowerCase()}">${escape(r.id)} / ${escape(r.result||'Tracking')}</strong><p>${escape(r.reason||readable(r.stage))}</p>`;
 const rejectEvents=s.events.filter(e=>e.itemId===r.id);const commanded=rejectEvents.some(e=>e.type==='reject-commanded'),confirmed=rejectEvents.some(e=>e.type==='reject-confirmed');
 $('#itemDetail').innerHTML=`<p>Disposition <b>${escape(readable(r.disposition))}</b></p><p>Inspected at <b>${Number(r.inspectionTime??s.time).toFixed(2)} s</b></p><p>Reject command <b>${commanded?'issued':'not issued'}</b></p><p>Confirmation <b>${confirmed?'confirmed':commanded?'pending / unresolved':'not requested'}</b></p>`;
 }else{$('#inspectionImage').hidden=true;$('#imageEmpty').hidden=false;$('#result').innerHTML='<strong>Waiting for first item</strong><p>Arrival - trigger - inspection - disposition</p>';$('#itemDetail').textContent='';}
 $('#counters').innerHTML=[['inspected','Inspected'],['pass','Passed'],['fail','Failed'],['rejectedConfirmed','Reject confirmed'],['passedOut','Continued'],['unresolved','Awaiting confirm'],['onBelt','On conveyor'],['inTray','Reject tray']].map(([k,label])=>`<div><b data-count="${k}">${s.counters[k]}</b><span>${label}</span></div>`).join('');
 const signature=JSON.stringify([s.records,s.followedId,s.events.at(-1)?.id]);if(signature!==lastText){lastText=signature;
 $('#records').innerHTML=s.records.length?[...s.records].reverse().map(r=>`<tr class="${r.id===s.followedId?'followed':''}" data-item-id="${escape(r.id)}"><td><button data-follow="${escape(r.id)}" aria-label="Follow ${escape(r.id)}">${escape(r.id)}</button></td><td>${Number(r.inspectionTime).toFixed(2)} s</td><td><b class="${String(r.result).toLowerCase()}">${escape(r.result)}</b><small>${escape(r.reason)}</small></td><td>${escape(readable(r.disposition))}</td></tr>`).join(''):'<tr><td colspan="4">No inspections yet. Start the sequence.</td></tr>';
 $('#eventCount').textContent=s.events.length;$('#events').innerHTML=s.events.slice(-60).reverse().map(e=>`<li>${Number(e.time).toFixed(2)} s / ${escape(e.itemId||'controller')} / ${escape(readable(e.type))}</li>`).join('');
 }
}
function apply(snapshot){state=snapshot;if(ready){syncMeshes(state);display(state);}return state;}
function act(action,payload){const prior=state;const next=simulation.dispatch(action,payload);if(action==='rewind'||(next.time<prior.time)){captures.clear();lastText='';}return apply(next);}
function advance(dt){return apply(simulation.advance(dt));}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>act(b.dataset.action));
$('#sensorFault').onchange=e=>act('setRejectSensorFault',e.target.checked);
$('#records').onclick=e=>{const b=e.target.closest('[data-follow]');if(b)act('follow',b.dataset.follow);};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>cameraView(b.dataset.view));
document.querySelectorAll('a[data-variant]').forEach(a=>{a.classList.toggle('active',a.dataset.variant===variant);if(a.dataset.variant===variant)a.setAttribute('aria-current','page');});
$('#variantTitle').textContent=titles[variant];
$('#renderReferences').innerHTML=[['overview','Overview'],['inspection-detail','Inspection'],['reject-detail','Reject'],['drive-detail','Drive']].map(([key,label])=>`<a href="renders/${variant}-${key}-v2.png" target="_blank" rel="noopener">${label}</a>`).join('');
const ray=new T.Raycaster(),pointer=new T.Vector2();let down;
function pickables(){const result=[];common?.traverse(o=>{if(o.isMesh)result.push(o);});for(const m of [...mechanisms.moving,...mechanisms.rotating])result.push(m.node);if(mechanisms.rod)result.push(mechanisms.rod.node);for(const g of itemGroups.values())g.traverse(o=>{if(o.isMesh)result.push(o);});return result;}
renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(pickables(),false)[0];if(hit){const o=hit.object;$('#selection').textContent=o.name+' / '+(o.userData.assembly||'component')+(o.userData.note?' / '+o.userData.note:'');window.lastPicked=o.name;if(o.userData.itemId)act('follow',o.userData.itemId);}});
function transforms(){scene.updateMatrixWorld(true);return{items:[...itemGroups].map(([id,g])=>({id,position:g.position.toArray(),nodes:g.children.map(o=>({name:o.name,matrix:o.matrixWorld.toArray()}))})),moving:mechanisms.moving.map(m=>({name:m.node.name,matrix:m.node.matrixWorld.toArray()})),rod:mechanisms.rod?{name:mechanisms.rod.node.name,matrix:mechanisms.rod.node.matrixWorld.toArray(),anchor:mechanisms.rod.anchor,length:mechanisms.rod.length,bounds:(()=>{const b=new T.Box3().setFromObject(mechanisms.rod.node);return{min:b.min.toArray(),max:b.max.toArray()};})()}:null,rotating:mechanisms.rotating.map(m=>({name:m.node.name,matrix:m.node.matrixWorld.toArray(),pivot:m.pivotPoint})),fixed:mechanisms.fixed.map(o=>({name:o.name,matrix:o.matrixWorld.toArray()}))};}
function resize(){camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();renderer.setSize(stage.clientWidth,stage.clientHeight);if(ready)cameraView(view);}
new ResizeObserver(resize).observe(stage);resize();
renderer.setAnimationLoop(time=>{const dt=frameTime===null?0:Math.min((time-frameTime)/1000,.1);frameTime=time;if(ready&&!manualClock&&state.mode==='RUNNING')advance(dt*Number($('#rate').value));controls.update();renderer.render(scene,camera);});
// Tests use the same model and apply() path; no alternate controller or simulated mesh state.
if(params.get('test')==='1')window.proposalSim={get ready(){return ready;},get variant(){return variant;},get view(){return view;},snapshot:()=>simulation.snapshot(),dispatch:act,advance,transforms,manualClock(value=true){manualClock=value;},mapping:()=>sourceMapping,captures:()=>Object.fromEntries([...captures].map(([id,c])=>[id,{...c,url:undefined,bytes:c.url.length}])),pickPoint(){camera.updateMatrixWorld();const rect=renderer.domElement.getBoundingClientRect(),objects=pickables();for(const o of objects){const v=new T.Box3().setFromObject(o).getCenter(new T.Vector3()).project(camera);if(Math.abs(v.x)>.9||Math.abs(v.y)>.9)continue;ray.setFromCamera(new T.Vector2(v.x,v.y),camera);const hit=ray.intersectObjects(objects,false)[0];if(hit)return{x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2,expected:hit.object.name};}return null;}};
try{manifest=await(await fetch(new URL('manifest-196c3035b511.json',document.baseURI))).json();common=await load('common');scene.add(common);sourceRoot=await load(variant);bindTemplates(sourceRoot);bindMechanisms(common);ready=true;$('#description').textContent=manifest.variant_metadata[variant].description+' / inspect, track, reject';document.querySelectorAll('[data-action]').forEach(b=>b.disabled=false);apply(state);resize();}catch(error){$('#status').textContent='Geometry could not load: '+error.message;console.error(error);}
