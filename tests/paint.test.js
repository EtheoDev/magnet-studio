import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Vector3, Triangle } from 'three';
import { fromManifold, toManifold, binarySTL, parseSTL } from '../src/geometry.js';
import { buildTopology, FaceSelection, selectionBoundary, connectedBrush, smoothSelection } from '../src/paint-selection.js';
import { separatePainted, buildSeatSurfaces, applyPaintKey, keyDimensions } from '../src/paint-cut.js';
import { triangleSweep, verifyInsertion } from '../src/paint-validation.js';
const m = await Module(); m.setup();
const seat = { width: 1, depth: 1, seatingGap: 0, direction: [0, 0, 1], maleSelected: true, refinement: 4 };
function fixture(nonplanar = false) {
  const sphere = m.Manifold.sphere(20, 32), data = fromManifold(sphere), topology = buildTopology(data);
  const mask = new Uint8Array(data.indices.length / 3);
  for (let f = 0; f < mask.length; f++) {
    const p = [0, 0, 0];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) p[k] += data.positions[data.indices[f * 3 + j] * 3 + k] / 3;
    mask[f] = Number(p[2] > (nonplanar ? 2 * Math.sin(p[0] / 10) * Math.cos(p[1] / 10) : 0));
  }
  return { sphere, data, topology, mask };
}
const dispose = p => { p.selected.delete(); p.remaining.delete(); };
test('topology is compact, closed, and selection finds complete circumference', () => {
  const f = fixture();
  try { const d = selectionBoundary(f.data, f.topology, f.mask); assert.equal(d.loops.length, 1); assert.equal(d.ambiguousVertices, 0); assert.equal(d.openEdges, 0); assert.equal(d.selectedComponents, 1); assert.equal(d.remainingComponents, 1); } finally { f.sphere.delete(); }
});
test('one stroke records only changed faces; undo/redo preserves mask identity', () => {
  const s = new FaceSelection(2_100_000), mask = s.mask;
  s.paint([2, 3, 4], true); s.paint([3, 4, 5], true); s.commit();
  assert.equal(s.undoStack[0].byteLength, 16); s.history(); assert.equal(s.count, 0); assert.equal(s.mask, mask);
  s.history(true); assert.equal(s.count, 4); s.paint([3], false); s.commit(); s.history(); assert.equal(s.mask[3], 1);
  s.invert(); assert.equal(s.count, mask.length - 4); s.history(); assert.equal(s.count, 4);
});
test('brush cannot jump to a nearby unconnected surface or through an occluded bridge', () => {
  const neighbors = new Int32Array([1,-1,-1, 0,2,-1, 1,3,-1, 2,-1,-1, -1,-1,-1]);
  assert.deepEqual(connectedBrush(neighbors, 0, new Set([0,1,3,4])), [0,1]);
  assert.deepEqual(connectedBrush(neighbors, 4, new Set([0,1,3,4])), [4]);
});
test('smooth preview does not mutate selection; reports isolated islands', () => {
  const f = fixture();
  try { const mask = new Uint8Array(f.mask.length); mask[0] = 1; mask[mask.length - 1] = 1; const copy = mask.slice(); smoothSelection(mask, f.topology.neighbors, 3); assert.deepEqual(mask, copy); assert.equal(selectionBoundary(f.data, f.topology, mask).selectedComponents, 2); assert.throws(() => separatePainted(m, f.sphere, f.data, f.topology, mask, seat), /ilhas|ambígua/); } finally { f.sphere.delete(); }
});
for (const nonplanar of [false, true]) test(`compatible closed seats, unchanged exterior, STL round trip (nonplanar=${nonplanar})`, () => {
  const f = fixture(nonplanar); let p;
  try {
    const surfaces = buildSeatSurfaces(m, f.data, f.topology, f.mask, seat);
    for (let i = 0; i < f.data.indices.length; i += 3) {
      const part = f.mask[i / 3] ? surfaces.selected : surfaces.remaining;
      // Every exterior position remains bit-for-bit present in its part.
      const original = Array.from(f.data.positions.subarray(f.data.indices[i] * 3, f.data.indices[i] * 3 + 3));
      let found = false;
      for (let j = 0; j < part.positions.length; j += 3) if (original.every((x, k) => x === part.positions[j + k])) { found = true; break; }
      assert.ok(found);
    }
    p = separatePainted(m, f.sphere, f.data, f.topology, f.mask, seat);
    assert.ok(Math.abs(p.selected.volume() + p.remaining.volume() - f.sphere.volume()) < .02);
    assert.equal(p.report.path.status, 'clear');
    for (const part of [p.selected, p.remaining]) {
      const parsed = parseSTL(binarySTL(fromManifold(part), [37, -15, 80])), restored = toManifold(m, parsed);
      try { assert.ok(Math.abs(restored.volume() - part.volume()) < .1); assert.equal(restored.status(), 'NoError'); const box=part.boundingBox(); parsed.offset.forEach((x,k)=>assert.ok(Math.abs(x-(box.min[k]+box.max[k])/2-[37,-15,80][k])<.0001)); } finally { restored.delete(); }
    }
  } finally { if (p) dispose(p); f.sphere.delete(); }
});
test('invalid directions, all-selected regions and excessive bands are diagnosed', () => {
  const f = fixture();
  try {
    assert.throws(() => buildSeatSurfaces(m, f.data, f.topology, f.mask, {...seat, direction:[0,0,0]}), /direção/);
    assert.throws(() => buildSeatSurfaces(m, f.data, f.topology, f.mask, {...seat, direction:[1,0,0]}), /contorno|direção/);
    assert.throws(() => buildSeatSurfaces(m, f.data, f.topology, f.mask, {...seat, width:40}), /faixa/);
    assert.throws(() => buildSeatSurfaces(m, f.data, f.topology, new Uint8Array(f.mask.length).fill(1), seat), /Pinte/);
  } finally { f.sphere.delete(); }
});
for (const shape of ['round','rectangular','tapered']) for (const maleSelected of [true,false]) test(`${shape} key and dimensional clearance, maleSelected=${maleSelected}`, () => {
  const f = fixture(); let prepared, result;
  try {
    prepared = separatePainted(m, f.sphere, f.data, f.topology, f.mask, {...seat, maleSelected});
    const key = {shape, maleSelected, point:[0,0,maleSelected ? -1 : 1], rotation:[0,0,25], width:4, height:3, length:4, anchor:2, lateral:.2, bottom:.3, wall:1};
    result = applyPaintKey(m, prepared, key);
    assert.equal(result.report.path.status, 'clear');
    assert.ok(result.report.overlap < .001);
    assert.ok(result.report.key.socket.length === 4.3);
    if (shape !== 'tapered') assert.equal(keyDimensions(key,true).width, 4.4);
    for (const part of [result.selected,result.remaining]) assert.equal(part.status(),'NoError');
  } finally { if (result) dispose(result); if (prepared) dispose(prepared); f.sphere.delete(); }
});
test('continuous sweep catches collisions between endpoints and clears separated parts', () => {
  const a = new Triangle(new Vector3(-1,-1,0),new Vector3(1,-1,0),new Vector3(0,1,0));
  const b = new Triangle(new Vector3(0,-.5,1),new Vector3(0,.5,1),new Vector3(0,0,2));
  assert.notEqual(triangleSweep(a,b,new Vector3(0,0,3)),null);
  const moving = m.Manifold.cube([2,2,2],true), obstacle0=m.Manifold.cube([5,5,.2],true), obstacle=obstacle0.translate([0,0,4]);
  try { assert.equal(verifyInsertion(fromManifold(moving),fromManifold(obstacle),[0,0,1]).status,'blocked'); } finally {moving.delete();obstacle.delete();obstacle0.delete();}
});

test('multiple nested openings are reported and rejected rather than capped as overlapping disks', () => {
  const outer=m.Manifold.cylinder(20,10,10,32,true), hole=m.Manifold.cylinder(22,5,5,32,true), hollow=outer.subtract(hole), data=fromManifold(hollow), topology=buildTopology(data);
  const mask=new Uint8Array(data.indices.length/3);
  for(let f=0;f<mask.length;f++)mask[f]=Number([0,1,2].reduce((n,j)=>n+data.positions[data.indices[f*3+j]*3+2],0)>0);
  try {
    assert.equal(selectionBoundary(data,topology,mask).loops.length,2);
    assert.throws(()=>buildSeatSurfaces(m,data,topology,mask,seat),/contorno|Aberturas|direção/);
  } finally {outer.delete();hole.delete();hollow.delete();}
});

test('seating gap removes a measured slit and keys preserve exterior after STL roundtrip', () => {
  const f=fixture(true);let prepared, keyed;
  try {
    prepared=separatePainted(m,f.sphere,f.data,f.topology,f.mask,{...seat,seatingGap:.2});
    assert.ok(prepared.report.removedForSeating>0);
    const ring=prepared.reference.rings[0];
    const key={shape:'tapered',maleSelected:true,point:[0,0,ring.height],rotation:[0,0,38],width:4,height:3,length:4,anchor:2,lateral:.2,bottom:.3,wall:1};
    keyed=applyPaintKey(m,prepared,key);
    for(const solid of [keyed.selected,keyed.remaining]) {
      const data=fromManifold(solid), parsed=parseSTL(binarySTL(data,[35,-80,120])), restored=toManifold(m,parsed);
      try {assert.ok(Math.abs(restored.volume()-solid.volume())<.1);const components=restored.decompose();assert.equal(components.length,1);components.forEach(p=>p.delete());}finally{restored.delete();}
      const outside=solid.subtract(f.sphere);try{assert.ok(Math.abs(outside.volume())<.01);}finally{outside.delete();}
    }
    assert.equal(keyed.report.path.status,'clear');
    assert.ok(Math.abs((keyDimensions(key,true).offset/.2)-Math.sqrt(1+keyDimensions(key).slope**2))<1e-10);
  } finally {if(keyed)dispose(keyed);if(prepared)dispose(prepared);f.sphere.delete();}
});

test('wall containment rejects a key breaking through the exterior and leaves the prepared pair unchanged', () => {
  const f=fixture();let prepared;
  try {
    prepared=separatePainted(m,f.sphere,f.data,f.topology,f.mask,seat);
    const before=prepared.selected.volume();
    assert.throws(()=>applyPaintKey(m,prepared,{shape:'round',maleSelected:true,point:[0,0,-1],rotation:[0,0,0],width:4,height:3,length:25,anchor:2,lateral:.2,bottom:.3,wall:1}),/Espessura/);
    assert.equal(prepared.selected.volume(),before);
  } finally {if(prepared)dispose(prepared);f.sphere.delete();}
});

test('sweep detects a narrow obstacle between many possible sample poses and reports budget exhaustion', () => {
  const moving=m.Manifold.cube([.1,.1,.1],true), obstacle0=m.Manifold.cube([10,10,.001],true), obstacle=obstacle0.translate([0,0,27.384]);
  try {
    const a=fromManifold(moving),b=fromManifold(obstacle);
    assert.equal(verifyInsertion(a,b,[0,0,1]).status,'blocked');
    assert.equal(verifyInsertion(a,b,[0,0,1],0).status,'inconclusive');
  } finally {moving.delete();obstacle0.delete();obstacle.delete();}
});

test('strongly nonplanar boundary closes from one shared reference without moving the original surface', () => {
  const f=fixture();let prepared;
  try {
    for(let v=0;v<f.data.positions.length;v+=3) {
      const x=f.data.positions[v],y=f.data.positions[v+1],z=f.data.positions[v+2];
      // A volume-preserving nonlinear shear makes the equator vary by 12 mm.
      f.data.positions[v+2]=z+6*Math.sin(x/7)*Math.cos(y/9);
    }
    const source=toManifold(m,f.data);
    try {
      prepared=separatePainted(m,source,f.data,f.topology,f.mask,{...seat,width:2,depth:.5});
      assert.equal(prepared.report.path.status,'clear');assert.ok(prepared.report.outside<.001);
      assert.ok(Math.abs(prepared.selected.volume()+prepared.remaining.volume()-source.volume())<.05);
    } finally {source.delete();}
  } finally {if(prepared)dispose(prepared);f.sphere.delete();}
});

test('two disjoint openings on a connected arch receive complementary seats', () => {
  const baseBlock=m.Manifold.cube([40,12,4],true), post=m.Manifold.cube([6,6,20],true);
  const left=post.translate([-12,0,10]),right=post.translate([12,0,10]),bridge=baseBlock.translate([0,0,20]);
  const union=m.Manifold.union([baseBlock,left,right,bridge]),base=union.refine(4),data=fromManifold(base),topology=buildTopology(data),mask=new Uint8Array(data.indices.length/3);
  let pair;
  try {
    for(let f=0;f<mask.length;f++)mask[f]=Number([0,1,2].reduce((n,j)=>n+data.positions[data.indices[f*3+j]*3+2],0)>30);
    const diagnostics=selectionBoundary(data,topology,mask);assert.equal(diagnostics.loops.length,2);assert.equal(diagnostics.selectedComponents,1);assert.equal(diagnostics.remainingComponents,1);
    pair=separatePainted(m,base,data,topology,mask,{...seat,width:.5,depth:.5});
    assert.equal(pair.reference.rings.length,2);assert.equal(pair.report.path.status,'clear');
    assert.ok(Math.abs(pair.selected.volume()+pair.remaining.volume()-base.volume())<.001);
  } finally {if(pair)dispose(pair);for(const solid of[baseBlock,post,left,right,bridge,union,base])solid.delete();}
});
