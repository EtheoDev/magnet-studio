import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {encode} from '@msgpack/msgpack';
import {cutLysCavities} from '../src/lys-cavities.js';
import {readLysContainer,readLysMesh,writeLysMesh,writeLysContainer,transformSceneBytes,importLys,exportLys,exportLysWithReport} from '../src/lys.js';
import {fromManifold,cutWithReinforcement,toManifold,parseSTL,binarySTL,createCutter,createReinforcement} from '../src/geometry.js';
const m=await Module();m.setup();
const pocket={point:[0,0,10],normal:[0,0,1],diameter:6,thickness:3,diameterAllowance:.2,depthAllowance:.1,reinforce:true,wall:1.5,bottom:1.5};
async function fixture(change=s=>s){
  const outer=m.Manifold.cube([20,20,20],true),inner=m.Manifold.cube([16,16,16],true);
  const a=fromManifold(outer),b=fromManifold(inner);outer.delete();inner.delete();
  for(let i=0;i<b.indices.length;i+=3)[b.indices[i+1],b.indices[i+2]]=[b.indices[i+2],b.indices[i+1]];
  const scene={appVersion:'7.6.4',objects:{present:{byId:{o1:{id:'o1',type:'file',name:'Synthetic',properties:{hash:'mesh'},scale:{x:1,y:1,z:1},rotation:{x:10,y:20,z:30},position:{x:4,y:5,z:6},hollowing:{enabled:true,outer:2},holes:['h1'],foundation:{enabled:true,type:'vectorielWall'}}}}},supports:{present:{byId:{s1:{id:'s1',tip:{x:1,y:2,z:3},custom:'preserve'}},allIds:['s1']}},holes:{present:{byId:{h1:{id:'h1',objectId:'o1',tip:{x:8,y:0,z:10},tipNormal:{x:0,y:0,z:1},settings:{type:'cylinder',diameter:2,depth:3}}},allIds:['h1']}}};
  change(scene);
  return writeLysContainer({version:'3.1.0'},new Map([['mesh.bin',writeLysMesh(a)],['mesh_hollowing.bin',writeLysMesh(b)],['scene.bin',transformSceneBytes(encode(scene),true)]]));
}
function free(p){p.solid.delete();p.envelope.delete();}

test('LYS export reconnects contacts and preserves unresolved contacts with a report instead of blocking the file',async()=>{
  const p=await importLys(m,await fixture(s=>{
    s.supports.present.byId.s1={id:'s1',objectIdTip:'o1',tip:{x:2,y:0,z:10},tipNormal:{x:0,y:0,z:1},base:{x:2,y:0,z:20},parentTipId:null,parentBaseId:'trunk',settings:{tip:{type:'cone',length:3,angle:100,pointDiameter:.6,penetration:0},base:{diameter:1.3}}};
  }));let result;
  try{
    result=cutLysCavities(m,p.solid,[pocket],p.envelope,p.project).solid;
    const {buffer,supportReport}=await exportLysWithReport(p.project,fromManifold(result));
    assert.equal(supportReport.adjusted,1);assert.equal(supportReport.unresolved,0);
    const again=await importLys(m,buffer);
    try{
      const fixed=again.project.scene.supports.present.byId.s1,original=p.project.scene.supports.present.byId.s1;
      assert.ok(Math.abs(fixed.tip.z-6.9)<1e-5);assert.ok(Math.abs(fixed.settings.tip.length-6.1)<1e-5);
      assert.deepEqual(fixed.base,original.base);assert.deepEqual(fixed.settings.base,original.settings.base);
      assert.equal(original.tip.z,10);assert.equal(original.settings.tip.length,3);
      assert.ok(Math.abs(again.solid.volume()-result.volume())<.001);
    }finally{free(again);}
    const supports=p.project.scene.supports.present;
    supports.byId.s2={...structuredClone(supports.byId.s1),id:'s2',tip:{x:0,y:0,z:10}};
    supports.allIds.push('s2');
    const before=structuredClone(p.project.scene);
    const partial=await exportLysWithReport(p.project,fromManifold(result));
    assert.equal(partial.supportReport.adjusted,1);assert.equal(partial.supportReport.unresolved,1);
    assert.equal(partial.supportReport.issues[0].id,'s2');
    const restored=await importLys(m,partial.buffer);
    try{
      assert.deepEqual(restored.project.scene.supports.present.byId.s2,supports.byId.s2);
      assert.ok(Math.abs(restored.project.scene.supports.present.byId.s1.tip.z-6.9)<1e-5);
      assert.ok(Math.abs(restored.solid.volume()-result.volume())<.001);
    }finally{free(restored);}
    assert.deepEqual(p.project.scene,before);
  }finally{result?.delete();free(p);}
});

test('LYS imports hollow mesh and drains and roundtrips support parameters unchanged',async()=>{
  const p=await importLys(m,await fixture());
  try{
    assert.equal(p.info.supports,1);assert.equal(p.info.drains,1);assert.equal(p.info.wall,2);
    assert.ok(p.solid.volume()<3904);assert.equal(p.solid.status(),'NoError');
    const out=await exportLys(p.project,fromManifold(p.solid));const decoded=await readLysContainer(out);
    assert.deepEqual(decoded.scene.supports,p.project.scene.supports);
    const old=p.project.scene.objects.present.byId.o1,next=decoded.scene.objects.present.byId.o1;
    for(const key of ['position','rotation','scale','foundation'])assert.deepEqual(next[key],old[key]);
    assert.equal(next.hollowing.enabled,false);assert.equal(decoded.entries.has('mesh_hollowing.bin'),false);
    assert.deepEqual(decoded.scene.holes.present.allIds,[]);assert.equal(old.hollowing.enabled,true);
    const again=await importLys(m,out);try{assert.ok(Math.abs(again.solid.volume()-p.solid.volume())<.001);}finally{free(again);}
  }finally{free(p);}
});
test('LYS rejects truncated, overlapping and tampered entries before use',async()=>{
  const original=await fixture();
  await assert.rejects(readLysContainer(original.slice(0,-10)),/incompleto/);
  const changed=original.slice(0);new Uint8Array(changed)[changed.byteLength-1]^=1;
  await assert.rejects(readLysContainer(changed),/integridade/);
  const parsed=await readLysContainer(original);parsed.manifest.mangoFiles['mesh_hollowing.bin'].offset='0';
  // Construct a header with no hashes to exercise range overlap independently.
  for(const info of Object.values(parsed.manifest.mangoFiles))delete info.integrity;
  const json=new TextEncoder().encode(JSON.stringify(parsed.manifest));const size=4+Math.ceil((json.length+4)/4)*4;
  const oldStart=8+new DataView(original).getUint32(4,true);const bytes=new Uint8Array(8+size+original.byteLength-oldStart),v=new DataView(bytes.buffer);
  [4,size,size-4,json.length].forEach((n,i)=>v.setUint32(i*4,n,true));bytes.set(json,16);bytes.set(new Uint8Array(original,oldStart),8+size);
  await assert.rejects(readLysContainer(bytes.buffer),/sobrepostas/);
});
test('LYS rejects unsupported scale, multiple objects and modifiers without silent loss',async()=>{
  for(const [edit,pattern] of [
    [s=>s.objects.present.byId.o1.scale.x=2,/escala/],
    [s=>s.objects.present.byId.o2={...s.objects.present.byId.o1,id:'o2'},/uma peça/],
    [s=>s.objects.present.byId.o1.hollowing.infillEnabled=true,/preenchimento/],
    [s=>s.holes.present.byId.h1.settings.type='square',/furo/]
  ])await assert.rejects(importLys(m,await fixture(edit)),pattern);
});
test('LYS mesh decoder rejects bad indices and nonfinite coordinates',()=>{
  const cube=m.Manifold.cube([2,2,2]),data=fromManifold(cube);cube.delete();
  const indices=writeLysMesh(data);new DataView(indices.buffer).setUint32(20,99999,true);assert.throws(()=>readLysMesh(indices),/Índice/);
  const coord=writeLysMesh(data);new DataView(coord.buffer).setFloat32(20+data.indices.length*4,NaN,true);assert.throws(()=>readLysMesh(coord),/Coordenada/);
});
test('Internal reinforcement provides a floor in a hollow shell and stays inside original envelope',async()=>{
  const p=await importLys(m,await fixture());let result;
  try{
    result=cutWithReinforcement(m,p.solid,[pocket],p.envelope,p.project.drains);
    assert.equal(result.status(),'NoError');assert.ok(result.volume()>p.solid.volume());
    const escaped=result.subtract(p.envelope);assert.ok(escaped.volume()<1e-6);escaped.delete();
    const floor=m.Manifold.cube([1,1,.5],true).translate([0,0,6]);const filled=result.intersect(floor);assert.ok(filled.volume()>.49);filled.delete();floor.delete();
    const cavity=m.Manifold.cube([1,1,2],true).translate([0,0,8]);const empty=result.intersect(cavity);assert.ok(empty.volume()<1e-6);empty.delete();cavity.delete();
    const restored=toManifold(m,parseSTL(binarySTL(fromManifold(result))));assert.ok(Math.abs(restored.volume()-result.volume())<.001);restored.delete();
  }finally{result?.delete();free(p);}
});
test('Reinforcement rejects invalid dimensions while preserving original',async()=>{
  const p=await importLys(m,await fixture());const volume=p.solid.volume();
  try{
    assert.throws(()=>cutWithReinforcement(m,p.solid,[{...pocket,bottom:NaN}],p.envelope,[]),/reforço/);
    assert.equal(p.solid.volume(),volume);
  }finally{free(p);}
});
test('Overlapping reinforcements do not refill earlier magnet pockets',async()=>{
  const p=await importLys(m,await fixture(s=>s.holes.present.byId={}));let result;
  try{
    result=cutWithReinforcement(m,p.solid,[{...pocket,point:[-2,0,10]},{...pocket,point:[2,0,10]}],p.envelope,[]);
    for(const x of [-2,2]){const box=m.Manifold.cube([1,1,2],true).translate([x,0,8]);const overlap=result.intersect(box);assert.ok(overlap.volume()<1e-6);overlap.delete();box.delete();}
  }finally{result?.delete();free(p);}
});

function boxVolume(solid,center,size){
  const primitive=m.Manifold.cube(size,true),box=primitive.translate(center);primitive.delete();
  const overlap=solid.intersect(box);try{return overlap.volume();}finally{box.delete();overlap.delete();}
}
test('Distant drainage remains open and a 30 percent central drain pierces only the cavity floor',async()=>{
  const p=await importLys(m,await fixture());let result;
  try{
    const cut=cutLysCavities(m,p.solid,[pocket],p.envelope,p.project);result=cut.solid;
    assert.equal(cut.drainReport.removed,0);assert.equal(cut.drainReport.added,1);
    assert.ok(Math.abs(cut.drainReport.diameters[0]-1.86)<1e-10);
    assert.ok(boxVolume(result,[8,0,9],[.5,.5,1])<1e-6);
    assert.ok(boxVolume(result,[0,0,6],[1,1,1])<1e-6);
    assert.ok(boxVolume(result,[1.3,0,6],[.3,.3,.5])>.044);
    assert.ok(boxVolume(result,[0,0,-9],[1,1,1])>.99);
    const exported=await exportLys(p.project,fromManifold(result)),again=await importLys(m,exported);
    try{assert.ok(Math.abs(again.solid.volume()-result.volume())<.001);assert.deepEqual(again.project.scene.supports,p.project.scene.supports);}finally{free(again);}
  }finally{result?.delete();free(p);}
});
test('A partially overlapping original hole is closed entirely, with untouched holes preserved',async()=>{
  const p=await importLys(m,await fixture(s=>{
    s.holes.present.byId.h1.tip.x=4;
    s.holes.present.byId.h1.settings.diameter=4;
    s.holes.present.byId.h2={...structuredClone(s.holes.present.byId.h1),id:'h2',tip:{x:-7,y:0,z:10},settings:{type:'cylinder',diameter:2,depth:3}};
  }));let result;
  try{
    const cut=cutLysCavities(m,p.solid,[pocket],p.envelope,p.project);result=cut.solid;
    assert.deepEqual(cut.drainReport.removedIndices,[0]);
    // x=5.5 lies outside the 4.6mm reinforcement radius but inside the old hole.
    assert.ok(boxVolume(result,[5.5,0,9],[.3,.3,.5])>.044);
    assert.ok(boxVolume(result,[-7,0,9],[.3,.3,.5])<1e-6);
    assert.ok(boxVolume(result,[0,0,6],[.5,.5,.5])<1e-6);
    const reset=cutLysCavities(m,p.solid,[],p.envelope,p.project);
    assert.equal(reset.solid,p.solid);assert.ok(boxVolume(reset.solid,[5.5,0,9],[.3,.3,.5])<1e-6);
  }finally{result?.delete();free(p);}
});
test('A drain cutter extending through empty space cannot falsely remove a remote opening',async()=>{
  const p=await importLys(m,await fixture(s=>{
    // The side-wall cutter reaches into the top cavity reinforcement through
    // existing empty space; the actual side-wall opening remains far away.
    s.holes.present.byId.h1.tip={x:10,y:0,z:5};s.holes.present.byId.h1.tipNormal={x:1,y:0,z:0};
    s.holes.present.byId.h1.settings={type:'cylinder',diameter:2,depth:7};
  }));let result;
  try{
    const cutter=createCutter(m,p.project.drains[0]),boss=createReinforcement(m,pocket,p.envelope),oldConflict=boss.intersect(cutter);
    assert.ok(oldConflict.volume()>1e-5,'Previous collision check would have blocked this cavity');oldConflict.delete();boss.delete();cutter.delete();
    const cut=cutLysCavities(m,p.solid,[pocket],p.envelope,p.project);result=cut.solid;assert.equal(cut.drainReport.removed,0);assert.ok(boxVolume(result,[9,0,5],[.5,.5,.5])<1e-6);}finally{result?.delete();free(p);}
});
test('Central drainage rejects a floor beyond the first void without damaging the original',async()=>{
  const p=await importLys(m,await fixture());const volume=p.solid.volume();
  try{assert.throws(()=>cutLysCavities(m,p.solid,[{...pocket,thickness:19}],p.envelope,p.project),/parede oposta|espaço interno/);assert.equal(p.solid.volume(),volume);}finally{free(p);}
});
test('Central drainage works without reinforcement and for sub-millimeter magnets',async()=>{
  const p=await importLys(m,await fixture());let result;
  try{const cut=cutLysCavities(m,p.solid,[{...pocket,diameter:.5,diameterAllowance:0,thickness:.5,reinforce:false}],p.envelope,p.project);result=cut.solid;assert.equal(cut.drainReport.diameters[0],.15);assert.ok(boxVolume(result,[0,0,8.5],[.05,.05,.05])<1e-8);}finally{result?.delete();free(p);}
});

test('Moving a cavity restores original drains; repeating a cut is deterministic',async()=>{
  const p=await importLys(m,await fixture(s=>{s.holes.present.byId.h1.tip.x=4;s.holes.present.byId.h1.settings.diameter=4;}));const results=[];
  try{
    const initial=cutLysCavities(m,p.solid,[pocket],p.envelope,p.project);results.push(initial.solid);
    assert.equal(initial.drainReport.removed,1);
    const moved={...pocket,point:[-4,0,10],diameter:3,wall:.5};
    const next=cutLysCavities(m,p.solid,[moved],p.envelope,p.project);results.push(next.solid);
    const repeated=cutLysCavities(m,p.solid,[moved],p.envelope,p.project);results.push(repeated.solid);
    assert.equal(next.drainReport.removed,0);assert.ok(boxVolume(next.solid,[4,0,9],[.5,.5,.5])<1e-6);
    assert.ok(boxVolume(next.solid,[0,0,9],[.5,.5,.5])>.124);
    assert.ok(Math.abs(next.solid.volume()-repeated.solid.volume())<1e-8);
  }finally{results.forEach(r=>r.delete());free(p);}
});
test('Multiple cavities receive independent central drains and survive STL roundtrip',async()=>{
  const p=await importLys(m,await fixture(s=>s.holes.present.byId={}));let result;
  try{
    const cavities=[-3,3].map(x=>({...pocket,point:[x,0,10],diameter:3,wall:.5}));
    const cut=cutLysCavities(m,p.solid,cavities,p.envelope,p.project);result=cut.solid;
    assert.equal(cut.drainReport.added,2);
    for(const x of [-3,3])assert.ok(boxVolume(result,[x,0,6],[.25,.25,.5])<1e-6);
    const restored=toManifold(m,parseSTL(binarySTL(fromManifold(result))));try{assert.ok(Math.abs(restored.volume()-result.volume())<.001);}finally{restored.delete();}
  }finally{result?.delete();free(p);}
});
