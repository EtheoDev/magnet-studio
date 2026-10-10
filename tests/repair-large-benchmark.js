// Explicit stress test, kept out of the fast suite. No third-party model needed.
import Module from 'manifold-3d';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fromManifold,binarySTL,parseSTL} from '../src/geometry.js';
import {repairSolid} from '../src/repair-solid.js';
const m=await Module();m.setup();
const sphere=m.Manifold.sphere(40,2560),expectedVolume=sphere.volume(),data=fromManifold(sphere);sphere.delete();
data.indices=data.indices.slice(3);[data.indices[1],data.indices[2]]=[data.indices[2],data.indices[1]];
assert.ok(data.indices.length/3>3_000_000);
const stl=binarySTL(data),parsed=parseSTL(stl),digest=d=>createHash('sha256').update(d.positions).update(d.indices).digest('hex'),before=digest(parsed);
const start=performance.now();
const {repaired,solid}=await repairSolid(m,parsed,{advancedRepair:false},async()=>{throw new Error('Unexpected fallback');});
const repairMs=performance.now()-start;
try{
 const volumeError=Math.abs(solid.volume()-expectedVolume);
 assert.ok(volumeError<.01);assert.equal(repaired.repairReport.holesFilled,1);assert.equal(digest(parsed),before);
 const report={node:process.version,platform:process.platform,architecture:process.arch,inputTriangles:parsed.indices.length/3,outputTriangles:repaired.indices.length/3,repairMs,volumeError,peakProcessRSSMiB:process.resourceUsage().maxRSS/1024,repairs:repaired.repairReport,note:'Synthetic sphere with one missing triangle and one reversed face; includes STL import above the former 3-million limit. Local Node measurement, not a browser performance guarantee.'};
 console.log(JSON.stringify(report,null,2));writeFileSync('tests/repair-large-benchmark-result.json',JSON.stringify(report,null,2)+'\n');
}finally{solid.delete();}
