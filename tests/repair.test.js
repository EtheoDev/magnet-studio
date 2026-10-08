import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromManifold,toManifold,binarySTL,parseSTL,cutCavities} from '../src/geometry.js';
import {repairMesh,diagnoseMesh} from '../src/repair.js';
const m=await Module();m.setup();
function cube(size=20){const b=m.Manifold.cube([size,size,size],true),d=fromManifold(b);b.delete();return {...d,offset:[0,0,0],size:[size,size,size]};}
function volume(data){const s=toManifold(m,data);try{return s.volume();}finally{s.delete();}}
function near(a,b,t=.01){assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);}

test('Repair removes duplicate and degenerate triangles',()=>{
  const data=cube();data.indices=new Uint32Array([...data.indices,...data.indices.slice(0,3),0,0,1]);
  const r=repairMesh(data);near(volume(r),8000);assert.equal(r.repairReport.duplicatesRemoved,1);assert.equal(r.repairReport.degenerateRemoved,1);
});
test('Repair corrects inconsistent and globally inverted faces',()=>{
  const data=cube();[data.indices[1],data.indices[2]]=[data.indices[2],data.indices[1]];
  const r=repairMesh(data);near(volume(r),8000);assert.equal(r.repairReport.facesReoriented,1);
  const inverted=cube();for(let i=0;i<inverted.indices.length;i+=3)[inverted.indices[i+1],inverted.indices[i+2]]=[inverted.indices[i+2],inverted.indices[i+1]];
  near(volume(repairMesh(inverted)),8000);
});
test('Repair closes a simple missing triangle when the contour is within the explicit limit',()=>{
  const data=cube();data.indices=data.indices.slice(3);assert.equal(diagnoseMesh(data).boundaryEdges,3);
  const r=repairMesh(data,{maxHoleSize:40});near(volume(r),8000);assert.equal(r.repairReport.holesFilled,1);assert.equal(r.repairReport.facesAdded,1);assert.equal(r.patchPositions.length,9);assert.equal(r.repairReport.facesReoriented,0);
});
test('Repair does not close a contour beyond the limit and does not mutate the input',()=>{
  const data=cube();data.indices=data.indices.slice(3);const snapshot=new Uint32Array(data.indices);
  assert.throws(()=>repairMesh(data,{maxHoleSize:5}),/excedem/);assert.deepEqual(data.indices,snapshot);
  assert.throws(()=>repairMesh(data,{maxHoleSize:0}),/bordas abertas/);
});
test('Repair welds only boundary vertices within the selected distance',()=>{
  const data=cube(),id=data.indices[0],n=data.positions.length/3;
  data.positions=new Float32Array([...data.positions,data.positions[id*3]+.0005,data.positions[id*3+1],data.positions[id*3+2]]);data.indices[0]=n;
  const r=repairMesh(data,{weldTolerance:.001,maxHoleSize:0});assert.equal(r.repairReport.verticesWelded,1);near(volume(r),8000,.2);assert.ok(r.repairReport.maxVertexDisplacement<=.001);
  assert.throws(()=>repairMesh(data,{weldTolerance:0,maxHoleSize:0}),/bordas abertas/);
});
test('Repair preserves the interior of a hollow part',()=>{
  const outer=m.Manifold.cube([20,20,20],true),inner=m.Manifold.cube([12,12,12],true),hollow=outer.subtract(inner),data=fromManifold(hollow);
  [data.indices[1],data.indices[2]]=[data.indices[2],data.indices[1]];
  const r=repairMesh(data);near(volume(r),8000-1728);assert.equal(r.repairReport.components,2);
  hollow.delete();inner.delete();outer.delete();
});
test('Repair preserves a hollow part even if all faces were globally inverted',()=>{
  const outer=m.Manifold.cube([20,20,20],true),inner=m.Manifold.cube([12,12,12],true),hollow=outer.subtract(inner),data=fromManifold(hollow);
  for(let i=0;i<data.indices.length;i+=3)[data.indices[i+1],data.indices[i+2]]=[data.indices[i+2],data.indices[i+1]];
  near(volume(repairMesh(data)),6272);hollow.delete();inner.delete();outer.delete();
});
test('Repaired mesh remains cuttable and survives STL export/reimport',()=>{
  const data=cube();data.indices=data.indices.slice(3);const repaired=repairMesh(data,{maxHoleSize:40}),base=toManifold(m,repaired);
  const cut=cutCavities(m,base,[{point:[0,0,10],normal:[0,0,1],diameter:6,thickness:3,diameterAllowance:.2,depthAllowance:.1}]);
  const reimport=toManifold(m,parseSTL(binarySTL(fromManifold(cut),[10,20,30])));near(reimport.volume(),cut.volume());reimport.delete();cut.delete();base.delete();
});
test('Repair refuses non-manifold edges instead of silently dropping extra faces',()=>{
  const data=cube();data.positions=new Float32Array([...data.positions,0,0,0]);data.indices=new Uint32Array([...data.indices,data.indices[0],data.indices[1],8]);
  assert.throws(()=>repairMesh(data),/mais de duas faces/);
});
test('Repair rejects invalid settings',()=>{
  assert.throws(()=>repairMesh(cube(),{weldTolerance:1}),/tolerância/);
  assert.throws(()=>repairMesh(cube(),{maxHoleSize:NaN}),/limite/);
});

test('A missing triangle on a hollow shell is repaired without filling its internal void',()=>{
  const outer=m.Manifold.cube([20,20,20],true),inner=m.Manifold.cube([12,12,12],true),hollow=outer.subtract(inner),data=fromManifold(hollow);
  data.indices=data.indices.slice(3);near(volume(repairMesh(data,{maxHoleSize:40})),6272);
  hollow.delete();inner.delete();outer.delete();
});
test('A nonplanar opening is left for a deeper repair',()=>{
  const data=cube();const first=Array.from(data.indices.slice(0,3));let other=-1;
  for(let f=3;f<data.indices.length;f+=3){const tri=Array.from(data.indices.slice(f,f+3));if(tri.filter(i=>first.includes(i)).length!==2)continue;
    const union=[...new Set([...first,...tri])],points=union.map(i=>Array.from(data.positions.slice(i*3,i*3+3)));
    if(![0,1,2].some(k=>points.every(p=>p[k]===points[0][k]))){other=f;break;}
  }
  assert.ok(other>0);data.indices=new Uint32Array([...data.indices.slice(3,other),...data.indices.slice(other+3)]);
  assert.throws(()=>repairMesh(data,{maxHoleSize:40}),/não planos/);
});
test('Nested coplanar contours are not capped as overlapping disks',()=>{
  const outer=m.Manifold.cylinder(20,10,10,32,true),inner=m.Manifold.cylinder(22,6,6,32,true),tube=outer.subtract(inner),data=fromManifold(tube);
  const keep=[];for(let f=0;f<data.indices.length;f+=3){const ids=Array.from(data.indices.slice(f,f+3));if(!ids.every(i=>data.positions[i*3+2]===10))keep.push(...ids);}data.indices=new Uint32Array(keep);
  assert.throws(()=>repairMesh(data,{maxHoleSize:40}),/complexos ou ambíguos/);
  tube.delete();inner.delete();outer.delete();
});
