import { encode, decode } from '@msgpack/msgpack';

const bytes=array=>new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
export function saveProject(data,mask,name,settings,selectionField=null){
  return encode({format:'magnetlab',version:1,name,positions:bytes(data.positions),indices:bytes(data.indices),faceRegions:data.faceRegions?bytes(data.faceRegions):null,palette:data.palette??null,offset:data.offset??[0,0,0],size:data.size,mask,settings,selectionField:selectionField?bytes(selectionField):null});
}
export function loadProject(buffer){
  const p=decode(new Uint8Array(buffer),{maxArrayLength:3_000_000,maxMapLength:1000,maxStrLength:10000});
  if(p.format!=='magnetlab'||p.version!==1||!(p.positions instanceof Uint8Array)||!(p.indices instanceof Uint8Array)||p.positions.byteLength%12||p.indices.byteLength%12||!p.indices.byteLength)throw new Error('Projeto MagnetLab inválido ou incompatível.');
  const positions=new Float32Array(p.positions.slice().buffer),indices=new Uint32Array(p.indices.slice().buffer),faces=indices.length/3;
  if(positions.some(x=>!Number.isFinite(x))||indices.some(i=>i>=positions.length/3)||!(p.mask instanceof Uint8Array)||p.mask.length!==faces||p.mask.some(x=>x>1))throw new Error('O projeto contém geometria ou seleção inválida.');
  if(![p.offset,p.size].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)))throw new Error('Dimensões do projeto inválidas.');
  const data={positions,indices,offset:p.offset,size:p.size,preserveFaces:true};
  if(p.faceRegions){
    if(!(p.faceRegions instanceof Uint8Array)||p.faceRegions.length!==faces*4||!Array.isArray(p.palette)||p.palette.length>256||p.palette.some(r=>!/^#[0-9a-f]{6}$/i.test(r.color)))throw new Error('Paleta do projeto inválida.');
    data.faceRegions=new Uint32Array(p.faceRegions.slice().buffer);if(data.faceRegions.some(r=>r>=p.palette.length))throw new Error('Região do projeto inválida.');data.palette=p.palette;
  }
  let selectionField=null;if(p.selectionField){if(!(p.selectionField instanceof Uint8Array)||p.selectionField.length!==positions.length/3*4)throw new Error('Ajuste de borda inválido no projeto.');selectionField=new Float32Array(p.selectionField.slice().buffer);if(selectionField.some(x=>!Number.isFinite(x)&&!Number.isNaN(x)))throw new Error('Ajuste de borda inválido no projeto.');}
  return {data,mask:p.mask,name:typeof p.name==='string'?p.name:'projeto',settings:Array.isArray(p.settings)?p.settings:[],selectionField};
}
