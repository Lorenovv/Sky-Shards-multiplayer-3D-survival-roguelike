// Логика Гравитационного якоря: расход энергии, лоток, расширение радиуса,
// тревога при <15%, отсчёт до Game Over при 0.

import type { AnchorState, IslandData, ServerEvent } from "@sky-shards/shared";
import { ANCHOR_INIT } from "@sky-shards/shared";
import { clamp } from "./Utils.js";

const FALL_TIMER = 30; // сек до Game Over

export class AnchorManager {
  state: AnchorState;
  private wasCritical = false;
  private wasZero = false;

  constructor(centerY: number) {
    this.state = {
      pos: { x: 0, y: centerY + 1.5, z: 0 },
      energy: ANCHOR_INIT.energy,
      maxEnergy: ANCHOR_INIT.maxEnergy,
      radius: ANCHOR_INIT.baseRadius,
      baseRadius: ANCHOR_INIT.baseRadius,
      expanded: false,
      trayCount: 0,
      alarm: false,
      countdownToFall: 0,
      cooldownExpand: 0,
    };
  }

  // Один тик. Возвращает события для рассылки (тревога/восстановление/конец).
  step(dt: number, ziplineCount: number, soloMode: boolean): ServerEvent[] {
    const events: ServerEvent[] = [];
    const s = this.state;

    // Расход
    let consumption = ANCHOR_INIT.baseConsumption;
    if (s.expanded) consumption *= ANCHOR_INIT.expandedConsumptionMult;
    consumption += ziplineCount * ANCHOR_INIT.ziplineConsumption;
    if (soloMode) consumption *= 0.5; // соло-баланс
    s.energy = Math.max(0, s.energy - consumption * dt);

    // Авто-подача из лотка: 1 кристалл/сек если есть в лотке и не полная энергия
    if (s.trayCount > 0 && s.energy < s.maxEnergy) {
      // Подаём не каждый тик — раз в секунду по 1 кристаллу.
      // Используем интегратор: уменьшим energy уже учтённый расход; здесь подаём дискретно.
      // Лоток отдаёт кристалл если энергии < maxEnergy - crystalEnergy/2 (чтобы не переливать)
      // Иначе ждём.
      this.feedTimer += dt;
      if (this.feedTimer >= 1.0) {
        this.feedTimer -= 1.0;
        if (s.energy <= s.maxEnergy - ANCHOR_INIT.crystalEnergy * 0.5) {
          s.trayCount -= 1;
          s.energy = clamp(s.energy + ANCHOR_INIT.crystalEnergy, 0, s.maxEnergy);
        }
      }
    } else {
      this.feedTimer = 0;
    }

    // Кулдаун расширения
    if (s.cooldownExpand > 0) s.cooldownExpand = Math.max(0, s.cooldownExpand - dt);

    // Тревога
    const critical = s.energy / s.maxEnergy < 0.15;
    s.alarm = critical;
    if (critical && !this.wasCritical) events.push({ kind: "anchor_critical" });
    if (!critical && this.wasCritical) events.push({ kind: "anchor_recovered" });
    this.wasCritical = critical;

    // Падение островов
    if (s.energy <= 0) {
      if (!this.wasZero) {
        s.countdownToFall = FALL_TIMER;
        this.wasZero = true;
      }
      s.countdownToFall = Math.max(0, s.countdownToFall - dt);
      if (s.countdownToFall <= 0) {
        events.push({ kind: "game_over", reason: "Якорь иссяк, острова рухнули в Бездну" });
      }
    } else {
      if (this.wasZero) {
        s.countdownToFall = 0;
        this.wasZero = false;
      }
    }

    return events;
  }

  // Игрок кладёт кристалл в лоток (1 шт.).
  feedCrystal(): boolean {
    if (this.state.trayCount >= ANCHOR_INIT.trayCapacity) return false;
    this.state.trayCount += 1;
    return true;
  }

  // Игрок расширяет радиус (стоит 20 энергии единоразово, удваивает расход).
  expand(): boolean {
    const s = this.state;
    if (s.cooldownExpand > 0) return false;
    if (s.energy < 25) return false;
    s.energy -= 20;
    s.expanded = !s.expanded;
    s.radius = s.expanded ? s.baseRadius * 1.5 : s.baseRadius;
    s.cooldownExpand = ANCHOR_INIT.expandCooldown;
    return true;
  }

  // Аварийный стабилизатор — обнуляет fallVelocity на 15с (логика в GameRoom).
  // Здесь только хранение кулдауна.
  stabilizerCooldown = 0;
  useStabilizer(): boolean {
    if (this.stabilizerCooldown > 0) return false;
    this.stabilizerCooldown = 30;
    return true;
  }

  applyFalling(islands: IslandData[], dt: number, stabilizerActive: boolean): void {
    const s = this.state;
    for (const isl of islands) {
      if (!isl.alive) continue;
      const dx = isl.center.x - s.pos.x;
      const dz = isl.center.z - s.pos.z;
      const inRadius = Math.hypot(dx, dz) < s.radius;
      if (!inRadius && !stabilizerActive && s.energy > 0) {
        // Опускается на 0.5 ед/сек.
        isl.center.y -= 0.5 * dt;
        isl.fallVelocity = 0.5;
      } else {
        isl.fallVelocity = 0;
      }
      // Нестабильные колеблются (правка делается отдельно в GameRoom).

      if (s.energy <= 0) {
        // При нуле — падают все.
        isl.center.y -= (1.5 + (FALL_TIMER - s.countdownToFall) * 0.2) * dt;
      }

      if (isl.center.y < -10) {
        isl.alive = false;
      }
    }
    if (this.stabilizerCooldown > 0) this.stabilizerCooldown = Math.max(0, this.stabilizerCooldown - dt);
  }

  private feedTimer = 0;
}
