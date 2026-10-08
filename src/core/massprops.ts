import type { Vec3 } from "./solid";

export interface MassProperties {
  /** mm³ */
  volume: number;
  /** mm² */
  area: number;
  /** Ağırlık merkezi (mm). */
  centroid: Vec3;
  bbox: { min: Vec3; max: Vec3 };
  /**
   * Birim yoğunlukta ağırlık merkezi etrafında eylemsizlik tensörü (mm⁵): [[Ixx, −Ixy, −Ixz], ...].
   * Gerçek değer için yoğunlukla (mm⁻³ başına kütle) çarpılır.
   */
  inertia: [Vec3, Vec3, Vec3];
}

/**
 * Kapalı üçgen ağın kütle özellikleri (Eberly'nin çokyüzlü integralleri). Yüzeyler dışa bakmalıdır;
 * ters yönlü bir ağda hacim negatif çıkar ve işaret düzeltilir.
 */
export function massProperties(positions: Float32Array, indices: Uint32Array): MassProperties {
  let volume = 0;
  let area = 0;
  // Orijin etrafında ikinci mertebe integraller: x², y², z², xy, yz, zx ve birinci mertebe x, y, z (hacim üzerinde)
  let ix = 0, iy = 0, iz = 0;
  let xx = 0, yy = 0, zz = 0, xy = 0, yz = 0, zx = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  const p = (idx: number): Vec3 => [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
  for (let t = 0; t < indices.length; t += 3) {
    const a = p(indices[t]);
    const b = p(indices[t + 1]);
    const c = p(indices[t + 2]);
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    area += Math.hypot(cx, cy, cz) / 2;
    // Orijin–üçgen dört yüzlüsünün işaretli hacmi
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    volume += v;
    const sx = a[0] + b[0] + c[0];
    const sy = a[1] + b[1] + c[1];
    const sz = a[2] + b[2] + c[2];
    ix += (v * sx) / 4;
    iy += (v * sy) / 4;
    iz += (v * sz) / 4;
    // Dört yüzlü (orijin, a, b, c) üzerinde ∫x² dV = v/10·(Σ xi² + Σ_{i<j} xi xj) (köşe 0'ın orijin olmasıyla)
    const q = (u: number, w: number, s: number) => (v / 10) * (u * u + w * w + s * s + u * w + w * s + s * u);
    xx += q(a[0], b[0], c[0]);
    yy += q(a[1], b[1], c[1]);
    zz += q(a[2], b[2], c[2]);
    const cross = (u: Vec3, w: Vec3, s: Vec3, k1: number, k2: number) =>
      (v / 20) * (2 * (u[k1] * u[k2] + w[k1] * w[k2] + s[k1] * s[k2]) + u[k1] * w[k2] + u[k2] * w[k1] + w[k1] * s[k2] + w[k2] * s[k1] + s[k1] * u[k2] + s[k2] * u[k1]);
    xy += cross(a, b, c, 0, 1);
    yz += cross(a, b, c, 1, 2);
    zx += cross(a, b, c, 2, 0);
  }
  const sign = volume < 0 ? -1 : 1;
  volume *= sign;
  if (!volume) return { volume: 0, area, centroid: [0, 0, 0], bbox: { min, max }, inertia: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
  ix *= sign; iy *= sign; iz *= sign;
  xx *= sign; yy *= sign; zz *= sign; xy *= sign; yz *= sign; zx *= sign;
  const centroid: Vec3 = [ix / volume, iy / volume, iz / volume];
  const [gx, gy, gz] = centroid;
  // Orijin etrafından ağırlık merkezi etrafına (paralel eksen teoremi)
  const Ixx = yy + zz - volume * (gy * gy + gz * gz);
  const Iyy = xx + zz - volume * (gx * gx + gz * gz);
  const Izz = xx + yy - volume * (gx * gx + gy * gy);
  const Ixy = xy - volume * gx * gy;
  const Iyz = yz - volume * gy * gz;
  const Izx = zx - volume * gz * gx;
  return {
    volume,
    area,
    centroid,
    bbox: { min, max },
    inertia: [
      [Ixx, -Ixy, -Izx],
      [-Ixy, Iyy, -Iyz],
      [-Izx, -Iyz, Izz],
    ],
  };
}

/** Malzeme yoğunlukları (g/cm³). */
export const MATERIALS: Record<string, { label: string; density: number }> = {
  steel: { label: "Çelik", density: 7.85 },
  stainless: { label: "Paslanmaz çelik", density: 8.0 },
  aluminum: { label: "Alüminyum", density: 2.7 },
  brass: { label: "Pirinç", density: 8.5 },
  copper: { label: "Bakır", density: 8.96 },
  titanium: { label: "Titanyum", density: 4.51 },
  abs: { label: "ABS plastik", density: 1.05 },
  pla: { label: "PLA", density: 1.24 },
  wood: { label: "Ahşap (meşe)", density: 0.75 },
  water: { label: "Su", density: 1.0 },
};

/** Gram cinsinden kütle: mm³ × g/cm³ ÷ 1000. */
export function massGrams(volumeMm3: number, densityGcm3: number): number {
  return (volumeMm3 * densityGcm3) / 1000;
}
