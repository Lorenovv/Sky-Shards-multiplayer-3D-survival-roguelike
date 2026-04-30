// Сетевой слой клиента: подключение к Socket.IO, буфер снапшотов, интерполяция,
// client-side prediction для собственного игрока.

import { io, Socket } from "socket.io-client";
import type {
  ClientToServer, PlayerInputCmd, PlayerState, ServerEvent,
  ServerToClient, Snapshot, IslandData,
} from "@sky-shards/shared";

export type EventHandler = (ev: ServerEvent) => void;

const INTERP_DELAY_MS = 100; // интерполяция «отстаёт» на 100мс — позволяет иметь 2 снапшота

export class Network {
  private socket: Socket<ServerToClient, ClientToServer>;
  private snapshots: Snapshot[] = [];
  private maxSnapshots = 24;
  private localId: string | null = null;
  private seed = 0;
  private islands: IslandData[] = [];
  private tickRate = 20;
  private inputSeq = 0;
  private serverTimeOffsetMs = 0;
  private lastSnapshotAt = 0;
  private eventHandlers: EventHandler[] = [];
  private welcomeResolve: (() => void) | null = null;

  constructor(url: string) {
    this.socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
    });
    this.socket.on("welcome", (msg) => {
      this.localId = msg.playerId;
      this.seed = msg.seed;
      this.islands = msg.islands;
      this.tickRate = msg.tickRate;
      this.welcomeResolve?.();
    });
    this.socket.on("snapshot", (snap) => {
      this.snapshots.push(snap);
      if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
      // Если в снапшоте есть свежий список островов — обновляем.
      if (snap.islands && snap.islands.length > 0) this.islands = snap.islands;
      const localServerNow = snap.serverTime;
      this.serverTimeOffsetMs = localServerNow - performance.now();
      this.lastSnapshotAt = performance.now();
    });
    this.socket.on("event", (ev) => {
      for (const h of this.eventHandlers) h(ev);
    });
    this.socket.on("kicked", (reason) => {
      console.warn("kicked:", reason);
    });
  }

  async connect(name: string): Promise<void> {
    this.socket.connect();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Соединение не установлено")), 8000);
      this.socket.once("connect", () => {
        clearTimeout(t);
        this.welcomeResolve = resolve;
        this.socket.emit("hello", { name });
      });
    });
  }

  onEvent(h: EventHandler): void { this.eventHandlers.push(h); }

  sendInput(cmd: Omit<PlayerInputCmd, "seq">): number {
    const seq = ++this.inputSeq;
    const full: PlayerInputCmd = { ...cmd, seq };
    this.socket.emit("input", full);
    return seq;
  }

  send<E extends keyof ClientToServer>(ev: E, ...args: Parameters<ClientToServer[E]>): void {
    (this.socket.emit as never as (e: E, ...a: Parameters<ClientToServer[E]>) => void)(ev, ...args);
  }

  getLocalId(): string | null { return this.localId; }
  getSeed(): number { return this.seed; }
  getIslands(): IslandData[] { return this.islands; }
  getTickRate(): number { return this.tickRate; }
  getLatestSnapshot(): Snapshot | null { return this.snapshots[this.snapshots.length - 1] ?? null; }
  hasSnapshots(): boolean { return this.snapshots.length > 0; }

  // Возвращает интерполированный снимок мира на момент `now - INTERP_DELAY`.
  getInterpolatedSnapshot(): { snap: Snapshot; alpha: number; prev: Snapshot } | null {
    if (this.snapshots.length < 2) return null;
    const targetServerTime = (performance.now() + this.serverTimeOffsetMs) - INTERP_DELAY_MS;
    let a: Snapshot | null = null, b: Snapshot | null = null;
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const s0 = this.snapshots[i]; const s1 = this.snapshots[i + 1];
      if (!s0 || !s1) continue;
      if (s0.serverTime <= targetServerTime && targetServerTime <= s1.serverTime) {
        a = s0; b = s1; break;
      }
    }
    if (!a || !b) {
      const last = this.snapshots[this.snapshots.length - 1]!;
      const prev = this.snapshots[this.snapshots.length - 2]!;
      return { snap: last, alpha: 1, prev };
    }
    const span = Math.max(1, b.serverTime - a.serverTime);
    const alpha = (targetServerTime - a.serverTime) / span;
    return { snap: b, alpha, prev: a };
  }

  // Локальный игрок из последнего снапшота (для UI/реконсиляции).
  getLocalPlayer(): PlayerState | null {
    const s = this.getLatestSnapshot();
    if (!s || !this.localId) return null;
    return s.players.find(p => p.id === this.localId) ?? null;
  }

  isConnected(): boolean { return this.socket.connected; }
  disconnect(): void { this.socket.disconnect(); }
}
