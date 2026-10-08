import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import { MeshBVH } from 'three-mesh-bvh';
import { parseSTL, toManifold, fromManifold, cutCavities, binarySTL, toGeometry } from './geometry.js';
import { diagnoseMesh } from './repair.js';
import { repairSolid } from './repair-solid.js';
import repairWasmURL from 'meshfix-wasm/dist/meshfix-core.wasm?url';

let module, base, sourceData, offset=[0,0,0], result;
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
    const tree=new MeshBVH(geometry,{maxLeafSize:10});
    return {positions:new Float32Array(geometry.attributes.position.array),indices:new Uint32Array(geometry.index.array),bvh:MeshBVH.serialize(tree)};
  }finally{geometry.dispose();}
}
function releaseResult(){if(result&&result!==base)result.delete();result=null;}
function install(next,data,extra={}){
  let packet;
  try{packet=withBVH(next?fromManifold(next):data);}catch(err){next?.delete();throw err;}
  releaseResult();base?.delete();base=next;offset=data.offset||[0,0,0];
  const box=next?.boundingBox(),size=box?box.max.map((v,k)=>v-box.min[k]):data.size;
  return {...packet,size,offset,volume:next?.volume()||0,valid:!!next,...extra};
}
self.onmessage=async({data:{id,type,payload}})=>{
  try{
    await ready;const start=performance.now();let response;
    if(type==='import'){
      const parsed=parseSTL(payload.buffer,payload.scale);let next=null,issue=null;
      try{next=toManifold(module,parsed);}catch(err){issue=err.message;}
      response=install(next,parsed,{diagnostics:next?null:diagnoseMesh(parsed),issue});sourceData=parsed;
    }else if(type==='demo'){
      const a=module.Manifold.cube([64,44,12],true),b0=module.Manifold.cube([64,10,30],true),b=b0.translate([0,17,9]);
      const next=a.add(b);a.delete();b.delete();b0.delete();
      const data={...fromManifold(next),offset:[0,0,0]};response=install(next,data);sourceData=data;
    }else if(type==='repair'){
      if(!sourceData)throw new Error('Importe um STL para reparar.');
      const {repaired,solid:next}=await repairSolid(module,sourceData,payload.options,loadRepairCore);
      response=install(next,repaired,{repairReport:repaired.repairReport,patchPositions:repaired.patchPositions});
    }else if(type==='cut'){
      if(!base)throw new Error('Repare a malha antes de criar cavidades.');
      releaseResult();result=cutCavities(module,base,payload.cavities);
      response={...withBVH(fromManifold(result)),volume:result.volume()};
    }else if(type==='export'){
      if(!base)throw new Error('Repare a malha antes de exportar o sólido.');
      const buffer=binarySTL(fromManifold(result||base),offset);
      self.postMessage({id,ok:true,payload:{buffer}},[buffer]);return;
    }else throw new Error('Operação desconhecida.');
    self.postMessage({id,ok:true,payload:{...response,elapsed:performance.now()-start}});
  }catch(err){self.postMessage({id,ok:false,error:err.message||'Não foi possível processar a geometria.',repairReport:err.repairReport});}
};
