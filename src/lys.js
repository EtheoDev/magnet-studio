import { decode, encode } from '@msgpack/msgpack';
import { LIMITS, toManifold, fromManifold, cutCavities } from './geometry.js';
import { reconnectLysSupports } from './lys-supports.js';

// Payload compatibility transform adapted from Open Resin Alliance's MIT parser.
// See public/THIRD-PARTY-LYS.txt for attribution and the complete license.
const mask = new TextEncoder().encode('DragonFruitFTW');
const appId = [0x25,0x4a,0x04,0x02,0x5e,0x5f,0x72,0x44,0x58,0x51,0x10,0x76,0x67,0x7a,0x70,0x10,0x57,0x5e,0x42,0x56,0x27,0x44,0x42,0x44,0x41,0x7f,0x64,0x67,0x7d,0x13,0x52,0x01,0x56,0x0b,0x23,0x45].map((b,i)=>b^mask[i%mask.length]);
const textDecoder = new TextDecoder('utf-8', { fatal:true });
const fail = message => { throw new Error(message); };
const records = section => Object.values(section?.present?.byId || {});
const uint = n => Number.isSafeInteger(n) && n >= 0;
const xyz = v => [v?.x,v?.y,v?.z];
const finiteVector = v => xyz(v).every(Number.isFinite);

export function transformSceneBytes(bytes, writing=false) {
  return Uint8Array.from(bytes,(b,i)=>(b+(writing?1:-1)*appId[i%appId.length]+256)%256);
}
async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}

export async function readLysContainer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength<20) fail('Arquivo LYS vazio ou incompleto.');
  if (buffer.byteLength>LIMITS.bytes) fail('O limite por arquivo é 200 MB.');
  const view=new DataView(buffer), bytes=new Uint8Array(buffer);
  const headerSize=view.getUint32(4,true), jsonSize=view.getUint32(12,true), start=8+headerSize;
  if(view.getUint32(0,true)!==4 || jsonSize>4*1024*1024 || start>bytes.length || start<16+jsonSize || start-(16+jsonSize)>3 || view.getUint32(8,true)!==headerSize-4) fail('Esta estrutura de arquivo LYS ainda não é compatível.');
  let manifest;
  try { manifest=JSON.parse(textDecoder.decode(bytes.subarray(16,16+jsonSize))); }
  catch { fail('O cabeçalho do LYS está danificado.'); }
  if(manifest.version!=='3.1.0' || !manifest.mangoFiles || typeof manifest.mangoFiles!=='object') fail('Versão do LYS ainda não suportada. Exporte a peça como STL no Lychee.');
  const entries=new Map(), spans=[];
  if(Object.keys(manifest.mangoFiles).length>1000) fail('O projeto LYS contém entradas demais.');
  for(const [name,info] of Object.entries(manifest.mangoFiles)) {
    if(!info || !/^(0|[1-9]\d*)$/.test(String(info.offset))) fail('O LYS contém uma posição de arquivo inválida.');
    const offset=Number(info.offset), size=info.size;
    if(!uint(offset)||!uint(size)||!uint(start+offset+size)||start+offset+size>bytes.length) fail('O LYS está incompleto: uma entrada ultrapassa o tamanho do arquivo.');
    const content=bytes.subarray(start+offset,start+offset+size);
    if(info.integrity) {
      if(info.integrity.algorithm!=='SHA256'||typeof info.integrity.hash!=='string') fail('Verificação de integridade LYS não suportada.');
      if(await hash(content)!==info.integrity.hash.toLowerCase()) fail('O conteúdo do LYS não confere com seu hash de integridade.');
    }
    spans.push([offset,offset+size]); entries.set(name,content);
  }
  spans.sort((a,b)=>a[0]-b[0]);
  if(spans.some((s,i)=>i&&s[0]<spans[i-1][1])) fail('O LYS contém entradas sobrepostas.');
  const sceneBytes=entries.get('scene.bin');
  if(!sceneBytes || sceneBytes.length>32*1024*1024) fail('Cena LYS ausente ou acima do limite de 32 MB.');
  let scene;
  try { scene=decode(transformSceneBytes(sceneBytes),{maxStrLength:4*1024*1024,maxBinLength:32*1024*1024,maxArrayLength:1_000_000,maxMapLength:100_000}); }
  catch { fail('Não foi possível ler os dados desta versão do Lychee.'); }
  if(!scene || typeof scene!=='object' || !scene.objects?.present?.byId) fail('O LYS não contém uma cena reconhecida.');
  return {manifest,entries,scene};
}

export function readLysMesh(bytes) {
  if(!bytes || bytes.byteLength<20) fail('Uma malha do LYS está ausente ou incompleta.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const indicesCount=view.getUint32(8,true), coordinatesCount=view.getUint32(12,true);
  if(view.getUint32(0,true)!==2 || view.getUint32(4,true)!==12) fail('Versão de malha LYS ainda não suportada.');
  if(!indicesCount||!coordinatesCount||indicesCount%3||coordinatesCount%3||indicesCount/3>LIMITS.triangles||coordinatesCount>LIMITS.triangles*9||20+4*(indicesCount+coordinatesCount)!==bytes.length) fail('A malha LYS tem contagens inválidas ou excede 3 milhões de triângulos.');
  const indices=new Uint32Array(indicesCount),positions=new Float32Array(coordinatesCount);
  for(let i=0;i<indices.length;i++) { indices[i]=view.getUint32(20+4*i,true);if(indices[i]>=coordinatesCount/3)fail('Índice fora da malha LYS.'); }
  for(let i=0;i<positions.length;i++) { positions[i]=view.getFloat32(20+4*indicesCount+4*i,true);if(!Number.isFinite(positions[i]))fail('Coordenada inválida na malha LYS.'); }
  return {positions,indices};
}
export function writeLysMesh(data) {
  const bytes=new Uint8Array(20+4*(data.indices.length+data.positions.length)),view=new DataView(bytes.buffer);
  [2,12,data.indices.length,data.positions.length,0].forEach((v,i)=>view.setUint32(i*4,v,true));
  data.indices.forEach((v,i)=>view.setUint32(20+i*4,v,true));
  data.positions.forEach((v,i)=>view.setFloat32(20+data.indices.length*4+i*4,v,true));
  return bytes;
}
function combineMeshes(a,b) {
  if(!b)return a;
  if((a.indices.length+b.indices.length)/3>LIMITS.triangles)fail('A peça oca excede 3 milhões de triângulos.');
  const positions=new Float32Array(a.positions.length+b.positions.length),indices=new Uint32Array(a.indices.length+b.indices.length);
  positions.set(a.positions);positions.set(b.positions,a.positions.length);indices.set(a.indices);
  indices.set(b.indices.map(i=>i+a.positions.length/3),a.indices.length);
  return {positions,indices};
}

// Version one intentionally handles one unscaled object. Unsupported modifiers
// must fail explicitly rather than silently produce a different print.
export async function importLys(module,buffer) {
  const project=await readLysContainer(buffer),{scene,entries}=project;
  const objects=records(scene.objects);
  if(objects.length!==1)fail('Esta versão abre LYS com uma peça. Salve a peça isolada em outro projeto Lychee.');
  const object=objects[0];
  if(object.type!=='file'||object.isHole||object.isOperationObject||!['none',undefined].includes(object.booleanMode))fail('Este LYS usa operações de objeto ainda não suportadas.');
  if(object.scale && (!finiteVector(object.scale)||xyz(object.scale).some(v=>Math.abs(v-1)>1e-8)))fail('Aplique a escala à peça no Lychee antes de salvar este LYS.');
  if(object.hollowing?.infillEnabled || records(scene.hollowBlockers).length || object.hollowBlockers?.length)fail('LYS com preenchimento interno ou bloqueadores de escavação ainda não é suportado.');
  const stem=object.properties?.hash;
  if(typeof stem!=='string'||!entries.has(stem+'.bin'))fail('Não foi possível associar a peça à sua malha no LYS.');
  const outer=readLysMesh(entries.get(stem+'.bin'));
  const hollow=object.hollowing?.enabled;
  if(object.hasHollowing2D&&!hollow)fail('Escavação 2D sem malha interna ainda não é suportada.');
  const inner=hollow?readLysMesh(entries.get(stem+'_hollowing.bin')):null;
  const holes=records(scene.holes);
  if(holes.length>100)fail('Este projeto excede o limite de 100 furos.');
  const drains=holes.map(h=>{
    if(h.objectId!==object.id||h.settings?.type!=='cylinder'||h.stlMatrix||h.tipRotation||!finiteVector(h.tip)||!finiteVector(h.tipNormal))fail('O LYS contém um tipo ou orientação de furo ainda não suportado.');
    const normal=xyz(h.tipNormal),len=Math.hypot(...normal);
    if(len<1e-8)fail('Direção inválida em um furo do LYS.');
    return {point:xyz(h.tip),normal:normal.map(v=>v/len),diameter:h.settings.diameter,thickness:h.settings.depth,diameterAllowance:0,depthAllowance:0};
  });
  let envelope, shell, solid;
  try {
    envelope=toManifold(module,outer);
    shell=toManifold(module,combineMeshes(outer,inner));
    const undrained=fromManifold(shell);
    solid=cutCavities(module,shell,drains);
    if(solid!==shell){shell.delete();shell=null;}
    const box=solid.boundingBox();
    const data={...fromManifold(solid),offset:[0,0,0],size:box.max.map((v,i)=>v-box.min[i])};
    const info={name:object.name||'Peça LYS',appVersion:scene.appVersion,wall:hollow?object.hollowing.outer:null,drains:drains.length,supports:records(scene.supports).length,foundation:!!object.foundation?.enabled};
    return {solid,envelope,data,project:{...project,objectId:object.id,stem,drains,info,undrained,contactSurface:data},info};
  }catch(error){if(solid&&solid!==shell)solid.delete();shell?.delete();envelope?.delete();throw error;}
}

export async function writeLysContainer(manifest,entries) {
  const next={...manifest,mangoFiles:{}},contents=[];let offset=0;
  for(const [name,content] of entries) {
    const blockSize=4*1024*1024,blocks=[];
    for(let i=0;i<content.length;i+=blockSize)blocks.push(await hash(content.subarray(i,i+blockSize)));
    next.mangoFiles[name]={size:content.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:await hash(content),blockSize,blocks}};
    contents.push(content);offset+=content.length;
  }
  const json=new TextEncoder().encode(JSON.stringify(next)),padded=Math.ceil((json.length+4)/4)*4,headerSize=4+padded;
  if(8+headerSize+offset>LIMITS.bytes)fail('O LYS resultante ultrapassa 200 MB.');
  const bytes=new Uint8Array(8+headerSize+offset),view=new DataView(bytes.buffer);
  [4,headerSize,padded,json.length].forEach((v,i)=>view.setUint32(i*4,v,true));bytes.set(json,16);
  let cursor=8+headerSize;for(const content of contents){bytes.set(content,cursor);cursor+=content.length;}
  return bytes.buffer;
}

// Bake the edited hollow object and drains into one closed mesh. Supports,
// foundation, placements, printer and resin settings remain native scene data.
export async function exportLysWithReport(project,data,options={}) {
  const prepared=reconnectLysSupports(project.scene,project.objectId,options.contactSurface||project.contactSurface||data,data);
  // Unresolved contacts retain their original data. Export the remaining work
  // and report these contacts so the user can finish adjusting them in Lychee.
  const scene=prepared.scene,object=scene.objects.present.byId[project.objectId];
  const meshBytes=writeLysMesh(data),stem=(await hash(meshBytes)).slice(0,32);
  object.properties={...object.properties,hash:stem,watch:false,size:(84+50*data.indices.length/3)/1_000_000};
  object.hollowing={...object.hollowing,enabled:false};object.hasHollowing2D=false;object.holes=[];
  object.stats={...object.stats,polyCount:data.indices.length/3,vertexCount:data.positions.length/3,numHoles:0,manifold:true,hasStructuralErrors:false};
  // Holes are already present in the edited mesh; don't apply them a second time.
  if(scene.holes?.present) {
    scene.holes.present.byId={};scene.holes.present.allIds=[];
    if('selectedId' in scene.holes.present)scene.holes.present.selectedId=null;
    if('selectedIds' in scene.holes.present)scene.holes.present.selectedIds=[];
  }
  const entries=new Map(project.entries);
  entries.delete(project.stem+'.bin');entries.delete(project.stem+'_hollowing.bin');entries.set(stem+'.bin',meshBytes);
  entries.set('scene.bin',transformSceneBytes(encode(scene),true));
  return {buffer:await writeLysContainer(project.manifest,entries),supportReport:prepared.report};
}

export async function exportLys(project,data,options={}) {
  return (await exportLysWithReport(project,data,options)).buffer;
}
