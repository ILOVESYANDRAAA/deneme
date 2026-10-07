import type { MeshData } from "./evaluate";

/** Ağları tek bir ikili (binary) STL dosyasında birleştirir. */
export function meshesToStl(meshes: MeshData[], header = "sugarCAD"): Uint8Array {
  const triCount = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const head = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(head);
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (const { positions: p, indices } of meshes) {
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3;
      const b = indices[t + 1] * 3;
      const c = indices[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const values = [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]];
      for (const v of values) {
        view.setFloat32(offset, v, true);
        offset += 4;
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
