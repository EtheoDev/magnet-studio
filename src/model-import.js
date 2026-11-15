import { Color, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { indexPositions } from './geometry.js';
import { parseSlicer3MF } from './slicer-3mf.js';

const SWATCHES=['#70a5ff','#ff9676','#a999f7','#63cbb5','#edbf73','#e492cb','#77c8eb','#a8d081'];

export function flattenModel(root, scale=1) {
  root.updateMatrixWorld(true);
  const meshes=[];let triangles=0;
  root.traverse(o=>{if(o.isMesh){meshes.push(o);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
  if(!triangles||!Number.isInteger(triangles))throw new Error('O arquivo não contém uma malha triangular válida.');
  const positions=new Float32Array(triangles*9),faceRegions=new Uint32Array(triangles),palette=[],lookup=new Map(),point=new Vector3(),color=new Color();
  let face=0;
  for(let meshID=0;meshID<meshes.length;meshID++){
    const mesh=meshes[meshID],g=mesh.geometry,p=g.attributes.position,c=g.attributes.color,index=g.index;
    if((Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(m=>m?.map))throw new Error('Texturas 3MF ainda não viram regiões de corte. Use materiais ou cores por face no arquivo.');
    const count=(index?.count??p.count)/3;
    for(let f=0;f<count;f++,face++){
      const group=g.groups.find(group=>f*3>=group.start&&f*3<group.start+group.count);
      const material=Array.isArray(mesh.material)?mesh.material[group?.materialIndex??0]:mesh.material;
      let colored=false;
      if(c){
        const ids=[0,1,2].map(j=>index?index.getX(f*3+j):f*3+j);
        for(let k=0;k<3;k++)if(Math.max(...ids.map(id=>c.array[id*3+k]))-Math.min(...ids.map(id=>c.array[id*3+k]))>1e-4)throw new Error('O modelo usa gradientes de cor dentro das faces. Exporte regiões com uma cor uniforme por face.');
        color.fromBufferAttribute(c,ids[0]);colored=true;
      }else {color.copy(material?.color??new Color('#ffffff'));colored=color.getHex()!==0xffffff;}
      const hex='#'+color.getHexString(),name=material?.name&&material.name!=='__DEFAULT'?material.name:mesh.name||`Objeto ${meshID+1}`;
      const key=colored?hex:`object:${meshID}:${group?.materialIndex??0}`;
      let region=lookup.get(key);
      if(region===undefined){
        if(palette.length>=256)throw new Error('Há mais de 256 regiões de cor. Reduza a paleta antes de importar.');
        region=palette.length;lookup.set(key,region);palette.push({id:region,name:colored&&(name.startsWith('Objeto')||!mesh.name)?`Cor ${region+1}`:name,color:colored?hex:SWATCHES[region%SWATCHES.length],sourceColor:colored,faces:0});
      }
      faceRegions[face]=region;palette[region].faces++;
      for(let j=0;j<3;j++){
        const id=index?index.getX(f*3+j):f*3+j;point.fromBufferAttribute(p,id).applyMatrix4(mesh.matrixWorld);
        positions.set(point.toArray(),face*9+j*3);
      }
    }
  }
  const data=indexPositions(positions,scale);
  return {...data,faceRegions,palette};
}

export function parseSceneFile(buffer,format,scale=1){
  let root;
  try{
    if(format==='obj')root=new OBJLoader().parse(new TextDecoder().decode(buffer));
    else if(format==='3mf'){
      if(buffer.byteLength>250*1024*1024)throw new Error('O limite por 3MF nesta versão é 250 MB.');
      // Inspect ZIP central directory sizes before the loader decompresses it.
      const view=new DataView(buffer);let expanded=0;
      for(let i=0;i+46<=buffer.byteLength;i++)if(view.getUint32(i,true)===0x02014b50){expanded+=view.getUint32(i+24,true);i+=45+view.getUint16(i+28,true)+view.getUint16(i+30,true)+view.getUint16(i+32,true);}
      if(expanded>512*1024*1024)throw new Error('O conteúdo descompactado do 3MF excede 512 MB.');
      const xmlFiles=unzipSync(new Uint8Array(buffer),{filter:file=>/\.(?:model|config|rels)$/i.test(file.name)});
      const painted=parseSlicer3MF(xmlFiles);if(painted)return painted;
      const units={micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000};let unit;
      for(const [name,bytes] of Object.entries(xmlFiles)){
        if(!/\.model$/i.test(name))continue;
        const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
        if(doc.querySelector('parsererror'))throw new Error('O XML do 3MF está inválido.');
        const current=doc.documentElement.getAttribute('unit')||'millimeter';
        if(!(current in units)||unit&&current!==unit)throw new Error('Unidades diferentes ou não suportadas no projeto 3MF.');unit=current;
      }
      if(!unit)throw new Error('Não encontramos o modelo dentro do 3MF.');
      scale=units[unit];root=new ThreeMFLoader().parse(buffer);
    }else throw new Error('Formato de modelo não suportado.');
    return flattenModel(root,scale);
  }finally{root?.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])material?.dispose();});}
}

// Keep original face order while splitting ONLY vertices shared by two colors.
// BVH is deserialized with setIndex:false and its indirect face IDs unchanged.
export function coloredGeometry(data){
  const positions=[],colors=[],indices=new Uint32Array(data.indices.length),lookup=new Map(),vertices=data.positions.length/3,color=new Color();
  for(let f=0;f<data.faceRegions.length;f++){
    const region=data.faceRegions[f];color.set(data.palette[region].color);
    for(let j=0;j<3;j++){
      const original=data.indices[f*3+j],key=region*vertices+original;let id=lookup.get(key);
      if(id===undefined){id=positions.length/3;lookup.set(key,id);positions.push(data.positions[original*3],data.positions[original*3+1],data.positions[original*3+2]);colors.push(color.r,color.g,color.b);}
      indices[f*3+j]=id;
    }
  }
  const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));g.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));g.setIndex(new BufferAttribute(indices,1));g.computeVertexNormals();g.computeBoundingBox();return g;
}

export function colorRegionMask(data,neighbors,region,seed){
  if(!data.palette?.[region])throw new Error('Cor inválida.');
  const mask=new Uint8Array(data.indices.length/3);
  if(seed===undefined){for(let f=0;f<mask.length;f++)mask[f]=Number(data.faceRegions[f]===region);return mask;}
  if(data.faceRegions[seed]!==region)throw new Error('A face não pertence a essa cor.');
  const stack=[seed];mask[seed]=1;
  while(stack.length){const f=stack.pop();for(let j=0;j<3;j++){const next=neighbors[f*3+j];if(next>=0&&!mask[next]&&data.faceRegions[next]===region){mask[next]=1;stack.push(next);}}}
  return mask;
}
