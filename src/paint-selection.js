// Face IDs always refer to the (possibly BVH-reordered) installed index buffer.
// CSR incidence avoids millions of JS edge objects on large STL files.
export function buildTopology({ positions, indices }) {
  const vertices = positions.length / 3, faces = indices.length / 3;
  const offsets = new Uint32Array(vertices + 1);
  for (const v of indices) offsets[v + 1]++;
  for (let v = 1; v <= vertices; v++) offsets[v] += offsets[v - 1];
  const cursor = offsets.slice(), incident = new Uint32Array(indices.length);
  for (let h = 0; h < indices.length; h++) incident[cursor[indices[h]]++] = h;
  const neighbors = new Int32Array(indices.length).fill(-1);
  let ambiguousEdges = 0, openEdges = 0;
  for (let h = 0; h < indices.length; h++) {
    const f = Math.floor(h / 3), a = indices[h], b = indices[f * 3 + (h % 3 + 1) % 3];
    let found = -1, count = 0, reversed = false;
    for (let j = offsets[a]; j < offsets[a + 1]; j++) {
      const other = incident[j], g = Math.floor(other / 3);
      if (g === f) continue;
      const prev = indices[g * 3 + (other % 3 + 2) % 3], next = indices[g * 3 + (other % 3 + 1) % 3];
      if (prev === b || next === b) { found = g; count++; reversed = prev === b; }
    }
    if (count === 1 && reversed) neighbors[h] = found;
    else if (count) { neighbors[h] = -2; ambiguousEdges++; }
    else openEdges++;
  }
  return { neighbors, faces, ambiguousEdges, openEdges };
}

export function selectionBoundary(data, topology, selected) {
  const { indices } = data, { neighbors, faces } = topology;
  if (selected.length !== faces) throw new Error('A seleção não corresponde à malha atual.');
  const edges = [], outgoing = new Map(), incoming = new Map();
  let count = 0;
  for (let f = 0; f < faces; f++) if (selected[f]) {
    count++;
    for (let j = 0; j < 3; j++) {
      const h = f * 3 + j, n = neighbors[h];
      if (n >= 0 && selected[n]) continue;
      const a = indices[h], b = indices[f * 3 + (j + 1) % 3];
      edges.push([a, b]);
      if (!outgoing.has(a)) outgoing.set(a, []);
      outgoing.get(a).push(b); incoming.set(b, (incoming.get(b) || 0) + 1);
    }
  }
  let ambiguousVertices = 0;
  for (const [a, next] of outgoing) if (next.length !== 1 || incoming.get(a) !== 1) ambiguousVertices++;
  const loops = [], visited = new Set();
  if (!ambiguousVertices) for (const [start] of outgoing) {
    if (visited.has(start)) continue;
    const loop = []; let v = start;
    while (!visited.has(v) && outgoing.has(v)) { visited.add(v); loop.push(v); v = outgoing.get(v)[0]; }
    if (v === start && loop.length >= 3) loops.push(loop); else ambiguousVertices++;
  }
  const seen = new Uint8Array(faces), stack = new Uint32Array(faces);
  const components = [0, 0], smallest = [faces, faces];
  for (let f = 0; f < faces; f++) if (!seen[f]) {
    const side = selected[f] ? 1 : 0; components[side]++; let top = 0, size = 0;
    stack[top++] = f; seen[f] = 1;
    while (top) {
      const current = stack[--top]; size++;
      for (let j = 0; j < 3; j++) {
        const n = neighbors[current * 3 + j];
        if (n >= 0 && !seen[n] && !!selected[n] === !!side) { seen[n] = 1; stack[top++] = n; }
      }
    }
    smallest[side] = Math.min(smallest[side], size);
  }
  return { edges, loops, selectedFaces: count, selectedComponents: components[1], remainingComponents: components[0], smallestSelected: count ? smallest[1] : 0, ambiguousVertices, ambiguousEdges: topology.ambiguousEdges, openEdges: topology.openEdges };
}

export class FaceSelection {
  constructor(count, maxHistoryBytes = 32 * 1024 * 1024) {
    this.mask = new Uint8Array(count); this.undoStack = []; this.redoStack = [];
    this.maxHistoryBytes = maxHistoryBytes; this.stroke = null; this.count = 0;
  }
  begin() { if (!this.stroke) this.stroke = new Set(); }
  paint(faces, value) {
    this.begin(); const changed = [];
    for (const f of faces) if (this.mask[f] !== Number(value)) {
      this.mask[f] = Number(value); this.count += value ? 1 : -1; changed.push(f);
      if (this.stroke.has(f)) this.stroke.delete(f); else this.stroke.add(f);
    }
    return changed;
  }
  commit() {
    const delta = Uint32Array.from(this.stroke || []); this.stroke = null;
    if (delta.length) {
      this.undoStack.push(delta); this.redoStack = [];
      let bytes = this.undoStack.reduce((n, x) => n + x.byteLength, 0);
      while (bytes > this.maxHistoryBytes && this.undoStack.length > 1) bytes -= this.undoStack.shift().byteLength;
    }
    return delta;
  }
  history(redo = false) {
    this.commit();
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const delta = from.pop() || new Uint32Array();
    for (const f of delta) { this.mask[f] ^= 1; this.count += this.mask[f] ? 1 : -1; }
    if (delta.length) to.push(delta);
    return delta;
  }
  replace(mask) { this.begin(); for (let f = 0; f < mask.length; f++) if (mask[f] !== this.mask[f]) this.paint([f], !!mask[f]); return this.commit(); }
  invert() { this.begin(); for (let f = 0; f < this.mask.length; f++) this.paint([f], !this.mask[f]); return this.commit(); }
}

// Each candidate was found spatially and passed visibility testing. Flooding only
// through those faces prevents jumping to the torso or an adjacent limb.
export function connectedBrush(neighbors, seed, candidates) {
  if (!candidates.has(seed)) return [];
  const result = [], stack = [seed], seen = new Set([seed]);
  while (stack.length) {
    const f = stack.pop(); result.push(f);
    for (let j = 0; j < 3; j++) {
      const n = neighbors[f * 3 + j];
      if (n >= 0 && candidates.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return result;
}

export function smoothSelection(mask, neighbors, iterations = 2) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error('Use intensidade de 1 a 20.');
  let current = mask.slice();
  for (let pass = 0; pass < iterations; pass++) {
    const next = current.slice();
    for (let f = 0; f < mask.length; f++) {
      let same = 0, different = 0;
      for (let j = 0; j < 3; j++) {
        const n = neighbors[f * 3 + j];
        if (n >= 0) { if (current[n] === current[f]) same++; else different++; }
      }
      if (different > same && different >= 2) next[f] ^= 1;
    }
    current = next;
  }
  return current;
}
