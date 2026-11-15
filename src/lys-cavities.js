import {Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {LIMITS,validateCavity,cavityDimensions,tangentBasis,createCutter,createDrainCutter,createReinforcement,axialCylinder,cutCavities,cutWithReinforcement,toManifold,fromManifold,toGeometry} from './geometry.js';

function nativeGeometry(module,project,envelope,interior,bosses,cavities,removed,central) {
  if(!project.nativeGeometry)return null;
  let inner=project.nativeGeometry.inner,voidSolid=interior,outerSolid;
  try{
    if(inner&&bosses.length){
      for(const boss of bosses){const next=voidSolid.subtract(boss);if(voidSolid!==interior)voidSolid.delete();voidSolid=next;}
      if(voidSolid.isEmpty())throw new Error('Os reforços eliminaram o vazio interno. Reduza o reforço para preservar a escavação no LYS.');
      inner=fromManifold(voidSolid);
      for(let i=0;i<inner.indices.length;i+=3)[inner.indices[i+1],inner.indices[i+2]]=[inner.indices[i+2],inner.indices[i+1]];
    }
    // Magnets must be real recesses in the external mesh, not Lychee hole
    // objects. Keep a closed floor between these recesses and the inner mesh.
    if(inner){
      for(const c of cavities){
        const tool=createCutter(module,c);let overlap;
        try{
          overlap=voidSolid.intersect(tool);
          if(overlap.volume()>1e-6)return {error:'O encaixe atravessa a malha interna. Ative o reforço interno ou reduza a profundidade para exportar a cavidade na malha externa com a escavação separada. A exportação STL continua disponível.'};
        }finally{overlap?.delete();tool.delete();}
      }
    }
    outerSolid=cutCavities(module,envelope,cavities);
    const outer=fromManifold(outerSolid);
    const holes=project.nativeGeometry.holes.filter((_,i)=>!removed.includes(i));
    const ids=new Set(project.nativeGeometry.holes.map(h=>h.id));let nextId=0;
    for(const c of central){
      let id;do{id=`h${++nextId}`;}while(ids.has(id));ids.add(id);
      const {diameter,depth}=cavityDimensions(c);
      holes.push({id,objectId:project.objectId,isExportable:true,tip:{x:c.point[0],y:c.point[1],z:c.point[2]},tipNormal:{x:c.normal[0],y:c.normal[1],z:c.normal[2]},tipRotation:null,settings:{type:'cylinder',diameter,depth,hole:{type:'cylinder'}}});
    }
    if(holes.length>100)throw new Error('O LYS resultante excede o limite de 100 drenagens.');
    return {outer,inner,holes};
  }finally{if(outerSolid&&outerSolid!==envelope)outerSolid.delete();if(voidSolid&&voidSolid!==interior)voidSolid.delete();}
}

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

function replacementReach(c,drains,wall) {
  let reach=wall;
  for(const drain of drains){
    const alignment=drain.normal.reduce((sum,x,i)=>sum+x*c.normal[i],0);
    // A side opening or a hole on the opposite wall cannot justify extending
    // a central drain in this pocket's direction.
    if(alignment<.9)continue;
    const start=c.point.reduce((sum,x,i)=>sum+(x-drain.point[i])*c.normal[i],0);
    const rim=drain.diameter/2*Math.sqrt(Math.max(0,1-alignment*alignment));
    reach=Math.max(reach,start+drain.thickness*alignment+rim);
  }
  return reach;
}

function centralDrain(c,tree,far,maxEntry) {
  const {diameter,depth}=cavityDimensions(c),drainDiameter=diameter*.3;
  const {u,v}=tangentBasis(c.normal),direction=new Vector3(...c.normal).negate();
  // Center plus rim samples ensure that the tube opens into the internal void.
  // The final solid intersection below additionally checks the entire end disk.
  let end=depth+(c.reinforce?c.bottom:0)+EPS,limit=Infinity;
  for(let i=-1;i<24;i++){
    const angle=i*2*Math.PI/24,r=i<0?0:drainDiameter/2;
    const origin=new Vector3(...c.point).addScaledVector(new Vector3(...u),r*Math.cos(angle)).addScaledVector(new Vector3(...v),r*Math.sin(angle));
    const interval=firstVoid(tree,origin,direction,far);
    // A hollow project may contain solid limbs or blocker regions. Only drain
    // through the local shell, never extend a tunnel to a remote internal void.
    // Bound the entrance from the original surface, not from the pocket floor:
    // deeper magnets and reinforcements must not expand the search distance.
    if(!interval||interval[0]>maxEntry+EPS)return null;
    end=Math.max(end,interval[0]+EPS);limit=Math.min(limit,interval[1]-EPS);
  }
  if(end+EPS>=limit)throw new Error('Não há espaço interno para a drenagem central sem atingir a parede oposta. Reduza a profundidade ou reposicione a cavidade.');
  return {...c,diameter:drainDiameter,diameterAllowance:0,thickness:end,depthAllowance:0,end,limit};
}

export function cutLysCavities(module,base,cavities,envelope,project) {
  if(cavities.length>LIMITS.cavities)throw new Error('O limite desta versão é 100 cavidades.');
  cavities.forEach(validateCavity);
  if(!cavities.length)return {solid:base,nativeGeometry:project.nativeGeometry,drainReport:{removed:0,added:0,diameters:[]}};
  const shell=toManifold(module,project.undrained),regions=[],bosses=[],cavityRegions=[],replacements=cavities.map(()=>[]);
  let rebuilt,edited,interior,geometry;
  try{
    for(const c of cavities){
      const local=[];cavityRegions.push(local);
      const cutter=createCutter(module,c);
      try{const region=cutter.intersect(envelope);regions.push(region);local.push(region);}finally{cutter.delete();}
      if(c.reinforce){const region=createReinforcement(module,c,envelope);regions.push(region);bosses.push(region);local.push(region);}
    }
    const removed=[],remaining=[];
    for(let i=0;i<project.drains.length;i++){
      const drain=project.drains[i],tool=createDrainCutter(module,drain);let opening;
      try{
        // Only material actually removed by this drain participates in overlap.
        opening=shell.intersect(tool);
        let replaced=false;
        cavityRegions.forEach((local,index)=>{
          if(local.some(region=>intersects(region,opening))){replacements[index].push(drain);replaced=true;}
        });
        if(replaced)removed.push(i);else remaining.push(drain);
      }finally{opening?.delete();tool.delete();}
    }
    // Starting from the undrilled shell closes a replaced hole in its entirety,
    // including the part outside the magnet footprint, without filling the void.
    rebuilt=cutCavities(module,shell,remaining,createDrainCutter);
    edited=cutWithReinforcement(module,rebuilt,cavities,envelope);
    const central=[];
    if(project.info.wall){
      interior=envelope.subtract(shell);
      if(interior.isEmpty()&&removed.length)throw new Error('Não foi possível substituir a drenagem: a peça não contém um vazio interno. Os furos originais não foram alterados.');
      if(!interior.isEmpty()){
        geometry=toGeometry(fromManifold(interior));const tree=new MeshBVH(geometry);
        const box=envelope.boundingBox(),far=Math.hypot(...box.max.map((x,i)=>x-box.min[i]))*2;
        for(let i=0;i<cavities.length;i++){
          const c=cavities[i],replaced=replacements[i];
          // Existing local holes provide a bounded, measured drilling depth.
          // Do not use holes replaced by another magnet to extend this one.
          const drain=centralDrain(c,tree,far,replacementReach(c,replaced,project.info.wall));
          if(!drain){
            if(replaced.length)throw new Error('Não foi possível substituir a drenagem por um furo central dentro da profundidade original. Ajuste a posição do encaixe; os furos originais não foram alterados.');
            continue;
          }
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
      }
      for(const drain of central){
        const tool=axialCylinder(module,drain,drain.diameter,drain.end);let next;
        try{next=edited.subtract(tool);if(next.status()!=='NoError'||next.isEmpty())throw new Error('Não foi possível criar a drenagem central.');}
        catch(error){next?.delete();throw error;}finally{tool.delete();}
        if(edited!==rebuilt&&edited!==shell)edited.delete();edited=next;
      }
    }
    const native=nativeGeometry(module,project,envelope,interior,bosses,cavities,removed,central);
    const solid=edited;edited=null;
    return {solid,nativeGeometry:native,drainReport:{removed:removed.length,removedIndices:removed,added:central.length,skipped:project.info.wall?cavities.length-central.length:0,diameters:central.map(d=>d.diameter)}};
  }finally{
    if(edited&&edited!==rebuilt&&edited!==shell)edited.delete();
    if(rebuilt&&rebuilt!==shell)rebuilt.delete();
    shell.delete();interior?.delete();geometry?.dispose();regions.forEach(r=>r.delete());
  }
}
