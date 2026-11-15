import { Box3, Vector3, Triangle } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { toGeometry } from './geometry.js';

// Continuous triangle SAT for pure translation. Each projection overlap yields
// a time interval; their intersection detects crossings BETWEEN sampled poses.
// Coplanar sliding/contact alone is allowed (it does not penetrate a solid).
export function triangleSweep(a, b, delta, tolerance = 1e-6) {
  const ae = [new Vector3().subVectors(a.b, a.a), new Vector3().subVectors(a.c, a.b), new Vector3().subVectors(a.a, a.c)];
  const be = [new Vector3().subVectors(b.b, b.a), new Vector3().subVectors(b.c, b.b), new Vector3().subVectors(b.a, b.c)];
  const an = new Vector3().crossVectors(ae[0], ae[1]), bn = new Vector3().crossVectors(be[0], be[1]);
  const axes = [an, bn];
  for (const x of ae) for (const y of be) axes.push(new Vector3().crossVectors(x, y));
  // In-plane axes handle coplanar/parallel configurations.
  for (const e of ae) axes.push(new Vector3().crossVectors(an, e));
  for (const e of be) axes.push(new Vector3().crossVectors(bn, e));
  let enter = 0, exit = 1;
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-20) continue;
    axis.normalize();
    const ap = [a.a.dot(axis), a.b.dot(axis), a.c.dot(axis)], bp = [b.a.dot(axis), b.b.dot(axis), b.c.dot(axis)];
    const amin = Math.min(...ap), amax = Math.max(...ap), bmin = Math.min(...bp), bmax = Math.max(...bp), speed = delta.dot(axis);
    if (Math.abs(speed) <= tolerance * 2) {
      if (amax <= bmin + tolerance || bmax <= amin + tolerance) return null;
      continue;
    }
    let t0 = (bmin - amax) / speed, t1 = (bmax - amin) / speed;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0); exit = Math.min(exit, t1);
    if (enter > exit) return null;
  }
  return exit > tolerance * 4 / Math.max(delta.length(), tolerance) && enter < 1 - 1e-7 ? Math.max(enter, 0) : null;
}

export function verifyInsertion(moving, fixed, direction, maxPairs = 5_000_000) {
  const n = new Vector3(...direction).normalize();
  let minMoving = Infinity, maxFixed = -Infinity, coordinateScale=1;
  const v = new Vector3();
  for (let i = 0; i < moving.positions.length; i += 3) {v.fromArray(moving.positions,i);minMoving=Math.min(minMoving,v.dot(n));coordinateScale=Math.max(coordinateScale,Math.abs(v.x),Math.abs(v.y),Math.abs(v.z));}
  for (let i = 0; i < fixed.positions.length; i += 3) {v.fromArray(fixed.positions,i);maxFixed=Math.max(maxFixed,v.dot(n));coordinateScale=Math.max(coordinateScale,Math.abs(v.x),Math.abs(v.y),Math.abs(v.z));}
  const tolerance=Math.max(1e-6,coordinateScale*2**-21);
  const travel = Math.max(0.01, maxFixed - minMoving + 0.1), delta = n.clone().multiplyScalar(travel);
  const geometry = toGeometry(fixed), tree = new MeshBVH(geometry, { maxLeafSize: 8 });
  const triangle = new Triangle(), swept = new Box3(), normal = new Vector3(),fixedNormal=new Vector3();
  let pairs = 0, collision = null, exhausted = false;
  try {
    for (let f = 0; f < moving.indices.length / 3 && collision === null && !exhausted; f++) {
      triangle.a.fromArray(moving.positions, moving.indices[f * 3] * 3);
      triangle.b.fromArray(moving.positions, moving.indices[f * 3 + 1] * 3);
      triangle.c.fromArray(moving.positions, moving.indices[f * 3 + 2] * 3);
      // With initially disjoint closed solids, only an advancing boundary
      // (outward normal dot velocity > 0) can ENTER the other solid. Trailing
      // mating caps merely separate; testing their huge coplanar triangulations
      // costs millions of pairs without providing a possible first collision.
      if (triangle.getNormal(normal).dot(n) <= 1e-12) continue;
      swept.setFromPoints([triangle.a, triangle.b, triangle.c]);
      for (const p of [triangle.a, triangle.b, triangle.c]) swept.expandByPoint(v.copy(p).add(delta));
      tree.shapecast({
        intersectsBounds: box => box.intersectsBox(swept),
        intersectsTriangle: other => {
          // First entry into an initially disjoint fixed solid must cross its
          // incoming boundary. Outgoing exterior faces cannot block extraction;
          // testing them reports false collisions on coincident source patches.
          if(other.getNormal(fixedNormal).dot(n)>=-1e-12)return false;
          if (++pairs > maxPairs) { exhausted = true; return true; }
          const t = triangleSweep(triangle, other, delta,tolerance);
          if (t !== null) { collision = { movingFace: f, distance: t * travel }; return true; }
          return false;
        },
      });
    }
    return { status: collision ? 'blocked' : exhausted ? 'inconclusive' : 'clear', method: 'continuous-triangle-sat', travel, testedPairs: pairs, collision, tolerance };
  } finally { geometry.dispose(); }
}
