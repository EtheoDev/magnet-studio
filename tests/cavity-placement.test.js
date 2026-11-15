import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3 } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { fromManifold, toGeometry } from '../src/geometry.js';
import { pickCavitySurface } from '../src/cavity-placement.js';

const m=await Module();m.setup();
test('Positioning over a LYS drain stays on the original exterior, including oblique rays',()=>{
  const outer=m.Manifold.cube([20,20,20],true),inner=m.Manifold.cube([16,16,16],true),shell=outer.subtract(inner);
  const cylinder=m.Manifold.cylinder(4,2,2,64),drain=cylinder.translate([0,0,7]),drilled=shell.subtract(drain);
  const material=new MeshBasicMaterial({side:DoubleSide});
  const mesh=solid=>{const g=toGeometry(fromManifold(solid));g.boundsTree=new MeshBVH(g);const mesh=new Mesh(g,material);mesh.raycast=acceleratedRaycast;return mesh;};
  const base=mesh(drilled),exterior=mesh(outer),ray=new Raycaster();ray.firstHitOnly=true;
  try{
    for(const direction of [[0,0,-1],[.1,0,-1]]){
      const d=new Vector3(...direction).normalize();
      // Each ray crosses the center of the opening at z=10.
      ray.set(new Vector3(0,0,10).addScaledVector(d,-20),d);
      const wrong=pickCavitySurface(ray,base),hit=pickCavitySurface(ray,base,exterior);
      assert.ok(wrong.point[2]<-7,'The drilled shell reproduces the far-wall placement bug');
      assert.ok(Math.abs(hit.point[2]-10)<1e-6);
      assert.ok(Math.abs(hit.point[0])<1e-6);
      assert.deepEqual(hit.normal,[0,0,1]);
      assert.deepEqual(pickCavitySurface(ray,base,exterior),hit,'Preview and click must use the same target');
    }
    ray.set(new Vector3(5,0,30),new Vector3(0,0,-1));
    assert.deepEqual(pickCavitySurface(ray,base,exterior),pickCavitySurface(ray,base),'Placement away from drains is unchanged');
    ray.set(new Vector3(30,0,30),new Vector3(0,0,-1));
    assert.equal(pickCavitySurface(ray,base,exterior),null,'An exterior miss must never fall through to a different target');
    ray.set(new Vector3(0,0,0),new Vector3(0,0,1));
    assert.equal(pickCavitySurface(ray,base,exterior),null,'Back-facing internal clicks are rejected');
    ray.set(new Vector3(0,0,30),new Vector3(0,0,-1));
    assert.equal(pickCavitySurface(ray,exterior).point[2],10,'STL uses its own surface without a LYS exterior');
  }finally{
    base.geometry.dispose();exterior.geometry.dispose();material.dispose();
    [outer,inner,shell,cylinder,drain,drilled].forEach(s=>s.delete());
  }
});
