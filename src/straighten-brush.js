// Continuous selection levels: NaN retains the original whole-face label.
// Local surface diffusion smooths the selection while retaining organic curvature.
export function vertexFaceIndex(data){const offsets=new Uint32Array(data.positions.length/3+1);for(const i of data.indices)offsets[i+1]++;for(let i=1;i<offsets.length;i++)offsets[i]+=offsets[i-1];const cursor=offsets.slice(),faces=new Uint32Array(data.indices.length);for(let h=0;h<data.indices.length;h++)faces[cursor[data.indices[h]]++]=Math.floor(h/3);return {offsets,faces};}
export function smoothSelectionBrush(data,mask,field,candidates,center,right,up,radius,strength=1,incidence=vertexFaceIndex(data)){
  if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(strength)||strength<=0||strength>1)return null;
  // Diffuse selection values along mesh edges, never positions or a projected line.
  // The negative Taubin pass suppresses shrinkage of curved selected regions.
  const vertices=new Set(),neighbors=new Map(),weights=new Map(),values=new Map(),falloff=new Map();
  for(const f of candidates)for(let j=0;j<3;j++)vertices.add(data.indices[f*3+j]);
  const initial=id=>{
    if(Number.isFinite(field?.[id]))return field[id];
    let selected=0,total=0;
    for(let h=incidence.offsets[id];h<incidence.offsets[id+1];h++){
      const f=incidence.faces[h],ids=[0,1,2].map(j=>data.indices[f*3+j]),p=ids.map(v=>[0,1,2].map(k=>data.positions[v*3+k]));
      const a=p[1].map((v,k)=>v-p[0][k]),b=p[2].map((v,k)=>v-p[0][k]);
      const area=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
      selected+=(mask[f]?1:-1)*area;total+=area;
    }
    return total?selected/total:-1;
  };
  for(const id of vertices){
    const distance=Math.hypot(...center.map((v,k)=>data.positions[id*3+k]-v));
    if(distance>=radius)continue;
    const adjacent=new Set();
    for(let h=incidence.offsets[id];h<incidence.offsets[id+1];h++)for(let j=0;j<3;j++){const v=data.indices[incidence.faces[h]*3+j];if(v!==id)adjacent.add(v);}
    // Cotangent weights avoid introducing a preferred direction from triangulation.
    const localWeights=new Map();
    for(let h=incidence.offsets[id];h<incidence.offsets[id+1];h++){
      const others=[0,1,2].map(j=>data.indices[incidence.faces[h]*3+j]).filter(v=>v!==id);
      if(others.length!==2)continue;
      for(let j=0;j<2;j++){
        const v=others[j],opposite=others[1-j];
        const a=[0,1,2].map(k=>data.positions[id*3+k]-data.positions[opposite*3+k]);
        const b=[0,1,2].map(k=>data.positions[v*3+k]-data.positions[opposite*3+k]);
        const cross=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
        if(cross>1e-12)localWeights.set(v,(localWeights.get(v)??0)+a.reduce((sum,x,k)=>sum+x*b[k],0)/cross);
      }
    }
    weights.set(id,localWeights);
    neighbors.set(id,Array.from(adjacent));falloff.set(id,Math.min(1,(1-distance/radius)/.25));
    values.set(id,initial(id));
  }
  if(!values.size)return null;
  const fixed=new Map();for(const adjacent of neighbors.values())for(const id of adjacent)if(!values.has(id)&&!fixed.has(id))fixed.set(id,initial(id));
  let current=values;
  for(let iteration=0;iteration<4;iteration++)for(const coefficient of [.5,-.2]){
    const next=new Map();
    for(const [id,old] of current){
      let sum=0,total=0;
      for(const v of neighbors.get(id)){
        const weight=Math.max(0,weights.get(id).get(v)??0);sum+=(current.get(v)??fixed.get(v))*weight;total+=weight;
      }
      next.set(id,total?old+coefficient*strength*falloff.get(id)*(sum/total-old):old);
    }
    current=next;
  }
  const ids=[],levels=[],touched=new Set();
  for(const [id,level] of current){ids.push(id);levels.push(level);for(let h=incidence.offsets[id];h<incidence.offsets[id+1];h++)touched.add(incidence.faces[h]);}
  return {vertices:Uint32Array.from(ids),levels:Float32Array.from(levels),faces:Uint32Array.from(touched)};
}

export function clipSelectionTriangle(data,mask,field,f){
  let polygon=[0,1,2].map(j=>{const id=data.indices[f*3+j];return {p:Array.from(data.positions.subarray(id*3,id*3+3)),level:Number.isFinite(field?.[id])?field[id]:mask[f]?1:-1};}),output=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if(a.level>=0)output.push(a.p);if((a.level>=0)!==(b.level>=0)){const t=a.level/(a.level-b.level);output.push(a.p.map((x,k)=>x+(b.p[k]-x)*t));}}
  return output;
}
