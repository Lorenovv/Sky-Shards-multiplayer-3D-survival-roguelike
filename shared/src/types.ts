// Общие типы и интерфейсы для клиента и сервера.
// Клиент получает снимки этих структур и рендерит их;
// сервер хранит истину.

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

// ---- Идентификаторы ----
export type PlayerId = string;
export type EnemyId = string;
export type ItemEntityId = string;
export type IslandId = number;
export type BuildingId = string;

// ---- Биомы и ресурсы ----
export type BiomeKind = "forest" | "rocks" | "wastes" | "ruins" | "ice";

export type ResourceKind =
  | "wood"
  | "stone"
  | "iron"
  | "gold"
  | "crystal"
  | "air"
  | "meat"
  | "artifact"
  | "rope"
  | "metal"
  | "cloth";

export type ToolKind = "fist" | "axe_wood" | "pickaxe_stone" | "sword_iron";

export type ItemKind =
  | ResourceKind
  | ToolKind
  | "glider"
  | "hookshot"
  | "workbench"
  | "furnace"
  | "turret"
  | "zipline_kit"
  | "stabilizer"
  | "block_wood"
  | "block_stone"
  | "block_metal"
  | "drone";

export interface ItemStack {
  kind: ItemKind;
  count: number;
}

export interface InventoryState {
  // 20 ячеек основного + 5 быстрого. null = пусто.
  main: (ItemStack | null)[]; // length 20
  hotbar: (ItemStack | null)[]; // length 5
  selectedHotbar: number;
}

// ---- Игрок ----
export interface PlayerInputCmd {
  seq: number;          // sequence number для реконсиляции
  dt: number;           // длительность ввода (сек)
  forward: number;      // -1..1
  strafe: number;       // -1..1
  yaw: number;          // радианы (поворот камеры по горизонтали)
  pitch: number;        // радианы (для UI/эффектов)
  jump: boolean;
  sprint: boolean;
  glider: boolean;
  primary: boolean;     // ЛКМ — атака/добыча
  secondary: boolean;   // ПКМ — блок/использование
  interact: boolean;    // E
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  hunger: number;       // 0..100, чем меньше тем хуже
  air: number;          // запас сжатого воздуха для планера/рывка
  alive: boolean;
  ack: number;          // последний обработанный seq (для реконсиляции)
  inventory: InventoryState;
  purchasedItems: string[]; // косметика (задел монетизации)
  equippedTool: ToolKind;
  gliding: boolean;
}

// ---- Якорь ----
export interface AnchorState {
  pos: Vec3;
  energy: number;
  maxEnergy: number;
  radius: number;
  baseRadius: number;
  expanded: boolean;       // удвоенный расход
  trayCount: number;       // 0..5 — кристаллы в лотке
  alarm: boolean;          // <15%
  countdownToFall: number; // сек, если 0 энергии
  cooldownExpand: number;  // сек до следующей возможности расширить
}

// ---- Враги ----
export type EnemyKind =
  | "skate"
  | "harpy"
  | "eater"
  | "golem"
  | "stormbringer"
  | "boss_whale"
  | "boss_treant";

export interface EnemyState {
  id: EnemyId;
  kind: EnemyKind;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  hp: number;
  maxHp: number;
  flying: boolean;
  targetPlayerId: PlayerId | null;
  attacking: boolean;
}

// ---- Острова ----
export interface IslandData {
  id: IslandId;
  center: Vec3;
  radius: number;
  biome: BiomeKind;
  unstable: boolean;        // колеблется по синусоиде
  baseY: number;
  fallVelocity: number;     // если вне радиуса якоря
  alive: boolean;
  // компактные «пропсы» для клиентской генерации
  seed: number;
}

// ---- Предметы на земле и постройки ----
export interface ItemEntity {
  id: ItemEntityId;
  pos: Vec3;
  stack: ItemStack;
  spawnedAt: number;
}

export interface BuildingState {
  id: BuildingId;
  pos: Vec3;
  kind: "block_wood" | "block_stone" | "block_metal" | "workbench" | "furnace" | "turret" | "zipline_anchor";
  hp: number;
  ownerId: PlayerId | null;
  data?: Record<string, number | string | boolean>;
}

// ---- Канатные дороги и потоки ----
export interface ZiplineState {
  id: string;
  a: Vec3;
  b: Vec3;
  alive: boolean;
}

export interface GravFlowState {
  id: string;
  pos: Vec3;
  dir: Vec3;
  strength: number;
  ttl: number;
}

// ---- Цикл дня и шторм ----
export type DayPhase = "day" | "night";

export interface WorldClock {
  phase: DayPhase;
  phaseTime: number; // прошло секунд в фазе
  phaseDuration: number; // длительность фазы
  dayIndex: number;
  storming: boolean;
  stormTime: number;
}

// ---- Снимок состояния мира (отправляется клиенту) ----
export interface Snapshot {
  tick: number;
  serverTime: number;
  seed: number;
  clock: WorldClock;
  anchor: AnchorState;
  players: PlayerState[];
  enemies: EnemyState[];
  items: ItemEntity[];
  buildings: BuildingState[];
  ziplines: ZiplineState[];
  flows: GravFlowState[];
  islands: IslandData[]; // полный список редко меняется; обновляется реже
}

// ---- Рецепты ----
export interface Recipe {
  result: ItemStack;
  ingredients: ItemStack[];
  station?: "workbench" | "furnace";
}

// ---- Сообщения сокета ----
export interface ClientHello {
  name: string;
}

export interface ServerWelcome {
  playerId: PlayerId;
  seed: number;
  islands: IslandData[];
  tickRate: number;
}

export type ClientToServer = {
  hello: (msg: ClientHello) => void;
  input: (cmd: PlayerInputCmd) => void;
  craft: (recipeId: string) => void;
  pickup: (itemId: ItemEntityId) => void;
  drop: (slot: { kind: "main" | "hotbar"; index: number; count?: number }) => void;
  hotbarSelect: (index: number) => void;
  feedAnchor: () => void;          // положить кристалл в лоток
  expandAnchor: () => void;        // расширить радиус
  build: (msg: { kind: BuildingState["kind"]; pos: Vec3 }) => void;
  zipline: (msg: { from: Vec3; to: Vec3 }) => void;
  hookshot: (msg: { dir: Vec3 }) => void;
  useStabilizer: () => void;
  chat: (text: string) => void;
};

export type ServerToClient = {
  welcome: (msg: ServerWelcome) => void;
  snapshot: (msg: Snapshot) => void;
  delta: (msg: Partial<Snapshot> & { tick: number; serverTime: number }) => void;
  event: (msg: ServerEvent) => void;
  chat: (msg: { from: string; text: string }) => void;
  kicked: (reason: string) => void;
};

export type ServerEvent =
  | { kind: "player_joined"; id: PlayerId; name: string }
  | { kind: "player_left"; id: PlayerId }
  | { kind: "player_died"; id: PlayerId; cause: string }
  | { kind: "anchor_critical" }
  | { kind: "anchor_recovered" }
  | { kind: "game_over"; reason: string }
  | { kind: "wave_started"; index: number; count: number }
  | { kind: "wave_ended"; index: number }
  | { kind: "storm_started" }
  | { kind: "storm_ended" }
  | { kind: "boss_spawned"; boss: "boss_whale" | "boss_treant" }
  | { kind: "log"; text: string };

// ---- Константы ----
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const WORLD_SIZE = { x: 300, y: 100, z: 300 };
export const ANCHOR_INIT = {
  energy: 200,
  maxEnergy: 300,
  baseRadius: 60,
  baseConsumption: 0.4, // ед./сек
  expandedConsumptionMult: 2,
  ziplineConsumption: 0.05,
  crystalEnergy: 30,
  trayCapacity: 5,
  expandCooldown: 2,
};
export const PLAYER_INIT = {
  hp: 100,
  hunger: 100,
  air: 100,
  speed: 6.0,
  sprintMult: 1.6,
  jumpVel: 7.0,
  glideFall: -1.2,
  glideDrag: 0.96,
};
export const DAY_DURATION = 6 * 60;   // 6 минут
export const NIGHT_DURATION = 4 * 60; // 4 минуты
export const STORM_DURATION = 60;
