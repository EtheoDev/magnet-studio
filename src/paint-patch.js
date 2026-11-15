import {tangentBasis,toManifold,fromManifold} from './geometry.js';
import {selectionBoundary,buildTopology} from './paint-selection.js';
import {selectionSurface} from './selection-surface.js';
import {verifyInsertion} from './paint-validation.js';
import {solidComponents} from './split-tools.js';
import {smoothPaintContour} from './paint-contour.js';

function removeNullShells(module,solid){
  let current=solid;
  const tolerance=Math.max(1e-12,Math.abs(solid.volume())*1e-12);
  const bounds=solid.boundingBox(),scale=Math.max(1,...bounds.min.map(Math.abs),...bounds.max.map(Math.abs)),precision=scale*2**-22;
  try{
    for(let pass=0;pass<4;pass++){
      const parts=current.decompose();
      try{
        const valid=parts.filter(p=>{
          const volume=Math.abs(p.volume());
          // Coplanar Float32 splits can create broad sheets of sub-resolution
          // thickness. Do not confuse those with small, solid physical islands.
          const numericalSheet=volume<Math.abs(solid.volume())*1e-7&&volume/Math.max(p.surfaceArea(),1e-30)<precision;
          return volume>tolerance&&!numericalSheet;
        });
        if(valid.length===parts.length)break;
        if(!valid.length)throw new Error('O corte não deixou volume útil. Ajuste a seleção.');
        const next=valid.length===1?valid[0].translate([0,0,0]):module.Manifold.compose(valid);
        if(current!==solid)current.delete();current=next;
      }finally{parts.forEach(p=>p.delete());}
    }
  }catch(error){if(current!==solid)current.delete();throw error;}
  if(current!==solid)solid.delete();return current;
}

// A simple color inlay has its own depth; it must not go through the annular
// seat builder. Construct a closed cutter, clip it to the source, and derive
// the complementary solid by subtraction so both pieces share the same cut.
export function separatePatch(module,base,data,topology,mask,options){
  if(options.selectionField){
    const surface=selectionSurface(data,mask,options.selectionField);
    return separatePatch(module,base,surface.data,buildTopology(surface.data),surface.mask,{...options,selectionField:null,contourRadius:0});
  }
  if(options.contourRadius>0&&options.patchClosure!=='boundary')return separateSmoothPatch(module,base,data,topology,mask,options);
  const diagnostics=selectionBoundary(data,topology,mask),depth=options.patchDepth??1;
  if(!diagnostics.selectedFaces||diagnostics.selectedFaces===mask.length)throw new Error('Selecione uma região e deixe parte do modelo sem seleção.');
  if(diagnostics.openEdges||diagnostics.ambiguousEdges)throw new Error(`A malha importada tem ${diagnostics.openEdges} arestas abertas e ${diagnostics.ambiguousEdges} arestas não manifold. Repare a geometria antes do corte.`);
  if(diagnostics.ambiguousVertices)throw new Error(`A seleção se encontra em ${diagnostics.ambiguousVertices} pontos da borda. Ative a correção de microfragmentos ou ajuste esses pontos com o pincel.`);
  if(!Number.isFinite(depth)||depth<.05||depth>100)throw new Error('Use profundidade de corte entre 0,05 e 100 mm.');
  const length=Math.hypot(...options.direction);if(!Number.isFinite(length)||length<1e-8)throw new Error('Defina uma direção de saída válida.');
  const n=options.direction.map(x=>x/length),{u,v}=tangentBasis(n),dot=(p,q)=>p.reduce((s,x,k)=>s+x*q[k],0),positions=[],indices=[],map=new Map(),p=id=>Array.from(data.positions.subarray(id*3,id*3+3));
  let minimum=Infinity;
  function original(id){let index=map.get(id);if(index===undefined){index=positions.length/3;map.set(id,index);const q=p(id);positions.push(...q);minimum=Math.min(minimum,dot(q,n));}return index;}
  for(let f=0;f<mask.length;f++)if(mask[f])for(let j=0;j<3;j++)indices.push(original(data.indices[f*3+j]));
  const boundaryClosure=options.patchClosure==='boundary',height=minimum-depth,polygons=[],capIDs=[];
  for(const loop of diagnostics.loops){
    const ring=[],bottom=[];
    for(const id of loop){const q=p(id),x=dot(q,u),y=dot(q,v);ring.push([x,y]);if(boundaryClosure){capIDs.push(original(id));continue;}bottom.push(positions.length/3);capIDs.push(positions.length/3);positions.push(...n.map((a,k)=>u[k]*x+v[k]*y+a*height));}
    polygons.push(ring);
    if(!boundaryClosure)for(let i=0;i<loop.length;i++){const j=(i+1)%loop.length,a=original(loop[i]),b=original(loop[j]);indices.push(b,a,bottom[i],b,bottom[i],bottom[j]);}
  }
  if(!polygons.length)throw new Error('A região precisa ter uma borda para o fechamento simples.');
  const capStart=indices.length,triangles=module.triangulate(polygons,1e-8,false);
  const polygon=polygons[0],center2=polygon?.reduce((sum,p)=>sum.map((x,k)=>x+p[k]/polygon.length),[0,0]);
  const star=boundaryClosure&&polygons.length===1&&polygon.every((p,j)=>{const q=polygon[(j+1)%polygon.length];return (p[0]-center2[0])*(q[1]-center2[1])-(p[1]-center2[1])*(q[0]-center2[0])>1e-10;});
  if(star){
    const center=positions.length/3;
    for(let k=0;k<3;k++)positions.push(capIDs.reduce((sum,id)=>sum+positions[id*3+k]/capIDs.length,0));
    for(let j=0;j<capIDs.length;j++)indices.push(capIDs[(j+1)%capIDs.length],capIDs[j],center);
  }else for(const tri of triangles)indices.push(capIDs[tri[2]],capIDs[tri[1]],capIDs[tri[0]]);
  let cutter,selected,remaining;
  try{
    try{cutter=toManifold(module,{positions:new Float32Array(positions),indices:new Uint32Array(indices)});}catch{throw new Error(boundaryClosure?'Não foi possível fechar diretamente esta borda. Para uma pintura plana, escolha Recorte com profundidade. Para uma parte orgânica, confira o contorno e a direção.':'O contorno não fecha nessa direção. Use a direção da câmera ou selecione uma região conectada por vez. A malha original foi preservada.');}
    if(boundaryClosure){
      const complementary=[];
      for(let f=0;f<mask.length;f++)if(!mask[f])for(let j=0;j<3;j++)complementary.push(original(data.indices[f*3+j]));
      for(let h=capStart;h<indices.length;h+=3)complementary.push(indices[h+2],indices[h+1],indices[h]);
      selected=cutter;cutter=null;
      remaining=toManifold(module,{positions:new Float32Array(positions),indices:Uint32Array.from(complementary)});
    }else{selected=base.intersect(cutter);remaining=base.subtract(cutter);}
    if(!boundaryClosure){selected=removeNullShells(module,selected);remaining=removeNullShells(module,remaining);}
    if([selected,remaining].some(s=>s.status()!=='NoError'||s.isEmpty()||s.volume()<=0))throw new Error('A direção não produziu duas peças fechadas. Use direção automática ou a direção da câmera.');
    if(boundaryClosure){
      const overlap=selected.intersect(remaining),a=selected.subtract(base),b=remaining.subtract(base);
      try{
        const tolerance=Math.max(1e-6,base.volume()*1e-7);
        if(Math.abs(overlap.volume())>tolerance||Math.abs(a.volume())+Math.abs(b.volume())>tolerance)throw new Error('O fechamento atravessaria a superfície original. Ajuste a direção ou selecione uma região menor; o corte não foi aplicado.');
      }finally{overlap.delete();a.delete();b.delete();}
    }
    const path=verifyInsertion(fromManifold(selected),fromManifold(remaining),n);
    return {selected,remaining,source:base,reference:{n,u,v,rings:[],options},diagnostics,report:{closed:true,oriented:true,method:'patch',patchClosure:boundaryClosure?'boundary':'depth',canKey:false,components:[solidComponents(selected),solidComponents(remaining)],volumes:[selected.volume(),remaining.volume()],originalVolume:base.volume(),overlap:0,outside:0,removedForSeating:base.volume()-selected.volume()-remaining.volume(),exteriorDisplacement:0,patchDepth:boundaryClosure?0:depth,path}};
  }catch(error){selected?.delete();remaining?.delete();throw error;}finally{cutter?.delete();}
}

function separateSmoothPatch(module,base,data,topology,mask,options){
  const depth=options.patchDepth??1;if(!Number.isFinite(depth)||depth<.05||depth>100)throw new Error('Use profundidade entre 0,05 e 100 mm.');
  const contour=smoothPaintContour(module,data,topology,mask,{direction:options.direction,radius:options.contourRadius??0,selectionField:options.selectionField});
  let local,cutter,selected,remaining;
  try{
    const {n,u,v,min,max}=contour,height=min-depth;
    local=contour.section.extrude(max-height+1);
    cutter=local.transform([u[0],u[1],u[2],0,v[0],v[1],v[2],0,n[0],n[1],n[2],0,n[0]*height,n[1]*height,n[2]*height,1]);
    selected=base.intersect(cutter);remaining=base.subtract(selected);
    // Boolean clipping can leave a zero-volume shell at a tangential contact.
    // Remove only numerical null volumes, never a small physical component.
    function removeNullShells(solid){let current=solid;try{for(let pass=0;pass<4;pass++){const parts=current.decompose();try{const valid=parts.filter(p=>Math.abs(p.volume())>1e-12);if(valid.length===parts.length)break;if(!valid.length)throw new Error('A suavização não deixou volume útil. Reduza o raio.');const next=valid.length===1?valid[0].translate([0,0,0]):module.Manifold.compose(valid);if(current!==solid)current.delete();current=next;}finally{parts.forEach(p=>p.delete());}}}catch(error){if(current!==solid)current.delete();throw error;}if(current!==solid)solid.delete();return current;}
    selected=removeNullShells(selected);remaining=removeNullShells(remaining);
    if([selected,remaining].some(s=>s.status()!=='NoError'||s.isEmpty()||s.volume()<=0))throw new Error('A suavização não gerou duas peças válidas. Reduza o raio ou ajuste a direção.');
    // The cutter is an extrusion parallel to n, starting at height. Translating
    // its intersection with base along +n stays inside that same extrusion;
    // the complementary part is outside it (or below height). Thus the whole
    // path is clear by construction, including sliding contact along the walls.
    const path={status:'clear',method:'extruded-contour',travel:max-height+.1,testedPairs:0};
    return {selected,remaining,source:base,reference:{n,u,v,rings:[],options},diagnostics:contour.diagnostics,report:{closed:true,oriented:true,method:'smooth-patch',canKey:false,components:[solidComponents(selected),solidComponents(remaining)],volumes:[selected.volume(),remaining.volume()],originalVolume:base.volume(),overlap:0,outside:0,removedForSeating:base.volume()-selected.volume()-remaining.volume(),exteriorDisplacement:0,patchDepth:depth,contourRadius:contour.radius,contours:contour.polygons.length,path}};
  }catch(error){selected?.delete();remaining?.delete();throw error;}finally{contour.section.delete();local?.delete();cutter?.delete();}
}
