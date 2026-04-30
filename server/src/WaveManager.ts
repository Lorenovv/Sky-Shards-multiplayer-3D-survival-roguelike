// Менеджер ночных волн и штормов.
// Первая ночь — 4 ската. Каждая следующая — +3 врага и новый тип.

import type { EnemyKind, IslandData, ServerEvent, Vec3 } from "@sky-shards/shared";
import { mulberry32 } from "./Utils.js";

export interface WaveDescriptor {
  count: number;
  composition: EnemyKind[];
}

export class WaveManager {
  dayIndex = 0;
  active = false;
  spawnQueue: { kind: EnemyKind; pos: Vec3 }[] = [];
  remaining = 0;
  private rand = mulberry32(0x5EED1);

  startWave(dayIndex: number, islands: IslandData[]): { events: ServerEvent[]; descriptor: WaveDescriptor } {
    this.dayIndex = dayIndex;
    const baseCount = 4 + dayIndex * 3;
    const descriptor: WaveDescriptor = { count: baseCount, composition: [] };

    // Прогресс типов: 1-я — скаты; 2-я + гарпии; 3-я + голем; 4-я + пожиратели; 5-я + буревестник.
    const pool: EnemyKind[] = ["skate"];
    if (dayIndex >= 1) pool.push("harpy");
    if (dayIndex >= 2) pool.push("golem");
    if (dayIndex >= 3) pool.push("eater");
    if (dayIndex >= 4) pool.push("stormbringer");

    for (let i = 0; i < baseCount; i++) {
      const k = pool[Math.floor(this.rand() * pool.length)] ?? "skate";
      descriptor.composition.push(k);
      const pos = this.pickSpawnPos(islands);
      this.spawnQueue.push({ kind: k, pos });
    }
    this.remaining = baseCount;
    this.active = true;
    return { events: [{ kind: "wave_started", index: dayIndex, count: baseCount }], descriptor };
  }

  endWave(): ServerEvent[] {
    this.active = false;
    return [{ kind: "wave_ended", index: this.dayIndex }];
  }

  notifyEnemyDied(): void {
    if (this.remaining > 0) this.remaining--;
  }

  popSpawn(): { kind: EnemyKind; pos: Vec3 } | null {
    return this.spawnQueue.shift() ?? null;
  }

  private pickSpawnPos(islands: IslandData[]): Vec3 {
    // Спавн на случайном дальнем острове или в небе на краю карты.
    if (islands.length === 0) return { x: 100, y: 60, z: 0 };
    // Берём случайный остров не ближе 60 ед к стартовому.
    const candidates = islands.filter(i => i.alive && Math.hypot(i.center.x, i.center.z) > 60);
    const list = candidates.length > 0 ? candidates : islands.filter(i => i.alive);
    const isl = list[Math.floor(this.rand() * list.length)];
    if (!isl) return { x: 100, y: 60, z: 0 };
    return { x: isl.center.x, y: isl.center.y + 8, z: isl.center.z };
  }
}
