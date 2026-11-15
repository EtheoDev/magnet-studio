import { Matrix3 } from 'three';

// LYS provides the original exterior before drainage holes were subtracted.
// Use it for both the preview and the click so rays cannot enter a drain and
// attach the magnet to an internal wall or the far side of the part.
export function pickCavitySurface(raycaster,mesh,exterior=null) {
  const target=exterior||mesh;
  if(!target)return null;
  target.updateMatrixWorld(true);
  const hit=raycaster.intersectObject(target,false)[0];
  if(!hit)return null;
  const normal=hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(target.matrixWorld));
  if(normal.dot(raycaster.ray.direction)>=0)return null;
  return {point:hit.point.toArray(),normal:normal.toArray()};
}
