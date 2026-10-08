import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { parseSTL, toManifold, fromManifold, cutCavities, binarySTL, validateCavity } from '../src/geometry.js';
const m = await Module(); m.setup();
const cavity = (extra={}) => ({ point:[0,0,10],normal:[0,0,1],diameter:6,thickness:3,diameterAllowance:.2,depthAllowance:.1,...extra });
const near = (actual,expected,tolerance) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);

test('Blind cavity removes the requested volume and retains a closed mesh',()=>{
  const base=m.Manifold.cube([20,20,20],true),result=cutCavities(m,base,[cavity()]);
  try {assert.equal(result.status(),'NoError');near(8000-result.volume(),Math.PI*3.1**2*3.1,.2);assert.equal(result.genus(),0);near(result.boundingBox().min[2],-10,.0001);}finally{result.delete();base.delete();}
});
test('Cutter follows an arbitrary face orientation',()=>{
  const base=m.Manifold.cube([20,20,20],true);
  const results=[[10,0,0],[0,-10,0],[0,0,-10]].map(point=>cutCavities(m,base,[cavity({point,normal:point.map(v=>v/10)})]));
  try{for(const r of results){assert.equal(r.status(),'NoError');near(8000-r.volume(),Math.PI*3.1**2*3.1,.2);}}finally{results.forEach(r=>r.delete());base.delete();}
});
test('Multiple cavities subtract independently without mutating the source',()=>{
  const base=m.Manifold.cube([20,20,20],true),result=cutCavities(m,base,[cavity({point:[-5,0,10]}),cavity({point:[5,0,10]})]);
  try{near(8000-result.volume(),2*Math.PI*3.1**2*3.1,.4);near(base.volume(),8000,.00001);}finally{result.delete();base.delete();}
});
test('Binary export and reimport preserve geometry and original coordinates',()=>{
  const base=m.Manifold.cube([20,20,20],true),cut=cutCavities(m,base,[cavity()]);
  const data=fromManifold(cut),offset=[43,-21,107];
  const parsed=parseSTL(binarySTL(data,offset));const restored=toManifold(m,parsed);
  try{for(let k=0;k<3;k++)near(parsed.offset[k],offset[k],.0001);near(restored.volume(),cut.volume(),.005);}finally{restored.delete();cut.delete();base.delete();}
});
test('Inch import applies a 25.4 scale and preserves the scaled offset',()=>{
  const base=m.Manifold.cube([1,2,3],false),parsed=parseSTL(binarySTL(fromManifold(base)),25.4);
  try{parsed.size.forEach((v,k)=>near(v,[25.4,50.8,76.2][k],.0001));parsed.offset.forEach((v,k)=>near(v,[12.7,25.4,38.1][k],.0001));}finally{base.delete();}
});
test('An open mesh is rejected before boolean processing',()=>{
  const base=m.Manifold.cube([20,20,20],true),data=fromManifold(base);data.indices=data.indices.slice(3);
  try{assert.throws(()=>toManifold(m,data),/fechada/);}finally{base.delete();}
});
test('Invalid dimensions, direction and empty files produce readable errors',()=>{
  assert.throws(()=>validateCavity(cavity({diameter:NaN})),/números/);
  assert.throws(()=>validateCavity(cavity({diameterAllowance:-1})),/folgas/);
  assert.throws(()=>validateCavity(cavity({normal:[0,0,0]})),/normalizada/);
  assert.throws(()=>parseSTL(new ArrayBuffer(0)),/vazio/);
});
test('ASCII STL imports the same closed tetrahedron as binary STL',()=>{
  const base=m.Manifold.tetrahedron(),data=fromManifold(base);
  let text='solid tetra\n';
  for(let i=0;i<data.indices.length;i+=3){text+='facet normal 0 0 0\nouter loop\n';for(let j=0;j<3;j++){const k=data.indices[i+j]*3;text+=`vertex ${data.positions[k]} ${data.positions[k+1]} ${data.positions[k+2]}\n`;}text+='endloop\nendfacet\n';}
  text+='endsolid tetra';const parsed=parseSTL(new TextEncoder().encode(text).buffer),solid=toManifold(m,parsed);
  try{near(solid.volume(),base.volume(),.0001);}finally{solid.delete();base.delete();}
});

test('Malformed binary triangle count is rejected before allocating parser arrays',()=>{
  const invalid=new ArrayBuffer(100);new DataView(invalid).setUint32(80,0xffffffff,true);
  assert.throws(()=>parseSTL(invalid),/incompleto/);
});
