// Geometry-based region proposal. STL has no anatomical labels: distances follow
// face adjacency, and a narrow frontier suggests a neck/wrist/shoulder boundary.
export function partDistances(data, topology, seed) {
  const { positions, indices } = data, count = indices.length / 3;
  if (!Number.isInteger(seed) || seed < 0 || seed >= count) throw new Error('Clique em uma parte do modelo.');
  const centers = new Float32Array(count * 3), areas = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) centers[f * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
    const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2];
    const u = positions[c] - positions[a], v = positions[c + 1] - positions[a + 1], w = positions[c + 2] - positions[a + 2];
    areas[f] = Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) / 2;
  }
  const distances = new Float64Array(count).fill(Infinity), heap = new Uint32Array(count), slots = new Int32Array(count).fill(-1);
  let length = 0, maximum = 0, componentFaces = 0, componentArea = 0;
  function put(face) {
    let i = slots[face]; if (i < 0) i = length++;
    while (i > 0) {
      const parent = (i - 1) >> 1, other = heap[parent];
      if (distances[other] <= distances[face]) break;
      heap[i] = other; slots[other] = i; i = parent;
    }
    heap[i] = face; slots[face] = i;
  }
  function pop() {
    const face = heap[0], last = heap[--length]; slots[face] = -2;
    if (length) {
      let i = 0;
      while (i * 2 + 1 < length) {
        let child = i * 2 + 1;
        if (child + 1 < length && distances[heap[child + 1]] < distances[heap[child]]) child++;
        if (distances[heap[child]] >= distances[last]) break;
        heap[i] = heap[child]; slots[heap[i]] = i; i = child;
      }
      heap[i] = last; slots[last] = i;
    }
    return face;
  }
  distances[seed] = 0; put(seed);
  while (length) {
    const f = pop(), distance = distances[f]; maximum = Math.max(maximum, distance); componentFaces++; componentArea += areas[f];
    for (let j = 0; j < 3; j++) {
      const g = topology.neighbors[f * 3 + j];
      if (g < 0 || slots[g] === -2) continue;
      const step = Math.hypot(centers[f * 3] - centers[g * 3], centers[f * 3 + 1] - centers[g * 3 + 1], centers[f * 3 + 2] - centers[g * 3 + 2]);
      const next = distance + Math.max(step, 1e-8);
      if (next < distances[g]) { distances[g] = next; put(g); }
    }
  }
  // Difference arrays measure the actual frontier length, independent of mesh density.
  const bins = 256, frontier = new Float64Array(bins + 2), areaBins = new Float64Array(bins + 2), scale = bins / Math.max(maximum, 1e-8);
  for (let f = 0; f < count; f++) if (Number.isFinite(distances[f])) {
    areaBins[Math.min(bins, Math.ceil(distances[f] * scale))] += areas[f];
    for (let j = 0; j < 3; j++) {
      const g = topology.neighbors[f * 3 + j]; if (g < 0 || g < f) continue;
      const lo = Math.min(distances[f], distances[g]), hi = Math.max(distances[f], distances[g]);
      const a = indices[f * 3 + j] * 3, b = indices[f * 3 + (j + 1) % 3] * 3;
      const edge = Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]);
      frontier[Math.ceil(lo * scale)] += edge; frontier[Math.ceil(hi * scale)] -= edge;
    }
  }
  for (let i = 1; i <= bins; i++) { frontier[i] += frontier[i - 1]; areaBins[i] += areaBins[i - 1]; }
  const smoothed = frontier.map((_, i) => {
    let sum = 0, n = 0; for (let j = Math.max(0, i - 3); j <= Math.min(bins, i + 3); j++) { sum += frontier[j]; n++; } return sum / n;
  });
  let neck = null, best = 1;
  for (let i = 8; i < bins - 12; i++) {
    if (areaBins[i] < componentArea * .005 || areaBins[i] > componentArea * .55 || smoothed[i] <= 0) continue;
    if (smoothed[i] > smoothed[i - 1] || smoothed[i] > smoothed[i + 1]) continue;
    let before = 0, after = 0;
    for (let j = 2; j < i - 3; j++) before = Math.max(before, smoothed[j]);
    for (let j = i + 4; j < Math.min(bins, i + 40); j++) after = Math.max(after, smoothed[j]);
    const score = smoothed[i] / Math.min(before, after);
    if (score < .7 && score < best) { best = score; neck = i / scale; }
  }
  // A round head can reach the torso before a surface-distance circle reaches
  // the back of the head. Search cross-sections along its outward direction too.
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i+k]);max[k]=Math.max(max[k],positions[i+k]);}
  let axis=min.map((x,k)=>centers[seed*3+k]-(x+max[k])/2);
  const order=[0,1,2].sort((a,b)=>Math.abs(axis[b])-Math.abs(axis[a]));
  // Do not tilt a lateral arm section up into the head just because the whole
  // character's bounds extend farther below its torso than above it.
  if(Math.abs(axis[order[0]])>Math.abs(axis[order[1]])*1.35)axis=axis.map((x,k)=>k===order[0]?Math.sign(x):0);
  const axisLength=Math.hypot(...axis);axis=axisLength>1e-8?axis.map(x=>x/axisLength):[0,0,1];
  const heights=new Float32Array(count);let low=Infinity,high=-Infinity;
  for(let f=0;f<count;f++)if(Number.isFinite(distances[f])){const h=axis.reduce((sum,x,k)=>sum+x*centers[f*3+k],0);heights[f]=h;low=Math.min(low,h);high=Math.max(high,h);}
  const planeScale=bins/Math.max(high-low,1e-8),planeFrontier=new Float64Array(bins+2),planeAreas=new Float64Array(bins+2);
  for(let f=0;f<count;f++)if(Number.isFinite(distances[f])){
    planeAreas[Math.min(bins,Math.ceil((high-heights[f])*planeScale))]+=areas[f];
    for(let j=0;j<3;j++){
      const g=topology.neighbors[f*3+j];if(g<0||g<f)continue;
      const start=Math.ceil((high-Math.max(heights[f],heights[g]))*planeScale),end=Math.ceil((high-Math.min(heights[f],heights[g]))*planeScale);
      const a=indices[f*3+j]*3,b=indices[f*3+(j+1)%3]*3;
      const edge=Math.hypot(positions[a]-positions[b],positions[a+1]-positions[b+1],positions[a+2]-positions[b+2]);
      planeFrontier[start]+=edge;planeFrontier[end]-=edge;
    }
  }
  for(let i=1;i<=bins;i++){planeFrontier[i]+=planeFrontier[i-1];planeAreas[i]+=planeAreas[i-1];}
  const profile=planeFrontier.map((_,i)=>{let total=0,n=0;for(let j=Math.max(0,i-3);j<=Math.min(bins,i+3);j++){total+=planeFrontier[j];n++;}return total/n;});
  let planeNeck=null,planeScore=.8;
  for(let i=8;i<bins-12;i++){
    if(high-i/planeScale>=heights[seed]||planeAreas[i]<componentArea*.005||planeAreas[i]>componentArea*.35||profile[i]<=0||profile[i]>profile[i-1]||profile[i]>profile[i+1])continue;
    let before=0,after=0;for(let j=2;j<i-3;j++)before=Math.max(before,profile[j]);for(let j=i+4;j<Math.min(bins,i+64);j++)after=Math.max(after,profile[j]);
    const score=profile[i]/Math.min(before,after);if(score<planeScore){planeNeck=i/planeScale;break;}
  }
  return { distances, maximum, componentFaces, neck, heights, high, low, planeNeck, axis, neighbors:topology.neighbors, seed };
}

export function proposePart(field, faces, kind = 'auto', extent) {
  const factors = { auto: .25, head: .28, arm: .35, hand: .12, eye: .045 };
  if (!(kind in factors)) throw new Error('Tipo de parte inválido.');
  const isolated = field.componentFaces < faces;
  const plane=!isolated&&['auto','head','arm'].includes(kind);
  const surfaceNeck=['auto','head','arm'].includes(kind)?field.neck:null;
  const maximum=plane?field.high-field.low:field.maximum;
  const radius = extent ?? (isolated ? field.maximum : plane?(field.planeNeck??Math.max(maximum*.18,field.high-field.heights[field.seed]+maximum*.05)):surfaceNeck ?? field.maximum * factors[kind]);
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Alcance de seleção inválido.');
  const mask = new Uint8Array(faces); let selectedFaces = 0;
  if(plane){
    const stack=[field.seed],threshold=field.high-radius;mask[field.seed]=1;
    while(stack.length){const f=stack.pop();selectedFaces++;for(let j=0;j<3;j++){const g=field.neighbors[f*3+j];if(g>=0&&!mask[g]&&field.heights[g]>=threshold){mask[g]=1;stack.push(g);}}}
  }else for (let f = 0; f < faces; f++) if (field.distances[f] <= radius) { mask[f] = 1; selectedFaces++; }
  return { mask, radius, maximum, selectedFaces, isolated, neckFound: plane?field.planeNeck!==null:surfaceNeck !== null, method:plane?'neck-section':'surface-distance', direction:field.axis };
}
