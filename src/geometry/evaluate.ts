import type { Manifold, ManifoldToplevel } from "manifold-3d";
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
      case "extrude":
        return Manifold.extrude(solid.polygons, solid.height);
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
        const rotated = solid.rotate ? child.rotate(solid.rotate) : child;
        const moved = solid.translate ? rotated.translate(solid.translate) : rotated;
        if (rotated !== child && rotated !== moved) rotated.delete();
        return moved === child ? child.translate([0, 0, 0]) : moved;
      }
    }
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
