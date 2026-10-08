import { needsBrep, type Solid } from "../core/solid";

export interface Item {
  id: string;
  solid: Solid;
}

/** Tarifleri çekirdeklere böler: yuvarlatma / pah / kabuk içerenler OpenCascade'e, gerisi manifold'a. */
export function splitItems(items: Item[]): { manifold: Item[]; brep: Item[] } {
  const brep = items.filter((i) => needsBrep(i.solid));
  return { manifold: items.filter((i) => !brep.includes(i)), brep };
}
