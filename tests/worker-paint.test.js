import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import Module from 'manifold-3d';
import {fromManifold,toGeometry} from '../src/geometry.js';
import {selectionSurface} from '../src/selection-surface.js';
import {smoothSelectionBrush} from '../src/straighten-brush.js';
import {MeshBVH} from 'three-mesh-bvh';
import {Vector3} from 'three';
import {readFileSync} from 'node:fs';
import {loadProject} from '../src/project-file.js';

// Run the actual worker dispatcher, adapting only Vite's WASM URL imports and
// the browser message transport. No geometry methods or RPC responses mocked.
test('worker keeps topology preparation separate from selection cleanup and cuts through the public RPCs',async()=>{
  const worker=new Worker(`
    import {parentPort} from 'node:worker_threads';
    import {registerHooks} from 'node:module';
    import {fileURLToPath} from 'node:url';
    registerHooks({resolve(specifier,context,next){
      if(specifier.endsWith('.wasm?url')){
        const path=fileURLToPath(next(specifier.slice(0,-4),context).url);
        return {url:'data:text/javascript,'+encodeURIComponent('export default '+JSON.stringify(path)),shortCircuit:true};
      }
      return next(specifier,context);
    }});
    globalThis.self={postMessage:(message)=>parentPort.postMessage(message)};
    await import(${JSON.stringify(new URL('../src/geometry.worker.js',import.meta.url).href)});
    parentPort.on('message',data=>self.onmessage({data}));
    parentPort.postMessage({ready:true});
  `,{eval:true,type:'module'});
  let nextID=0;const pending=new Map();
  const ready=new Promise((resolve,reject)=>{worker.on('message',data=>{if(data.ready){resolve();return;}const p=pending.get(data.id);pending.delete(data.id);data.ok?p?.resolve(data.payload):p?.reject(new Error(data.error));});worker.on('error',error=>{reject(error);for(const p of pending.values())p.reject(error);});});
  const request=(type,payload={})=>new Promise((resolve,reject)=>{const id=++nextID;pending.set(id,{resolve,reject});worker.postMessage({id,type,payload});});
  try{
    await ready;
    const m=await Module();m.setup();const cube=m.Manifold.cube([20,20,20],true),data=fromManifold(cube);cube.delete();
    data.faceRegions=new Uint32Array(data.indices.length/3);data.palette=[{id:0,name:'Base',color:'#5070fa',faces:0},{id:1,name:'Topo',color:'#fa7050',faces:0}];
    for(let f=0;f<data.faceRegions.length;f++){const z=[0,1,2].reduce((sum,j)=>sum+data.positions[data.indices[f*3+j]*3+2]/3,0),region=z>9?1:0;data.faceRegions[f]=region;data.palette[region].faces++;}
    const project=process.env.MAGNETLAB_REGRESSION_PROJECT?loadProject(readFileSync(process.env.MAGNETLAB_REGRESSION_PROJECT)):null;
    const demo=await request('importScene',{data:project?.data??data}),topology=await request('paintPrepare');
    assert.equal(topology.faces,demo.indices.length/3);assert.equal(topology.neighbors.length,demo.indices.length);
    const {mask}=project??await request('selectColor',{region:demo.palette.find(r=>r.name==='Topo').id});
    const prepared=await request('paintPrepareSelection',{mask,clean:true});
    assert.ok(prepared.changed instanceof Uint32Array);assert.equal(prepared.mask.length,topology.faces);assert.equal(prepared.direction.length,3);
    const options={method:'patch',direction:prepared.direction,patchDepth:1,contourRadius:.35,autoDirection:true};
    const preview=await request('paintInspect',{mask,options});assert.ok(preview.smoothedBoundary.length>0);assert.equal(preview.contourRadius,.35);
    const parts=await request('paintSeparate',{mask:prepared.mask,options,selectionAdjusted:prepared.changed.length});
    assert.equal(parts.report.closed,true);assert.equal(parts.report.path.status,'clear');
    assert.deepEqual(parts.report.components,[1,1]);assert.equal(parts.report.contourRadius,.35);
    const exported=await request('paintExportAll');assert.ok(exported.buffer.byteLength>100);
    if(!project){
      const field=new Float32Array(demo.positions.length/3).fill(NaN);for(let i=0;i<field.length;i++)if(demo.positions[i*3+2]>9)field[i]=demo.positions[i*3]-.123;
      const brushOptions={...options,contourRadius:0,selectionField:field};
      const brushPreview=await request('paintInspect',{mask,options:brushOptions});assert.ok(brushPreview.smoothedBoundary.length>0);
      const aligned=await request('paintSeparate',{mask,options:brushOptions});assert.equal(aligned.report.closed,true);assert.equal(aligned.report.method,'patch');assert.ok(Math.abs(aligned.report.volumes.reduce((sum,v)=>sum+v,0)-aligned.report.originalVolume)<.001);
      assert.ok((await request('paintExportAll')).buffer.byteLength>100);
      // The actual head from the UI demo, including the full worker packet and
      // BVH serialization. Old depth/seat settings must not affect this command.
      const figure=await request('paintDemo'),head=(await request('selectColor',{region:1})).mask,candidates=[];
      for(let f=0;f<head.length;f++)if([0,1,2].some(j=>{const id=figure.indices[f*3+j]*3;return Math.hypot(figure.positions[id],figure.positions[id+1],figure.positions[id+2]-19)<10;}))candidates.push(f);
      const change=smoothSelectionBrush(figure,head,null,candidates,[0,0,19],[1,0,0],[0,1,0],10,.5),selectionField=new Float32Array(figure.positions.length/3).fill(NaN);change.vertices.forEach((id,j)=>selectionField[id]=change.levels[j]);
      const expected=selectionSurface(figure,head,selectionField);
      const cut=await request('cutSelection',{mask:head,selectionField,autoDirection:true,direction:[0,0,1],options:{method:'seat',patchDepth:50,depth:50,contourRadius:10}});
      assert.equal(cut.report.patchClosure,'boundary');assert.equal(cut.report.patchDepth,0);assert.deepEqual(cut.report.components,[1,1]);
      const geometries=[cut.remaining,cut.selected].map(toGeometry),trees=geometries.map(g=>new MeshBVH(g)),point=new Vector3();let minimum=Infinity;
      try{for(let f=0;f<expected.mask.length;f++){
        point.set(0,0,0);for(let j=0;j<3;j++){const id=expected.data.indices[f*3+j]*3;point.x+=expected.data.positions[id]/3;point.y+=expected.data.positions[id+1]/3;point.z+=expected.data.positions[id+2]/3;if(expected.mask[f])minimum=Math.min(minimum,expected.data.positions[id+2]);}
        assert.ok(trees[expected.mask[f]].closestPointToPoint(point).distance<1e-4,`head cut changed the side of source face ${f}`);
      }}finally{geometries.forEach(g=>g.dispose());}
      for(let i=2;i<cut.selected.positions.length;i+=3)assert.ok(cut.selected.positions[i]>=minimum-1e-4,'the head must not gain a cylinder below its selected surface');
    }
  }finally{await worker.terminate();}
});
