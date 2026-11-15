import {Matrix4,Vector3} from 'three';
import {indexPositions} from './geometry.js';
import {decodePaintedMesh} from './slicer-paint.js';

const text=bytes=>new TextDecoder().decode(bytes);
const elements=(node,name)=>Array.from(node.getElementsByTagName('*')).filter(n=>(n.localName||n.nodeName.split(':').pop())===name);
const attr=(node,name)=>Array.from(node.attributes??[]).find(a=>(a.localName||a.name.split(':').pop())===name)?.value;
const pathKey=p=>p.replace(/^\/+/, '').replace(/\\/g,'/');
const FALLBACK=['#70a5ff','#ff9676','#a999f7','#63cbb5','#edbf73','#e492cb','#77c8eb','#a8d081'];
function transform(value){if(!value)return new Matrix4();const a=value.trim().split(/\s+/).map(Number);if(a.length!==12||!a.every(Number.isFinite))throw new Error('Transformação inválida no 3MF.');return new Matrix4().set(a[0],a[3],a[6],a[9],a[1],a[4],a[7],a[10],a[2],a[5],a[8],a[11],0,0,0,1);}

export function readSlicerPalette(files){
  for(const [name,bytes] of Object.entries(files))if(/project_settings\.config$/i.test(name)){
    let config;try{config=JSON.parse(text(bytes));}catch{continue;}
    const colors=config.filament_colour??config.filament_color??config.extruder_colour;
    if(Array.isArray(colors))return colors.map(c=>/^#[0-9a-f]{6}/i.test(c)?c.slice(0,7):null);
  }
  for(const [name,bytes] of Object.entries(files))if(/(?:Slic3r_PE\.config|PrusaSlicer\.config)$/i.test(name)){
    const match=text(bytes).match(/^\s*filament_colour\s*=\s*(.+)$/mi)??text(bytes).match(/^\s*extruder_colour\s*=\s*(.+)$/mi);
    if(match)return match[1].trim().split(';').map(c=>/^#[0-9a-f]{6}/i.test(c)?c.slice(0,7):null);
  }
  return [];
}

export function parseSlicer3MF(files,Parser=globalThis.DOMParser){
  const parser=new Parser(),docs=new Map();let painted=false;
  for(const [name,bytes] of Object.entries(files))if(/\.model$/i.test(name)){
    const doc=parser.parseFromString(text(bytes),'application/xml');if(elements(doc,'parsererror').length)throw new Error('XML inválido no 3MF.');docs.set(pathKey(name),doc);
    if(elements(doc,'triangle').some(t=>attr(t,'paint_color')!==undefined||attr(t,'mmu_segmentation')!==undefined))painted=true;
  }
  if(!painted)return null;
  const colors=readSlicerPalette(files),defaults=new Map(),volumes=new Map();
  for(const [name,bytes] of Object.entries(files))if(/(?:model_settings\.config|Slic3r_PE_model\.config)$/i.test(name)){
    const doc=parser.parseFromString(text(bytes),'application/xml');
    for(const obj of elements(doc,'object')){
      const id=attr(obj,'id'),metadata=elements(obj,'metadata'),own=metadata.find(n=>n.parentNode===obj&&attr(n,'key')==='extruder');
      if(own)defaults.set(id,Number(attr(own,'value')??own.textContent));
      for(const part of elements(obj,'part')){const e=elements(part,'metadata').find(n=>attr(n,'key')==='extruder');if(e)defaults.set(attr(part,'id'),Number(attr(e,'value')??e.textContent));}
      for(const volume of elements(obj,'volume')){const e=elements(volume,'metadata').find(n=>attr(n,'key')==='extruder');if(e){const start=Number(attr(volume,'firstid')),end=Number(attr(volume,'lastid'));if(Number.isInteger(start)&&Number.isInteger(end))volumes.set(`${id}:${start}`,{start,end,state:Number(attr(e,'value')??e.textContent)});}}
    }
  }
  let rootPath='3D/3dmodel.model';
  const rel=files['_rels/.rels'];if(rel){const doc=parser.parseFromString(text(rel),'application/xml'),model=elements(doc,'Relationship').find(n=>/\/3dmodel$/.test(attr(n,'Type')??''));if(model)rootPath=pathKey(attr(model,'Target'));}
  const root=docs.get(rootPath);if(!root)throw new Error('Modelo principal não encontrado no 3MF pintado.');
  const units={micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000},unit=units[attr(root.documentElement,'unit')??'millimeter'];if(!unit)throw new Error('Unidade inválida no 3MF.');
  const positions=[],regions=[],palette=[],slotMap=new Map(),cache=new Map(),point=new Vector3();
  function region(state){if(!Number.isInteger(state)||state<1||state>255)throw new Error('Filamento padrão inválido no 3MF.');let id=slotMap.get(state);if(id===undefined){id=palette.length;slotMap.set(state,id);palette.push({id,name:`Filamento ${state}`,color:colors[state-1]??FALLBACK[(state-1)%FALLBACK.length],sourceColor:!!colors[state-1],filament:state,faces:0});}return id;}
  function visit(path,id,matrix,stack,inheritedState=1){
    const key=`${path}:${id}`;if(stack.has(key)||stack.size>64)throw new Error('Referência circular no 3MF.');
    const doc=docs.get(path),object=doc&&elements(doc,'object').find(n=>attr(n,'id')===id);if(!object)throw new Error(`Objeto ${id} não encontrado no 3MF pintado.`);
    const modelUnit=units[attr(doc.documentElement,'unit')??'millimeter'];if(modelUnit!==unit)throw new Error('Unidades diferentes nos modelos do projeto 3MF.');
    const next=new Set(stack).add(key),mesh=elements(object,'mesh')[0],defaultState=defaults.get(id)||inheritedState,cacheKey=`${key}:${defaultState}`;
    if(mesh){
      let data=cache.get(cacheKey);if(!data){
        const vertices=elements(mesh,'vertex').map(v=>['x','y','z'].map(k=>Number(attr(v,k))));if(vertices.some(p=>!p.every(Number.isFinite)))throw new Error('Vértices inválidos no 3MF.');
        const ranges=[...volumes.entries()].filter(([k])=>k.startsWith(`${id}:`)).map(([,v])=>v);
        const triangles=elements(mesh,'triangle').map((t,f)=>({ids:['v1','v2','v3'].map(k=>Number(attr(t,k))),paint:attr(t,'paint_color')??attr(t,'mmu_segmentation')??'',extendedStates:attr(t,'paint_color')!==undefined,defaultState:ranges.find(r=>f>=r.start&&f<=r.end)?.state||defaultState}));
        data=decodePaintedMesh(vertices,triangles);cache.set(cacheKey,data);
      }
      const mirrored=matrix.determinant()<0;
      for(const face of data.triangles){if(regions.length>=3_000_000)throw new Error('O projeto pintado excede 3 milhões de faces.');const r=region(face.state);regions.push(r);palette[r].faces++;for(const i of mirrored?[face.ids[0],face.ids[2],face.ids[1]]:face.ids){point.fromArray(data.vertices[i]).applyMatrix4(matrix);positions.push(point.x,point.y,point.z);}}
    }else for(const component of elements(object,'component')){
      const target=attr(component,'path');visit(target?pathKey(target):path,attr(component,'objectid'),matrix.clone().multiply(transform(attr(component,'transform'))),next,defaultState);
    }
  }
  const build=elements(root,'build')[0];if(!build)throw new Error('O 3MF pintado não contém objetos para construir.');
  for(const item of elements(build,'item'))if(attr(item,'printable')!=='0')visit(attr(item,'path')?pathKey(attr(item,'path')):rootPath,attr(item,'objectid'),transform(attr(item,'transform')),new Set());
  if(!regions.length)throw new Error('O 3MF pintado não contém geometria imprimível.');
  return {...indexPositions(new Float32Array(positions),unit),faceRegions:new Uint32Array(regions),palette};
}
