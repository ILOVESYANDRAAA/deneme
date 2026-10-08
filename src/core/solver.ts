/**
 * Eskiz kısıt çözücüsü: `SketchData`'yı FreeCAD'in planegcs çözücüsüne (WASM) çevirir, çözer
 * ve çözülmüş konumları geri okur. Çözücüyü başlatmak asenkron ve ağdır; bir kez başlatılıp
 * her eskiz için yeniden kullanılır.
 */
import type { ModuleStatic, SketchPrimitive } from "@salusoft89/planegcs";
import { Algorithm, GcsWrapper, SolveStatus } from "@salusoft89/planegcs";
import { arcInfo, curveById, pointMap, type SCurve, type SConstraint, type SketchData } from "./sketchmodel";
import type { Vec2 } from "./solid";

export interface SolveResult {
  /** Çözülmüş kopya (başarısızsa girdinin kopyası). */
  data: SketchData;
  /** Çözücü çözüme ulaştı ve çelişen kısıt yok mu? */
  ok: boolean;
  /** Serbestlik derecesi: 0 = tam tanımlı. */
  dof: number;
  /** Birbiriyle çelişen kısıtların kimlikleri. */
  conflicting: string[];
  /** Gereksiz (zaten sağlanan) kısıtların kimlikleri. */
  redundant: string[];
  /** Çözülemeyen / yok sayılan kısıtlar için açıklamalar. */
  warnings: string[];
}

export interface SolveOptions {
  /** Bir ya da birkaç noktayı hedef konuma sürükle: geçici (yumuşak) kısıtlarla çözülür. */
  drag?: { point: string; to: Vec2 } | { point: string; to: Vec2 }[];
  algorithm?: "dogleg" | "lm" | "bfgs";
}

type Prim = SketchPrimitive;

const DEG = Math.PI / 180;
const ALGORITHMS = { dogleg: Algorithm.DogLeg, lm: Algorithm.LevenbergMarquardt, bfgs: Algorithm.BFGS } as const;

export class SketchSolver {
  private gcs: GcsWrapper;

  private constructor(mod: ModuleStatic) {
    this.gcs = new GcsWrapper(new mod.GcsSystem(), mod);
  }

  /** `init`: planegcs modülünü başlatan işlev (tarayıcıda wasm adresiyle, testlerde varsayılan). */
  static async create(init: () => Promise<ModuleStatic>): Promise<SketchSolver> {
    return new SketchSolver(await init());
  }

  dispose(): void {
    this.gcs.destroy_gcs_module();
  }

  solve(data: SketchData, options: SolveOptions = {}): SolveResult {
    const out: SketchData = structuredClone(data);
    const warnings: string[] = [];
    const prims = this.buildPrimitives(out, options, warnings);
    this.gcs.clear_data();
    this.gcs.push_primitives_and_params(prims);
    let status: number;
    try {
      status = this.gcs.solve(ALGORITHMS[options.algorithm ?? "dogleg"]);
    } catch (e) {
      return { data: out, ok: false, dof: 0, conflicting: [], redundant: [], warnings: [...warnings, String(e)] };
    }
    const dof = this.gcs.gcs.dof();
    const clean = (ids: string[]) => [...new Set(ids.map((i) => i.replace(/_[ab]$/, "")))].filter((i) => i.startsWith("k"));
    const conflicting = clean(this.gcs.get_gcs_conflicting_constraints());
    const redundant = clean(this.gcs.get_gcs_redundant_constraints());
    const solved = status === SolveStatus.Success || status === SolveStatus.Converged;
    if (!solved) {
      return { data: out, ok: false, dof, conflicting, redundant, warnings };
    }
    this.gcs.apply_solution();
    const result = new Map(this.gcs.sketch_index.get_primitives().map((p) => [p.id, p]));
    for (const p of out.points) {
      const s = result.get(p.id);
      if (s?.type === "point" && Number.isFinite(s.x) && Number.isFinite(s.y)) {
        p.x = round(s.x);
        p.y = round(s.y);
      }
    }
    for (const c of out.curves) {
      if (c.kind !== "circle") continue;
      const s = result.get(c.id);
      if (s?.type === "circle" && Number.isFinite(s.radius)) c.r = round(Math.abs(s.radius));
    }
    return { data: out, ok: conflicting.length === 0, dof, conflicting, redundant, warnings };
  }

  // ---- model → planegcs ----

  private buildPrimitives(d: SketchData, options: SolveOptions, warnings: string[]): Prim[] {
    const pm = pointMap(d);
    const fixed = new Map<string, Vec2>();
    for (const k of d.constraints) {
      if (k.type === "fix" && k.refs[0]) fixed.set(k.refs[0], k.at ?? pm.get(k.refs[0]) ?? [0, 0]);
    }
    const dragList = options.drag ? (Array.isArray(options.drag) ? options.drag : [options.drag]) : [];
    // Sabit noktalar sürüklenemez.
    const dragged = dragList.filter((g) => !fixed.has(g.point));
    const used = new Set(d.curves.flatMap((c) => curvePointIds(c)));
    const prims: Prim[] = [];
    for (const p of d.points) {
      if (!used.has(p.id)) continue;
      const at = fixed.get(p.id);
      prims.push({ id: p.id, type: "point", x: at ? at[0] : p.x, y: at ? at[1] : p.y, fixed: !!at });
    }
    for (const c of d.curves) {
      switch (c.kind) {
        case "line":
          prims.push({ id: c.id, type: "line", p1_id: c.p1, p2_id: c.p2 });
          break;
        case "circle":
          prims.push({ id: c.id, type: "circle", c_id: c.c, radius: c.r });
          break;
        case "arc": {
          const g = arcInfo(pm.get(c.c)!, pm.get(c.s)!, pm.get(c.e)!);
          prims.push({
            id: c.id,
            type: "arc",
            c_id: c.c,
            radius: g.r,
            start_angle: g.a0,
            end_angle: g.a0 + g.sweep,
            start_id: c.s,
            end_id: c.e,
          });
          prims.push({ id: `${c.id}_r`, type: "arc_rules", a_id: c.id });
          break;
        }
        default:
          break; // elips, eğri, nokta: sadece noktaları çözücüde
      }
    }
    const inSolver = new Set(prims.map((p) => p.id));
    for (const k of d.constraints) {
      if (k.type === "fix") continue;
      const made = this.constraintPrims(d, k, inSolver, warnings);
      prims.push(...made);
    }
    dragged.forEach((g, i) => {
      prims.push({ id: `drag_x${i}`, type: "coordinate_x", p_id: g.point, x: g.to[0], temporary: true });
      prims.push({ id: `drag_y${i}`, type: "coordinate_y", p_id: g.point, y: g.to[1], temporary: true });
    });
    return prims;
  }

  private constraintPrims(d: SketchData, k: SConstraint, inSolver: Set<string>, warnings: string[]): Prim[] {
    const refs = k.refs;
    const kinds = refs.map((r) => (d.points.some((p) => p.id === r) ? "point" : (curveById(d, r)?.kind ?? "?")));
    const skip = (why: string): Prim[] => {
      warnings.push(`${k.id}: ${why}`);
      return [];
    };
    if (refs.some((r, i) => kinds[i] === "?" || (kinds[i] !== "point" && !inSolver.has(r) && !isCenterOnly(kinds[i])))) {
      return skip("bağlı öğe çözücüde yok");
    }
    const id = k.id;
    const val = k.value ?? 0;
    const [a, b, c] = refs;
    const [ka, kb] = kinds;
    const isLine = (x: string) => x === "line";
    const isCircle = (x: string) => x === "circle";
    const isArc = (x: string) => x === "arc";
    switch (k.type) {
      case "coincident":
        return ka === "point" && kb === "point" ? [{ id, type: "p2p_coincident", p1_id: a, p2_id: b }] : skip("iki nokta gerekli");
      case "horizontal":
        if (ka === "point" && kb === "point") return [{ id, type: "horizontal_pp", p1_id: a, p2_id: b }];
        return isLine(ka) ? [{ id, type: "horizontal_l", l_id: a }] : skip("çizgi ya da iki nokta gerekli");
      case "vertical":
        if (ka === "point" && kb === "point") return [{ id, type: "vertical_pp", p1_id: a, p2_id: b }];
        return isLine(ka) ? [{ id, type: "vertical_l", l_id: a }] : skip("çizgi ya da iki nokta gerekli");
      case "parallel":
        return isLine(ka) && isLine(kb) ? [{ id, type: "parallel", l1_id: a, l2_id: b }] : skip("iki çizgi gerekli");
      case "perpendicular":
        return isLine(ka) && isLine(kb) ? [{ id, type: "perpendicular_ll", l1_id: a, l2_id: b }] : skip("iki çizgi gerekli");
      case "equal":
        if (isLine(ka) && isLine(kb)) return [{ id, type: "equal_length", l1_id: a, l2_id: b }];
        if (isCircle(ka) && isCircle(kb)) return [{ id, type: "equal_radius_cc", c1_id: a, c2_id: b }];
        if (isArc(ka) && isArc(kb)) return [{ id, type: "equal_radius_aa", a1_id: a, a2_id: b }];
        if (isCircle(ka) && isArc(kb)) return [{ id, type: "equal_radius_ca", c1_id: a, a2_id: b }];
        if (isArc(ka) && isCircle(kb)) return [{ id, type: "equal_radius_ca", c1_id: b, a2_id: a }];
        return skip("aynı türden iki öğe gerekli");
      case "tangent": {
        // Uç noktası paylaşılan çizgi–yay / yay–yay teğetliği: mesafe formülü tam teğet konumda
        // dejenere olur (türevi sıfırlanır), bu yüzden "yarıçap ⟂ çizgi" / "merkezler ve ortak nokta
        // doğrusal" olarak yazılır.
        const ca = curveById(d, a);
        const cb = curveById(d, b);
        if (ca?.kind === "line" && cb?.kind === "arc") {
          const shared = [ca.p1, ca.p2].find((q) => q === cb.s || q === cb.e);
          if (shared) {
            const other = ca.p1 === shared ? ca.p2 : ca.p1;
            return [{ id, type: "perpendicular_pppp", l1p1_id: cb.c, l1p2_id: shared, l2p1_id: shared, l2p2_id: other }];
          }
        }
        if (ca?.kind === "arc" && cb?.kind === "line") {
          const shared = [cb.p1, cb.p2].find((q) => q === ca.s || q === ca.e);
          if (shared) {
            const other = cb.p1 === shared ? cb.p2 : cb.p1;
            return [{ id, type: "perpendicular_pppp", l1p1_id: ca.c, l1p2_id: shared, l2p1_id: shared, l2p2_id: other }];
          }
        }
        if (ca?.kind === "arc" && cb?.kind === "arc") {
          const shared = [ca.s, ca.e].find((q) => q === cb.s || q === cb.e);
          if (shared) return [{ id, type: "point_on_line_ppp", p_id: shared, lp1_id: ca.c, lp2_id: cb.c }];
        }
        if (isLine(ka) && isCircle(kb)) return [{ id, type: "tangent_lc", l_id: a, c_id: b }];
        if (isCircle(ka) && isLine(kb)) return [{ id, type: "tangent_lc", l_id: b, c_id: a }];
        if (isLine(ka) && isArc(kb)) return [{ id, type: "tangent_la", l_id: a, a_id: b }];
        if (isArc(ka) && isLine(kb)) return [{ id, type: "tangent_la", l_id: b, a_id: a }];
        if (isCircle(ka) && isCircle(kb)) return [{ id, type: "tangent_cc", c1_id: a, c2_id: b }];
        if (isCircle(ka) && isArc(kb)) return [{ id, type: "tangent_ca", c_id: a, a_id: b }];
        if (isArc(ka) && isCircle(kb)) return [{ id, type: "tangent_ca", c_id: b, a_id: a }];
        if (isArc(ka) && isArc(kb)) return [{ id, type: "tangent_aa", a1_id: a, a2_id: b }];
        return skip("teğet için çizgi / daire / yay gerekli");
      }
      case "concentric": {
        const ca = centerOf(d, a);
        const cb = centerOf(d, b);
        return ca && cb ? [{ id, type: "p2p_coincident", p1_id: ca, p2_id: cb }] : skip("iki daire / yay / elips gerekli");
      }
      case "onCurve":
        if (ka !== "point") return skip("önce nokta seçin");
        if (isLine(kb)) return [{ id, type: "point_on_line_pl", p_id: a, l_id: b }];
        if (isCircle(kb)) return [{ id, type: "point_on_circle", p_id: a, c_id: b }];
        if (isArc(kb)) return [{ id, type: "point_on_arc", p_id: a, a_id: b }];
        return skip("çizgi, daire ya da yay gerekli");
      case "midpoint":
        return ka === "point" && isLine(kb)
          ? [
              { id: `${id}_a`, type: "point_on_line_pl", p_id: a, l_id: b },
              { id: `${id}_b`, type: "point_on_perp_bisector_pl", p_id: a, l_id: b },
            ]
          : skip("nokta ve çizgi gerekli");
      case "symmetric":
        return ka === "point" && kb === "point" && isLine(kinds[2])
          ? [{ id, type: "p2p_symmetric_ppl", p1_id: a, p2_id: b, l_id: c }]
          : skip("iki nokta ve bir simetri çizgisi gerekli");
      case "distance":
        return ka === "point" && kb === "point" ? [{ id, type: "p2p_distance", p1_id: a, p2_id: b, distance: Math.abs(val) }] : skip("iki nokta gerekli");
      case "hdistance":
      case "vdistance": {
        const prop = k.type === "hdistance" ? "x" : "y";
        return ka === "point" && kb === "point"
          ? [{ id, type: "difference", param1: { o_id: a, prop }, param2: { o_id: b, prop }, difference: val }]
          : skip("iki nokta gerekli");
      }
      case "pointLine":
        return ka === "point" && isLine(kb) ? [{ id, type: "p2l_distance", p_id: a, l_id: b, distance: Math.abs(val) }] : skip("nokta ve çizgi gerekli");
      case "radius":
        if (isCircle(ka)) return [{ id, type: "circle_radius", c_id: a, radius: Math.abs(val) }];
        if (isArc(ka)) return [{ id, type: "arc_radius", a_id: a, radius: Math.abs(val) }];
        return skip("daire ya da yay gerekli");
      case "diameter":
        if (isCircle(ka)) return [{ id, type: "circle_diameter", c_id: a, diameter: Math.abs(val) }];
        if (isArc(ka)) return [{ id, type: "arc_diameter", a_id: a, diameter: Math.abs(val) }];
        return skip("daire ya da yay gerekli");
      case "angle":
        return isLine(ka) && isLine(kb) ? [{ id, type: "l2l_angle_ll", l1_id: a, l2_id: b, angle: val * DEG }] : skip("iki çizgi gerekli");
      default:
        return skip("bilinmeyen kısıt");
    }
  }
}

function round(n: number): number {
  return Number(n.toFixed(6)) + 0;
}

function curvePointIds(c: SCurve): string[] {
  switch (c.kind) {
    case "line":
      return [c.p1, c.p2];
    case "circle":
    case "ellipse":
      return [c.c];
    case "arc":
      return [c.c, c.s, c.e];
    case "spline":
      return c.pts;
    case "point":
      return [c.p];
  }
}

/** Çözücüde geometri olarak bulunmayan ama merkezi nokta olarak bulunan türler. */
const isCenterOnly = (kind: string) => kind === "ellipse";

function centerOf(d: SketchData, id: string): string | null {
  const c = curveById(d, id);
  return c && (c.kind === "circle" || c.kind === "arc" || c.kind === "ellipse") ? c.c : null;
}
