import Module from 'manifold-3d';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2 } from 'three';
import { surfaceBrush } from '../src/paint-brush.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { writeFileSync } from 'node:fs';
import { fromManifold, toGeometry, toManifold, binarySTL, parseSTL } from '../src/geometry.js';
import { separatePainted, applyPaintKey } from '../src/paint-cut.js';
import { buildTopology, FaceSelection, selectionBoundary, connectedBrush, smoothSelection } from '../src/paint-selection.js';

const m = await Module(); m.setup();
const report = { date: new Date().toISOString(), runtime: process.version, platform: process.platform, architecture: process.arch, phases: {}, memory: {} };
function memory(name) { const usage=process.memoryUsage();report.memory[name]={rssMB:usage.rss/1e6,heapMB:usage.heapUsed/1e6,arrayBuffersMB:usage.arrayBuffers/1e6}; }
function measure(name,fn){const start=performance.now(),value=fn();report.phases[name]=performance.now()-start;memory(name);console.log(`${name}: ${report.phases[name].toFixed(1)} ms; RSS ${report.memory[name].rssMB.toFixed(1)} MB`);return value;}
const data=measure('source',()=>{const solid=m.Manifold.sphere(40,2048);try{return fromManifold(solid);}finally{solid.delete();}});
report.triangles=data.indices.length/3;
const geometry=toGeometry(data);
geometry.boundsTree=measure('bvh',()=>new MeshBVH(geometry,{maxLeafSize:10}));
// Match the installed BVH's reordered face IDs.
data.indices=geometry.index.array;
const topology=measure('topology',()=>buildTopology(data));
const mesh=new Mesh(geometry,new MeshBasicMaterial());mesh.raycast=acceleratedRaycast;mesh.updateMatrixWorld();
const camera=new PerspectiveCamera(40,1,.01,1000);camera.position.set(0,-120,50);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const ray=new Raycaster();ray.firstHitOnly=true;ray.setFromCamera(new Vector2(),camera);const hit=ray.intersectObject(mesh)[0];
const brush=measure('brushBVHVisibilityGeodesic',()=>surfaceBrush(mesh,camera,hit,2,topology.neighbors));report.brushFaces=brush.length;
mesh.material.dispose();
const selection=new FaceSelection(report.triangles);
measure('paintStroke',()=>{selection.paint(Array.from({length:1000},(_,i)=>i),true);selection.commit();});
report.strokeHistoryBytes=selection.undoStack[0].byteLength;
measure('undo',()=>selection.history());measure('redo',()=>selection.history(true));
const mask=new Uint8Array(report.triangles);
measure('hemisphereSelection',()=>{for(let f=0;f<mask.length;f++)mask[f]=Number(data.positions[data.indices[f*3]*3+2]+data.positions[data.indices[f*3+1]*3+2]+data.positions[data.indices[f*3+2]*3+2]>0);});
const diagnostics=measure('boundary',()=>selectionBoundary(data,topology,mask));
measure('smoothPreview',()=>smoothSelection(mask,topology.neighbors,2));
measure('connectedBrush',()=>connectedBrush(topology.neighbors,0,new Set(Array.from({length:2000},(_,i)=>i))));
report.boundaryEdges=diagnostics.edges.length;report.loops=diagnostics.loops.length;
report.typedSelectionAndTopologyMB=(mask.byteLength+topology.neighbors.byteLength)/1e6;
if(process.argv.includes('--solid')) {
  let base,parts,keyed;
  try {
    base=measure('validateSolid',()=>toManifold(m,data));
    parts=measure('separateAndSweep',()=>separatePainted(m,base,data,topology,mask,{width:1,depth:1,seatingGap:.1,direction:[0,0,1],maleSelected:true,refinement:4}));
    report.separation=parts.report;
    keyed=measure('keyAndSweep',()=>applyPaintKey(m,parts,{shape:'round',maleSelected:true,point:[0,0,-1],rotation:[0,0,0],width:4,height:3,length:4,anchor:2,lateral:.2,bottom:.3,wall:1}));
    report.key=keyed.report;
    const stl=measure('export',()=>binarySTL(fromManifold(keyed.selected),[17,-40,90]));
    measure('reimport',()=>{const solid=toManifold(m,parseSTL(stl));try{report.roundtrip={status:solid.status(),volumeDifference:Math.abs(solid.volume()-keyed.selected.volume())};}finally{solid.delete();}});
  } catch(error) {report.solidError=error.message;console.error(error.message);}
  finally {for(const pair of [keyed,parts]){pair?.selected.delete();pair?.remaining.delete();}base?.delete();}
}
report.peakRSSMB=process.resourceUsage().maxRSS*1024/1e6;
report.note='Synthetic closed sphere above two million triangles. Node measurements on this host; includes BVH, topology, stroke history, boundary and smoothing. Does not measure browser GPU allocations. Solid stages are included only when invoked with --solid; inspect solidError and path.status before interpreting results. No unlimited-memory or arbitrary-STL guarantee.';
geometry.dispose();
console.log(JSON.stringify(report,null,2));writeFileSync(process.argv.includes('--solid')?'tests/paint-solid-benchmark-result.json':'tests/paint-benchmark-result.json',JSON.stringify(report,null,2)+'\n');
