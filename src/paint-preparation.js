import {selectionBoundary} from './paint-selection.js';

export function preparePaintSelection(data,topology,input,{clean=true}={}){
  const mask=input.slice(),normal=[0,0,0],areas=new Float64Array(mask.length);let selectedArea=0;
  for(let f=0;f<mask.length;f++){
    const [a,b,c]=[0,1,2].map(j=>data.indices[f*3+j]*3),u=[0,1,2].map(k=>data.positions[b+k]-data.positions[a+k]),v=[0,1,2].map(k=>data.positions[c+k]-data.positions[a+k]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];areas[f]=Math.hypot(...cross)/2;
    if(mask[f]){selectedArea+=areas[f];for(let k=0;k<3;k++)normal[k]+=cross[k];}
  }
  const changed=[],seen=new Set();
  if(clean)for(let pass=0;pass<8;pass++){
    const changes=[];
    for(let f=0;f<mask.length;f++)if(!seen.has(f)&&areas[f]<selectedArea*.001&&[0,1,2].every(j=>{const n=topology.neighbors[f*3+j];return n>=0&&mask[n]!==mask[f];}))changes.push(f);
    if(!changes.length||changed.length+changes.length>Math.max(8,Math.floor(mask.reduce((a,b)=>a+b,0)*.01)))break;
    for(const f of changes){mask[f]^=1;seen.add(f);changed.push(f);}
  }
  const length=Math.hypot(...normal),direction=length>1e-8?normal.map(x=>x/length):null;
  return {mask,changed:Uint32Array.from(changed),direction,diagnostics:selectionBoundary(data,topology,mask)};
}
