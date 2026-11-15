import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { fromManifold } from '../src/geometry.js';
import { buildTopology, FaceSelection } from '../src/paint-selection.js';
import { partDistances, proposePart } from '../src/part-selection.js';
const m=await Module();m.setup();
function ellipsoid(scale,point){const a=m.Manifold.sphere(1,48),b=a.scale(scale);try{return b.translate(point);}finally{a.delete();b.delete();}}
function closestFace(data,point){let seed=0,best=Infinity;for(let f=0;f<data.indices.length/3;f++){const center=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)center[k]+=data.positions[data.indices[f*3+j]*3+k]/3;const d=Math.hypot(...center.map((x,k)=>x-point[k]));if(d<best){best=d;seed=f;}}return seed;}

test('one front click proposes both sides of a head at its neck, without selecting lower torso',()=>{
  const body=ellipsoid([13,8,20],[0,0,0]),head=ellipsoid([8,7,9],[0,0,26]),solid=body.add(head),data=fromManifold(solid),topology=buildTopology(data);
  try{
    const seed=closestFace(data,[0,-7,28]),field=partDistances(data,topology,seed),proposal=proposePart(field,topology.faces,'head');
    assert.equal(proposal.method,'neck-section');assert.equal(proposal.mask[seed],1);
    let front=0,back=0;
    for(let f=0;f<proposal.mask.length;f++)if(proposal.mask[f])for(let j=0;j<3;j++){const v=data.indices[f*3+j]*3;assert.ok(data.positions[v+2]>16);if(data.positions[v+1]>3)back++;if(data.positions[v+1]<-3)front++;}
    assert.ok(front>100&&back>100);
    const smaller=proposePart(field,topology.faces,'head',proposal.radius*.8),larger=proposePart(field,topology.faces,'head',proposal.radius*1.2);
    assert.ok(smaller.selectedFaces<proposal.selectedFaces&&larger.selectedFaces>proposal.selectedFaces);
    const selection=new FaceSelection(topology.faces);selection.replace(proposal.mask);selection.history();assert.equal(selection.count,0);selection.history(true);assert.deepEqual(selection.mask,proposal.mask);
    const eye=proposePart(field,topology.faces,'eye');assert.ok(eye.selectedFaces<proposal.selectedFaces/4);
  }finally{body.delete();head.delete();solid.delete();}
});

test('a detached eye is selected completely without jumping to a nearby face',()=>{
  const eye=ellipsoid([2,2,2],[0,0,0]),face=ellipsoid([4,4,4],[7,0,0]),solid=m.Manifold.compose([eye,face]),data=fromManifold(solid),topology=buildTopology(data);
  try{
    const field=partDistances(data,topology,closestFace(data,[0,-2,0])),proposal=proposePart(field,topology.faces,'eye');
    assert.equal(proposal.isolated,true);assert.equal(proposal.selectedFaces,field.componentFaces);
    for(let f=0;f<proposal.mask.length;f++)if(proposal.mask[f])for(let j=0;j<3;j++)assert.ok(data.positions[data.indices[f*3+j]*3]<=2);
    assert.throws(()=>partDistances(data,topology,-1),/Clique/);assert.throws(()=>proposePart(field,topology.faces,'eye',NaN),/Alcance/);
  }finally{eye.delete();face.delete();solid.delete();}
});

test('a lateral arm proposal excludes the torso, head and opposite arm',()=>{
  const parts=[ellipsoid([13,8,20],[0,0,0]),ellipsoid([8,7,9],[0,0,26]),ellipsoid([5,5,18],[15,0,0]),ellipsoid([5,5,18],[-15,0,0]),ellipsoid([6,6,18],[6,0,-27]),ellipsoid([6,6,18],[-6,0,-27])];
  const solid=m.Manifold.union(parts),data=fromManifold(solid),topology=buildTopology(data);
  try{
    const field=partDistances(data,topology,closestFace(data,[19,-3,2])),proposal=proposePart(field,topology.faces,'arm');
    assert.equal(proposal.method,'neck-section');assert.ok(proposal.selectedFaces>100);
    for(let f=0;f<proposal.mask.length;f++)if(proposal.mask[f])for(let j=0;j<3;j++){const v=data.indices[f*3+j]*3;assert.ok(data.positions[v]>10,'included torso');assert.ok(data.positions[v+2]<20,'included head');}
  }finally{solid.delete();parts.forEach(p=>p.delete());}
});
