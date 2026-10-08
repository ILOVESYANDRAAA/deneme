/**
 * Parametre ifadeleri: sayılar, parametre adları, + − * / % ^, parantez ve birkaç işlev.
 * `eval` kullanılmaz; ifade kendi ayrıştırıcımızla çözülür. Açılar derecedir (sin(30) = 0,5).
 */

export class ExprError extends Error {}

const FUNCTIONS: Record<string, { arity: [number, number]; run: (...a: number[]) => number }> = {
  sin: { arity: [1, 1], run: (x) => Math.sin((x * Math.PI) / 180) },
  cos: { arity: [1, 1], run: (x) => Math.cos((x * Math.PI) / 180) },
  tan: { arity: [1, 1], run: (x) => Math.tan((x * Math.PI) / 180) },
  asin: { arity: [1, 1], run: (x) => (Math.asin(x) * 180) / Math.PI },
  acos: { arity: [1, 1], run: (x) => (Math.acos(x) * 180) / Math.PI },
  atan: { arity: [1, 1], run: (x) => (Math.atan(x) * 180) / Math.PI },
  atan2: { arity: [2, 2], run: (y, x) => (Math.atan2(y, x) * 180) / Math.PI },
  sqrt: { arity: [1, 1], run: Math.sqrt },
  abs: { arity: [1, 1], run: Math.abs },
  floor: { arity: [1, 1], run: Math.floor },
  ceil: { arity: [1, 1], run: Math.ceil },
  round: { arity: [1, 1], run: Math.round },
  exp: { arity: [1, 1], run: Math.exp },
  ln: { arity: [1, 1], run: Math.log },
  log: { arity: [1, 1], run: Math.log10 },
  pow: { arity: [2, 2], run: Math.pow },
  min: { arity: [1, 16], run: Math.min },
  max: { arity: [1, 16], run: Math.max },
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Parametre adı olamayan sözcükler. */
export const RESERVED_NAMES = new Set([...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)]);

const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

export function validateParameterName(name: string): string | null {
  if (!NAME_RE.test(name)) return "Ad harf ya da _ ile başlamalı; yalnızca harf, rakam ve _ içerebilir";
  if (RESERVED_NAMES.has(name.toLowerCase())) return `"${name}" ayrılmış bir sözcük (işlev ya da sabit)`;
  return null;
}

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new ExprError(`Geçersiz sayı: "${src.slice(i, i + 6)}"`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if ("+-*/%^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new ExprError(`Beklenmeyen karakter: "${c}"`);
    }
  }
  return out;
}

type Node =
  | { k: "num"; v: number }
  | { k: "name"; v: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

function parse(src: string): Node {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (op: string) => {
    const t = tokens[pos];
    if (t?.t === "op" && t.v === op) {
      pos++;
      return true;
    }
    return false;
  };
  const expect = (op: string) => {
    if (!eat(op)) throw new ExprError(`"${op}" bekleniyordu`);
  };

  const expr = (): Node => {
    let a = term();
    for (;;) {
      if (eat("+")) a = { k: "bin", op: "+", a, b: term() };
      else if (eat("-")) a = { k: "bin", op: "-", a, b: term() };
      else return a;
    }
  };
  const term = (): Node => {
    let a = unary();
    for (;;) {
      if (eat("*")) a = { k: "bin", op: "*", a, b: unary() };
      else if (eat("/")) a = { k: "bin", op: "/", a, b: unary() };
      else if (eat("%")) a = { k: "bin", op: "%", a, b: unary() };
      else return a;
    }
  };
  // Üs sağdan bağlar ve tekli eksiden güçlüdür: −2^2 = −4
  const unary = (): Node => {
    if (eat("-")) return { k: "neg", a: unary() };
    if (eat("+")) return unary();
    return power();
  };
  const power = (): Node => {
    const base = primary();
    if (eat("^")) return { k: "bin", op: "^", a: base, b: unary() };
    return base;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new ExprError("İfade yarım kaldı");
    pos++;
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "id") {
      if (eat("(")) {
        const args: Node[] = [];
        if (!eat(")")) {
          do args.push(expr());
          while (eat(","));
          expect(")");
        }
        return { k: "call", fn: t.v.toLowerCase(), args };
      }
      return { k: "name", v: t.v };
    }
    if (t.v === "(") {
      const inner = expr();
      expect(")");
      return inner;
    }
    throw new ExprError(`Beklenmeyen "${t.v}"`);
  };

  const ast = expr();
  if (pos < tokens.length) {
    const t = tokens[pos];
    throw new ExprError(`Beklenmeyen "${t.v}"`);
  }
  return ast;
}

/** İfadenin başvurduğu parametre adları (işlev ve sabitler hariç). */
export function referencedNames(src: string): string[] {
  const names = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === "name") {
      if (!(n.v.toLowerCase() in CONSTANTS)) names.add(n.v);
    } else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    } else if (n.k === "call") n.args.forEach(walk);
  };
  walk(parse(src));
  return [...names];
}

export function evaluateExpression(src: string, scope: Readonly<Record<string, number>>): number {
  const run = (n: Node): number => {
    switch (n.k) {
      case "num":
        return n.v;
      case "name": {
        if (n.v in scope) return scope[n.v];
        const c = CONSTANTS[n.v.toLowerCase()];
        if (c !== undefined) return c;
        throw new ExprError(`Bilinmeyen parametre: "${n.v}"`);
      }
      case "neg":
        return -run(n.a);
      case "bin": {
        const a = run(n.a);
        const b = run(n.b);
        switch (n.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/":
            if (b === 0) throw new ExprError("Sıfıra bölme");
            return a / b;
          case "%":
            if (b === 0) throw new ExprError("Sıfıra bölme");
            return a % b;
          default: return a ** b;
        }
      }
      case "call": {
        const f = FUNCTIONS[n.fn];
        if (!f) throw new ExprError(`Bilinmeyen işlev: "${n.fn}"`);
        if (n.args.length < f.arity[0] || n.args.length > f.arity[1]) {
          throw new ExprError(`${n.fn}() ${f.arity[0] === f.arity[1] ? f.arity[0] : `${f.arity[0]}-${f.arity[1]}`} bağımsız değişken ister`);
        }
        return f.run(...n.args.map(run));
      }
    }
  };
  const v = run(parse(src));
  if (!Number.isFinite(v)) throw new ExprError("Sonuç geçerli bir sayı değil");
  return v;
}

/** Düz sayı mı ("12", "-3.5", "2,5")? Sayıysa değeri, değilse null. */
export function plainNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : null;
}

/**
 * Yazılan metni değere çevirir: düz sayı ya da ifade. `expr`, ifade ise metindir (düz sayıda undefined).
 * Geçersizse ExprError fırlatır.
 */
export function evaluateInput(text: string, scope: Readonly<Record<string, number>>): { value: number; expr?: string } {
  const n = plainNumber(text);
  if (n !== null) return { value: n };
  const trimmed = text.trim();
  if (!trimmed) throw new ExprError("Değer boş olamaz");
  return { value: evaluateExpression(trimmed, scope), expr: trimmed };
}

export interface ParamDef {
  name: string;
  /** Sayı ya da diğer parametrelere başvuran ifade. */
  expr: string;
}

/** Tüm parametreleri çözer: başvuru sırasına göre değerlendirir; döngü ve hataları parametre başına bildirir. */
export function resolveParameters(defs: readonly ParamDef[]): { values: Record<string, number>; errors: Record<string, string> } {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, chain: string[]): void => {
    if (state.get(name) === "done") return;
    const def = byName.get(name)!;
    if (state.get(name) === "visiting") {
      errors[name] = `Döngüsel başvuru: ${[...chain.slice(chain.indexOf(name)), name].join(" → ")}`;
      return;
    }
    state.set(name, "visiting");
    try {
      const deps = referencedNames(def.expr);
      for (const dep of deps) {
        if (!byName.has(dep)) throw new ExprError(`Bilinmeyen parametre: "${dep}"`);
        visit(dep, [...chain, name]);
        if (errors[dep]) throw new ExprError(`"${dep}" geçersiz: ${errors[dep]}`);
      }
      if (!errors[name]) values[name] = evaluateExpression(def.expr, values);
    } catch (e) {
      errors[name] ??= e instanceof Error ? e.message : String(e);
    }
    state.set(name, "done");
  };
  for (const d of defs) visit(d.name, []);
  return { values, errors };
}
