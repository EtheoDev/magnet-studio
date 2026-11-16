import { Vector3, Ray, DoubleSide } from 'three';

// Follow the local surface rather than measuring the model's bounding box.
// Stop at gaps, sharp turns or a jump to a different wall. Measurements are
// sampled surface clearances, not a guarantee of minimum wall thickness.
export function surfaceGuides(tree,{point,normal,right,up,radius,maxDistance}) {
  const center=new Vector3(...point),n=new Vector3(...normal).normalize();
  const horizontal=new Vector3(...right).projectOnPlane(n);
  if(horizontal.lengthSq()<1e-6)horizontal.crossVectors(new Vector3(...up),n);
  if(horizontal.lengthSq()<1e-6)horizontal.crossVectors(Math.abs(n.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0),n);
  horizontal.normalize();
  const vertical=new Vector3().crossVectors(n,horizontal).normalize();
  if(vertical.dot(new Vector3(...up))<0)vertical.negate();
  const step=Math.max(.05,Math.min(.5,radius/5)),span=Math.max(.25,step*2);
  const reach=Math.min(maxDistance,step*160),ray=new Ray(),direction=n.clone().negate();
  const trace=(name,axis)=>{
    const points=[center.clone()];let previous=center.clone(),lastT=0,boundary=false;
    const sample=t=>{
      const expected=center.clone().addScaledVector(axis,t);
      const height=previous.clone().sub(center).dot(n);
      ray.set(expected.addScaledVector(n,height+span),direction);
      const hit=tree.raycastFirst(ray,DoubleSide,0,span*2);
      if(!hit||hit.face.normal.dot(n)<.5||hit.point.distanceTo(previous)>step*3+.001)return null;
      return hit.point.clone();
    };
    for(let t=Math.min(step,reach);t<=reach+1e-8;t=Math.min(t+step,reach)){
      const hit=sample(t);
      if(!hit){
        let low=lastT,high=t,edge=previous;
        for(let i=0;i<10;i++){const middle=(low+high)/2,p=sample(middle);if(p){low=middle;edge=p;}else high=middle;}
        if(edge.distanceTo(previous)>1e-6)points.push(edge);
        boundary=true;break;
      }
      points.push(hit);previous=hit;lastT=t;
      if(t>=reach)break;
    }
    let length=0;
    for(let i=1;i<points.length;i++)length+=points[i].distanceTo(points[i-1]);
    // Trim the guide inside the magnet's footprint, keeping only the clearance.
    const visible=[];let walked=0;
    for(let i=1;i<points.length;i++){
      const segment=points[i].distanceTo(points[i-1]),next=walked+segment;
      if(next>=radius){
        if(!visible.length)visible.push(points[i-1].clone().lerp(points[i],Math.max(0,(radius-walked)/segment)));
        visible.push(points[i]);
      }
      walked=next;
    }
    const path=visible.length>1?visible:points;
    const clearance=length-radius;
    return {name,points:path.map(p=>p.toArray()),clearance,boundary,fits:clearance>=0};
  };
  const arms=[trace('left',horizontal.clone().negate()),trace('right',horizontal),trace('up',vertical),trace('down',vertical.clone().negate())];
  const balanced=(a,b)=>a.boundary&&b.boundary&&a.fits&&b.fits&&Math.abs(a.clearance-b.clearance)<=.2;
  return {arms,horizontalCentered:balanced(arms[0],arms[1]),verticalCentered:balanced(arms[2],arms[3]),normal:n.toArray()};
}
