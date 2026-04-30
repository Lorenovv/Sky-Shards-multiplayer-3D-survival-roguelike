// HUD: обновление полосок здоровья, голода, воздуха, лога событий, hotbar, статуса якоря.

import type { AnchorState, PlayerState, ServerEvent, ItemStack } from "@sky-shards/shared";

export class UI {
  private hpFill: HTMLElement;
  private hgFill: HTMLElement;
  private airFill: HTMLElement;
  private hpLabel: HTMLElement;
  private hgLabel: HTMLElement;
  private airLabel: HTMLElement;
  private hotbar: HTMLElement;
  private anchorStatus: HTMLElement;
  private logEl: HTMLElement;
  private stats: HTMLElement;
  private rendererInfo: HTMLElement;

  constructor() {
    this.hpFill = document.getElementById("hp-fill")!;
    this.hgFill = document.getElementById("hg-fill")!;
    this.airFill = document.getElementById("air-fill")!;
    this.hpLabel = document.getElementById("hp-label")!;
    this.hgLabel = document.getElementById("hg-label")!;
    this.airLabel = document.getElementById("air-label")!;
    this.hotbar = document.getElementById("hotbar")!;
    this.anchorStatus = document.getElementById("anchor-status")!;
    this.logEl = document.getElementById("log")!;
    this.stats = document.getElementById("stats")!;
    this.rendererInfo = document.getElementById("renderer-info")!;
  }

  showHud(): void {
    document.getElementById("overlay")!.removeAttribute("hidden");
    document.getElementById("login")!.style.display = "none";
  }

  setStats(text: string): void { this.stats.textContent = text; }
  setRendererInfo(text: string): void { this.rendererInfo.textContent = text; }

  updatePlayer(p: PlayerState): void {
    const pct = (n: number, m: number) => `${Math.max(0, Math.min(100, (n / m) * 100)).toFixed(0)}%`;
    this.hpFill.style.width = pct(p.hp, p.maxHp);
    this.hgFill.style.width = pct(p.hunger, 100);
    this.airFill.style.width = pct(p.air, 100);
    this.hpLabel.textContent = `HP ${Math.round(p.hp)}/${p.maxHp}`;
    this.hgLabel.textContent = `Голод ${Math.round(p.hunger)}`;
    this.airLabel.textContent = `Воздух ${Math.round(p.air)}`;
  }

  updateHotbar(slots: (ItemStack | null)[], selected: number): void {
    while (this.hotbar.children.length < 5) {
      const d = document.createElement("div");
      d.className = "slot";
      this.hotbar.appendChild(d);
    }
    for (let i = 0; i < 5; i++) {
      const el = this.hotbar.children[i] as HTMLElement;
      const s = slots[i];
      el.classList.toggle("selected", i === selected);
      el.innerHTML = "";
      if (s) {
        const name = document.createElement("span");
        name.textContent = ITEM_NAMES[s.kind] ?? s.kind;
        const cnt = document.createElement("span");
        cnt.className = "count";
        cnt.textContent = String(s.count);
        el.appendChild(name);
        el.appendChild(cnt);
      } else {
        el.textContent = String(i + 1);
        el.style.color = "#5a6788";
      }
    }
  }

  updateAnchor(a: AnchorState): void {
    const ratio = a.energy / a.maxEnergy;
    const pct = (ratio * 100).toFixed(0);
    this.anchorStatus.classList.toggle("alarm", a.alarm);
    let text = `Якорь: ${pct}% • Радиус ${a.radius.toFixed(0)}м • Лоток ${a.trayCount}/5`;
    if (a.expanded) text += " • Расширен";
    if (a.countdownToFall > 0) text += ` • ПАДЕНИЕ ЧЕРЕЗ ${Math.ceil(a.countdownToFall)}с`;
    this.anchorStatus.textContent = text;
  }

  pushEvent(ev: ServerEvent): void {
    const el = document.createElement("div");
    el.className = "ev";
    el.textContent = describeEvent(ev);
    this.logEl.prepend(el);
    setTimeout(() => el.remove(), 8000);
  }

  pushChat(from: string, text: string): void {
    const el = document.createElement("div");
    el.className = "ev";
    el.style.color = "#9adfff";
    el.textContent = `[${from}] ${text}`;
    this.logEl.prepend(el);
    setTimeout(() => el.remove(), 12000);
  }
}

const ITEM_NAMES: Record<string, string> = {
  wood: "Дерево", stone: "Камень", iron: "Железо", gold: "Золото",
  crystal: "Кристалл", air: "Воздух", meat: "Мясо", artifact: "Артефакт",
  rope: "Верёвка", metal: "Металл", cloth: "Ткань",
  axe_wood: "Топор", pickaxe_stone: "Кирка", sword_iron: "Меч",
  glider: "Планер", hookshot: "Крюк", workbench: "Верстак", furnace: "Печь",
  turret: "Турель", zipline_kit: "Канатка", stabilizer: "Стабилизатор",
  block_wood: "Блок дерева", block_stone: "Блок камня", block_metal: "Блок металла",
  drone: "Дрон", fist: "Кулак",
};

function describeEvent(ev: ServerEvent): string {
  switch (ev.kind) {
    case "player_joined": return `${ev.name} подключился`;
    case "player_left": return `Игрок отключился`;
    case "player_died": return `Игрок погиб (${ev.cause})`;
    case "anchor_critical": return `ВНИМАНИЕ: Якорь в критическом состоянии`;
    case "anchor_recovered": return `Якорь стабилизирован`;
    case "game_over": return `КОНЕЦ ИГРЫ — ${ev.reason}`;
    case "wave_started": return `Ночь ${ev.index + 1}: волна (${ev.count} врагов)`;
    case "wave_ended": return `Волна отбита`;
    case "storm_started": return `НАЧАЛСЯ ШТОРМ`;
    case "storm_ended": return `Шторм утих`;
    case "boss_spawned": return `Появился босс: ${ev.boss}`;
    case "log": return ev.text;
  }
}
