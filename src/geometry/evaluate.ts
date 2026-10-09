import type { Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import { solidKey, type Solid } from "../core/solid";

/** İşçiden ana iş parçacığına aktarılan üçgen ağı. */
export interface MeshData {
  /** x, y, z dizisi (köşe başına 3 sayı). */
  positions: Float32Array;
  /** Üçgen köşe indeksleri. */
  indices: Uint32Array;
  volume: number;
  triangles: number;
}

/**
 * Tarifleri manifold-3d ile katıya çevirir. Alt ağaçları anahtarlarına göre
 * önbelleğe alır: bir parametre değişince sadece etkilenen dallar yeniden hesaplanır.
 */
export class SolidEvaluator {
  private cache = new Map<string, Manifold>();
  private used = new Set<string>();

  constructor(private readonly wasm: ManifoldToplevel) {}

  /** Bir değerlendirme turunu başlatır; turda kullanılmayan önbellek girdileri sonra silinir. */
  beginPass(): void {
    this.used.clear();
  }

  endPass(): void {
    for (const [key, m] of this.cache) {
      if (!this.used.has(key)) {
        m.delete();
        this.cache.delete(key);
      }
    }
  }

  evaluate(solid: Solid): Manifold {
    const key = solidKey(solid);
    this.used.add(key);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.build(solid);
    this.cache.set(key, result);
    return result;
  }

  private build(solid: Solid): Manifold {
    const { Manifold } = this.wasm;
    switch (solid.kind) {
      case "box":
        // Kutu XY düzleminde ortalanır, tabanı Z=0'da durur (CAD alışkanlığı).
        return Manifold.cube(solid.size, true).translate([0, 0, solid.size[2] / 2]);
      case "cylinder":
        return Manifold.cylinder(solid.height, solid.radius, solid.radius, solid.segments ?? 0);
      case "sphere":
        return Manifold.sphere(solid.radius, solid.segments ?? 0);
      case "coil":
        return this.coil(solid);
      case "extrude":
      case "revolve": {
        const section = new this.wasm.CrossSection(solid.polygons, solid.fillRule ?? "Positive");
        try {
          return solid.kind === "extrude"
            ? Manifold.extrude(section, solid.height)
            : Manifold.revolve(section, solid.segments ?? 0, solid.angle);
        } finally {
          section.delete();
        }
      }
      case "boolean": {
        const parts = solid.children.map((c) => this.evaluate(c));
        if (parts.length === 1) return parts[0].translate([0, 0, 0]);
        if (solid.op === "union") return Manifold.union(parts);
        if (solid.op === "subtract") return Manifold.difference(parts);
        return Manifold.intersection(parts);
      }
      case "transform": {
        // Sonuç her zaman yeni bir nesnedir; önbellekteki çocuk ayrıca silinebilsin.
        const child = this.evaluate(solid.child);
        let m = child;
        const step = (next: Manifold) => {
          if (m !== child) m.delete();
          m = next;
        };
        if (solid.matrix) step(m.transform(solid.matrix as Mat4));
        if (solid.rotate) step(m.rotate(solid.rotate));
        if (solid.translate) step(m.translate(solid.translate));
        return m === child ? child.translate([0, 0, 0]) : m;
      }
      case "fillet":
      case "chamfer":
      case "shell":
      case "draft":
      case "loft":
      case "sweep":
      case "step":
        // Bu tarifler session tarafından OpenCascade işçisine yönlendirilir; buraya gelmemeli.
        throw new Error("Yuvarlatma, pah, kabuk, loft ve süpürme için OpenCascade çekirdeği gerekir");
    }
  }

  /**
   * Helis: dairesel tel kesitini (Frenet çerçevesinde, yola dik) sarmal boyunca ilerleterek kapalı bir ağ kurar.
   * Eksen Z, sarmal Z=0'da başlar ve sağ vidalıdır; uçlar yola dik düz kapaklardır.
   */
  private coil(s: Extract<Solid, { kind: "coil" }>): Manifold {
    const ring = 24;
    const steps = Math.max(2, Math.ceil(s.turns * (s.segments ?? 48)));
    const c = s.pitch / (2 * Math.PI);
    const len = Math.hypot(s.radius, c);
    const verts = new Float32Array((ring * (steps + 1) + 2) * 3);
    let o = 0;
    for (let i = 0; i <= steps; i++) {
      const t = (2 * Math.PI * s.turns * i) / steps;
      const [cos, sin] = [Math.cos(t), Math.sin(t)];
      // N: eksene doğru, T: yol teğeti, B = T × N
      const N = [-cos, -sin, 0];
      const T = [(-s.radius * sin) / len, (s.radius * cos) / len, c / len];
      const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      const P = [s.radius * cos, s.radius * sin, c * t];
      for (let j = 0; j < ring; j++) {
        const a = (2 * Math.PI * j) / ring;
        const [ca, sa] = [Math.cos(a) * s.wire, Math.sin(a) * s.wire];
        for (let k = 0; k < 3; k++) verts[o++] = P[k] + ca * N[k] + sa * B[k];
      }
    }
    // Uç kapaklarının merkezleri
    const startCenter = ring * (steps + 1);
    const endCenter = startCenter + 1;
    for (const [idx, t] of [[startCenter, 0], [endCenter, 2 * Math.PI * s.turns]] as const) {
      verts[idx * 3] = s.radius * Math.cos(t);
      verts[idx * 3 + 1] = s.radius * Math.sin(t);
      verts[idx * 3 + 2] = c * t;
    }
    const tris: number[] = [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * ring + j;
        const b = i * ring + ((j + 1) % ring);
        tris.push(a, b, b + ring, a, b + ring, a + ring);
      }
    }
    for (let j = 0; j < ring; j++) {
      const k = (j + 1) % ring;
      tris.push(startCenter, k, j);
      tris.push(endCenter, steps * ring + j, steps * ring + k);
    }
    const mesh = new this.wasm.Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) });
    return new this.wasm.Manifold(mesh);
  }

  toMesh(m: Manifold): MeshData {
    const mesh = m.getMesh();
    const n = mesh.numProp;
    const vertCount = mesh.vertProperties.length / n;
    let positions: Float32Array;
    if (n === 3) {
      positions = new Float32Array(mesh.vertProperties);
    } else {
      positions = new Float32Array(vertCount * 3);
      for (let i = 0; i < vertCount; i++) {
        positions[i * 3] = mesh.vertProperties[i * n];
        positions[i * 3 + 1] = mesh.vertProperties[i * n + 1];
        positions[i * 3 + 2] = mesh.vertProperties[i * n + 2];
      }
    }
    return {
      positions,
      indices: new Uint32Array(mesh.triVerts),
      volume: m.volume(),
      triangles: m.numTri(),
    };
  }
}
