import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { createIcons, Upload, ShieldCheck, CircleHelp, Box, CheckCircle2, Plus, RotateCcw, Scan, Square, Network, Slice, Mouse, SlidersHorizontal, Move, Trash2, Info, Check, Download, Undo2, Redo2, Disc3, Wrench } from 'lucide';
import { cavityDimensions, validateCavity, toGeometry, LIMITS } from './geometry.js';
import { validateRepairOptions } from './repair.js';

const icons = { Upload, ShieldCheck, CircleHelp, Box, CheckCircle2, Plus, RotateCcw, Scan, Square, Network, Slice, Mouse, SlidersHorizontal, Move, Trash2, Info, Check, Download, Undo2, Redo2, Disc3, Wrench };
const $ = id => document.getElementById(id);
const refreshIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
const fmt = (x, digits=2) => x.toLocaleString('pt-BR', { maximumFractionDigits:digits, minimumFractionDigits:digits });
const state = { cavities:[], selected:null, placing:false, reposition:false, busy:false, original:null, displayed:null, name:'suporte-demo.stl', size:[64,44,39], undo:[], redo:[], revision:0, applied:-1, section:false, wireframe:false, alive:true, meshValid:false, repairReport:null };
const fields = ['diameter','thickness','diameterAllowance','depthAllowance'];
let toastTimer, requestID=0, worker, baseMesh, resultMesh, ghost, hoverHit, down, markerGroups=[], grid, axes, exportURL, patchMesh;
const requests = new Map();
function setStatus(text) { $('status').textContent = text; }
function toast(text,error=false) { clearTimeout(toastTimer); $('toast').textContent=text; $('toast').hidden=false; $('toast').classList.toggle('error',error); toastTimer=setTimeout(()=>$('toast').hidden=true,error?14000:6000); }
function initializeWorker() {
  worker = new Worker(new URL('./geometry.worker.js',import.meta.url),{type:'module'});
  worker.onmessage = ({data}) => {
    const pending=requests.get(data.id); if(!pending) return;
    clearTimeout(pending.timer); requests.delete(data.id);
    if(data.ok) pending.resolve(data.payload); else pending.reject(Object.assign(new Error(data.error),{repairReport:data.repairReport}));
  };
  worker.onerror = () => failWorker('O processamento 3D foi interrompido. Recarregue a página e importe novamente.');
}
function failWorker(message) {
  state.alive=false; worker.terminate();
  for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error(message));} requests.clear();
  toast(message,true); syncButtons();
}
function request(type,payload={},transfer=[]) {
  if(!state.alive) return Promise.reject(new Error('Recarregue a página para reiniciar o processamento 3D.'));
  const id=++requestID;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>failWorker('A operação excedeu 120 segundos. Recarregue a página e tente uma peça menor.'),120000);
    requests.set(id,{resolve,reject,timer}); worker.postMessage({id,type,payload},transfer);
  });
}
async function busy(label,fn) {
  if(state.busy) return;
  state.busy=true; $('busy-label').textContent=label; $('busy').hidden=false; syncButtons();
  try { return await fn(); }
  catch(err){toast(err.message,true);setStatus('Operação não concluída. '+err.message);}
  finally{state.busy=false;$('busy').hidden=true;syncButtons();}
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38,1,0.01,10000); camera.up.set(0,0,1);
let renderer;
try { renderer = new THREE.WebGLRenderer({antialias:true,alpha:true}); }
catch { $('busy').innerHTML='<strong>O navegador não disponibilizou gráficos 3D.</strong><small>Ative a aceleração gráfica ou tente outro navegador.</small>'; throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;renderer.localClippingEnabled=true;
$('canvas-host').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.screenSpacePanning=true;
scene.add(new THREE.HemisphereLight(0xc7e4ef,0x536278,2.4));
const key=new THREE.DirectionalLight(0xfff9ef,3.2);key.position.set(-60,-50,120);scene.add(key);
const fill=new THREE.DirectionalLight(0xa4d6ff,2);fill.position.set(60,35,60);scene.add(fill);
const modelMaterial=new THREE.MeshStandardMaterial({color:0x9fabb7,metalness:.18,roughness:.38,side:THREE.DoubleSide,flatShading:true});
const clipPlane=new THREE.Plane(new THREE.Vector3(-1,0,0),0);
const raycaster=new THREE.Raycaster(); raycaster.firstHitOnly=true;
const pointer=new THREE.Vector2();
THREE.Mesh.prototype.raycast=acceleratedRaycast;
function attachTree(data) { const g=toGeometry(data);g.boundsTree=MeshBVH.deserialize(data.bvh,g);return g; }
function fit(top=false) {
  if(!baseMesh) return;
  const bounds=new THREE.Box3().setFromObject(baseMesh),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const max=Math.max(size.x,size.y,size.z),distance=max/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.4/Math.min(camera.aspect,1);
  controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(...(top?[0,-.001,1]:[1.12,-1.55,1.13])).normalize().multiplyScalar(distance));
  camera.near=Math.max(max/10000,.001);camera.far=Math.max(max*100,100);camera.updateProjectionMatrix();controls.minDistance=max*.12;controls.maxDistance=max*15;controls.update();
}
function resize(){const w=$('canvas-host').clientWidth,h=$('canvas-host').clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('canvas-host'));resize();
function makeFloor(){
  if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}
  if(axes){scene.remove(axes);axes.geometry.dispose();axes.material.dispose();}
  const box=baseMesh.geometry.boundingBox;const max=Math.max(...state.size);
  grid=new THREE.GridHelper(max*3,30,0x4b5d69,0x344854);grid.rotation.x=Math.PI/2;grid.position.z=box.min.z-.1;grid.material.transparent=true;grid.material.opacity=.35;scene.add(grid);
  axes=new THREE.AxesHelper(max*.16);axes.position.set(-max*.66,-max*.6,box.min.z);axes.material.transparent=true;axes.material.opacity=.65;scene.add(axes);
}
function disposeMesh(mesh){if(!mesh)return;scene.remove(mesh);mesh.geometry.boundsTree=null;mesh.geometry.dispose();}
function displayBase(){if(patchMesh){patchMesh.visible=$('show-patches').checked;$('patches-label').hidden=false;}if(resultMesh){disposeMesh(resultMesh);resultMesh=null;}if(baseMesh)baseMesh.visible=true;}
function showCut(data){displayBase();if(patchMesh){patchMesh.visible=false;$('patches-label').hidden=true;}baseMesh.visible=false;resultMesh=new THREE.Mesh(attachTree(data),modelMaterial);scene.add(resultMesh);state.displayed=data;updateSection();}
function updateSection(){
  modelMaterial.clippingPlanes=state.section?[clipPlane]:[];
  if(patchMesh){patchMesh.material.clippingPlanes=modelMaterial.clippingPlanes;patchMesh.material.needsUpdate=true;}
  const box=baseMesh?.geometry.boundingBox;if(box)clipPlane.constant=box.min.x+(box.max.x-box.min.x)*Number($('section-range').value)/100;
  modelMaterial.needsUpdate=true;$('section-control').hidden=!state.section;$('section').classList.toggle('active',state.section);$('section').setAttribute('aria-pressed',state.section);
}
function params(){const p={};for(const key of fields)p[key]=$ (key).value===''?NaN:Number($(key).value);return p;}
function validParams(){validateCavity({...params(),point:[0,0,0],normal:[0,0,1]});}
function updateDimensions(){
  const p=params(),d=cavityDimensions(p);
  $('diagram-diameter').textContent=Number.isFinite(p.diameter)?fmt(p.diameter,1):'—';$('diagram-depth').textContent=Number.isFinite(p.thickness)?fmt(p.thickness,1):'—';
  $('result-diameter').textContent=Number.isFinite(d.diameter)?fmt(d.diameter):'—';$('result-depth').textContent=Number.isFinite(d.depth)?fmt(d.depth):'—';
}
function snapshot(){state.undo.push(JSON.stringify(state.cavities));if(state.undo.length>50)state.undo.shift();state.redo=[];}
function invalidateDownload(){if(exportURL){URL.revokeObjectURL(exportURL);exportURL=null;}$('download-again').hidden=true;}
function changed(){invalidateDownload();state.revision++;state.applied=-1;displayBase();renderCavities();makeMarkers();syncButtons();setStatus('Alterações pendentes · confira os cortes ou exporte o STL.');}
function history(redo=false){
  if(state.busy||state.placing)return;const from=redo?state.redo:state.undo,to=redo?state.undo:state.redo;if(!from.length)return;
  to.push(JSON.stringify(state.cavities));state.cavities=JSON.parse(from.pop());state.selected=null;changed();renderSettings();
}
function renderSettings(){
  const c=state.cavities.find(c=>c.id===state.selected);
  $('settings-title').textContent=c?`Cavidade ${state.cavities.indexOf(c)+1}`:'Seu ímã';
  $('settings-subtitle').textContent=c?'Ajuste as medidas deste encaixe.':'Defina as medidas e escolha um ponto na peça.';
  $('selected-actions').hidden=!c;
  if(c){fields.forEach(k=>$(k).value=c[k]);$('preset').value=['3,2','5,2','6,3','8,3','10,3'].includes(`${c.diameter},${c.thickness}`)?`${c.diameter},${c.thickness}`:'custom';}
  updateDimensions();
}
function renderCavities(){
  $('count').textContent=state.cavities.length;$('cavities').replaceChildren();
  if(!state.cavities.length){const e=document.createElement('div');e.className='cavity-empty';e.textContent='Ainda sem cavidades. Escolha as medidas do ímã para começar.';$('cavities').append(e);}
  state.cavities.forEach((c,i)=>{
    const button=document.createElement('button');button.className=`cavity-item ${c.id===state.selected?'active':''}`;button.disabled=state.busy;
    const d=cavityDimensions(c);button.innerHTML=`<i data-lucide="disc-3"></i><span><strong>Cavidade ${i+1}</strong><small>⌀ ${fmt(d.diameter)} × ${fmt(d.depth)} mm</small></span><span class="cavity-number">${String(i+1).padStart(2,'0')}</span>`;
    button.addEventListener('click',()=>{setPlacement(false);state.selected=c.id;renderCavities();renderSettings();makeMarkers();});$('cavities').append(button);
  });refreshIcons();
}
function marker(c,preview=false){
  const d=cavityDimensions(c),g=new THREE.Group(),n=new THREE.Vector3(...c.normal),p=new THREE.Vector3(...c.point);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(d.diameter/2,d.diameter/2,d.depth,64),new THREE.MeshBasicMaterial({color:preview?0xc3ffee:0x73e3be,transparent:true,opacity:preview?.38:.19,depthWrite:false,side:THREE.DoubleSide}));
  body.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),n);body.position.copy(p).addScaledVector(n,-d.depth/2);body.renderOrder=3;g.add(body);
  const ring=new THREE.Mesh(new THREE.RingGeometry(d.diameter/2*.92,d.diameter/2,64),new THREE.MeshBasicMaterial({color:c.id===state.selected||preview?0xd6fff0:0x83e7c7,side:THREE.DoubleSide,transparent:true,opacity:.95,depthTest:false,depthWrite:false}));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);ring.position.copy(p).addScaledVector(n,.025);ring.renderOrder=4;g.add(ring);
  return g;
}
function disposeGroup(g){scene.remove(g);g.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});}
function makeMarkers(){markerGroups.forEach(disposeGroup);markerGroups=state.cavities.map(c=>{const g=marker(c);scene.add(g);return g;});}
function clearGhost(){if(ghost){disposeGroup(ghost);ghost=null;}hoverHit=null;}
function setPlacement(on,reposition=false){
  if(on){if(!state.meshValid){toast('Repare a malha antes de posicionar cavidades.',true);return;}try{validParams();}catch(e){toast(e.message,true);return;}state.section=false;updateSection();if(!reposition){state.selected=null;renderSettings();renderCavities();}}
  state.placing=on;state.reposition=on&&reposition;controls.enableRotate=!on;clearGhost();
  $('add').classList.toggle('active',on);$('view-mode').textContent=on?'POSICIONAR NA SUPERFÍCIE':'MODO DE INSPEÇÃO';
  $('hint').textContent=on?'Clique na peça para posicionar · Esc para sair · Botão direito para mover':'Arraste para girar · Scroll para aproximar · Botão direito para mover';
  renderer.domElement.style.cursor=on?'crosshair':'grab';syncButtons();
}
function hitAt(event){
  if(!baseMesh)return null;
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObject(baseMesh,false)[0];if(!hit)return null;
  const normal=hit.face.normal.clone().transformDirection(baseMesh.matrixWorld).normalize();
  // Reject inside/backface placement: don't silently invert the geometry's normal.
  if(normal.dot(raycaster.ray.direction)>=0)return null;
  return {point:hit.point.toArray(),normal:normal.toArray()};
}
renderer.domElement.addEventListener('pointermove',e=>{
  if(!state.placing||state.busy)return;clearGhost();const hit=hitAt(e);if(!hit)return;
  try{const c={...params(),...hit};validateCavity(c);ghost=marker(c,true);scene.add(ghost);hoverHit=hit;}catch{}
});
renderer.domElement.addEventListener('pointerleave',clearGhost);
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,button:e.button};});
renderer.domElement.addEventListener('pointerup',e=>{
  if(!state.placing||state.busy||!down||down.button!==0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
  const hit=hitAt(e);if(!hit){toast('Escolha uma superfície externa da peça.');return;}
  try{validParams();}catch(err){toast(err.message,true);return;}
  if(!state.reposition&&state.cavities.length>=LIMITS.cavities){toast('O limite desta versão é 100 cavidades.',true);return;}
  snapshot();let id;
  if(state.reposition){const c=state.cavities.find(c=>c.id===state.selected);Object.assign(c,hit);id=c.id;}
  else{id=crypto.randomUUID();state.cavities.push({id,...params(),...hit});}
  state.selected=id;setPlacement(false);changed();renderSettings();toast('Cavidade posicionada. Você pode ajustar as medidas ou conferir o corte.');
});
function syncButtons(){
  for(const el of document.querySelectorAll('button,input,select'))if(!el.closest('dialog')&&el.id!=='help')el.disabled=state.busy;
  for(const id of ['add','apply','export','reposition'])$(id).disabled=state.busy||!baseMesh||!state.alive||!state.meshValid;
  $('repair').disabled=state.busy||!baseMesh||!state.alive||state.meshValid;
  $('undo').disabled=state.busy||!state.undo.length||state.placing;$('redo').disabled=state.busy||!state.redo.length||state.placing;
}
function updateRepairPanel(data){
  state.meshValid=data.valid;state.repairReport=data.repairReport||null;
  $('mesh-state').textContent=data.valid?(data.repairReport?'Malha reparada':'Malha fechada'):'Malha com defeitos';
  $('mesh-state').classList.toggle('invalid',!data.valid);
  $('repair-panel').hidden=data.valid&&!data.repairReport;
  $('repair-options').hidden=data.valid;$('repair-result').hidden=!data.repairReport;
  $('patches-label').hidden=!data.patchPositions?.length;$('show-patches').checked=true;
  if(patchMesh){scene.remove(patchMesh);patchMesh.geometry.dispose();patchMesh.material.dispose();patchMesh=null;}
  if(data.patchPositions?.length){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.patchPositions,3));
    const material=new THREE.MeshBasicMaterial({color:0xffbf75,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    patchMesh=new THREE.Mesh(g,material);patchMesh.renderOrder=2;scene.add(patchMesh);
  }
  if(data.repairReport){
    const r=data.repairReport;$('repair-description').textContent='Reparo aplicado à cópia. Confira a peça antes de criar os encaixes.';
    const items=r.method==='advanced'
      ? ['Reparo avançado aplicado',`${r.holesFilled} contorno(s) fechado(s)`,`${r.verticesSplit} conexão(ões) separada(s)`,`${r.changedFaces} face(s) nova(s) ou reconstruída(s)`,`${r.removedFaces} face(s) original(is) substituída(s) ou removida(s)`,`Desvio amostrado: ${fmt(r.maxSampledSurfaceDistance,4)} mm`]
      : [`${r.verticesWelded} vértice(s) unido(s)`,`${r.duplicatesRemoved} face(s) duplicada(s) removida(s)`,`${r.degenerateRemoved} face(s) sem área removida(s)`,`${r.facesReoriented} face(s) reorientada(s)`,`${r.holesFilled} buraco(s) fechado(s)`];
    $('repair-result').replaceChildren(...items.map(text=>{const p=document.createElement('div');p.textContent=text;return p;}));
  }else{
    const d=data.diagnostics;$('repair-description').textContent=d?`${d.boundaryEdges} borda(s) aberta(s) e ${d.nonManifoldEdges} aresta(s) com faces em excesso. Tente corrigir a malha para liberar os encaixes.`:'Tente corrigir a malha para liberar os encaixes.';
  }
}
function acceptModel(data,name,fitView=true){
  setPlacement(false);displayBase();disposeMesh(baseMesh);baseMesh=new THREE.Mesh(attachTree(data),modelMaterial);scene.add(baseMesh);
  invalidateDownload();state.original=data;state.size=data.size;state.name=name;state.cavities=[];state.selected=null;state.undo=[];state.redo=[];state.revision++;state.applied=state.revision;
  $('filename').textContent=state.name;$('triangles').textContent=fmt(data.indices.length/3,0);$('dimensions').textContent=data.size.map(x=>fmt(x,1)).join(' × ')+' mm';
  updateRepairPanel(data);makeFloor();if(fitView)fit();makeMarkers();renderCavities();renderSettings();updateSection();
}
async function loadModel(type,file){
  if(file&&!file.name.toLowerCase().endsWith('.stl')){toast('Escolha um arquivo com extensão .stl.',true);return;}
  if(file&&file.size>LIMITS.bytes){toast('Nesta versão, o limite por arquivo é 200 MB.',true);return;}
  await busy(type==='demo'?'Preparando a demonstração…':'Lendo e validando o STL…',async()=>{
    let payload={},transfer=[];
    if(file){const buffer=await file.arrayBuffer();payload={buffer,scale:Number($('units').value)};transfer=[buffer];}
    const data=await request(type,payload,transfer);
    acceptModel(data,file?file.name:'suporte-demo.stl');$('demo-tag').hidden=!!file;
    if(data.valid)setStatus(`Modelo pronto · ${fmt(data.elapsed/1000,2)} s para preparar · selecione “Adicionar cavidade”.`);
    else{setStatus('Modelo aberto para inspeção · use “Reparar malha” para liberar os encaixes.');toast('O STL abriu para inspeção. Há defeitos: use “Reparar malha” no painel esquerdo.');}
  });
}
$('repair').onclick=()=>busy('Reparando a malha…',async()=>{
  const options=validateRepairOptions({weldTolerance:Number($('weld-tolerance').value),maxHoleSize:Number($('hole-limit').value),advancedRepair:$('advanced-repair').checked});
  const data=await request('repair',{options});acceptModel(data,state.name,false);
  setStatus(`Malha reparada em ${fmt(data.elapsed/1000,2)} s · confira as correções e adicione seus ímãs.`);
  toast('Reparo concluído. Você já pode criar cavidades ou exportar apenas o STL reparado.');
});
$('show-patches').onchange=()=>{if(patchMesh)patchMesh.visible=$('show-patches').checked;};
async function applyCuts(){
  validParams();setPlacement(false);
  const data=await request('cut',{cavities:state.cavities});showCut(data);state.applied=state.revision;
  const removed=state.original.volume-data.volume;
  setStatus(`Cortes calculados em ${fmt(data.elapsed/1000,2)} s · ${fmt(removed,1)} mm³ removidos.`);
  if(state.cavities.length&&removed<.0001)toast('As cavidades não removeram material. Confira as posições.',true);
  return data;
}
$('import').onclick=()=>$('file').click();$('file').onchange=e=>{if(e.target.files[0])loadModel('import',e.target.files[0]);e.target.value='';};
$('demo').onclick=()=>loadModel('demo');$('add').onclick=()=>setPlacement(!state.placing);$('reposition').onclick=()=>setPlacement(true,true);
$('delete').onclick=()=>{snapshot();state.cavities=state.cavities.filter(c=>c.id!==state.selected);state.selected=null;setPlacement(false);changed();renderSettings();};
$('apply').onclick=()=>busy('Calculando as cavidades…',applyCuts);
$('export').onclick=()=>busy('Preparando o STL com os encaixes…',async()=>{
  validParams();if(state.applied!==state.revision)await applyCuts();
  const {buffer}=await request('export');invalidateDownload();exportURL=URL.createObjectURL(new Blob([buffer],{type:'model/stl'}));const a=$('download-again');a.href=exportURL;a.download=state.name.replace(/\.stl$/i,'')+(state.cavities.length?'-imas.stl':state.repairReport?'-reparado.stl':'-exportado.stl');a.hidden=false;a.click();
  setStatus(`STL pronto · ${state.cavities.length} cavidade(s) · ${fmt(buffer.byteLength/1024/1024,2)} MB.`);toast('STL pronto. Se o download não começar, use “Baixar arquivo pronto”.');
});
for(const key of fields){
  let grouped=false;
  $(key).addEventListener('focus',()=>{grouped=false;});
  const edit=()=>{
    updateDimensions();$('preset').value='custom';
    try{validParams();}catch{return;}
    const c=state.cavities.find(c=>c.id===state.selected),p=params();
    if(c&&fields.some(k=>c[k]!==p[k])){
      if(!grouped){snapshot();grouped=true;}
      Object.assign(c,p);changed();
    }
    clearGhost();
  };
  $(key).addEventListener('input',edit);
  $(key).addEventListener('change',edit);
}
$('preset').onchange=()=>{
  if($('preset').value==='custom')return;const [d,t]=$('preset').value.split(',');$('diameter').value=d;$('thickness').value=t;updateDimensions();
  const c=state.cavities.find(c=>c.id===state.selected);if(c){snapshot();Object.assign(c,params());changed();}clearGhost();
};
$('fit').onclick=()=>fit();$('top-view').onclick=()=>fit(true);
$('wireframe').onclick=()=>{state.wireframe=!state.wireframe;modelMaterial.wireframe=state.wireframe;$('wireframe').classList.toggle('active',state.wireframe);$('wireframe').setAttribute('aria-pressed',state.wireframe);};
$('section').onclick=()=>{setPlacement(false);state.section=!state.section;updateSection();};$('section-range').oninput=updateSection;
$('undo').onclick=()=>history();$('redo').onclick=()=>history(true);$('help').onclick=()=>$('help-dialog').showModal();
window.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea')||$('help-dialog').open||state.busy)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}
  else if(e.key==='Escape')setPlacement(false);
  else if(e.key.toLowerCase()==='a'&&!e.ctrlKey&&!e.metaKey&&baseMesh){e.preventDefault();setPlacement(!state.placing);}
  else if(e.key.toLowerCase()==='f')fit();
});
let dragDepth=0;
window.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('dragleave',()=>{dragDepth--;if(dragDepth<=0)$('drop-overlay').hidden=true;});
window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;if(e.dataTransfer.files[0]&&!state.busy)loadModel('import',e.dataTransfer.files[0]);});
window.addEventListener('beforeunload',e=>{if(state.cavities.length){e.preventDefault();e.returnValue='';}});
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();
refreshIcons();renderCavities();updateDimensions();initializeWorker();loadModel('demo');
