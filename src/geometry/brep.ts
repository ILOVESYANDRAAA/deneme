import type { EdgeRef, FaceRef } from "../core/solid";

/** Seçim arayüzü için bir gövdenin kenar ve yüz betimi (OpenCascade işçisi üretir). */
export interface BrepInfo {
  edges: { ref: EdgeRef; /** x, y, z dizisi: kenarın örneklenmiş çizgisi (ardışık noktalar). */ points: Float32Array }[];
  faces: { ref: FaceRef; area: number }[];
  /** Yüz seçimi için ağ: her üçgenin hangi yüze (faces indeksi) ait olduğu `triFace`'te. */
  pick: { positions: Float32Array; indices: Uint32Array; triFace: Uint32Array };
}
