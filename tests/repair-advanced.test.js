import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import createCore from 'meshfix-wasm/dist/meshfix-core.js';
import {fromManifold,toManifold,binarySTL,parseSTL,cutCavities} from '../src/geometry.js';
import {repairAdvanced} from '../src/repair-advanced.js';
import {repairSolid} from '../src/repair-solid.js';
const m=await Module();m.setup();const core=await createCore();
function cube(){const s=m.Manifold.cube([20,20,20],true),data=fromManifold(s);s.delete();return {...data,offset:[100,20,30],size:[20,20,20]};}
function fin(distance=.001){
 const d=cube(),a=d.indices[0]*3,b=d.indices[1]*3;
 // A third face on a solid's edge, with its tip just off the original surface.
 const tip=[0,1,2].map(k=>(d.positions[a+k]+d.positions[b+k])/2);
 for(let k=0;k<3;k++)if(d.positions[a+k]===d.positions[b+k]){tip[k]+=Math.sign(tip[k])*distance;break;}
 const id=d.positions.length/3;d.positions=new Float32Array([...d.positions,...tip]);d.indices=new Uint32Array([...d.indices,d.indices[0],d.indices[1],id]);return d;
}
test('Advanced repair handles a small non-manifold fin, preserves input and supports cavity/export',async()=>{
 const d=fin(),p=d.positions.slice(),i=d.indices.slice();
 const {repaired,solid}=await repairSolid(m,d,{},async()=>core);
 try{
  assert.equal(repaired.repairReport.method,'advanced');assert.equal(repaired.repairReport.boundaryEdges,0);
  assert.equal(repaired.repairReport.removedFaces,1);assert.ok(repaired.repairReport.maxSampledSurfaceDistance<.002);
  assert.deepEqual(d.positions,p);assert.deepEqual(d.indices,i);assert.ok(Math.abs(solid.volume()-8000)<.01);
  const cut=cutCavities(m,solid,[{point:[0,0,10],normal:[0,0,1],diameter:3,thickness:1,diameterAllowance:.2,depthAllowance:.1}]);
  const round=toManifold(m,parseSTL(binarySTL(fromManifold(cut),d.offset)));
  assert.ok(cut.volume()<solid.volume());assert.ok(Math.abs(round.volume()-cut.volume())<.01);round.delete();cut.delete();
 }finally{solid.delete();}
});
test('Advanced repair refuses to silently remove a substantial protrusion',()=>{
 const d=fin(1);assert.throws(()=>repairAdvanced(d,{},core),/0,05 mm|não conseguiu/);
});
test('Advanced repair obeys the same hole size limit and zero disables filling',()=>{
 const d=cube();d.indices=d.indices.slice(3);
 assert.throws(()=>repairAdvanced(d,{maxHoleSize:5},core),/excedem/);
 assert.throws(()=>repairAdvanced(d,{maxHoleSize:0},core),/desativado/);
});
test('A user can disable advanced repair; the engine is not loaded',async()=>{
 let called=false;await assert.rejects(()=>repairSolid(m,fin(),{advancedRepair:false},async()=>{called=true;return core;}),/mais de duas faces/);assert.equal(called,false);
});
test('Simple repairs do not load the advanced engine',async()=>{
 const d=cube();d.indices=new Uint32Array([...d.indices,...d.indices.slice(0,3)]);
 const {solid,repaired}=await repairSolid(m,d,{},async()=>{throw new Error('Must not load');});
 assert.equal(repaired.repairReport.method,'conservative');solid.delete();
});
test('Advanced repair keeps a hollow interior when orienting shells',()=>{
 const a=m.Manifold.cube([20,20,20],true),b=m.Manifold.cube([12,12,12],true),s=a.subtract(b),d=fromManifold(s);
 const repaired=repairAdvanced(d,{},core),solid=toManifold(m,repaired);
 assert.ok(Math.abs(solid.volume()-6272)<.01);solid.delete();s.delete();b.delete();a.delete();
});
test('Invalid options never trigger the fallback engine',async()=>{
 await assert.rejects(()=>repairSolid(m,cube(),{advancedRepair:'yes'},async()=>{throw new Error('Must not load');}),/opção/);
});
