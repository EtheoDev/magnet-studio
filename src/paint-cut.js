import { tangentBasis, toManifold, fromManifold } from './geometry.js';
import { selectionBoundary,buildTopology } from './paint-selection.js';
import {selectionSurface} from './selection-surface.js';
import { verifyInsertion } from './paint-validation.js';
import { independentSplit } from './split-tools.js';
import { separatePatch } from './paint-patch.js';

const dot = (a, b) => a.reduce((v, x, k) => v + x * b[k], 0);
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const area = p => p.reduce((a, v, i) => a + cross2(v, p[(i + 1) % p.length]), 0) / 2;
const pointIn = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
function intersects(a, b, c, d) {
  const ab = sub2(b, a), cd = sub2(d, c), den = cross2(ab, cd);
  if (Math.abs(den) < 1e-10) {
    if (Math.abs(cross2(sub2(c, a), ab)) > 1e-8) return false;
    const k = Math.abs(ab[0]) > Math.abs(ab[1]) ? 0 : 1;
    return Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k])) <= Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k])) + 1e-8;
  }
  const t = cross2(sub2(c, a), cd) / den, s = cross2(sub2(c, a), ab) / den;
  return t >= -1e-8 && t <= 1 + 1e-8 && s >= -1e-8 && s <= 1 + 1e-8;
}
function simple(ring) {
  if (ring.length > 12000) throw new Error('Contorno com mais de 12 mil arestas: simplifique/refine a seleção antes de preparar o assentamento.');
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(...sub2(a, b)) < 1e-7) return false;
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return false;
    }
  }
  return area(ring) > 1e-7;
}
function offsetRing(module, ring, width) {
  const source = new module.CrossSection([ring.map(p => p.slice(0, 2))]);
  let offset, simplified;
  try {
    offset = source.offset(-width, 'Round', 2, 48);
    simplified = offset.simplify(1e-5);
    const polygons = simplified.toPolygons();
    if (polygons.length !== 1 || polygons[0].length < 3 || !simple(polygons[0])) throw new Error('A faixa se cruza, cria ilhas ou não cabe no contorno. Reduza a largura ou ajuste a seleção.');
    return polygons[0];
  } finally { simplified?.delete(); offset?.delete(); source.delete(); }
}
function boundaryHeight(point, ring) {
  let distance = Infinity, height = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], edge = sub2(b, a), d = dot(edge, edge);
    const t = Math.max(0, Math.min(1, dot(sub2(point, a), edge) / d));
    const dist = (point[0] - a[0] - edge[0] * t) ** 2 + (point[1] - a[1] - edge[1] * t) ** 2;
    if (dist < distance) { distance = dist; height = a[2] + (b[2] - a[2]) * t; }
  }
  return height;
}

export function validateSeat(options) {
  const { width, depth, seatingGap, direction, maleSelected, refinement = 4 } = options;
  if (![width, depth, seatingGap].every(Number.isFinite) || width <= 0 || width > 100 || depth < 0 || depth > 100 || seatingGap < 0 || seatingGap > 5) throw new Error('Use faixa de 0 a 100 mm (maior que zero), profundidade de 0 a 100 mm e folga de assentamento de 0 a 5 mm.');
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite) || Math.hypot(...direction) < 1e-6) throw new Error('Defina uma direção de montagem não nula.');
  if (typeof maleSelected !== 'boolean' || !Number.isInteger(refinement) || refinement < 1 || refinement > 12) throw new Error('Parâmetros de assentamento inválidos.');
  return { ...options, refinement, direction: direction.map(x => x / Math.hypot(...direction)) };
}

// One reference surface drives both sides. The original exterior vertices are
// never moved. Only the new internal band is refined and smoothly flattened.
export function buildSeatSurfaces(module, data, topology, mask, input) {
  const options = validateSeat(input), diagnostics = selectionBoundary(data, topology, mask);
  if (!diagnostics.selectedFaces || diagnostics.selectedFaces === mask.length) throw new Error('Pinte uma região e mantenha parte da peça sem pintura.');
  if (diagnostics.ambiguousVertices || diagnostics.ambiguousEdges || diagnostics.openEdges) throw new Error('Fronteira ambígua ou malha aberta. Corrija a seleção ou repare a malha.');
  if (diagnostics.selectedComponents !== 1 || diagnostics.remainingComponents !== 1) throw new Error('Há ilhas na seleção ou no restante. Conecte as regiões antes de separar.');
  if (!diagnostics.loops.length) throw new Error('A seleção precisa de um contorno fechado.');
  const n = options.direction, { u, v } = tangentBasis(n), rings = [], capPoints = [], capTriangles = [], bandTriangles = [];
  const projections = diagnostics.loops.map(loop => loop.map(id => {
    const p = Array.from(data.positions.subarray(id * 3, id * 3 + 3));
    return [dot(p, u), dot(p, v), dot(p, n)];
  }));
  for (const ring of projections) if (!simple(ring)) throw new Error('O contorno dobra sobre si na direção escolhida ou a direção aponta para o restante. Ajuste a direção de saída da região pintada.');
  for (let i = 0; i < projections.length; i++) for (let j = i + 1; j < projections.length; j++) {
    const a = projections[i], b = projections[j];
    if (pointIn(a[0], b) || pointIn(b[0], a) || a.some((p, k) => b.some((q, l) => intersects(p, a[(k + 1) % a.length], q, b[(l + 1) % b.length])))) throw new Error('Aberturas sobrepostas na direção de montagem. Use outra direção ou separe uma região por vez.');
  }
  for (let l = 0; l < diagnostics.loops.length; l++) {
    const loop = diagnostics.loops[l], outer = projections[l];
    const height = outer.reduce((a, p) => a + p[2], 0) / outer.length - (options.maleSelected ? 1 : -1) * options.depth;
    let previous = loop.map(id => -id - 1), previousRing = outer, inner;
    for (let step = 1; step <= options.refinement; step++) {
      const t = step / options.refinement, smooth = t * t * (3 - 2 * t);
      inner = offsetRing(module, outer, options.width * t);
      const current = inner.map(p => {
        const z0 = boundaryHeight(p, outer), z = z0 + (height - z0) * smooth, id = capPoints.length;
        capPoints.push({ point: n.map((nk, k) => u[k] * p[0] + v[k] * p[1] + nk * z), gapWeight: smooth }); return id;
      });
      // Triangulate an annulus, allowing concave offsets to change vertex count.
      // A triangle fan or one-to-one miter loft cannot handle painted notches.
      const refs = [...previous, ...current.slice().reverse()];
      const band = module.triangulate([previousRing.map(p => p.slice(0, 2)), inner.slice().reverse()], 1e-8, false);
      for (const triangle of band) { const tri = triangle.map(id => refs[id]); capTriangles.push(tri); bandTriangles.push(tri); }
      previous = current; previousRing = inner;
    }
    const triangles = module.triangulate([inner], 1e-8, false);
    if (!triangles.length) throw new Error('Não foi possível triangular a área de apoio.');
    for (const tri of triangles) capTriangles.push(tri.map(id => previous[id]));
    rings.push({ inner, height, center: inner.reduce((c, p) => c.map((x, k) => x + p[k] / inner.length), [0, 0]), loop: l });
  }

  function extract(side) {
    const vertexMap = new Int32Array(data.positions.length / 3).fill(-1), positions = [], indices = [];
    const original = id => {
      if (vertexMap[id] < 0) { vertexMap[id] = positions.length / 3; positions.push(data.positions[id * 3], data.positions[id * 3 + 1], data.positions[id * 3 + 2]); }
      return vertexMap[id];
    };
    for (let f = 0; f < mask.length; f++) if (!!mask[f] === side) for (let j = 0; j < 3; j++) indices.push(original(data.indices[f * 3 + j]));
    // Install boundary originals before appending internal points.
    for (const loop of diagnostics.loops) for (const id of loop) original(id);
    const start = positions.length / 3;
    for (const { point, gapWeight } of capPoints) positions.push(...point.map((x, k) => x - (side ? 0 : options.seatingGap * gapWeight * n[k])));
    const resolve = id => id < 0 ? vertexMap[-id - 1] : start + id;
    for (const tri of capTriangles) { const ids = tri.map(resolve); if (side) ids.reverse(); indices.push(...ids); }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
  }
  const point = id => id < 0 ? Array.from(data.positions.subarray((-id - 1) * 3, (-id - 1) * 3 + 3)) : capPoints[id].point;
  const transition = new Float32Array(bandTriangles.flatMap(tri => tri.flatMap(point)));
  return { selected: extract(true), remaining: extract(false), transition, diagnostics, reference: { rings, u, v, n, options } };
}

function components(solid) { const parts = solid.decompose(); try { return parts.length; } finally { parts.forEach(p => p.delete()); } }
function volumeOf(a, operation, b) { const r = a[operation](b); try { return Math.abs(r.volume()); } finally { r.delete(); } }
function assertSolid(solid) {
  if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) throw new Error('O assentamento não produziu um sólido fechado e orientado. Ajuste a direção, faixa ou profundidade.');
  if (components(solid) !== 1) throw new Error('O corte criou ilhas. Ajuste o contorno ou o encaixe.');
}
export function separatePainted(module, base, data, topology, mask, options) {
  if(options.selectionField){
    const surface=selectionSurface(data,mask,options.selectionField);
    return separatePainted(module,base,surface.data,buildTopology(surface.data),surface.mask,{...options,selectionField:null,contourRadius:0});
  }
  const diagnostics=selectionBoundary(data,topology,mask);
  if(diagnostics.selectedFaces>0&&diagnostics.selectedFaces<mask.length&&!diagnostics.edges.length)return independentSplit(module,base,data,mask,diagnostics);
  if(options.method==='patch')return separatePatch(module,base,data,topology,mask,options);
  const surfaces = buildSeatSurfaces(module, data, topology, mask, options);
  let selected, remaining;
  try {
    selected = toManifold(module, surfaces.selected); remaining = toManifold(module, surfaces.remaining);
    assertSolid(selected); assertSolid(remaining);
    const tolerance = Math.max(1e-5, base.volume() * 1e-7);
    const overlap = volumeOf(selected, 'intersect', remaining);
    const outside = volumeOf(selected, 'subtract', base) + volumeOf(remaining, 'subtract', base);
    if (overlap > tolerance || outside > tolerance) throw new Error('A transição cruza a superfície externa ou a outra peça. Reduza a faixa/profundidade ou ajuste a direção.');
    const path = verifyInsertion(fromManifold(selected), fromManifold(remaining), surfaces.reference.n);
    const report = { closed: true, oriented: true, components: [1, 1], overlap, outside, originalVolume: base.volume(), volumes: [selected.volume(), remaining.volume()], removedForSeating: base.volume() - selected.volume() - remaining.volume(), exteriorDisplacement: 0, canKey:true, path };
    return { selected, remaining, source: base, reference: surfaces.reference, transition: surfaces.transition, report, diagnostics: surfaces.diagnostics };
  } catch (error) { selected?.delete(); remaining?.delete(); throw error; }
}

export function validateKey(key) {
  for (const field of ['width', 'height', 'length', 'anchor', 'lateral', 'bottom', 'wall']) if (!Number.isFinite(key[field])) throw new Error('Preencha as medidas da chave com números válidos.');
  if (!['round', 'rectangular', 'tapered'].includes(key.shape) || [key.width, key.height, key.length, key.anchor].some(x => x < 0.2 || x > 100) || [key.lateral, key.bottom].some(x => x < 0 || x > 5) || key.wall < 0.1 || key.wall > 20) throw new Error('Medidas da chave ou folgas fora dos limites.');
  if (![key.point, key.rotation].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) throw new Error('Posição ou rotação da chave inválida.');
  if (typeof key.maleSelected !== 'boolean') throw new Error('Escolha o lado macho da chave.');
}
// Explicit dimensional offsets: lateral is PER SIDE, bottom is axial. Tapered
// walls use the normal-distance correction, not proportional scaling.
export function keyDimensions(key, socket = false, extra = 0) {
  const lateral = (socket ? key.lateral : 0) + extra, bottom = (socket ? key.bottom : 0) + extra;
  const taper = key.shape === 'tapered' ? Math.min(key.width, key.height) * 0.15 : 0;
  const slope = taper / key.length, offset = lateral * Math.sqrt(1 + slope * slope);
  return { width: key.width + 2 * offset, height: (key.shape === 'round' ? key.width : key.height) + 2 * offset, length: key.length + bottom, taper, slope, offset, bottom };
}
function createKey(module, key, reference, socket = false, extra = 0) {
  const d = keyDimensions(key, socket, extra), anchor = key.anchor + extra;
  let primitive;
  if (key.shape === 'round') primitive = module.Manifold.cylinder(d.length + anchor, d.width / 2, d.width / 2, 96, false);
  else if (key.shape === 'rectangular') {
    const cube = module.Manifold.cube([d.width, d.height, d.length + anchor], false);
    try { primitive = cube.translate([-d.width / 2, -d.height / 2, 0]); } finally { cube.delete(); }
  } else {
    // Anchor keeps full width; the entering portion is a frustum.
    const w = d.width, h = d.height, tipW = w - 2 * d.slope * d.length, tipH = h - 2 * d.slope * d.length;
    if (tipW <= 0 || tipH <= 0) throw new Error('A folga de fundo ultrapassa a ponta afunilada.');
    const section = new module.CrossSection([[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]]);
    const stem = section.extrude(anchor), taper = section.extrude(d.length, 0, 0, [tipW / w, tipH / h]);
    const raised = taper.translate([0, 0, anchor]);
    try { primitive = stem.add(raised); } finally { section.delete(); stem.delete(); taper.delete(); raised.delete(); }
  }
  // Euler rotations are local to the prepared surface, then its basis is applied.
  const sign = key.maleSelected ? -1 : 1, { u, v, n } = reference;
  const anchored = primitive.translate([0, 0, -anchor]); primitive.delete();
  const rotated = anchored.rotate(key.rotation); anchored.delete();
  // Flip both v and n to keep a positive determinant.
  try { return rotated.transform([...u, 0, ...v.map(x => x * sign), 0, ...n.map(x => x * sign), 0, ...key.point, 1]); }
  finally { rotated.delete(); }
}
export function applyPaintKey(module, prepared, key) {
  validateKey(key);
  const sourceMale = key.maleSelected ? prepared.selected : prepared.remaining, sourceFemale = key.maleSelected ? prepared.remaining : prepared.selected;
  let peg, socket, wallTool, male, female;
  try {
    peg = createKey(module, key, prepared.reference); socket = createKey(module, key, prepared.reference, true);
    wallTool = createKey(module, key, prepared.reference, true, key.wall);
    const tolerance = Math.max(1e-5, sourceMale.volume() * 1e-7);
    if (volumeOf(peg, 'intersect', sourceMale) < tolerance || volumeOf(peg, 'intersect', sourceFemale) < tolerance) throw new Error('Posicione a chave atravessando a superfície de assentamento, com a base dentro do macho.');
    // Containment against the original envelope measures the requested lateral
    // and bottom wall even when an intentional seating slit is present.
    if (volumeOf(wallTool, 'subtract', prepared.source) > tolerance) throw new Error('Espessura insuficiente ao redor da chave. Reduza as medidas ou reposicione o encaixe.');
    const { n, u, v, options } = prepared.reference;
    const ring = prepared.reference.rings.find(r => pointIn([dot(key.point, u), dot(key.point, v)], r.inner));
    if (!ring) throw new Error('Posicione a chave dentro da área de apoio preparada.');
    const femaleSign = key.maleSelected ? -1 : 1;
    const femaleHeight = ring.height - (key.maleSelected ? options.seatingGap : 0);
    const maleHeight = ring.height - (key.maleSelected ? 0 : options.seatingGap);
    const femaleWall = wallTool.trimByPlane(n.map(x => x * femaleSign), femaleHeight * femaleSign);
    const maleAnchor = peg.trimByPlane(n.map(x => -x * femaleSign), -maleHeight * femaleSign);
    try {
      if (volumeOf(femaleWall, 'subtract', sourceFemale) > tolerance || volumeOf(maleAnchor, 'subtract', sourceMale) > tolerance) throw new Error('A chave ultrapassa a área de apoio ou deixa parede insuficiente em uma das peças. Reduza ou reposicione a chave.');
    } finally { femaleWall.delete(); maleAnchor.delete(); }
    male = sourceMale.add(peg); female = sourceFemale.subtract(socket);
    assertSolid(male); assertSolid(female);
    const overlap = volumeOf(male, 'intersect', female);
    if (overlap > tolerance) throw new Error('A chave ainda interfere no alojamento. Revise as folgas e a rotação.');
    const selected = key.maleSelected ? male : female, remaining = key.maleSelected ? female : male;
    const path = verifyInsertion(fromManifold(selected), fromManifold(remaining), prepared.reference.n);
    return { selected, remaining, report: { ...prepared.report, volumes: [selected.volume(), remaining.volume()], overlap, path, key: { ...key, male: keyDimensions(key), socket: keyDimensions(key, true), minimumWall: key.wall } } };
  } catch (error) { male?.delete(); female?.delete(); throw error; }
  finally { peg?.delete(); socket?.delete(); wallTool?.delete(); }
}
