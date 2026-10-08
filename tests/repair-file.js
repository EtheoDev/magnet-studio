// Local regression runner: reads a user-selected file, never stores it in the project.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import createCore from 'meshfix-wasm/dist/meshfix-core.js';
import {parseSTL,toManifold,fromManifold,cutCavities,binarySTL} from '../src/geometry.js';
import {diagnoseMesh} from '../src/repair.js';
import {repairSolid} from '../src/repair-solid.js';
const [input,output]=process.argv.slice(2);if(!input)throw new Error('Informe o caminho do STL. Opcional: caminho da cópia reparada.');
const bytes=readFileSync(input),originalHash=createHash('sha256').update(bytes).digest('hex'),data=parseSTL(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const core=await createCore(),m=await Module();m.setup();
const start=performance.now(),{repaired:fixed,solid:base}=await repairSolid(m,data,{maxHoleSize:5},async()=>core),elapsed=performance.now()-start;
const mesh=fromManifold(base),stl=binarySTL(mesh,data.offset),parsed=parseSTL(stl),roundtrip=toManifold(m,parsed);
assert.ok(Math.abs(roundtrip.volume()-base.volume())<.01);
for(let k=0;k<3;k++)assert.ok(Math.abs(parsed.size[k]-data.size[k])<.0001);
// Test a small cavity on the largest face, using the actual surface orientation.
let best=-1,area=0,point,normal;
for(let f=0;f<mesh.indices.length;f+=3){
 const [a,b,c]=Array.from(mesh.indices.subarray(f,f+3),i=>Array.from(mesh.positions.subarray(i*3,i*3+3)));
 const u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
 if(len>area){best=f/3;area=len;point=a.map((x,k)=>(x+b[k]+c[k])/3);normal=n.map(x=>x/len);}
}
const cut=cutCavities(m,base,[{point,normal,diameter:3,thickness:1,diameterAllowance:.2,depthAllowance:.1}]);
assert.ok(base.volume()-cut.volume()>.01);
const exportedCut=toManifold(m,parseSTL(binarySTL(fromManifold(cut),data.offset)));
assert.ok(Math.abs(exportedCut.volume()-cut.volume())<.01);
assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'),originalHash);
const report={inputSHA256:originalHash,inputTriangles:data.indices.length/3,diagnostics:diagnoseMesh(data),repairMs:elapsed,repair:fixed.repairReport,outputTriangles:mesh.indices.length/3,sizeBefore:data.size,sizeAfter:parsed.size,repairedVolume:base.volume(),roundtripVolume:roundtrip.volume(),testCavity:{face:best,point,normal,removedVolume:base.volume()-cut.volume(),exportReimportVolume:exportedCut.volume()},originalUnchanged:true};
if(output){writeFileSync(output,new Uint8Array(stl));writeFileSync(output.replace(/\.stl$/i,'-validacao.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));exportedCut.delete();cut.delete();roundtrip.delete();base.delete();
