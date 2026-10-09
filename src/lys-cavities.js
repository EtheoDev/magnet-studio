import {Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {LIMITS,validateCavity,cavityDimensions,tangentBasis,createCutter,createReinforcement,axialCylinder,cutCavities,cutWithReinforcement,toManifold,fromManifold,toGeometry} from './geometry.js';

const EPS=0.02;
function intersects(a,b){const overlap=a.intersect(b);try{return overlap.volume()>1e-6;}finally{overlap.delete();}}

// Find the first void along each ray, never a later void beyond another wall.
function firstVoid(tree,origin,direction,far) {
  const hits=tree.raycast(new Ray(origin,direction),DoubleSide,0,far).sort((a,b)=>a.distance-b.distance);
  let entry=0;
  for(const hit of hits){
    if(hit.face.normal.dot(direction)<-1e-8)entry=hit.distance;
    else if(hit.face.normal.dot(direction)>1e-8&&hit.distance>entry+1e-5)return [entry,hit.distance];
  }
  return null;
}

function centralDrain(c,tree,far) {
  const {diameter,depth}=cavityDimensions(c),drainDiameter=diameter*.3;
  const {u,v}=tangentBasis(c.normal),direction=new Vector3(...c.normal).negate();
  // Center plus rim samples ensure that the tube opens into the internal void.
  // The final solid intersection below additionally checks the entire end disk.
  let end=depth+(c.reinforce?c.bottom:0)+EPS,limit=Infinity;
  for(let i=-1;i<24;i++){
    const angle=i*2*Math.PI/24,r=i<0?0:drainDiameter/2;
    const origin=new Vector3(...c.point).addScaledVector(new Vector3(...u),r*Math.cos(angle)).addScaledVector(new Vector3(...v),r*Math.sin(angle));
    const interval=firstVoid(tree,origin,direction,far);
    if(!interval)throw new Error('A drenagem central não encontra o vazio interno nessa direção. Reposicione a cavidade.');
    end=Math.max(end,interval[0]+EPS);limit=Math.min(limit,interval[1]-EPS);
  }
  if(end+EPS>=limit)throw new Error('Não há espaço interno para a drenagem central sem atingir a parede oposta. Reduza a profundidade ou reposicione a cavidade.');
  return {...c,diameter:drainDiameter,diameterAllowance:0,thickness:end,depthAllowance:0,end,limit};
}

export function cutLysCavities(module,base,cavities,envelope,project) {
  if(cavities.length>LIMITS.cavities)throw new Error('O limite desta versão é 100 cavidades.');
  cavities.forEach(validateCavity);
  if(!cavities.length)return {solid:base,drainReport:{removed:0,added:0,diameters:[]}};
  const shell=toManifold(module,project.undrained),regions=[];
  let rebuilt,edited,interior,geometry;
  try{
    for(const c of cavities){
      const cutter=createCutter(module,c);
      try{regions.push(cutter.intersect(envelope));}finally{cutter.delete();}
      if(c.reinforce)regions.push(createReinforcement(module,c,envelope));
    }
    const removed=[],remaining=[];
    for(let i=0;i<project.drains.length;i++){
      const drain=project.drains[i],tool=createCutter(module,drain);let opening;
      try{
        // Only material actually removed by this drain participates in overlap.
        opening=shell.intersect(tool);
        if(regions.some(region=>intersects(region,opening)))removed.push(i);else remaining.push(drain);
      }finally{opening?.delete();tool.delete();}
    }
    // Starting from the undrilled shell closes a replaced hole in its entirety,
    // including the part outside the magnet footprint, without filling the void.
    rebuilt=cutCavities(module,shell,remaining);
    edited=cutWithReinforcement(module,rebuilt,cavities,envelope);
    const central=[];
    if(project.info.wall){
      interior=envelope.subtract(shell);
      geometry=toGeometry(fromManifold(interior));const tree=new MeshBVH(geometry);
      const box=envelope.boundingBox(),far=Math.hypot(...box.max.map((x,i)=>x-box.min[i]))*2;
      for(const c of cavities){
        const drain=centralDrain(c,tree,far);
        // Check the full exit disk lies in the source void (not just ray samples)
        // and remains empty after every reinforcement has been added.
        const endpoint={...drain,point:c.point.map((x,i)=>x-c.normal[i]*drain.end)};
        const cap=axialCylinder(module,endpoint,drain.diameter,EPS,0);let outside;
        try{
          outside=cap.subtract(interior);
          if(outside.volume()>1e-7||intersects(cap,edited))throw new Error('O fundo da drenagem central não ficou livre no interior. Ajuste a posição, o fundo ou as cavidades próximas.');
        }finally{outside?.delete();cap.delete();}
        central.push(drain);
      }
      for(const drain of central){
        const tool=axialCylinder(module,drain,drain.diameter,drain.end);let next;
        try{next=edited.subtract(tool);if(next.status()!=='NoError'||next.isEmpty())throw new Error('Não foi possível criar a drenagem central.');}
        catch(error){next?.delete();throw error;}finally{tool.delete();}
        if(edited!==rebuilt&&edited!==shell)edited.delete();edited=next;
      }
    }
    const solid=edited;edited=null;
    return {solid,drainReport:{removed:removed.length,removedIndices:removed,added:central.length,diameters:central.map(d=>d.diameter)}};
  }finally{
    if(edited&&edited!==rebuilt&&edited!==shell)edited.delete();
    if(rebuilt&&rebuilt!==shell)rebuilt.delete();
    shell.delete();interior?.delete();geometry?.dispose();regions.forEach(r=>r.delete());
  }
}
