import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromManifold,toManifold,toGeometry} from '../src/geometry.js';
import {MeshBVH} from 'three-mesh-bvh';
import {Vector3} from 'three';
import {buildTopology,selectionBoundary} from '../src/paint-selection.js';
import {smoothSelectionBrush,vertexFaceIndex,clipSelectionTriangle} from '../src/straighten-brush.js';
import {SurfaceSelection} from '../src/surface-selection.js';
import {separatePainted} from '../src/paint-cut.js';
import {saveProject,loadProject} from '../src/project-file.js';
import {selectionSurface} from '../src/selection-surface.js';
const m=await Module();m.setup();
test('smoothing the demo arm produces two closed parts without floating fragments',()=>{
 const sphere=m.Manifold.sphere(1,64),body=sphere.scale([13,8,20]),armShape=sphere.scale([5,5,18]),arm=armShape.translate([15,0,0]),base=body.add(arm);let result;
 try{
  const data=fromManifold(base),mask=new Uint8Array(data.indices.length/3),topology=buildTopology(data);
  for(let f=0;f<mask.length;f++)mask[f]=Number([0,1,2].reduce((sum,j)=>sum+data.positions[data.indices[f*3+j]*3],0)/3>12);
  const edge=selectionBoundary(data,topology,mask).edges[0],center=[0,1,2].map(k=>(data.positions[edge[0]*3+k]+data.positions[edge[1]*3+k])/2),candidates=[];
  for(let f=0;f<mask.length;f++)if([0,1,2].some(j=>Math.hypot(...center.map((v,k)=>v-data.positions[data.indices[f*3+j]*3+k]))<3))candidates.push(f);
  const change=smoothSelectionBrush(data,mask,null,candidates,center,[0,1,0],[0,0,1],3,.5),field=new Float32Array(data.positions.length/3).fill(NaN);change.vertices.forEach((v,j)=>field[v]=change.levels[j]);
  result=separatePainted(m,base,data,topology,mask,{method:'patch',patchClosure:'boundary',direction:[1,0,0],patchDepth:1,selectionField:field});
  assert.equal(result.report.closed,true);assert.deepEqual(result.report.components,[1,1]);assert.equal(result.report.patchClosure,'boundary');assert.equal(result.report.patchDepth,0);assert.ok(Math.abs(result.report.volumes.reduce((a,b)=>a+b,0)-base.volume())<.001);
  const overlap=result.selected.intersect(result.remaining),outside=result.selected.subtract(base);
  try{assert.ok(Math.abs(overlap.volume())<1e-5);assert.ok(Math.abs(outside.volume())<base.volume()*1e-8,`outside volume ${outside.volume()}`);}finally{overlap.delete();outside.delete();}
  const surface=selectionSurface(data,mask,field),geometries=[result.remaining,result.selected].map(s=>toGeometry(fromManifold(s))),trees=geometries.map(g=>new MeshBVH(g)),point=new Vector3();
  try{for(let f=0;f<surface.mask.length;f++){
    point.set(0,0,0);for(let j=0;j<3;j++){const id=surface.data.indices[f*3+j]*3;point.x+=surface.data.positions[id]/3;point.y+=surface.data.positions[id+1]/3;point.z+=surface.data.positions[id+2]/3;}
    const nearest=trees[surface.mask[f]].closestPointToPoint(point);assert.ok(nearest.distance<1e-4,`source face ${f} side ${surface.mask[f]} must remain on its selected side, distance ${nearest.distance}`);
  }}finally{geometries.forEach(g=>g.dispose());}
  const deeper=separatePainted(m,base,data,topology,mask,{method:'patch',patchClosure:'boundary',direction:[1,0,0],patchDepth:4,selectionField:field});
  try{assert.ok(Math.abs(deeper.selected.volume()-result.selected.volume())<1e-6,'part separation must not add an inset wall controlled by depth');}finally{deeper.selected.delete();deeper.remaining.delete();}
 }finally{result?.selected.delete();result?.remaining.delete();base.delete();arm.delete();armShape.delete();body.delete();sphere.delete();}
});
test('continuous selection follows the source surface and cannot cut another object above it',()=>{
 const lower=m.Manifold.cube([4,4,2],true),upper=lower.translate([0,0,5]),base=m.Manifold.compose([lower,upper]);
 let result;
 try{
  const data=fromManifold(base),mask=new Uint8Array(data.indices.length/3),field=new Float32Array(data.positions.length/3).fill(NaN);
  for(let f=0;f<mask.length;f++)mask[f]=Number([0,1,2].every(j=>Math.abs(data.positions[data.indices[f*3+j]*3+2]-1)<1e-6));
  for(let id=0;id<field.length;id++)if(Math.abs(data.positions[id*3+2]-1)<1e-6)field[id]=data.positions[id*3]/2;
  const surface=selectionSurface(data,mask,field),topology=buildTopology(surface.data);assert.equal(topology.openEdges,0);assert.equal(topology.ambiguousEdges,0);
  result=separatePainted(m,base,data,buildTopology(data),mask,{method:'patch',direction:[0,0,1],patchDepth:.5,selectionField:field});
  assert.equal(result.report.method,'patch');const selected=fromManifold(result.selected);
  for(let i=2;i<selected.positions.length;i+=3)assert.ok(selected.positions[i]<=1.00001,'no projection onto the upper object');
  const retained=result.remaining.intersect(upper);try{assert.ok(Math.abs(retained.volume()-upper.volume())<1e-6);}finally{retained.delete();}
 }finally{result?.selected.delete();result?.remaining.delete();base.delete();lower.delete();upper.delete();}
});
test('brush smooths an organic selection without flattening its curve or moving the mesh',()=>{
 const cube=m.Manifold.cube([20,20,10],true),mesh=cube.refine(32),data=fromManifold(mesh);cube.delete();mesh.delete();data.offset=[0,0,0];data.size=[20,20,10];
 const mask=new Uint8Array(data.indices.length/3),candidates=[];
 for(let f=0;f<mask.length;f++){const center=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)center[k]+=data.positions[data.indices[f*3+j]*3+k]/3;mask[f]=Number(center[2]>4.99&&Math.hypot(center[0],center[1])<2.5);if(center[2]>4.99&&Math.hypot(center[0],center[1])<5)candidates.push(f);}
 const initial=mask.slice(),positions=data.positions.slice(),result=smoothSelectionBrush(data,mask,null,candidates,[0,0,5],[1,0,0],[0,1,0],4,1,vertexFaceIndex(data));assert.ok(result);assert.deepEqual(mask,initial);assert.deepEqual(data.positions,positions);
 const field=new Float32Array(data.positions.length/3).fill(NaN);result.vertices.forEach((id,j)=>field[id]=result.levels[j]);let intersections=0;
 const radii=[],quadrants=new Set();
 for(const f of candidates)for(const point of clipSelectionTriangle(data,mask,field,f)){const isSource=[0,1,2].some(j=>{const id=data.indices[f*3+j]*3;return Math.hypot(point[0]-data.positions[id],point[1]-data.positions[id+1])<1e-6;});if(!isSource){const radius=Math.hypot(point[0],point[1]);assert.ok(Math.abs(radius-2.5)<.5,`organic radius ${radius}`);radii.push(radius);quadrants.add(`${point[0]>0}:${point[1]>0}`);intersections++;}}
 assert.equal(quadrants.size,4,'the boundary remains a closed curve, not a fitted line');
 const spread=Math.sqrt(radii.reduce((sum,r)=>sum+(r-2.5)**2,0)/radii.length);
 assert.ok(spread<.2,`radial roughness ${spread}`);
 const unfiltered=smoothSelectionBrush(data,mask,null,candidates,[0,0,5],[1,0,0],[0,1,0],4,1e-9,vertexFaceIndex(data));
 const rawField=new Float32Array(field.length).fill(NaN);unfiltered.vertices.forEach((id,j)=>rawField[id]=unfiltered.levels[j]);
 const rawRadii=[];
 for(const f of candidates)for(const point of clipSelectionTriangle(data,mask,rawField,f)){
   if(![0,1,2].some(j=>{const id=data.indices[f*3+j]*3;return Math.hypot(point[0]-data.positions[id],point[1]-data.positions[id+1])<1e-6;}))rawRadii.push(Math.hypot(point[0],point[1]));
 }
 const radialVariation=rs=>{const mean=rs.reduce((a,b)=>a+b,0)/rs.length;return Math.sqrt(rs.reduce((sum,r)=>sum+(r-mean)**2,0)/rs.length);};
 assert.ok(radialVariation(radii)<radialVariation(rawRadii),'smoothing reduces the stair-step radial variation');
 assert.ok(intersections>5);for(let i=0;i<field.length;i++)if(Math.hypot(data.positions[i*3],data.positions[i*3+1])>4.001)assert.ok(Number.isNaN(field[i]));
 const loaded=loadProject(saveProject(data,mask,'brush',[],field));assert.deepEqual(loaded.selectionField,field);
 const base=toManifold(m,data);let parts;try{parts=separatePainted(m,base,data,buildTopology(data),mask,{method:'patch',direction:[0,0,1],patchDepth:1,contourRadius:0,selectionField:field});assert.equal(parts.report.closed,true);assert.equal(parts.report.path.status,'clear');assert.ok(Math.abs(parts.selected.volume()+parts.remaining.volume()-base.volume())<.0001);}finally{parts?.selected.delete();parts?.remaining.delete();base.delete();}
});
test('a field-only stroke is one undo/redo action and mixed mask edits preserve both states',()=>{
 const s=new SurfaceSelection(3,4);s.paint([0],true);s.commit();const original=s.mask.slice();s.paintField([0,1],[.25,-.5],[0,1]);s.paintField([1],[-.75],[0,1]);s.commit();assert.equal(s.undoStack.length,2);assert.equal(s.field[1],-.75);s.history();assert.equal(s.field,null);assert.deepEqual(s.mask,original);s.history(true);assert.equal(s.field[1],-.75);
 const before=s.field.slice();s.clearField();s.replace(new Uint8Array([0,1,0]));s.history();assert.deepEqual(s.mask,original);assert.deepEqual(s.field,before);s.history(true);assert.deepEqual(s.mask,new Uint8Array([0,1,0]));assert.ok(s.field.every(Number.isNaN));
});
