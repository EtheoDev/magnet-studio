// Local opt-in regression: never commits or transmits the user's model.
// node tests/paint-project-regression.js /path/model.magnetlab /tmp/output-prefix
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {loadProject} from '../src/project-file.js';
import {buildTopology} from '../src/paint-selection.js';
import {preparePaintSelection} from '../src/paint-preparation.js';
import {separatePainted} from '../src/paint-cut.js';
import {toManifold,fromManifold,binarySTL,parseSTL,tangentBasis} from '../src/geometry.js';
import {smoothSelectionBrush,vertexFaceIndex} from '../src/straighten-brush.js';
const project=loadProject(readFileSync(process.argv[2])),topology=buildTopology(project.data),prepared=preparePaintSelection(project.data,topology,project.mask),m=await Module();m.setup();
let base,pair,selectionField=null;
if(process.argv[5]==='align'){
 const edge=prepared.diagnostics.edges[Math.floor(prepared.diagnostics.edges.length/4)],center=[0,1,2].map(k=>(project.data.positions[edge[0]*3+k]+project.data.positions[edge[1]*3+k])/2),{u,v}=tangentBasis(prepared.direction),candidates=[],data=project.data;
 for(let f=0;f<prepared.mask.length;f++){const p=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)p[k]+=data.positions[data.indices[f*3+j]*3+k]/3;if(Math.hypot(...p.map((x,k)=>x-center[k]))<2.5)candidates.push(f);}
 const change=smoothSelectionBrush(data,prepared.mask,null,candidates,center,u,v,2,1,vertexFaceIndex(data));assert.ok(change,'the local boundary must be found by the brush');selectionField=new Float32Array(data.positions.length/3).fill(NaN);change.vertices.forEach((id,j)=>selectionField[id]=change.levels[j]);
 for(const f of change.faces){let value=0;for(let j=0;j<3;j++){const level=selectionField[data.indices[f*3+j]];value+=Number.isFinite(level)?level:prepared.mask[f]?1:-1;}prepared.mask[f]=Number(value>=0);}
}
try{
 base=toManifold(m,project.data);pair=separatePainted(m,base,project.data,topology,prepared.mask,{method:'patch',direction:prepared.direction,patchDepth:1,contourRadius:Number(process.argv[4]??.35),selectionField});
 assert.equal(pair.report.path.status,'clear');assert.deepEqual(pair.report.components,[1,1]);
 for(const [name,part] of [['regiao',pair.selected],['restante',pair.remaining]]){const buffer=binarySTL(fromManifold(part),project.data.offset),roundtrip=toManifold(m,parseSTL(buffer));try{assert.ok(Math.abs(roundtrip.volume()-part.volume())<.1);}finally{roundtrip.delete();}if(process.argv[3])writeFileSync(`${process.argv[3]}-${name}.stl`,new Uint8Array(buffer));}
 const intersection=pair.selected.intersect(pair.remaining);try{assert.ok(Math.abs(intersection.volume())<.001);}finally{intersection.delete();}
 const report={faces:topology.faces,originalOpenEdges:topology.openEdges,originalAmbiguousEdges:topology.ambiguousEdges,adjustedFaces:prepared.changed.length,...pair.report};
 if(process.argv[3])writeFileSync(`${process.argv[3]}-verificacao.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{pair?.selected.delete();pair?.remaining.delete();base?.delete();}
