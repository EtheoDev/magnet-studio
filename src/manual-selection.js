import { Vector3 } from 'three';

export function polygonContains(point,polygon){
  let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }return inside;
}

export function lassoMask(mesh,camera,polygon,through=true,raycaster){
  if(polygon.length<3)throw new Error('Contorne uma área no modelo.');
  const positions=mesh.geometry.attributes.position,index=mesh.geometry.index,faces=index.count/3,mask=new Uint8Array(faces),center=new Vector3(),point=new Vector3();
  mesh.updateMatrixWorld();camera.updateMatrixWorld();
  for(let f=0;f<faces;f++){
    center.set(0,0,0);for(let j=0;j<3;j++)center.add(point.fromBufferAttribute(positions,index.getX(f*3+j)));center.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
    point.copy(center).project(camera);if(point.z<-1||point.z>1||!polygonContains(point,polygon))continue;
    if(!through){raycaster.set(camera.position,point.copy(center).sub(camera.position).normalize());raycaster.far=camera.position.distanceTo(center)+.001;const hit=raycaster.intersectObject(mesh,false)[0];if(hit?.faceIndex!==f)continue;}
    mask[f]=1;
  }
  if(raycaster)raycaster.far=Infinity;return mask;
}
