import test from 'node:test';import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {reconnectLysSupports} from '../src/lys-supports.js';
import {fromManifold,toGeometry,cutWithReinforcement,axialCylinder} from '../src/geometry.js';
const m=await Module();m.setup();
const cavity={point:[0,0,10],normal:[0,0,1],diameter:6,thickness:3,diameterAllowance:.2,depthAllowance:.1,reinforce:true,wall:1.5,bottom:1.5};
function support(id,x,extra={}){return {id,objectIdTip:'o1',tip:{x,y:0,z:10},tipNormal:{x:0,y:0,z:1},newTipNormal:null,base:{x,y:0,z:-15},parentTipId:null,parentBaseId:'trunk',settings:{tip:{type:'cone',length:3,angle:100,diameter:1.3,pointDiameter:.6,penetration:0},base:{joinLength:10,joinDiameter:1.3}},...extra};}
function fixture(){
 const envelope=m.Manifold.cube([20,20,20],true),inner=m.Manifold.cube([16,16,16],true),base=envelope.subtract(inner);inner.delete();
 const cut=cutWithReinforcement(m,base,[cavity],envelope);
 const drain=axialCylinder(m,cavity,1.86,4.7),edited=cut.subtract(drain);drain.delete();cut.delete();
 return {envelope,base,edited,original:fromManifold(base),data:fromManifold(edited),free(){envelope.delete();base.delete();edited.delete();}};
}
const vec=p=>new Vector3(p.x,p.y,p.z);
const socket=s=>vec(s.tip).addScaledVector(vec(s.tipNormal),s.settings.tip.length);
test('Detached cone reaches the new pocket floor while its original socket and shaft remain fixed',()=>{
 const f=fixture(),s=support('s1',2),scene={supports:{present:{byId:{s1:s}}},other:{preserve:'all'}};
 try{
  const result=reconnectLysSupports(scene,'o1',f.original,f.data),fixed=result.scene.supports.present.byId.s1;
  assert.equal(result.report.adjusted,1);assert.equal(result.report.unresolved,0);
  assert.ok(Math.abs(fixed.tip.z-6.9)<1e-5);assert.ok(Math.abs(fixed.settings.tip.length-6.1)<1e-5);
  assert.ok(socket(s).distanceTo(socket(fixed))<1e-10);
  assert.deepEqual(fixed.base,s.base);assert.deepEqual(fixed.settings.base,s.settings.base);assert.deepEqual(result.scene.other,scene.other);
  assert.equal(s.tip.z,10);assert.equal(s.settings.tip.length,3);
  const geometry=toGeometry(f.data),tree=new MeshBVH(geometry);assert.ok(tree.closestPointToPoint(vec(fixed.tip)).distance<1e-5);geometry.dispose();
 }finally{f.free();}
});
test('Unaffected supports, parent junctions, other objects and pre-existing detached points remain unchanged',()=>{
 const f=fixture(),byId={far:support('far',7),junction:support('junction',2,{parentTipId:'another'}),other:support('other',2,{objectIdTip:'other'}),air:support('air',2,{tip:{x:2,y:0,z:13}})};
 try{const scene={supports:{present:{byId}}},result=reconnectLysSupports(scene,'o1',f.original,f.data);assert.equal(result.report.adjusted,0);assert.equal(result.report.unresolved,0);assert.deepEqual(result.scene,scene);}finally{f.free();}
});
test('A support aligned with the central drain is not extended through it to the opposite wall',()=>{
 const f=fixture(),scene={supports:{present:{byId:{s1:support('s1',0)}}}};
 try{const result=reconnectLysSupports(scene,'o1',f.original,f.data);assert.equal(result.report.adjusted,0);assert.equal(result.report.unresolved,1);assert.deepEqual(result.scene,scene);}finally{f.free();}
});
test('Unsupported cone orientations are explicitly reported instead of changing the shaft attachment',()=>{
 const f=fixture(),s=support('s1',2);s.settings.tip.angle=50;
 try{const scene={supports:{present:{byId:{s1:s}}}},result=reconnectLysSupports(scene,'o1',f.original,f.data);assert.equal(result.report.adjusted,0);assert.equal(result.report.unresolved,1);assert.deepEqual(result.scene,scene);}finally{f.free();}
});
test('Reconnection is idempotent and works in rotated mesh-local coordinates',()=>{
 const f=fixture(),s=support('s1',2),rotation=[35,20,15],old=f.base.rotate(rotation),next=f.edited.rotate(rotation);
 // Use a three.js transform from the same rotation order as Manifold's global XYZ.
 const rotate=v=>v.applyAxisAngle(new Vector3(1,0,0),35*Math.PI/180).applyAxisAngle(new Vector3(0,1,0),20*Math.PI/180).applyAxisAngle(new Vector3(0,0,1),15*Math.PI/180);
 const point=rotate(vec(s.tip)),normal=rotate(vec(s.tipNormal));s.tip={x:point.x,y:point.y,z:point.z};s.tipNormal={x:normal.x,y:normal.y,z:normal.z};
 try{
  const scene={supports:{present:{byId:{s1:s}}}},data=fromManifold(next),result=reconnectLysSupports(scene,'o1',fromManifold(old),data);
  assert.equal(result.report.adjusted,1);assert.ok(socket(s).distanceTo(socket(result.scene.supports.present.byId.s1))<1e-5);
  const again=reconnectLysSupports(result.scene,'o1',data,data);assert.equal(again.report.adjusted,0);assert.deepEqual(again.scene,result.scene);
 }finally{old.delete();next.delete();f.free();}
});
