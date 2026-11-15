import Module from 'manifold-3d';
import { buildTopology, selectionBoundary, smoothSelection } from './paint-selection.js';
import { separatePainted, applyPaintKey } from './paint-cut.js';
import { partDistances, proposePart } from './part-selection.js';
import { colorRegionMask } from './model-import.js';
import { splitPlane } from './split-tools.js';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import { MeshBVH } from 'three-mesh-bvh';
import { parseSTL, toManifold, fromManifold, cutWithReinforcement, binarySTL, toGeometry } from './geometry.js';
import { importLys, exportLysWithReport } from './lys.js';
import { cutLysCavities } from './lys-cavities.js';
import { diagnoseMesh } from './repair.js';
import { preparePaintSelection } from './paint-preparation.js';
import {smoothPaintContour,contourSurfaceLines} from './paint-contour.js';
import {selectionSurface} from './selection-surface.js';
import { repairSolid } from './repair-solid.js';
import repairWasmURL from 'meshfix-wasm/dist/meshfix-core.wasm?url';

let module, base, sourceData, offset=[0,0,0], result;
let paintData, paintTopology, prepared, keyed, partField;
let contourGeometry,contourTree;
function releasePair(pair){pair?.selected.delete();pair?.remaining.delete();}
function clearPaint(){releasePair(keyed);releasePair(prepared);keyed=null;prepared=null;}
function paintPacket(pair){
  return {selected:withBVH(fromManifold(pair.selected)),remaining:withBVH(fromManifold(pair.remaining)),report:pair.report,reference:pair.reference,transition:pair.transition,diagnostics:pair.diagnostics};
}
function requirePaint(){
  if(!base||!paintData)throw new Error('Importe ou repare uma malha fechada antes de pintar.');
  if(!paintTopology)paintTopology=buildTopology(paintData);
}

let lysProject=null,envelope=null;
function clearLys(){envelope?.delete();envelope=null;lysProject=null;}
let repairCore;
function loadRepairCore(){
  if(!repairCore)repairCore=import('meshfix-wasm/dist/meshfix-core.js')
    .then(({default:createCore})=>createCore({locateFile:()=>repairWasmURL}))
    .catch(error=>{repairCore=null;throw error;});
  return repairCore;
}
const ready=Module({locateFile:()=>wasmURL}).then(m=>{m.setup();module=m;});
function withBVH(data){
  const geometry=toGeometry(data);
  try{
    const tree=new MeshBVH(geometry,{maxLeafSize:10,indirect:!!data.faceRegions||!!data.preserveFaces});
    return {positions:new Float32Array(geometry.attributes.position.array),indices:new Uint32Array(geometry.index.array),bvh:MeshBVH.serialize(tree),...(data.faceRegions?{faceRegions:data.faceRegions,palette:data.palette}:{})};
  }finally{geometry.dispose();}
}
function releaseResult(){if(result&&result!==base)result.delete();result=null;}
function install(next,data,extra={}){
  let packet;
  try{packet=withBVH(next&&!data.faceRegions&&!data.preserveFaces?fromManifold(next):data);}catch(err){next?.delete();throw err;}
  releaseResult();clearPaint();contourGeometry?.dispose();contourGeometry=null;contourTree=null;paintData=packet;paintTopology=null;partField=null;base?.delete();base=next;offset=data.offset||[0,0,0];
  const box=next?.boundingBox(),size=box?box.max.map((v,k)=>v-box.min[k]):data.size;
  return {...packet,size,offset,volume:next?.volume()||0,valid:!!next,...extra};
}
self.onmessage=async({data:{id,type,payload}})=>{
  try{
    await ready;const start=performance.now();let response;
    if(type==='importLys'){
      const imported=await importLys(module,payload.buffer);
      try { response=install(imported.solid,imported.data,{lys:imported.info}); }
      catch(error){imported.envelope.delete();throw error;}
      clearLys();envelope=imported.envelope;lysProject=imported.project;sourceData=imported.data;
    }else if(type==='import'){
      const parsed=parseSTL(payload.buffer,payload.scale);let next=null,issue=null;
      try{next=toManifold(module,parsed);}catch(err){issue=err.message;}
      response=install(next,parsed,{diagnostics:next?null:diagnoseMesh(parsed),issue});sourceData=parsed;clearLys();
    }else if(type==='importScene'){
      const parsed=payload.data;let next=null,issue=null;
      try{next=toManifold(module,parsed);}catch(error){issue=error.message;}
      response=install(next,parsed,{diagnostics:next?null:diagnoseMesh(parsed),issue});sourceData=parsed;clearLys();
    }else if(type==='demo'){
      const a=module.Manifold.cube([64,44,12],true),b0=module.Manifold.cube([64,10,30],true),b=b0.translate([0,17,9]);
      const next=a.add(b);a.delete();b.delete();b0.delete();
      const data={...fromManifold(next),offset:[0,0,0]};response=install(next,data);sourceData=data;clearLys();
    }else if(type==='paintDemo'){
      const primitives=[];
      const ellipsoid=(scale,point)=>{const sphere=module.Manifold.sphere(1,64),scaled=sphere.scale(scale);sphere.delete();const moved=scaled.translate(point);scaled.delete();primitives.push(moved);};
      ellipsoid([13,8,20],[0,0,0]);ellipsoid([8,7,9],[0,0,26]);
      ellipsoid([5,5,18],[-15,0,0]);ellipsoid([5,5,18],[15,0,0]);
      ellipsoid([6,6,18],[-6,0,-27]);ellipsoid([6,6,18],[6,0,-27]);
      let next;
      try{next=module.Manifold.union(primitives);}finally{primitives.forEach(p=>p.delete());}
      const data={...fromManifold(next),offset:[0,0,0]};
      data.palette=[{name:'Corpo',color:'#71a7fa'},{name:'Cabeça',color:'#adc4fa'},{name:'Braço direito',color:'#f19a7a'},{name:'Braço esquerdo',color:'#75c6b5'},{name:'Perna direita',color:'#b299ec'},{name:'Perna esquerda',color:'#e4bb75'}].map((r,id)=>({...r,id,sourceColor:true,faces:0}));
      data.faceRegions=new Uint32Array(data.indices.length/3);
      for(let f=0;f<data.faceRegions.length;f++){const p=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)p[k]+=data.positions[data.indices[f*3+j]*3+k]/3;const region=p[2]>19?1:p[0]>12?2:p[0]<-12?3:p[2]<-17?(p[0]>0?4:5):0;data.faceRegions[f]=region;data.palette[region].faces++;}
      response=install(next,data);sourceData=data;clearLys();
    }else if(type==='repair'){
      if(!sourceData)throw new Error('Importe um STL para reparar.');
      const {repaired,solid:next}=await repairSolid(module,sourceData,payload.options,loadRepairCore);
      response=install(next,repaired,{repairReport:repaired.repairReport,patchPositions:repaired.patchPositions});
    }else if(type==='paintPrepare'){
      requirePaint();response={neighbors:paintTopology.neighbors,faces:paintTopology.faces};
    }else if(type==='paintInspect'){
      requirePaint();response=selectionBoundary(paintData,paintTopology,payload.mask);
      if(payload.options?.selectionField&&response.selectedFaces>0&&response.selectedFaces<paintTopology.faces){
        const surface=selectionSurface(paintData,payload.mask,payload.options.selectionField),boundary=selectionBoundary(surface.data,buildTopology(surface.data),surface.mask),lines=[];
        for(const edge of boundary.edges)for(const id of edge)for(let k=0;k<3;k++)lines.push(surface.data.positions[id*3+k]);
        response.smoothedBoundary=Float32Array.from(lines);response.smoothedContours=boundary.loops.length;response.contourRadius=0;response.brushBoundary=true;
      }else if(payload.options?.contourRadius>0&&response.selectedFaces>0&&response.selectedFaces<paintTopology.faces){
        const prep=preparePaintSelection(paintData,paintTopology,payload.mask,{clean:payload.clean??true}),direction=payload.options.autoDirection&&prep.direction?prep.direction:payload.options.direction;
        const contour=smoothPaintContour(module,paintData,paintTopology,prep.mask,{direction,radius:payload.options.contourRadius??0,selectionField:payload.options.selectionField});
        try{if(!contourTree){contourGeometry=toGeometry(paintData);contourTree=MeshBVH.deserialize(paintData.bvh,contourGeometry);}response.smoothedBoundary=contourSurfaceLines(contour,contourTree);response.smoothedContours=contour.polygons.length;response.contourRadius=contour.radius;response.brushBoundary=!!payload.options.selectionField;}finally{contour.section.delete();}
      }
    }else if(type==='selectPart'){
      requirePaint();
      if(payload.seed!==undefined)partField=partDistances(paintData,paintTopology,payload.seed);
      if(!partField)throw new Error('Clique em uma parte do modelo primeiro.');
      response=proposePart(partField,paintTopology.faces,payload.kind,payload.extent);
    }else if(type==='selectColor'){
      requirePaint();response={mask:colorRegionMask(paintData,paintTopology.neighbors,payload.region,payload.seed)};
    }else if(type==='paintSmooth'){
      requirePaint();response={mask:preparePaintSelection(paintData,paintTopology,smoothSelection(payload.mask,paintTopology.neighbors,payload.intensity)).mask};
    }else if(type==='paintPrepareSelection'){
      requirePaint();response=preparePaintSelection(paintData,paintTopology,payload.mask,{clean:payload.clean});
    }else if(type==='cutSelection'){
      requirePaint();
      const prep=preparePaintSelection(paintData,paintTopology,payload.mask,{clean:false});
      const direction=payload.autoDirection&&prep.direction?prep.direction:payload.direction;
      const next=separatePainted(module,base,paintData,paintTopology,payload.mask,{method:'patch',patchClosure:'boundary',contourRadius:0,selectionField:payload.selectionField,direction});
      try{response=paintPacket(next);}catch(error){releasePair(next);throw error;}
      clearPaint();prepared=next;
    }else if(type==='paintSeparate'){
      requirePaint();
      const next=separatePainted(module,base,paintData,paintTopology,payload.mask,payload.options);
      next.report.selectionAdjusted=payload.selectionAdjusted??0;
      try{response=paintPacket(next);}catch(error){releasePair(next);throw error;}
      clearPaint();prepared=next;
    }else if(type==='planeSplit'){
      requirePaint();const next=splitPlane(module,base,paintData,payload);
      try{response=paintPacket(next);}catch(error){releasePair(next);throw error;}
      clearPaint();prepared=next;
    }else if(type==='paintKey'){
      if(!prepared)throw new Error('Prepare o assentamento antes de criar a chave.');
      const next=applyPaintKey(module,prepared,payload.key);
      try{response={...paintPacket(next),reference:prepared.reference,transition:prepared.transition};}catch(error){releasePair(next);throw error;}
      releasePair(keyed);keyed=next;
    }else if(type==='paintClearKey'){
      if(!prepared)throw new Error('Prepare o assentamento primeiro.');
      response=paintPacket(prepared);releasePair(keyed);keyed=null;
    }else if(type==='paintExport'||type==='paintExportAll'){
      const pair=keyed||prepared;
      if(!pair)throw new Error('Separe e confira as peças antes de exportar.');
      if(pair.report.path.status!=='clear')throw new Error('A passagem de montagem está bloqueada ou não foi concluída. Ajuste a direção e confira novamente.');
      if(type==='paintExport'&&!['selected','remaining'].includes(payload.part))throw new Error('Peça inválida.');
      const buffer=type==='paintExportAll'?zipSync({'regiao.stl':new Uint8Array(binarySTL(fromManifold(pair.selected),offset)),'restante.stl':new Uint8Array(binarySTL(fromManifold(pair.remaining),offset)),'leia-me.txt':strToU8('MagnetLab Studio\nSTL em milímetros, nas coordenadas originais de montagem.\nO afastamento da prévia não altera os arquivos.\n'),'verificacao.json':strToU8(JSON.stringify(pair.report,null,2))},{level:3}).buffer:binarySTL(fromManifold(pair[payload.part]),offset);
      self.postMessage({id,ok:true,payload:{buffer}},[buffer]);return;
    }else if(type==='cut'){
      if(!base)throw new Error('Repare a malha antes de criar cavidades.');
      const calculated=lysProject?cutLysCavities(module,base,payload.cavities,envelope,lysProject):{solid:cutWithReinforcement(module,base,payload.cavities,envelope)};
      const next=calculated.solid;
      try{response={...withBVH(fromManifold(next)),volume:next.volume(),drainReport:calculated.drainReport};}
      catch(error){if(next!==base)next.delete();throw error;}
      releaseResult();result=next;
    }else if(type==='export'){
      if(!base)throw new Error('Repare a malha antes de exportar o sólido.');
      const data=fromManifold(result||base);
      if(payload.format==='lys'&&!lysProject)throw new Error('Importe um LYS antes de exportar esse formato.');
      const exported=payload.format==='lys'?await exportLysWithReport(lysProject,data):{buffer:binarySTL(data,offset)};
      self.postMessage({id,ok:true,payload:exported},[exported.buffer]);return;
    }else throw new Error('Operação desconhecida.');
    self.postMessage({id,ok:true,payload:{...response,elapsed:performance.now()-start}});
  }catch(err){self.postMessage({id,ok:false,error:err.message||'Não foi possível processar a geometria.',repairReport:err.repairReport});}
};
