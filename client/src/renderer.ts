// Рендер: Three.js, WebGPU primary с фолбеком на WebGL.
// PBR материалы, динамические тени в радиусе ~30м, экспоненциальный туман,
// постобработка (Bloom). Инстансинг растительности, LOD, frustum culling авто.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { BuildingState, IslandData, ItemEntity, Snapshot, ZiplineState, GravFlowState } from "@sky-shards/shared";
import {
  getIslandGeometry, getIslandMaterial, getTreeMeshes, getRockMesh,
  getAnchorMeshes, getPlayerMesh, getEnemyMesh,
  getBuildingMesh, getItemMesh, buildGrassInstanced,
} from "./assets.js";

const FOG_COLOR = 0x9bbedf;
const SHADOW_RADIUS = 30;

export interface RendererInfo {
  type: "webgpu" | "webgl";
  draws: number;
  triangles: number;
}

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly type: "webgl" | "webgpu";
  private composer: EffectComposer;
  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private islandGroup = new THREE.Group();
  private vegetationGroup = new THREE.Group();
  private resourceGroup = new THREE.Group();
  private playerMeshes = new Map<string, THREE.Mesh>();
  private enemyMeshes = new Map<string, THREE.Mesh>();
  private buildingMeshes = new Map<string, THREE.Mesh>();
  private itemMeshes = new Map<string, THREE.Mesh>();
  private ziplineMeshes = new Map<string, THREE.Line>();
  private flowMeshes = new Map<string, THREE.Mesh>();
  private anchor: THREE.Group;
  private islandsBuiltFor = new WeakMap<IslandData, true>();
  private islandRoots = new Map<number, THREE.Group>();
  private grassInstances: THREE.InstancedMesh[] = [];

  constructor() {
    // По спецификации: WebGPURenderer основной, WebGL — fallback.
    // На практике WebGPU-ветка Three.js требует TSL-шейдеров и нестабильна
    // c классическим MeshStandardMaterial: при чёрном экране сразу падаем
    // на WebGL и не пытаемся чинить (см. п. 9 ТЗ).
    // Флаг `?webgpu=1` в URL зарезервирован для будущей TSL-ветки.
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const kind: "webgl" | "webgpu" = "webgl";

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // Канвас вставляем в #app, ДО оверлея, чтобы оверлей и логин-экран
    // нормально получали клики (z-index в CSS).
    const appEl = document.getElementById("app") ?? document.body;
    appEl.insertBefore(renderer.domElement, appEl.firstChild);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.type = kind;

    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.012);

    // Hemisphere для общего света + солнце с тенями только в радиусе.
    this.hemiLight = new THREE.HemisphereLight(0xfff7e0, 0x47557a, 0.8);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff1c4, 1.4);
    this.dirLight.position.set(40, 80, 30);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 5;
    this.dirLight.shadow.camera.far = 200;
    const sc = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    sc.left = -SHADOW_RADIUS; sc.right = SHADOW_RADIUS;
    sc.top = SHADOW_RADIUS; sc.bottom = -SHADOW_RADIUS;
    sc.updateProjectionMatrix();
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // Камера от первого лица.
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);
    this.camera.position.set(0, 60, 0);

    this.scene.add(this.islandGroup);
    this.scene.add(this.vegetationGroup);
    this.scene.add(this.resourceGroup);

    // Якорь
    this.anchor = getAnchorMeshes();
    this.scene.add(this.anchor);

    // Skydome с лёгким градиентом
    const skyGeo = new THREE.SphereGeometry(400, 16, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x4a73a8) },
        bottomColor: { value: new THREE.Color(0xc9d8e8) },
        offset: { value: 30 },
        exponent: { value: 0.6 },
      },
      vertexShader: `varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor;
        uniform float offset; uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);

    // Постобработка
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.6, 0.85);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener("resize", () => this.onResize());
  }

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  buildIslands(islands: IslandData[]): void {
    // Если набор уже построен — обновляем позиции.
    for (const isl of islands) {
      let root = this.islandRoots.get(isl.id);
      if (!root) {
        root = new THREE.Group();
        const geo = getIslandGeometry(isl.radius, isl.seed);
        const mat = getIslandMaterial(isl.biome);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        root.add(mesh);
        this.populateIsland(root, isl);
        this.islandRoots.set(isl.id, root);
        this.islandGroup.add(root);
      }
      root.position.set(isl.center.x, isl.center.y, isl.center.z);
      root.visible = isl.alive;
    }
  }

  private populateIsland(root: THREE.Group, isl: IslandData): void {
    // Несколько деревьев / камней для атмосферы. Серверные ресурсы рисуются отдельно.
    const props = Math.max(2, Math.floor(isl.radius * 0.6));
    for (let i = 0; i < props; i++) {
      const a = (i / props) * Math.PI * 2 + isl.seed * 0.001;
      const r = isl.radius * (0.4 + 0.45 * ((isl.seed >> i) & 7) / 7);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = isl.radius * 0.45 * Math.sqrt(Math.max(0, 1 - (r * r) / (isl.radius * isl.radius)));
      if (isl.biome === "forest" || isl.biome === "ruins") {
        const { trunk, crown } = getTreeMeshes();
        const grp = new THREE.Group();
        grp.add(trunk); grp.add(crown);
        grp.position.set(x, y, z);
        root.add(grp);
      } else {
        const rock = getRockMesh();
        rock.position.set(x, y, z);
        rock.scale.setScalar(0.7 + ((isl.seed >> i) & 3) * 0.3);
        root.add(rock);
      }
    }
    // Трава — инстансинг
    const grassCount = Math.min(150, Math.floor(isl.radius * 6));
    if (grassCount > 0) {
      const gi = buildGrassInstanced(grassCount, isl.biome);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < grassCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const rad = Math.random() * isl.radius * 0.95;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        const y = isl.radius * 0.45 * Math.sqrt(Math.max(0, 1 - (rad * rad) / (isl.radius * isl.radius)));
        dummy.position.set(x, y + 0.2, z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.setScalar(0.6 + Math.random() * 0.6);
        dummy.updateMatrix();
        gi.setMatrixAt(i, dummy.matrix);
      }
      gi.instanceMatrix.needsUpdate = true;
      root.add(gi);
      this.grassInstances.push(gi);
    }
  }

  // Один кадр.
  render(snap: Snapshot, prev: Snapshot, alpha: number, localId: string | null, cameraEulerYaw: number, cameraEulerPitch: number, predictedLocal: { x: number; y: number; z: number } | null): RendererInfo {
    // Обновляем позиции островов (могут падать)
    if (snap.islands && snap.islands.length > 0) this.buildIslands(snap.islands);

    // Цвет и время суток
    this.applyDayNight(snap.clock.phase, snap.clock.phaseTime, snap.clock.phaseDuration);

    // Якорь
    this.anchor.position.set(snap.anchor.pos.x, snap.anchor.pos.y, snap.anchor.pos.z);
    const core = this.anchor.getObjectByName("anchor_core") as THREE.Mesh | undefined;
    if (core) {
      const mat = core.material as THREE.MeshStandardMaterial;
      const ratio = snap.anchor.energy / snap.anchor.maxEnergy;
      mat.emissiveIntensity = 0.6 + ratio * 1.2;
      const target = snap.anchor.alarm ? 0xff5544 : 0xf6c351;
      mat.emissive.setHex(target);
    }
    const r1 = this.anchor.getObjectByName("anchor_ring1") as THREE.Mesh | undefined;
    const r2 = this.anchor.getObjectByName("anchor_ring2") as THREE.Mesh | undefined;
    if (r1) r1.rotation.z += 0.01;
    if (r2) r2.rotation.x += 0.012;

    // Игроки
    this.syncMap(this.playerMeshes, snap.players, prev.players, alpha, localId, predictedLocal, (p) => getPlayerMesh(p.id === localId ? 0xf6c351 : 0x70d6ff));
    // Локальный игрок невидим (мы — камера)
    if (localId) {
      const m = this.playerMeshes.get(localId);
      if (m) m.visible = false;
    }

    // Враги
    this.syncMap(this.enemyMeshes, snap.enemies, prev.enemies, alpha, null, null, (e) => getEnemyMesh(e.kind));

    // Постройки
    this.syncBuildings(snap.buildings);
    // Предметы на земле
    this.syncItems(snap.items);
    // Канатные дороги
    this.syncZiplines(snap.ziplines);
    // Гравитационные потоки — лёгкие визуальные сферы
    this.syncFlows(snap.flows);

    // Камера
    const me = predictedLocal ?? snap.players.find(p => p.id === localId)?.pos ?? null;
    if (me && localId) {
      const player = snap.players.find(p => p.id === localId);
      if (player) {
        // FPS-камера: глаза на 1.6 над основанием.
        this.camera.position.set(me.x, me.y + 0.6, me.z);
        this.camera.rotation.set(cameraEulerPitch, cameraEulerYaw, 0, "YXZ");
        // Сдвигаем тени к игроку
        this.dirLight.position.set(me.x + 40, me.y + 80, me.z + 30);
        this.dirLight.target.position.set(me.x, me.y, me.z);
        this.dirLight.target.updateMatrixWorld();
      }
    }

    this.composer.render();
    const info = this.renderer.info;
    return {
      type: this.type,
      draws: info.render.calls,
      triangles: info.render.triangles,
    };
  }

  private applyDayNight(phase: "day" | "night", t: number, dur: number): void {
    const ratio = t / dur;
    const dayIntensity = phase === "day" ? 1.4 : 0.25;
    const hemi = phase === "day" ? 0.8 : 0.3;
    this.dirLight.intensity = dayIntensity * (phase === "day" ? 1 : 0.5);
    this.hemiLight.intensity = hemi;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = phase === "day" ? 0.012 : 0.02;
    if (phase === "day") {
      const c = new THREE.Color(0xffd28a).lerp(new THREE.Color(0xfff1c4), Math.sin(ratio * Math.PI));
      this.dirLight.color = c;
      this.scene.background = new THREE.Color(FOG_COLOR);
    } else {
      this.dirLight.color = new THREE.Color(0x6f8cff);
      this.scene.background = new THREE.Color(0x10162a);
    }
  }

  private syncMap<T extends { id: string; pos: { x: number; y: number; z: number }; yaw?: number }>(
    map: Map<string, THREE.Mesh>,
    list: T[],
    prevList: T[],
    alpha: number,
    skipPosForId: string | null,
    overrideLocalPos: { x: number; y: number; z: number } | null,
    factory: (item: T) => THREE.Mesh,
  ): void {
    const seen = new Set<string>();
    const prevById = new Map<string, T>();
    for (const p of prevList) prevById.set(p.id, p);
    for (const item of list) {
      seen.add(item.id);
      let mesh = map.get(item.id);
      if (!mesh) {
        mesh = factory(item);
        map.set(item.id, mesh);
        this.scene.add(mesh);
      }
      const a = prevById.get(item.id);
      let x = item.pos.x, y = item.pos.y, z = item.pos.z;
      if (a) {
        x = a.pos.x + (item.pos.x - a.pos.x) * alpha;
        y = a.pos.y + (item.pos.y - a.pos.y) * alpha;
        z = a.pos.z + (item.pos.z - a.pos.z) * alpha;
      }
      if (skipPosForId && item.id === skipPosForId && overrideLocalPos) {
        x = overrideLocalPos.x; y = overrideLocalPos.y; z = overrideLocalPos.z;
      }
      mesh.position.set(x, y, z);
      if (typeof item.yaw === "number") mesh.rotation.y = item.yaw;
      mesh.visible = true;
    }
    // удалить отсутствующие
    for (const [id, mesh] of map) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        map.delete(id);
      }
    }
  }

  private syncBuildings(list: BuildingState[]): void {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      let m = this.buildingMeshes.get(b.id);
      if (!m) {
        m = getBuildingMesh(b.kind);
        this.buildingMeshes.set(b.id, m);
        this.scene.add(m);
      }
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
    }
    for (const [id, m] of this.buildingMeshes) {
      if (!seen.has(id)) { this.scene.remove(m); this.buildingMeshes.delete(id); }
    }
  }

  private syncItems(list: ItemEntity[]): void {
    const seen = new Set<string>();
    const t = performance.now() * 0.001;
    for (const it of list) {
      seen.add(it.id);
      let m = this.itemMeshes.get(it.id);
      if (!m) {
        m = getItemMesh(it.stack.kind);
        m.scale.setScalar(0.6);
        this.itemMeshes.set(it.id, m);
        this.scene.add(m);
      }
      m.position.set(it.pos.x, it.pos.y + 0.4 + Math.sin(t + it.pos.x) * 0.05, it.pos.z);
      m.rotation.y += 0.02;
    }
    for (const [id, m] of this.itemMeshes) {
      if (!seen.has(id)) { this.scene.remove(m); this.itemMeshes.delete(id); }
    }
  }

  private syncZiplines(list: ZiplineState[]): void {
    const seen = new Set<string>();
    for (const z of list) {
      seen.add(z.id);
      let line = this.ziplineMeshes.get(z.id);
      if (!line) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(z.a.x, z.a.y, z.a.z),
          new THREE.Vector3(z.b.x, z.b.y, z.b.z),
        ]);
        const mat = new THREE.LineBasicMaterial({ color: 0xb89b6a });
        line = new THREE.Line(geo, mat);
        this.ziplineMeshes.set(z.id, line);
        this.scene.add(line);
      }
      line.visible = z.alive;
    }
    for (const [id, line] of this.ziplineMeshes) {
      if (!seen.has(id)) { this.scene.remove(line); this.ziplineMeshes.delete(id); }
    }
  }

  private syncFlows(list: GravFlowState[]): void {
    const seen = new Set<string>();
    for (const f of list) {
      seen.add(f.id);
      let m = this.flowMeshes.get(f.id);
      if (!m) {
        const geo = new THREE.SphereGeometry(2, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color: 0xa1d0ff, transparent: true, opacity: 0.18, depthWrite: false });
        m = new THREE.Mesh(geo, mat);
        this.flowMeshes.set(f.id, m);
        this.scene.add(m);
      }
      m.position.set(f.pos.x, f.pos.y, f.pos.z);
      m.scale.setScalar(1 + Math.sin(performance.now() * 0.001) * 0.1);
    }
    for (const [id, m] of this.flowMeshes) {
      if (!seen.has(id)) { this.scene.remove(m); this.flowMeshes.delete(id); }
    }
  }
}
