// Тонкая обёртка над cannon-es — авторитарная физика на сервере.
// Острова представлены статическими сферами (упрощённое приближение скал).
// Игроки и враги — кинематические объекты, движение вычисляется вручную;
// мир Cannon используется для рейкастов «земля под игроком» и широкой проверки коллизий.

import * as CANNON from "cannon-es";
import type { IslandData, Vec3 } from "@sky-shards/shared";

export class PhysicsWorld {
  readonly world: CANNON.World;
  private islandBodies = new Map<number, CANNON.Body>();

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.solver = new CANNON.GSSolver();
    (this.world.solver as CANNON.GSSolver).iterations = 4;
  }

  addIsland(island: IslandData): void {
    // Острова — сплющенный эллипсоид. В Cannon-es нет ellipsoid,
    // используем сферу слегка меньше горизонтального радиуса
    // и поднимаем центр чтобы вершина совпадала с центром острова.
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Sphere(island.radius),
      position: new CANNON.Vec3(island.center.x, island.center.y - island.radius * 0.4, island.center.z),
    });
    this.world.addBody(body);
    this.islandBodies.set(island.id, body);
  }

  // Получить топ-Y самого высокого острова под точкой (x, z) или null.
  groundAt(x: number, z: number, islands: IslandData[]): { y: number; islandId: number } | null {
    let best: { y: number; islandId: number } | null = null;
    for (const isl of islands) {
      if (!isl.alive) continue;
      const dx = x - isl.center.x;
      const dz = z - isl.center.z;
      const r2 = isl.radius * isl.radius;
      const horiz2 = dx * dx + dz * dz;
      if (horiz2 >= r2) continue;
      // Сплющенный куполок: y = baseY + sqrt(R^2 - dx^2 - dz^2) * 0.45
      const bulge = Math.sqrt(r2 - horiz2) * 0.45;
      const top = isl.center.y + bulge;
      if (!best || top > best.y) best = { y: top, islandId: isl.id };
    }
    return best;
  }

  // Простой raycast по «куполу» островов — для крюк-кошки и канатных дорог.
  raycastSurface(origin: Vec3, dir: Vec3, maxDist: number, islands: IslandData[]): { hit: Vec3; islandId: number } | null {
    const steps = 40;
    const dx = dir.x / steps, dy = dir.y / steps, dz = dir.z / steps;
    let x = origin.x, y = origin.y, z = origin.z;
    for (let i = 0; i < steps; i++) {
      x += dx * maxDist; y += dy * maxDist; z += dz * maxDist;
      for (const isl of islands) {
        if (!isl.alive) continue;
        const ddx = x - isl.center.x, ddy = y - isl.center.y, ddz = z - isl.center.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz < isl.radius * isl.radius) {
          return { hit: { x, y, z }, islandId: isl.id };
        }
      }
    }
    return null;
  }

  step(dt: number): void {
    this.world.step(dt);
  }

  destroy(): void {
    for (const b of this.islandBodies.values()) this.world.removeBody(b);
    this.islandBodies.clear();
  }
}
