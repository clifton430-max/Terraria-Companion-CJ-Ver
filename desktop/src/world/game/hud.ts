// The in-game interface, Terraria-style, using the real UI art from the local install
// (Inventory_Back slots, the Heart): hotbar and held-item name, life hearts, inventory with
// armour slots and crafting (only what the nearby stations and your items allow), chests, item
// tooltips, the item on the cursor, messages, the boss bar and a short controls hint.

import { textureUrl } from "../../assets/textures";
import type { Game } from "./game";
import { clickSlot, craftable, HOTBAR, INVENTORY_SIZE, RECIPES, craft, type Recipe, type Slot, type Station } from "./inventory";

export const STATION_NAMES: Record<Station, string> = {
  workbench: "Work Bench",
  furnace: "Furnace",
  anvil: "Anvil",
  sawmill: "Sawmill",
  loom: "Loom",
  hellforge: "Hellforge",
  tinkerer: "Tinkerer's Workshop",
  bottle: "Placed Bottle",
  keg: "Keg",
  cookingpot: "Cooking Pot",
  altar: "Demon Altar",
  bookcase: "Bookcase",
};
import { item, itemTexture } from "./items";
import { NPCS } from "./npcs";
import { TILE } from "./physics";

const ARMOR_LABELS = ["Helmet", "Shirt", "Pants"];

export class GameHud {
  private readonly root: HTMLDivElement;
  private readonly hotbar: HTMLDivElement;
  private readonly heldName: HTMLDivElement;
  private readonly life: HTMLDivElement;
  private readonly lifeText: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly messages: HTMLDivElement;
  private readonly boss: HTMLDivElement;
  private readonly bossFill: HTMLDivElement;
  private readonly bossName: HTMLDivElement;
  private readonly cursorEl: HTMLImageElement;
  private readonly tip: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private shownKey = "";
  private lifeKey = "";
  private msgKey = "";
  private mouse = { x: 0, y: 0 };

  constructor(
    private readonly game: Game,
    private readonly hooks: { leave: () => void; stationsNear: () => Set<Station> },
  ) {
    const el = (cls: string, parent: HTMLElement = this.root) => {
      const d = document.createElement("div");
      d.className = cls;
      parent.append(d);
      return d;
    };
    this.root = document.createElement("div");
    this.root.className = "game-hud";
    document.body.append(this.root);
    const top = el("game-top");
    this.heldName = el("game-held", top);
    this.hotbar = el("game-hotbar", top);
    this.panel = el("game-panel", top);
    const right = el("game-right");
    this.life = el("game-hearts", right);
    this.lifeText = el("game-life-text", right);
    this.clockEl = el("game-clock", right);
    this.messages = el("game-messages");
    this.boss = el("game-boss");
    this.bossName = el("game-boss-name", this.boss);
    const bar = el("game-boss-bar", this.boss);
    this.bossFill = el("game-boss-fill", bar);
    const hint = el("game-hint");
    hint.textContent = "A/D move · Space jump · S drop · Click use · Right-click chests · Esc inventory · H heal · 1–0 / wheel items";
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "game-leave";
    leave.textContent = "Leave game";
    leave.title = "Back to the desktop";
    leave.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.leave();
    });
    this.root.append(leave);
    this.cursorEl = document.createElement("img");
    this.cursorEl.className = "game-cursor-item";
    this.cursorEl.hidden = true;
    this.root.append(this.cursorEl);
    this.tip = el("game-tip");
    this.tip.hidden = true;
    this.root.addEventListener("pointermove", (e) => this.setMouse(e.clientX, e.clientY));
  }

  setMouse(x: number, y: number) {
    this.mouse = { x, y };
    if (!this.cursorEl.hidden) Object.assign(this.cursorEl.style, { left: `${x + 8}px`, top: `${y + 8}px` });
    if (!this.tip.hidden) Object.assign(this.tip.style, { left: `${x + 16}px`, top: `${y + 16}px` });
  }

  /** Is the pointer over the HUD (so clicks there don't swing a pickaxe)? */
  contains(target: EventTarget | null) {
    return target instanceof Node && this.root.contains(target) && target !== this.root;
  }

  private slotEl(s: Slot, opts: { selected?: boolean; label?: string; onClick?: (e: MouseEvent) => void; placeholder?: string } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `game-slot${opts.selected ? " selected" : ""}`;
    b.style.backgroundImage = `url("${textureUrl(opts.selected ? "Images/Inventory_Back14" : "Images/Inventory_Back")}")`;
    if (opts.label) {
      const n = document.createElement("span");
      n.className = "game-slot-key";
      n.textContent = opts.label;
      b.append(n);
    }
    if (s) {
      const img = document.createElement("img");
      img.src = textureUrl(itemTexture(s.id));
      img.alt = item(s.id)?.name ?? "";
      b.append(img);
      if (s.count > 1) {
        const c = document.createElement("span");
        c.className = "game-slot-count";
        c.textContent = String(s.count);
        b.append(c);
      }
      b.addEventListener("pointerenter", () => this.showTip(s.id));
      b.addEventListener("pointerleave", () => this.hideTip());
    } else if (opts.placeholder) {
      const p = document.createElement("span");
      p.className = "game-slot-placeholder";
      p.textContent = opts.placeholder;
      b.append(p);
    }
    if (opts.onClick) {
      b.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      b.addEventListener("mouseup", (e) => {
        e.stopPropagation();
        opts.onClick!(e);
      });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    return b;
  }

  private showTip(id: number, extra = "") {
    const d = item(id);
    if (!d) return;
    const lines = [d.name];
    if (d.damage && d.kind !== "pickaxe" && d.kind !== "axe") lines.push(`${d.damage} damage`);
    if (d.kind === "pickaxe") lines.push(`${d.power}% pickaxe power`, `${d.damage} damage`);
    if (d.kind === "axe") lines.push(`${d.power}% axe power`);
    if (d.defense) lines.push(`${d.defense} defense`);
    if (d.heal) lines.push(`Restores ${d.heal} life`);
    if (d.kind === "block") lines.push("Can be placed");
    if (d.kind === "material") lines.push("Material");
    if (d.tooltip) lines.push(d.tooltip);
    if (extra) lines.push(extra);
    this.tip.textContent = lines.join("\n");
    this.tip.hidden = false;
    this.setMouse(this.mouse.x, this.mouse.y);
  }

  private hideTip() {
    this.tip.hidden = true;
  }

  private clickInventory(i: number, e: MouseEvent) {
    const g = this.game;
    if (e.shiftKey && g.chest) g.quickMove(false, i);
    else g.cursor = clickSlot(g.inventory, i, g.cursor, e.button === 2);
    g.version++;
  }

  private clickChest(i: number, e: MouseEvent) {
    const g = this.game;
    const items = g.chest?.items;
    if (!items) return;
    if (e.shiftKey) g.quickMove(true, i);
    else g.cursor = clickSlot(items, i, g.cursor, e.button === 2);
    g.version++;
    g.worldVersion++;
  }

  private clickRecipe(r: Recipe) {
    const g = this.game;
    const res = craft(g.inventory, r, this.hooks.stationsNear(), g.cursor);
    if (res.ok) {
      g.cursor = res.cursor;
      g.version++;
    }
  }

  /** Refresh (cheap when nothing changed). */
  update() {
    const g = this.game;
    const stations = g.inventoryOpen ? this.hooks.stationsNear() : new Set<string>();
    const key = `${g.version}|${g.selected}|${g.inventoryOpen}|${!!g.chest}|${[...stations].sort().join()}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.renderSlots(stations as Set<Station>);
    }
    // Life hearts (20 life per heart).
    const p = g.player;
    const lk = `${Math.ceil(p.life)}/${p.maxLife}`;
    if (lk !== this.lifeKey) {
      this.lifeKey = lk;
      this.lifeText.textContent = `Life: ${lk}`;
      this.life.replaceChildren(
        ...Array.from({ length: p.maxLife / 20 }, (_, i) => {
          const h = document.createElement("img");
          h.src = textureUrl("Images/Heart");
          h.alt = "";
          const fill = Math.max(0, Math.min(1, (p.life - i * 20) / 20));
          h.style.opacity = String(0.25 + fill * 0.75);
          h.style.transform = `scale(${0.6 + fill * 0.4})`;
          return h;
        }),
      );
    }
    const hh = Math.floor(g.hour);
    const mm = Math.floor((g.hour - hh) * 60);
    this.clockEl.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}${p.dead > 0 ? ` · Respawning in ${Math.ceil(p.dead)}…` : ""}`;
    // Messages.
    const mk = g.messages.map((m) => m.text).join("|");
    if (mk !== this.msgKey) {
      this.msgKey = mk;
      this.messages.replaceChildren(
        ...g.messages.map((m) => {
          const d = document.createElement("div");
          d.textContent = m.text;
          return d;
        }),
      );
    }
    // Boss bar.
    const b = g.bossAlive;
    this.boss.hidden = !b;
    if (b) {
      this.bossName.textContent = NPCS[b.kind].name;
      this.bossFill.style.width = `${Math.max(0, (b.life / NPCS[b.kind].life) * 100)}%`;
    }
    // Cursor item.
    if (g.cursor) {
      const src = textureUrl(itemTexture(g.cursor.id));
      if (this.cursorEl.getAttribute("src") !== src) this.cursorEl.src = src;
      this.cursorEl.hidden = false;
      this.setMouse(this.mouse.x, this.mouse.y);
    } else this.cursorEl.hidden = true;
  }

  private renderSlots(stations: Set<Station>) {
    const g = this.game;
    const held = g.held;
    this.heldName.textContent = held ? held.name : "";
    this.hotbar.replaceChildren(
      ...g.inventory.slice(0, HOTBAR).map((s, i) =>
        this.slotEl(s, {
          selected: i === g.selected,
          label: String((i + 1) % 10),
          onClick: (e) => (g.inventoryOpen ? this.clickInventory(i, e) : ((g.selected = i), g.version++)),
        }),
      ),
    );
    this.panel.replaceChildren();
    this.panel.hidden = !g.inventoryOpen;
    if (!g.inventoryOpen) {
      this.hideTip();
      return;
    }
    const grid = document.createElement("div");
    grid.className = "game-grid";
    for (let i = HOTBAR; i < INVENTORY_SIZE; i++) grid.append(this.slotEl(g.inventory[i], { onClick: (e) => this.clickInventory(i, e) }));
    const armor = document.createElement("div");
    armor.className = "game-armor";
    const def = document.createElement("div");
    def.className = "game-defense";
    def.textContent = `${g.defense} Defense`;
    armor.append(def, ...g.armor.map((s, i) => this.slotEl(s, { placeholder: ARMOR_LABELS[i], onClick: () => g.equipFromCursor(i) })));
    const row = document.createElement("div");
    row.className = "game-panel-row";
    row.append(grid, armor);
    this.panel.append(row);
    if (g.chest?.items) {
      const title = document.createElement("div");
      title.className = "game-section";
      title.textContent = "Chest (shift-click moves a stack)";
      const chest = document.createElement("div");
      chest.className = "game-grid";
      g.chest.items.forEach((s, i) => chest.append(this.slotEl(s, { onClick: (e) => this.clickChest(i, e) })));
      this.panel.append(title, chest);
    }
    // Crafting: what you can make here and now.
    const can = craftable(g.inventory, stations);
    const title = document.createElement("div");
    title.className = "game-section";
    const near = [...stations].map((s) => STATION_NAMES[s]).join(", ");
    title.textContent = `Crafting${near ? ` (near ${near})` : ""}${can.length ? "" : ": nothing yet. Gather wood, ore and gel"}`;
    const list = document.createElement("div");
    list.className = "game-crafts";
    for (const r of can) {
      const b = this.slotEl({ id: r.result, count: r.count }, { onClick: () => this.clickRecipe(r) });
      b.addEventListener("pointerenter", () => this.showTip(r.result, `Needs: ${r.ingredients.map(([id, n]) => `${n} ${item(id)?.name}`).join(", ")}${r.station ? ` · at a ${STATION_NAMES[r.station]}` : ""}`));
      list.append(b);
    }
    this.panel.append(title, list);
    // A hint about what's next.
    const missing = RECIPES.filter((r) => r.station && !stations.has(r.station)).length;
    if (missing && !stations.size) {
      const p = document.createElement("div");
      p.className = "game-note";
      p.textContent = "Craft a Work Bench (10 Wood) and place it to unlock more recipes.";
      this.panel.append(p);
    }
    void TILE;
  }

  destroy() {
    this.root.remove();
  }
}
