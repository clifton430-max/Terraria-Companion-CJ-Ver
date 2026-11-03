// The waifus' Terraria playthrough: a director that decides what the crew works on, in the order a
// Terraria player would. Build a first house; build town houses as town NPCs become willing to
// move in (and meet the ones waiting at settlements); keep torches, potions and arrows stocked;
// climb the gear ladder (iron, gold, demonite, jungle, molten); collect life crystals; explore
// every biome and structure (looting chests); take on the bosses in order once prepared (King
// Slime, the Eye, the Eater of Worlds, the Queen Bee, Skeletron, the Wall of Flesh); and, as the
// long-term goal, build a big themed luxury house in every biome (with the hellevator and sky
// ladders it takes to get there). Everything is saved; buildings live in the world itself.

import type { CharacterId } from "../../bridge";
import { BIOME_NAMES, HELL_TOP, jungleSideX, mushroomFields, snowSideX } from "../gen";
import { Crew, makeAgent, projectProgress, type Agent, type Goal } from "./builder";
import { BOSS_NAMES, type BossId, type Game } from "./game";
import { COMPACT_SPAN, ESTATE_SPAN, estateSite } from "./estate";
import { arena, chooseFlat, fromParams, ladder, luxuryHouse, npcHouse, shaft, starterHouse, type Project, type ProjectParams } from "./house";
import { addItem, countOf, emptySlots, INVENTORY_SIZE, sanitizeSlots, type Slot } from "./inventory";
import { item as itemDef, ITEMS } from "./items";
import { restoreLocations, saveLocations, worldLocations, type Location } from "./locations";
import { NPCS } from "./npcs";
import { OBJECTS } from "./objects";
import { TILE } from "./physics";
import { makeTownNpc, roomAt, stepTownNpc, TOWN, TOWN_IDS, type TownId, type TownNpc } from "./town";

const THINK_EVERY = 2;

interface Gear {
  item: number;
  count: number;
  why: string;
  when: (a: Adventure) => boolean;
  /** Stock is topped up once it falls below this (default: as soon as it's short). */
  low?: number;
}

const always = () => true;
const after = (b: BossId) => (a: Adventure) => a.game.bosses[b];

/** What the team keeps stocked and works up to, in order of importance. */
const GEAR: Gear[] = [
  { item: 8, count: 30, why: "torches for light", when: always, low: 10 },
  { item: 28, count: 6, why: "healing potions", when: always, low: 3 },
  { item: 39, count: 1, why: "a bow", when: always },
  { item: 40, count: 150, why: "arrows", when: always, low: 60 },
  { item: 1, count: 1, why: "an iron pickaxe", when: always },
  { item: 4, count: 1, why: "an iron sword", when: always },
  { item: 90, count: 1, why: "iron armour", when: always },
  { item: 81, count: 1, why: "iron armour", when: always },
  { item: 77, count: 1, why: "iron armour", when: always },
  { item: 3521, count: 1, why: "a gold pickaxe", when: (a) => a.game.bosses.kingSlime },
  { item: 3520, count: 1, why: "a gold sword", when: (a) => a.game.bosses.kingSlime },
  { item: 3516, count: 1, why: "a gold bow", when: (a) => a.game.bosses.kingSlime },
  { item: 92, count: 1, why: "gold armour", when: (a) => a.game.bosses.kingSlime },
  { item: 83, count: 1, why: "gold armour", when: (a) => a.game.bosses.kingSlime },
  { item: 79, count: 1, why: "gold armour", when: (a) => a.game.bosses.kingSlime },
  { item: 103, count: 1, why: "a Nightmare Pickaxe", when: after("eater") },
  { item: 46, count: 1, why: "Light's Bane", when: after("eater") },
  { item: 44, count: 1, why: "a Demon Bow", when: after("eater") },
  { item: 102, count: 1, why: "shadow armour", when: after("eater") },
  { item: 101, count: 1, why: "shadow armour", when: after("eater") },
  { item: 100, count: 1, why: "shadow armour", when: after("eater") },
  { item: 188, count: 10, why: "healing potions", when: after("eye"), low: 4 },
  { item: 228, count: 1, why: "jungle armour", when: after("queenBee") },
  { item: 229, count: 1, why: "jungle armour", when: after("queenBee") },
  { item: 230, count: 1, why: "jungle armour", when: after("queenBee") },
  { item: 288, count: 4, why: "obsidian skin potions", when: after("skeletron") },
  { item: 122, count: 1, why: "a Molten Pickaxe", when: after("skeletron") },
  { item: 231, count: 1, why: "molten armour", when: after("skeletron") },
  { item: 232, count: 1, why: "molten armour", when: after("skeletron") },
  { item: 233, count: 1, why: "molten armour", when: after("skeletron") },
  { item: 121, count: 1, why: "a Fiery Greatsword", when: after("skeletron") },
];

interface BossPlan {
  boss: BossId;
  /** Summoning item, or how it's woken. */
  item?: number;
  via?: "orbs" | "larva" | "oldman";
  life: number;
  def: number;
  night?: boolean;
  where: "arena" | "corruption" | "hive" | "dungeon" | "underworld";
}

const BOSSES: BossPlan[] = [
  { boss: "kingSlime", item: 560, life: 140, def: 6, where: "arena" },
  { boss: "eye", item: 43, life: 180, def: 8, night: true, where: "arena" },
  { boss: "eater", via: "orbs", life: 220, def: 12, where: "corruption" },
  { boss: "queenBee", via: "larva", life: 260, def: 14, where: "hive" },
  { boss: "skeletron", via: "oldman", life: 300, def: 16, night: true, where: "dungeon" },
  { boss: "wall", item: 267, life: 340, def: 20, where: "underworld" },
];

/** Luxury houses, in the order they're taken on (and what has to come first). */
const LUXURY: { biome: string; when: (a: Adventure) => boolean }[] = [
  { biome: "forest", when: (a) => a.residents.size >= 2 },
  { biome: "ocean", when: after("kingSlime") },
  { biome: "desert", when: after("eye") },
  { biome: "snow", when: after("eye") },
  { biome: "jungle", when: after("eater") },
  { biome: "corruption", when: after("eater") },
  { biome: "crimson", when: after("eater") },
  { biome: "hallow", when: after("eater") },
  { biome: "mushroom", when: after("queenBee") },
  { biome: "sky", when: after("skeletron") },
  { biome: "underworld", when: after("wall") },
];

export interface AdventureSave {
  v: 1;
  home: { x: number; y: number };
  projects: ProjectParams[];
  residents: [TownId, { x: number; y: number }][];
  met: TownId[];
  locations: unknown;
  life: Record<string, number>;
  /** The rest of the team's bags (beyond the 50 slots everyone shares with player mode). */
  bags?: Slot[];
  /** Trees they failed to chop and are leaving alone for now. */
  treeMarks?: unknown;
  scaffold?: unknown;
}

/** Four girls, four bags: the team carries this many slots beyond the shared inventory. */
export const BAG_SLOTS = 150;

export class Adventure {
  readonly crew: Crew;
  readonly town: TownNpc[] = [];
  /** Who lives in town: their room (a tile inside it). */
  readonly residents = new Map<TownId, { x: number; y: number }>();
  readonly met = new Set<TownId>();
  locations: Location[];
  /** The current focus, for the HUD. */
  focus = "Getting started";
  private thinkT = 0;
  private home: { x: number; y: number };
  private moveInT = 0;
  /** Things that happened (the HUD's journal). */
  journal: string[] = [];
  private bossSeen: unknown = null;
  private bossSince = 0;

  constructor(
    readonly game: Game,
    ids: CharacterId[],
  ) {
    const map = game.map;
    const save = (game.adventureSave ?? null) as Partial<AdventureSave> | null;
    const sp = game.spawnPoint();
    const agents: Agent[] = ids.map((id, i) => makeAgent(id, sp.x + i * 24, sp.y));
    for (const a of agents) a.name = agentName(a.id);
    // The extra bags go after the shared inventory while the adventure runs (`detach` takes them off).
    const shared = game.inventory.slice(0, INVENTORY_SIZE);
    while (shared.length < INVENTORY_SIZE) shared.push(null);
    game.inventory = [...shared, ...(save?.v === 1 ? sanitizeSlots(save.bags, BAG_SLOTS) : emptySlots(BAG_SLOTS))];
    this.crew = new Crew(game, agents);
    game.agents = agents;
    game.mode = "auto";
    this.locations = worldLocations(map);
    // Restore, or found the home: the starter house near the spawn.
    if (save?.v === 1 && save.home) {
      this.home = save.home;
      for (const p of save.projects ?? []) {
        try {
          this.crew.addProject(fromParams(map, p));
        } catch {
          // a bad entry: skip it
        }
      }
      for (const [id, room] of save.residents ?? []) if (TOWN[id]) this.residents.set(id, room);
      for (const id of save.met ?? []) if (TOWN[id]) this.met.add(id);
      restoreLocations(this.locations, save.locations);
      this.crew.loadTreeMarks(save.treeMarks);
      this.crew.loadScaffold(save.scaffold);
      for (const a of agents) {
        const ml = save.life?.[a.id];
        if (typeof ml === "number") a.maxLife = a.life = Math.max(100, Math.min(400, Math.round(ml / 20) * 20));
      }
    } else {
      // Keep building the house from before (the first version), or choose a site.
      const site = game.house ?? chooseFlat(map, Math.floor(sp.x / TILE) + 8, Math.floor(sp.x / TILE) + 160, 16);
      game.house = { x0: site.x0, g: site.g };
      this.crew.addProject(starterHouse(map, site.x0, site.g));
      this.home = { x: (site.x0 - 2) * TILE + TILE / 2, y: site.g * TILE };
    }
    for (const a of agents) {
      a.home = { ...this.home };
      a.x = this.home.x - a.w / 2 + agents.indexOf(a) * 20;
      a.y = this.home.y - a.h - 1;
    }
    this.crew.shop = (id) => this.shopFor(id);
    // Trees they chop to build don't grow back inside what they built.
    game.keepCut = (col) => [...this.crew.projects.values()].some((p) => p.kind !== "shaft" && p.kind !== "ladder" && col >= p.x0 - 1 && col <= p.x1 + 1);
    this.crew.npcAt = (id) => {
      const n = this.town.find((t) => t.id === id && !t.waiting);
      return n ? { x: n.x + n.w / 2, y: n.y + n.h } : null;
    };
    // Town NPCs at home, and the ones waiting out in the world.
    for (const [id, room] of this.residents) this.town.push(this.spawnResident(id, room));
    for (const s of map.structures)
      for (const w of s.npcs) {
        const id = w.id as TownId;
        if (!TOWN[id] || this.residents.has(id)) continue;
        const n = makeTownNpc(id, w.x * TILE + 8, w.y * TILE, true);
        this.town.push(n);
      }
    game.onSmash = (o) => this.note(o.t === "orb" ? "A shadow orb shattered!" : o.t === "larva" ? "The larva burst... the Queen Bee is coming!" : "");
    game.onKill = (kind, by) => {
      if (by) this.crew.useful(by as Agent);
      const d = NPCS[kind];
      if (d.boss) this.note(`${d.name} defeated! 🎉`);
    };
    this.think();
  }

  get starter(): Project | undefined {
    return this.crew.projects.get("starter");
  }

  private note(text: string) {
    if (!text) return;
    this.journal.push(text);
    if (this.journal.length > 40) this.journal.shift();
  }

  save(): AdventureSave {
    return {
      v: 1,
      home: this.home,
      projects: [...this.crew.projects.values()].map((p) => p.params),
      residents: [...this.residents],
      met: [...this.met],
      locations: saveLocations(this.locations),
      life: Object.fromEntries(this.crew.agents.map((a) => [a.id, a.maxLife])),
      bags: this.game.inventory.slice(INVENTORY_SIZE),
      treeMarks: this.crew.saveTreeMarks(),
      scaffold: this.crew.saveScaffold(),
    };
  }

  /** The adventure is over (for now): save it into the game and give back the shared inventory. */
  detach() {
    const g = this.game;
    g.adventureSave = this.save();
    g.keepCut = null;
    g.inventory = g.inventory.slice(0, INVENTORY_SIZE);
    g.agents = [];
  }

  step(dt: number) {
    this.crew.step(dt);
    for (const n of this.town) stepTownNpc(n, this.game.map, this.game.night, this.game.rnd, dt, this.crew.clock);
    // A boss fight that drags on without real progress (six minutes, still above half life): it leaves.
    const boss = this.game.bossAlive;
    if (boss) {
      if (this.bossSeen !== boss) {
        this.bossSeen = boss;
        this.bossSince = this.crew.clock;
      }
      if (this.crew.clock - this.bossSince > 360 && boss.life > NPCS[boss.kind].life * 0.5) {
        this.game.npcs = this.game.npcs.filter((n) => n !== boss && n.head !== boss);
        this.note(`${NPCS[boss.kind].name} lost interest and left. The team will be ready next time.`);
        this.bossSeen = null;
      }
    }
    // Everyone down during a boss fight: the boss leaves.
    if (this.game.bossAlive && this.crew.agents.every((a) => a.dead > 0)) {
      const b = this.game.bossAlive;
      this.game.npcs = this.game.npcs.filter((n) => n !== b && n.head !== b);
      this.note(`${NPCS[b.kind].name} won this time. The team will regroup and try again.`);
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = THINK_EVERY;
      this.think();
    }
  }

  // ── Deciding ──────────────────────────────────────────────────────────────────────────────

  /** The team's best armour (shared gear) and average max life. */
  get defense() {
    const best = (slot: "head" | "body" | "legs") => Math.max(0, ...this.game.inventory.filter((s) => s && ITEMS[s.id]?.slot === slot).map((s) => ITEMS[s!.id].defense ?? 0));
    return best("head") + best("body") + best("legs") + (this.game.buffs.ironskin ? 8 : 0);
  }

  get life() {
    const a = this.crew.agents;
    return a.reduce((s, x) => s + x.maxLife, 0) / Math.max(1, a.length);
  }

  private think() {
    const g = this.game;
    const crew = this.crew;
    const n = crew.agents.length;
    const def = this.defense;
    for (const a of crew.agents) a.def = def;
    this.discover();
    this.townUpkeep();
    this.refreshLocations();
    const goals: Goal[] = [];
    const starter = this.starter;
    // 1. A boss is here: everyone to it (the fighting itself happens on its own).
    const boss = g.bossAlive;
    if (boss) {
      this.focus = `Fighting ${NPCS[boss.kind].name}!`;
      goals.push({ id: "boss-fight", kind: "go", x: Math.floor((boss.x + boss.w / 2) / TILE), why: `fighting ${NPCS[boss.kind].name}`, crew: n });
      crew.goals = goals;
      return;
    }
    // 2. Invasions: defend the town.
    if (g.event && g.event.kind !== "slimeRain") {
      goals.push({ id: "defend", kind: "go", x: Math.floor(this.home.x / TILE), why: "defending the town", crew: n });
    }
    // 3. The first house.
    if (starter && !crew.isDone(starter)) {
      this.focus = "Building the first house";
      goals.push({ id: "starter", kind: "build", project: "starter", crew: n });
      crew.goals = goals;
      return;
    }
    // 4. Town houses for whoever is ready to move in.
    const waiting = this.readyToMoveIn().length;
    const freeRooms = this.freeRooms().length;
    if (waiting > freeRooms) this.ensureTownHouse();
    for (const p of crew.projects.values()) if (p.kind === "npcHouse" && !crew.isDone(p)) goals.push({ id: p.id, kind: "build", project: p.id, crew: 2 });
    // 5. Gear (the first thing still missing, and stock that ran low).
    // (Stock already being topped up stays a goal until it's full again.)
    const gear = GEAR.filter((x) => x.when(this) && countOf(g.inventory, x.item) < (crew.goals.some((gl) => gl.id === `gear-${x.item}`) ? x.count : (x.low ?? x.count)));
    // The first thing missing gets two pairs of hands (ore for armour is slow going alone).
    for (const [i, x] of gear.slice(0, 2).entries()) goals.push({ id: `gear-${x.item}`, kind: "get", item: x.item, count: x.count, why: x.why, crew: i === 0 && n >= 3 ? 2 : 1 });
    // 6. Life crystals until everyone has plenty.
    if (crew.agents.some((a) => a.maxLife < 400) && this.nearestCrystal()) goals.push({ id: "crystal", kind: "get", item: 29, count: 1, why: "a life crystal", crew: 1 });
    // 7. The next boss, when the team is ready for it.
    const plan = BOSSES.find((b) => !g.bosses[b.boss]);
    let bossNote = "";
    if (plan) {
      const ready = this.life >= plan.life && def >= plan.def;
      bossNote = ready ? `Preparing for ${BOSS_NAMES[plan.boss]}` : `Getting stronger for ${BOSS_NAMES[plan.boss]} (life ${Math.round(this.life)}/${plan.life}, defence ${def}/${plan.def})`;
      if (ready) this.bossGoals(plan, goals);
    }
    // 8. Luxury houses: the long-term goal.
    const lux = this.luxuryProject();
    if (lux) goals.push({ id: lux.id, kind: "build", project: lux.id, crew: n >= 3 ? 2 : 1 });
    // 9. Explore the next place nobody has seen yet.
    const next = this.nextToExplore();
    if (next) goals.push({ id: `explore-${next.id}`, kind: "go", x: next.x, y: next.kind === "biome" && next.biome !== "underworld" && next.biome !== "mushroom" ? undefined : next.y, why: `exploring ${next.name}`, crew: 1, arrive: () => this.arrived(next), giveUp: () => this.couldntReach(next) });
    // 10. Anything else: help with the luxury house, then rest.
    if (lux) goals.push({ id: `${lux.id}-all`, kind: "build", project: lux.id, crew: n });
    goals.push({ id: "rest", kind: "rest", crew: n });
    crew.goals = goals;
    this.focus = boss ? this.focus : lux && !gear.length ? `Building ${lux.name} (${Math.round(projectProgress(g, lux) * 100)}%)` : gear[0] ? `Getting ${gear[0].why}` : bossNote || (next ? `Exploring ${next.name}` : "Relaxing at home");
    if (bossNote && plan && this.life >= plan.life && def >= plan.def) this.focus = bossNote;
  }

  /** Boss preparation: the arena or the place, the summoning item, potions, then the summons. */
  private bossGoals(plan: BossPlan, goals: Goal[]) {
    const g = this.game;
    const crew = this.crew;
    const n = crew.agents.length;
    goals.push({ id: `potions-${plan.boss}`, kind: "get", item: 28, count: 8, why: "potions for the fight", crew: 1 });
    if (plan.where === "arena") {
      const ar = this.ensureArena();
      // The arena goes up alongside; until its first tier is up, the fight happens in town.
      const ready = crew.isDone(ar) || projectProgress(g, ar) >= 0.5;
      if (!crew.isDone(ar)) goals.push({ id: ar.id, kind: "build", project: ar.id, crew: 1 });
      if (plan.item && countOf(g.inventory, plan.item) < 1) {
        goals.push({ id: `summon-${plan.item}`, kind: "get", item: plan.item, count: 1, why: `a ${itemDef(plan.item)?.name ?? "summoning item"}`, crew: 2 });
        return;
      }
      if (plan.night && !g.night) return;
      const at = ready ? { x: ar.x0 + Math.floor((ar.x1 - ar.x0) / 2), y: ar.door.y } : { x: Math.floor(this.home.x / TILE), y: Math.floor(this.home.y / TILE) };
      goals.unshift({ id: `boss-${plan.boss}`, kind: "go", x: at.x, why: `meeting at the arena for ${BOSS_NAMES[plan.boss]}`, crew: n, arrive: () => this.trySummon(plan, at) });
      return;
    }
    if (plan.where === "corruption") {
      const orb = g.objects.placed.find((o) => o.t === "orb");
      if (!orb) return;
      goals.unshift({ id: "boss-eater", kind: "go", x: orb.x, y: orb.y + 2, why: "smashing a shadow orb", crew: n, arrive: () => this.smash(orb) });
      return;
    }
    if (plan.where === "hive") {
      const larva = g.objects.placed.find((o) => o.t === "larva");
      if (!larva) return;
      goals.unshift({ id: "boss-queen", kind: "go", x: larva.x + 1, y: larva.y + 3, why: "waking the Queen Bee", crew: n, arrive: () => this.smash(larva) });
      return;
    }
    if (plan.where === "dungeon") {
      if (!g.night) return;
      const old = this.town.find((t) => t.id === "oldman");
      if (!old) return;
      goals.unshift({
        id: "boss-skeletron",
        kind: "go",
        x: Math.floor((old.x + old.w / 2) / TILE),
        why: "talking to the Old Man",
        crew: n,
        arrive: () => {
          if (!g.bossAlive && g.night) {
            g.spawnBoss("skeletron", { x: old.x, y: old.y });
            this.note("The Old Man's curse awakens Skeletron!");
          }
        },
      });
      return;
    }
    if (plan.where === "underworld") {
      const sh = this.ensureShaft();
      if (!crew.isDone(sh)) {
        goals.push({ id: sh.id, kind: "build", project: sh.id, crew: 2 });
        return;
      }
      const x = sh.door.x;
      if (countOf(g.inventory, 267) < 1) {
        goals.push({ id: "voodoo", kind: "go", x: x + 30, y: HELL_TOP + 45, why: "hunting a Voodoo Demon", crew: n });
        return;
      }
      const at = { x: x + 20, y: HELL_TOP + 45 };
      goals.unshift({ id: "boss-wall", kind: "go", x: at.x, y: at.y, why: "throwing the Guide Voodoo Doll in the lava", crew: n, arrive: () => this.trySummon(plan, at) });
    }
  }

  private trySummon(plan: BossPlan, at: { x: number; y: number }) {
    const g = this.game;
    if (g.bossAlive || !plan.item) return;
    // Wait until the team has gathered.
    const near = this.crew.agents.filter((a) => a.dead <= 0 && Math.abs((a.x + a.w / 2) / TILE - at.x) < 30).length;
    if (near < Math.max(1, this.crew.agents.filter((a) => a.dead <= 0).length - 1)) return;
    if (g.summon(plan.item, { x: at.x * TILE, y: at.y * TILE - 40 })) {
      g.removeFromInventory(plan.item, 1);
      this.note(`The girls summoned ${BOSS_NAMES[plan.boss]}!`);
    }
  }

  private smash(o: { x: number; y: number; t: string }) {
    const obj = this.game.objects.placed.find((p) => p.x === o.x && p.y === o.y && p.t === o.t);
    if (obj) this.game.takeObject(obj);
  }

  // ── Building plans ────────────────────────────────────────────────────────────────────────

  /** The current luxury house (creating the next one when it's time), or null. */
  private luxuryProject(): Project | null {
    const crew = this.crew;
    const open = [...crew.projects.values()].find((p) => p.kind === "luxury" && !crew.isDone(p));
    if (open) return open;
    for (const l of LUXURY) {
      if (crew.projects.has(`lux-${l.biome}`) || !l.when(this)) continue;
      const p = this.planLuxury(l.biome);
      if (!p) continue;
      crew.addProject(p);
      this.note(`Plans drawn up for ${p.name} in the ${BIOME_NAMES[p.biome] ?? p.biome}!`);
      return p;
    }
    return null;
  }

  private planLuxury(biome: string): Project | null {
    const g = this.game;
    const map = g.map;
    const seed = map.seed;
    const avoid = [...this.crew.projects.values()].map((p) => ({ x0: p.x0, x1: p.x1 }));
    // Estates on the surface spread out with wings, a garden and a courtyard; underground, in the
    // sky and in the underworld there's only room for the house and its towers.
    let W = ESTATE_SPAN;
    let site: { x0: number; g: number } | null = null;
    const home = Math.floor(this.home.x / TILE);
    // A site inside the biome around column `near` (the whole estate on its dry ground).
    const within = (near: number) => {
      const s = estateSite(map, biome, near, avoid);
      W = s.span;
      return s;
    };
    switch (biome) {
      case "forest":
        site = chooseFlat(map, home + 30, home + 260, W, avoid);
        break;
      case "ocean":
        site = within(jungleSideX(seed, 200));
        break;
      case "desert":
        site = within(jungleSideX(seed, 1450));
        break;
      case "snow":
        site = within(snowSideX(seed, 700));
        break;
      case "jungle":
        site = within(jungleSideX(seed, 650));
        break;
      case "corruption":
        site = within(snowSideX(seed, 1420));
        break;
      case "crimson":
        site = within(snowSideX(seed, 1730));
        break;
      case "hallow":
        site = within(jungleSideX(seed, 1160));
        break;
      case "mushroom": {
        const f = mushroomFields(seed, map.size)[0];
        site = { x0: f.x - 24, g: f.y + 6 };
        break;
      }
      case "sky": {
        const isl = map.structures.find((s) => s.kind === "island");
        if (!isl) return null;
        const lad = this.ensureLadder(isl);
        if (!this.crew.isDone(lad)) return null;
        site = { x0: isl.x0 + 2, g: isl.y0 + 9 };
        break;
      }
      case "underworld": {
        const sh = this.ensureShaft();
        if (!this.crew.isDone(sh)) return null;
        site = { x0: sh.door.x + 12, g: HELL_TOP + 50 };
        break;
      }
    }
    if (!site) return null;
    if (biome === "mushroom" || biome === "sky" || biome === "underworld") W = COMPACT_SPAN;
    return luxuryHouse(map, biome, site.x0, site.g, seed + biome.length * 97, W);
  }

  private ensureTownHouse() {
    const crew = this.crew;
    const houses = [...crew.projects.values()].filter((p) => p.kind === "npcHouse");
    if (houses.some((p) => !crew.isDone(p)) || houses.length >= 12) return;
    const starter = this.starter!;
    const map = this.game.map;
    const n = houses.length;
    // A row of houses heading away from the first house.
    const lastX = houses.length ? Math.min(...houses.map((p) => p.x0)) : starter.x0;
    const avoid = [...crew.projects.values()].map((p) => ({ x0: p.x0, x1: p.x1 }));
    const site = chooseFlat(map, lastX - 14, lastX - 40, 11, avoid);
    crew.addProject(npcHouse(map, site.x0, site.g, "wood", n));
    if (n === 0) this.locations.push({ id: "town", kind: "town", name: "Waifu Town", biome: map.biome(site.x0), x: site.x0 + 5, y: site.g - 4, r: 40, discovered: true, day: this.game.day, status: "Founded" });
  }

  private ensureArena(): Project {
    const crew = this.crew;
    const ex = [...crew.projects.values()].find((p) => p.kind === "arena");
    if (ex) return ex;
    const map = this.game.map;
    const starter = this.starter!;
    const avoid = [...crew.projects.values()].map((p) => ({ x0: p.x0, x1: p.x1 }));
    const site = chooseFlat(map, starter.x1 + 20, starter.x1 + 200, 60, avoid);
    const p = arena(map, site.x0, site.g, 40, "Battle Arena");
    crew.addProject(p);
    this.locations.push({ id: "arena", kind: "arena", name: "Battle Arena", biome: map.biome(site.x0), x: site.x0 + 30, y: site.g - 8, r: 40, discovered: true, day: this.game.day, status: "Under construction" });
    return p;
  }

  private ensureShaft(): Project {
    const crew = this.crew;
    const ex = crew.projects.get("shaft");
    if (ex) return ex;
    const map = this.game.map;
    const starter = this.starter!;
    const x = starter.x0 - 6;
    const p = shaft(map, x, map.surface(x) - 1, HELL_TOP + 6);
    crew.addProject(p);
    this.note("Digging a hellevator down to the Underworld...");
    return p;
  }

  private ensureLadder(isl: { x0: number; x1: number; y0: number; name: string }): Project {
    const crew = this.crew;
    const id = `ladder-${isl.name}`;
    const ex = crew.projects.get(id);
    if (ex) return ex;
    const map = this.game.map;
    const x = isl.x1 + 2;
    const p = ladder(map, x, map.surface(x), isl.y0 + 8, isl.name);
    crew.addProject(p);
    this.note(`Building a ladder up to ${isl.name}...`);
    return p;
  }

  // ── Town ──────────────────────────────────────────────────────────────────────────────────

  private readyToMoveIn(): TownId[] {
    const g = this.game;
    return TOWN_IDS.filter((id) => {
      const d = TOWN[id];
      if (!d.resident || this.residents.has(id)) return false;
      if (d.meet && !this.met.has(id)) return false;
      if (d.needs && !d.needs(g, this.residents.size)) return false;
      // The Guide comes first.
      if (id !== "guide" && !this.residents.has("guide")) return false;
      return true;
    });
  }

  /** Valid homes nobody lives in yet. */
  private freeRooms(): { x: number; y: number }[] {
    const g = this.game;
    const taken = new Set([...this.residents.values()].map((r) => roomAt(g.map, g.objects, r.x, r.y)?.key));
    const out: { x: number; y: number }[] = [];
    for (const p of this.crew.projects.values())
      for (const r of p.rooms) {
        const room = roomAt(g.map, g.objects, r.x, r.y);
        if (room && !taken.has(room.key)) {
          out.push(r);
          taken.add(room.key);
        }
      }
    return out;
  }

  private townUpkeep() {
    this.moveInT -= THINK_EVERY;
    if (this.moveInT > 0) return;
    this.moveInT = 8;
    const ready = this.readyToMoveIn();
    if (!ready.length) return;
    const rooms = this.freeRooms();
    if (!rooms.length) return;
    const id = ready[0];
    const room = rooms[0];
    this.residents.set(id, room);
    // A waiting NPC walks off to town (here: arrives there).
    const i = this.town.findIndex((t) => t.id === id);
    if (i >= 0) this.town.splice(i, 1);
    this.town.push(this.spawnResident(id, room));
    this.note(`${TOWN[id].name} has moved in!`);
    this.game.message(`${TOWN[id].name} has arrived!`);
    // The Old Man becomes the Clothier once Skeletron falls.
    if (id === "clothier") {
      const old = this.town.findIndex((t) => t.id === "oldman");
      if (old >= 0) this.town.splice(old, 1);
    }
  }

  private spawnResident(id: TownId, room: { x: number; y: number }): TownNpc {
    const r = roomAt(this.game.map, this.game.objects, room.x, room.y);
    const stand = r?.stand ?? room;
    const n = makeTownNpc(id, stand.x * TILE + 8, stand.y * TILE, false);
    n.room = r?.key ?? null;
    return n;
  }

  private shopFor(id: number): { price: number; npc: string } | null {
    for (const r of this.residents.keys()) {
      const hit = TOWN[r].shop.find(([i]) => i === id);
      if (hit) return { price: hit[1], npc: r };
    }
    return null;
  }

  // ── Exploring ─────────────────────────────────────────────────────────────────────────────

  private discover() {
    for (const a of this.crew.agents) {
      if (a.dead > 0) continue;
      const ax = (a.x + a.w / 2) / TILE;
      const ay = (a.y + a.h / 2) / TILE;
      for (const l of this.locations) {
        if (l.discovered) continue;
        if (Math.abs(l.x - ax) < l.r && Math.abs(l.y - ay) < Math.max(25, l.r * 0.7)) {
          l.discovered = true;
          l.day = this.game.day;
          this.note(`Discovered ${l.name}!`);
        }
      }
      // Meeting the NPCs waiting out in the world.
      for (const t of this.town) {
        if (!t.waiting || this.met.has(t.id)) continue;
        if (Math.abs(t.x - a.x) < 5 * TILE && Math.abs(t.y - a.y) < 4 * TILE) {
          this.met.add(t.id);
          t.say = { text: TOWN[t.id].quotes[0], until: this.crew.clock + 6 };
          if (TOWN[t.id].resident) this.note(`Met the ${TOWN[t.id].name}! She'll move to town when there's a room.`);
        }
      }
    }
  }

  /** Arriving somewhere: loot its chests. */
  private arrived(l: Location) {
    const g = this.game;
    for (const o of g.objects.inRect(Math.floor(l.x - l.r), Math.floor(l.y - 40), Math.ceil(l.x + l.r), Math.ceil(l.y + 40))) {
      if (!OBJECTS[o.t].storage || o.t === "piggybank" || o.t === "safe") continue;
      // Not the team's own storage.
      if ([...this.crew.projects.values()].some((p) => o.x >= p.x0 && o.x <= p.x1 && o.y >= p.y0 && o.y <= p.y1)) continue;
      g.openChest(o);
      if (!o.items) continue;
      for (let i = 0; i < o.items.length; i++) {
        const s = o.items[i];
        if (!s) continue;
        const left = addItem(g.inventory, s.id, s.count);
        o.items[i] = left > 0 ? { id: s.id, count: left } : null;
        if (left < s.count) this.note(`Found ${itemDef(s.id)?.name ?? "treasure"} at ${l.name}!`);
      }
      g.worldVersion++;
    }
  }

  private nearestCrystal(): { x: number; y: number } | null {
    const home = Math.floor(this.home.x / TILE);
    const objs = this.game.objects;
    for (let d = 0; d < 30; d++)
      for (const b of [Math.floor(home / 70) + d, Math.floor(home / 70) - d]) {
        const c = objs.crystalInBand(b);
        if (c) return c;
      }
    return null;
  }

  /** The nearest place not yet discovered that the team can get to. */
  /** Places the explorer couldn't get to (tries, and the day they're left until). */
  private readonly unreached = new Map<string, { tries: number; until: number }>();

  /** Twice no way through (a cliff, the dungeon's walls…): leave it for a day and explore elsewhere. */
  private couldntReach(l: Location) {
    const u = this.unreached.get(l.id) ?? { tries: 0, until: -1 };
    u.tries++;
    if (u.tries >= 2) {
      u.tries = 0;
      u.until = this.game.day + 1;
      this.note(`No way through to ${l.name} yet. Exploring somewhere else for now.`);
    }
    this.unreached.set(l.id, u);
  }

  private nextToExplore(): Location | null {
    const home = Math.floor(this.home.x / TILE);
    const crew = this.crew;
    const shaftDone = [...crew.projects.values()].some((p) => p.kind === "shaft" && crew.isDone(p));
    const reachable = (l: Location) => {
      if (l.biome === "underworld") return shaftDone;
      if (l.biome === "sky") return [...crew.projects.values()].some((p) => p.kind === "ladder" && crew.isDone(p) && Math.abs(p.door.x - l.x) < 50);
      if (l.biome === "dungeon") return this.game.bosses.skeletron || l.y < this.game.map.surface(l.x) + 10;
      return true;
    };
    return (
      this.locations
        .filter((l) => !l.discovered && reachable(l) && (this.unreached.get(l.id)?.until ?? -1) < this.game.day)
        .sort((a, b) => Math.abs(a.x - home) + (a.y - this.game.map.surface(a.x)) * 3 - (Math.abs(b.x - home) + (b.y - this.game.map.surface(b.x)) * 3))[0] ?? null
    );
  }

  /** Progress and status lines for the gallery. */
  private refreshLocations() {
    const g = this.game;
    for (const p of this.crew.projects.values()) {
      if (p.kind !== "luxury" && p.kind !== "starter") continue;
      const id = `house-${p.id}`;
      let l = this.locations.find((x) => x.id === id);
      if (!l) {
        l = { id, kind: "house", name: p.name, biome: p.biome, x: Math.floor((p.x0 + p.x1) / 2), y: p.door.y - 8, r: 30, discovered: true, day: g.day, status: "" };
        this.locations.push(l);
      }
      const pr = projectProgress(g, p);
      l.progress = pr;
      l.status = pr >= 1 ? "Complete" : `Building · ${Math.round(pr * 100)}%`;
    }
    const town = this.locations.find((l) => l.id === "town");
    if (town) {
      town.progress = Math.min(1, this.residents.size / 12);
      town.status = `${this.residents.size} resident${this.residents.size === 1 ? "" : "s"}${this.residents.size ? `: ${[...this.residents.keys()].map((id) => TOWN[id].name).join(", ")}` : ""}`;
    }
    const ar = this.locations.find((l) => l.id === "arena");
    if (ar) {
      const beaten = (["kingSlime", "eye"] as BossId[]).filter((b) => g.bosses[b]).map((b) => BOSS_NAMES[b]);
      ar.status = beaten.length ? `Defeated here: ${beaten.join(", ")}` : this.crew.projects.get("arena-Battle Arena") && this.crew.isDone(this.crew.projects.get("arena-Battle Arena")!) ? "Ready for battle" : "Under construction";
    }
    for (const l of this.locations) {
      if (l.kind === "house" || l.kind === "town" || l.kind === "arena") continue;
      if (!l.discovered) continue;
      if (l.kind === "settlement") {
        const s = g.map.structures.find((x) => `s-${x.kind}-${x.x0}` === l.id);
        const who = s?.npcs[0]?.id as TownId | undefined;
        l.status = who ? (this.residents.has(who) ? `The ${TOWN[who].name} moved to town` : this.met.has(who) ? `Met the ${TOWN[who].name}` : `The ${TOWN[who].name} lives here`) : "Explored";
        l.progress = who ? (this.residents.has(who) ? 1 : this.met.has(who) ? 0.5 : 0) : 1;
      } else if (l.biome === "dungeon") l.status = g.bosses.skeletron ? "Skeletron defeated" : "Guarded by the Old Man's curse";
      else if (l.id.startsWith("s-chasm")) l.status = g.bosses.eater ? "Eater of Worlds defeated" : `${g.orbs} shadow orb${g.orbs === 1 ? "" : "s"} smashed`;
      else if (l.id.startsWith("s-hive")) l.status = g.bosses.queenBee ? "Queen Bee defeated" : "The larva sleeps...";
      else if (l.kind === "biome") {
        const lux = this.crew.projects.get(`lux-${l.biome}`);
        l.status = lux ? `${lux.name} · ${Math.round(projectProgress(g, lux) * 100)}%` : "Explored";
        l.progress = lux ? projectProgress(g, lux) : undefined;
      } else l.status = "Explored";
    }
  }

  /** Who's doing what (HUD). */
  status(a: Agent) {
    return this.crew.status(a);
  }
}

/** Her name in the game's HUD and journal when you haven't given her one. */
export const agentName = (id: CharacterId) => NAMES[id] ?? id;

const NAMES: Partial<Record<CharacterId, string>> = {
  terrarian: "Companion",
  princess: "Princess",
  partygirl: "Party Girl",
  nurse: "Nurse",
  zoologist: "Zoologist",
  goblin: "Goblin Tinkerer",
};

