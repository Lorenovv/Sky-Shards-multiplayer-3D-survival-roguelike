// Утилиты сервера: vec3-операции без аллокаций, ID-генератор, RNG.
import type { Vec3 } from "@sky-shards/shared";

let _idCounter = 0;
export const nextId = (prefix: string): string => `${prefix}_${(++_idCounter).toString(36)}`;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v3copy = (out: Vec3, a: Vec3): Vec3 => { out.x = a.x; out.y = a.y; out.z = a.z; return out; };
export const v3set = (out: Vec3, x: number, y: number, z: number): Vec3 => { out.x = x; out.y = y; out.z = z; return out; };
export const v3add = (out: Vec3, a: Vec3, b: Vec3): Vec3 => { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; return out; };
export const v3sub = (out: Vec3, a: Vec3, b: Vec3): Vec3 => { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; };
export const v3scale = (out: Vec3, a: Vec3, s: number): Vec3 => { out.x = a.x * s; out.y = a.y * s; out.z = a.z * s; return out; };
export const v3len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const v3dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3distSq = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};
export const v3normalize = (out: Vec3, a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l < 1e-6) { out.x = 0; out.y = 0; out.z = 0; return out; }
  out.x = a.x / l; out.y = a.y / l; out.z = a.z / l;
  return out;
};

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Простой mulberry32 PRNG для стабильной серверной случайности.
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const now = (): number => Date.now();
