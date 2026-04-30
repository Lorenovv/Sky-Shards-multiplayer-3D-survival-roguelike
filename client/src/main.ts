// Точка входа клиента: логин-экран → подключение к серверу → основной цикл.

import { Network } from "./network.js";
import { Input } from "./input.js";
import { GameRenderer } from "./renderer.js";
import { UI } from "./ui.js";
import { TICK_DT } from "@sky-shards/shared";

const SERVER_URL = (() => {
  // Vite proxy на /socket.io в dev, прямое подключение в проде.
  if (import.meta.env.DEV) return location.origin;
  return location.origin;
})();

const renderer = new GameRenderer();
const ui = new UI();
const input = new Input(renderer.canvas);
const net = new Network(SERVER_URL);

const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const nameInput = document.getElementById("name-input") as HTMLInputElement;
const stored = localStorage.getItem("sky_name");
if (stored) nameInput.value = stored;

playBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim() || "Сталкер";
  localStorage.setItem("sky_name", name);
  playBtn.disabled = true;
  playBtn.textContent = "Подключение…";
  try {
    await net.connect(name);
    ui.showHud();
    input.enableGameInput();
    input.lock();
    startGameLoop();
  } catch (err) {
    console.error(err);
    playBtn.disabled = false;
    playBtn.textContent = "Повторить";
  }
});

net.onEvent((ev) => ui.pushEvent(ev));

// Простейшая локальная предсказательная модель: имитируем движение
// по той же формуле что и сервер, чтобы скрыть RTT.
const PLAYER_INIT_SPEED = 6.0;
const SPRINT_MULT = 1.6;

interface LocalPredict {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  groundY: number | null;
}
const predict: LocalPredict = { pos: { x: 0, y: 70, z: 0 }, vel: { x: 0, y: 0, z: 0 }, groundY: null };
let predictReady = false;

function sendInputThisFrame(): void {
  const s = input.state;
  const cmd = {
    dt: TICK_DT,
    forward: s.forward,
    strafe: s.strafe,
    yaw: s.yaw,
    pitch: s.pitch,
    jump: s.jump,
    sprint: s.sprint,
    glider: s.glider,
    primary: s.primary,
    secondary: s.secondary,
    interact: s.interact,
  };
  net.sendInput(cmd);

  // Отправляем edge-команды по нажатию.
  const e = input.consumeEdges();
  if (e.feedAnchor) net.send("feedAnchor");
  if (e.expandAnchor) net.send("expandAnchor");
  if (e.useStabilizer) net.send("useStabilizer");
  if (e.hookshot) {
    const dir = { x: -Math.sin(s.yaw) * Math.cos(s.pitch), y: Math.sin(s.pitch), z: -Math.cos(s.yaw) * Math.cos(s.pitch) };
    net.send("hookshot", { dir });
  }
  if (e.buildPlace) {
    // Размещаем перед игроком, в 2 единицах.
    if (predictReady) {
      const ahead = { x: predict.pos.x - Math.sin(s.yaw) * 2, y: predict.pos.y, z: predict.pos.z - Math.cos(s.yaw) * 2 };
      net.send("build", { kind: "block_wood", pos: ahead });
    }
  }

  // Hotbar выбор
  net.send("hotbarSelect", s.hotbar);
}

function clientPredict(dt: number): void {
  if (!predictReady) return;
  const s = input.state;
  let speed = PLAYER_INIT_SPEED;
  if (s.sprint) speed *= SPRINT_MULT;
  const cosY = Math.cos(s.yaw), sinY = Math.sin(s.yaw);
  const fx = -sinY * s.forward, fz = -cosY * s.forward;
  const sx = cosY * s.strafe, sz = -sinY * s.strafe;
  predict.vel.x = (fx + sx) * speed;
  predict.vel.z = (fz + sz) * speed;
  predict.vel.y -= 20 * dt;
  if (predict.vel.y < -30) predict.vel.y = -30;
  predict.pos.x += predict.vel.x * dt;
  predict.pos.y += predict.vel.y * dt;
  predict.pos.z += predict.vel.z * dt;
}

function reconcile(): void {
  const local = net.getLocalPlayer();
  if (!local) return;
  if (!predictReady) {
    predict.pos = { ...local.pos };
    predict.vel = { ...local.vel };
    predictReady = true;
    return;
  }
  // Если расхождение слишком большое — корректируемся.
  const dx = local.pos.x - predict.pos.x;
  const dy = local.pos.y - predict.pos.y;
  const dz = local.pos.z - predict.pos.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 4) {
    predict.pos = { ...local.pos };
    predict.vel = { ...local.vel };
  } else {
    // Плавное смешивание
    predict.pos.x += dx * 0.3;
    predict.pos.y += dy * 0.3;
    predict.pos.z += dz * 0.3;
  }
}

let lastFrame = performance.now();
let tickAccumulator = 0;
let frames = 0;
let fpsTimer = 0;
let fps = 0;

function startGameLoop(): void {
  function frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    frames++; fpsTimer += dt;
    if (fpsTimer >= 0.5) { fps = frames / fpsTimer; frames = 0; fpsTimer = 0; }

    clientPredict(dt);
    reconcile();

    // 20 Гц вход
    tickAccumulator += dt;
    while (tickAccumulator >= TICK_DT) {
      tickAccumulator -= TICK_DT;
      sendInputThisFrame();
    }

    const interp = net.getInterpolatedSnapshot();
    if (interp) {
      const info = renderer.render(
        interp.snap,
        interp.prev,
        interp.alpha,
        net.getLocalId(),
        input.state.yaw,
        input.state.pitch,
        predictReady ? predict.pos : null,
      );
      // HUD
      const local = net.getLocalPlayer();
      if (local) ui.updatePlayer(local);
      ui.updateAnchor(interp.snap.anchor);
      if (local) ui.updateHotbar(local.inventory.hotbar, local.inventory.selectedHotbar);
      const triK = (info.triangles / 1000).toFixed(0);
      ui.setStats(`FPS ${fps.toFixed(0)} • Draws ${info.draws} • Tri ${triK}K`);
      ui.setRendererInfo(`${info.type.toUpperCase()} • seed=${net.getSeed()}`);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
