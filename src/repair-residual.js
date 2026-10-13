// A tiny nonplanar loop may defeat the engine's diagonal triangulation.
// A new interior vertex avoids reusing a diagonal already present in the mesh.
// The caller must still validate topology, surface deviation and the final solid.
export function capResidualGaps(data,loops,maxHoleSize){
  const limit=Math.min(maxHoleSize,0.05);
  if(!loops.length||limit<=0||loops.some(l=>l.diagonal>limit||l.ids.length<3||l.ids.length>32)){
    throw new Error('Restaram aberturas que exigem reconstrução local; o fechamento complementar atende apenas contornos de até 0,05 mm dentro da medida configurada.');
  }
  const positions=new Float32Array(data.positions.length+loops.length*3);positions.set(data.positions);
  const added=loops.reduce((n,l)=>n+l.ids.length,0),indices=new Uint32Array(data.indices.length+added*3);indices.set(data.indices);
  let cursor=data.indices.length;
  for(let i=0;i<loops.length;i++){
    const ids=loops[i].ids,center=data.positions.length/3+i,sum=[0,0,0];
    for(const id of ids)for(let k=0;k<3;k++)sum[k]+=data.positions[id*3+k]/ids.length;
    positions.set(sum,center*3);
    for(let j=0;j<ids.length;j++){
      const a=ids[j],b=ids[(j+1)%ids.length];
      const u=[0,1,2].map(k=>positions[a*3+k]-positions[center*3+k]);
      const v=[0,1,2].map(k=>positions[b*3+k]-positions[center*3+k]);
      const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
      if(!Number.isFinite(area)||area===0)throw new Error('A abertura residual está colapsada e exige reconstrução local.');
      indices.set([b,a,center],cursor);cursor+=3;
    }
  }
  return {...data,positions,indices,holesFilled:loops.length,facesAdded:added};
}
