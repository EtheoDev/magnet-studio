import { BufferGeometry, BufferAttribute, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { binarySTL } from './geometry.js';
import { validateRepairOptions } from './repair.js';

// Kept separate from the WASM loader so Node and the browser use the same pipeline.
function boundarySizes(data) {
  const edges=new Map(),n=data.positions.length/3;
  for(let s=0;s<data.indices.length;s++){
    const a=data.indices[s],b=data.indices[s-s%3+(s%3+1)%3],key=Math.min(a,b)*n+Math.max(a,b);
    const e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1});
  }
  const outgoing=new Map(),incoming=new Map();
  for(const e of edges.values()){
    if(e.count>2)throw new Error('Ainda existem conexões inválidas após a separação das superfícies.');
    if(e.count!==1)continue;
    if(outgoing.has(e.a))throw new Error('O reparo encontrou um contorno ramificado.');
    outgoing.set(e.a,e.b);incoming.set(e.b,(incoming.get(e.b)||0)+1);
  }
  const seen=new Set(),sizes=[];
  for(const start of outgoing.keys()){
    if(seen.has(start))continue;
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let id=start,count=0;
    do{
      if(seen.has(id)||!outgoing.has(id)||incoming.get(id)!==1)throw new Error('O reparo encontrou um contorno aberto ou ambíguo.');
      seen.add(id);count++;
      for(let k=0;k<3;k++){const v=data.positions[id*3+k];min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);}
      id=outgoing.get(id);
    }while(id!==start);
    sizes.push({edges:count,diagonal:Math.hypot(...max.map((v,k)=>v-min[k]))});
  }
  return sizes;
}
function renderData(core,analyzer){
  const path='/tmp/magnet-render.bin';
  try{
    if(!analyzer.writeRenderData(path))throw new Error('Não foi possível ler o resultado do reparo.');
    const bytes=core.FS.readFile(path),buf=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),view=new DataView(buf);
    const vertices=view.getUint32(0,true),indices=view.getUint32(4,true);
    return {positions:new Float32Array(buf,8,vertices*3).slice(),indices:new Uint32Array(buf,8+vertices*24,indices).slice()};
  }finally{try{core.FS.unlink(path);}catch{/* No temporary file if the writer failed. */}}
}
function changedFaces(before,after){
  const vertices=new Map(),positionKey=(p,i)=>`${p[i*3]},${p[i*3+1]},${p[i*3+2]}`;
  for(let i=0;i<before.positions.length/3;i++)vertices.set(positionKey(before.positions,i),i);
  const map=new Int32Array(after.positions.length/3);
  for(let i=0;i<map.length;i++)map[i]=vertices.get(positionKey(after.positions,i))??-1;
  const faceKey=ids=>ids.sort((a,b)=>a-b).join(','),original=new Map();
  for(let f=0;f<before.indices.length;f+=3){const k=faceKey(Array.from(before.indices.subarray(f,f+3)));if(!original.has(k))original.set(k,[]);original.get(k).push(f/3);}
  const added=[];
  for(let f=0;f<after.indices.length;f+=3){
    const ids=Array.from(after.indices.subarray(f,f+3),i=>map[i]),list=ids.includes(-1)?null:original.get(faceKey(ids));
    if(list?.length)list.pop();else added.push(f/3);
  }
  const removed=[];for(const list of original.values())removed.push(...list);
  return {added,removed};
}
function sampledDistance(source,faces,target){
  if(!faces.length)return 0;
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(target.positions,3));geometry.setIndex(new BufferAttribute(target.indices,1));
  try{
    const tree=new MeshBVH(geometry,{indirect:true}),q=new Vector3(),center=new Vector3();let maximum=0;
    for(const f of faces){
      center.set(0,0,0);
      for(let j=0;j<3;j++){
        q.fromArray(source.positions,source.indices[f*3+j]*3);center.add(q);
        maximum=Math.max(maximum,tree.closestPointToPoint(q).distance);
      }
      center.multiplyScalar(1/3);maximum=Math.max(maximum,tree.closestPointToPoint(center).distance);
    }
    return maximum;
  }finally{geometry.dispose();}
}

export function repairAdvanced(data,options,core){
  const o=validateRepairOptions(options);
  if(data.indices.length/3>1_000_000)throw new Error('O reparo aceita até 1 milhão de triângulos.');
  const analyzer=new core.MeshAnalyzer(),path='/tmp/magnet-input.stl';
  try{
    // Centered coordinates preserve the precision used by the rest of the app.
    core.FS.writeFile(path,new Uint8Array(binarySTL(data)));
    if(!analyzer.loadFromFile(path))throw new Error('O motor de reparo não conseguiu ler esta malha.');
    const loaded=analyzer.getStats();
    // No proximity welding: the conservative attempt already tried the user's tolerance.
    const split=analyzer.splitVertices(),beforeFill=renderData(core,analyzer),loops=boundarySizes(beforeFill);
    if(loops.length>1000||loops.some(l=>l.edges>1024))throw new Error('Há contornos demais ou muito complexos para este reparo.');
    if(loops.length&&o.maxHoleSize===0)throw new Error('Há bordas abertas e o fechamento de buracos está desativado.');
    if(loops.some(l=>l.diagonal>o.maxHoleSize))throw new Error('Há contornos que excedem o limite de fechamento.');
    // Preserve openings identified by the engine as intentional features.
    const filled=analyzer.fillHolesEx(1024,false),clean=analyzer.removeDegenerates(1e-10),normals=analyzer.fixNormals();
    const analysis=analyzer.getAnalysis();
    if(!analysis.isWatertight||!analysis.isManifold||analysis.boundaryEdges||analysis.nonManifoldVertexCount||analysis.nonManifoldEdgeCount||analyzer.facesDroppedByAudit()){
      throw new Error('O reparo avançado não conseguiu fechar a malha com segurança. Nenhuma alteração foi aplicada.');
    }
    const repaired=renderData(core,analyzer),changes=changedFaces(data,repaired);
    if(changes.added.length+changes.removed.length>50000)throw new Error('O reparo exigiria alterar uma região extensa. Nenhuma alteração foi aplicada.');
    const deviation=Math.max(sampledDistance(data,changes.removed,repaired),sampledDistance(repaired,changes.added,data));
    if(deviation>0.05)throw new Error('O reparo alteraria a superfície em mais de 0,05 mm nas amostras verificadas. Nenhuma alteração foi aplicada.');
    const patchPositions=new Float32Array(changes.added.length*9);let cursor=0;
    for(const f of changes.added)for(let j=0;j<3;j++){const i=repaired.indices[f*3+j]*3;patchPositions.set(repaired.positions.subarray(i,i+3),cursor);cursor+=3;}
    return {...repaired,offset:data.offset,size:data.size,patchPositions,repairReport:{
      method:'advanced',options:o,verticesWelded:0,maxVertexDisplacement:0,
      verticesSplit:split.verticesAdded,facesSkippedOnLoad:loaded.skippedFaces,
      duplicatesRemoved:clean.duplicateRemoved,degenerateRemoved:clean.degenerateRemoved,
      facesReoriented:normals.facesFlipped,components:analysis.connectedComponents,
      holesFilled:filled.holesFilled,facesAdded:filled.facesAdded,
      changedFaces:changes.added.length,removedFaces:changes.removed.length,
      maxSampledSurfaceDistance:deviation,boundaryEdges:analysis.boundaryEdges,
    }};
  }finally{analyzer.delete();try{core.FS.unlink(path);}catch{/* The load may have failed before creating a file. */}}
}
