// Серверная комната. Авторитарная игровая логика.
// 20 Гц тик: input -> physics -> AI -> events -> snapshot.

import type { Server, Socket } from "socket.io";
import type {
  BuildingState, ClientToServer, GravFlowState, IslandData,
  ItemEntity, ItemKind, ItemStack, PlayerInputCmd, ServerEvent, ServerToClient,
  Snapshot, Vec3, WorldClock, ZiplineState,
} from "@sky-shards/shared";
import {
  DAY_DURATION, NIGHT_DURATION, STORM_DURATION,
  TICK_DT, TICK_RATE,
} from "@sky-shards/shared";
import { generateWorld, unstableY } from "./World.js";
import { PhysicsWorld } from "./Physics.js";
import { AnchorManager } from "./AnchorManager.js";
import { ServerPlayer } from "./Player.js";
import { ServerEnemy } from "./Enemy.js";
import { WaveManager } from "./WaveManager.js";
import { addItem, countItem, removeItem, tryCraft } from "./Crafting.js";
import { nextId, now, v3dist } from "./Utils.js";

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

interface ResourceNode {
  id: string;
  pos: Vec3;
  kind: "tree" | "boulder" | "iron_vein" | "gold_vein" | "crystal" | "air_plant" | "ruin_artifact" | "animal";
  hp: number;
  drops: ItemStack;
  islandId: number;
}

const ISLANDS_BROADCAST_INTERVAL = 30; // тиков

export class GameRoom {
  readonly id: string;
  private io: IO;
  private players = new Map<string, ServerPlayer>();
  private sockets = new Map<string, Sock>();
  private enemies = new Map<string, ServerEnemy>();
  private items = new Map<string, ItemEntity>();
  private buildings = new Map<string, BuildingState>();
  private ziplines = new Map<string, ZiplineState>();
  private flows = new Map<string, GravFlowState>();
  private resources = new Map<string, ResourceNode>();
  private islands: IslandData[];
  private startIslandId: number;
  private seed: number;
  private physics: PhysicsWorld;
  private anchor: AnchorManager;
  private waves: WaveManager;
  private clock: WorldClock;
  private tickIndex = 0;
  private interval: NodeJS.Timeout | null = null;
  private stabilizerTimer = 0; // активный стабилизатор: остров не падает
  private bossSpawnTimer = 0;
  private treantSpawned = false;
  private gameOver = false;
  private emptySinceMs: number | null = null;

  constructor(io: IO, id: string, seed: number) {
    this.io = io;
    this.id = id;
    this.seed = seed;
    const wg = generateWorld(seed);
    this.islands = wg.islands;
    this.startIslandId = wg.startIslandId;
    this.physics = new PhysicsWorld();
    for (const isl of this.islands) this.physics.addIsland(isl);
    const startIsland = this.islands.find(i => i.id === this.startIslandId)!;
    this.anchor = new AnchorManager(startIsland.center.y);
    this.waves = new WaveManager();
    this.clock = {
      phase: "day", phaseTime: 0, phaseDuration: DAY_DURATION,
      dayIndex: 0, storming: false, stormTime: 0,
    };
    this.spawnInitialResources();
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.physics.destroy();
  }

  attachSocket(socket: Sock, name: string): string {
    const id = socket.id;
    const startIsl = this.islands.find(i => i.id === this.startIslandId)!;
    const spawn = { x: startIsl.center.x, y: startIsl.center.y + startIsl.radius * 0.45 + 1, z: startIsl.center.z };
    const player = new ServerPlayer(id, name || `Сталкер-${id.slice(0, 4)}`, spawn);
    // Стартовые предметы — 5 дерева для топора, чтобы сразу было чем попробовать крафт.
    addItem(player.state.inventory, { kind: "wood", count: 5 });
    this.players.set(id, player);
    this.sockets.set(id, socket);

    socket.emit("welcome", {
      playerId: id,
      seed: this.seed,
      islands: this.islands,
      tickRate: TICK_RATE,
    });
    this.broadcastEvent({ kind: "player_joined", id, name: player.state.name });
    this.bindHandlers(socket, id);
    this.emptySinceMs = null;
    return id;
  }

  detachSocket(socketId: string): void {
    const player = this.players.get(socketId);
    if (player) {
      // Дроп инвентаря
      for (const slot of [...player.state.inventory.hotbar, ...player.state.inventory.main]) {
        if (slot && slot.count > 0) this.spawnItem({ x: player.state.pos.x, y: player.state.pos.y, z: player.state.pos.z }, slot);
      }
      this.players.delete(socketId);
      this.sockets.delete(socketId);
      this.broadcastEvent({ kind: "player_left", id: socketId });
    }
    if (this.players.size === 0) this.emptySinceMs = Date.now();
  }

  isEmptyFor(ms: number): boolean {
    return this.emptySinceMs !== null && (Date.now() - this.emptySinceMs) > ms;
  }

  // -------- ВНЕШНИЕ ОБРАБОТЧИКИ --------
  private bindHandlers(socket: Sock, id: string): void {
    socket.on("input", (cmd: PlayerInputCmd) => {
      const p = this.players.get(id);
      if (!p) return;
      // Sanitize
      cmd.forward = clamp1(cmd.forward); cmd.strafe = clamp1(cmd.strafe);
      cmd.dt = Math.max(0, Math.min(0.2, cmd.dt));
      p.applyInput(cmd);
    });
    socket.on("hotbarSelect", (i: number) => {
      const p = this.players.get(id); if (!p) return;
      p.state.inventory.selectedHotbar = Math.max(0, Math.min(4, i | 0));
      const slot = p.state.inventory.hotbar[p.state.inventory.selectedHotbar];
      if (slot) {
        const tools: ItemKind[] = ["fist", "axe_wood", "pickaxe_stone", "sword_iron"];
        if ((tools as string[]).includes(slot.kind)) p.setTool(slot.kind as never);
        else p.setTool("fist");
      } else p.setTool("fist");
    });
    socket.on("craft", (recipeId: string) => {
      const p = this.players.get(id); if (!p) return;
      const has = this.checkStations(p.state.pos);
      if (tryCraft(p.state.inventory, recipeId, has)) {
        // ok
      }
    });
    socket.on("pickup", (itemId: string) => {
      const p = this.players.get(id); if (!p) return;
      const it = this.items.get(itemId); if (!it) return;
      if (v3dist(p.state.pos, it.pos) > 3) return;
      if (addItem(p.state.inventory, it.stack)) this.items.delete(itemId);
    });
    socket.on("drop", (slot) => {
      const p = this.players.get(id); if (!p) return;
      const arr = slot.kind === "main" ? p.state.inventory.main : p.state.inventory.hotbar;
      const s = arr[slot.index]; if (!s) return;
      const count = Math.min(s.count, slot.count ?? s.count);
      this.spawnItem({ x: p.state.pos.x, y: p.state.pos.y - 0.5, z: p.state.pos.z }, { kind: s.kind, count });
      s.count -= count; if (s.count <= 0) arr[slot.index] = null;
    });
    socket.on("feedAnchor", () => {
      const p = this.players.get(id); if (!p) return;
      if (v3dist(p.state.pos, this.anchor.state.pos) > 4) return;
      if (countItem(p.state.inventory, "crystal") < 1) return;
      if (this.anchor.feedCrystal()) removeItem(p.state.inventory, "crystal", 1);
    });
    socket.on("expandAnchor", () => {
      const p = this.players.get(id); if (!p) return;
      if (v3dist(p.state.pos, this.anchor.state.pos) > 6) return;
      this.anchor.expand();
    });
    socket.on("build", (msg) => {
      const p = this.players.get(id); if (!p) return;
      if (v3dist(p.state.pos, msg.pos) > 6) return;
      const itemKind = msg.kind as ItemKind;
      if (countItem(p.state.inventory, itemKind) < 1) return;
      // Не строим в игроке.
      for (const other of this.players.values()) {
        if (v3dist(other.state.pos, msg.pos) < 1) return;
      }
      removeItem(p.state.inventory, itemKind, 1);
      const b: BuildingState = {
        id: nextId("b"),
        pos: { ...msg.pos },
        kind: msg.kind,
        hp: msg.kind === "block_metal" ? 200 : msg.kind === "block_stone" ? 120 : 60,
        ownerId: id,
      };
      this.buildings.set(b.id, b);
    });
    socket.on("zipline", (msg) => {
      const p = this.players.get(id); if (!p) return;
      if (countItem(p.state.inventory, "zipline_kit") < 1) return;
      // Оба конца должны быть в радиусе якоря.
      const inA = v3dist(this.anchor.state.pos, msg.from) < this.anchor.state.radius;
      const inB = v3dist(this.anchor.state.pos, msg.to) < this.anchor.state.radius;
      if (!inA || !inB) return;
      removeItem(p.state.inventory, "zipline_kit", 1);
      this.ziplines.set(nextId("z"), { id: nextId("z"), a: { ...msg.from }, b: { ...msg.to }, alive: true });
    });
    socket.on("hookshot", (msg) => {
      const p = this.players.get(id); if (!p) return;
      if (countItem(p.state.inventory, "hookshot") < 1) return;
      const hit = this.physics.raycastSurface(p.state.pos, msg.dir, 40, this.islands);
      if (!hit) return;
      // Притягиваем игрока: задаём скорость в направлении хита.
      const dx = hit.hit.x - p.state.pos.x;
      const dy = hit.hit.y - p.state.pos.y;
      const dz = hit.hit.z - p.state.pos.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.001) return;
      p.state.vel.x = (dx / len) * 18;
      p.state.vel.y = (dy / len) * 18;
      p.state.vel.z = (dz / len) * 18;
    });
    socket.on("useStabilizer", () => {
      const p = this.players.get(id); if (!p) return;
      if (countItem(p.state.inventory, "stabilizer") < 1) return;
      if (!this.anchor.useStabilizer()) return;
      removeItem(p.state.inventory, "stabilizer", 1);
      this.stabilizerTimer = 15;
    });
    socket.on("chat", (text: string) => {
      const safe = String(text ?? "").slice(0, 200);
      const p = this.players.get(id); if (!p) return;
      this.io.to(this.id).emit("chat", { from: p.state.name, text: safe });
    });
  }

  // -------- ОСНОВНОЙ ТИК --------
  private tick(): void {
    if (this.gameOver) return;
    this.tickIndex++;
    const dt = TICK_DT;

    // Часы
    this.clock.phaseTime += dt;
    if (this.clock.phaseTime >= this.clock.phaseDuration) {
      this.clock.phaseTime = 0;
      if (this.clock.phase === "day") {
        this.clock.phase = "night";
        this.clock.phaseDuration = NIGHT_DURATION;
        const { events, descriptor } = this.waves.startWave(this.clock.dayIndex, this.islands);
        for (const ev of events) this.broadcastEvent(ev);
        // Стартовый спавн волны: разложим во времени.
        // Спавним 1 врага на тик.
        this.pendingSpawnDescriptor = descriptor;
      } else {
        this.clock.phase = "day";
        this.clock.dayIndex++;
        this.clock.phaseDuration = DAY_DURATION;
        for (const ev of this.waves.endWave()) this.broadcastEvent(ev);

        // Шторм каждые 2-4 дня
        if (this.clock.dayIndex % 3 === 0) this.startStorm();
        // Босс Древень бурь после 3-й ночи
        if (this.clock.dayIndex === 4 && !this.treantSpawned) {
          this.treantSpawned = true;
          this.spawnBoss("boss_treant");
        }
      }
    }

    // Босс «Небесный кит» каждые 60 минут реального времени игры (сумма фаз)
    this.bossSpawnTimer += dt;
    if (this.bossSpawnTimer >= 60 * 60) {
      this.bossSpawnTimer = 0;
      this.spawnBoss("boss_whale");
    }

    // Спавн волны постепенно
    if (this.clock.phase === "night") {
      const sp = this.waves.popSpawn();
      if (sp) this.spawnEnemy(sp.kind, sp.pos);
    }

    // Шторм
    if (this.clock.storming) {
      this.clock.stormTime += dt;
      if (this.clock.stormTime >= STORM_DURATION) {
        this.clock.storming = false;
        this.clock.stormTime = 0;
        this.broadcastEvent({ kind: "storm_ended" });
      }
      // Резкое колебание островов вне радиуса якоря
      for (const isl of this.islands) {
        if (!isl.alive) continue;
        const inR = v3dist(this.anchor.state.pos, isl.center) < this.anchor.state.radius;
        if (!inR) isl.center.y += (Math.sin(this.tickIndex * 0.15 + isl.seed) * 0.2);
      }
      // Канатные дороги вне радиуса рвутся
      for (const z of this.ziplines.values()) {
        const inR = v3dist(this.anchor.state.pos, z.a) < this.anchor.state.radius
          && v3dist(this.anchor.state.pos, z.b) < this.anchor.state.radius;
        if (!inR) z.alive = false;
      }
      // Перегенерация потоков
      if (this.tickIndex % 60 === 0) this.spawnFlow();
    }

    // Стабилизатор
    if (this.stabilizerTimer > 0) this.stabilizerTimer = Math.max(0, this.stabilizerTimer - dt);

    // Игроки
    const getGround = (x: number, z: number): number | null => {
      const g = this.physics.groundAt(x, z, this.islands);
      return g ? g.y : null;
    };
    for (const p of this.players.values()) {
      p.tick(dt, getGround);
      if (!p.state.alive && p.state.hp <= 0) {
        // Сообщение о смерти, сброс спавн-тайма
        // (Roguelike: игрок остаётся мёртвым. Но клиент может переподключиться.)
      }
      // ЛКМ — добыча/атака
      const inp = p.currentInput;
      const t = now() / 1000;
      if (inp.primary && p.state.alive && t - p.lastAttackTime > 0.4) {
        p.lastAttackTime = t;
        this.handlePrimary(p);
      }
    }

    // Враги
    const speedMult = this.clock.storming ? 1.4 : 1;
    const damageMult = this.clock.storming ? 1.3 : 1;
    const playerStates = [...this.players.values()].map(p => p.state);
    const buildingsList = [...this.buildings.values()];
    for (const e of this.enemies.values()) {
      const evs = e.step(dt, playerStates, this.anchor.state, buildingsList, getGround, speedMult, damageMult);
      for (const ev of evs) this.applyEnemyAttack(ev);
    }

    // Удаление мёртвых врагов
    for (const [id, e] of this.enemies) {
      if (e.state.hp <= 0) {
        // Дроп
        const drop: ItemStack | null = lootForEnemy(e.state.kind);
        if (drop) this.spawnItem({ ...e.state.pos }, drop);
        this.enemies.delete(id);
        this.waves.notifyEnemyDied();
      }
    }

    // Якорь
    const anchorEvents = this.anchor.step(dt, this.ziplines.size, this.players.size <= 1);
    for (const ev of anchorEvents) {
      this.broadcastEvent(ev);
      if (ev.kind === "game_over") {
        this.gameOver = true;
      }
    }
    this.anchor.applyFalling(this.islands, dt, this.stabilizerTimer > 0);

    // Колебания нестабильных островов
    if (!this.clock.storming) {
      const t = this.tickIndex * dt;
      for (const isl of this.islands) {
        if (!isl.alive || !isl.unstable) continue;
        // Возвращаем к baseY с амплитудой 1.5
        isl.center.y = unstableY(isl, t);
      }
    }

    // Гравитационные потоки — затухание
    for (const [id, fl] of this.flows) {
      fl.ttl -= dt;
      if (fl.ttl <= 0) this.flows.delete(id);
    }

    // Урон от нахождения в потоке (нет) — бонус скорости (на клиенте, либо здесь)
    for (const p of this.players.values()) {
      for (const fl of this.flows.values()) {
        if (v3dist(p.state.pos, fl.pos) < 8) {
          p.state.pos.x += fl.dir.x * fl.strength * dt;
          p.state.pos.y += fl.dir.y * fl.strength * dt;
          p.state.pos.z += fl.dir.z * fl.strength * dt;
        }
      }
    }

    this.physics.step(dt);

    // Снимок
    this.broadcastSnapshot();

    // Удаление мёртвых построек
    for (const [id, b] of this.buildings) if (b.hp <= 0) this.buildings.delete(id);
  }

  private pendingSpawnDescriptor: { count: number } | null = null;

  // -------- ОСНОВНЫЕ ВСПОМОГАТЕЛЬНЫЕ --------
  private startStorm(): void {
    this.clock.storming = true;
    this.clock.stormTime = 0;
    this.broadcastEvent({ kind: "storm_started" });
    // Спавн буревестника-предвестника, если не первая ночь
    if (this.clock.dayIndex >= 1) this.spawnEnemy("stormbringer", { x: 0, y: 80, z: 0 });
    // Перегенерация потоков
    this.flows.clear();
    for (let i = 0; i < 4; i++) this.spawnFlow();
  }

  private spawnFlow(): void {
    const fl: GravFlowState = {
      id: nextId("f"),
      pos: { x: (Math.random() - 0.5) * 200, y: 30 + Math.random() * 40, z: (Math.random() - 0.5) * 200 },
      dir: { x: Math.random() - 0.5, y: 0.2, z: Math.random() - 0.5 },
      strength: 6,
      ttl: 5 * 60,
    };
    // Нормализация
    const len = Math.hypot(fl.dir.x, fl.dir.y, fl.dir.z) || 1;
    fl.dir.x /= len; fl.dir.y /= len; fl.dir.z /= len;
    this.flows.set(fl.id, fl);
  }

  private spawnEnemy(kind: import("@sky-shards/shared").EnemyKind, pos: Vec3): void {
    const e = new ServerEnemy(kind, pos);
    this.enemies.set(e.state.id, e);
  }

  private spawnBoss(kind: "boss_whale" | "boss_treant"): void {
    this.spawnEnemy(kind, { x: 0, y: 90, z: 0 });
    this.broadcastEvent({ kind: "boss_spawned", boss: kind });
  }

  private spawnItem(pos: Vec3, stack: ItemStack): void {
    const it: ItemEntity = { id: nextId("i"), pos: { ...pos }, stack: { ...stack }, spawnedAt: this.tickIndex };
    this.items.set(it.id, it);
  }

  private spawnInitialResources(): void {
    let counter = 0;
    for (const isl of this.islands) {
      const cnt = Math.max(1, Math.floor(isl.radius * 0.4));
      for (let i = 0; i < cnt; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * isl.radius * 0.8;
        const x = isl.center.x + Math.cos(a) * r;
        const z = isl.center.z + Math.sin(a) * r;
        const g = this.physics.groundAt(x, z, this.islands);
        if (!g) continue;
        const y = g.y + 0.5;
        const roll = Math.random();
        let kind: ResourceNode["kind"] = "tree";
        let drops: ItemStack = { kind: "wood", count: 3 };
        let hp = 20;
        if (isl.biome === "rocks" || isl.biome === "ice") {
          if (roll < 0.5) { kind = "boulder"; drops = { kind: "stone", count: 3 }; hp = 30; }
          else if (roll < 0.75) { kind = "iron_vein"; drops = { kind: "iron", count: 2 }; hp = 40; }
          else if (roll < 0.9) { kind = "gold_vein"; drops = { kind: "gold", count: 1 }; hp = 50; }
          else { kind = "crystal"; drops = { kind: "crystal", count: 1 }; hp = 60; }
        } else if (isl.biome === "ruins") {
          if (roll < 0.4) { kind = "tree"; drops = { kind: "wood", count: 3 }; hp = 20; }
          else if (roll < 0.7) { kind = "boulder"; drops = { kind: "stone", count: 3 }; hp = 30; }
          else if (roll < 0.9) { kind = "ruin_artifact"; drops = { kind: "artifact", count: 1 }; hp = 25; }
          else { kind = "air_plant"; drops = { kind: "air", count: 2 }; hp = 15; }
        } else if (isl.biome === "wastes") {
          if (roll < 0.3) { kind = "boulder"; drops = { kind: "stone", count: 3 }; hp = 30; }
          else if (roll < 0.6) { kind = "animal"; drops = { kind: "meat", count: 2 }; hp = 18; }
          else if (roll < 0.85) { kind = "iron_vein"; drops = { kind: "iron", count: 2 }; hp = 40; }
          else { kind = "crystal"; drops = { kind: "crystal", count: 1 }; hp = 60; }
        } else {
          // forest
          if (roll < 0.55) { kind = "tree"; drops = { kind: "wood", count: 3 }; hp = 20; }
          else if (roll < 0.8) { kind = "animal"; drops = { kind: "meat", count: 2 }; hp = 18; }
          else if (roll < 0.95) { kind = "boulder"; drops = { kind: "stone", count: 3 }; hp = 30; }
          else { kind = "air_plant"; drops = { kind: "air", count: 2 }; hp = 15; }
        }
        const id = `r_${++counter}`;
        this.resources.set(id, { id, pos: { x, y, z }, kind, hp, drops, islandId: isl.id });
      }
    }
  }

  private handlePrimary(p: ServerPlayer): void {
    // Ищем ближайший ресурс или врага в 3 ед.
    const range = 3;
    let nearestRes: ResourceNode | null = null;
    let nrDist = Infinity;
    for (const r of this.resources.values()) {
      const d = v3dist(r.pos, p.state.pos);
      if (d < range && d < nrDist) { nrDist = d; nearestRes = r; }
    }
    let nearestEnemy: ServerEnemy | null = null;
    let neDist = Infinity;
    for (const e of this.enemies.values()) {
      const d = v3dist(e.state.pos, p.state.pos);
      if (d < range && d < neDist) { neDist = d; nearestEnemy = e; }
    }
    // Оружие/инструмент
    const tool = p.state.equippedTool;
    const isWeapon = tool === "sword_iron";
    const isAxe = tool === "axe_wood";
    const isPick = tool === "pickaxe_stone";
    const damageVsEnemy = isWeapon ? 25 : 8;
    const damageVsRes = (kind: ResourceNode["kind"]) => {
      switch (kind) {
        case "tree": return isAxe ? 10 : 4;
        case "boulder":
        case "iron_vein":
        case "gold_vein":
        case "crystal":
          return isPick ? 10 : (kind === "boulder" ? 4 : 2);
        case "ruin_artifact": return isPick ? 8 : 4;
        case "air_plant": return 8;
        case "animal": return isWeapon ? 14 : 6;
      }
    };

    if (nearestEnemy && (!nearestRes || neDist < nrDist)) {
      nearestEnemy.takeDamage(damageVsEnemy);
      return;
    }
    if (nearestRes) {
      nearestRes.hp -= damageVsRes(nearestRes.kind);
      if (nearestRes.hp <= 0) {
        this.spawnItem(nearestRes.pos, { ...nearestRes.drops });
        // Иногда дополнительный ресурс
        if (nearestRes.kind === "animal") this.spawnItem(nearestRes.pos, { kind: "meat", count: 1 });
        this.resources.delete(nearestRes.id);
      }
    }
  }

  private applyEnemyAttack(ev: ReturnType<ServerEnemy["step"]>[number]): void {
    if (ev.target.kind === "player") {
      const p = this.players.get(ev.target.id);
      if (p) {
        p.takeDamage(ev.damage, "enemy");
        if (!p.state.alive) this.broadcastEvent({ kind: "player_died", id: p.state.id, cause: "enemy" });
      }
    } else if (ev.target.kind === "anchor") {
      // Пожиратель — высасывает 2 ед/сек, но ев — это импульсный удар.
      this.anchor.state.energy = Math.max(0, this.anchor.state.energy - ev.damage * 0.5);
    } else if (ev.target.kind === "building") {
      const b = this.buildings.get(ev.target.id);
      if (b) b.hp = Math.max(0, b.hp - ev.damage);
    }
  }

  private checkStations(pos: Vec3): { workbench: boolean; furnace: boolean } {
    let workbench = false, furnace = false;
    for (const b of this.buildings.values()) {
      if (b.hp <= 0) continue;
      if (v3dist(b.pos, pos) > 5) continue;
      if (b.kind === "workbench") workbench = true;
      if (b.kind === "furnace") furnace = true;
    }
    return { workbench, furnace };
  }

  private broadcastSnapshot(): void {
    const snap: Snapshot = {
      tick: this.tickIndex,
      serverTime: now(),
      seed: this.seed,
      clock: { ...this.clock },
      anchor: { ...this.anchor.state, pos: { ...this.anchor.state.pos } },
      players: [...this.players.values()].map(p => ({ ...p.state })),
      enemies: [...this.enemies.values()].map(e => ({ ...e.state })),
      items: [...this.items.values()].map(i => ({ ...i })),
      buildings: [...this.buildings.values()].map(b => ({ ...b })),
      ziplines: [...this.ziplines.values()].map(z => ({ ...z })),
      flows: [...this.flows.values()].map(f => ({ ...f })),
      // Острова шлём не каждый тик — экономим трафик.
      islands: this.tickIndex % ISLANDS_BROADCAST_INTERVAL === 0 ? this.islands : [],
    };
    this.io.to(this.id).emit("snapshot", snap);
  }

  private broadcastEvent(ev: ServerEvent): void {
    this.io.to(this.id).emit("event", ev);
  }
}

function clamp1(v: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

function lootForEnemy(kind: import("@sky-shards/shared").EnemyKind): ItemStack | null {
  switch (kind) {
    case "skate": return { kind: "meat", count: 2 };
    case "harpy": return { kind: "cloth", count: 1 };
    case "eater": return { kind: "crystal", count: 1 };
    case "golem": return { kind: "stone", count: 6 };
    case "stormbringer": return { kind: "iron", count: 3 };
    case "boss_whale": return { kind: "artifact", count: 2 };
    case "boss_treant": return { kind: "artifact", count: 3 };
  }
}
