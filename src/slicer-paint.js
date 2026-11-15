// TriangleSelector wire format: low nibble first, children in reverse order.
// Geometry follows the split-side convention used by Bambu/Orca/Prusa.
const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
export function decodePaintedMesh(inputVertices,triangles,{maxFaces=3_000_000,maxDepth=24}={}){
  const vertices=[],sourceIDs=new Uint32Array(inputVertices.length),positionIDs=new Map(),midpoints=new Map(),leaves=[];
  for(let i=0;i<inputVertices.length;i++){
    const p=inputVertices[i];if(p.length!==3||!p.every(Number.isFinite))throw new Error('Vértices inválidos no 3MF.');
    const key=p.join(',');let id=positionIDs.get(key);if(id===undefined){id=vertices.length;vertices.push(p.slice());positionIDs.set(key,id);}sourceIDs[i]=id;
  }
  function midpoint(a,b){const key=edgeKey(a,b);let id=midpoints.get(key);if(id===undefined){id=vertices.length;vertices.push(vertices[a].map((x,k)=>(x+vertices[b][k])/2));midpoints.set(key,id);}return id;}
  function push(ids,state){if(leaves.length>=maxFaces)throw new Error('A pintura excede o limite de 3 milhões de faces.');leaves.push({ids,state});}
  for(const triangle of triangles){
    const {paint='',defaultState=1,extendedStates=true}=triangle;
    if(triangle.ids.length!==3||triangle.ids.some(i=>!Number.isInteger(i)||i<0||i>=inputVertices.length))throw new Error('Índices inválidos no 3MF.');
    const ids=triangle.ids.map(i=>sourceIDs[i]);
    if(!paint){push(ids,defaultState);continue;}
    if(!/^[0-9a-f]+$/i.test(paint)||paint.length>1_000_000)throw new Error('Pintura compactada inválida no 3MF.');
    let cursor=paint.length-1;
    const next=()=>{if(cursor<0)throw new Error('Pintura compactada truncada no 3MF.');return parseInt(paint[cursor--],16);};
    function visit(ids,depth){
      if(depth>maxDepth)throw new Error('A subdivisão da pintura excede a profundidade suportada.');
      const code=next(),splits=code&3,side=code>>2;
      if(!splits){let state=side;if(state===3){state=3;let n;do{n=next();state+=n;if(state>255)throw new Error('Filamento de pintura fora do intervalo suportado.');}while(extendedStates&&n===15);}push(ids,state||defaultState);return;}
      if(side>2||(splits===3&&side!==0))throw new Error('Lado de subdivisão inválido na pintura.');
      const a=ids[side],b=ids[(side+1)%3],c=ids[(side+2)%3];let children;
      if(splits===1){const bc=midpoint(b,c);children=[[a,b,bc],[bc,c,a]];}
      else if(splits===2){const ab=midpoint(a,b),ca=midpoint(c,a);children=[[a,ab,ca],[ab,b,ca],[b,c,ca]];}
      else{const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);children=[[a,ab,ca],[ab,b,bc],[bc,c,ca],[ab,bc,ca]];}
      for(let i=children.length-1;i>=0;i--)visit(children[i],depth+1);
    }
    visit(ids,0);
    if(cursor>=0&&/[1-9a-f]/i.test(paint.slice(0,cursor+1)))throw new Error('Dados excedentes na pintura compactada.');
  }
  // Slicer trees may split only one side of an edge. Propagate those midpoints
  // to neighboring leaves to avoid T-junctions and keep a closed cutting mesh.
  const result=[],pending=leaves.slice();
  while(pending.length){
    const leaf=pending.pop(),ids=leaf.ids;let split=false;
    for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],c=ids[(i+2)%3],mid=midpoints.get(edgeKey(a,b));if(mid!==undefined){pending.push({ids:[a,mid,c],state:leaf.state},{ids:[mid,b,c],state:leaf.state});split=true;break;}}
    if(!split)result.push(leaf);
    if(result.length+pending.length>maxFaces)throw new Error('A pintura excede o limite de 3 milhões de faces.');
  }
  return {vertices,triangles:result};
}
