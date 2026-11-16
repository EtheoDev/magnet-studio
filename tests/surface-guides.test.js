import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, SphereGeometry, Vector3, Matrix4 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { surfaceGuides } from '../src/surface-guides.js';

const options={point:[0,0,2],normal:[0,0,1],right:[1,0,0],up:[0,1,0],radius:2,maxDistance:50};
const close=(a,b)=>assert.ok(Math.abs(a-b)<.01,`${a} should equal ${b}`);

test('Four surface guides measure the magnet edge to local borders and show balance on each axis',()=>{
  const geometry=new BoxGeometry(20,12,4),tree=new MeshBVH(geometry);
  try{
    const centered=surfaceGuides(tree,options);
    centered.arms.forEach((arm,i)=>{close(arm.clearance,i<2?8:4);assert.equal(arm.boundary,true);for(const point of arm.points)close(point[2],2);});
    assert.equal(centered.horizontalCentered,true);assert.equal(centered.verticalCentered,true);
    const offset=surfaceGuides(tree,{...options,point:[3,-1,2]});
    offset.arms.forEach((arm,i)=>close(arm.clearance,[11,5,5,3][i]));
    assert.equal(offset.horizontalCentered,false);assert.equal(offset.verticalCentered,false);
    const oversize=surfaceGuides(tree,{...options,point:[9.5,0,2]});
    close(oversize.arms[1].clearance,-1.5);assert.equal(oversize.arms[1].fits,false);
  }finally{geometry.dispose();}
});

test('Guides rotate with the view and follow tilted surfaces rather than the object bounding box',()=>{
  const geometry=new BoxGeometry(20,12,4),transform=new Matrix4().makeRotationX(.6).multiply(new Matrix4().makeRotationY(.4));
  geometry.applyMatrix4(transform);const tree=new MeshBVH(geometry);
  const transformed=p=>new Vector3(...p).applyMatrix4(transform).toArray();
  const direction=p=>new Vector3(...p).transformDirection(transform).toArray();
  try{
    const guides=surfaceGuides(tree,{...options,point:transformed([0,0,2]),normal:direction([0,0,1]),right:direction([0,1,0]),up:direction([-1,0,0])});
    guides.arms.forEach((arm,i)=>close(arm.clearance,i<2?4:8));
    assert.equal(guides.horizontalCentered,true);assert.equal(guides.verticalCentered,true);
  }finally{geometry.dispose();}
});

test('Guides stop at a gap instead of extending across a separate neighboring surface',()=>{
  const a=new BoxGeometry(5,12,2).translate(-2.5,0,0),b=new BoxGeometry(5,12,2).translate(4.5,0,0),geometry=mergeGeometries([a,b]),tree=new MeshBVH(geometry);
  try{
    const guides=surfaceGuides(tree,{...options,point:[-2,0,1],radius:1});
    close(guides.arms[1].clearance,1);
    for(const point of guides.arms[1].points)assert.ok(point[0]<.01);
  }finally{a.dispose();b.dispose();geometry.dispose();}
});

test('Curved guides remain on the near surface and limited traces do not claim centered placement',()=>{
  const geometry=new SphereGeometry(10,96,64),tree=new MeshBVH(geometry);
  try{
    const guides=surfaceGuides(tree,{...options,point:[0,0,10],radius:1});
    for(const arm of guides.arms){
      assert.ok(arm.clearance>8);assert.equal(arm.boundary,true);
      for(const point of arm.points){assert.ok(Math.abs(new Vector3(...point).length()-10)<.03);assert.ok(point[2]>4.5);}
    }
    const limited=surfaceGuides(tree,{...options,point:[0,0,10],radius:1,maxDistance:2});
    assert.equal(limited.horizontalCentered,false);assert.equal(limited.verticalCentered,false);
    for(const arm of limited.arms)assert.equal(arm.boundary,false);
  }finally{geometry.dispose();}
});
