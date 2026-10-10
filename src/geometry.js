import { BufferGeometry, BufferAttribute, Float32BufferAttribute } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Limits below apply to experimental LYS containers and cavity count, not STL repair.
export const LIMITS = { bytes: 200 * 1024 * 1024, triangles: 3_000_000, cavities: 100 };

export function validateCavity(c) {
  for (const key of ['diameter', 'thickness', 'diameterAllowance', 'depthAllowance']) {
    if (!Number.isFinite(c[key])) throw new Error('Preencha todas as medidas com números válidos.');
  }
  if (c.diameter < 0.5 || c.diameter > 100 || c.thickness < 0.2 || c.thickness > 100) throw new Error('Use diâmetro de 0,5 a 100 mm e espessura de 0,2 a 100 mm.');
  if (c.diameterAllowance < 0 || c.diameterAllowance > 5 || c.depthAllowance < 0 || c.depthAllowance > 5) throw new Error('As folgas devem estar entre 0 e 5 mm.');
  if (!Array.isArray(c.point) || !Array.isArray(c.normal) || c.point.length !== 3 || c.normal.length !== 3 || ![...c.point, ...c.normal].every(Number.isFinite)) throw new Error('Posição ou orientação inválida.');
  const len = Math.hypot(...c.normal);
  if (Math.abs(len - 1) > 0.001) throw new Error('A direção da cavidade deve ser normalizada.');
}

export function cavityDimensions(c) {
  return { diameter: c.diameter + c.diameterAllowance, depth: c.thickness + c.depthAllowance };
}

// STL repeats vertices per triangle. Weld exact positions without rounding away detail.
export function indexPositions(array, unitScale = 1) {
  if (!Number.isFinite(unitScale) || unitScale <= 0) throw new Error('Escala inválida.');
  if (array.length === 0 || array.length % 9 !== 0) throw new Error('O STL não contém triângulos válidos.');
  const vertices = [], indices = new Uint32Array(array.length / 3), lookup = new Map();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < array.length; i += 3) {
    const p = [array[i] * unitScale, array[i + 1] * unitScale, array[i + 2] * unitScale];
    if (!p.every(Number.isFinite)) throw new Error('O STL contém coordenadas inválidas.');
    const key = `${p[0]},${p[1]},${p[2]}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = vertices.length / 3; lookup.set(key, index); vertices.push(...p);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
    indices[i / 3] = index;
  }
  const offset = min.map((v, k) => (v + max[k]) / 2);
  const size = min.map((v, k) => max[k] - v);
  if (size.some(v => v <= 0)) throw new Error('O STL precisa representar um sólido com volume.');
  for (let i = 0; i < vertices.length; i++) vertices[i] -= offset[i % 3];
  return { positions: new Float32Array(vertices), indices, offset, size };
}

export function parseSTL(buffer, scale = 1) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 15) throw new Error('Arquivo STL vazio ou incompleto.');
  if (buffer.byteLength >= 84) {
    const n = new DataView(buffer).getUint32(80, true);
    const expected = 84 + n * 50;
    if (expected !== buffer.byteLength) {
      const header = new TextDecoder().decode(buffer.slice(0, 256)).trimStart();
      if (!header.startsWith('solid')) throw new Error('O STL binário está incompleto ou tem uma contagem de triângulos incompatível.');
    }
  }
  let geometry;
  try {
    geometry = new STLLoader().parse(buffer);
    const p = geometry.getAttribute('position');
    if (!p || !p.count) throw new Error('O STL não contém triângulos válidos.');
    return indexPositions(p.array, scale);
  } finally { geometry?.dispose(); }
}

export function toManifold(module, data) {
  const mesh = new module.Mesh({ numProp: 3, vertProperties: data.positions, triVerts: data.indices });
  // Deliberately no broad-tolerance repair: preserve dimensions and surface detail.
  let solid;
  try {
    solid = new module.Manifold(mesh);
    if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) throw new Error('invalid solid');
    return solid;
  } catch {
    solid?.delete();
    throw new Error('A malha precisa ser fechada e orientada para fora. Repare superfícies abertas, faces duplicadas ou invertidas no seu modelador e importe novamente.');
  }
}

export function fromManifold(solid) {
  const m = solid.getMesh();
  const positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = m.vertProperties[i * m.numProp + k];
  return { positions, indices: new Uint32Array(m.triVerts) };
}

export function tangentBasis(n) {
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  let u = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const len = Math.hypot(...u); u = u.map(x => x / len);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}

export function createCutter(module, cavity) {
  validateCavity(cavity);
  const { diameter, depth } = cavityDimensions(cavity);
  return axialCylinder(module,cavity,diameter,depth,Math.max(0.5,diameter/2));
}

// Also used for drainage smaller than the minimum magnet size.
export function axialCylinder(module,cavity,diameter,depth,outward=0.02) {
  const n = cavity.normal, { u, v } = tangentBasis(n);
  const origin = cavity.point.map((x, k) => x - n[k] * depth);
  const radius = diameter / 2;
  const segments = Math.max(64, Math.min(512, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 0.005 / radius)))));
  const primitive = module.Manifold.cylinder(depth + outward, radius, radius, segments, false);
  try {
    return primitive.transform([u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, ...origin, 1]);
  } finally { primitive.delete(); }
}

export function createReinforcement(module,c,envelope) {
  validateCavity(c);
  if(!envelope)throw new Error('Reforço interno disponível para peças ocas importadas de LYS.');
  if(![c.wall,c.bottom].every(v=>Number.isFinite(v)&&v>=0.5&&v<=10))throw new Error('Use parede e fundo do reforço entre 0,5 e 10 mm.');
  const {diameter,depth}=cavityDimensions(c);
  const tool=axialCylinder(module,c,diameter+2*c.wall,depth+c.bottom);
  try{return tool.intersect(envelope);}finally{tool.delete();}
}

export function cutCavities(module, base, cavities) {
  if (cavities.length > LIMITS.cavities) throw new Error('O limite desta versão é 100 cavidades.');
  let current = base;
  try {
    for (const c of cavities) {
      const cutter = createCutter(module, c);
      let next;
      try {
        next = current.subtract(cutter);
        if (next.status() !== 'NoError' || next.isEmpty()) throw new Error('O corte removeu toda a peça ou produziu uma geometria inválida.');
      } catch (err) { next?.delete(); throw err; }
      finally { cutter.delete(); }
      if (current !== base) current.delete();
      current = next;
    }
    return current;
  } catch (err) { if (current !== base) current.delete(); throw err; }
}

export function cutWithReinforcement(module, base, cavities, envelope) {
  if(cavities.length>LIMITS.cavities)throw new Error('O limite desta versão é 100 cavidades.');
  let reinforced=base;
  try {
    for(const c of cavities) {
      validateCavity(c);
      if(!c.reinforce)continue;
      const boss=createReinforcement(module,c,envelope);
      try {
        const next=reinforced.add(boss);
        if(reinforced!==base)reinforced.delete();reinforced=next;
      }finally{boss.delete();}
    }
    // Add every boss first so later reinforcements cannot fill earlier pockets.
    const result=cutCavities(module,reinforced,cavities);
    if(result!==reinforced&&reinforced!==base)reinforced.delete();
    return result;
  }catch(error){if(reinforced!==base)reinforced.delete();throw error;}
}

export function binarySTL(data, offset = [0, 0, 0]) {
  const count = data.indices.length / 3;
  const buffer = new ArrayBuffer(84 + count * 50), view = new DataView(buffer);
  new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode('MagnetLab | coordinates in millimeters'));
  view.setUint32(80, count, true);
  let cursor = 84;
  for (let t = 0; t < count; t++) {
    const p = [0, 1, 2].map(j => {
      const idx = data.indices[t * 3 + j] * 3;
      return [0, 1, 2].map(k => data.positions[idx + k] + offset[k]);
    });
    const a = p[1].map((x, k) => x - p[0][k]), b = p[2].map((x, k) => x - p[0][k]);
    const normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const len = Math.hypot(...normal) || 1;
    for (const val of [...normal.map(x => x / len), ...p.flat()]) { view.setFloat32(cursor, val, true); cursor += 4; }
    view.setUint16(cursor, 0, true); cursor += 2;
  }
  return buffer;
}

export function toGeometry(data) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(data.indices), 1));
  g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}
