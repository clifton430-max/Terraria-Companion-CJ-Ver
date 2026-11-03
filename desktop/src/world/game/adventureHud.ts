// The interface while the waifus play their adventure: what they're working toward, what each of
// them is doing (click one to follow her), the bosses down so far, the town, the coins, an event
// or boss bar, the latest journal lines, the places they've found (click one to look there), a
// speed control and Stop.

import { CHARACTERS } from "../../characters/roster";
import { agentName, type Adventure } from "./adventure";
import { BOSS_IDS, BOSS_NAMES } from "./game";
import type { Location } from "./locations";
import { NPCS } from "./npcs";
import { TOWN } from "./town";

export const ADVENTURE_SPEEDS = [1, 2, 4, 8, 16] as const;

const EVENT_NAMES = { bloodMoon: "Blood Moon", goblins: "Goblin Army", slimeRain: "Slime Rain" } as const;

/** Copper coins as Terraria shows them: platinum, gold, silver, copper. */
export function coinText(c: number): string {
  const parts: string[] = [];
  const units: [number, string][] = [
    [1_000_000, "p"],
    [10_000, "g"],
    [100, "s"],
    [1, "c"],
  ];
  for (const [v, s] of units) {
    const n = Math.floor(c / v);
    c -= n * v;
    if (n) parts.push(`${n}${s}`);
  }
  return parts.slice(0, 2).join(" ") || "0c";
}

export interface AdventureHudHooks {
  stop: () => void;
  follow: (i: number) => void;
  following: () => number;
  speed: () => number;
  setSpeed: (s: number) => void;
  goto: (l: Location) => void;
}

export class AdventureHud {
  private readonly root: HTMLDivElement;
  private readonly focusEl: HTMLDivElement;
  private readonly barWrap: HTMLDivElement;
  private readonly barLabel: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly bosses: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly journal: HTMLDivElement;
  private readonly places: HTMLDivElement;
  private readonly speedRow: HTMLDivElement;
  private placesOpen = false;
  private shown = "";

  constructor(
    private readonly adv: Adventure,
    private readonly hooks: AdventureHudHooks,
  ) {
    const el = (cls: string, parent: HTMLElement) => {
      const d = document.createElement("div");
      d.className = cls;
      parent.append(d);
      return d;
    };
    this.root = document.createElement("div");
    this.root.className = "game-hud auto-hud";
    document.body.append(this.root);
    const card = el("auto-card adv-card", this.root);
    el("auto-title", card).textContent = "The team's adventure";
    this.focusEl = el("adv-focus", card);
    this.barWrap = el("adv-event", card);
    this.barLabel = el("adv-event-label", this.barWrap);
    const bar = el("auto-bar", this.barWrap);
    this.barFill = el("auto-fill adv-event-fill", bar);
    this.stats = el("auto-needs", card);
    this.bosses = el("adv-bosses", card);
    this.list = el("auto-list", card);
    this.journal = el("adv-journal", card);
    const placesBtn = document.createElement("button");
    placesBtn.type = "button";
    placesBtn.className = "auto-speed-btn adv-places-btn";
    placesBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.placesOpen = !this.placesOpen;
      this.shown = "";
      this.update();
    });
    card.append(placesBtn);
    this.places = el("adv-places", card);
    this.speedRow = el("auto-speed", card);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "game-leave";
    stop.textContent = "Stop playing";
    stop.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.stop();
    });
    this.root.append(stop);
    const hint = el("game-hint", this.root);
    hint.textContent = "They play on their own · click a name to follow her · Places to look around · ⌘-scroll or +/− to zoom · Esc stops";
    this.update();
  }

  update() {
    const a = this.adv;
    const g = a.game;
    const boss = g.bossAlive;
    const found = a.locations.filter((l) => l.discovered);
    const key = [
      a.focus,
      g.coins,
      a.residents.size,
      BOSS_IDS.map((b) => +g.bosses[b]).join(""),
      boss ? `${boss.kind}:${Math.round(boss.life / 10)}` : "",
      g.event ? `${g.event.kind}:${g.event.left}` : "",
      a.crew.agents.map((x) => `${a.status(x)}:${Math.round(x.life / 10)}:${x.maxLife}`).join(","),
      a.journal.length,
      a.journal[a.journal.length - 1] ?? "",
      found.length,
      found.map((l) => Math.round((l.progress ?? 0) * 100)).join(","),
      this.placesOpen,
      this.hooks.following(),
      this.hooks.speed(),
    ].join("|");
    if (key === this.shown) return;
    this.shown = key;
    this.focusEl.textContent = a.focus;
    // A boss fight or an event gets a bar.
    if (boss) {
      const d = NPCS[boss.kind];
      this.barWrap.hidden = false;
      this.barLabel.textContent = d.name;
      this.barFill.style.width = `${Math.max(0, Math.min(100, (boss.life / d.life) * 100))}%`;
      this.barFill.classList.add("boss");
    } else if (g.event) {
      this.barWrap.hidden = false;
      this.barLabel.textContent = EVENT_NAMES[g.event.kind];
      this.barFill.style.width = `${Math.max(0, Math.min(100, (g.event.left / Math.max(1, g.event.total)) * 100))}%`;
      this.barFill.classList.remove("boss");
    } else this.barWrap.hidden = true;
    const homes = [...a.residents.keys()].map((id) => TOWN[id]?.name ?? id);
    this.stats.textContent = `Coins ${coinText(g.coins)} · Day ${g.day + 1} · Town: ${homes.length ? homes.join(", ") : "nobody yet"}`;
    this.bosses.replaceChildren(
      ...BOSS_IDS.map((b) => {
        const s = document.createElement("span");
        s.className = `adv-boss${g.bosses[b] ? " down" : ""}`;
        s.textContent = BOSS_NAMES[b];
        s.title = g.bosses[b] ? `${BOSS_NAMES[b]}: defeated` : `${BOSS_NAMES[b]}: not yet`;
        return s;
      }),
    );
    this.list.replaceChildren(
      ...a.crew.agents.map((x, i) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `auto-who${i === this.hooks.following() ? " on" : ""}`;
        const life = x.dead > 0 ? "down" : `${Math.ceil(x.life)}/${x.maxLife}`;
        // A name you gave her; otherwise her roster name, as before.
        const name = x.name && x.name !== agentName(x.id) ? x.name : (CHARACTERS[x.id]?.name ?? x.id);
        row.textContent = `${name} (${life}): ${a.status(x)}`;
        row.title = "Follow her";
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          this.hooks.follow(i);
        });
        return row;
      }),
    );
    this.journal.replaceChildren(
      ...a.journal.slice(-4).map((line) => {
        const d = document.createElement("div");
        d.textContent = line;
        return d;
      }),
    );
    const placesBtn = this.root.querySelector<HTMLButtonElement>(".adv-places-btn");
    if (placesBtn) placesBtn.textContent = `${this.placesOpen ? "▾" : "▸"} Places (${found.length})`;
    this.places.hidden = !this.placesOpen;
    if (this.placesOpen)
      this.places.replaceChildren(
        ...found.map((l) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "auto-who adv-place";
          const pct = l.progress !== undefined && l.progress < 1 ? ` · ${Math.round(l.progress * 100)}%` : "";
          b.textContent = `${l.name}${pct}`;
          b.title = `${l.status} · look there`;
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            this.hooks.goto(l);
          });
          return b;
        }),
      );
    this.speedRow.replaceChildren(
      ...ADVENTURE_SPEEDS.map((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `auto-speed-btn${s === this.hooks.speed() ? " on" : ""}`;
        btn.textContent = `${s}×`;
        btn.title = `Speed ${s}×`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.hooks.setSpeed(s);
        });
        return btn;
      }),
    );
  }

  destroy() {
    this.root.remove();
  }
}
