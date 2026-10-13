import test from 'node:test';import assert from 'node:assert/strict';
import Module from 'manifold-3d';import createCore from 'meshfix-wasm/dist/meshfix-core.js';
import {capResidualGaps} from '../src/repair-residual.js';
import {repairAdvanced} from '../src/repair-advanced.js';
import {diagnoseMesh} from '../src/repair.js';import {toManifold} from '../src/geometry.js';
const m=await Module();m.setup();const core=await createCore();
function gap(){return {positions:new Float32Array([-.01,-.01,0,.01,-.01,0,.01,.01,.001,-.01,.01,0,0,0,.02]),indices:new Uint32Array([0,1,4,1,2,4,2,3,4,3,0,4])};}
const loops=[{ids:[0,1,2,3],diagonal:Math.hypot(.02,.02,.001)}];
test('A tiny skew residual loop closes without moving the original vertices',()=>{
 const d=gap(),before=structuredClone(d),fixed=capResidualGaps(d,loops,5);
 assert.deepEqual(d,before);assert.deepEqual(fixed.positions.subarray(0,d.positions.length),d.positions);
 assert.equal(fixed.holesFilled,1);assert.equal(fixed.facesAdded,4);
 assert.deepEqual(diagnoseMesh(fixed),{boundaryEdges:0,nonManifoldEdges:0});
 const solid=toManifold(m,fixed);assert.ok(solid.volume()>0);solid.delete();
});
test('Residual capping respects disabled filling, user dimensions and the tiny-gap bound',()=>{
 for(const limit of [0,.001])assert.throws(()=>capResidualGaps(gap(),loops,limit),/aberturas/);
 assert.throws(()=>capResidualGaps(gap(),[{ids:loops[0].ids,diagonal:.051}],50),/aberturas/);
 const d=gap();d.positions.fill(0);assert.throws(()=>capResidualGaps(d,loops,5),/colapsada/);
});
// Deterministically emulate the engine failing its diagonal triangulation.
// All loading, topology analysis, normals and geometry use the real WASM engine.
function failedFillCore(feature=false){return {...core,MeshAnalyzer:function(){
 const analyzer=new core.MeshAnalyzer();return new Proxy(analyzer,{get(target,key){
  if(key==='fillHolesEx')return ()=>({holesFound:1,holesFilled:0,holesFailed:1,holesSkipped:0,facesAdded:0,holesSkippedAsFeature:feature?1:0,flapsRemoved:0});
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
}};}
test('Advanced repair validates a residual patch against the source and yields a valid solid',()=>{
 const d=gap(),fixed=repairAdvanced(d,{},failedFillCore());
 assert.equal(fixed.repairReport.residualHolesFilled,1);assert.equal(fixed.repairReport.boundaryEdges,0);
 assert.ok(fixed.repairReport.maxSampledSurfaceDistance<=.05);assert.equal(fixed.patchPositions.length,36);
 const solid=toManifold(m,fixed);assert.ok(solid.volume()>0);solid.delete();
});
test('Intentional openings are not automatically capped by the residual fallback',()=>{
 assert.throws(()=>repairAdvanced(gap(),{},failedFillCore(true)),/intencionais/);
});
