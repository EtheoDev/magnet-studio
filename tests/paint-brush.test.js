import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2, DoubleSide } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { fromManifold, toGeometry } from '../src/geometry.js';
import { buildTopology } from '../src/paint-selection.js';
import { surfaceBrush } from '../src/paint-brush.js';
const m=await Module();m.setup();Mesh.prototype.raycast=acceleratedRaycast;

test('visible connected brush stays on the near arm despite torso and rear arm inside its spatial radius',()=>{
  const front0=m.Manifold.sphere(2,32),front=front0.translate([0,0,5]), torso0=m.Manifold.sphere(2,32),torso=torso0.translate([4.2,0,5]),rear=front0.translate([0,0,0]);
  const solid=m.Manifold.compose([front,torso,rear]),geometry=toGeometry(fromManifold(solid));geometry.boundsTree=new MeshBVH(geometry);
  const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));mesh.updateMatrixWorld();
  const data={positions:geometry.attributes.position.array,indices:geometry.index.array},topology=buildTopology(data);
  const camera=new PerspectiveCamera(40,1,.01,100);camera.position.set(0,0,15);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const ray=new Raycaster();ray.firstHitOnly=true;ray.setFromCamera(new Vector2(0,0),camera);const hit=ray.intersectObject(mesh)[0];
  try {
    const selected=surfaceBrush(mesh,camera,hit,10,topology.neighbors);assert.ok(selected.length>20);
    for(const face of selected)for(let j=0;j<3;j++){
      const id=data.indices[face*3+j]*3;assert.ok(data.positions[id]<2.1);assert.ok(data.positions[id+2]>=3);
    }
    camera.position.set(0,0,-15);camera.lookAt(0,0,0);camera.updateMatrixWorld();ray.setFromCamera(new Vector2(0,0),camera);
    const back=surfaceBrush(mesh,camera,ray.intersectObject(mesh)[0],10,topology.neighbors);
    assert.ok(back.length>20);for(const face of back)for(let j=0;j<3;j++)assert.ok(data.positions[data.indices[face*3+j]*3+2]<=2.01);
  } finally {geometry.dispose();mesh.material.dispose();solid.delete();front0.delete();front.delete();torso0.delete();torso.delete();rear.delete();}
});

test('a shoulder connection outside brush reach cannot carry paint onto the nearby torso',()=>{
  const sphere=m.Manifold.sphere(2,64),arm=sphere.translate([4.2,0,0]),bridge0=m.Manifold.cube([6,.8,.8],true),bridge=bridge0.translate([2.1,0,2]);
  const solid=m.Manifold.union([sphere,arm,bridge]),geometry=toGeometry(fromManifold(solid));geometry.boundsTree=new MeshBVH(geometry);
  const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));mesh.updateMatrixWorld();
  const data={positions:geometry.attributes.position.array,indices:geometry.index.array},topology=buildTopology(data);
  const camera=new PerspectiveCamera(40,1,.01,100);camera.position.set(2.5,-15,0);camera.lookAt(2.5,0,0);camera.updateMatrixWorld();
  const ray=new Raycaster();ray.firstHitOnly=true;ray.setFromCamera(new Vector2(),camera);
  try {
    const selected=surfaceBrush(mesh,camera,ray.intersectObject(mesh)[0],1.5,topology.neighbors);assert.ok(selected.length>10);
    for(const face of selected)for(let j=0;j<3;j++)assert.ok(data.positions[data.indices[face*3+j]*3]>2.1,'paint crossed to torso');
    const parts=solid.decompose();assert.equal(parts.length,1);parts.forEach(p=>p.delete());
  } finally {geometry.dispose();mesh.material.dispose();for(const s of[sphere,arm,bridge0,bridge,solid])s.delete();}
});
