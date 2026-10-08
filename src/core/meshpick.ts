import type { Vec3 } from "./solid";

export interface FaceRegion {
  /** Bölgeyi oluşturan üçgen indeksleri. */
  tris: number[];
  /** Bölgenin dışa bakan birim normali. */
  normal: Vec3;
  /** Alan ağırlıklı merkez (düzlem üzerinde). */
  centroid: Vec3;
  area: number;
}

interface Adjacency {
  /** Her üçgenin kenar komşuları. */
  neighbours: number[][];
}

const cache = new WeakMap<Uint32Array, Adjacency>();

function adjacencyOf(indices: Uint32Array): Adjacency {
  const hit = cache.get(indices);
  if (hit) return hit;
  const triCount = indices.length / 3;
  const neighbours: number[][] = Array.from({ length: triCount }, () => []);
  const edges = new Map<number, number>();
  const base = Math.max(...indices) + 1 || 1;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t * 3 + k];
      const b = indices[t * 3 + ((k + 1) % 3)];
      const key = Math.min(a, b) * base + Math.max(a, b);
      const other = edges.get(key);
      if (other === undefined) edges.set(key, t);
      else {
        neighbours[t].push(other);
        neighbours[other].push(t);
      }
    }
  }
  const out = { neighbours };
  cache.set(indices, out);
  return out;
}

function triangle(positions: Float32Array, indices: Uint32Array, t: number): [Vec3, Vec3, Vec3] {
  const p = (k: number): Vec3 => {
    const i = indices[t * 3 + k] * 3;
    return [positions[i], positions[i + 1], positions[i + 2]];
  };
  return [p(0), p(1), p(2)];
}

function normalOf([a, b, c]: [Vec3, Vec3, Vec3]): { n: Vec3; area: number } {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  return { n: len ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0], area: len / 2 };
}

/**
 * Verilen üçgenin bulunduğu düz yüzey bölgesi: aynı düzlemde olup kenarlarla bağlanan üçgenler.
 * Eğri yüzeyde (komşu normaller ayrışır) sadece o üçgen döner.
 */
export function coplanarRegion(positions: Float32Array, indices: Uint32Array, start: number): FaceRegion | null {
  if (start < 0 || start * 3 >= indices.length) return null;
  const { neighbours } = adjacencyOf(indices);
  const first = triangle(positions, indices, start);
  const { n } = normalOf(first);
  const d0 = n[0] * first[0][0] + n[1] * first[0][1] + n[2] * first[0][2];
  const tol = 1e-4 * (1 + Math.abs(d0));
  const seen = new Set([start]);
  const queue = [start];
  const tris: number[] = [];
  let area = 0;
  const sum: Vec3 = [0, 0, 0];
  while (queue.length) {
    const t = queue.pop()!;
    const tri = triangle(positions, indices, t);
    const { area: ta } = normalOf(tri);
    tris.push(t);
    area += ta;
    const c: Vec3 = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
    for (let k = 0; k < 3; k++) sum[k] += c[k] * ta;
    for (const nb of neighbours[t]) {
      if (seen.has(nb)) continue;
      const nbTri = triangle(positions, indices, nb);
      const { n: nn } = normalOf(nbTri);
      const dot = nn[0] * n[0] + nn[1] * n[1] + nn[2] * n[2];
      const dist = Math.abs(n[0] * nbTri[0][0] + n[1] * nbTri[0][1] + n[2] * nbTri[0][2] - d0);
      if (dot > 0.99999 && dist < tol) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return { tris, normal: n, centroid: area ? [sum[0] / area, sum[1] / area, sum[2] / area] : first[0], area };
}
