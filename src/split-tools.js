import { fromManifold, toManifold, tangentBasis } from './geometry.js';

export function subsetMesh(data,mask,side){
  const map=new Int32Array(data.positions.length/3).fill(-1),positions=[],indices=[];
  for(let f=0;f<mask.length;f++)if(!!mask[f]===side)for(let j=0;j<3;j++){
    const source=data.indices[f*3+j];if(map[source]<0){map[source]=positions.length/3;positions.push(data.positions[source*3],data.positions[source*3+1],data.positions[source*3+2]);}indices.push(map[source]);
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}
export function solidComponents(solid){const parts=solid.decompose();try{return parts.length;}finally{parts.forEach(p=>p.delete());}}

export function independentSplit(module,base,data,mask,diagnostics){
  let selected,remaining;
  try{
    selected=toManifold(module,subsetMesh(data,mask,true));remaining=toManifold(module,subsetMesh(data,mask,false));
    const overlap=selected.intersect(remaining);try{if(overlap.volume()>Math.max(1e-5,base.volume()*1e-7))throw new Error('Os objetos selecionados se sobrepõem ao restante.');}finally{overlap.delete();}
    return {selected,remaining,source:base,reference:null,diagnostics,report:{closed:true,oriented:true,components:[solidComponents(selected),solidComponents(remaining)],volumes:[selected.volume(),remaining.volume()],originalVolume:base.volume(),overlap:0,outside:0,removedForSeating:0,exteriorDisplacement:0,canKey:false,method:'independent',path:{status:'clear',method:'independent-components',travel:0,testedPairs:0}}};
  }catch(error){selected?.delete();remaining?.delete();throw error;}
}

export function splitPlane(module,base,data,{direction,percent}){
  if(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite)||Math.hypot(...direction)<1e-8||!Number.isFinite(percent)||percent<=0||percent>=100)throw new Error('Use um plano válido e uma posição entre 0 e 100%.');
  const n=direction.map(x=>x/Math.hypot(...direction)),{u,v}=tangentBasis(n);let min=Infinity,max=-Infinity;
  for(let i=0;i<data.positions.length;i+=3){const h=n.reduce((a,x,k)=>a+x*data.positions[i+k],0);min=Math.min(min,h);max=Math.max(max,h);}
  const height=min+(max-min)*percent/100;let selected,remaining,local,section;
  try{
    [selected,remaining]=base.splitByPlane(n,height);
    if(selected.isEmpty()||remaining.isEmpty()||selected.status()!=='NoError'||remaining.status()!=='NoError')throw new Error('O plano precisa atravessar material e produzir duas peças válidas.');
    local=base.transform([u[0],v[0],n[0],0,u[1],v[1],n[1],0,u[2],v[2],n[2],0,0,0,0,1]);section=local.slice(height);
    const rings=section.toPolygons().filter(r=>r.reduce((a,p,i)=>{const q=r[(i+1)%r.length];return a+p[0]*q[1]-p[1]*q[0];},0)>0).map(inner=>({inner,height,center:inner.reduce((a,p)=>a.map((x,k)=>x+p[k]/inner.length),[0,0])}));
    const options={direction:n,width:0,depth:0,seatingGap:0,maleSelected:true};
    return {selected,remaining,source:base,reference:{rings,n,u,v,options},report:{closed:true,oriented:true,components:[solidComponents(selected),solidComponents(remaining)],volumes:[selected.volume(),remaining.volume()],originalVolume:base.volume(),overlap:0,outside:0,removedForSeating:0,exteriorDisplacement:0,canKey:rings.length>0,method:'plane',path:{status:'clear',method:'plane-halfspaces',travel:max-min,testedPairs:0}}};
  }catch(error){selected?.delete();remaining?.delete();throw error;}
  finally{section?.delete();local?.delete();}
}
