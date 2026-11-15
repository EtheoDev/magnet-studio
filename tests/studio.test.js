import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {Group,Mesh,MeshStandardMaterial} from 'three';
import {fromManifold,toGeometry} from '../src/geometry.js';
import {flattenModel,colorRegionMask,coloredGeometry} from '../src/model-import.js';
import {buildTopology} from '../src/paint-selection.js';
import {splitPlane,independentSplit} from '../src/split-tools.js';
import {saveProject,loadProject} from '../src/project-file.js';
const m=await Module();m.setup();
test('import preserves native color regions, face order, connected selection and project round trip',()=>{
 const cube=m.Manifold.cube([10,10,10],true),root=new Group();
 for(const [x,color] of [[-20,'#ff0000'],[0,'#0000ff'],[20,'#ff0000']]){const mesh=new Mesh(toGeometry(fromManifold(cube)),new MeshStandardMaterial({color}));mesh.position.x=x;root.add(mesh);}
 try{const data=flattenModel(root),top=buildTopology(data),all=colorRegionMask(data,top.neighbors,0),one=colorRegionMask(data,top.neighbors,0,0);assert.equal(data.palette.length,2);assert.equal(all.reduce((a,b)=>a+b),24);assert.equal(one.reduce((a,b)=>a+b),12);const g=coloredGeometry(data);for(let i=0;i<data.indices.length;i++){const a=data.indices[i],b=g.index.array[i];for(let k=0;k<3;k++)assert.equal(g.attributes.position.array[b*3+k],data.positions[a*3+k]);}g.dispose();const saved=loadProject(saveProject(data,all,'colors',[]));assert.deepEqual(saved.data.faceRegions,data.faceRegions);assert.deepEqual(saved.mask,all);const base=m.Manifold.compose(root.children.map(mesh=>cube.translate([mesh.position.x,0,0])));let parts;try{parts=independentSplit(m,base,data,all,{});assert.equal(parts.report.canKey,false);assert.equal(parts.selected.volume(),2000);assert.equal(parts.remaining.volume(),1000);}finally{parts?.selected.delete();parts?.remaining.delete();base.delete();}}
 finally{cube.delete();root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
});
test('oblique plane creates closed halves with matching section and conserved volume',()=>{const cube=m.Manifold.cube([20,20,20],true);let p;try{p=splitPlane(m,cube,fromManifold(cube),{direction:[1,1,1],percent:50});assert.equal(p.selected.status(),'NoError');assert.equal(p.remaining.status(),'NoError');assert.ok(Math.abs(p.selected.volume()-4000)<.001);assert.equal(p.reference.rings.length,1);assert.ok(p.reference.rings[0].inner.length>=3);assert.equal(p.report.path.status,'clear');}finally{p?.selected.delete();p?.remaining.delete();cube.delete();}});
