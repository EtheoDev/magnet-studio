import {Vector3,Ray,DoubleSide} from 'three';
import {tangentBasis} from './geometry.js';
import {selectionBoundary} from './paint-selection.js';
import {clipSelectionTriangle} from './straighten-brush.js';

// Work in millimeters, not face labels: offset opening/closing removes stair
// steps and point contacts, and creates round curves that can cut across faces.
export function smoothPaintContour(module,data,topology,mask,{direction,radius=.35,selectionField}){
  if(!Number.isFinite(radius)||radius<0||radius>10||radius===0&&!selectionField)throw new Error('Use suavização entre 0,01 e 10 mm.');
  if(selectionField&&selectionField.length!==data.positions.length/3)throw new Error('O ajuste da borda não corresponde à malha.');
  const length=Math.hypot(...direction);if(!Number.isFinite(length)||length<1e-8)throw new Error('Defina uma direção para a suavização.');
  const n=direction.map(x=>x/length),{u,v}=tangentBasis(n),dot=(p,q)=>p.reduce((s,x,k)=>s+x*q[k],0),project=id=>{const p=Array.from(data.positions.subarray(id*3,id*3+3));return [dot(p,u),dot(p,v)];};
  const diagnostics=selectionBoundary(data,topology,mask);let min=Infinity,max=-Infinity;
  for(let f=0;f<mask.length;f++)if(mask[f])for(let j=0;j<3;j++){const id=data.indices[f*3+j]*3,h=n.reduce((sum,x,k)=>sum+x*data.positions[id+k],0);min=Math.min(min,h);}
  for(let i=0;i<data.positions.length;i+=3)max=Math.max(max,n.reduce((s,x,k)=>s+x*data.positions[i+k],0));
  if(!Number.isFinite(min)||!diagnostics.selectedFaces||diagnostics.selectedFaces===mask.length)throw new Error('Selecione uma região e deixe parte do modelo sem seleção.');
  if(diagnostics.openEdges||diagnostics.ambiguousEdges)throw new Error('A geometria tem arestas abertas ou não manifold; repare a malha antes de suavizar o corte.');
  let polygons;
  if(selectionField){polygons=[];let fieldMin=Infinity;for(let f=0;f<mask.length;f++){if(!mask[f]&&![0,1,2].some(j=>Number.isFinite(selectionField[data.indices[f*3+j]])))continue;const clipped=clipSelectionTriangle(data,mask,selectionField,f),polygon=clipped.map(p=>[dot(p,u),dot(p,v)]);if(polygon.length<3)continue;const area=polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0);if(Math.abs(area)<1e-12)continue;for(const p of clipped)fieldMin=Math.min(fieldMin,dot(p,n));if(area<0)polygon.reverse();polygons.push(polygon);}if(Number.isFinite(fieldMin))min=fieldMin;}
  else if(!diagnostics.ambiguousVertices&&diagnostics.loops.length)polygons=diagnostics.loops.map(loop=>loop.map(project));
  else{
    // Polygon union resolves touching color fans without asking the user to
    // repaint a saddle vertex. It does not require a single boundary successor.
    polygons=[];
    for(let f=0;f<mask.length;f++)if(mask[f]){const p=[0,1,2].map(j=>project(data.indices[f*3+j])),area=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);if(Math.abs(area)<1e-12)continue;if(area<0)p.reverse();polygons.push(p);}
  }
  let section=new module.CrossSection(polygons,'NonZero');
  try{
    if(radius>0)for(const distance of [radius,-2*radius,radius]){const next=section.offset(distance,'Round',2,48);section.delete();section=next;}
    const simplified=section.simplify(radius>0?Math.max(.001,radius*.025):1e-6);section.delete();section=simplified;
    if(section.isEmpty())throw new Error('A suavização apagou esta região pequena. Reduza o raio de suavização.');
    return {section,polygons:section.toPolygons(),n,u,v,min,max,radius,diagnostics};
  }catch(error){section.delete();throw error;}
}

export function contourSurfaceLines(contour,tree){
  const {n,u,v,max,polygons}=contour,normal=new Vector3(...n),ray=new Ray(new Vector3(),normal.clone().negate()),result=[];
  for(const polygon of polygons){const points=polygon.map(p=>{ray.origin.set(...n.map((x,k)=>u[k]*p[0]+v[k]*p[1]+x*(max+1)));const hit=tree.raycastFirst(ray,DoubleSide);return hit?.point;});for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(a&&b)result.push(a.x,a.y,a.z,b.x,b.y,b.z);}}
  return new Float32Array(result);
}
