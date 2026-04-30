// Ввод: клавиатура + мышь, pointer lock для FPS-камеры.
// Передача команд на сервер 20 раз/сек (через main).

export interface InputState {
  forward: number; // -1..1
  strafe: number;
  jump: boolean;
  sprint: boolean;
  glider: boolean;
  primary: boolean;
  secondary: boolean;
  interact: boolean;
  yaw: number;
  pitch: number;
  hotbar: number; // 0..4
  inventoryOpen: boolean;
  // edge-triggers — выставляются на 1 тик
  feedAnchor: boolean;
  expandAnchor: boolean;
  useStabilizer: boolean;
  buildPlace: boolean;
  hookshot: boolean;
}

export class Input {
  state: InputState = {
    forward: 0, strafe: 0,
    jump: false, sprint: false, glider: false,
    primary: false, secondary: false, interact: false,
    yaw: 0, pitch: 0, hotbar: 0, inventoryOpen: false,
    feedAnchor: false, expandAnchor: false, useStabilizer: false,
    buildPlace: false, hookshot: false,
  };
  private keys = new Set<string>();
  private canvas: HTMLElement;
  private locked = false;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.onKeyUp(e));
    canvas.addEventListener("click", () => this.lock());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.state.yaw -= e.movementX * 0.0022;
      this.state.pitch -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.05;
      if (this.state.pitch > lim) this.state.pitch = lim;
      if (this.state.pitch < -lim) this.state.pitch = -lim;
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.state.primary = true;
      if (e.button === 2) this.state.secondary = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.state.primary = false;
      if (e.button === 2) this.state.secondary = false;
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  lock(): void {
    if (this.locked) return;
    this.canvas.requestPointerLock?.();
  }

  isLocked(): boolean { return this.locked; }

  // Считывает edge-triggers и сбрасывает их.
  consumeEdges(): { feedAnchor: boolean; expandAnchor: boolean; useStabilizer: boolean; buildPlace: boolean; hookshot: boolean; interact: boolean; inventoryToggle: boolean } {
    const out = {
      feedAnchor: this.state.feedAnchor,
      expandAnchor: this.state.expandAnchor,
      useStabilizer: this.state.useStabilizer,
      buildPlace: this.state.buildPlace,
      hookshot: this.state.hookshot,
      interact: this.state.interact,
      inventoryToggle: false,
    };
    this.state.feedAnchor = false;
    this.state.expandAnchor = false;
    this.state.useStabilizer = false;
    this.state.buildPlace = false;
    this.state.hookshot = false;
    this.state.interact = false;
    return out;
  }

  private updateAxes(): void {
    let f = 0, s = 0;
    if (this.keys.has("KeyW")) f += 1;
    if (this.keys.has("KeyS")) f -= 1;
    if (this.keys.has("KeyA")) s -= 1;
    if (this.keys.has("KeyD")) s += 1;
    this.state.forward = f;
    this.state.strafe = s;
    this.state.jump = this.keys.has("Space");
    this.state.sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    this.state.glider = this.keys.has("KeyF");
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    this.keys.add(e.code);
    this.updateAxes();
    if (e.code === "KeyE") this.state.interact = true;
    if (e.code === "KeyQ") this.state.feedAnchor = true;
    if (e.code === "KeyR") this.state.expandAnchor = true;
    if (e.code === "KeyT") this.state.useStabilizer = true;
    if (e.code === "KeyB") this.state.buildPlace = true;
    if (e.code === "KeyG") this.state.hookshot = true;
    if (e.code === "Tab") { this.state.inventoryOpen = !this.state.inventoryOpen; e.preventDefault(); }
    for (let i = 0; i < 5; i++) {
      if (e.code === `Digit${i + 1}`) this.state.hotbar = i;
    }
  }
  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    this.updateAxes();
  }
}
