import test from 'node:test';import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {organicSplit,curvePoints,curveHeight,FIT_PROFILES} from '../src/organic.js';
import {binarySTL,fromManifold,parseSTL,toManifold} from '../src/geometry.js';
const m=await Module();m.setup();
const points=[[-25,0],[-10,2],[10,-2],[25,0]];
function withCube(fn){const cube=m.Manifold.cube([40,40,40],true);try{fn(cube);}finally{cube.delete();}}
function dispose(result){result.parts.forEach(p=>p.delete());}
function volume(s){try{return Math.abs(s.volume());}finally{s.delete();}}
test('Curved split conserves volume and coordinates in all three views',()=>withCube(base=>{
 for(const view of ['front','side','top']){const r=organicSplit(m,base,{view,points});try{assert.ok(Math.abs(r.report.volumes.reduce((a,b)=>a+b)-base.volume())<1e-5);assert.equal(volume(r.parts[0].intersect(r.parts[1])),0);assert.deepEqual(r.report.components,[1,1]);}finally{dispose(r);}}
}));
test('Round and deep joints remain inside original and STL round-trip remains valid',()=>withCube(base=>{
 for(const profile of Object.values(FIT_PROFILES)){const r=organicSplit(m,base,{view:'front',points,gap:profile.gap,joints:[{...profile,u:0,w:0}]});try{
  assert.equal(r.report.joints,1);assert.deepEqual(r.report.components,[1,1]);assert.ok(volume(r.parts[0].intersect(r.parts[1]))<1e-6);
  for(const s of r.parts){assert.ok(volume(s.subtract(base))<1e-6);const data=parseSTL(binarySTL(fromManifold(s)));const imported=toManifold(m,data);assert.ok(Math.abs(imported.volume()-s.volume())<.01);imported.delete();}
 }finally{dispose(r);}}
}));
test('Flat cut socket dimensions use clearance per side and extra depth',()=>withCube(base=>{
 const j={...FIT_PROFILES.filament,u:0,w:0};const r=organicSplit(m,base,{view:'front',points:[[-25,0],[25,0]],joints:[j]});try{
 const added=j.width*j.width*j.length;
 assert.ok(Math.abs(r.parts[0].volume()-(32000+added))<1e-4);
 assert.ok(Math.abs(r.parts[1].volume()-(32000-(j.width+2*j.clearance)**2*(j.length+j.bottom)))<1e-4);
 }finally{dispose(r);}
}));
test('Insufficient walls, overlapping connectors and invalid curves fail without changing base',()=>withCube(base=>{
 const baseOptions={view:'front',points,joints:[]},j={...FIT_PROFILES.resin,u:0,w:0};
 assert.throws(()=>organicSplit(m,base,{...baseOptions,points:[[-10,0],[10,0]]}),/largura/);
 assert.throws(()=>organicSplit(m,base,{...baseOptions,points:[[-25,50],[25,50]]}),/duas partes/);
 assert.throws(()=>organicSplit(m,base,{...baseOptions,joints:[{...j,w:19}]}),/falta material/);
 assert.throws(()=>organicSplit(m,base,{...baseOptions,joints:[j,j]}),/sobrepõem/);
 assert.throws(()=>organicSplit(m,base,{...baseOptions,joints:[{...j,clearance:NaN}]}),/números/);
 assert.equal(base.volume(),64000);
}));
test('Curve rejects backtracking and smooth interpolation does not overshoot',()=>{
 assert.throws(()=>curvePoints([[0,0],[2,1],[1,2],[4,0]]),/esquerda/);
 assert.deepEqual(curvePoints([[2,1],[0,0]]),[[0,0],[2,1]]);
 for(let u=0;u<=2;u+=.01){const y=curveHeight([[0,0],[2,1]],u);assert.ok(y>=0&&y<=1);}
});

test('Multiple joints remain separate, including on rotated cut views',()=>withCube(base=>{
 for(const view of ['front','side','top']){const r=organicSplit(m,base,{view,points,joints:[{...FIT_PROFILES.resin,u:-8,w:0},{...FIT_PROFILES.filament,u:8,w:0}]});try{assert.deepEqual(r.report.components,[1,1]);assert.equal(r.report.joints,2);assert.ok(volume(r.parts[0].intersect(r.parts[1]))<1e-6);}finally{dispose(r);}}
}));
test('Existing magnet cavities remain absent from both split parts',()=>withCube(base=>{
 const primitive=m.Manifold.cylinder(8,3,3,64),tool=primitive.translate([0,0,16]);primitive.delete();const hollow=base.subtract(tool);
 try{const r=organicSplit(m,hollow,{view:'front',points,joints:[]});try{for(const part of r.parts)assert.ok(volume(part.intersect(tool))<1e-6);assert.ok(Math.abs(r.report.volumes.reduce((a,b)=>a+b)-hollow.volume())<1e-5);}finally{dispose(r);}}finally{tool.delete();hollow.delete();}
}));
test('Face clearance removes the configured total gap along the assembly axis',()=>withCube(base=>{
 const r=organicSplit(m,base,{view:'front',points:[[-25,0],[25,0]],gap:.2});try{
 assert.ok(Math.abs(r.parts[0].volume()+r.parts[1].volume()-(64000-40*40*.2))<1e-5);
 assert.ok(Math.abs(r.parts[0].boundingBox().max[2]+.1)<1e-6);
 assert.ok(Math.abs(r.parts[1].boundingBox().min[2]-.1)<1e-6);
 }finally{dispose(r);}
 assert.throws(()=>organicSplit(m,base,{view:'front',points,gap:-1}),/entre faces/);
}));
