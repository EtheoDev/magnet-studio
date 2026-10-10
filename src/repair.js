import { BufferGeometry, BufferAttribute, Vector2, Vector3, Ray, DoubleSide, ShapeUtils } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const point = (p, i) => [p[i*3],p[i*3+1],p[i*3+2]];
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const unit=a=>a.map(v=>v/length(a));
const key=(a,b,n)=>Math.min(a,b)*n+Math.max(a,b);

export function validateRepairOptions(options={}) {
  const o={weldTolerance:0.001,maxHoleSize:5,advancedRepair:true,...options};
  if(typeof o.advancedRepair!=='boolean')throw new Error('A opção de reparo avançado é inválida.');
  if(!Number.isFinite(o.weldTolerance)||o.weldTolerance<0||o.weldTolerance>0.1)throw new Error('A tolerância de união deve estar entre 0 e 0,1 mm.');
  if(!Number.isFinite(o.maxHoleSize)||o.maxHoleSize<0||o.maxHoleSize>100)throw new Error('O limite dos buracos deve estar entre 0 e 100 mm. Use 0 para não fechar buracos.');
  return o;
}
function clean(p,indices,report){
  const out=new Uint32Array(indices.length),seen=new Set();let count=0;
  for(let f=0;f<indices.length;f+=3){
    const ids=[indices[f],indices[f+1],indices[f+2]],a=point(p,ids[0]),b=point(p,ids[1]),c=point(p,ids[2]);
    if(new Set(ids).size<3||length(cross(sub(b,a),sub(c,a)))===0){report.degenerateRemoved++;continue;}
    const sorted=[...ids].sort((a,b)=>a-b),hash=sorted.join(',');
    if(seen.has(hash)){report.duplicatesRemoved++;continue;}seen.add(hash);out.set(ids,count);count+=3;
  }
  return out.subarray(0,count);
}
// Twin edge slots support adjacency without allocating arrays per edge.
function topology(indices,n){
  const twins=new Int32Array(indices.length).fill(-1),edges=new Map();let nonManifoldEdges=0;
  for(let slot=0;slot<indices.length;slot++){
    const f=slot-slot%3,a=indices[slot],b=indices[f+(slot%3+1)%3],k=key(a,b,n),first=edges.get(k);
    if(first===undefined){edges.set(k,slot);continue;}
    if(first<0){twins[slot]=-2;continue;}
    if(twins[first]===-1){twins[first]=slot;twins[slot]=first;}
    else{const other=twins[first];twins[first]=twins[other]=twins[slot]=-2;edges.set(k,-first-1);nonManifoldEdges++;}
  }
  return {twins,nonManifoldEdges,boundaryEdges:twins.reduce((s,t)=>s+(t===-1),0)};
}
function weldBoundary(p,indices,top,tolerance,report){
  if(tolerance===0||top.boundaryEdges===0)return indices;
  const boundary=new Set();
  for(let s=0;s<indices.length;s++)if(top.twins[s]===-1){boundary.add(indices[s]);boundary.add(indices[s-s%3+(s%3+1)%3]);}
  const grid=new Map(),map=new Map(),tol2=tolerance*tolerance;
  for(const id of boundary){
    const pos=point(p,id),cell=pos.map(v=>Math.floor(v/tolerance));let best=id,bestD=tol2;
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const list=grid.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`);if(!list)continue;
      for(const other of list){const q=point(p,other),d=pos.reduce((v,a,k)=>v+(a-q[k])**2,0);if(d<=bestD){best=other;bestD=d;}}
    }
    map.set(id,best);
    if(best!==id){report.verticesWelded++;report.maxVertexDisplacement=Math.max(report.maxVertexDisplacement,Math.sqrt(bestD));}
    else{const k=cell.join(',');if(!grid.has(k))grid.set(k,[]);grid.get(k).push(id);}
  }
  return indices.map(i=>map.get(i)??i);
}
function orient(indices,top){
  const count=indices.length/3,flip=new Int8Array(count).fill(-1),component=new Int32Array(count),components=[];
  for(let seed=0;seed<count;seed++){
    if(flip[seed]!==-1)continue;
    const queue=[seed];flip[seed]=0;const id=components.length;
    for(let head=0;head<queue.length;head++){
      const f=queue[head];component[f]=id;
      for(let e=0;e<3;e++){
        const slot=f*3+e,twin=top.twins[slot];if(twin<0)continue;
        const neighbor=Math.floor(twin/3),same=indices[slot]===indices[twin],expected=flip[f]^(same?1:0);
        if(flip[neighbor]===-1){flip[neighbor]=expected;queue.push(neighbor);}
        else if(flip[neighbor]!==expected)throw new Error('A superfície tem orientação contraditória. Este defeito exige remalhamento.');
      }
    }
    components.push(queue);
  }
  for(let f=0;f<count;f++)if(flip[f]){const i=f*3;[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];}
  return {component,components,flip};
}
function boundaryLoops(indices,top){
  const outgoing=new Map(),incoming=new Map(),boundary=[];
  for(let s=0;s<indices.length;s++)if(top.twins[s]===-1){
    const a=indices[s],b=indices[s-s%3+(s%3+1)%3];boundary.push(s);
    if(!outgoing.has(a))outgoing.set(a,[]);outgoing.get(a).push(s);incoming.set(b,(incoming.get(b)||0)+1);
  }
  const seen=new Set(),loops=[];let ambiguousEdges=0;
  for(const seed of boundary){
    if(seen.has(seed))continue;
    let slot=seed,closed=false;const loop=[];
    for(let guard=0;guard<=boundary.length;guard++){
      if(seen.has(slot)){closed=slot===seed;break;}
      seen.add(slot);const a=indices[slot],b=indices[slot-slot%3+(slot%3+1)%3];loop.push(a);
      if(outgoing.get(a)?.length!==1||incoming.get(a)!==1||outgoing.get(b)?.length!==1)break;
      slot=outgoing.get(b)[0];
    }
    if(closed&&loop.length>=3)loops.push(loop);else ambiguousEdges+=loop.length;
  }
  return {loops,ambiguousEdges};
}
function projectLoop(p,ids,maxHoleSize){
  if(ids.length>1024)return {reason:'complexos'};
  const points=ids.map(i=>point(p,i)),min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));
  const size=length(sub(max,min));if(size>maxHoleSize)return {reason:'acimaDoLimite'};
  let n=[0,0,0];const origin=points[0];
  for(let i=0;i<points.length;i++){const v=cross(sub(points[i],origin),sub(points[(i+1)%points.length],origin));n=n.map((x,k)=>x+v[k]);}
  if(length(n)<1e-12)return {reason:'complexos'};n=unit(n);
  if(points.some(q=>Math.abs(dot(sub(q,origin),n))>0.01))return {reason:'naoPlanos'};
  const ref=Math.abs(n[2])<.9?[0,0,1]:[0,1,0],u=unit(cross(ref,n)),v=cross(n,u);
  const coords=points.map(q=>{const d=sub(q,origin);return [dot(d,u),dot(d,v)];});
  for(let i=0;i<coords.length;i++)for(let j=i+1;j<coords.length;j++){
    if(j===i+1||(i===0&&j===coords.length-1))continue;
    if(segmentsIntersect(coords[i],coords[(i+1)%coords.length],coords[j],coords[(j+1)%coords.length]))return {reason:'complexos'};
  }
  return {ids,points,origin,n,u,v,coords,size};
}
function segmentsIntersect(a,b,c,d){
  const side=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const s=[side(a,b,c),side(a,b,d),side(c,d,a),side(c,d,b)];
  if(s[0]*s[1]<0&&s[2]*s[3]<0)return true;
  const on=(p,q,r)=>r[0]>=Math.min(p[0],q[0])-1e-10&&r[0]<=Math.max(p[0],q[0])+1e-10&&r[1]>=Math.min(p[1],q[1])-1e-10&&r[1]<=Math.max(p[1],q[1])+1e-10;
  return (Math.abs(s[0])<1e-10&&on(a,b,c))||(Math.abs(s[1])<1e-10&&on(a,b,d))||(Math.abs(s[2])<1e-10&&on(c,d,a))||(Math.abs(s[3])<1e-10&&on(c,d,b));
}
function inside2D(q,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a[1]>q[1])!==(b[1]>q[1]))&&q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function overlappingCaps(a,b){
  if(Math.abs(dot(a.n,b.n))<.99999||b.points.some(p=>Math.abs(dot(sub(p,a.origin),a.n))>.01))return false;
  const bp=b.points.map(p=>{const d=sub(p,a.origin);return [dot(d,a.u),dot(d,a.v)];});
  if(inside2D(bp[0],a.coords)||inside2D(a.coords[0],bp))return true;
  for(let i=0;i<a.coords.length;i++)for(let j=0;j<bp.length;j++)if(segmentsIntersect(a.coords[i],a.coords[(i+1)%a.coords.length],bp[j],bp[(j+1)%bp.length]))return true;
  return false;
}
function fillHoles(p,indices,top,o,report){
  const {loops,ambiguousEdges}=boundaryLoops(indices,top);report.holesDetected=loops.length;report.ambiguousBoundaryEdges=ambiguousEdges;
  const candidates=[];
  for(const ids of loops){const projected=projectLoop(p,ids,o.maxHoleSize);if(projected.reason){report.holesSkipped++;report.skippedReasons[projected.reason]++;}else candidates.push(projected);}
  // Separate coplanar nested boundaries require a patch with holes, not two disks.
  const ambiguous=new Set();
  if(candidates.length>1000)throw new Error('Há mais de mil contornos a fechar. Este reparo exige uma ferramenta especializada.');
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)if(overlappingCaps(candidates[i],candidates[j])){ambiguous.add(i);ambiguous.add(j);}
  const patches=[];
  candidates.forEach((c,idx)=>{
    if(ambiguous.has(idx)){report.holesSkipped++;report.skippedReasons.complexos++;return;}
    const triangles=ShapeUtils.triangulateShape(c.coords.map(p=>new Vector2(...p)),[]);
    if(triangles.length!==c.ids.length-2){report.holesSkipped++;report.skippedReasons.complexos++;return;}
    for(const t of triangles){const ids=t.map(i=>c.ids[i]);const normal=cross(sub(point(p,ids[1]),point(p,ids[0])),sub(point(p,ids[2]),point(p,ids[0])));if(dot(normal,c.n)>0)[ids[1],ids[2]]=[ids[2],ids[1]];patches.push(...ids);}
    report.holesFilled++;report.facesAdded+=triangles.length;
  });
  const output=new Uint32Array(indices.length+patches.length);output.set(indices);output.set(patches,indices.length);
  return {indices:output,patches:new Uint32Array(patches)};
}
// Shell orientation follows nesting parity so hollow parts keep their inner voids.
function orientShells(p,indices,orientation,report){
  const {components,component,flip}=orientation;if(components.length>2000)throw new Error('Há mais de 2.000 superfícies separadas. O reparo conservador não foi aplicado.');
  let g,tree;
  if(components.length>1){g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(p,3));g.setIndex(new BufferAttribute(indices,1));tree=new MeshBVH(g,{indirect:true});}
  const depths=[];
  try{
    for(let k=0;k<components.length;k++){
      const faces=components[k];let depth=0;
      if(tree){
        const samples=[faces[0],faces[Math.floor(faces.length/2)],faces[faces.length-1]],answers=[];
        for(let s=0;s<samples.length;s++){
          const f=samples[s]*3,origin=new Vector3(...point(p,indices[f]));
          const direction=new Vector3(.734123+s*.041,.412537-s*.032,.537921+s*.017).normalize();
          const hits=tree.raycast(new Ray(origin,direction),DoubleSide).filter(h=>component[h.faceIndex]!==k&&h.distance>1e-7).sort((a,b)=>a.distance-b.distance),counts=new Map(),last=new Map();
          for(const h of hits){const other=component[h.faceIndex];if(Math.abs(h.distance-(last.get(other)??-Infinity))<1e-7)continue;last.set(other,h.distance);counts.set(other,(counts.get(other)||0)+1);}
          answers.push([...counts.values()].filter(n=>n%2===1).length);
        }
        if(answers.some(a=>a!==answers[0]))throw new Error('Superfícies sobrepostas ou aninhamento ambíguo. O reparo exige remalhamento para preservar os volumes internos.');
        depth=answers[0];
      }
      depths.push(depth);
      let vol6=0;for(const f of faces){const a=point(p,indices[f*3]),b=point(p,indices[f*3+1]),c=point(p,indices[f*3+2]);vol6+=dot(a,cross(b,c));}
      if(Math.abs(vol6)<1e-12)throw new Error('Uma das superfícies não delimita volume. Não é possível repará-la sem reconstrução.');
      const invert=(vol6>0)!==(depth%2===0);
      if(invert){report.shellsReoriented++;for(const f of faces){const i=f*3;[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];flip[f]^=1;}}
    }
    report.facesReoriented=flip.subarray(0,orientation.existingFaceCount??flip.length).reduce((s,f)=>s+(f===1),0);report.components=components.length;
  }finally{g?.dispose();}
}
function compact(p,indices){
  const map=new Int32Array(p.length/3).fill(-1),out=new Float32Array(p.length),idx=new Uint32Array(indices.length);let count=0;
  for(let k=0;k<indices.length;k++){const i=indices[k];if(map[i]===-1){map[i]=count;out.set(p.subarray(i*3,i*3+3),count*3);count++;}idx[k]=map[i];}
  return {positions:out.slice(0,count*3),indices:idx};
}
export function diagnoseMesh(data){const t=topology(data.indices,data.positions.length/3);return {boundaryEdges:t.boundaryEdges,nonManifoldEdges:t.nonManifoldEdges};}
export function repairMesh(data,options={}){
  const o=validateRepairOptions(options),p=data.positions;
  const report={verticesWelded:0,maxVertexDisplacement:0,degenerateRemoved:0,duplicatesRemoved:0,facesReoriented:0,shellsReoriented:0,components:0,holesDetected:0,holesFilled:0,holesSkipped:0,facesAdded:0,ambiguousBoundaryEdges:0,skippedReasons:{acimaDoLimite:0,naoPlanos:0,complexos:0},options:o};
  let indices=clean(p,data.indices,report),t=topology(indices,p.length/3);
  if(o.weldTolerance>0&&t.boundaryEdges){
    const beforeWeld=indices,beforeTopology=t,beforeReport={...report};
    indices=clean(p,weldBoundary(p,indices,t,o.weldTolerance,report),report);t=topology(indices,p.length/3);
    // Proximity alone is not enough: a weld must not add invalid connections.
    if(t.nonManifoldEdges>beforeTopology.nonManifoldEdges){indices=beforeWeld;t=beforeTopology;Object.assign(report,beforeReport);report.weldRejected=true;}
  }
  if(t.nonManifoldEdges)throw Object.assign(new Error(`${t.nonManifoldEdges} aresta(s) ainda ligam mais de duas faces. O reparo simples não resolveu essas conexões; tente o reparo avançado.`),{repairReport:report});
  const first=orient(indices,t);const initialFlips=first.flip;
  t=topology(indices,p.length/3);const filled=fillHoles(p,indices,t,o,report);indices=filled.indices;t=topology(indices,p.length/3);
  if(t.boundaryEdges||t.nonManifoldEdges)throw Object.assign(new Error(`Restaram ${t.boundaryEdges} bordas abertas. ${report.skippedReasons.acimaDoLimite?`${report.skippedReasons.acimaDoLimite} contorno(s) excedem o limite de fechamento. `:''}${report.skippedReasons.naoPlanos?'Há buracos não planos. ':''}${report.skippedReasons.complexos||report.ambiguousBoundaryEdges?'Há contornos complexos ou ambíguos. ':''}Nenhum reparo parcial foi aplicado.`),{repairReport:report});
  const final=orient(indices,t);final.existingFaceCount=initialFlips.length;for(let i=0;i<initialFlips.length;i++)final.flip[i]^=initialFlips[i];
  orientShells(p,indices,final,report);
  const repaired=compact(p,indices);
  const patchPositions=new Float32Array(filled.patches.length*3);for(let k=0;k<filled.patches.length;k++)patchPositions.set(point(p,filled.patches[k]),k*3);
  return {...repaired,offset:data.offset,size:data.size,repairReport:report,patchPositions};
}
