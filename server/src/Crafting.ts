// Рецепты крафта и инвентарные операции.
// Открытые рецепты — крафт мгновенный, если есть ресурсы.

import type { InventoryState, ItemKind, ItemStack, Recipe } from "@sky-shards/shared";

export const STACK_LIMITS: Partial<Record<ItemKind, number>> = {
  wood: 64,
  stone: 64,
  iron: 32,
  gold: 32,
  crystal: 10,
  air: 16,
  meat: 32,
  artifact: 4,
  rope: 32,
  metal: 32,
  cloth: 32,
  block_wood: 64,
  block_stone: 64,
  block_metal: 32,
};

export const RECIPES: Record<string, Recipe> = {
  axe_wood: {
    result: { kind: "axe_wood", count: 1 },
    ingredients: [{ kind: "wood", count: 5 }],
  },
  pickaxe_stone: {
    result: { kind: "pickaxe_stone", count: 1 },
    ingredients: [{ kind: "wood", count: 5 }, { kind: "stone", count: 5 }],
  },
  sword_iron: {
    result: { kind: "sword_iron", count: 1 },
    ingredients: [{ kind: "wood", count: 3 }, { kind: "iron", count: 6 }],
    station: "workbench",
  },
  glider: {
    result: { kind: "glider", count: 1 },
    ingredients: [{ kind: "wood", count: 10 }, { kind: "cloth", count: 3 }],
    station: "workbench",
  },
  hookshot: {
    result: { kind: "hookshot", count: 1 },
    ingredients: [{ kind: "metal", count: 5 }, { kind: "rope", count: 2 }],
    station: "workbench",
  },
  workbench: {
    result: { kind: "workbench", count: 1 },
    ingredients: [{ kind: "wood", count: 20 }],
  },
  furnace: {
    result: { kind: "furnace", count: 1 },
    ingredients: [{ kind: "stone", count: 30 }],
  },
  turret: {
    result: { kind: "turret", count: 1 },
    ingredients: [{ kind: "metal", count: 10 }, { kind: "crystal", count: 2 }],
    station: "workbench",
  },
  zipline_kit: {
    result: { kind: "zipline_kit", count: 1 },
    ingredients: [{ kind: "rope", count: 15 }, { kind: "metal", count: 5 }],
    station: "workbench",
  },
  stabilizer: {
    result: { kind: "stabilizer", count: 1 },
    ingredients: [{ kind: "crystal", count: 5 }, { kind: "air", count: 3 }],
    station: "workbench",
  },
  drone: {
    result: { kind: "drone", count: 1 },
    ingredients: [{ kind: "metal", count: 8 }, { kind: "crystal", count: 1 }, { kind: "wood", count: 4 }],
    station: "workbench",
  },
  block_wood: {
    result: { kind: "block_wood", count: 4 },
    ingredients: [{ kind: "wood", count: 1 }],
  },
  block_stone: {
    result: { kind: "block_stone", count: 4 },
    ingredients: [{ kind: "stone", count: 1 }],
  },
  block_metal: {
    result: { kind: "block_metal", count: 4 },
    ingredients: [{ kind: "metal", count: 1 }],
    station: "furnace",
  },
  // Плавка
  metal_smelt: {
    result: { kind: "metal", count: 1 },
    ingredients: [{ kind: "iron", count: 1 }, { kind: "wood", count: 1 }],
    station: "furnace",
  },
  cloth_from_meat: {
    result: { kind: "cloth", count: 1 },
    ingredients: [{ kind: "meat", count: 2 }],
    station: "workbench",
  },
};

export function emptyInventory(): InventoryState {
  return {
    main: Array.from({ length: 20 }, () => null),
    hotbar: Array.from({ length: 5 }, () => null),
    selectedHotbar: 0,
  };
}

export function countItem(inv: InventoryState, kind: ItemKind): number {
  let total = 0;
  for (const s of inv.main) if (s && s.kind === kind) total += s.count;
  for (const s of inv.hotbar) if (s && s.kind === kind) total += s.count;
  return total;
}

export function removeItem(inv: InventoryState, kind: ItemKind, count: number): boolean {
  if (countItem(inv, kind) < count) return false;
  let left = count;
  const drain = (slots: (ItemStack | null)[]) => {
    for (let i = 0; i < slots.length && left > 0; i++) {
      const s = slots[i];
      if (s && s.kind === kind) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) slots[i] = null;
      }
    }
  };
  drain(inv.hotbar);
  drain(inv.main);
  return true;
}

export function addItem(inv: InventoryState, stack: ItemStack): boolean {
  let left = stack.count;
  const limit = STACK_LIMITS[stack.kind] ?? 1;
  const tryFill = (slots: (ItemStack | null)[]) => {
    for (let i = 0; i < slots.length && left > 0; i++) {
      const s = slots[i];
      if (s && s.kind === stack.kind && s.count < limit) {
        const can = limit - s.count;
        const take = Math.min(can, left);
        s.count += take;
        left -= take;
      }
    }
  };
  const tryEmpty = (slots: (ItemStack | null)[]) => {
    for (let i = 0; i < slots.length && left > 0; i++) {
      if (slots[i] === null) {
        const take = Math.min(limit, left);
        slots[i] = { kind: stack.kind, count: take };
        left -= take;
      }
    }
  };
  tryFill(inv.hotbar);
  tryFill(inv.main);
  tryEmpty(inv.hotbar);
  tryEmpty(inv.main);
  return left === 0;
}

export function tryCraft(inv: InventoryState, recipeId: string, hasStation: { workbench: boolean; furnace: boolean }): boolean {
  const r = RECIPES[recipeId];
  if (!r) return false;
  if (r.station === "workbench" && !hasStation.workbench) return false;
  if (r.station === "furnace" && !hasStation.furnace) return false;
  for (const ing of r.ingredients) {
    if (countItem(inv, ing.kind) < ing.count) return false;
  }
  // Атомарно: сначала проверили — теперь забираем и выдаём.
  for (const ing of r.ingredients) removeItem(inv, ing.kind, ing.count);
  return addItem(inv, { ...r.result });
}
