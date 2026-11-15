import { Sphere, Vector3, Raycaster } from 'three';

// BVH proximity is only a broad phase. Visibility and shortest paths over face
// adjacency keep the brush on the touched sheet, even around closely spaced folds.
export function surfaceBrush(mesh, camera, hit, radius, neighbors) {
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const origin = mesh.worldToLocal(hit.point.clone()), sphere = new Sphere(origin, radius);
  const candidates = new Map(), point = new Vector3(), normal = new Vector3(), visibility = new Raycaster(); visibility.firstHitOnly = true;
  mesh.geometry.boundsTree.shapecast({
    intersectsBounds: box => sphere.intersectsBox(box),
    intersectsTriangle: (tri, id) => {
      tri.closestPointToPoint(origin, point);
      if (point.distanceToSquared(origin) > radius * radius) return false;
      const center = tri.getMidpoint(new Vector3()), world = mesh.localToWorld(center.clone()), direction = world.clone().sub(camera.position), distance = direction.length(); direction.normalize();
      if (tri.getNormal(normal).transformDirection(mesh.matrixWorld).dot(direction) >= 0) return false;
      visibility.set(camera.position, direction); visibility.far = distance + .001;
      const front = visibility.intersectObject(mesh, false)[0];
      if (front && front.faceIndex === id) candidates.set(id, center);
      return false;
    },
  });
  if (!candidates.has(hit.faceIndex)) candidates.set(hit.faceIndex, origin.clone());
  const distances = new Map([[hit.faceIndex, 0]]), heap = [[0, hit.faceIndex]], result = [];
  function push(item) {
    heap.push(item); let i = heap.length - 1;
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent][0] <= item[0]) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = item;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let next = i * 2 + 1; if (next + 1 < heap.length && heap[next + 1][0] < heap[next][0]) next++;
        if (heap[next][0] >= last[0]) break; heap[i] = heap[next]; i = next;
      }
      heap[i] = last;
    }
    return first;
  }
  while (heap.length) {
    const [distance, face] = pop();
    if (distance !== distances.get(face)) continue;
    result.push(face);
    const center = face === hit.faceIndex ? origin : candidates.get(face);
    for (let j = 0; j < 3; j++) {
      const other = neighbors[face * 3 + j], otherCenter = candidates.get(other);
      if (!otherCenter) continue;
      const next = distance + center.distanceTo(otherCenter);
      if (next <= radius && next < (distances.get(other) ?? Infinity)) { distances.set(other, next); push([next, other]); }
    }
  }
  return result;
}
