// Процедурные ассеты: материалы и геометрии. Никаких внешних .glb,
// чтобы проект собирался и запускался без бинарных артефактов.
// Это «PS3+»-стилизация: PBR-материалы, низкое поли, простые формы.

import * as THREE from "three";
import type { BiomeKind, EnemyKind } from "@sky-shards/shared";

const cache = new Map<string, THREE.Material | THREE.BufferGeometry>();

function getOrCreateMat(key: string, factory: () => THREE.Material): THREE.Material {
  let m = cache.get(key) as THREE.Material | undefined;
  if (!m) { m = factory(); cache.set(key, m); }
  return m;
}
function getOrCreateGeom(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key) as THREE.BufferGeometry | undefined;
  if (!g) { g = factory(); cache.set(key, g); }
  return g;
}

export const BIOME_COLORS: Record<BiomeKind, number> = {
  forest: 0x4a7d44,
  rocks: 0x6b6358,
  wastes: 0x9a7a4f,
  ruins: 0x726074,
  ice: 0xb6dceb,
};

// Грунтовый материал острова — PBR.
export function getIslandMaterial(biome: BiomeKind): THREE.MeshStandardMaterial {
  return getOrCreateMat(`island_mat_${biome}`, () => new THREE.MeshStandardMaterial({
    color: BIOME_COLORS[biome],
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  })) as THREE.MeshStandardMaterial;
}

export function getIslandGeometry(radius: number, seed: number): THREE.BufferGeometry {
  // Уникальная геометрия — не кешируется по ключу radius/seed комбинации
  // (количество островов ограничено генерацией мира).
  const geo = new THREE.SphereGeometry(radius, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2 + 0.4);
  geo.scale(1, 0.45, 1);
  // Лёгкая деформация под seed.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const sx = Math.sin(i * 12.9898 + seed * 1.0001);
    const sy = Math.sin(i * 78.233 + seed * 0.7);
    pos.setX(i, pos.getX(i) + sx * 0.3);
    pos.setZ(i, pos.getZ(i) + sy * 0.3);
  }
  geo.computeVertexNormals();
  return geo;
}

// Деревянная крона + ствол — два меша.
export function getTreeMeshes(): { trunk: THREE.Mesh; crown: THREE.Mesh } {
  const trunkGeo = getOrCreateGeom("tree_trunk_geo", () => new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6));
  const trunkMat = getOrCreateMat("tree_trunk_mat", () => new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 }));
  const crownGeo = getOrCreateGeom("tree_crown_geo", () => new THREE.ConeGeometry(0.9, 1.6, 8));
  const crownMat = getOrCreateMat("tree_crown_mat", () => new THREE.MeshStandardMaterial({ color: 0x2c5d2c, roughness: 0.9 }));
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.8;
  const crown = new THREE.Mesh(crownGeo, crownMat);
  crown.position.y = 2.2;
  trunk.castShadow = true; crown.castShadow = true;
  return { trunk, crown };
}

export function getRockMesh(): THREE.Mesh {
  const geo = getOrCreateGeom("rock_geo", () => {
    const g = new THREE.IcosahedronGeometry(0.6, 0);
    return g;
  });
  const mat = getOrCreateMat("rock_mat", () => new THREE.MeshStandardMaterial({ color: 0x7a7268, roughness: 0.92 }));
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export function getCrystalMesh(): THREE.Mesh {
  const geo = getOrCreateGeom("crystal_geo", () => new THREE.OctahedronGeometry(0.35, 0));
  const mat = getOrCreateMat("crystal_mat", () => new THREE.MeshStandardMaterial({
    color: 0x66e3ff, roughness: 0.15, metalness: 0.1, emissive: 0x10a4d6, emissiveIntensity: 0.7,
  }));
  return new THREE.Mesh(geo, mat);
}

export function getAnchorMeshes(): THREE.Group {
  const g = new THREE.Group();
  const baseGeo = new THREE.CylinderGeometry(2.2, 2.6, 0.6, 16);
  const baseMat = getOrCreateMat("anchor_base", () => new THREE.MeshStandardMaterial({ color: 0x42485e, roughness: 0.55, metalness: 0.6 }));
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.3;
  g.add(base);

  const coreGeo = new THREE.IcosahedronGeometry(0.95, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c1, emissive: 0xf6c351, emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.3,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = 1.6;
  core.name = "anchor_core";
  g.add(core);

  const ringGeo = new THREE.TorusGeometry(1.4, 0.06, 8, 32);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xe6cf8d, emissive: 0xe6cf8d, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 });
  const r1 = new THREE.Mesh(ringGeo, ringMat); r1.rotation.x = Math.PI / 2; r1.position.y = 1.6; g.add(r1);
  const r2 = new THREE.Mesh(ringGeo, ringMat); r2.rotation.y = Math.PI / 2; r2.position.y = 1.6; g.add(r2);
  r1.name = "anchor_ring1"; r2.name = "anchor_ring2";

  return g;
}

export function getPlayerMesh(color = 0xf6c351): THREE.Mesh {
  const geo = getOrCreateGeom("player_geo", () => new THREE.CapsuleGeometry(0.4, 1.0, 4, 10));
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export function getEnemyMesh(kind: EnemyKind): THREE.Mesh {
  const palette: Record<EnemyKind, number> = {
    skate: 0x6c80ff, harpy: 0xb070d8, eater: 0xff4f7c, golem: 0x807565,
    stormbringer: 0x4ad8ff, boss_whale: 0x2d4f9e, boss_treant: 0x4a8a3a,
  };
  const color = palette[kind] ?? 0xffffff;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15, emissive: color, emissiveIntensity: 0.15 });
  let geo: THREE.BufferGeometry;
  switch (kind) {
    case "skate": geo = new THREE.ConeGeometry(0.7, 0.3, 6); break;
    case "harpy": geo = new THREE.OctahedronGeometry(0.6, 0); break;
    case "eater": geo = new THREE.SphereGeometry(0.55, 10, 8); break;
    case "golem": geo = new THREE.BoxGeometry(1.1, 1.5, 1.1); break;
    case "stormbringer": geo = new THREE.IcosahedronGeometry(0.7, 0); break;
    case "boss_whale": geo = new THREE.SphereGeometry(3, 16, 12); break;
    case "boss_treant": geo = new THREE.CylinderGeometry(1.1, 1.4, 4, 10); break;
  }
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export function getBuildingMesh(kind: string): THREE.Mesh {
  const colors: Record<string, number> = {
    block_wood: 0x8b5a36, block_stone: 0x8d8a85, block_metal: 0xb4b8c0,
    workbench: 0x6f4f30, furnace: 0x3a3232, turret: 0x484f6a, zipline_anchor: 0x9a7a4f,
  };
  const c = colors[kind] ?? 0xaaaaaa;
  const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: kind === "block_metal" || kind === "turret" ? 0.7 : 0.1 });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function getItemMesh(kind: string): THREE.Mesh {
  const colors: Record<string, number> = {
    wood: 0xa6753a, stone: 0x8a8278, iron: 0xa9a9b4, gold: 0xf2c558,
    crystal: 0x66e3ff, air: 0xc4f0ff, meat: 0xc35a55, artifact: 0xe070ff,
    rope: 0xc7a778, metal: 0xc4cad8, cloth: 0xd5cfae,
    axe_wood: 0x7a5a35, pickaxe_stone: 0x99948a, sword_iron: 0xc9cdd9,
    glider: 0xd8b977, hookshot: 0xd0a050, workbench: 0x7a572e, furnace: 0x404040,
    turret: 0x4f5570, zipline_kit: 0xc8b376, stabilizer: 0x70e3ff,
    block_wood: 0x8b5a36, block_stone: 0x8d8a85, block_metal: 0xb4b8c0, drone: 0x586172,
    fist: 0xffffff,
  };
  const c = colors[kind] ?? 0xffffff;
  const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, emissive: kind === "crystal" ? 0x208db5 : 0x000000 });
  const geo = new THREE.IcosahedronGeometry(0.3, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// Instanced меш для травы — пучок треугольников.
export function buildGrassInstanced(count: number, biome: BiomeKind): THREE.InstancedMesh {
  // Геометрия травинки — три плоских квадрата под углом
  const blade = new THREE.PlaneGeometry(0.1, 0.4);
  const mat = new THREE.MeshStandardMaterial({
    color: BIOME_COLORS[biome] === BIOME_COLORS.forest ? 0x6dbb5a : 0x9aa363,
    side: THREE.DoubleSide,
    roughness: 0.95,
  });
  const inst = new THREE.InstancedMesh(blade, mat, count);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return inst;
}
