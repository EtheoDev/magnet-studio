import * as THREE from 'three';
import {cutFrame,toWorld,dot,localBounds,curvePoints,sampledCurve,curveHeight,FIT_PROFILES} from './organic.js';
import {toGeometry} from './geometry.js';

const $=id=>document.getElementById(id);
export function setupOrganic(h){
  const {state,scene,camera,controls,renderer,request,busy,toast,setStatus}=h;
  let active=false,drawing=false,placingJoint=false,points=[],joints=[],selected=-1,parts=[],line,marks=[],urls=[],valid=false,stroke=[],lastDown;
  $('organic-tools').innerHTML=`
    <div class="settings-heading"><span class="eyebrow">DIVIDIR E ENCAIXAR</span><h2>Cortes orgânicos</h2><p>Desenhe uma curva da esquerda para a direita, começando e terminando fora da peça.</p></div>
    <label class="cut-field">Vista de desenho<select id="cut-view"><option value="front">Frente · atravessar Y</option><option value="side">Lateral · atravessar X</option><option value="top">Topo · atravessar Z</option></select></label>
    <button id="cut-draw" class="button secondary">Desenhar curva</button>
    <div class="cut-inline"><button id="cut-undo" class="button quiet">Desfazer ponto</button><button id="cut-clear" class="button quiet">Limpar</button></div>
    <p id="cut-path-status" class="field-note" role="status">Nenhuma curva desenhada.</p>
    <label class="cut-field">Perfil de impressão<select id="cut-profile"><option value="resin">Resina · pino redondo</option><option value="filament">Filamento · encaixe profundo</option></select></label>
    <p class="field-note">Valores iniciais para peças impressas separadamente. Calibre com seu material e impressora.</p>
    <label class="cut-field">Folga entre as faces (mm)<input id="cut-gap" type="number" value="0.1" min="0" max="2" step="0.05"></label>
    <p class="field-note">Folga total na direção de montagem, dividida entre A e B.</p>
    <label class="cut-field">Tipo de encaixe<select id="cut-kind"><option value="round">Pino redondo integrado</option><option value="key">Encaixe profundo quadrado</option></select></label>
    <div class="cut-grid">
      <label>Largura / diâmetro (mm)<input id="cut-width" type="number" value="4" min="1" max="100" step="0.1"></label>
      <label>Profundidade (mm)<input id="cut-length" type="number" value="4" min="1" max="100" step="0.1"></label>
      <label>Folga por lado (mm)<input id="cut-clearance" type="number" value="0.15" min="0" max="2" step="0.05"></label>
      <label>Folga no fundo (mm)<input id="cut-bottom" type="number" value="0.3" min="0" max="5" step="0.05"></label>
      <label>Parede mínima (mm)<input id="cut-wall" type="number" value="1" min="0.5" max="10" step="0.1"></label>
    </div>
    <p id="cut-fit-info" class="field-note"></p>
    <button id="cut-add" class="button secondary">Adicionar encaixe</button>
    <label class="cut-field">Encaixe selecionado<select id="cut-joint"><option value="-1">Sem encaixes</option></select></label>
    <div id="cut-position" hidden>
      <label class="cut-field">Posição horizontal (mm)<input id="cut-u" type="number" value="0" step="0.1"></label>
      <label class="cut-field">Posição na espessura (mm)<input id="cut-w" type="number" value="0" step="0.1"></label>
      <button id="cut-remove" class="button danger">Remover este encaixe</button>
    </div>
    <p class="field-note">O pino fica na parte A; a parte B recebe o alojamento. O encaixe profundo usa seção quadrada. Ajuste as posições para manter material em volta.</p>
    <button id="cut-calculate" class="button primary">Conferir divisão</button>
    <p id="cut-report" class="cut-report" role="status"></p>
    <div id="cut-results" hidden>
      <button id="cut-place-joint" class="button secondary">Adicionar encaixe na face</button>
      <label class="cut-field">Separar prévia<input id="cut-explode" type="range" min="0" max="100" value="35"></label>
      <div class="cut-inline"><button id="cut-export-a" class="button secondary">Exportar A</button><button id="cut-export-b" class="button secondary">Exportar B</button></div>
      <div id="cut-downloads"></div>
    </div>
    <p class="field-note">O corte atravessa toda a espessura seguindo a vista escolhida. Saída em dois STLs, sem suportes de LYS. Curvas fechadas ou que voltam para trás ainda não são aceitas.</p>`;
  const dimensionFields=['width','length','clearance','bottom','wall'];
  const frame=()=>cutFrame($('cut-view').value);
  const bounds=()=>localBounds({min:h.base().geometry.boundingBox.min.toArray(),max:h.base().geometry.boundingBox.max.toArray()},frame());
  const params=()=>Object.fromEntries([['kind',$('cut-kind').value],...dimensionFields.map(k=>[k,$('cut-'+k).value===''?NaN:Number($('cut-'+k).value)])]);
  const removeObject=o=>{scene.remove(o);o.geometry?.dispose();o.material?.dispose();};
  function clearVisuals(){parts.forEach(removeObject);parts=[];if(line){removeObject(line);line=null;}marks.forEach(removeObject);marks=[];}
  function clearDownloads(){urls.forEach(URL.revokeObjectURL);urls=[];$('cut-downloads').replaceChildren();}
  function invalidate(){valid=false;clearDownloads();$('cut-results').hidden=true;$('cut-report').textContent='';parts.forEach(removeObject);parts=[];if(active){h.displayBase();h.hideMarkers();setStatus('Divisão pendente · confira o corte antes de exportar as partes.');}sync();}
  function sync(){
    for(const el of $('organic-tools').querySelectorAll('button,input,select'))el.disabled=state.busy||!state.meshValid||!state.alive;
    $('cut-calculate').disabled=state.busy||!state.meshValid||points.length<2;
    $('cut-undo').disabled=state.busy||!points.length;$('cut-add').disabled=state.busy||points.length<2;
    $('cut-export-a').disabled=$('cut-export-b').disabled=state.busy||!valid;
    if(active){$('undo').disabled=true;$('redo').disabled=true;$('section').disabled=true;}
    if(drawing){$('fit').disabled=true;$('top-view').disabled=true;}
  }
  function renderLine(){
    if(line)removeObject(line);line=null;marks.forEach(removeObject);marks=[];
    if(!active||!h.base())return;
    if(points.length>1){
      const b=bounds(),p=sampledCurve(points,points[0][0],points.at(-1)[0]);
      line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.map(p=>new THREE.Vector3(...toWorld(frame(),[...p,0])))),new THREE.LineBasicMaterial({color:0xffd394,depthTest:false,depthWrite:false}));line.renderOrder=10;scene.add(line);
      for(const [i,j] of joints.entries()){
        if(!Number.isFinite(j.u)||!Number.isFinite(j.w))continue;
        if(!Number.isFinite(j.width)||!Number.isFinite(j.length)||j.width<=0||j.length<=0)continue;
        const g=j.kind==='round'?new THREE.CylinderGeometry(j.width/2,j.width/2,j.length,32):new THREE.BoxGeometry(j.width,j.length,j.width);
        const mark=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:i===selected?0xffffff:0x7fe4c4,depthTest:false,transparent:true,opacity:.55}));
        mark.position.fromArray(toWorld(frame(),[j.u,curveHeight(points,j.u)+j.length/2,j.w]));mark.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...frame().v));mark.renderOrder=11;scene.add(mark);marks.push(mark);
      }
    }
    $('cut-path-status').textContent=points.length?`${points.length} pontos · curva atravessa a peça na direção da vista.`:'Nenhuma curva desenhada.';
  }
  function stopDrawing(){drawing=false;placingJoint=false;controls.enableRotate=true;controls.enablePan=true;controls.enableZoom=true;renderer.domElement.style.cursor='grab';$('cut-draw').textContent='Desenhar curva';$('cut-place-joint').textContent='Adicionar encaixe na face';if(active){$('view-mode').textContent='CORTES ORGÂNICOS';$('hint').textContent='Arraste para girar · Scroll para aproximar · Botão direito para mover';}h.syncButtons();}
  function align(){
    const b=bounds(),center=toWorld(frame(),b.min.map((x,k)=>(x+b.max[k])/2));
    const span=Math.max(b.max[1]-b.min[1],(b.max[0]-b.min[0])/camera.aspect),distance=span/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.4+(b.max[2]-b.min[2]);
    controls.target.fromArray(center);camera.up.fromArray(frame().v);camera.position.fromArray(center).addScaledVector(new THREE.Vector3(...frame().w),distance);camera.updateProjectionMatrix();controls.update();
  }
  function setMode(on){
    if(state.busy)return;active=on;h.setPlacement(false);stopDrawing();clearVisuals();valid=false;clearDownloads();$('cut-results').hidden=true;
    $('magnet-tools').hidden=on;$('organic-tools').hidden=!on;document.querySelector('.cavities-section').hidden=on;
    for(const [id,enabled] of [['mode-magnets',!on],['mode-organic',on]]){$(id).classList.toggle('active',enabled);$(id).setAttribute('aria-pressed',enabled);}
    h.displayBase();
    if(on){state.section=false;h.updateSection();h.hideMarkers();renderLine();setStatus('Cortes orgânicos · desenhe a curva, configure os encaixes e confira as duas partes.');}
    else{camera.up.set(0,0,1);h.fit();}
    h.syncButtons();sync();
  }
  function renderJoints(){
    const select=$('cut-joint');select.replaceChildren();
    if(!joints.length){select.add(new Option('Sem encaixes','-1'));selected=-1;}
    joints.forEach((j,i)=>select.add(new Option(`Encaixe ${i+1} · ${j.kind==='round'?'redondo':'profundo'}`,String(i))));select.value=String(selected);
    $('cut-position').hidden=selected<0;
    if(selected>=0){const j=joints[selected];$('cut-u').value=j.u;$('cut-w').value=j.w;$('cut-kind').value=j.kind;dimensionFields.forEach(k=>$('cut-'+k).value=j[k]);}
    fitInfo();renderLine();
  }
  function fitInfo(){const p=params();$('cut-fit-info').textContent=`Alojamento: ${(p.width+2*p.clearance).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} mm de largura. A folga lateral é aplicada em cada lado.`;}
  $('mode-magnets').onclick=()=>setMode(false);$('mode-organic').onclick=()=>setMode(true);
  $('cut-draw').onclick=()=>{if(drawing){stopDrawing();return;}invalidate();h.setPlacement(false);align();drawing=true;controls.enableRotate=false;controls.enablePan=false;controls.enableZoom=false;renderer.domElement.style.cursor='crosshair';$('cut-draw').textContent='Terminar desenho';$('view-mode').textContent='DESENHAR CORTE ORGÂNICO';$('hint').textContent='Arraste ou clique para desenhar · esquerda para direita · Esc para terminar';sync();toast('Arraste da esquerda para a direita, de fora a fora da peça. Ou clique para adicionar pontos.');};
  $('cut-view').onchange=()=>{points=[];joints=[];selected=-1;stopDrawing();invalidate();align();renderJoints();};
  $('cut-clear').onclick=()=>{points=[];joints=[];selected=-1;invalidate();renderJoints();};
  $('cut-undo').onclick=()=>{points.pop();invalidate();renderLine();};
  $('cut-profile').onchange=()=>{const p=FIT_PROFILES[$('cut-profile').value];$('cut-gap').value=p.gap;$('cut-kind').value=p.kind;dimensionFields.forEach(k=>$('cut-'+k).value=p[k]);if(selected>=0)Object.assign(joints[selected],p);invalidate();renderJoints();};
  function edit(){if(selected>=0)Object.assign(joints[selected],params());invalidate();fitInfo();renderLine();}
  $('cut-gap').oninput=()=>{invalidate();renderLine();};
  ['kind',...dimensionFields].forEach(k=>$('cut-'+k).oninput=edit);
  $('cut-add').onclick=()=>{const b=bounds();joints.push({...params(),u:(b.min[0]+b.max[0])/2,w:(b.min[2]+b.max[2])/2});selected=joints.length-1;invalidate();renderJoints();};
  $('cut-joint').onchange=()=>{selected=Number($('cut-joint').value);renderJoints();};
  for(const k of ['u','w'])$('cut-'+k).oninput=()=>{if(selected<0)return;joints[selected][k]=$('cut-'+k).value===''?NaN:Number($('cut-'+k).value);invalidate();renderLine();};
  $('cut-remove').onclick=()=>{joints.splice(selected,1);selected=joints.length-1;invalidate();renderJoints();};
  function planePoint(e){
    const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    const hit=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(...frame().w),0),new THREE.Vector3());
    return hit?[dot(hit.toArray(),frame().u),dot(hit.toArray(),frame().v)]:null;
  }
  renderer.domElement.addEventListener('pointerdown',e=>{if(placingJoint&&e.button===0){lastDown=[e.clientX,e.clientY];return;}if(!active||!drawing||state.busy||e.button!==0)return;lastDown=[e.clientX,e.clientY];stroke=[];const p=planePoint(e);if(p)stroke.push(p);renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener('pointermove',e=>{if(!lastDown||!drawing||!e.buttons)return;const p=planePoint(e);if(p&&(!stroke.length||Math.hypot(p[0]-stroke.at(-1)[0],p[1]-stroke.at(-1)[1])>.8)){stroke.push(p);try{const saved=points;points=curvePoints(stroke);renderLine();points=saved;}catch{/* Wait for a usable monotonic stroke. */}}});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!lastDown||!drawing||!active)return;
    const dragged=Math.hypot(e.clientX-lastDown[0],e.clientY-lastDown[1])>5;lastDown=null;
    const end=planePoint(e);if(!end)return;
    try{if(dragged){stroke.push(end);points=curvePoints(stroke.filter((p,i)=>!i||Math.abs(p[0]-stroke[i-1][0])>.0001));stopDrawing();}else{const next=[...points,end];points=next.length>1?curvePoints(next):next;}
      invalidate();renderLine();
    }catch(error){renderLine();toast(error.message,true);}
  });
  $('cut-place-joint').onclick=()=>{placingJoint=true;controls.enableRotate=false;renderer.domElement.style.cursor='crosshair';$('cut-place-joint').textContent='Clique na face exposta do corte';toast('Clique na face de corte para posicionar um novo encaixe. Esc cancela.');};
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!placingJoint||!valid||!lastDown||state.busy)return;
    const down=lastDown;lastDown=null;if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    const hit=ray.intersectObjects(parts,false)[0];if(!hit){toast('Clique na face exposta do corte.');return;}
    const point=hit.object.worldToLocal(hit.point.clone()).toArray(),u=dot(point,frame().u),w=dot(point,frame().w),v=dot(point,frame().v),gap=Number($('cut-gap').value);
    if(Math.abs(Math.abs(v-curveHeight(points,u))-gap/2)>.06){toast('Escolha a face criada pelo corte, dentro da borda da peça.');return;}
    joints.push({...params(),u:Number(u.toFixed(3)),w:Number(w.toFixed(3))});selected=joints.length-1;stopDrawing();invalidate();renderJoints();setStatus('Encaixe posicionado · confira a divisão novamente.');
  });
  window.addEventListener('keydown',e=>{if(active&&e.key==='Escape')stopDrawing();});
  function explode(){const b=bounds(),gap=(b.max[1]-b.min[1])*.65*Number($('cut-explode').value)/100;parts.forEach((part,i)=>part.position.fromArray(frame().v).multiplyScalar((i?1:-1)*gap));}
  $('cut-explode').oninput=explode;
  $('cut-calculate').onclick=()=>busy('Dividindo a peça e construindo os encaixes…',async()=>{
    stopDrawing();invalidate();if(state.applied!==state.revision)await h.applyCuts();
    const data=await request('split',{view:$('cut-view').value,points,joints,gap:$('cut-gap').value===''?NaN:Number($('cut-gap').value)});
    h.displayBase();h.base().visible=false;h.hideMarkers();if(line)line.visible=false;marks.forEach(m=>m.visible=false);
    parts=data.parts.map((data,i)=>{const mesh=new THREE.Mesh(toGeometry(data),new THREE.MeshStandardMaterial({color:i?0xf1c38a:0x8bcebe,roughness:.5,metalness:.05,flatShading:true}));scene.add(mesh);return mesh;});
    valid=true;$('cut-results').hidden=false;
    const r=data.report;$('cut-report').textContent=`Duas partes prontas · ${r.joints} encaixe(s). A: ${r.components[0]} volume(s) separado(s). B: ${r.components[1]} volume(s) separado(s).${r.components.some(n=>n>1)?' Atenção: há ilhas desconectadas; confira antes de imprimir.':''}`;
    explode();camera.up.set(0,0,1);h.fit();setStatus(`Divisão concluída em ${(data.elapsed/1000).toFixed(2)} s · exporte A e B separadamente.`);sync();
  });
  async function download(part){await busy('Preparando a parte em STL…',async()=>{if(!valid)throw new Error('Confira a divisão novamente.');const {buffer}=await request('exportSplit',{part});const url=URL.createObjectURL(new Blob([buffer],{type:'model/stl'}));urls.push(url);const a=document.createElement('a');a.href=url;a.download=state.name.replace(/\.(stl|lys)$/i,'')+`-parte-${part?'B':'A'}.stl`;a.textContent=`Baixar parte ${part?'B':'A'} novamente`;a.className='download-again';$('cut-downloads').append(a);a.click();setStatus('STL da parte pronto. As duas partes mantêm as coordenadas de montagem.');});}
  $('cut-export-a').onclick=()=>download(0);$('cut-export-b').onclick=()=>download(1);
  fitInfo();
  return {get active(){return active;},bounds(){if(!active||!parts.length)return null;const box=new THREE.Box3();parts.forEach(p=>box.expandByObject(p));return box;},sync,reset(){points=[];joints=[];selected=-1;stopDrawing();clearVisuals();invalidate();renderJoints();},invalidate(){invalidate();renderLine();}};
}
