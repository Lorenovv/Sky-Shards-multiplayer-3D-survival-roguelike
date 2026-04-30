// Генерация островов на основе детерминированного 3D-шума (simplex-noise).
// Острова раскиданы по сетке, но позиция и параметры варьируются шумом.
// Стартовый остров фиксирован в центре с биомом ruins.

import { createNoise3D } from "simplex-noise";
import type { IslandData, BiomeKind } from "@sky-shards/shared";
import { WORLD_SIZE } from "@sky-shards/shared";
import { mulberry32 } from "./Utils.js";

export interface WorldGenResult {
  islands: IslandData[];
  startIslandId: number;
}

const BIOMES: BiomeKind[] = ["forest", "rocks", "wastes", "ruins", "ice"];

export function generateWorld(seed: number): WorldGenResult {
  const rand = mulberry32(seed);
  const noise = createNoise3D(rand);
  const islands: IslandData[] = [];
  const half = { x: WORLD_SIZE.x / 2, y: WORLD_SIZE.y / 2, z: WORLD_SIZE.z / 2 };

  // Стартовый остров — центр (0, 50, 0).
  const startId = 0;
  islands.push({
    id: startId,
    center: { x: 0, y: 50, z: 0 },
    radius: 24,
    biome: "ruins",
    unstable: false,
    baseY: 50,
    fallVelocity: 0,
    alive: true,
    seed: (seed * 7919) >>> 0,
  });

  // Сетка 6x6 (без центральной ячейки) — порядка 30+ островов.
  const cells = 6;
  const cellSize = WORLD_SIZE.x / cells;
  let id = 1;
  for (let cx = 0; cx < cells; cx++) {
    for (let cz = 0; cz < cells; cz++) {
      // Пропустим ячейки, попадающие на стартовый остров (зону ±35 от центра).
      const cellCx = -half.x + (cx + 0.5) * cellSize;
      const cellCz = -half.z + (cz + 0.5) * cellSize;
      if (Math.hypot(cellCx, cellCz) < 35) continue;

      // Сэмплируем 3D-шум, чтобы определить наличие острова.
      const n = noise(cx * 0.7, cz * 0.7, seed * 0.001);
      if (n < -0.1) continue; // редкие пропуски

      const jitter = mulberry32(seed ^ (cx * 73856093) ^ (cz * 19349663));
      const ox = (jitter() - 0.5) * cellSize * 0.6;
      const oz = (jitter() - 0.5) * cellSize * 0.6;
      const x = cellCx + ox;
      const z = cellCz + oz;
      const y = 5 + jitter() * 75; // высота 5..80
      const radius = 8 + jitter() * 22; // 8..30
      const biomeIdx = Math.floor(jitter() * BIOMES.length);
      const biome = BIOMES[biomeIdx] ?? "forest";
      const unstable = jitter() < 0.25;
      islands.push({
        id: id++,
        center: { x, y, z },
        radius,
        biome,
        unstable,
        baseY: y,
        fallVelocity: 0,
        alive: true,
        seed: (seed ^ (id * 0x9E3779B1)) >>> 0,
      });
    }
  }

  return { islands, startIslandId: startId };
}

// Для нестабильных островов: гладкое колебание высоты по синусоиде.
// Возвращает текущий Y относительно baseY с амплитудой 1.5 м.
export function unstableY(island: IslandData, t: number): number {
  if (!island.unstable) return island.baseY;
  const phase = (island.seed % 1000) / 159.155; // ~ random phase
  return island.baseY + Math.sin(t * 0.6 + phase) * 1.5;
}
