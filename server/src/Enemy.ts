// Враги: базовый класс + специализации.
// ИИ простой: летающие — прямой полёт к цели; наземные — также прямо (без сложного pathfinding).
// Радиус обнаружения 30..50 ед.

import type { EnemyKind, EnemyState, PlayerState, Vec3, AnchorState, BuildingState } from "@sky-shards/shared";
import { v3dist, v3sub, v3normalize, nextId } from "./Utils.js";

export interface EnemyStats {
  hp: number;
  damage: number;
  speed: number;
  flying: boolean;
  detectRadius: number;
  attackRange: number;
  attackCooldown: number;
  attacksAnchor: boolean;
}

export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  skate:        { hp: 30, damage: 10, speed: 7, flying: true,  detectRadius: 50, attackRange: 2.5, attackCooldown: 1.2, attacksAnchor: false },
  harpy:        { hp: 25, damage: 8,  speed: 6, flying: true,  detectRadius: 40, attackRange: 12,  attackCooldown: 1.5, attacksAnchor: false },
  eater:        { hp: 20, damage: 0,  speed: 5, flying: true,  detectRadius: 9999, attackRange: 6, attackCooldown: 0.5, attacksAnchor: true },
  golem:        { hp: 80, damage: 15, speed: 2.5, flying: false, detectRadius: 35, attackRange: 2.5, attackCooldown: 1.6, attacksAnchor: false },
  stormbringer: { hp: 60, damage: 12, speed: 5, flying: true,  detectRadius: 50, attackRange: 3,  attackCooldown: 1.4, attacksAnchor: false },
  boss_whale:   { hp: 500, damage: 30, speed: 4, flying: true,  detectRadius: 9999, attackRange: 6, attackCooldown: 2.0, attacksAnchor: false },
  boss_treant:  { hp: 300, damage: 0,  speed: 3, flying: true,  detectRadius: 9999, attackRange: 25, attackCooldown: 3.0, attacksAnchor: false },
};

export interface EnemyAttackEvent {
  enemyId: string;
  target: { kind: "player"; id: string } | { kind: "anchor" } | { kind: "building"; id: string };
  damage: number;
  pos: Vec3;
}

export class ServerEnemy {
  state: EnemyState;
  stats: EnemyStats;
  cooldown = 0;

  constructor(kind: EnemyKind, spawn: Vec3) {
    this.stats = ENEMY_STATS[kind];
    this.state = {
      id: nextId("e"),
      kind,
      pos: { ...spawn },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      hp: this.stats.hp,
      maxHp: this.stats.hp,
      flying: this.stats.flying,
      targetPlayerId: null,
      attacking: false,
    };
  }

  step(
    dt: number,
    players: PlayerState[],
    anchor: AnchorState,
    buildings: BuildingState[],
    getGroundY: (x: number, z: number) => number | null,
    speedMult = 1,
    damageMult = 1,
  ): EnemyAttackEvent[] {
    const events: EnemyAttackEvent[] = [];
    const s = this.state;
    if (s.hp <= 0) return events;
    if (this.cooldown > 0) this.cooldown -= dt;

    // Цель
    let targetPos: Vec3 | null = null;
    let targetKind: EnemyAttackEvent["target"] | null = null;

    if (this.stats.attacksAnchor) {
      targetPos = anchor.pos;
      targetKind = { kind: "anchor" };
      s.targetPlayerId = null;
    } else {
      // Ближайший живой игрок в радиусе обнаружения.
      let bestDist = this.stats.detectRadius;
      let bestPlayer: PlayerState | null = null;
      for (const p of players) {
        if (!p.alive) continue;
        const d = v3dist(s.pos, p.pos);
        if (d < bestDist) { bestDist = d; bestPlayer = p; }
      }
      if (bestPlayer) {
        targetPos = bestPlayer.pos;
        targetKind = { kind: "player", id: bestPlayer.id };
        s.targetPlayerId = bestPlayer.id;
      } else {
        s.targetPlayerId = null;
      }

      // Голем сначала ломает ближайшую постройку при отсутствии игроков.
      if (s.kind === "golem" && !targetPos) {
        let bd = Infinity;
        let best: BuildingState | null = null;
        for (const b of buildings) {
          if (b.hp <= 0) continue;
          const d = v3dist(s.pos, b.pos);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) {
          targetPos = best.pos;
          targetKind = { kind: "building", id: best.id };
        }
      }
    }

    if (!targetPos || !targetKind) {
      // Idle: парим/стоим.
      s.vel.x = 0; s.vel.z = 0;
      if (this.stats.flying) {
        // Лёгкое колебание
        s.pos.y += Math.sin(Date.now() * 0.001 + s.pos.x) * 0.005;
      }
      return events;
    }

    // Двигаемся к цели
    const dir = v3sub({ x: 0, y: 0, z: 0 }, targetPos, s.pos);
    const dist = Math.hypot(dir.x, dir.y, dir.z);
    s.attacking = false;
    if (dist > this.stats.attackRange) {
      v3normalize(dir, dir);
      const speed = this.stats.speed * speedMult;
      s.vel.x = dir.x * speed;
      s.vel.y = this.stats.flying ? dir.y * speed : 0;
      s.vel.z = dir.z * speed;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;
      if (!this.stats.flying) {
        const gy = getGroundY(s.pos.x, s.pos.z);
        if (gy !== null) s.pos.y = gy + 0.9;
        else s.pos.y -= 12 * dt;
      }
      s.yaw = Math.atan2(-dir.x, -dir.z);
    } else {
      // Атака
      s.attacking = true;
      if (this.cooldown <= 0) {
        events.push({
          enemyId: s.id,
          target: targetKind,
          damage: this.stats.damage * damageMult,
          pos: { ...s.pos },
        });
        this.cooldown = this.stats.attackCooldown;
      }
    }

    return events;
  }

  takeDamage(amount: number): void {
    if (this.state.hp <= 0) return;
    this.state.hp = Math.max(0, this.state.hp - amount);
  }
}
