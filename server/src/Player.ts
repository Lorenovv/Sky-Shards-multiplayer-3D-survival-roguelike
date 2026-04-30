// Серверный класс игрока. Хранит позицию, скорость, инвентарь, статусы.
// Контроллер: capsule-style, движение применяется в GameRoom при обработке input.

import type { PlayerInputCmd, PlayerState, PlayerId, Vec3, ToolKind } from "@sky-shards/shared";
import { PLAYER_INIT } from "@sky-shards/shared";
import { emptyInventory } from "./Crafting.js";

const CAPSULE_HALF_HEIGHT = 0.9;

export class ServerPlayer {
  state: PlayerState;
  grounded = false;
  lastInput: PlayerInputCmd | null = null;
  // Время в секундах последней атаки, для скорости атак
  lastAttackTime = 0;
  // Текущий ввод (накапливается)
  currentInput: PlayerInputCmd = {
    seq: 0, dt: 0, forward: 0, strafe: 0, yaw: 0, pitch: 0,
    jump: false, sprint: false, glider: false, primary: false, secondary: false, interact: false,
  };

  constructor(id: PlayerId, name: string, spawn: Vec3) {
    this.state = {
      id, name,
      pos: { ...spawn },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0,
      hp: PLAYER_INIT.hp, maxHp: PLAYER_INIT.hp,
      hunger: PLAYER_INIT.hunger,
      air: PLAYER_INIT.air,
      alive: true,
      ack: 0,
      inventory: emptyInventory(),
      purchasedItems: [],
      equippedTool: "fist",
      gliding: false,
    };
  }

  applyInput(cmd: PlayerInputCmd): void {
    this.currentInput = cmd;
    this.state.yaw = cmd.yaw;
    this.state.pitch = cmd.pitch;
    this.state.ack = cmd.seq;
  }

  // Вызывается каждый тик сервера. Возвращает желаемую горизонтальную дельту.
  tick(dt: number, getGroundY: (x: number, z: number) => number | null): void {
    const s = this.state;
    if (!s.alive) return;
    const inp = this.currentInput;

    // Голод тикает медленно.
    s.hunger = Math.max(0, s.hunger - 0.1 * dt);
    if (s.hunger <= 0) s.hp = Math.max(0, s.hp - 0.5 * dt);

    // Контроллер
    let speed = PLAYER_INIT.speed;
    if (inp.sprint && s.hunger > 0) speed *= PLAYER_INIT.sprintMult;

    // Локальные оси (yaw)
    const cosY = Math.cos(s.yaw);
    const sinY = Math.sin(s.yaw);
    // Forward: -Z, Strafe: +X
    const forwardX = -sinY * inp.forward;
    const forwardZ = -cosY * inp.forward;
    const strafeX = cosY * inp.strafe;
    const strafeZ = -sinY * inp.strafe;
    let dx = (forwardX + strafeX) * speed;
    let dz = (forwardZ + strafeZ) * speed;

    s.vel.x = dx;
    s.vel.z = dz;

    // Гравитация / планер
    if (s.gliding && inp.glider && s.air > 0) {
      // Планер: ограничиваем падение
      s.vel.y = Math.max(s.vel.y - 4 * dt, PLAYER_INIT.glideFall);
      s.air = Math.max(0, s.air - 4 * dt);
    } else {
      s.gliding = false;
      s.vel.y -= 20 * dt;
      if (s.vel.y < -30) s.vel.y = -30;
    }

    // Применяем движение
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;

    // Проверка земли
    const groundY = getGroundY(s.pos.x, s.pos.z);
    if (groundY !== null) {
      const targetY = groundY + CAPSULE_HALF_HEIGHT;
      if (s.pos.y <= targetY + 0.05) {
        s.pos.y = targetY;
        s.vel.y = 0;
        this.grounded = true;
        if (inp.jump) {
          s.vel.y = PLAYER_INIT.jumpVel;
          this.grounded = false;
        }
        if (inp.glider && !this.grounded) s.gliding = true;
      } else {
        this.grounded = false;
        if (inp.glider && s.air > 0) s.gliding = true;
      }
    } else {
      this.grounded = false;
      if (inp.glider && s.air > 0) s.gliding = true;
      // Если игрок упал ниже -10 — гибель.
      if (s.pos.y < -10) {
        s.alive = false;
        s.hp = 0;
      }
    }

    // Регенерация воздуха при касании земли
    if (this.grounded) s.air = Math.min(PLAYER_INIT.air, s.air + 5 * dt);
  }

  takeDamage(amount: number, _source: string): void {
    if (!this.state.alive) return;
    this.state.hp = Math.max(0, this.state.hp - amount);
    if (this.state.hp <= 0) {
      this.state.alive = false;
    }
  }

  setTool(t: ToolKind): void {
    this.state.equippedTool = t;
  }
}
