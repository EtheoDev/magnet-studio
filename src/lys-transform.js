const identity=scale=>scale.every(x=>x===1);

export function lysScale(value) {
  const scale=value?[value.x,value.y,value.z]:[1,1,1];
  if(scale.some(x=>!Number.isFinite(x)||Math.abs(x)<1e-8))throw new Error('O LYS contém uma escala inválida ou nula.');
  const magnitude=Math.abs(scale[0]);
  if(scale.some(x=>Math.abs(Math.abs(x)-magnitude)>1e-8*Math.max(1,magnitude)))throw new Error('A escala não uniforme deste LYS ainda não é suportada. Aplique a escala no Lychee antes de salvar.');
  return scale;
}

// Keep the original winding (outer or inner) after a reflection as well.
export function scaleLysMesh(data,scale) {
  if(!data||identity(scale))return data;
  const positions=new Float32Array(data.positions.length),indices=new Uint32Array(data.indices);
  for(let i=0;i<positions.length;i++)positions[i]=data.positions[i]*scale[i%3];
  if(scale[0]*scale[1]*scale[2]<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  return {...data,positions,indices};
}

export function scaleLysHole(hole,scale) {
  if(identity(scale))return hole;
  const keys=['x','y','z'],normal=keys.map((k,i)=>hole.tipNormal[k]/scale[i]),length=Math.hypot(...normal),magnitude=Math.abs(scale[0]);
  return {...hole,tip:Object.fromEntries(keys.map((k,i)=>[k,hole.tip[k]*scale[i]])),tipNormal:Object.fromEntries(keys.map((k,i)=>[k,normal[i]/length])),settings:{...hole.settings,diameter:hole.settings.diameter*magnitude,depth:hole.settings.depth*magnitude}};
}
