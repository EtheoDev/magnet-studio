import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SurfaceSelection } from './surface-selection.js';
import {smoothSelectionBrush,vertexFaceIndex} from './straighten-brush.js';
import { surfaceBrush } from './paint-brush.js';
import { lassoMask } from './manual-selection.js';
import { saveProject } from './project-file.js';
import {selectionSurface} from './selection-surface.js';
import {subsetMesh} from './split-tools.js';
import {toGeometry} from './geometry.js';

const $ = id => document.getElementById(id);
const number = (id, label, value, min, max, step = .1) => `<label>${label}<input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
const xyz = (prefix, label, values, min = -100000, max = 100000) => `<fieldset><legend>${label}</legend><div class="paint-triple">${values.map((v, i) => number(`${prefix}-${i}`, ['X', 'Y', 'Z'][i], v, min, max)).join('')}</div></fieldset>`;
const vector = prefix => [0, 1, 2].map(i => $(''+prefix+'-'+i).value === '' ? NaN : Number($(prefix+'-'+i).value));
const value = id => $(id).value === '' ? NaN : Number($(id).value);
const format = n => n.toLocaleString('pt-BR', {maximumFractionDigits: 3});

export function initPaintWorkflow(api) {
  const { scene, camera, renderer, controls, request, busy, toast, setStatus, state, getMesh, attachTree, displayBase, setPlacement } = api;
  const panel = document.createElement('section'); panel.id = 'paint-panel'; panel.hidden = true;
  panel.innerHTML = `
    <div class="settings-heading"><span class="eyebrow">INSPECTOR</span><h2 id="inspector-title">Seleção & corte</h2><p id="inspector-subtitle">Escolha uma região. Refine só o que precisar.</p></div>
    <nav class="inspector-tabs" aria-label="Configurações"><button data-inspector="select" class="active">Selecionar</button><button data-inspector="connect">Encaixes</button><button data-inspector="export">Saída</button></nav>
    <section class="inspector-section" data-inspector-section="select">
    <details open><summary>1. Selecionar a parte</summary>
      <button id="part-select" class="button secondary" aria-pressed="true">Selecionar no modelo</button>
      <label>Seleção por clique<select id="selection-mode"><option value="color">Cor / região do arquivo</option><option value="geometry">Sugestão pela geometria</option></select></label>
      <label class="toggle-label"><input id="color-connected" type="checkbox" checked> Só a região conectada ao clique</label>
      <div id="geometry-settings"><label>Tipo de detalhe<select id="part-kind"><option value="auto">Automático</option><option value="arm">Braço / perna</option><option value="hand">Mão / pé</option><option value="head">Cabeça</option><option value="eye">Olho / detalhe pequeno</option></select></label></div>
      <p id="part-hint" role="status">Clique no modelo. A seleção alcança também o verso da parte.</p>
      <div id="part-preview-controls" hidden>
        <label>Menos área ↔ mais área <span id="part-extent-value"></span><input id="part-extent" type="range" min="0" max="100" step="0.1" value="25"></label>
        <div class="paint-actions"><button id="part-accept" class="button primary">Usar esta parte</button><button id="part-cancel" class="button secondary">Cancelar</button></div>
      </div>
      <p>Confira a proposta girando o modelo. Ajuste o alcance antes de confirmar.</p>
    </details>
    <details id="paint-retouch"><summary>Retoque da seleção</summary>
      <button id="paint-straighten" class="button secondary">Suavizar seleção com pincel · S</button>
      ${number('paint-straighten-strength','Força da suavização (%)',50,1,100,5)}
      <p>Passe sobre a borda para suavizar a seleção mantendo suas curvas orgânicas. O pincel não desloca a superfície do modelo. Ctrl/Cmd Z desfaz a passada.</p>
      <div class="paint-actions"><button id="paint-add" class="button secondary" aria-pressed="false">Pintar</button><button id="paint-erase" class="button secondary" aria-pressed="false">Apagar</button><button id="paint-orbit" class="button secondary" aria-pressed="true">Girar</button></div>
      ${number('paint-radius', 'Raio do pincel (mm)', 5, .1, 100, .5)}
      <p>Arraste para pintar. Segure Alt para girar; Shift apaga. Apenas faces visíveis e conectadas ao ponto tocado são atingidas.</p>
      <div class="paint-actions"><button id="paint-undo" class="button secondary">Desfazer</button><button id="paint-redo" class="button secondary">Refazer</button><button id="paint-invert" class="button secondary">Inverter</button></div>
    </details>
    <div class="lasso-options"><label class="toggle-label"><input id="lasso-through" type="checkbox" checked> Incluir o verso no laço</label><small>Shift adiciona à seleção. Sem Shift, substitui.</small></div>
    <details id="plane-panel" hidden open><summary>Plano de corte</summary>
      <label>Eixo<select id="plane-axis"><option value="z">Z · horizontal</option><option value="x">X · lateral</option><option value="y">Y · frontal</option></select></label>
      <label>Posição <span id="plane-position-label">50%</span><input id="plane-position" type="range" min="1" max="99" value="50" step=".5"></label>
      <div class="paint-pair">${number('plane-tilt-x','Inclinação X (°)',0,-180,180,1)}${number('plane-tilt-y','Inclinação Y (°)',0,-180,180,1)}</div>
      <button id="plane-flip" class="button secondary">Inverter lado da região</button>
      <button id="plane-cut" class="button primary">Cortar com este plano</button>
      <p>O plano corta a geometria e fecha ambas as peças. As coordenadas de montagem são preservadas.</p>
    </details>
    <details open><summary>2. Conferir o contorno</summary>
      <label><input id="paint-contour-auto" type="checkbox"> Arredondamento adicional do contorno do corte</label>
      ${number('paint-contour-radius','Suavização geométrica (mm)',.35,.01,10,.05)}
      <p>A linha amarela mostra o corte suavizado na superfície. Raios maiores arredondam mais e podem remover detalhes pequenos. Aplicado ao fechamento simples.</p>
      <button id="paint-inspect" class="button secondary">Conferir seleção completa</button><p id="paint-diagnostics" role="status">Gire o modelo para conferir toda a circunferência.</p>
      <details><summary>Ajustar a seleção por triângulos (opcional)</summary>
      ${number('paint-smoothing', 'Passadas sobre os triângulos', 2, 1, 20, 1)}
      <button id="paint-smooth" class="button secondary">Prévia da suavização</button>
      <div id="paint-smooth-actions" class="paint-actions" hidden><button id="paint-smooth-accept" class="button primary">Aceitar</button><button id="paint-smooth-cancel" class="button secondary">Cancelar</button></div>
      <p>A prévia ajusta as faces da fronteira. O assentamento refina a faixa interna sem mover a superfície externa.</p>
      </details>
    </details>
    <details open><summary>Fechamento da seleção</summary>
      <label><input id="seat-auto" type="checkbox" checked> Calcular direção de saída pela região</label>
      ${xyz('seat-direction', 'Direção de saída da região pintada', [0, 0, 1], -10000, 10000)}
      <button id="seat-camera" class="button secondary">Usar direção da câmera</button>
      <p>Separar seleção mantém a superfície de cada lado da borda exibida, sem profundidade ou ressalto adicional.</p>
      <button id="paint-separate" class="button primary">Separar seleção</button>
      <details><summary>Recorte e assentamento avançados</summary>
      <label>Superfície interna<select id="seat-method"><option value="patch">Fechamento simples</option><option value="seat">Assentamento com ressalto</option></select></label>
      <label><input id="seat-clean" type="checkbox" checked> Corrigir microfragmentos da seleção</label>
      <p>A correção ajusta apenas triângulos isolados muito pequenos. Você pode desfazer a alteração.</p>
      <label>Fechamento<select id="patch-closure"><option value="boundary">Separar parte pela borda selecionada</option><option value="depth">Recorte com profundidade</option></select></label>
      ${number('patch-depth','Profundidade do recorte (mm)',1,.05,100,.1)}
      <div class="paint-pair">${number('seat-width', 'Faixa (mm)', 1, .05, 100)}${number('seat-depth', 'Profundidade (mm)', 1, 0, 100)}</div>
      <label><input id="seat-male" type="checkbox" checked> Ressalto na região pintada</label>
      ${number('seat-refinement', 'Refinamento da faixa', 4, 1, 12, 1)}
      ${number('seat-gap', 'Folga de assentamento (mm)', .1, 0, 5, .05)}
      <button id="paint-advanced-separate" class="button secondary">Preparar recorte / assentamento avançado</button>
      <label><input id="paint-transition" type="checkbox" checked> Destacar faixa interna em laranja</label>
      </details>
    </details>
    </section><section class="inspector-section" data-inspector-section="connect" hidden>
    <p class="inspector-note">Separe a região ou faça um corte por plano. Depois adicione o encaixe à superfície interna.</p>
    <details open><summary>Chave mecânica</summary>
      <label>Forma<select id="key-shape"><option value="round">Pino redondo</option><option value="rectangular">Chave retangular</option><option value="tapered">Chave com entrada afunilada</option></select></label>
      <div class="paint-pair">${number('key-width', 'Diâmetro / largura (mm)', 4, .2, 100)}${number('key-height', 'Altura retangular (mm)', 3, .2, 100)}${number('key-length', 'Comprimento (mm)', 4, .2, 100)}${number('key-anchor', 'Base embutida (mm)', 2, .2, 100)}</div>
      <button id="key-place" class="button secondary">Posicionar sobre o assentamento</button>
      <div class="paint-actions"><button id="key-move" class="button secondary">Mover livremente</button><button id="key-rotate" class="button secondary">Girar livremente</button></div>
      ${xyz('key-position', 'Posição na montagem (mm)', [0, 0, 0])}${xyz('key-rotation', 'Rotação local (graus)', [0, 0, 0], -360, 360)}
      <label><input id="key-male" type="checkbox" checked> Macho na região pintada</label>
      <label>Perfil inicial<select id="key-profile"><option value="resin">Resina</option><option value="filament">Filamento</option><option value="custom">Personalizado</option></select></label>
      <div class="paint-pair">${number('key-lateral', 'Lateral por lado (mm)', .15, 0, 5, .05)}${number('key-bottom', 'Fundo (mm)', .2, 0, 5, .05)}</div>
      ${number('key-wall', 'Parede mínima (mm)', 1, .1, 20, .1)}
      <p>Valores iniciais ajustáveis. Calibre com sua impressora e material. A folga lateral é uma distância por lado.</p>
      <button id="key-apply" class="button primary">Aplicar e verificar chave</button><button id="key-remove" class="button secondary">Remover chave</button>
    </details>
    </section><section class="inspector-section" data-inspector-section="export" hidden>
    <details open><summary>Visualização e exportação</summary>
      <label>Visualização<select id="paint-view"><option value="original">Região original</option><option value="separated">Peças separadas</option><option value="assembly">Montagem</option></select></label>
      <label>Afastamento só na prévia (mm)<input id="paint-explode" type="range" min="0" max="100" value="20"></label>
      <p id="paint-report" role="status">Prepare as peças para verificar fechamento, ilhas, espessura e passagem.</p>
      <button id="paint-export-all" class="button primary">Baixar todas as peças · ZIP</button>
      <button id="paint-export-selected" class="button secondary">Região selecionada · STL</button><button id="paint-export-remaining" class="button secondary">Restante do modelo · STL</button>
      <p>A escala e a posição de montagem são preservadas nos arquivos. O afastamento acima não altera o STL.</p>
    </details></section>`;
  document.querySelector('.right-panel').append(panel);
  const tools=[['select','Região','1','M4 3l13 8-6 1-3 6z'],['lasso','Laço','2','M16 15c3-1 5-4 4-7C18 2 6 2 3 7c-3 6 6 11 12 8M15 15l3 5'],['edge','Borda','B','M4 5h5m-5 7h8m-8 7h5M18 3v18m-3-12l3-3 3 3'],['add','Pincel','4','M4 20c3 0 5-2 5-5l10-10-3-3L6 12c-3 0-4 5-2 8z'],['erase','Apagar','5','M3 14l9-11 9 8-8 10H8zM8 9l9 8'],['plane','Plano','3','M3 7l12-4 6 13-12 5zM3 12h18'],['orbit','Girar','Esc','M5 9a8 8 0 0113-3l2 3M20 4v5h-5M19 15a8 8 0 01-13 3l-2-3M4 20v-5h5']];
  tools.splice(2,0,['straighten','Suavizar','S','M3 17L21 7M4 7l4 3m8 4l4 3']);
  const toolbar=document.createElement('div');toolbar.className='selection-toolbar';toolbar.innerHTML=tools.map(([name,label,key,path])=>`<button data-selection-tool="${name}" title="${label} (${key})" aria-label="${label}" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg><span>${label}</span></button>`).join('');$('viewport').append(toolbar);
  const actionBar=document.createElement('div');actionBar.className='canvas-actions';actionBar.innerHTML='<span id="canvas-selection-count">Escolha uma região para começar</span><button id="quick-split" class="button primary">Separar seleção <kbd>Space</kbd></button>';$('viewport').append(actionBar);
  const hover=document.createElement('div');hover.id='region-hover';hover.hidden=true;$('viewport').append(hover);
  const lassoSVG=document.createElementNS('http://www.w3.org/2000/svg','svg');lassoSVG.id='lasso-overlay';const lassoPath=document.createElementNS('http://www.w3.org/2000/svg','path');lassoSVG.append(lassoPath);$('viewport').append(lassoSVG);
  const planeHelper=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x5793ff,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}));scene.add(planeHelper);planeHelper.visible=false;
  let active = false, tool = 'select', selection, topology, original, overlay, boundary, cursor, smoothPreview, partPreview, partDown;
  let revision = 0, preparedRevision = -1, keyDirty = false, report, reference, parts = [], transition, placingKey = false, stroke = false, lastPointer, preparing = false;
  let slots, slotFaces, drawCount = 0, gizmoUpdating = false,regionCounts,lassoPoints=null,lassoAdd=false,strokeErase=false,planeSign=1,currentStage='select';
  let fieldOverlay,fieldIncidence;
  const gizmo = new TransformControls(camera, renderer.domElement); gizmo.setSpace('local');
  const gizmoHelper = gizmo.getHelper(); scene.add(gizmoHelper);
  const keyMarker = new THREE.Group(); scene.add(keyMarker); keyMarker.visible = false;
  const keyAxes = new THREE.AxesHelper(8); keyMarker.add(keyAxes);
  gizmo.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
  gizmo.addEventListener('objectChange', () => {
    if (gizmoUpdating || !reference) return;
    const q = keyMarker.quaternion.clone().premultiply(keyBasis().invert()), euler = new THREE.Euler().setFromQuaternion(q, 'ZYX');
    keyMarker.position.toArray().forEach((x, i) => $('key-position-'+i).value = x.toFixed(3));
    [euler.x, euler.y, euler.z].forEach((x, i) => $('key-rotation-'+i).value = THREE.MathUtils.radToDeg(x).toFixed(3));
    keyDirty = true; sync();
  });
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0x86efd0, side: THREE.DoubleSide, transparent: true, opacity: .65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  function remove(object) { if (!object) return; scene.remove(object); object.geometry?.dispose(); if (object.material && object.material !== selectedMaterial) object.material.dispose(); }
  function clearParts() { parts.forEach(remove); parts = []; remove(transition); transition = null; report = null; reference = null; preparedRevision = -1; gizmo.detach(); keyMarker.visible = false; }
  function updateFaces(faces, mask = selection.mask) {
    if (!overlay) return;
    const index = overlay.geometry.index,renderIndices=getMesh().geometry.index.array;
    for (const f of faces) {
      if (mask[f] && slots[f] < 0) {
        const slot = drawCount++; slots[f] = slot; slotFaces[slot] = f;
        index.array.set(renderIndices.subarray(f * 3, f * 3 + 3), slot * 3); index.addUpdateRange(slot * 3, 3);
        if(regionCounts)regionCounts[original.faceRegions[f]]++;
      } else if (!mask[f] && slots[f] >= 0) {
        const slot = slots[f], lastFace = slotFaces[--drawCount]; slots[f] = -1;
        if(regionCounts)regionCounts[original.faceRegions[f]]--;
        if (slot !== drawCount) {
          slots[lastFace] = slot; slotFaces[slot] = lastFace;
          index.array.set(renderIndices.subarray(lastFace * 3, lastFace * 3 + 3), slot * 3); index.addUpdateRange(slot * 3, 3);
        }
      }
    }
    index.needsUpdate = true; overlay.geometry.setDrawRange(0, drawCount * 3);
    $('paint-count').textContent = `${format(drawCount)} de ${format(selection.mask.length)} faces selecionadas${smoothPreview || partPreview ? ' · prévia' : ''}.`;
    $('canvas-selection-count').textContent=drawCount?`${format(drawCount)} faces · ${partPreview||smoothPreview?'prévia':'seleção pronta'}`:'Escolha uma região para começar';updateRegionRows();
    refreshFieldOverlay(faces);
  }
  function refreshFieldOverlay(faces){
    if(!selection?.field||partPreview||smoothPreview){if(fieldOverlay)fieldOverlay.visible=false;if(overlay)overlay.visible=active&&$('paint-view').value==='original';return;}
    const surface=selectionSurface(original,selection.mask,selection.field),geometry=toGeometry(subsetMesh(surface.data,surface.mask,true));
    if(!fieldOverlay){fieldOverlay=new THREE.Mesh(geometry,selectedMaterial.clone());fieldOverlay.renderOrder=2;fieldOverlay.frustumCulled=false;scene.add(fieldOverlay);}
    else{fieldOverlay.geometry.dispose();fieldOverlay.geometry=geometry;}
    fieldOverlay.visible=active&&$('paint-view').value==='original';if(overlay)overlay.visible=false;
  }
  function setStage(stage){
    currentStage=stage;
    for(const element of panel.querySelectorAll('[data-inspector-section]'))element.hidden=element.dataset.inspectorSection!==stage;
    for(const button of document.querySelectorAll('[data-inspector],[data-studio-stage]'))button.classList.toggle('active',(button.dataset.inspector??button.dataset.studioStage)===stage);
    $('inspector-title').textContent={select:'Seleção & corte',connect:'Encaixes',export:'Peças & saída'}[stage];
    $('inspector-subtitle').textContent={select:'Escolha uma região. Refine só o que precisar.',connect:'Chaves, folgas e lados de montagem.',export:'Confira as peças antes de imprimir.'}[stage];
  }
  for(const button of document.querySelectorAll('[data-inspector],[data-studio-stage]'))button.onclick=()=>{if(!active){busy('Abrindo o estúdio…',async()=>{await activate();setStage(button.dataset.inspector??button.dataset.studioStage);});}else setStage(button.dataset.inspector??button.dataset.studioStage);};
  $('top-export').onclick=()=>{if(active)setStage('export');else $('export').click();};
  function renderRegions(){
    regionCounts=original.faceRegions?new Int32Array(original.palette.length):null;$('region-total').textContent=original.palette?.length??0;$('color-regions').replaceChildren();
    if(!original.palette){const empty=document.createElement('p');empty.className='regions-empty';empty.textContent='Este arquivo não possui regiões de cor. Selecione com laço, plano ou pela geometria.';$('color-regions').append(empty);return;}
    for(const region of original.palette){
      const button=document.createElement('button');button.className='region-item';button.dataset.region=region.id;button.setAttribute('aria-pressed','false');button.style.setProperty('--swatch',region.color);
      const dot=document.createElement('span');dot.className='region-swatch';const text=document.createElement('span');text.className='region-text';const name=document.createElement('strong');name.textContent=region.name;const meta=document.createElement('small');meta.textContent=`${region.color.toUpperCase()} · ${format(region.faces)} faces`;text.append(name,meta);const checked=document.createElement('span');checked.className='region-check';checked.textContent='+';button.append(dot,text,checked);button.onclick=()=>selectColor(region.id);$('color-regions').append(button);
    }
  }
  function updateRegionRows(){
    if(!regionCounts)return;
    for(const button of $('color-regions').querySelectorAll('[data-region]')){const r=Number(button.dataset.region),count=regionCounts[r],full=count===original.palette[r].faces;button.classList.toggle('selected',count>0);button.setAttribute('aria-pressed',full?'true':'false');button.querySelector('.region-check').textContent=full?'✓':count?'−':'+';}
  }
  function commitMask(mask,add=false){
    if(add){mask=mask.slice();for(let f=0;f<mask.length;f++)mask[f]|=selection.mask[f];}
    selection.clearField();selection.replace(mask);refreshOverlay(mask);invalidate();inspect(false);sync();
  }
  async function selectColor(region,seed){
    if(!selection||state.busy||partPreview||smoothPreview)return;
    return busy('Selecionando a região de cor…',async()=>{
      const {mask}=await request('selectColor',{region,seed});let selected=true;for(let f=0;f<mask.length;f++)if(mask[f]&&!selection.mask[f]){selected=false;break;}
      const next=selection.mask.slice();for(let f=0;f<mask.length;f++)if(mask[f])next[f]=selected?0:1;commitMask(next);
      setStatus(`${original.palette[region].name} ${selected?'removida da seleção':'selecionada'} · retoque a borda ou separe a região.`);
    });
  }
  function planeParameters(){
    const axis=$('plane-axis').value,normal=new THREE.Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[axis]));normal.applyEuler(new THREE.Euler(THREE.MathUtils.degToRad(value('plane-tilt-x')),THREE.MathUtils.degToRad(value('plane-tilt-y')),0)).multiplyScalar(planeSign);return {direction:normal.toArray(),percent:value('plane-position')};
  }
  function updatePlane(){
    if(!original||tool!=='plane'){planeHelper.visible=false;return;}
    const {direction,percent}=planeParameters(),n=new THREE.Vector3(...direction);let min=Infinity,max=-Infinity;const p=new THREE.Vector3();for(let i=0;i<original.positions.length;i+=3){const h=p.fromArray(original.positions,i).dot(n);min=Math.min(min,h);max=Math.max(max,h);}
    const center=getMesh().geometry.boundingBox.getCenter(new THREE.Vector3()),height=min+(max-min)*percent/100;
    planeHelper.position.copy(center).addScaledVector(n,height-center.dot(n));planeHelper.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);planeHelper.scale.setScalar(Math.max(...state.size)*1.55);planeHelper.visible=active;
    $('plane-position-label').textContent=`${format(percent)}%`;
  }
  function refreshOverlay(mask) { const changed = []; for (let f = 0; f < mask.length; f++) if (!!mask[f] !== (slots[f] >= 0)) changed.push(f); updateFaces(changed, mask);refreshFieldOverlay(); }
  function invalidate() {
    revision++; preparedRevision = -1; keyDirty = false; clearParts();
    $('paint-report').textContent = 'Seleção ou parâmetros alterados. Prepare as peças novamente.';
    $('paint-view').value = 'original'; showView(); sync();
  }
  function reset(data) {
    finishStroke(); clearParts(); remove(overlay); remove(boundary); remove(cursor);remove(fieldOverlay);fieldOverlay=null;fieldIncidence=null;
    original = data; selection = null; topology = null; overlay = null; boundary = null; cursor = null; smoothPreview = null; partPreview = null; partDown = null; revision++; tool = 'select';
    planeHelper.visible=false;lassoPoints=null;lassoPath.setAttribute('d','');hover.hidden=true;renderRegions();$('selection-mode').value=data.palette?.length>1?'color':'geometry';updateSelectionMode();
    $('paint-view').value = 'original'; $('paint-diagnostics').textContent = 'Gire o modelo para conferir toda a circunferência.';
    $('paint-report').textContent = 'Prepare as peças para verificar fechamento, ilhas, espessura e passagem.';
    $('paint-count').textContent = 'Nenhuma parte selecionada.'; $('paint-smooth-actions').hidden = true;
    $('part-preview-controls').hidden=true;$('part-hint').textContent='Clique no modelo. A seleção alcança também o verso da parte.';
    // Lazy topology preparation avoids charging the magnet workflow for paint data.
    if (active) { active = false; setMode(false); }setStage('select');sync();
  }
  async function prepare() {
    if (selection) return true;
    if (preparing || !state.meshValid) return false;
    preparing = true;
    try {
      const packet = await request('paintPrepare'); topology = packet.neighbors; selection = new SurfaceSelection(packet.faces,original.positions.length/3);
      slots = new Int32Array(packet.faces).fill(-1); slotFaces = new Uint32Array(packet.faces);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', getMesh().geometry.attributes.position);
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(original.indices.length), 1).setUsage(THREE.DynamicDrawUsage)); g.setDrawRange(0, 0);
      overlay = new THREE.Mesh(g, selectedMaterial); overlay.renderOrder = 2; overlay.frustumCulled = false; scene.add(overlay); drawCount = 0;
      cursor = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({color:0xcaffed, wireframe:true, transparent:true, opacity:.35, depthWrite:false})); cursor.visible = false; scene.add(cursor);
      return true;
    } finally { preparing = false; }
  }
  function setMode(on) {
    if (on && (!state.meshValid || !selection)) return;
    if (on) { setPlacement(false); state.section = false; api.updateSection(); }
    active = on; if(!on)setPlacement(false); panel.hidden = !on; $('magnet-settings').hidden = on;
    toolbar.hidden=!on;actionBar.hidden=!on;if(!on){planeHelper.visible=false;hover.hidden=true;}
    document.querySelector('.cavities-section').hidden = on; $('paint-summary').hidden = !on;
    $('mode-paint').setAttribute('aria-pressed', on); $('mode-magnets').setAttribute('aria-pressed', !on);
    if (overlay) overlay.visible = on; if (boundary) boundary.visible = on; if (cursor) cursor.visible = false;
    setTool(on && !selection.count ? 'select' : 'orbit'); showView(); sync();
  }
  function setTool(next) {
    finishStroke(); tool = next; placingKey = false; gizmo.detach(); keyMarker.visible = false;
    partDown=null;if(cursor)cursor.visible=false;
    hover.hidden=true;lassoPoints=null;lassoPath.setAttribute('d','');$('plane-panel').hidden=next!=='plane';planeHelper.visible=next==='plane'&&active;
    for(const button of toolbar.querySelectorAll('button'))button.setAttribute('aria-pressed',button.dataset.selectionTool===next);
    for (const t of ['add','erase','orbit','straighten']) $('paint-'+t).setAttribute('aria-pressed', t === next);
    if(next==='straighten')$('paint-retouch').open=true;
    $('part-select').setAttribute('aria-pressed', next === 'select');
    controls.enabled = true;
    if (active) {
      $('view-mode').textContent = {select:'SELECIONAR REGIÕES',orbit:'INSPECIONAR',lasso:'SELEÇÃO POR LAÇO',plane:'CORTE POR PLANO',edge:'AJUSTAR BORDA',straighten:'SUAVIZAR SELEÇÃO COM PINCEL',add:'ADICIONAR À SELEÇÃO',erase:'REMOVER DA SELEÇÃO'}[next];
      $('hint').textContent = next==='straighten'?'Passe sobre a borda para suavizar · Ajuste o raio no painel · Alt gira · Ctrl/Cmd Z desfaz':next==='lasso'?'Contorne a área · Shift adiciona · Alt gira':next==='edge'?'Arraste perto da borda · Botão direito remove · Alt gira':next==='plane'?'Ajuste o plano no painel · Space corta':next==='select'?'Clique numa região · Arraste para girar · Shift permite retoques adicionais':'Alt + arrastar para girar · Shift apaga · Scroll aproxima';
    }
    if (next !== 'orbit') { $('paint-view').value = 'original'; showView(); }
    if(next!=='orbit')setStage('select');updatePlane();sync();
  }
  function sync() {
    const unavailable = state.busy || !state.alive || !state.meshValid;
    $('mode-paint').disabled = unavailable; $('mode-magnets').disabled = state.busy;
    for (const el of panel.querySelectorAll('button,input,select')) el.disabled = unavailable;
    $('key-height').disabled ||= $('key-shape').value === 'round';
    const preview = !!smoothPreview || !!partPreview;
    for (const id of ['paint-add','paint-erase','paint-straighten','paint-invert','paint-smooth','paint-separate','paint-advanced-separate','paint-undo','paint-redo']) $(id).disabled = unavailable || preview || !selection;
    $('paint-undo').disabled ||= !selection?.undoStack.length; $('paint-redo').disabled ||= !selection?.redoStack.length;
    $('part-select').disabled=unavailable||!!smoothPreview||!selection;
    $('part-accept').disabled=unavailable||!partPreview;$('part-cancel').disabled=unavailable||!partPreview;
    $('part-kind').disabled=unavailable||!!smoothPreview;
    const prepared = !preview && preparedRevision === revision && parts.length === 2;
    for (const id of ['key-place','key-move','key-rotate','key-apply']) $(id).disabled = unavailable || !prepared||report?.canKey===false;
    $('key-remove').disabled=unavailable||!prepared;
    for (const side of ['selected','remaining']) $('paint-export-'+side).disabled = unavailable || !prepared || keyDirty || report?.path.status !== 'clear';
    $('paint-export-all').disabled=$('paint-export-selected').disabled;
    $('quick-split').disabled=unavailable||preview||tool!=='plane'&&!selection?.count;
    $('quick-split').innerHTML=tool==='plane'?'Cortar com plano <kbd>Space</kbd>':'Separar seleção <kbd>Space</kbd>';
    $('plane-cut').disabled=unavailable||preview||!original;
    $('selection-clear').disabled=unavailable||preview||!selection?.count;
    $('project-save').disabled=unavailable||!selection||preview;
    for(const button of toolbar.querySelectorAll('button'))button.disabled=unavailable||preview;
    for(const button of $('color-regions').querySelectorAll('button'))button.disabled=unavailable||preview;
    $('paint-separate').disabled ||= !selection?.count;
    if (active) { $('undo').disabled = $('paint-undo').disabled; $('redo').disabled = $('paint-redo').disabled; }
  }
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  function cast(event, meshes = [getMesh()]) {
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    return ray.intersectObjects(meshes.filter(Boolean), false)[0];
  }
  function brushAt(event, apply) {
    if (!selection || smoothPreview || partPreview || !['add','erase','edge','straighten'].includes(tool)) return;
    const mesh = getMesh(), hit = cast(event), radius = value('paint-radius');
    if (!hit || !Number.isFinite(radius) || radius < .1 || radius > 100 || hit.face.normal.dot(ray.ray.direction) >= 0) { cursor.visible = false; return; }
    cursor.visible = true; cursor.position.copy(hit.point); cursor.scale.setScalar(radius);
    if (!apply) return;
    const faces = surfaceBrush(mesh, camera, hit, radius, topology);
    if(tool==='straighten'){
      fieldIncidence??=vertexFaceIndex(original);
      const inverse=mesh.matrixWorld.clone().invert(),right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).transformDirection(inverse),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1).transformDirection(inverse),local=mesh.worldToLocal(hit.point.clone());
      const change=smoothSelectionBrush(original,selection.mask,selection.field,faces,local.toArray(),right.toArray(),up.toArray(),radius,value('paint-straighten-strength')/100,fieldIncidence);if(!change)return;
      selection.paintField(change.vertices,change.levels,change.faces);
      for(const f of change.faces){let level=0;for(let j=0;j<3;j++){const v=selection.field[original.indices[f*3+j]];level+=Number.isFinite(v)?v:selection.mask[f]?1:-1;}selection.paint([f],level>=0);}
      $('paint-contour-auto').checked=false;$('seat-method').value='patch';showSeatOptions();updateFaces(change.faces);return;
    }
    if(tool==='edge'&&!faces.some(f=>[0,1,2].some(j=>topology[f*3+j]>=0&&selection.mask[f]!==selection.mask[topology[f*3+j]])))return;
    updateFaces(selection.paint(faces, (tool==='add'||tool==='edge')&&!event.shiftKey&&!strokeErase));
    if(selection.field){const ids=Uint32Array.from(new Set(faces.flatMap(f=>[0,1,2].map(j=>original.indices[f*3+j])))),sign=(tool==='add'||tool==='edge')&&!event.shiftKey&&!strokeErase?1:-1;selection.paintField(ids,new Float32Array(ids.length).fill(sign),faces);refreshFieldOverlay();}
  }
  function finishStroke() {
    if (!stroke) return; stroke = false; lastPointer = null; controls.enabled = true;
    const delta = selection.commit();
    if (delta.length) { invalidate(); inspect(false); }
    sync();
  }
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', e => {
    if (!active || state.busy || e.button !== 0&&!(tool==='edge'&&e.button===2) || e.altKey || smoothPreview) return;
    if(tool==='select') {partDown={x:e.clientX,y:e.clientY};return;}
    if(tool==='plane')return;
    if(tool==='lasso'){
      if(partPreview)return;e.stopImmediatePropagation();e.preventDefault();controls.enabled=false;canvas.setPointerCapture(e.pointerId);lassoPoints=[];lassoAdd=e.shiftKey;recordLasso(e);return;
    }
    if (placingKey) {
      const hit = cast(e, parts); if (!hit) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const point = hit.point.clone().sub(hit.object.position);
      const x=point.dot(new THREE.Vector3(...reference.u)), y=point.dot(new THREE.Vector3(...reference.v)), z=point.dot(new THREE.Vector3(...reference.n));
      const onSupport=reference.rings.some(r=>{
        let inside=false;for(let i=0,j=r.inner.length-1;i<r.inner.length;j=i++){const a=r.inner[i],b=r.inner[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}
        return inside && Math.min(Math.abs(z-r.height),Math.abs(z-r.height+reference.options.seatingGap))<.02;
      });
      if(!onSupport){toast('Clique na área de apoio plana, dentro da faixa laranja. Gire as peças para revelar a superfície.');return;}
      point.toArray().forEach((x,i) => $('key-position-'+i).value = x.toFixed(3));
      placingKey = false; keyDirty = true; $('paint-view').value='assembly';showView();updateKeyMarker(); gizmo.attach(keyMarker); sync(); return;
    }
    if (tool === 'orbit') return;
    e.stopImmediatePropagation(); e.preventDefault(); controls.enabled = false; stroke = true;strokeErase=e.button===2; selection.begin(); canvas.setPointerCapture(e.pointerId); lastPointer = {x:e.clientX,y:e.clientY}; brushAt(e, true);
  }, true);
  canvas.addEventListener('pointerup',e=>{
    const start=partDown;partDown=null;
    if(!start||!active||state.busy||tool!=='select'||e.button!==0||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;
    const hit=cast(e);if(!hit)return;
    if(original.faceRegions&&$('selection-mode').value==='color')selectColor(original.faceRegions[hit.faceIndex],$('color-connected').checked?hit.faceIndex:undefined);
    else previewPart({seed:hit.faceIndex});
  },true);
  canvas.addEventListener('pointercancel',()=>{partDown=null;},true);
  canvas.addEventListener('pointermove', e => {
    if (!active || state.busy || e.altKey) return;
    if(lassoPoints){e.stopImmediatePropagation();e.preventDefault();recordLasso(e);return;}
    if(tool==='select'){
      const hit=cast(e);hover.hidden=!hit;
      if(hit){const region=original.palette?.[original.faceRegions?.[hit.faceIndex]];hover.textContent=region?`${region.name} · clique para selecionar`:'Clique para sugerir uma região';const box=$('viewport').getBoundingClientRect();hover.style.left=`${e.clientX-box.left+16}px`;hover.style.top=`${e.clientY-box.top+16}px`;}return;
    }
    if (stroke) {
      e.stopImmediatePropagation(); e.preventDefault();
      const distance = lastPointer ? Math.hypot(e.clientX-lastPointer.x,e.clientY-lastPointer.y) : 0;
      const steps = Math.max(1, Math.ceil(distance / 5)), start = lastPointer || {x:e.clientX,y:e.clientY};
      for(let i=1;i<=steps;i++) brushAt({clientX:start.x+(e.clientX-start.x)*i/steps,clientY:start.y+(e.clientY-start.y)*i/steps,shiftKey:e.shiftKey},true);
      lastPointer = {x:e.clientX,y:e.clientY};
    } else brushAt(e, false);
  }, true);
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, e => {
    if(lassoPoints){const points=lassoPoints;lassoPoints=null;lassoPath.setAttribute('d','');controls.enabled=true;e.stopImmediatePropagation();if(type==='pointerup'&&points.length>=3)busy('Selecionando a área do laço…',async()=>{await new Promise(requestAnimationFrame);const visibility=new THREE.Raycaster();visibility.firstHitOnly=true;const mask=lassoMask(getMesh(),camera,points,$('lasso-through').checked,visibility);commitMask(mask,lassoAdd);setStatus('Área selecionada pelo laço. Retoque a borda ou separe.');});return;}
    if (stroke) { e.stopImmediatePropagation(); finishStroke(); }
  }, true);
  canvas.addEventListener('contextmenu',e=>{if(active&&tool==='edge')e.preventDefault();});
  canvas.addEventListener('pointerleave', () => { if (cursor) cursor.visible = false;hover.hidden=true; });
  function recordLasso(event){
    const rect=canvas.getBoundingClientRect(),p={x:(event.clientX-rect.left)/rect.width*2-1,y:-(event.clientY-rect.top)/rect.height*2+1};lassoPoints.push(p);
    lassoSVG.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);lassoPath.setAttribute('d',lassoPoints.map((p,i)=>`${i?'L':'M'}${(p.x+1)*rect.width/2},${(1-p.y)*rect.height/2}`).join(' ')+' Z');
  }
  window.addEventListener('blur', finishStroke);
  async function inspect(showBusy = true) {
    if (!selection) return;
    const version = revision;
    const run = async () => {
      const d = await request('paintInspect', {mask:partPreview?.mask || smoothPreview || selection.mask,options:{selectionField:partPreview||smoothPreview?null:selection.field,contourRadius:0},clean:false});
      if (version !== revision) return;
      remove(boundary);
      const points = d.smoothedBoundary??new Float32Array(d.edges.length * 6);
      if(!d.smoothedBoundary)d.edges.forEach(([a,b],i) => { points.set(original.positions.subarray(a*3,a*3+3),i*6); points.set(original.positions.subarray(b*3,b*3+3),i*6+3); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(points,3));
      boundary = new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xffd17c,depthTest:false,transparent:true,opacity:.9})); boundary.renderOrder = 3; scene.add(boundary); showView();
      $('paint-diagnostics').textContent = d.brushBoundary?'Borda ajustada com pincel. A área verde mostra a seleção contínua; o corte usa esse mesmo contorno.':d.smoothedBoundary?`${d.smoothedContours} contorno(s) suavizado(s) · raio ${format(d.contourRadius)} mm. O corte usará esta curva, atravessando os triângulos da pintura.`:`${d.loops.length} contorno(s) · ${d.selectedComponents} região(ões) selecionada(s). ${d.openEdges||d.ambiguousEdges?`A geometria tem ${d.openEdges} arestas abertas e ${d.ambiguousEdges} não manifold.`:d.ambiguousVertices?'Há encontros na seleção. Ative a suavização geométrica para resolver o contorno.':'Malha fechada. Confira o contorno.'}`;
    };
    if (showBusy) return busy('Conferindo o contorno…', run);
    try { await run(); } catch(e) { toast(e.message,true); }
  }
  function showView() {
    const view = $('paint-view').value, showParts = active && parts.length === 2 && view !== 'original';
    if (active) displayBase();
    if (getMesh()) getMesh().visible = !showParts;
    const fieldVisible=selection?.field&&!partPreview&&!smoothPreview;
    if (overlay) overlay.visible = active && !showParts&&!fieldVisible;
    if(fieldOverlay)fieldOverlay.visible=active&&!showParts&&!!fieldVisible;
    if (boundary) boundary.visible = active && !showParts;
    const distance = view === 'separated' ? value('paint-explode') : 0;
    parts.forEach((mesh, i) => { mesh.visible = showParts; mesh.position.set(0,0,0); if (reference && i === 0) mesh.position.fromArray(reference.n).multiplyScalar(distance); });
    if (transition) { transition.visible = showParts && $('paint-transition').checked; transition.position.copy(parts[0].position); }
    if (!showParts || view === 'separated') { gizmo.detach(); keyMarker.visible = false; }
    if(showParts)planeHelper.visible=false;
  }
  function acceptParts(packet) {
    const ref = packet.reference || reference, band = packet.transition;
    clearParts(); reference = ref; report = packet.report; preparedRevision = revision; keyDirty = false;
    parts = [packet.selected,packet.remaining].map((data,i) => {
      const mesh = new THREE.Mesh(attachTree(data),new THREE.MeshStandardMaterial({color:i===0?0x8bdcc3:0xa8b9d0,metalness:.12,roughness:.5,side:THREE.DoubleSide})); scene.add(mesh); return mesh;
    });
    if (band) { const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(band,3)); transition = new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xffb765,side:THREE.DoubleSide,transparent:true,opacity:.65,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2})); scene.add(transition); }
    const path = report.path;
    $('paint-report').textContent = `Peças fechadas e orientadas. Componentes: ${report.components.join(' / ')}. Volumes: ${report.volumes.map(format).join(' / ')} mm³. Interseção: ${format(report.overlap)} mm³. Exterior preservado. ${report.contourRadius?`Contorno geométrico suavizado: ${format(report.contourRadius)} mm. `:''}${report.key ? `Parede verificada: ${format(report.key.minimumWall)} mm. ` : ''}${report.method==='independent'?'Objetos já independentes: separação sem tampa nova.':path.status === 'clear' ? `Passagem livre por ${format(path.travel)} mm na direção escolhida.` : path.status === 'blocked' ? `Passagem bloqueada a ${format(path.collision.distance)} mm. Ajuste a direção ou o encaixe.` : 'Verificação de passagem inconclusiva; exportação bloqueada. Simplifique a malha.'}`;
    $('paint-view').value = 'separated'; showView();setStage('export');sync();
    if(!report.key)suggestKeyPosition();
  }
  function suggestKeyPosition(){if(!reference?.rings?.length)return;const ring=reference.rings[0],p=reference.n.map((x,k)=>reference.u[k]*ring.center[0]+reference.v[k]*ring.center[1]+x*ring.height);p.forEach((x,i)=>$('key-position-'+i).value=x.toFixed(3));$('key-male').checked=$('seat-male').checked;}
  function seatOptions() { return {method:$('seat-method').value,patchClosure:$('patch-closure').value,selectionField:selection?.field,autoDirection:$('seat-auto').checked,contourRadius:$('paint-contour-auto').checked&&$('seat-method').value==='patch'&&$('patch-closure').value==='depth'?value('paint-contour-radius'):0,patchDepth:value('patch-depth'),width:value('seat-width'),depth:value('seat-depth'),seatingGap:value('seat-gap'),direction:vector('seat-direction'),maleSelected:$('seat-male').checked,refinement:value('seat-refinement')}; }
  function keyOptions() { return {shape:$('key-shape').value,width:value('key-width'),height:value('key-height'),length:value('key-length'),anchor:value('key-anchor'),lateral:value('key-lateral'),bottom:value('key-bottom'),wall:value('key-wall'),point:vector('key-position'),rotation:vector('key-rotation'),maleSelected:$('key-male').checked}; }
  function keyBasis() {
    const sign = $('key-male').checked ? -1 : 1;
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...reference.u),new THREE.Vector3(...reference.v).multiplyScalar(sign),new THREE.Vector3(...reference.n).multiplyScalar(sign)));
  }
  function updateKeyMarker() {
    if (!reference) return;
    gizmoUpdating = true;
    keyMarker.position.fromArray(vector('key-position'));
    const rot = vector('key-rotation').map(THREE.MathUtils.degToRad);
    keyMarker.quaternion.copy(keyBasis()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot,'ZYX')));
    while(keyMarker.children.length>1) { const child=keyMarker.children[1]; keyMarker.remove(child); child.geometry.dispose(); child.material.dispose(); }
    const options=keyOptions(), width=options.width, height=options.height, length=options.length+options.anchor;
    if ([width,height,length].every(x=>Number.isFinite(x)&&x>0)) {
      let geometry;
      if(options.shape==='round') {geometry=new THREE.CylinderGeometry(width/2,width/2,length,48);geometry.rotateX(Math.PI/2);}
      else if(options.shape==='tapered') {
        const taper=Math.min(width,height)*.15, positions=[], indices=[];
        for(const [z,w,h] of [[-options.anchor,width,height],[0,width,height],[options.length,width-2*taper,height-2*taper]]) for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]])positions.push(x*w/2,y*h/2,z-(options.length-options.anchor)/2);
        for(let level=0;level<2;level++)for(let i=0;i<4;i++){const j=(i+1)%4,a=level*4+i,b=level*4+j,c=(level+1)*4+j,d=(level+1)*4+i;indices.push(a,b,c,a,c,d);}
        indices.push(0,2,1,0,3,2,8,9,10,8,10,11);geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
      } else geometry=new THREE.BoxGeometry(width,height,length);
      geometry.translate(0,0,(options.length-options.anchor)/2);
      keyMarker.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffcf8a,wireframe:true,depthTest:false,transparent:true,opacity:.8})));
    }
    keyMarker.visible = true; gizmoUpdating = false;
  }
  async function previewPart(options={}) {
    const version=revision;
    return busy('Selecionando a parte, incluindo o verso…',async()=>{
      const packet=await request('selectPart',{kind:$('part-kind').value,...options});
      if(version!==revision)return;
      partPreview=packet;refreshOverlay(packet.mask);$('paint-view').value='original';showView();
      $('part-preview-controls').hidden=false;$('part-extent').max=Math.max(packet.maximum,.1);$('part-extent').value=packet.radius;
      $('part-extent-value').textContent=`${format(packet.radius)} mm`;
      $('part-hint').textContent=packet.isolated?'Parte independente selecionada por completo. Confira e confirme.':packet.neckFound?'Encontramos um estreitamento para sugerir a borda. Ajuste a área se necessário.':'Ajuste a área até cobrir a parte desejada. Depois confirme e retoque com o pincel.';
      await inspect(false);sync();
    });
  }
  function cancelPart(){partPreview=null;$('part-preview-controls').hidden=true;refreshOverlay(selection.mask);inspect(false);sync();}
  $('part-select').onclick=()=>setTool('select');
  $('part-extent').oninput=()=>{$('part-extent-value').textContent=`${format(value('part-extent'))} mm`;};
  $('part-extent').onchange=()=>previewPart({extent:value('part-extent')});
  $('part-kind').onchange=()=>{if(partPreview)previewPart();};
  $('part-cancel').onclick=cancelPart;
  $('part-accept').onclick=()=>{
    const {mask,direction,method}=partPreview;partPreview=null;selection.clearField();selection.replace(mask);refreshOverlay(mask);$('part-preview-controls').hidden=true;
    if(method==='neck-section')direction.forEach((x,i)=>$('seat-direction-'+i).value=x.toFixed(4));
    invalidate();inspect(false);setTool('orbit');setStatus('Parte selecionada. Use “Corrigir com pincel” se precisar ajustar a borda.');
  };
  function history(redo = false) { if (!active || state.busy || smoothPreview || partPreview || !selection) return; finishStroke(); const delta = selection.history(redo); if(delta.length){updateFaces(delta);refreshFieldOverlay();invalidate();inspect(false);} sync(); }
  $('mode-paint').onclick = () => busy('Preparando seleção por faces…',async()=>{if(await prepare())setMode(true);});
  $('mode-magnets').onclick = () => setMode(false);
  for (const t of ['add','erase','orbit']) $('paint-'+t).onclick = () => setTool(t);
  $('paint-inspect').onclick = () => inspect();
  $('paint-undo').onclick = () => history(); $('paint-redo').onclick = () => history(true);
  $('paint-invert').onclick = () => {selection.clearField();updateFaces(selection.invert());refreshFieldOverlay();invalidate();inspect(false);};
  $('paint-smooth').onclick = () => busy('Calculando prévia do contorno…',async()=>{
    setTool('orbit'); const packet = await request('paintSmooth',{mask:selection.mask,intensity:value('paint-smoothing')}); smoothPreview = packet.mask;
    refreshOverlay(smoothPreview); $('paint-smooth-actions').hidden = false; await inspect(false); sync();
  });
  function cancelSmooth() { smoothPreview = null; refreshOverlay(selection.mask); $('paint-smooth-actions').hidden = true; inspect(false); sync(); }
  $('paint-smooth-cancel').onclick = cancelSmooth;
  $('paint-smooth-accept').onclick = () => { const mask=smoothPreview; smoothPreview=null;selection.clearField(); selection.replace(mask); refreshOverlay(mask); $('paint-smooth-actions').hidden=true; invalidate(); inspect(false); };
  for (const el of panel.querySelectorAll('[id^="seat-"]')) if (el.matches('input')) el.addEventListener('input',invalidate);
  $('patch-depth').addEventListener('input',invalidate);
  $('patch-closure').addEventListener('change',()=>{showSeatOptions();invalidate();inspect(false);});
  let contourTimer;
  for(const id of ['paint-contour-auto','paint-contour-radius','seat-auto'])$(id).addEventListener('input',()=>{invalidate();clearTimeout(contourTimer);contourTimer=setTimeout(()=>inspect(false),200);});
  for(const el of panel.querySelectorAll('[id^="seat-direction-"]'))el.addEventListener('input',()=>{$('seat-auto').checked=false;});
  $('seat-camera').onclick = () => {$('seat-auto').checked=false;camera.position.clone().sub(controls.target).normalize().toArray().forEach((x,i)=>$('seat-direction-'+i).value=x.toFixed(4));invalidate();};
  $('paint-separate').onclick = () => busy('Fechando a região e verificando passagem…',async()=>{
    setTool('orbit');
    const prepared=await request('paintPrepareSelection',{mask:selection.mask,clean:false});
    if($('seat-auto').checked&&prepared.direction)prepared.direction.forEach((x,i)=>$('seat-direction-'+i).value=x.toPrecision(10));
    const packet=await request('cutSelection',{mask:selection.mask,selectionField:selection.field,autoDirection:$('seat-auto').checked,direction:vector('seat-direction')});
    packet.report.selectionAdjusted=prepared.changed.length;acceptParts(packet);
    setStatus('Partes separadas pela seleção exibida. Confira a costura e o relatório de montagem.');
  });
  $('paint-advanced-separate').onclick=()=>busy('Preparando recorte ou assentamento avançado…',async()=>{
    setTool('orbit');const prep=await request('paintPrepareSelection',{mask:selection.mask,clean:false});
    if($('seat-auto').checked&&prep.direction)prep.direction.forEach((x,i)=>$('seat-direction-'+i).value=x.toPrecision(10));
    acceptParts(await request('paintSeparate',{mask:selection.mask,options:seatOptions()}));
  });
  for (const el of panel.querySelectorAll('[id^="key-"]')) if (el.matches('input,select') && el.id !== 'key-profile') el.addEventListener('input',()=>{ keyDirty=true; if(['key-lateral','key-bottom'].includes(el.id))$('key-profile').value='custom';updateKeyMarker();sync(); });
  $('key-profile').onchange = () => { const resin=$('key-profile').value==='resin'; if($('key-profile').value==='custom')return; $('key-lateral').value=resin?.15:.25; $('key-bottom').value=resin?.2:.3; keyDirty=true;sync(); };
  $('key-place').onclick = () => { setTool('orbit'); $('paint-view').value='separated';showView();placingKey=true;setStatus('Clique na superfície preparada. Use as setas ou os campos para ajustar a chave.'); };
  for(const [id,mode] of [['key-move','translate'],['key-rotate','rotate']]) $(id).onclick = () => { setTool('orbit');$('paint-view').value='assembly';showView();updateKeyMarker();gizmo.setMode(mode);gizmo.attach(keyMarker); };
  $('key-apply').onclick = () => busy('Aplicando chave, folgas e verificando montagem…',async()=>acceptParts(await request('paintKey',{key:keyOptions()})));
  $('key-remove').onclick = () => busy('Restaurando assentamento…',async()=>acceptParts(await request('paintClearKey')));
  $('paint-view').onchange = showView; $('paint-explode').oninput = showView; $('paint-transition').onchange = showView;
  for (const part of ['selected','remaining']) $('paint-export-'+part).onclick = () => busy('Exportando peça em coordenadas de montagem…',async()=>{
    if(preparedRevision!==revision||keyDirty)throw new Error('Confira as alterações antes de exportar.');
    const {buffer}=await request('paintExport',{part}), url=URL.createObjectURL(new Blob([buffer],{type:'model/stl'}));
    const a=document.createElement('a');a.href=url;a.download=state.name.replace(/\.(stl|lys)$/i,'')+(part==='selected'?'-regiao':'-restante')+'.stl';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    setStatus(`STL exportado · ${part==='selected'?'região pintada':'restante'} · escala e posição de montagem preservadas.`);
  });
  $('paint-demo').onclick=()=>api.loadPaintDemo();
  async function activate(){if(await prepare())setMode(true);}
  function updateSelectionMode(){const colored=$('selection-mode').value==='color';$('geometry-settings').hidden=colored;$('color-connected').closest('label').hidden=!colored;}
  $('selection-mode').onchange=updateSelectionMode;
  for(const button of toolbar.querySelectorAll('button'))button.onclick=()=>{setTool(button.dataset.selectionTool);if(['add','erase','edge','straighten'].includes(tool))$('paint-retouch').open=true;};
  $('paint-straighten').onclick=()=>{setTool('straighten');setStatus('Passe o pincel sobre a borda para suavizar. Ajuste raio e força; Ctrl/Cmd Z desfaz.');};
  $('selection-clear').onclick=()=>commitMask(new Uint8Array(selection.mask.length));
  $('quick-split').onclick=()=>tool==='plane'?$('plane-cut').click():$('paint-separate').click();
  for(const id of ['plane-axis','plane-position','plane-tilt-x','plane-tilt-y'])$(id).addEventListener('input',()=>{invalidate();updatePlane();});
  $('plane-flip').onclick=()=>{planeSign*=-1;invalidate();updatePlane();};
  $('plane-cut').onclick=()=>busy('Cortando e fechando as duas peças…',async()=>{const packet=await request('planeSplit',planeParameters());setTool('orbit');acceptParts(packet);setStatus('Corte por plano concluído. Confira as peças ou adicione um encaixe.');});
  function showSeatOptions(){const simple=$('seat-method').value==='patch';$('patch-closure').parentElement.hidden=!simple;$('patch-depth').parentElement.hidden=!simple||$('patch-closure').value!=='depth';$('seat-width').parentElement.parentElement.hidden=simple;$('seat-gap').parentElement.hidden=simple;$('seat-refinement').parentElement.hidden=simple;$('seat-male').parentElement.hidden=simple;}
  $('seat-method').onchange=()=>{$('seat-depth').value=$('seat-method').value==='patch'?0:1;showSeatOptions();invalidate();};$('seat-depth').value=0;showSeatOptions();
  $('paint-export-all').onclick=()=>busy('Preparando todas as peças…',async()=>{
    if(preparedRevision!==revision||keyDirty)throw new Error('Confira as alterações antes de exportar.');const {buffer}=await request('paintExportAll');download(buffer,'pecas.zip','application/zip');setStatus('ZIP pronto: duas peças STL nas coordenadas de montagem e relatório de verificação.');
  });
  function download(buffer,name,type){const url=URL.createObjectURL(new Blob([buffer],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  $('project-save').onclick=()=>{
    if(!selection||state.busy)return;const settings=Array.from(panel.querySelectorAll('input[id],select[id]')).map(el=>({id:el.id,value:el.value,checked:el.checked}));
    download(saveProject(original,selection.mask,state.name,settings,selection.field),state.name.replace(/\.[^.]+$/,'')+'.magnetlab','application/octet-stream');toast('Projeto salvo com cores, seleção e configurações. Importe o arquivo para continuar.');
  };
  function restore(project){
    if(project.mask.length!==selection.mask.length)throw new Error('A seleção salva não corresponde ao modelo.');
    for(const setting of project.settings){const el=panel.querySelector('#'+CSS.escape(setting.id));if(el?.matches('input,select')){el.value=String(setting.value);if(el.type==='checkbox')el.checked=!!setting.checked;}}
    updateSelectionMode();showSeatOptions();commitMask(project.mask);selection.field=project.selectionField??null;refreshFieldOverlay();inspect(false);setTool('select');
  }
  window.addEventListener('keydown',event=>{
    if(!active||state.busy||event.target.matches('input,select,textarea')||document.querySelector('dialog[open]')||event.ctrlKey||event.metaKey)return;
    const map={1:'select',2:'lasso',3:'plane',4:'add',5:'erase',b:'edge',s:'straighten'};
    if(map[event.key.toLowerCase()]&&!partPreview&&!smoothPreview){event.preventDefault();setTool(map[event.key.toLowerCase()]);}
    else if(event.code==='Space'){event.preventDefault();if(!$('quick-split').disabled)$('quick-split').click();}
  });
  toolbar.hidden=true;actionBar.hidden=true;
  return { reset, sync, history, activate,restore,get active(){return active;}, get dirty(){return !!selection?.count;},
    get bounds(){
      if(!active||!parts.some(mesh=>mesh.visible))return null;
      const box=new THREE.Box3();for(const mesh of parts)if(mesh.visible){mesh.updateMatrixWorld();box.expandByObject(mesh);}return box;
    },
    exit:()=>setMode(false), escape:()=>{if(smoothPreview)cancelSmooth();if(partPreview)cancelPart();setTool('orbit');}, showView };
}
