// Split triangles at the selection boundary, without projecting or moving them.
export function selectionSurface(data,mask,field){
  const count=data.positions.length/3,positive=new Uint8Array(count),negative=new Uint8Array(count);
  for(let f=0;f<mask.length;f++)for(let j=0;j<3;j++)(mask[f]?positive:negative)[data.indices[f*3+j]]=1;
  const positions=Array.from(data.positions),indices=[],labels=[],levels=Array.from({length:count},(_,id)=>Number.isFinite(field[id])?field[id]:positive[id]&&negative[id]?0:positive[id]?1:-1),crossings=new Map();
  const crossing=(a,b)=>{
    if(levels[a]===0)return a;if(levels[b]===0)return b;
    if(a>b)[a,b]=[b,a];const key=`${a}:${b}`;if(crossings.has(key))return crossings.get(key);
    const t=levels[a]/(levels[a]-levels[b]),id=positions.length/3;
    for(let k=0;k<3;k++)positions.push(positions[a*3+k]+t*(positions[b*3+k]-positions[a*3+k]));
    levels.push(0);crossings.set(key,id);return id;
  };
  function split(tri,side){
    const polygon=[];
    for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],inside=side?levels[a]>=0:levels[a]<=0;if(inside)polygon.push(a);if(levels[a]*levels[b]<0)polygon.push(crossing(a,b));}
    const unique=polygon.filter((id,j)=>id!==polygon[(j+polygon.length-1)%polygon.length]);
    for(let j=1;j+1<unique.length;j++){indices.push(unique[0],unique[j],unique[j+1]);labels.push(side?1:0);}
  }
  for(let f=0;f<mask.length;f++){
    const tri=[0,1,2].map(j=>data.indices[f*3+j]);
    if(tri.every(id=>!Number.isFinite(field[id]))){indices.push(...tri);labels.push(mask[f]);continue;}
    // A face center retains the original label where the brush field ends.
    // Shared zero-valued vertices keep the untouched face boundary conforming.
    const id=positions.length/3;
    for(let k=0;k<3;k++)positions.push(tri.reduce((sum,v)=>sum+positions[v*3+k],0)/3);
    levels.push(tri.reduce((sum,v)=>sum+(Number.isFinite(field[v])?field[v]:mask[f]?1:-1),0)/3);
    for(let j=0;j<3;j++){
      const wedge=[tri[j],tri[(j+1)%3],id],ls=wedge.map(v=>levels[v]);
      if(ls.every(v=>v===0)){indices.push(...wedge);labels.push(mask[f]);}
      else if(ls.every(v=>v>=0)){indices.push(...wedge);labels.push(1);}
      else if(ls.every(v=>v<=0)){indices.push(...wedge);labels.push(0);}
      else{split(wedge,true);split(wedge,false);}
    }
  }
  return {data:{...data,positions:Float32Array.from(positions),indices:Uint32Array.from(indices)},mask:Uint8Array.from(labels)};
}
