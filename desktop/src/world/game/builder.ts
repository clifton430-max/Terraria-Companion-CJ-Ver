// The waifus as a Terraria crew. Given goals (build this, get that, go there), each companion
// picks something to do and does it like a player would: chops the right kind of tree, digs a
// staircase mine for the right blocks or ores, hunts the creatures that drop a material, picks
// herbs, buys from town NPCs, crafts at the right station (placing one if needed), builds a
// blueprint tile by tile (climbing through the platform floors of tall houses), travels by
// walking, tunnelling, the hellevator shaft and sky ladders, and fights whatever attacks
// (choosing melee or ranged, drinking potions, recalling home when hurt). They use the real tools
// and gear in the team's shared inventory; a missing tool is worked out and crafted (tools.ts),
// anything that won't break is set aside, and impossible tools make them ask Master.
//
// `Builders` is the original one-house crew (the starter house), kept as the simple case.

import type { CharacterId } from "../../bridge";
import { HELL_TOP, T, type WorldMap } from "../gen";
import type { Fighter, Game } from "./game";
import { HOUSE_W, starterHouse, type Project, type Task } from "./house";
import { addItem, countOf, recipeFor, type Station } from "./inventory";
import { furnitureItemFor, blockItem, hitsToMine, item as itemDef, ITEMS, wallItem, type ItemDef } from "./items";
import { NPCS, type Npc, type NpcKind } from "./npcs";
import { OBJECTS, type ObjectType, type WorldObject } from "./objects";
import { moveBox, overlaps, solidIn, TILE, liquidAt } from "./physics";
import { canStand, findPath, type NavNode } from "./nav";
import { structureAt } from "../structures";
import { bestTool, minPower, planItem, planTool, requirement, SOURCES, STATION_ITEM, type PlanContext, type Source, type Step, type ToolKind } from "./tools";

export { HOUSE_W, type Task, type Project } from "./house";

const RUN = 170;
const JUMP_V = 300;
const JUMP_HOLD = 0.25;
const GRAVITY = 1440;
const MAX_FALL = 600;
const REACH = 7; // tiles, for the builders (enough to roof a house from its attic)
const ACT_TIME = 0.22; // seconds per swing / placement
/** A builder this far from a task (tiles) is still on her way there, not stuck at it. */
const WORK_NEAR_TILES = 30;
/** Walking spots this close together, in the same direction, are one trip (see `sameTrip`). */
const SAME_TRIP_TILES = 64;

/**
 * Is heading for column `next` the same trip as heading for `prev`, from `cx` (pixels)? True when
 * both lie the same way and close together: the next block of the same far-off build, say.
 */
function sameTrip(prev: number, next: number, cx: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return false;
  const dir = (x: number) => Math.sign(x * TILE + TILE / 2 - cx);
  return dir(prev) === dir(next) && dir(next) !== 0 && Math.abs(prev - next) <= SAME_TRIP_TILES;
}
/** A target set aside after too many hits stays aside this long (seconds). */
const BLOCK_TIME = 60;
/** Seconds a builder stands beside a task she can't reach before putting it off. */
const BESIDE_LIMIT = 6;
/** Seconds on one task without acting on it at all before it's put off (any reason). */
const WORK_LIMIT = 25;
/** How long a builder waits after asking Master for a tool before trying again. */
const ASK_WAIT = 20;
const ASK_EVERY = 45;
const POTION_COOLDOWN = 60;
/** Rows above this are the sky (islands). */
const SKY_LINE = 120;
/** How long the team leaves a tree it failed on alone, by failures so far (s); past the end, until dawn. */
const TREE_WAITS = [60, 300];
/** Trees this many columns past the nearest one wait until nothing closer (nor any in a chest) is left. */
const TREE_MARGIN = 200;
/** Walking toward a tree this long without getting closer counts as not getting there (s). */
const TREE_STALL = 15;
/** Beside a tree this long without reaching its trunk (up on a ledge, down a hole) counts too (s). */
const TREE_BESIDE = 10;

/** A tree the team failed to chop: failures so far, and until when it's left alone (or until the dawn after `day`). */
export interface TreeMark {
  fails: number;
  until: number;
  day?: number;
}
/** Saved as [column, failures, seconds left, day (until dawn)]. */
export type TreeMarkSave = [number, number, number, number?];

export interface Agent extends Fighter {
  id: CharacterId;
  dir: -1 | 1;
  walk: number;
  jumpT: number;
  /** Swinging a tool / placing (0..1) for the animation. */
  use: { t: number; item: number; aim: number } | null;
  cooldown: number;
  job: Job | null;
  stuck: number;
  lastX: number;
  /** Closest she has come to her current walking goal, and how long ago that improved. */
  best: number;
  sinceBetter: number;
  goal: number;
  /** The task she's working on (kept until it's done, so builders don't swap back and forth). */
  claim: Task | null;
  /** Seconds without moving a tile or doing any work (the last-resort recall). */
  idle: number;
  anchor: { x: number; y: number };
  say: { text: string; until: number } | null;
  /** The errand (getting something) her current gathering job is part of. */
  outer: Job | null;
  /** Where she respawns and recalls to (px, feet). */
  home: { x: number; y: number };
  /** Potion sickness (s), time since last hurt (s). */
  potionT: number;
  regenT: number;
  /** The director's goal she's working on. */
  goalId: string | null;
  /** Fighting this. */
  target: Npc | null;
  kills: number;
  /** A planned route (when walking straight didn't work), toward column `pathGoal`. */
  path: NavNode[] | null;
  pathGoal: number;
  pathAt: number;
  pathTry: number;
}

export type Job =
  | { kind: "gather"; item: number; count: number; why: string; sub: Job | null; resume: Job | null; told: string; tool?: ToolKind; power?: number; plan?: { at: number; ver: number; result: ReturnType<typeof planItem> } }
  | { kind: "wood"; tree: number; cactus?: boolean; far?: boolean; beside?: number; best?: number; bestAt?: number; seen?: number }
  /** Take an item out of a chest (the team's own, or one out in the world they've opened). */
  | { kind: "fetch"; x: number; y: number; item: number; count: number; since: number }
  | { kind: "mine"; dir: -1 | 1; started: boolean; steps: number; tiles: number[]; item: number; count: number; start: number; maxDepth: number; turns?: number; site?: { x: number; y: number } }
  | { kind: "hunt"; npcs: NpcKind[]; item: number; count: number; until: number; at: number }
  | { kind: "harvest"; item: number; count: number; t: ObjectType; style?: number; since?: number; at?: number; best?: number }
  | { kind: "stars"; item: number; count: number; until: number }
  | { kind: "build"; project: string }
  | { kind: "go"; x: number; y?: number; why: string; until: number; goal?: string }
  /** A break at home (`until`: then look for work again; none = done for good). */
  | { kind: "rest"; until?: number }
  /** Taking down the stacks of blocks left from climbing over things. */
  | { kind: "tidy"; until: number }
  | { kind: "wait"; until: number; tool?: ToolKind; why: string };

/** What the director asks of the crew, in priority order. */
export type Goal =
  | { id: string; kind: "build"; project: string; crew: number }
  | { id: string; kind: "get"; item: number; count: number; why: string; crew: number }
  | { id: string; kind: "go"; x: number; y?: number; why: string; crew: number; arrive?: (a: Agent) => void; giveUp?: (a: Agent) => void }
  | { id: string; kind: "rest"; crew: number };

type Move = { move: -1 | 0 | 1; jump: boolean; drop?: boolean };
const STILL: Move = { move: 0, jump: false };

// CJ Ver: what each professional says while building (strictly professional).
const LINES: Partial<Record<CharacterId, Record<string, string>>> = {
  princess: { start: "Here's the plan. Let's get started.", wood: "Sourcing timber.", stone: "Heading to the quarry.", build: "Construction in progress.", done: "Project complete, on schedule.", fight: "Threat incoming. Handling it." },
  partygirl: { start: "New project! Let's make it a good one.", wood: "Collecting wood.", stone: "Collecting stone.", build: "Building now.", done: "Finished. Ready for the open house.", fight: "We have company. Dealing with it." },
  nurse: { start: "A clean, safe home. Let's be methodical.", wood: "Gathering wood. Lift with your legs.", stone: "Collecting stone. Careful in the mine.", build: "Building. Measure twice.", done: "Finished. A safe, healthy home.", fight: "Stay back. I'll handle this." },
  zoologist: { start: "Site surveyed. Beginning construction.", wood: "Gathering timber samples.", stone: "Extracting stone.", build: "Walls going up as planned.", done: "Construction complete. Results look good.", fight: "Hostile wildlife. Engaging." },
  goblin: { start: "Blueprints are ready. Let's build.", wood: "Sourcing lumber.", stone: "Mining aggregate.", build: "Construction underway. Per spec.", done: "Built to code.", fight: "Engaging hostile." },
  terrarian: { start: "Let's build a solid house.", wood: "I'll get the wood.", stone: "I'll get the stone.", build: "Building.", done: "The house is finished. Welcome home.", fight: "Stand back." },
};
const line = (id: CharacterId, key: string) => LINES[id]?.[key] ?? LINES.terrarian![key] ?? "";

export function makeAgent(id: CharacterId, x: number, y: number): Agent {
  return {
    id,
    x: x - 10,
    y: y - 42,
    w: 20,
    h: 42,
    vx: 0,
    vy: 0,
    onGround: false,
    dir: 1,
    walk: 0,
    jumpT: 0,
    use: null,
    cooldown: 0,
    job: null,
    stuck: 0,
    lastX: x,
    say: null,
    best: Infinity,
    sinceBetter: 0,
    goal: NaN,
    claim: null,
    idle: 0,
    anchor: { x, y },
    outer: null,
    life: 100,
    maxLife: 100,
    iframes: 0,
    dead: 0,
    name: id,
    home: { x, y },
    potionT: 0,
    regenT: 99,
    goalId: null,
    target: null,
    kills: 0,
    path: null,
    pathGoal: NaN,
    pathAt: 0,
    pathTry: -99,
  };
}

/** Furniture at a spot that a project doesn't mean to have there (and that can be picked up). */
function foreignObject(game: Game, p: Project, x: number, y: number) {
  const o = game.objects.at(x, y);
  if (!o || OBJECTS[o.t].breakable) return null;
  if (o.t === "chest" && o.items?.some(Boolean)) return null; // (never someone's full chest)
  return plannedObjects(p).has(`${o.t}:${o.x},${o.y}:${o.style ?? 0}`) ? null : o;
}

const plannedCache = new WeakMap<Project, Set<string>>();
/** The pieces of furniture a project means to have (kind, place and style). */
function plannedObjects(p: Project): Set<string> {
  let s = plannedCache.get(p);
  if (!s) {
    s = new Set(p.tasks.flatMap((t) => (t.kind === "object" ? [`${t.obj}:${t.x},${t.y}:${t.style ?? 0}`] : [])));
    plannedCache.set(p, s);
  }
  return s;
}

/** Is a task already done in the world? */
/** Blocks that pile up from digging (natural ground, and the bulk stone and dirt). */
const RUBBLE = new Set([2, 3, 169, 133, 176, 593, 664, 61, 172, 1124, 751]);
const isRubble = (id: number) => RUBBLE.has(id) || (id >= 110000 && id < 120000);

export function taskDone(game: Game, p: Project, t: Task): boolean {
  const m = game.map;
  switch (t.kind) {
    case "chop":
      return !m.tree(t.x);
    case "clear": {
      // Cleared: no block the build doesn't want, nor a wall or furniture left from before (an
      // older design of the house, say).
      const k = t.y * 65536 + t.x;
      if (m.standable(t.x, t.y) && p.planned.get(k) !== m.tile(t.x, t.y)) return false;
      // (Only the estates: they're the ones redesigned. Town houses keep whatever's been added.)
      if (p.kind !== "luxury") return true;
      if (p.walls && m.wall(t.x, t.y) && !p.walls.has(k)) return false;
      return !foreignObject(game, p, t.x, t.y);
    }
    case "tile":
      return t.tile === T.Dirt ? m.solid(t.x, t.y) : m.tile(t.x, t.y) === t.tile;
    case "wall":
      return m.wall(t.x, t.y) === t.wall;
    case "object":
      return game.objects.inRect(t.x, t.y, t.x, t.y).some((o) => o.t === t.obj && o.x === t.x && o.y === t.y);
  }
}

/** The item a task uses up (null: none — clearing, chopping). */
export function taskItem(t: Task): number | null {
  switch (t.kind) {
    case "tile":
      // (Grass is laid as the soil it grows on.)
      return t.tile === T.Platform ? 94 : (SOIL[t.tile] ?? blockItem(t.tile));
    case "wall":
      return wallItem(t.wall);
    case "object": {
      // (Creates the item on demand for a style no theme lists, so it can be made like the rest.)
      const id = OBJECTS[t.obj].drop(t.style ?? 0);
      if (id === null) return null;
      return furnitureItemFor(t.obj, t.style ?? 0) || null;
    }
    default:
      return null;
  }
}

/** Grasses, and the soil each is laid as. */
const SOIL: Partial<Record<number, number>> = { [T.Grass]: 2, [T.HallowedGrass]: 2, [T.CrimsonGrass]: 2, [T.CorruptGrass]: 2, [T.JungleGrass]: 176, [T.MushroomGrass]: 176 };

const needsCache = new WeakMap<Project, { key: string; needs: Map<number, number> }>();

/** Materials still needed for a project's remaining tasks (item → count), before what's in stock. */
export function projectNeeds(game: Game, p: Project): Map<number, number> {
  const key = `${game.worldVersion}:${game.version}`;
  const hit = needsCache.get(p);
  if (hit && hit.key === key) return hit.needs;
  const out = new Map<number, number>();
  for (const t of p.tasks) {
    const id = taskItem(t);
    if (id === null || taskDone(game, p, t)) continue;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  needsCache.set(p, { key, needs: out });
  return out;
}

export function projectProgress(game: Game, p: Project): number {
  const build = p.tasks.filter((t) => t.kind === "tile" || t.kind === "object" || t.kind === "wall");
  if (!build.length) return 1;
  return build.filter((t) => taskDone(game, p, t)).length / build.length;
}

// ── The crew ────────────────────────────────────────────────────────────────────────────────

export class Crew {
  projects = new Map<string, Project>();
  goals: Goal[] = [];
  clock = 0;
  /** How many times placing each task has failed (each failure puts it off longer). */
  private readonly failures = new WeakMap<Task, number>();
  /** How many times each task has been put off, for any reason. */
  private readonly strikes = new WeakMap<Task, number>();
  /** Each builder's current task and since when she's been at it without acting on it. */
  private readonly working = new Map<Agent, { task: Task; since: number }>();
  /** Builders standing beside a task they can't reach: which task, since when. */
  private readonly beside = new Map<Agent, { task: Task; since: number }>();
  /** Swings at each target (tile key, or −1−column for trees) since it last broke. */
  protected readonly hits = new Map<number, number>();
  /** Targets set aside (key → until), and tasks put off because of them. */
  protected readonly blocked = new Map<number, number>();
  protected readonly deferred = new Map<Task, number>();
  /** Materials with no source found nearby (no cactus in range…), retried now and then. */
  protected readonly unavailable = new Set<number>();
  private unavailableAt = 0;
  /** Blocks stacked to climb over things (key → who, on which trip), taken down afterwards. */
  readonly scaffold = new Map<number, { x: number; y: number; owner: string; trip: string }>();
  /** Builders climbing over something right now: since when, and the highest they've got. */
  private readonly climbing = new Map<Agent, { since: number; top: number; at: number }>();
  /** Who is fetching each tool (the others wait for it rather than all making one). */
  protected readonly acquiring = new Map<ToolKind, Agent>();
  private readonly lastAsk = new Map<ToolKind, { at: number; n: number }>();
  /** Tools found impossible to make (until): jobs that need them aren't handed out meanwhile. */
  protected readonly noTool = new Map<ToolKind, number>();
  /** First not-yet-done task index per project (scanning from here is enough most of the time). */
  private readonly cursor = new Map<string, number>();
  /** For tests and the HUD. */
  stats = { swings: 0, setAside: 0, crafted: [] as number[], asked: 0, built: 0, treesMarked: 0 };
  /** Trees the team failed on (column → mark): shared by everyone, saved with the adventure. */
  readonly treeMarks = new Map<number, TreeMark>();
  /** Town NPC shops (from the director). */
  shop: PlanContext["shop"] = undefined;
  /** Where to find a town NPC (for buying). */
  npcAt: (id: string) => { x: number; y: number } | null = () => null;
  /** Things the waifus said (the HUD log), newest last. */
  log: string[] = [];
  /** Each fighter's current fight: since when, and the foe's life then (to notice a hopeless one). */
  private readonly fights = new Map<Agent, { n: Npc; since: number; life: number }>();
  /** Foes ignored for a while (out of reach, or no progress). */
  private readonly ignored = new WeakMap<Npc, number>();
  /** When each companion last used the Magic Mirror. */
  protected readonly recalled = new Map<Agent, number>();
  /** Routes that keep failing toward a goal column (no more planning for a while). */
  private readonly pathBan = new Map<Agent, { goal: number; tries: number; until: number }>();
  /** Companions stepping out of the way of a block being placed. */
  private readonly aside = new Map<Agent, { dir: -1 | 1; until: number }>();
  /** Watchdog: where each companion was when she last got anywhere (or did anything). */
  private readonly watch = new Map<Agent, { x: number; y: number; t: number; air: number; moved: number }>();

  constructor(
    protected readonly game: Game,
    readonly agents: Agent[],
  ) {}

  addProject(p: Project) {
    this.projects.set(p.id, p);
    this.cursor.set(p.id, 0);
  }

  isDone(p: Project): boolean {
    return this.openTask(p, null) === null;
  }

  /** The first open task of a project (optionally only ones `ok` accepts). */
  protected openTask(p: Project, ok: ((t: Task) => boolean) | null): Task | null {
    let i = this.cursor.get(p.id) ?? 0;
    while (i < p.tasks.length && taskDone(this.game, p, p.tasks[i])) i++;
    if (i >= p.tasks.length && (this.cursor.get(p.id) ?? 0) > 0) {
      // Everything after the cursor is done: check nothing earlier came undone.
      let j = 0;
      while (j < p.tasks.length && taskDone(this.game, p, p.tasks[j])) j++;
      i = j;
    }
    this.cursor.set(p.id, Math.min(i, p.tasks.length));
    if (i >= p.tasks.length) return null;
    if (!ok) return p.tasks[i];
    for (let k = i; k < p.tasks.length; k++) {
      const t = p.tasks[k];
      if (ok(t) && !taskDone(this.game, p, t)) return t;
    }
    // Nothing from here on: something earlier may have come undone since (knocked out by someone
    // squeezing past, or by a monster) — look there too, and start from it next time.
    for (let k = 0; k < i; k++) {
      const t = p.tasks[k];
      if (!taskDone(this.game, p, t)) {
        this.cursor.set(p.id, Math.min(this.cursor.get(p.id) ?? k, k));
        if (ok(t)) return t;
      }
    }
    return null;
  }

  protected speak(a: Agent, key: string) {
    this.tell(a, line(a.id, key), 3.5);
  }

  protected tell(a: Agent, text: string, seconds = 4) {
    if (!text) return;
    a.say = { text, until: this.clock + seconds };
    this.log.push(`${a.name ?? a.id}: ${text}`);
    if (this.log.length > 30) this.log.shift();
  }

  /** What each companion is doing (for the HUD). */
  status(a: Agent): string {
    if (a.dead > 0) return "recovering at home";
    if (a.target) return `fighting ${NPCS[a.target.kind].name}`;
    const job = a.job;
    switch (job?.kind) {
      case "gather":
        return `getting ${itemDef(job.item)?.name ?? "materials"}${job.told ? ` (${job.told})` : ""}`;
      case "wait":
        return job.why;
      case "wood":
        return job.cactus ? "cutting cactus" : "chopping trees";
      case "fetch":
        return `taking ${itemDef(job.item)?.name ?? "things"} from a chest`;
      case "mine":
        return `mining ${itemDef(job.item)?.name ?? "stone"}`;
      case "hunt":
        return `hunting for ${itemDef(job.item)?.name ?? "drops"}`;
      case "harvest":
        return `picking ${itemDef(job.item)?.name ?? "plants"}`;
      case "stars":
        return "catching fallen stars";
      case "build":
        return `building ${this.projects.get(job.project)?.name ?? ""}`;
      case "go":
        return job.why;
      case "tidy":
        return "taking down a climbing stack";
      default:
        return "relaxing at home";
    }
  }

  step(dt: number) {
    this.clock += dt;
    if (this.clock - this.unavailableAt > 120) {
      this.unavailable.clear();
      this.unavailableAt = this.clock;
    }
    if (this.blocked.size > 400) for (const [k, until] of this.blocked) if (until <= this.clock) this.blocked.delete(k);
    if (this.deferred.size > 200) for (const [t, until] of this.deferred) if (until <= this.clock) this.deferred.delete(t);
    if (this.clock - this.tidyAt > 5) {
      this.tidyAt = this.clock;
      this.tidy();
    }
    this.agents.forEach((a, i) => this.stepAgent(a, i, dt));
  }

  private tidyAt = 0;

  /**
   * Keep room in the bags: rubble from digging (stone, dirt, sand...) is kept to a couple of stacks
   * each and the rest left behind, and when the bags are nearly full, to one stack. (Otherwise
   * mining fills every slot and wood, ore and shop purchases have nowhere to go.)
   */
  protected tidy() {
    const inv = this.game.inventory;
    const free = inv.filter((s) => !s).length;
    const limit = free < 10 ? 999 : 1998;
    const totals = new Map<number, number>();
    for (const s of inv) if (s && isRubble(s.id)) totals.set(s.id, (totals.get(s.id) ?? 0) + s.count);
    for (const [id, n] of totals) if (n > limit) this.game.removeFromInventory(id, n - limit);
  }

  // ── Choosing work ─────────────────────────────────────────────────────────────────────────

  /** A tool we don't have and found we can't make (for now). */
  protected toolOut(kind: ToolKind) {
    return (this.noTool.get(kind) ?? -1) > this.clock && !bestTool(this.game.inventory, kind);
  }

  protected onGoal(g: Goal, except: Agent) {
    return this.agents.filter((o) => o !== except && o.goalId === g.id && o.job && o.dead <= 0).length;
  }

  /** Pick a job from the goals, most important first. */
  protected assign(a: Agent, i: number): Job {
    // Highest priority first (each goal takes only so many hands).
    for (const g of this.goals) {
      if (this.onGoal(g, a) >= g.crew) continue;
      const job = this.jobFor(a, g, i);
      if (job) {
        a.goalId = g.id;
        return job;
      }
    }
    a.goalId = null;
    return { kind: "rest", until: this.clock + 5 };
  }

  protected jobFor(a: Agent, g: Goal, _i: number): Job | null {
    switch (g.kind) {
      case "rest":
        // Nothing else to do: take down a stack left from climbing over something (one at a time).
        if (this.leftovers(a).some((s) => this.tidyNow(s.x)) && !this.agents.some((o) => o !== a && o.job?.kind === "tidy")) return { kind: "tidy", until: this.clock + 300 };
        return { kind: "rest", until: this.clock + 5 };
      case "go":
        return { kind: "go", x: g.x, y: g.y, why: g.why, until: this.clock + 240, goal: g.id };
      case "get": {
        if (countOf(this.game.inventory, g.item) >= g.count) return null;
        if (this.unavailable.has(g.item)) return null;
        // Tools have their own path (with asking Master if impossible).
        const kind = ITEMS[g.item]?.kind;
        if ((kind === "pickaxe" || kind === "axe") && this.toolOut(kind)) return null;
        return { kind: "gather", item: g.item, count: g.count, why: g.why, sub: null, resume: null, told: "" };
      }
      case "build": {
        const p = this.projects.get(g.project);
        if (!p || this.isDone(p)) return null;
        // Work in build order: the next open task decides whether it's building or fetching.
        const next = this.openTask(p, (t) => (this.deferred.get(t) ?? -1) <= this.clock);
        if (next && !this.haveFor(next)) {
          const id = taskItem(next)!;
          const need = projectNeeds(this.game, p).get(id) ?? 1;
          const have = countOf(this.game.inventory, id);
          if (this.fetchers(id, a) < (need - have > 20 ? 2 : 1) && !this.unavailable.has(id)) {
            return { kind: "gather", item: id, count: Math.min(need, have + Math.max(12, Math.min(60, need - have))), why: `for ${p.name}`, sub: null, resume: null, told: "" };
          }
          // Enough hands on what's needed next: help with another material, or do something else.
          const other = this.missingFor(p, a);
          if (other && this.fetchers(other.item, a) === 0) return { kind: "gather", item: other.item, count: other.count, why: `for ${p.name}`, sub: null, resume: null, told: "" };
          return null;
        }
        const buildable = this.openTask(p, (t) => (this.deferred.get(t) ?? -1) <= this.clock && this.haveFor(t));
        const builders = this.agents.filter((o) => o !== a && o.job?.kind === "build" && o.job.project === p.id).length;
        if (buildable && builders < 2) return { kind: "build", project: p.id };
        const need = this.missingFor(p, a);
        if (need) return { kind: "gather", item: need.item, count: need.count, why: `for ${p.name}`, sub: null, resume: null, told: "" };
        if (buildable) return { kind: "build", project: p.id };
        return null;
      }
    }
  }

  /** How many others are actually out fetching an item (not tied up in a fight, not knocked out). */
  protected fetchers(id: number, except: Agent): number {
    return this.agents.filter((o) => o !== except && o.dead <= 0 && !o.target && o.job?.kind === "gather" && o.job.item === id).length;
  }

  /** The most needed material for a project, preferring ones nobody is fetching yet. */
  protected missingFor(p: Project, a: Agent): { item: number; count: number } | null {
    const needs = projectNeeds(this.game, p);
    const fetching = new Set(this.agents.filter((o) => o !== a && o.job?.kind === "gather").map((o) => (o.job as { item: number }).item));
    let best: { item: number; count: number; score: number } | null = null;
    for (const [id, n] of needs) {
      if (this.unavailable.has(id)) continue;
      const have = countOf(this.game.inventory, id);
      // Dirt for foundations can be stone too.
      if (id === 2 && have + countOf(this.game.inventory, 3) >= n) continue;
      const short = n - have;
      if (short <= 0) continue;
      const score = short * (fetching.has(id) ? 0.3 : 1);
      if (!best || score > best.score) best = { item: id, count: n, score };
    }
    if (!best) return null;
    // Fetch in batches (big builds aren't gathered all at once).
    const have = countOf(this.game.inventory, best.item);
    return { item: best.item, count: Math.min(best.count, have + Math.max(12, Math.min(60, best.count - have))) };
  }

  protected haveFor(t: Task): boolean {
    const id = taskItem(t);
    if (id === null) return true;
    if (countOf(this.game.inventory, id) > 0) return true;
    if (id === 2) return countOf(this.game.inventory, 3) > 0;
    return false;
  }

  // ── Each companion's step ─────────────────────────────────────────────────────────────────

  protected stepAgent(a: Agent, i: number, dt: number) {
    a.cooldown = Math.max(0, a.cooldown - dt);
    a.iframes = Math.max(0, a.iframes - dt);
    a.potionT = Math.max(0, a.potionT - dt);
    if (a.use) {
      a.use.t += dt / ACT_TIME;
      if (a.use.t >= 1) a.use = null;
    }
    if (a.say && this.clock > a.say.until) a.say = null;
    // Knocked out: back home after a while.
    if (a.dead > 0) {
      a.dead -= dt;
      if (a.dead <= 0) {
        a.dead = 0;
        a.life = a.maxLife;
        this.recall(a, false);
        a.job = null;
        a.target = null;
      }
      return;
    }
    this.survive(a, dt);
    this.watchdog(a, dt);
    // Out of the way of a block being placed.
    const aside = this.aside.get(a);
    if (aside) {
      if (this.clock > aside.until) this.aside.delete(a);
      else {
        this.physics(a, aside.dir, Math.abs(a.x - a.lastX) < 0.5 && a.onGround, false, dt);
        a.lastX = a.x;
        return;
      }
    }
    // Fighting comes first.
    const fight = this.fight(a);
    if (fight) {
      this.physics(a, fight.move, fight.jump, !!fight.drop, dt);
      return;
    }
    if (!a.job) {
      a.job = this.assign(a, i);
      // Work at home but she's down a mine: recall home first.
      if (a.job.kind !== "go" && this.underground(a) && !this.nearHome(a) && !this.nearProjectFor(a)) this.recall(a);
    }
    // Truly stuck (no progress toward her goal for a long while): recall.
    const kind = a.job?.kind === "gather" ? (a.job.sub?.kind ?? "gather") : a.job?.kind;
    if (a.sinceBetter > 8 && kind !== "mine" && kind !== "go") this.recall(a);
    // Last resort: not moved a tile and not worked for 10 seconds (and not resting).
    if (Math.hypot(a.x - a.anchor.x, a.y - a.anchor.y) > TILE || a.use) {
      a.anchor = { x: a.x, y: a.y };
      a.idle = 0;
    } else if (a.job?.kind !== "rest" && a.job?.kind !== "wait") {
      a.idle += dt;
      if (a.idle > 10) {
        a.idle = 0;
        this.giveUpTree(a);
        a.claim = null;
        a.job = null;
        this.recall(a);
      }
    }
    if (!a.job) a.job = this.assign(a, i);
    let m: Move = STILL;
    const job = a.job;
    switch (job.kind) {
      case "wood":
        m = this.doWood(a, job);
        break;
      case "fetch":
        m = this.doFetch(a, job);
        break;
      case "mine":
        m = this.doMine(a, job);
        break;
      case "build":
        m = this.doBuild(a, job);
        break;
      case "rest":
        if (job.until !== undefined && this.clock > job.until) a.job = null;
        m = this.doRest(a);
        break;
      case "gather":
        m = this.doGather(a, job);
        break;
      case "wait":
        m = this.doWait(a, job);
        break;
      case "go":
        m = this.doGo(a, job);
        break;
      case "tidy":
        m = this.clock > job.until ? ((a.job = null), STILL) : this.doTidy(a);
        break;
      case "hunt":
        m = this.doHunt(a, job);
        break;
      case "harvest":
        m = this.doHarvest(a, job);
        break;
      case "stars":
        m = this.doStars(a, job);
        break;
    }
    this.physics(a, m.move, m.jump, !!m.drop, dt);
  }

  /**
   * The catch-all: if she hasn't moved three tiles or got anything done for 45 s, whatever she's
   * doing isn't working: Magic Mirror home and start fresh (ignoring whatever held her up).
   * Wedged in mid-air for a few seconds: nudged up out of it.
   */
  protected watchdog(a: Agent, dt: number) {
    let p = this.watch.get(a);
    if (!p) this.watch.set(a, (p = { x: a.x, y: a.y, t: this.clock, air: 0, moved: this.clock }));
    if (Math.hypot(a.x - p.x, a.y - p.y) > 3 * TILE) {
      p.x = a.x;
      p.y = a.y;
      p.t = this.clock;
      p.moved = this.clock;
    }
    // Digging away in one spot doesn't count as getting anywhere when the work is far off
    // (trying to dig out of somewhere she can't): two minutes of that and she mirrors home.
    // (Only building and travelling: gathering, mining and the like go at their own pace.)
    const work = a.job?.kind === "build" && a.claim && "x" in a.claim ? a.claim.x : a.job?.kind === "go" ? a.job.x : null;
    if (work !== null && Math.abs(work - (a.x + a.w / 2) / TILE) > 20 && this.clock - p.moved > 120) p.t = -Infinity;
    // Stuck in the air (wedged between blocks): lift out.
    p.air = !a.onGround && Math.abs(a.vy) < 1 && Math.abs(a.vx) < 1 ? p.air + dt : 0;
    if (p.air > 2) {
      a.y -= TILE;
      p.air = 0;
    }
    if (this.clock - p.t > 45) {
      if (a.target) this.ignored.set(a.target, this.clock + 60);
      this.giveUpTree(a);
      a.target = null;
      a.job = null;
      a.claim = null;
      this.recall(a);
      p.x = a.x;
      p.y = a.y;
      p.t = this.clock;
      p.moved = this.clock;
    }
  }

  /** She got something done (broke or placed a block, crafted, bought, felled a foe). */
  useful(a: Agent) {
    const p = this.watch.get(a);
    if (p) p.t = this.clock;
    this.working.delete(a); // real progress: the builders' safety-net timer starts over
  }

  /** Regenerate, use life crystals, drink potions. */
  protected survive(a: Agent, dt: number) {
    a.regenT += dt;
    const regen = a.regenT > 15 ? 4 : a.regenT > 5 ? 1.5 : 0;
    if (regen && a.life < a.maxLife) a.life = Math.min(a.maxLife, a.life + regen * dt);
    if (a.life < a.maxLife * 0.4 && a.potionT <= 0) {
      const potion = [188, 28, 5].find((id) => countOf(this.game.inventory, id) > 0);
      if (potion) {
        this.game.removeFromInventory(potion, 1);
        const heal = itemDef(potion)?.heal ?? 30;
        a.life = Math.min(a.maxLife, a.life + heal);
        a.potionT = POTION_COOLDOWN;
        this.game.texts.push({ x: a.x + a.w / 2, y: a.y, text: `+${heal}`, color: "#5cff7a", age: 0 });
      }
    }
    // A life crystal in stock goes to whoever has the least life.
    if (countOf(this.game.inventory, 29) > 0) {
      const weakest = this.agents.reduce((w, o) => (o.maxLife < w.maxLife ? o : w), this.agents[0]);
      if (weakest === a && a.maxLife < 400) {
        this.game.removeFromInventory(29, 1);
        a.maxLife += 20;
        a.life += 20;
        this.game.texts.push({ x: a.x + a.w / 2, y: a.y, text: "+20 max life", color: "#ff6f8f", age: 0 });
      }
    }
  }

  // ── Combat ────────────────────────────────────────────────────────────────────────────────

  protected bestWeapon(ranged: boolean): ItemDef | null {
    let best: ItemDef | null = null;
    let score = 0;
    for (const s of this.game.inventory) {
      const d = s ? ITEMS[s.id] : undefined;
      if (!d || !d.damage) continue;
      const isRanged = d.kind === "bow" || d.kind === "gun" || d.kind === "magic" || d.kind === "boomerang";
      const isMelee = d.kind === "sword" || d.kind === "shortsword" || d.kind === "spear";
      if (!isRanged && !isMelee) continue;
      if (isRanged !== ranged) continue;
      if (d.proj?.ammo && !this.game.inventory.some((x) => x && ITEMS[x.id]?.ammo === d.proj!.ammo)) continue;
      const v = d.damage / (d.useTime ?? 0.4);
      if (v > score) {
        score = v;
        best = d;
      }
    }
    return best;
  }

  /** Something hostile close by (bosses from further away). */
  threat(a: Agent): Npc | null {
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const ranged = !!this.bestWeapon(true);
    let best: Npc | null = null;
    let bd = Infinity;
    for (const n of this.game.npcs) {
      const d = NPCS[n.kind];
      if (d.critter || n.alpha < 0.3 || d.damage <= 0) continue;
      if ((this.ignored.get(n) ?? -1) > this.clock) continue;
      const dist = Math.hypot(n.x + n.w / 2 - cx, n.y + n.h / 2 - cy);
      const bossy = d.boss || (n.head && NPCS[n.head.kind].boss);
      // Ground foes close by; flyers only with a ranged weapon (or when they're right on her).
      const flyer = d.ai === "flyer" || d.ai === "bat" || d.ai === "worm";
      const range = bossy ? 60 * TILE : flyer ? (ranged ? 10 * TILE : 2.5 * TILE) : 7 * TILE;
      if (dist < range && dist < bd) {
        bd = dist;
        best = n;
      }
    }
    return best;
  }

  /** Fight (or get away) if something's on her. Returns her movement, or null when there's no fight. */
  protected fight(a: Agent): Move | null {
    const n = this.threat(a);
    if (!n) {
      a.target = null;
      return null;
    }
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const nx = n.x + n.w / 2;
    const ny = n.y + n.h / 2;
    const toward: -1 | 1 = nx < cx ? -1 : 1;
    // Badly hurt with no potion to drink: get out (recall home).
    if (a.life < a.maxLife * 0.2 && a.potionT > 0 && !NPCS[n.kind].boss) {
      this.recall(a);
      a.target = null;
      return STILL;
    }
    if (!a.target) this.speak(a, "fight");
    a.target = n;
    // A fight that isn't going anywhere (out of reach, can't hurt it): leave it be for a while.
    const owner = n.head ?? n;
    const memo = this.fights.get(a);
    if (!memo || memo.n !== n) this.fights.set(a, { n, since: this.clock, life: owner.life });
    else if (!NPCS[n.kind].boss && (this.clock - memo.since > 25 || (this.clock - memo.since > 12 && owner.life >= memo.life))) {
      this.ignored.set(n, this.clock + 40);
      this.fights.delete(a);
      a.target = null;
      return null;
    }
    const ai = NPCS[n.kind].ai;
    const flying = ai === "flyer" || ai === "bat" || ai === "worm" || ai === "boss" || ny < cy - 3 * TILE;
    const ranged = this.bestWeapon(true);
    const melee = this.bestWeapon(false);
    const useRanged = !!ranged && (flying || !melee || (ranged.damage ?? 0) > (melee.damage ?? 0) * 1.4);
    const weapon = useRanged ? ranged : melee;
    const dist = Math.hypot(nx - cx, ny - cy);
    a.dir = toward;
    let move: -1 | 0 | 1 = 0;
    let jump = false;
    if (!weapon) {
      move = toward > 0 ? -1 : 1; // nothing to fight with: keep away
    } else if (useRanged) {
      if (dist < 5 * TILE) move = toward > 0 ? -1 : 1;
      else if (dist > 15 * TILE) move = toward;
      if (a.cooldown <= 0 && dist < 22 * TILE) {
        const aim = Math.atan2(ny - cy, nx - cx);
        if (this.game.fire(weapon, { x: cx, y: cy }, aim, a)) {
          a.use = { t: 0, item: weapon.id, aim };
          a.cooldown = weapon.useTime ?? 0.5;
        }
      }
    } else {
      const reach = (weapon.reach ?? 32) * 1.1;
      if (Math.abs(nx - cx) > reach * 0.6) move = toward;
      if (ny < cy - TILE * 1.5 && a.onGround) jump = true;
      if (a.cooldown <= 0 && dist < reach + n.w / 2 + 8) {
        this.game.agentMelee(a, weapon, toward, Math.atan2(ny - cy, nx - cx));
        a.use = { t: 0, item: weapon.id, aim: 0 };
        a.cooldown = weapon.useTime ?? 0.4;
      }
    }
    if (move && Math.abs(a.x - a.lastX) < 0.5 && a.onGround) jump = true;
    a.lastX = a.x;
    return { move, jump };
  }

  // ── Breaking things, with the right tool ─────────────────────────────────────────────────

  /**
   * One swing at the tile or furniture at (x, y) with the best tool for it. "missing": no tool
   * that can break it (she sets off to get one); "blocked": it can't or won't break (set aside).
   */
  protected breakAt(a: Agent, x: number, y: number): "hit" | "missing" | "blocked" | "none" {
    const g = this.game;
    const key = y * 65536 + x;
    if ((this.blocked.get(key) ?? -1) > this.clock) return "blocked";
    const req = requirement(g.map, g.objects, x, y);
    if (req.kind === "none") return "none";
    if (req.kind === "blocked") {
      this.setAside(a, key);
      return "blocked";
    }
    if (req.chopCol !== undefined) return this.chopTree(a, req.chopCol);
    const tool = bestTool(g.inventory, req.tool, req.power);
    if (!tool) {
      this.needTool(a, req.tool, req.power);
      return "missing";
    }
    const power = tool.power ?? 35;
    if (!this.countHit(a, key, hitsToMine(g.map.tile(x, y), power) * 2 + 4)) return "blocked";
    this.swing(a, x, tool.id, ACT_TIME);
    if (g.dig(x, y, power)) {
      this.hits.delete(key);
      this.useful(a);
      // A climbing stack comes down from wherever it's cut: everything stacked on it falls too.
      if (this.scaffold.delete(key))
        for (let up = y - 1; this.scaffold.delete(up * 65536 + x); up--) {
          const t = g.map.tile(x, up);
          if (t !== T.Dirt && t !== T.Stone) break;
          g.map.set(x, up, T.Air);
          g.changed.push({ x, y: up });
          g.dropItem(t === T.Dirt ? 2 : 3, 1, x * TILE + 8, up * TILE + 8);
        }
    }
    return "hit";
  }

  /** One axe swing at a tree (or cactus) in column `col`. */
  protected chopTree(a: Agent, col: number): "hit" | "missing" | "blocked" | "none" {
    const g = this.game;
    const m = g.map;
    if (!m.tree(col) && !m.cactus(col)) return "none";
    const key = -1 - col;
    if ((this.blocked.get(key) ?? -1) > this.clock) return "blocked";
    const tool = bestTool(g.inventory, "axe");
    if (!tool) {
      this.needTool(a, "axe", 0);
      return "missing";
    }
    if (!this.countHit(a, key, Math.ceil(100 / (tool.power ?? 35)) * 2 + 4)) return "blocked";
    this.swing(a, col, tool.id, ACT_TIME * 1.6);
    if (g.chop(col, this.trunkRow(a, col), tool.power ?? 35)) {
      this.hits.delete(key);
      this.treeMarks.delete(col);
      this.useful(a);
    }
    return "hit";
  }

  /** Count a swing; past the limit the target is set aside instead (no endless swinging). */
  protected countHit(a: Agent, key: number, limit: number): boolean {
    const n = (this.hits.get(key) ?? 0) + 1;
    if (n > limit) {
      this.hits.delete(key);
      this.setAside(a, key);
      return false;
    }
    this.hits.set(key, n);
    return true;
  }

  protected setAside(a: Agent, key: number) {
    if ((this.blocked.get(key) ?? -1) > this.clock) return;
    this.blocked.set(key, this.clock + BLOCK_TIME);
    this.stats.setAside++;
    this.tell(a, "That one won't budge. I'll work around it.");
  }

  protected swing(a: Agent, x: number, item: number, time: number) {
    this.stats.swings++;
    a.use = { t: 0, item, aim: 0 };
    a.cooldown = time;
    a.dir = x * TILE + 8 < a.x + a.w / 2 ? -1 : 1;
  }

  /** She can't break something for lack of a tool: get one (or wait for whoever is). */
  protected needTool(a: Agent, tool: ToolKind, power: number) {
    if (a.outer || (a.job?.kind === "gather" && a.job.tool) || a.job?.kind === "wait") return; // already on an errand
    const busy = this.acquiring.get(tool);
    if (busy && busy !== a && busy.job?.kind === "gather" && busy.job.tool === tool) {
      a.job = { kind: "wait", until: this.clock + 6, tool, why: `waiting for ${tool === "axe" ? "an" : "a"} ${tool}` };
      return;
    }
    const plan = planTool(tool, power, this.ctx());
    if (!plan) {
      this.cantGet(a, tool);
      return;
    }
    this.acquiring.set(tool, a);
    a.job = { kind: "gather", item: plan.item, count: 1, why: `a ${tool}`, sub: null, resume: a.job, told: "", tool, power };
  }

  /** No way to get the tool: ask Master (now and then, not every second) and wait. */
  protected cantGet(a: Agent, tool: ToolKind) {
    if (this.acquiring.get(tool) === a) this.acquiring.delete(tool);
    this.noTool.set(tool, this.clock + ASK_WAIT * 3);
    // Ask, then ask less and less often (45 s, 90 s, 3 min, then every 5 min).
    const last = this.lastAsk.get(tool) ?? { at: -Infinity, n: 0 };
    if (this.clock - last.at > Math.min(300, ASK_EVERY * 2 ** last.n)) {
      this.lastAsk.set(tool, { at: this.clock, n: last.n + 1 });
      this.stats.asked++;
      const an = tool === "axe" ? "an" : "a";
      this.tell(a, `I can't make ${an} ${tool} with what we have. Could you put one in the inventory?`, 6);
    }
    a.job = { kind: "wait", until: this.clock + ASK_WAIT, tool, why: `waiting for ${tool === "axe" ? "an" : "a"} ${tool}` };
  }

  // ── Getting things (the planner's steps) ─────────────────────────────────────────────────

  protected ctx(): PlanContext {
    return { inv: this.game.inventory, stations: this.homeStations(), unavailable: this.unavailable, shop: this.shop, coins: this.game.coins };
  }

  /** Stations near home (the crafting area). */
  homeStations(): Set<Station> {
    const h = this.homeTile();
    return this.game.objects.stationsNear(h.x, h.y - 3, 34, 14);
  }

  homeTile(): { x: number; y: number } {
    const h = this.agents[0]?.home ?? { x: 0, y: 0 };
    return { x: Math.floor(h.x / TILE), y: Math.floor(h.y / TILE) };
  }

  protected doGather(a: Agent, job: Extract<Job, { kind: "gather" }>): Move {
    if (job.sub) return this.runSub(a, job);
    const g = this.game;
    if (countOf(g.inventory, job.item) >= job.count) return this.gathered(a, job);
    // Planning is a search over recipes: redo it when the inventory changes (or every couple of seconds).
    const ver = g.version;
    if (!job.plan || job.plan.ver !== ver || this.clock - job.plan.at > 2) job.plan = { at: this.clock, ver, result: job.tool ? planTool(job.tool, job.power ?? 0, this.ctx()) : planItem(job.item, job.count, this.ctx()) };
    const plan = job.plan.result;
    if (!plan) {
      if (job.tool) this.cantGet(a, job.tool);
      else {
        // Impossible because a tool is missing (an axe for wood, a pickaxe for stone)? Say so.
        const tool = this.blockingTool(job.item);
        if (tool) {
          this.cantGet(a, tool);
          return STILL;
        }
        this.unavailable.add(job.item);
        a.job = job.resume;
      }
      return STILL;
    }
    if (!plan.step) return this.gathered(a, job);
    const step: Step = plan.step;
    const name = itemDef(job.item)?.name ?? "it";
    switch (step.do) {
      case "gather": {
        const what = itemDef(step.id)?.name ?? "materials";
        const told = step.id === job.item ? "" : `${what} for ${name}`;
        if (job.told !== told) {
          job.told = told;
          if (job.tool && job.resume) this.tell(a, `No ${job.tool} that can break this. I'll make a ${name}. First, ${what.toLowerCase()}.`, 4.5);
          else if (told) this.tell(a, `Need ${what.toLowerCase()} for the ${name}. On my way.`, 3.5);
          else this.speak(a, step.source.from === "tree" ? "wood" : step.source.from === "mine" ? "stone" : "build");
        }
        job.sub = this.gatherJob(a, step.id, step.count, step.source);
        if (!job.sub) this.unavailable.add(step.id); // none around: the next plan works around it
        return STILL;
      }
      case "buy": {
        const at = this.npcAt(step.npc);
        if (!at) {
          this.unavailable.add(step.id);
          return STILL;
        }
        if (Math.abs((a.x + a.w / 2 - at.x) / TILE) > 2) return this.walkTo(a, Math.floor(at.x / TILE));
        if (g.coins >= step.price * step.count) {
          // Only what fits in the bags is paid for.
          const left = addItem(g.inventory, step.id, step.count);
          if (left >= step.count) {
            this.tidy();
            this.unavailable.add(step.id);
            return STILL;
          }
          g.coins -= step.price * (step.count - left);
          g.version++;
          this.tell(a, `Bought ${step.count > 1 ? `${step.count} ` : ""}${itemDef(step.id)?.name ?? "it"}!`, 3);
          this.useful(a);
        } else this.unavailable.add(step.id);
        return STILL;
      }
      case "altar": {
        const alt = this.nearestObject(a, "altar");
        if (!alt) {
          this.unavailable.add(step.id);
          a.job = job.resume;
          return STILL;
        }
        if (Math.abs((a.x + a.w / 2) / TILE - (alt.x + 1)) > 3 || Math.abs((a.y + a.h) / TILE - (alt.y + 2)) > 4) return this.navTo(a, alt.x + 1, alt.y + 1) ?? STILL;
        if (this.craft(step.id, true)) this.crafted(a, step.id);
        else this.unavailable.add(step.id);
        return STILL;
      }
      default:
        break;
    }
    // Crafting and placing stations happen at home; recall if she's down a mine.
    if (this.underground(a) && !this.nearHome(a)) {
      this.recall(a);
      return STILL;
    }
    const home = this.homeTile();
    if (Math.abs((a.x + a.w / 2) / TILE - home.x) > 14) return this.walkTo(a, home.x);
    if (a.cooldown > 0) return STILL;
    if (step.do === "place") {
      if (!this.placeStation(a, step.station)) a.cooldown = 1;
      return STILL;
    }
    if (this.craft(step.id)) this.crafted(a, step.id);
    else a.cooldown = 1;
    return STILL;
  }

  /** The tool whose absence makes an item impossible (looking at its source and recipe). */
  protected blockingTool(id: number, depth = 0): ToolKind | null {
    if (depth > 3) return null;
    const src = SOURCES[id];
    if (src) {
      const tool: ToolKind | null = src.from === "tree" || src.from === "cactus" ? "axe" : src.from === "mine" ? "pickaxe" : null;
      if (tool && !bestTool(this.game.inventory, tool) && !planTool(tool, 0, this.ctx())) return tool;
    }
    const r = recipeFor(id);
    for (const [ing] of r?.ingredients ?? []) {
      if (countOf(this.game.inventory, ing) > 0) continue;
      const t = this.blockingTool(ing, depth + 1);
      if (t) return t;
    }
    return null;
  }

  private crafted(a: Agent, id: number) {
    this.useful(a);
    this.stats.crafted.push(id);
    a.use = { t: 0, item: id, aim: 0 };
    a.cooldown = ACT_TIME * 2;
    this.game.texts.push({ x: a.x + a.w / 2, y: a.y - 6, text: `Crafted ${itemDef(id)?.name ?? "item"}`, color: "#ffe9a8", age: 0 });
  }

  private gathered(a: Agent, job: Extract<Job, { kind: "gather" }>): Move {
    if (job.tool) {
      if (this.acquiring.get(job.tool) === a) this.acquiring.delete(job.tool);
      this.tell(a, `${itemDef(job.item)?.name ?? "It's"} in hand. Back to work.`);
    }
    a.job = job.resume;
    return STILL;
  }

  /** Run her errand's sub-job as if it were her job, then hand control back. */
  protected runSub(a: Agent, job: Extract<Job, { kind: "gather" }>): Move {
    const sub = job.sub!;
    a.outer = job;
    a.job = sub;
    let r: Move = STILL;
    switch (sub.kind) {
      case "wood":
        r = this.doWood(a, sub);
        break;
      case "fetch":
        r = this.doFetch(a, sub);
        break;
      case "mine":
        r = this.doMine(a, sub);
        break;
      case "hunt":
        r = this.doHunt(a, sub);
        break;
      case "harvest":
        r = this.doHarvest(a, sub);
        break;
      case "stars":
        r = this.doStars(a, sub);
        break;
    }
    const finished = a.job !== sub;
    a.job = job;
    a.outer = null;
    if (finished) job.sub = null;
    return r;
  }

  protected gatherJob(a: Agent, id: number, count: number, src: Source): Job | null {
    const m = this.game.map;
    const ax = Math.floor((a.x + a.w / 2) / TILE);
    switch (src.from) {
      case "tree":
      case "cactus": {
        const cactus = src.from === "cactus";
        const kinds = src.from === "tree" ? src.kinds : [];
        const range = cactus ? 1600 : kinds.includes("forest") ? 1200 : 2600;
        // Nearest first. Ones far past the nearest (TREE_MARGIN) wait until nothing closer is
        // left, and a chest with some in it comes before them.
        let nearest = -1;
        let far: number | null = null;
        search: for (let d = 0; d < range; d++)
          for (const x of [ax + d, ax - d]) {
            if (x < 2 || x >= m.size.width - 2) continue;
            if (!(cactus ? m.cactus(x) : m.tree(x) && kinds.includes(m.treeKind(x)))) continue;
            if (nearest < 0) nearest = d;
            if ((this.blocked.get(-1 - x) ?? -1) > this.clock || this.treeMarked(x) || !this.goodTree(x)) continue;
            // (Trees a build will chop anyway count too: the wood's as good, and it's one less to clear.)
            if (d <= nearest + TREE_MARGIN) return { kind: "wood", tree: x, cactus };
            far = x;
            break search;
          }
        const chest = this.chestWith(a, id);
        if (chest) return { kind: "fetch", x: chest.x, y: chest.y, item: id, count, since: this.clock };
        if (far !== null) {
          this.tell(a, "No suitable trees nearby. I'll look further out.", 3.5);
          return { kind: "wood", tree: far, cactus, far: true };
        }
        return null;
      }
      case "mine": {
        const site = this.mineSite(a, src.tiles);
        if (!site) return null;
        const i = this.agents.indexOf(a);
        return { kind: "mine", dir: i % 2 === 0 ? 1 : -1, started: false, steps: 0, tiles: src.tiles, item: id, count, start: site.x, maxDepth: site.depth, site };
      }
      case "kill": {
        const at = this.huntingGround(a, src.npcs);
        if (at === null) return null;
        return { kind: "hunt", npcs: src.npcs, item: id, count, until: this.clock + 150, at };
      }
      case "harvest":
        if (!this.nearestObject(a, src.objects[0].t, src.objects[0].style)) return null;
        return { kind: "harvest", item: id, count, t: src.objects[0].t, style: src.objects[0].style };
      case "stars":
        return { kind: "stars", item: id, count, until: this.clock + 200 };
    }
  }

  /** Where to dig for a kind of block: the nearest place it shows up near the surface (or below). */
  protected mineSite(a: Agent, tiles: number[]): { x: number; y: number; depth: number } | null {
    const m = this.game.map;
    const home = this.homeTile();
    const want = new Set(tiles);
    const deepOre = tiles.some((t) => t === T.Iron || t === T.Silver || t === T.Gold || t === T.Demonite);
    const hell = tiles.some((t) => t === T.Ash || t === T.Hellstone || t === T.Obsidian);
    const sky = tiles.some((t) => t === T.Cloud || t === T.Sunplate);
    if (hell) {
      const sh = [...this.projects.values()].find((p) => p.kind === "shaft" && this.isDone(p));
      if (!sh) return null;
      return { x: sh.door.x, y: HELL_TOP + 30, depth: 999 };
    }
    if (sky) {
      for (const s of m.structures) {
        if (s.kind !== "island") continue;
        if ([...this.projects.values()].some((p) => p.kind === "ladder" && this.isDone(p) && Math.abs(p.door.x - s.x1) < 8)) return { x: Math.floor((s.x0 + s.x1) / 2), y: s.y0 + 12, depth: 999 };
      }
      return null;
    }
    const maxDepth = deepOre ? 170 : tiles.includes(T.Copper) ? 70 : 30;
    const start = Math.floor((a.x + a.w / 2) / TILE);
    for (let d = 0; d < 2200; d += 3)
      for (const x of [start + d, start - d]) {
        if (x < 140 || x >= m.size.width - 140) continue;
        // Mines stay well away from home and the town (which grows to the left of it), and builds.
        if ((x > home.x - 110 && x < home.x + 50) || this.nearAnyProject(x, 12)) continue;
        const top = m.surface(x);
        for (let y = top; y < top + maxDepth; y += 2) if (want.has(m.tile(x, y))) return { x, y, depth: Math.max(14, y - top + 6) };
      }
    return null;
  }

  /** A column where the creatures that drop something live. */
  protected huntingGround(a: Agent, kinds: NpcKind[]): number | null {
    const m = this.game.map;
    const ax = Math.floor((a.x + a.w / 2) / TILE);
    const zones: Partial<Record<NpcKind, string>> = {
      eaterOfSouls: "corruption",
      devourerHead: "corruption",
      hornet: "jungle",
      manEater: "jungle",
      snatcher: "jungle",
      jungleSlime: "jungle",
      vulture: "desert",
      sandSlime: "desert",
      iceSlime: "snow",
      voodooDemon: "underworld",
      angryBones: "dungeon",
    };
    const want = new Set(kinds.map((k) => zones[k] ?? "forest"));
    if (want.has("underworld") || want.has("dungeon")) return null; // the director handles those trips
    for (let d = 0; d < 2400; d += 8) for (const x of [ax + d, ax - d]) if (x > 150 && x < m.size.width - 150 && want.has(m.biome(x))) return x;
    return null;
  }

  /** Inside the dungeon, which can't be dug into (or walked into) until Skeletron is beaten. */
  protected sealed(x: number, y: number): boolean {
    if (this.game.bosses.skeletron) return false;
    return this.game.map.structures.some((s) => s.kind === "dungeon" && x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
  }

  protected nearestObject(a: Agent, t: ObjectType, style?: number) {
    const ax = Math.floor((a.x + a.w / 2) / TILE);
    const ay = Math.floor(a.y / TILE);
    if (t === "crystal") {
      // Life crystals are generated one per band: look through the nearby bands (not under a build).
      for (let d = 0; d < 30; d++)
        for (const b of [Math.floor(ax / 70) + d, Math.floor(ax / 70) - d]) {
          const c = this.game.objects.crystalInBand(b);
          if (c && !this.inAnyFootprint(c.x, 0, true) && !this.inAnyFootprint(c.x + 1, 0, true) && !((this.blocked.get(-100000 - c.x) ?? -1) > this.clock) && !this.sealed(c.x, c.y)) return c;
        }
      return null;
    }
    let best = null as null | { x: number; y: number; t: ObjectType };
    let bd = Infinity;
    for (const o of this.game.objects.placed) {
      if (o.t !== t || (style !== undefined && (o.style ?? 0) !== style)) continue;
      if (this.sealed(o.x, o.y) || (this.blocked.get(-200000 - o.x) ?? -1) > this.clock) continue;
      const d = Math.abs(o.x - ax) + Math.abs(o.y - ay) * 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Craft an item from the team's materials at stations near home (or, `here`, near any of them). */
  protected craft(id: number, here = false): boolean {
    const r = recipeFor(id);
    if (!r) return false;
    const stations = here ? new Set<Station>([...this.homeStations(), ...this.stationsNearAgents()]) : this.homeStations();
    if (r.station && !stations.has(r.station)) return false;
    if (!r.ingredients.every(([i, n]) => countOf(this.game.inventory, i) >= n)) return false;
    for (const [i, n] of r.ingredients) this.game.removeFromInventory(i, n);
    addItem(this.game.inventory, r.result, r.count);
    this.game.version++;
    return true;
  }

  private stationsNearAgents(): Set<Station> {
    const out = new Set<Station>();
    for (const a of this.agents) for (const s of this.game.objects.stationsNear((a.x + a.w / 2) / TILE, (a.y + a.h / 2) / TILE, 5, 4)) out.add(s);
    return out;
  }

  /** Put a crafting station down near home (its spot in a blueprint, or a free spot on the ground). */
  protected placeStation(a: Agent, station: Station): boolean {
    const g = this.game;
    const home = this.homeTile();
    const item = STATION_ITEM[station];
    if (!item) return false;
    const t = station as ObjectType;
    for (const p of this.projects.values())
      for (const task of p.tasks)
        if (task.kind === "object" && task.obj === t && Math.abs(task.x - home.x) < 34 && g.objects.canPlace(t, task.x, task.y)) return this.put(a, t, task.x, task.y, item);
    for (let d = 3; d < 30; d++)
      for (const x of [home.x - d, home.x + d]) {
        if (this.inAnyFootprint(x, 0, true)) continue;
        for (let y = home.y - 10; y <= home.y + 6; y++) if (g.objects.canPlace(t, x, y)) return this.put(a, t, x, y, item);
      }
    return false;
  }

  private put(a: Agent, t: ObjectType, x: number, y: number, item: number): boolean {
    const g = this.game;
    if (!g.objects.place(t, x, y)) return false;
    g.removeFromInventory(item, 1);
    g.worldVersion++;
    a.use = { t: 0, item, aim: 0 };
    a.cooldown = ACT_TIME * 2;
    this.tell(a, `${itemDef(item)?.name ?? "Station"} set up!`, 3);
    return true;
  }

  /** Within `pad` columns of any project. */
  protected nearAnyProject(x: number, pad: number): boolean {
    for (const p of this.projects.values()) if (p.kind !== "shaft" && p.kind !== "ladder" && x >= p.x0 - pad && x <= p.x1 + pad) return true;
    return false;
  }

  /** Inside any building project's footprint (keep stations and mines out of the way). */
  protected inAnyFootprint(x: number, y: number, column = false): boolean {
    for (const p of this.projects.values()) {
      if (p.kind === "shaft" || p.kind === "ladder") continue;
      if (x >= p.x0 - 2 && x <= p.x1 + 2 && (column || (y >= p.y0 - 2 && y <= p.y1 + 3))) return true;
    }
    return false;
  }

  /** Down in the ground under a build (below its lowest floor), where nothing of it is planned. */
  protected underBuild(x: number, y: number): boolean {
    for (const p of this.projects.values()) {
      if (p.kind === "shaft" || p.kind === "ladder") continue;
      if (x < p.x0 - 2 || x > p.x1 + 2 || y < p.y0 - 2 || y > p.y1 + 3) continue;
      const low = p.floors.length ? Math.max(...p.floors.map((f) => f.y)) : p.y1;
      if (y <= low || p.planned.has(y * 65536 + x)) return false;
    }
    return true;
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────────────────────

  protected doWood(a: Agent, job: Extract<Job, { kind: "wood" }>): Move {
    const m = this.game.map;
    // Trees grow on the surface: from a tunnel, mirror home first (at most every 20 s; walking
    // digs its way up otherwise).
    if (this.underground(a) && Math.abs((a.x + a.w / 2) / TILE - job.tree) > 6 && this.clock - (this.recalled.get(a) ?? -99) > 20) {
      this.recall(a);
      return STILL;
    }
    const ground = m.surface(job.tree);
    const there = job.cactus ? m.cactus(job.tree) : m.tree(job.tree);
    if (!there || (this.blocked.get(-1 - job.tree) ?? -1) > this.clock || this.treeMarked(job.tree)) {
      a.job = null;
      return STILL;
    }
    const near = Math.abs((a.x + a.w / 2) / TILE - job.tree) < 3;
    if (near && this.canReach(a, job.tree, this.trunkRow(a, job.tree))) {
      job.beside = undefined;
      a.sinceBetter = 0;
      if (a.cooldown <= 0) {
        const r = this.chopTree(a, job.tree);
        if (r === "blocked") this.markTree(a, job.tree, "This one won't come down. I'll find another tree.");
        if (r === "none" || r === "blocked") a.job = null;
      }
      return STILL;
    }
    // Walking and not getting any closer (no way round, or only through a build or a structure).
    const dist = Math.abs((a.x + a.w / 2) / TILE - job.tree);
    // (Time spent away from it, fighting or fleeing, doesn't count.)
    const away = this.clock - (job.seen ?? this.clock) > 1;
    job.seen = this.clock;
    if (away && job.beside !== undefined) job.beside = this.clock;
    if (job.best === undefined || dist < job.best - 1 || away) {
      job.best = dist;
      job.bestAt = this.clock;
    } else if (this.clock - (job.bestAt ?? this.clock) > TREE_STALL) {
      this.markTree(a, job.tree, "I can't get to that tree. I'll find another one.");
      a.job = null;
      return STILL;
    }
    if (near) {
      // Beside the trunk but up on a ledge or down in a hole: down (or up) to its base, not the
      // branches. No way there, or not there after a while: another tree.
      job.beside ??= this.clock;
      const r = this.clock - job.beside > TREE_BESIDE ? null : this.toTreeBase(a, job.tree, ground);
      if (r === null) {
        this.markTree(a, job.tree, "I can't reach the bottom of that tree. I'll find another one.");
        a.job = null;
        return STILL;
      }
      return r;
    }
    job.beside = undefined;
    return this.walkTo(a, job.tree + (a.x / TILE < job.tree ? -1 : 1));
  }

  /** The row of a tree's (or cactus's) trunk nearest to her: where she swings her axe. */
  trunkRow(a: Agent, col: number): number {
    const m = this.game.map;
    const ground = m.surface(col);
    const h = m.tree(col) || m.cactus(col) || 2;
    const cy = Math.round((a.y + a.h / 2) / TILE);
    return Math.max(ground - h, Math.min(ground - 1, cy));
  }

  /** A tree worth going for: room to stand beside its trunk's base, and not up on a sky island. */
  protected goodTree(x: number): boolean {
    const m = this.game.map;
    const ground = m.surface(x);
    if (ground < SKY_LINE) return false;
    return this.baseSpots(x, ground).length > 0;
  }

  /** Standing spots by a trunk's base, close ones first (the body's left column; feet row). */
  private baseSpots(x: number, ground: number): NavNode[] {
    const m = this.game.map;
    const out: NavNode[] = [];
    for (const nx of [x - 1, x, x - 2, x + 1, x - 3, x + 2]) for (const dy of [0, -1, 1, -2, 2, -3]) if (canStand(m, nx, ground - 1 + dy)) out.push({ x: nx, y: ground - 1 + dy });
    return out;
  }

  /** Route to a spot at a trunk's base (from a ledge above it or a hole below); null if there's none. */
  protected toTreeBase(a: Agent, x: number, ground: number): Move | null {
    if (!a.path || a.pathGoal !== -1 - x) {
      const from = { x: Math.round((a.x + a.w / 2) / TILE) - 1, y: Math.floor((a.y + a.h - 1) / TILE) };
      let path: NavNode[] | null = null;
      for (const spot of this.baseSpots(x, ground)) if ((path = findPath(this.game.map, from, spot.x, spot.y, 3000, 40))) break;
      if (!path) return null;
      a.path = path.slice(1);
      a.pathGoal = -1 - x;
      a.pathAt = this.clock;
    }
    return this.followPath(a) ?? STILL;
  }

  /** Whether the team is still leaving this tree alone after failing on it. */
  treeMarked(x: number): boolean {
    const k = this.treeMarks.get(x);
    if (!k) return false;
    return k.day !== undefined ? this.game.day <= k.day : k.until > this.clock;
  }

  /** She couldn't get to (or fell) this tree: everyone leaves it alone a while, longer each time. */
  protected markTree(a: Agent, x: number, why: string) {
    const fails = (this.treeMarks.get(x)?.fails ?? 0) + 1;
    const wait = TREE_WAITS[fails - 1];
    this.treeMarks.set(x, wait === undefined ? { fails, until: 0, day: this.game.day } : { fails, until: this.clock + wait });
    if (this.treeMarks.size > 500)
      for (const [c] of this.treeMarks) {
        if (!this.treeMarked(c)) this.treeMarks.delete(c);
        if (this.treeMarks.size <= 400) break;
      }
    this.stats.treesMarked++;
    a.path = null;
    this.tell(a, why, 3.5);
  }

  /** The catch-alls gave up on her: if she was after a tree, that tree is why. */
  private giveUpTree(a: Agent) {
    const j = a.job?.kind === "wood" ? a.job : a.job?.kind === "gather" && a.job.sub?.kind === "wood" ? a.job.sub : null;
    if (j?.kind === "wood" && !this.treeMarked(j.tree)) this.markTree(a, j.tree, "I'm getting nowhere with that tree. Another one, then.");
  }

  saveTreeMarks(): TreeMarkSave[] {
    return [...this.treeMarks].map(([x, k]): TreeMarkSave => (k.day !== undefined ? [x, k.fails, 0, k.day] : [x, k.fails, Math.max(0, Math.round(k.until - this.clock))]));
  }

  loadTreeMarks(raw: unknown) {
    if (!Array.isArray(raw)) return;
    for (const e of raw.slice(0, 500)) {
      if (!Array.isArray(e)) continue;
      const [x, fails, left, day] = e as unknown[];
      if (!Number.isInteger(x) || !Number.isInteger(fails) || (fails as number) < 1 || (fails as number) > 99 || typeof left !== "number" || !(left >= 0)) continue;
      this.treeMarks.set(x as number, Number.isInteger(day) ? { fails: fails as number, until: 0, day: day as number } : { fails: fails as number, until: this.clock + Math.min(left, 3600) });
    }
  }

  /**
   * The nearest chest with some of an item in it that the team may take from: their own (inside
   * a build), or one in a world structure they've already opened. Never Master's.
   */
  protected chestWith(a: Agent, id: number): WorldObject | null {
    const g = this.game;
    const ax = (a.x + a.w / 2) / TILE;
    let best: WorldObject | null = null;
    for (const o of g.objects.placed) {
      if (!OBJECTS[o.t].storage || o.t === "piggybank" || o.t === "safe" || o.loot || !o.items?.some((s) => s?.id === id)) continue;
      if ((this.blocked.get(-300000 - o.x) ?? -1) > this.clock) continue;
      const own = [...this.projects.values()].some((p) => o.x >= p.x0 && o.x <= p.x1 && o.y >= p.y0 && o.y <= p.y1);
      if (!own && !structureAt(g.map.structures, o.x, o.y)) continue;
      if (!best || Math.abs(o.x - ax) < Math.abs(best.x - ax)) best = o;
    }
    return best;
  }

  /** Walk to a chest and take what's needed out of it. */
  protected doFetch(a: Agent, job: Extract<Job, { kind: "fetch" }>): Move {
    const g = this.game;
    const have = countOf(g.inventory, job.item);
    const o = g.objects.at(job.x, job.y);
    if (have >= job.count || !o?.items?.some((s) => s?.id === job.item)) {
      a.job = null;
      return STILL;
    }
    const cx = (a.x + a.w / 2) / TILE;
    const feet = (a.y + a.h) / TILE;
    if (Math.abs(cx - (o.x + 1)) > 2.5 || Math.abs(feet - (o.y + 2)) > 3) {
      const r = this.clock - job.since > 120 ? null : this.navTo(a, o.x, o.y + 1);
      if (r === null) {
        this.blocked.set(-300000 - o.x, this.clock + 300);
        a.job = null;
        return STILL;
      }
      return r;
    }
    let took = 0;
    for (let i = 0; i < o.items.length && have + took < job.count; i++) {
      const s = o.items[i];
      if (s?.id !== job.item) continue;
      const want = Math.min(s.count, job.count - have - took);
      const moved = want - addItem(g.inventory, s.id, want);
      took += moved;
      o.items[i] = s.count > moved ? { id: s.id, count: s.count - moved } : null;
      if (moved < want) break; // the bags are full
    }
    if (took) {
      g.version++;
      g.worldVersion++;
      this.useful(a);
      this.tell(a, `Took ${took} ${itemDef(job.item)?.name ?? "of them"} from the chest.`, 3);
    } else this.blocked.set(-300000 - o.x, this.clock + 300);
    a.cooldown = ACT_TIME * 2;
    a.job = null;
    return STILL;
  }

  /** A staircase mine: step down and over, digging out headroom; blocks (and ore in reach) pile up. */
  protected doMine(a: Agent, job: Extract<Job, { kind: "mine" }>): Move {
    const g = this.game;
    if (countOf(g.inventory, job.item) >= job.count) {
      a.job = null;
      return STILL;
    }
    if (job.steps > 420) {
      this.unavailable.add(job.item);
      a.job = null;
      return STILL;
    }
    const m = g.map;
    const fx = Math.floor((a.x + a.w / 2) / TILE);
    // First get to the site (walking; down the hellevator; up a ladder).
    if (!job.started) {
      const site = job.site ?? { x: job.start, y: m.surface(job.start) };
      const deep = site.y > HELL_TOP - 10 || site.y < SKY_LINE;
      const feet = (a.y + a.h) / TILE;
      if (Math.abs(fx - site.x) > 1 || (deep && Math.abs(feet - site.y) > 30)) {
        const r = this.navTo(a, site.x, deep ? site.y : m.surface(site.x));
        if (r === null) {
          this.unavailable.add(job.item);
          a.job = null;
          return STILL;
        }
        if (r !== STILL || Math.abs(fx - site.x) > 1) return r;
      }
      job.started = true;
      job.start = fx;
    }
    if (!a.onGround || a.cooldown > 0) return STILL;
    const f = Math.floor((a.y + a.h + 1) / TILE); // the row we stand on
    const want = new Set(job.tiles);
    // Wanted blocks in reach are mined first, like a Terraria player would.
    const cy = Math.floor((a.y + a.h / 2) / TILE);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = fx + dx;
        const y = cy + dy;
        if (want.has(m.tile(x, y)) && (this.blocked.get(y * 65536 + x) ?? -1) <= this.clock && !this.inAnyFootprint(x, y) && !this.isBuilt(x, y)) {
          const r = this.breakAt(a, x, y);
          if (r === "hit") return STILL;
        }
      }
    const nx = fx + job.dir;
    // A gentle staircase: one step down every two columns, with headroom.
    const surfaceY = m.surface(job.start);
    const deepEnough = f - surfaceY >= job.maxDepth || f >= m.size.height - 8;
    const down = job.steps % 2 === 1 && !deepEnough;
    const rows = down ? [f - 3, f - 2, f - 1, f] : [f - 3, f - 2, f - 1];
    for (const y of rows) {
      if (this.inAnyFootprint(nx, y) || this.isBuilt(nx, y) || m.liquid(nx, y) === T.Lava) {
        job.dir = job.dir < 0 ? 1 : -1;
        job.turns = (job.turns ?? 0) + 1;
        if (job.turns > 3) a.job = null;
        return STILL;
      }
      if (m.solid(nx, y) || g.objects.at(nx, y)) {
        a.dir = job.dir;
        const r = this.breakAt(a, nx, y);
        if (r === "blocked") {
          // Something in the way that won't break: dig the other way instead (then give up).
          job.turns = (job.turns ?? 0) + 1;
          job.dir = job.dir < 0 ? 1 : -1;
          job.steps = 0;
          if (job.turns > 2) a.job = null;
        }
        return STILL;
      }
    }
    // The step ahead is open: walk into it.
    const ahead = Math.floor((a.x + a.w / 2 + job.dir * 8) / TILE);
    if (ahead !== fx) job.steps++;
    return { move: job.dir, jump: false };
  }

  protected doHunt(a: Agent, job: Extract<Job, { kind: "hunt" }>): Move {
    if (countOf(this.game.inventory, job.item) >= job.count || this.clock > job.until) {
      a.job = null;
      return STILL;
    }
    // Go where they live and roam there; fighting happens on its own when they show up.
    const fx = (a.x + a.w / 2) / TILE;
    if (Math.abs(fx - job.at) > 10) return this.walkTo(a, job.at);
    return this.walkTo(a, job.at + Math.round(Math.sin(this.clock / 5 + this.agents.indexOf(a)) * 8));
  }

  protected doHarvest(a: Agent, job: Extract<Job, { kind: "harvest" }>): Move {
    if (countOf(this.game.inventory, job.item) >= job.count) {
      a.job = null;
      return STILL;
    }
    const o = this.nearestObject(a, job.t, job.style);
    if (!o) {
      this.unavailable.add(job.item);
      a.job = null;
      return STILL;
    }
    if (!this.canReach(a, o.x, o.y) || Math.abs((a.x + a.w / 2) / TILE - o.x) > 3) {
      // Not getting any closer to it (walled in by blocks she can't break, say): leave it for a
      // good while. Every couple of tiles closer gives it another half a minute.
      const dist = Math.abs((a.x + a.w / 2) / TILE - o.x) + Math.abs((a.y + a.h) / TILE - o.y);
      if (job.at !== o.x || dist < (job.best ?? Infinity) - 2) {
        job.at = o.x;
        job.since = this.clock;
        job.best = dist;
      } else if (this.clock - (job.since ?? this.clock) > 30) {
        this.blocked.set(o.t === "crystal" ? -100000 - o.x : -200000 - o.x, this.clock + 900);
        a.job = null;
        return STILL;
      }
      const r = this.navTo(a, o.x, o.y + 1);
      if (r === null) {
        this.unavailable.add(job.item);
        a.job = null;
        return STILL;
      }
      return r;
    }
    if (a.cooldown > 0) return STILL;
    const obj = this.game.objects.at(o.x, o.y);
    if (obj) {
      this.swing(a, o.x, 3509, ACT_TIME);
      this.game.takeObject(obj);
    }
    return STILL;
  }

  protected doStars(a: Agent, job: Extract<Job, { kind: "stars" }>): Move {
    const g = this.game;
    if (countOf(g.inventory, job.item) >= job.count || this.clock > job.until) {
      a.job = null;
      return STILL;
    }
    if (!g.night) return this.doRest(a);
    const star = g.drops.find((d) => d.id === 75);
    if (star) return this.walkTo(a, Math.floor((star.x + 6) / TILE));
    return this.doRest(a);
  }

  /** Travel to a place (and stay a moment, for discovering it or meeting someone). */
  protected doGo(a: Agent, job: Extract<Job, { kind: "go" }>): Move {
    const fx = (a.x + a.w / 2) / TILE;
    const fy = (a.y + a.h) / TILE;
    const here = Math.abs(fx - job.x) < 3 && (job.y === undefined || Math.abs(fy - job.y) < 8);
    if (here || this.clock > job.until) {
      const g = job.goal ? this.goals.find((x) => x.id === job.goal) : undefined;
      if (g && g.kind === "go") {
        if (here) g.arrive?.(a);
        else g.giveUp?.(a);
      }
      a.job = null;
      return STILL;
    }
    const r = this.navTo(a, job.x, job.y ?? this.game.map.surface(job.x));
    if (r === null) {
      a.job = null;
      return STILL;
    }
    return r;
  }

  protected doWait(a: Agent, job: Extract<Job, { kind: "wait" }>): Move {
    // A tool turned up (Master gave one, or a teammate made it): get going again now.
    if (this.clock >= job.until || (job.tool && bestTool(this.game.inventory, job.tool))) {
      a.job = null;
      return STILL;
    }
    return this.doRest(a);
  }

  protected doRest(a: Agent): Move {
    if (this.underground(a) && !this.nearHome(a)) this.recall(a);
    const home = this.homeTile();
    const spot = home.x + 2 + Math.round((this.clock / 6 + this.agents.indexOf(a) * 2) % 9);
    const cx = (a.x + a.w / 2) / TILE;
    if (Math.abs(cx - spot) > 1) return this.walkTo(a, spot);
    return STILL;
  }

  // ── Building ──────────────────────────────────────────────────────────────────────────────

  /** Her claimed task if it's still open, else the first open task nobody else has claimed. */
  protected nextTask(a: Agent, p: Project): Task | null {
    if (a.claim && (taskDone(this.game, p, a.claim) || (this.deferred.get(a.claim) ?? -1) > this.clock || !this.claimIn(a.claim, p))) a.claim = null;
    if (!a.claim) {
      // A claim only holds while its owner is getting closer; a stalled builder's task is up for grabs.
      const holders = this.agents.filter((o) => o !== a && o.claim && o.sinceBetter < 3);
      const taken = new Set(holders.map((o) => o.claim));
      a.claim = this.openTask(p, (t) => !taken.has(t) && (this.deferred.get(t) ?? -1) <= this.clock && this.haveFor(t) && this.floorReady(p, t) && this.supported(t));
      if (a.claim) for (const o of this.agents) if (o !== a && o.claim === a.claim) o.claim = null;
    }
    const t = a.claim;
    if (!t) return null;
    // Placement waits for materials: go gather instead.
    if (!this.haveFor(t)) return (a.claim = null);
    return t;
  }

  /**
   * Work on a storey too high to reach from the one below (the luxury houses' six-tile storeys)
   * waits until its floor has something to stand on, instead of builders jumping under a floor
   * that isn't there. Lower storeys (and lofts reached from below) are never held up.
   */
  protected floorReady(p: Project, t: Task): boolean {
    // (Clearing and chopping are done from wherever she can get at them.)
    if (t.kind === "clear" || t.kind === "chop") return true;
    const y = t.y;
    const f = this.floorFor(p, t.x, y);
    if (!f) return true;
    const below = p.floors.filter((o) => o.y > f.y && t.x >= o.x0 - 1 && t.x <= o.x1 + 1).reduce((m, o) => Math.min(m, o.y), Infinity);
    if (below - y <= REACH) return true; // reachable from the floor under it anyway
    const m = this.game.map;
    for (let x = f.x0; x <= f.x1; x++) if (m.standable(x, f.y)) return true;
    return false;
  }

  /** Furniture that stands on a floor waits until that floor is under it. */
  protected supported(t: Task): boolean {
    if (t.kind !== "object") return true;
    const o = OBJECTS[t.obj];
    if (o.support !== "floor") return true;
    for (let x = t.x; x < t.x + o.w; x++) if (!this.game.objects.standsOn(t.obj, x, t.y + o.h)) return false;
    return true;
  }

  /** Her best pickaxe can break this block (dungeon brick and the like need far better ones). */
  protected canDig(x: number, y: number): boolean {
    return minPower(this.game.map.tile(x, y)) <= (bestTool(this.game.inventory, "pickaxe")?.power ?? 0);
  }

  private claimIn(t: Task, p: Project) {
    return "x" in t && t.x >= p.x0 - 10 && t.x <= p.x1 + 10;
  }

  protected doBuild(a: Agent, job: Extract<Job, { kind: "build" }>): Move {
    const p = this.projects.get(job.project);
    // The next task in build order needs materials nobody is fetching: go fetch them.
    if (p) {
      const next = this.openTask(p, (t) => (this.deferred.get(t) ?? -1) <= this.clock);
      if (next && !this.haveFor(next)) {
        const id = taskItem(next);
        if (id !== null && this.fetchers(id, a) === 0 && !this.unavailable.has(id)) {
          a.job = null;
          a.claim = null;
          return STILL;
        }
      }
    }
    const task = p ? this.nextTask(a, p) : null;
    if (!p || !task) {
      // Nothing buildable: if that's for want of a tool, wait for it rather than spinning.
      const out: ToolKind | null = this.toolOut("axe") ? "axe" : this.toolOut("pickaxe") ? "pickaxe" : null;
      a.job = out ? { kind: "wait", until: this.clock + ASK_WAIT, tool: out, why: `waiting for ${out === "axe" ? "an" : "a"} ${out}` } : null;
      return STILL;
    }
    // The safety net: the same task for a long while without a single placement, chop or swing
    // (an upper floor's wall before the floor under it is built, a spot she circles but can't
    // stand at...): put it off for a minute and take the next one. The clock only runs once she's
    // at the site: the walk to a far-off build (minutes, for an estate across the world) isn't
    // being stuck, and counting it had every task put off before she arrived.
    const w = this.working.get(a);
    const farAway = Math.abs((a.x + a.w / 2) / TILE - task.x) > WORK_NEAR_TILES;
    if (!w || w.task !== task || farAway) this.working.set(a, { task, since: this.clock });
    else if (this.clock - w.since > WORK_LIMIT) {
      this.working.delete(a);
      this.defer(a, task, 60);
      a.path = null;
      return STILL;
    }
    const tx = task.x;
    // A tree is chopped wherever its trunk is nearest (from a house floor above its roots, say).
    const ty = task.kind === "chop" ? this.trunkRow(a, task.x) : task.y;
    // Which floor to work from (houses with storeys: climb up through the platforms).
    let floor = this.floorFor(p, tx, ty);
    const feet = (a.y + a.h) / TILE;
    const cx = (a.x + a.w / 2) / TILE;
    // Not up on a walkway yet: first up onto the floor at the end nearer the work (inside a
    // tower), the usual way; from there it's a walk along what's built of it.
    if (floor?.walk && floor.entry && Math.abs(feet - floor.y) >= 0.3) {
      const y = floor.y;
      const ends = floor.entry.map((e) => p.floors.find((f) => !f.walk && f.y === y && f.x0 === e.x0 && f.x1 === e.x1)).filter((f) => !!f);
      ends.sort((u, v) => Math.abs((u.x0 + u.x1) / 2 - tx) - Math.abs((v.x0 + v.x1) / 2 - tx));
      if (ends[0]) floor = ends[0];
    }
    if (floor && a.onGround) {
      const onFloor = Math.abs(feet - floor.y) < 0.3;
      const inside = cx > floor.x0 && cx < floor.x1 + 1;
      if (!onFloor && feet > floor.y + 0.3) {
        // Below it: get inside, under a platform in the floor, and jump up through. Storeys further
        // apart than a jump reaches (the luxury houses' are six tiles) get a climbing hop exactly
        // as high as the floor, like hopping up a run of platforms.
        const m = this.game.map;
        // (Onto a walkway: climb up where it starts, inside a tower, and walk out along it.)
        const spans = floor.entry ?? [{ x0: floor.x0, x1: floor.x1 }];
        const near = Math.max(floor.x0 + 1, Math.min(floor.x1 - 1, Math.round(tx)));
        let col = near;
        let bestD = Infinity;
        for (const sp of spans)
          for (let c = sp.x0; c <= sp.x1; c++)
            if (m.tile(c, floor.y) === T.Platform && Math.abs(c - near) < bestD) {
              bestD = Math.abs(c - near);
              col = c;
            }
        const r = this.walkTo(a, col);
        // (Right under it: one column over may be a doorway under a partition, which she'd only
        // bump her head on.)
        const under = Math.abs(cx - (col + 0.5)) < 0.6 && (inside || spans.some((sp) => cx > sp.x0 && cx < sp.x1 + 1));
        const rise = feet - floor.y;
        if (under && a.onGround && rise > 4.5 && m.tile(col, floor.y) === T.Platform) {
          a.vy = -Math.sqrt(2 * GRAVITY * (rise + 1.5) * TILE);
          a.jumpT = 0;
          a.onGround = false;
          return { move: 0, jump: false, drop: false };
        }
        return { move: r.move, jump: under || r.jump, drop: false };
      }
      if (!onFloor && feet < floor.y - 0.3 && inside) return { move: 0, jump: false, drop: true };
    }
    if (!this.canReach(a, tx, ty)) {
      // Can't get to it for a good while: put it off and work on something reachable meanwhile.
      if (a.sinceBetter > 8) {
        this.defer(a, task, 15);
        a.sinceBetter = 0;
        a.path = null;
        return STILL;
      }
      // Stand beside the spot (inside the floor's span, never inside a tile being placed).
      const span = floor ?? { x0: tx, x1: tx };
      const stand = Math.max(span.x0, Math.min(span.x1, tx));
      const move = this.walkTo(a, stand);
      // (Work at ground level, not up in a storey:) right under it and it's far overhead (she's
      // ended up down in a cave under the site, say):
      // dig and climb up to it, rather than standing there until she's sent home.
      if (!floor && move.move === 0 && !move.jump && ty < (a.y + a.h / 2) / TILE - REACH) {
        const up = this.rise(a);
        if (up) {
          this.beside.delete(a);
          a.sinceBetter = 0;
          return { ...up, drop: false };
        }
      }
      // Or far underfoot (a block left out of a foundation that's been built over): dig down to
      // it, through the build too. What she digs out is put back after.
      if (!floor && move.move === 0 && !move.jump && a.onGround && ty > (a.y + a.h / 2) / TILE + REACH) {
        const m = this.game.map;
        const under = Math.floor((a.y + a.h + 1) / TILE);
        const cols = [...new Set([Math.floor((a.x + 1) / TILE), Math.floor((a.x + a.w - 1) / TILE)])].filter((x) => m.solid(x, under));
        if (cols.length && cols.every((x) => this.canDig(x, under))) {
          if (a.cooldown <= 0) this.breakAt(a, cols[0], under);
          this.beside.delete(a);
          a.sinceBetter = 0;
          return STILL;
        }
      }
      // Arrived beside it and still out of reach (it's far above or below her): walking counts
      // that as no longer stuck, so time it here instead, and put it off rather than wait forever.
      if (move.move === 0 && !move.jump) {
        const s = this.beside.get(a);
        if (!s || s.task !== task) this.beside.set(a, { task, since: this.clock });
        else if (this.clock - s.since > BESIDE_LIMIT) {
          this.beside.delete(a);
          this.defer(a, task, 30);
          return STILL;
        }
      } else this.beside.delete(a);
      return { ...move, drop: false };
    }
    this.beside.delete(a);
    a.sinceBetter = 0; // in reach: working, not stalled
    if (a.cooldown > 0) return STILL;
    a.dir = tx * TILE + 8 < a.x + a.w / 2 ? -1 : 1;
    this.act(a, p, task);
    return STILL;
  }

  /** The floor of a project to stand on for work at row y: the lowest one at or below it that still reaches. */
  protected floorFor(p: Project, x: number, y: number): Project["floors"][number] | null {
    let best = null as Project["floors"][number] | null;
    // (Floors level with each other, a tower's and the house's: the one the work is over.)
    const off = (f: Project["floors"][number]) => Math.max(0, f.x0 - x, x - f.x1);
    for (const f of p.floors) {
      if (f.walk) {
        // A walkway: its own row (extending it) and the few rows hanging under it, over it.
        if (f.y < y - 3 || f.y - y > REACH + 1) continue;
        if (f.y > y ? x < f.x0 - REACH || x > f.x1 + REACH : f.y === y ? x < f.x0 || x > f.x1 : x <= f.x0 || x >= f.x1) continue;
      } else {
        if (f.y <= y) continue; // must be below the work (we stand on it)
        if (f.y - y > REACH + 1) continue;
        if (x < f.x0 - REACH || x > f.x1 + REACH) continue;
      }
      // (Level floors: the one the work is over; a walkway only when nothing else is.)
      if (!best || f.y < best.y || (f.y === best.y && (off(f) < off(best) || (off(f) === off(best) && !!best.walk && !f.walk)))) best = f;
    }
    // The ground floor (or nothing) for low work: no climbing needed.
    if (best && p.floors.length && best.y === Math.max(...p.floors.map((f) => f.y))) return null;
    return best;
  }

  /** Put a task off for a while (something there won't break, or it can't attach yet). */
  protected defer(a: Agent, t: Task, seconds = BLOCK_TIME) {
    // The same task failing again and again waits longer each time (up to two minutes), so it
    // can't keep the builders from everything after it in the build order.
    const n = (this.strikes.get(t) ?? 0) + 1;
    this.strikes.set(t, n);
    if (n > 3) seconds = Math.max(seconds, Math.min(120, seconds * 2 ** (n - 3)));
    this.deferred.set(t, this.clock + seconds);
    if (a.claim === t) a.claim = null;
  }

  protected act(a: Agent, p: Project, t: Task) {
    const g = this.game;
    const item = taskItem(t);
    a.use = { t: 0, item: item ?? 3509, aim: 0 };
    a.cooldown = ACT_TIME;
    switch (t.kind) {
      case "chop":
        if (this.chopTree(a, t.x) === "blocked") this.defer(a, t);
        break;
      case "clear": {
        const k = t.y * 65536 + t.x;
        if (g.map.standable(t.x, t.y) && p.planned.get(k) !== g.map.tile(t.x, t.y)) {
          if (this.breakAt(a, t.x, t.y) === "blocked") this.defer(a, t);
          break;
        }
        const old = p.kind === "luxury" ? foreignObject(g, p, t.x, t.y) : null;
        if (old) {
          g.takeObject(old);
          this.useful(a);
          break;
        }
        // A wall from before (not part of this build): knocked down.
        if (p.kind === "luxury" && p.walls && g.map.wall(t.x, t.y) && !p.walls.has(k)) {
          if (g.hammerWall(t.x, t.y)) this.useful(a);
          else this.defer(a, t, 5);
        }
        break;
      }
      case "wall": {
        const cur = g.map.wall(t.x, t.y);
        if (cur && cur !== t.wall) {
          if (!g.hammerWall(t.x, t.y)) this.defer(a, t, 5);
          break;
        }
        const id = wallItem(t.wall);
        if (countOf(g.inventory, id) > 0 && g.map.setWall(t.x, t.y, t.wall)) {
          g.removeFromInventory(id, 1);
          g.changed.push({ x: t.x, y: t.y });
          g.worldVersion++;
          this.stats.built++;
          this.useful(a);
        }
        break;
      }
      case "tile": {
        const cur = g.map.tile(t.x, t.y);
        if (cur !== T.Air && !(t.tile === T.Dirt && g.map.solid(t.x, t.y)) && !g.map.liquid(t.x, t.y)) {
          // Replace what's there.
          if (this.breakAt(a, t.x, t.y) === "blocked") this.defer(a, t);
          break;
        }
        // Someone's standing there (maybe her): they step aside, and this waits a moment.
        const r = { x: t.x * TILE, y: t.y * TILE, w: TILE, h: TILE };
        if (t.tile !== T.Platform && t.tile !== T.WoodBeam && this.agents.some((o) => overlaps(o, r))) {
          // Stood in a hole that can't be stepped out of (a gap being filled in): she's lifted up
          // onto the block instead, if there's room over it.
          // With no room (under a floor, say), she mirrors home.
          const room = [1, 2, 3].every((d) => !g.map.solid(t.x, t.y - d));
          if ((this.strikes.get(t) ?? 0) >= 2) {
            for (const o of this.agents)
              if (overlaps(o, r)) {
                if (!room) {
                  this.recall(o);
                  continue;
                }
                o.y = t.y * TILE - o.h - 0.5;
                o.vy = 0;
              }
          } else {
            for (const o of this.agents) if (overlaps(o, r)) this.aside.set(o, { dir: o.x + o.w / 2 < r.x + 8 ? -1 : 1, until: this.clock + 0.7 });
            this.defer(a, t, 2);
            break;
          }
        }
        // Furniture in the way of a planned block: pick it up first.
        const obj = g.objects.at(t.x, t.y);
        if (obj) {
          g.takeObject(obj);
          break;
        }
        const id = t.tile === T.Dirt && countOf(g.inventory, 2) === 0 ? 3 : (item ?? 2);
        if (g.placeTile(t.x, t.y, t.tile, true)) {
          g.removeFromInventory(id, 1);
          this.stats.built++;
          this.useful(a);
        } else this.defer(a, t, 4); // nothing to attach to yet: later
        break;
      }
      case "object": {
        const o = OBJECTS[t.obj];
        // (A piece with no item at all is just put in place: it must never hold a house up.)
        if (g.objects.place(t.obj, t.x, t.y, t.style ?? 0)) {
          if (item !== null) g.removeFromInventory(item, 1);
          g.worldVersion++;
          this.stats.built++;
          this.useful(a);
          this.useful(a);
        } else {
          // Something in the way (a block that isn't part of the build): clear it, or try later.
          for (let dx = 0; dx < o.w; dx++)
            for (let dy = 0; dy < o.h; dy++)
              if (g.map.standable(t.x + dx, t.y + dy) && !p.planned.has((t.y + dy) * 65536 + t.x + dx)) {
                this.breakAt(a, t.x + dx, t.y + dy);
                return;
              }
          // Furniture that isn't part of the plan (left from before a house was redesigned): pick it up.
          const keep = plannedObjects(p);
          for (const other of g.objects.inRect(t.x, t.y, t.x + o.w - 1, t.y + o.h - 1))
            if (!keep.has(`${other.t}:${other.x},${other.y}:${other.style ?? 0}`) && requirement(g.map, g.objects, other.x, other.y).kind !== "blocked") {
              g.takeObject(other);
              return;
            }
          // Nothing to clear and it still won't go in: put it off, longer each time it fails.
          const n = (this.failures.get(t) ?? 0) + 1;
          this.failures.set(t, n);
          this.defer(a, t, Math.min(300, 6 * 2 ** n));
        }
        break;
      }
    }
  }

  // ── Getting around ────────────────────────────────────────────────────────────────────────

  /**
   * Head for a tile: walk on the surface; tunnel down to places underground; ride the
   * hellevator to the underworld; climb a ladder to a sky island; mirror home to come back up.
   * Returns her movement (STILL when there), or null if there's no way there yet.
   */
  protected navTo(a: Agent, tx: number, ty: number): Move | null {
    const m = this.game.map;
    const cx = (a.x + a.w / 2) / TILE;
    const feet = (a.y + a.h) / TILE;
    // Deep down and the target is up top: mirror home.
    if (feet > HELL_TOP - 10 && ty < HELL_TOP - 40) {
      this.recall(a);
      return STILL;
    }
    // The underworld: by the shaft.
    if (ty > HELL_TOP - 10 && feet < HELL_TOP - 10) {
      const sh = [...this.projects.values()].find((p) => p.kind === "shaft" && this.isDone(p));
      if (!sh) return null;
      const sx = sh.door.x;
      if (Math.abs(cx - (sx + 0.5)) > 0.8) {
        if (feet > m.surface(Math.floor(cx)) + 6) {
          this.recall(a);
          return STILL;
        }
        return this.walkTo(a, sx);
      }
      return { move: 0, jump: false, drop: true };
    }
    // A sky island: up its ladder.
    if (ty < SKY_LINE && feet > ty + 6) {
      const lad = [...this.projects.values()].filter((p) => p.kind === "ladder" && this.isDone(p)).sort((p, q) => Math.abs(p.door.x - tx) - Math.abs(q.door.x - tx))[0];
      if (!lad) return null;
      const lx = lad.door.x;
      if (Math.abs(cx - (lx + 0.5)) > 1.2 && feet > lad.y1 - 2) return this.walkTo(a, lx);
      if (feet > lad.y0 + 2) return { move: cx < lx + 0.5 ? 1 : -1, jump: true };
      return this.walkTo(a, tx);
    }
    // Underground spot: walk over (beside any build), then dig down to it.
    const surfaceHere = m.surface(Math.floor(cx));
    if (ty > surfaceHere + 3 && feet < ty - 1) {
      // Not through a house: start the shaft just outside its footprint.
      let sx = tx;
      for (const p of this.projects.values()) if (p.kind !== "shaft" && sx >= p.x0 - 2 && sx <= p.x1 + 2) sx = Math.abs(sx - (p.x0 - 3)) < Math.abs(sx - (p.x1 + 3)) ? p.x0 - 3 : p.x1 + 3;
      if (Math.abs(cx - (sx + 0.5)) < 1.5) {
        const fx = Math.floor(cx);
        const below = Math.floor(feet + 0.1);
        // Her body spans two columns: clear what's under both.
        const cols = [Math.floor((a.x + 1) / TILE), Math.floor((a.x + a.w - 1) / TILE)];
        for (const x of cols) {
          if (m.solid(x, below) && !this.isBuilt(x, below) && !this.inAnyFootprint(x, below)) {
            if (a.cooldown <= 0 && this.canDig(x, below)) this.breakAt(a, x, below);
            return STILL;
          }
          const o = this.game.objects.at(x, below);
          if (o && a.cooldown <= 0 && !this.inAnyFootprint(x, below)) {
            this.game.takeObject(o);
            a.cooldown = ACT_TIME;
            return STILL;
          }
        }
        // A platform underfoot: drop through it.
        if (cols.some((x) => m.tile(x, below) === T.Platform)) return { move: 0, jump: false, drop: true };
        // Deep enough beside it (or nothing to dig here): head for the exact column / tunnel across.
        void fx;
        return this.walkTo(a, tx);
      }
      return this.walkTo(a, sx);
    }
    if (Math.abs(cx - tx) < 1 && Math.abs(feet - ty) < 3) return STILL;
    return this.walkTo(a, tx);
  }

  /** Follow a planned route: walk to each spot, jumping up to higher ones and dropping to lower ones. */
  protected followPath(a: Agent): Move | null {
    const path = a.path;
    if (!path || !path.length) {
      a.path = null;
      return null;
    }
    const col = Math.floor((a.x + a.w / 2) / TILE);
    const feet = Math.floor((a.y + a.h - 1) / TILE);
    const cx0 = (a.x + a.w / 2) / TILE;
    // Reached the next spot (spots are two columns wide: centred on the line between them).
    while (path.length && Math.abs(cx0 - (path[0].x + 1)) < 0.5 && Math.abs(path[0].y - feet) <= 1 && (a.onGround || path[0].y >= feet)) {
      path.shift();
      a.pathAt = this.clock;
    }
    if (!path.length) {
      a.path = null;
      return null;
    }
    if (this.clock - a.pathAt > 4) {
      a.path = null; // not getting there: plan again later
      return null;
    }
    const wp = path[0];
    const m = this.game.map;
    const cx = (a.x + a.w / 2) / TILE;
    const move: -1 | 0 | 1 = wp.x + 1 < cx - 0.2 ? -1 : wp.x + 1 > cx + 0.2 ? 1 : 0;
    // Jump (and keep holding it while rising) toward a higher spot.
    const jump = wp.y < feet && (a.onGround || a.vy < 0);
    const drop = wp.y > feet && (m.tile(col, feet + 1) === T.Platform || m.tile(col - 1, feet + 1) === T.Platform) && Math.abs(wp.x + 1 - cx) < 0.6;
    if (move) a.dir = move;
    return { move, jump, drop };
  }

  /** Walk toward a column; jump obstacles; find a route when stuck; dig through what won't budge (never a build). */
  protected walkTo(a: Agent, tx: number): Move {
    const cx = a.x + a.w / 2;
    const goal = tx * TILE + TILE / 2;
    if (Math.abs(goal - cx) < 6) {
      a.path = null;
      return STILL;
    }
    // On a planned route to here (or to another spot on the same trip): follow it.
    if (a.path && (a.pathGoal === tx || sameTrip(a.pathGoal, tx, cx))) {
      const r = this.followPath(a);
      if (r) return r;
    }
    const move = (goal < cx ? -1 : 1) as -1 | 1;
    a.dir = move;
    let jump = false;
    // Stuck = no real progress toward the goal for a while (jumping in place doesn't count).
    const dist = Math.abs(goal - cx);
    if (a.goal !== tx) {
      // A new spot in the same direction (the next block of the same far-off build, say, which
      // can change every frame as the crew shares out tasks) is the same trip: keep counting, or
      // she'd never count as stuck and never look for a way round.
      // (Her best distance so far carries over, shifted by how far the spot moved.)
      const prev = a.goal;
      a.goal = tx;
      if (sameTrip(prev, tx, cx)) {
        a.best += move * (tx - prev) * TILE;
        if (dist < a.best - 8) {
          a.best = dist;
          a.sinceBetter = 0;
        } else a.sinceBetter += 1 / 30;
      } else {
        a.best = dist;
        a.sinceBetter = 0;
      }
    } else if (dist < a.best - 8) {
      a.best = dist;
      a.sinceBetter = 0;
    } else a.sinceBetter += 1 / 30;
    a.stuck = a.sinceBetter;
    if (Math.abs(a.x - a.lastX) < 0.5 && a.onGround) jump = true; // blocked: hop
    if (liquidAt(this.game.map, a)) jump = true; // swim
    a.lastX = a.x;
    // Coming down off a stack of her own (climbing back over something): take it apart as she
    // goes, digging out the block under her feet, rather than jumping off and leaving it there.
    if (a.onGround && !this.climbing.has(a) && a.cooldown <= 0 && Math.abs(goal - cx) > 2 * TILE) {
      const m = this.game.map;
      const col = Math.floor(cx / TILE);
      const under = Math.floor((a.y + a.h + 1) / TILE);
      const ahead = Math.floor((cx + move * 16) / TILE);
      if (this.scaffold.has(under * 65536 + col) && !m.standable(ahead, under) && !m.standable(ahead, under + 1)) {
        this.breakAt(a, col, under);
        return { move: 0, jump: false };
      }
    }
    // Climbing over something she can't dig through: stack blocks under herself, Terraria-style.
    const up = this.climb(a, move, goal);
    if (up) return up;
    // A hole or a mine shaft ahead gets bridged with a block, Terraria-style (rather than
    // falling in and ending up underground).
    if (a.onGround && a.job?.kind !== "mine") {
      const m = this.game.map;
      const fx = Math.floor((cx + move * 16) / TILE);
      const row = Math.floor((a.y + a.h + 1) / TILE);
      // A real gap, or a step down into a tunnel below the surface line (a mine entrance).
      // (`row` is the floor she stands on; where the natural ground there would be at or above it,
      // a missing block means someone dug it out.)
      // (A hole: there's ground again just past it. Off the edge of a cliff or a wall she's
      // climbed, there isn't — she hops down instead of building a bridge out into the air.)
      const across = [1, 2, 3, 4].some((d) => m.standable(fx + move * d, row));
      const gap = !m.standable(fx, row) && ((!m.standable(fx, row + 1) && !m.standable(fx, row + 2) && across) || m.surface(fx) <= row);
      // (Not in a build — but down in the ground under one, an old shaft across the site, say, she
      // does: falling in leaves her under the house, out of reach of it.)
      if (gap && Math.abs(goal - cx) > 3 * TILE && (!this.inAnyFootprint(fx, row) || this.underBuild(fx, row)) && !m.liquid(fx, row)) {
        const block = countOf(this.game.inventory, 2) > 0 ? 2 : countOf(this.game.inventory, 3) > 0 ? 3 : 0;
        if (block && this.game.placeTile(fx, row, block === 2 ? T.Dirt : T.Stone, true)) {
          // (On a trip it's a bridge she used to get across: taken down afterwards with the rest.)
          if (a.job?.kind === "go") this.scaffold.set(row * 65536 + fx, { x: fx, y: row, owner: a.id, trip: this.tripOf(a) });
          this.game.removeFromInventory(block, 1);
          a.use = { t: 0, item: block, aim: 0 };
          a.cooldown = ACT_TIME;
        }
      }
    }
    // Stuck for a moment: plan a route (over, around, through doorways, out of tunnels). A goal
    // whose routes keep failing gets no more for a while (digging takes over).
    const ban = this.pathBan.get(a);
    if (a.stuck > 1 && a.onGround && this.clock - a.pathTry > 2 && !(ban && ban.goal === tx && ban.until > this.clock)) {
      a.pathTry = this.clock;
      const tries = ban && ban.goal === tx ? ban.tries + 1 : 1;
      this.pathBan.set(a, { goal: tx, tries: tries >= 3 ? 0 : tries, until: tries >= 3 ? this.clock + 20 : 0 });
      // Spots are two columns wide: the one whose middle is nearest her.
      const from = { x: Math.round(cx / TILE) - 1, y: Math.floor((a.y + a.h - 1) / TILE) };
      const path = findPath(this.game.map, from, tx, null, 4000, 70);
      if (path && path.length > 1) {
        a.path = path.slice(1);
        a.pathGoal = tx;
        a.pathAt = this.clock;
        const r = this.followPath(a);
        if (r) return r;
      }
    }
    if (a.stuck > 0.8 && a.onGround) {
      // Blocked by a built wall while standing on a platform (a loft, an upper floor): drop down
      // to where the doorways are.
      const fx = Math.floor((cx + move * 14) / TILE);
      const fy = Math.floor((a.y + a.h - 1) / TILE);
      const under = Math.floor((a.y + a.h + 1) / TILE);
      if ([fy - 2, fy - 1, fy].some((y) => this.isBuilt(fx, y)) && this.game.map.tile(Math.floor(cx / TILE), under) === T.Platform) return { move, jump: false, drop: true };
    }
    // Below the surface with rock overhead (an old tunnel): mine a rising staircase out, the way
    // a Terraria player digs up (a 3-high opening ahead, keeping the block under it as a step).
    const m = this.game.map;
    const col = Math.floor(cx / TILE);
    const fy0 = Math.floor((a.y + a.h - 1) / TILE);
    const covered = fy0 - m.surface(col) >= 1 && [1, 2, 3, 4].some((k) => m.solid(col, Math.floor(a.y / TILE) - k));
    if (covered && a.onGround && a.cooldown <= 0 && Math.abs(goal - cx) > 2 * TILE) {
      const fx = Math.floor((cx + move * 14) / TILE);
      for (const y of [fy0 - 3, fy0 - 2, fy0 - 1]) {
        if (m.solid(fx, y) && !this.keepIntact(a, fx, y) && this.canDig(fx, y)) {
          const r = this.breakAt(a, fx, y);
          if (r === "hit" || r === "missing") return { move: 0, jump: false };
        }
      }
    }
    if (a.stuck > 1.6 && a.cooldown <= 0) {
      // Still stuck: dig the tiles in front (head and body height) — a build too if she's been
      // stuck a good while (trapped between it and the ground, say): it gets put back later.
      const fx = Math.floor((cx + move * 14) / TILE);
      const fy = Math.floor((a.y + a.h - 1) / TILE);
      for (const y of [fy - 2, fy - 1, fy]) {
        if (this.game.map.solid(fx, y) && (!this.keepIntact(a, fx, y) || a.stuck > 5) && this.canDig(fx, y)) {
          const r = this.breakAt(a, fx, y);
          if (r === "hit" || r === "missing") break;
        }
      }
      if (a.stuck > 6) {
        a.sinceBetter = 0;
        a.best = dist;
      }
    }
    return { move, jump };
  }

  /**
   * Over a wall she can't dig through (dungeon brick, rock too hard for her pickaxe, a structure):
   * jump, and drop a block under her feet at the top of each jump, until she's above it and can
   * walk on. Only on the way somewhere (not at a build: houses have doors), and never over a
   * build. The blocks are remembered and taken down afterwards.
   */
  protected climb(a: Agent, move: -1 | 1, goal: number): Move | null {
    const m = this.game.map;
    const cx = a.x + a.w / 2;
    const col = Math.floor(cx / TILE);
    const fx = Math.floor((cx + move * 14) / TILE);
    const fy = Math.floor((a.y + a.h - 1) / TILE);
    const front = [fy - 2, fy - 1, fy].filter((y) => m.solid(fx, y));
    const c = this.climbing.get(a);
    // One of the team's own climbing stacks in the way (and nobody up on it): dig through it.
    const ours = front.find((y) => this.scaffold.has(y * 65536 + fx));
    if (ours !== undefined && !c && this.leftovers(a).some((s) => s.x === fx && s.y === ours)) {
      if (a.cooldown <= 0) this.breakAt(a, fx, ours);
      return { move: 0, jump: false };
    }
    // Clear ahead (she's over it) or not a climb at all: walk on.
    if (!front.length || Math.abs(goal - cx) < 4 * TILE) {
      this.climbing.delete(a);
      return null;
    }
    if (!c) {
      // On the way somewhere — or on any errand once she's been stuck there a good while.
      const travelling = a.job?.kind === "go" || a.job?.kind === "tidy" || (a.job?.kind !== "build" && a.stuck > 5);
      const wall = front.some((y) => this.isBuilt(fx, y) || this.inAnyFootprint(fx, y)) ? false : front.every((y) => !this.canDig(fx, y) || this.sealed(fx, y) || !!structureAt(m.structures, fx, y));
      if (!travelling || !wall || a.stuck < 1.6 || !a.onGround) return null;
      this.climbing.set(a, { since: this.clock, top: fy, at: this.clock });
      return { move: 0, jump: true };
    }
    // Too high, out of blocks, or no headway for a while: give up (the trip gives up in time).
    const block = countOf(this.game.inventory, 2) > 0 ? 2 : countOf(this.game.inventory, 3) > 0 ? 3 : 0;
    if (fy < c.top) {
      c.top = fy;
      c.at = this.clock;
      a.sinceBetter = 0; // (rising: that's headway, not being stuck)
    }
    if (!block || c.top < m.surface(col) - 60 || this.clock - c.at > 6) {
      this.climbing.delete(a);
      return null;
    }
    if (a.onGround) return { move: 0, jump: true };
    // Coming down from the top of a jump: a block in the cell just under her feet, on the stack.
    const r = Math.ceil((a.y + a.h) / TILE - 0.05);
    if (a.vy >= 0 && !m.standable(col, r) && m.standable(col, r + 1) && r * TILE >= a.y + a.h - 0.5) {
      if (this.game.placeTile(col, r, block === 2 ? T.Dirt : T.Stone, true)) {
        this.game.removeFromInventory(block, 1);
        this.scaffold.set(r * 65536 + col, { x: col, y: r, owner: a.id, trip: this.tripOf(a) });
        a.use = { t: 0, item: block, aim: 0 };
      }
    }
    return { move: 0, jump: false };
  }

  /**
   * Up toward work overhead, the way a Terraria player gets out of a hole: dig out the natural
   * ground over her head, and stack blocks under her feet at the top of each jump. Never
   * through a build. The blocks are remembered and taken down afterwards.
   */
  protected rise(a: Agent): Move | null {
    const m = this.game.map;
    const top = Math.floor(a.y / TILE);
    if (a.onGround)
      for (const y of [top - 1, top - 2])
        for (const x of new Set([Math.floor((a.x + 1) / TILE), Math.floor((a.x + a.w - 1) / TILE)])) {
          if (!m.solid(x, y)) continue;
          if (this.isBuilt(x, y) || !this.canDig(x, y)) return null;
          if (a.cooldown <= 0) this.breakAt(a, x, y);
          return { move: 0, jump: false };
        }
    const block = countOf(this.game.inventory, 2) > 0 ? 2 : countOf(this.game.inventory, 3) > 0 ? 3 : 0;
    if (!block) return null;
    if (a.onGround) return { move: 0, jump: true };
    const col = Math.floor((a.x + a.w / 2) / TILE);
    const r = Math.ceil((a.y + a.h) / TILE - 0.05);
    if (a.vy >= 0 && !m.standable(col, r) && m.standable(col, r + 1) && r * TILE >= a.y + a.h - 0.5) {
      if (this.game.placeTile(col, r, block === 2 ? T.Dirt : T.Stone, true)) {
        this.game.removeFromInventory(block, 1);
        this.scaffold.set(r * 65536 + col, { x: col, y: r, owner: a.id, trip: this.tripOf(a) });
        a.use = { t: 0, item: block, aim: 0 };
      }
    }
    return { move: 0, jump: false };
  }

  /** Which trip a builder is on (stacks built on it stay up until it's over). */
  private tripOf(a: Agent): string {
    const j = a.job;
    return !j ? "" : j.kind === "go" ? `go:${j.goal ?? j.x}` : j.kind;
  }

  /** Stacks nobody needs any more: their builder's trip is over (or she's someone else). */
  protected leftovers(a: Agent): { x: number; y: number }[] {
    const m = this.game.map;
    for (const [k, s] of this.scaffold) if (m.tile(s.x, s.y) === T.Air || !m.solid(s.x, s.y)) this.scaffold.delete(k);
    return [...this.scaffold.values()].filter((s) => {
      const owner = this.agents.find((o) => o.id === s.owner);
      if (owner && owner !== a && owner.dead <= 0 && this.tripOf(owner) === s.trip) return false;
      // (Nobody standing on it or right beside it.)
      return !this.agents.some((o) => o !== a && Math.abs((o.x + o.w / 2) / TILE - s.x) < 2 && Math.abs((o.y + o.h) / TILE - s.y) < 3);
    });
  }

  /**
   * Take down leftover stacks: each from its lowest block (the rest comes down with it), the
   * nearest first. One she can't get to within a minute is left until tomorrow.
   */
  protected doTidy(a: Agent): Move {
    const left = this.leftovers(a).filter((s) => this.tidyNow(s.x));
    if (!left.length) {
      a.job = null;
      return STILL;
    }
    const cx = (a.x + a.w / 2) / TILE;
    const near = left.reduce((b, s) => (Math.abs(s.x - cx) < Math.abs(b.x - cx) ? s : b));
    const base = left.filter((s) => s.x === near.x).reduce((b, s) => (s.y > b.y ? s : b));
    const t = this.tidying.get(a);
    if (!t || t.x !== base.x) this.tidying.set(a, { x: base.x, since: this.clock });
    else if (this.clock - t.since > 60) {
      // No way to it (walled in, up on a roof): try again another day, later each time; after
      // three tries it's left where it is.
      const tries = (this.tidyLater.get(base.x)?.tries ?? 0) + 1;
      if (tries >= 3) {
        for (const [k, s] of this.scaffold) if (s.x === base.x) this.scaffold.delete(k);
        this.tidyLater.delete(base.x);
      } else this.tidyLater.set(base.x, { day: this.game.day + tries, tries });
      this.tidying.delete(a);
      return STILL;
    }
    if (this.canReach(a, base.x, base.y)) {
      if (a.cooldown <= 0) this.breakAt(a, base.x, base.y);
      return STILL;
    }
    // Beside it, on whichever side is open.
    const m = this.game.map;
    const side = !m.solid(base.x + 1, base.y) || m.solid(base.x - 1, base.y) ? base.x + 1 : base.x - 1;
    return this.walkTo(a, Math.round(cx) < base.x && !m.solid(base.x - 1, base.y) ? base.x - 1 : side);
  }

  /** Who's taking down which stack, since when; and stacks left until a later day (column → day). */
  private readonly tidying = new Map<Agent, { x: number; since: number }>();
  private readonly tidyLater = new Map<number, { day: number; tries: number }>();
  private tidyNow(x: number) {
    return (this.tidyLater.get(x)?.day ?? -1) < this.game.day;
  }

  /** The stacks, for the save: [x, y] (on loading, they're all leftovers to take down). */
  saveScaffold(): [number, number][] {
    return [...this.scaffold.values()].map((s) => [s.x, s.y]);
  }

  loadScaffold(raw: unknown) {
    if (!Array.isArray(raw)) return;
    for (const e of raw.slice(0, 2000)) {
      if (!Array.isArray(e) || !Number.isInteger(e[0]) || !Number.isInteger(e[1])) continue;
      this.scaffold.set(e[1] * 65536 + e[0], { x: e[0], y: e[1], owner: "", trip: "" });
    }
  }

  /** Tiles she won't dig through on her way: builds, and world structures when it's only for a tree. */
  protected keepIntact(a: Agent, x: number, y: number): boolean {
    return this.isBuilt(x, y) || (a.job?.kind === "wood" && !!structureAt(this.game.map.structures, x, y));
  }

  /** A tile that's part of a build (planned in any project, and built). */
  protected isBuilt(x: number, y: number): boolean {
    const k = y * 65536 + x;
    for (const p of this.projects.values()) if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && p.planned.get(k) === this.game.map.tile(x, y)) return true;
    return false;
  }

  protected canReach(a: Agent, x: number, y: number) {
    const cx = (a.x + a.w / 2) / TILE;
    const cy = (a.y + a.h / 2) / TILE;
    return Math.abs(x + 0.5 - cx) <= REACH && Math.abs(y + 0.5 - cy) <= REACH;
  }

  /** Down a mine or in a cave (not just standing in a dip, or inside a house). */
  underground(a: Agent) {
    const m = this.game.map;
    const col = Math.floor((a.x + a.w / 2) / TILE);
    const feet = Math.floor((a.y + a.h - 1) / TILE);
    const surface = m.surface(col);
    const depth = feet - surface;
    if (depth < 2) return false;
    if (depth > 14) return true;
    if (this.inAnyFootprint(col, feet)) return false;
    // Rock overhead (between her head and the surface) means a cave or a tunnel.
    for (let y = Math.floor(a.y / TILE) - 1; y >= surface - 2; y--) if (m.solid(col, y)) return true;
    return false;
  }

  protected nearHome(a: Agent) {
    return Math.abs(a.x - a.home.x) < 30 * TILE && Math.abs(a.y - a.home.y) < 12 * TILE;
  }

  /** Her job's project is right here (working inside it isn't "down a mine"). */
  protected nearProjectFor(a: Agent) {
    const job = a.job;
    if (job?.kind !== "build") return false;
    const p = this.projects.get(job.project);
    if (!p) return false;
    const cx = (a.x + a.w / 2) / TILE;
    const cy = (a.y + a.h) / TILE;
    return cx >= p.x0 - 3 && cx <= p.x1 + 3 && cy >= p.y0 - 3 && cy <= p.y1 + 4;
  }

  /**
   * Magic Mirror: back home. Used when a companion has work at home but is down a mine or in
   * a cave (or truly stuck), the way a Terraria player recalls home.
   */
  recall(a: Agent, sparkle = true) {
    this.recalled.set(a, this.clock);
    a.path = null;
    a.x = a.home.x - a.w / 2;
    a.y = a.home.y - a.h - 0.5;
    // Somewhere to land if home is dug out / built over.
    while (solidIn(this.game.map, a.x, a.y, a.w, a.h) && a.y > 0) a.y -= TILE;
    a.vx = 0;
    a.vy = 0;
    a.sinceBetter = 0;
    a.best = Infinity;
    a.goal = NaN;
    if (sparkle) this.game.texts.push({ x: a.x + a.w / 2, y: a.y - 6, text: "✦ Magic Mirror", color: "#bfe8ff", age: 0 });
  }

  /** Never stay stuck inside blocks (a block placed on her, a squeeze): pop out to the nearest free spot. */
  protected unembed(a: Agent) {
    const m = this.game.map;
    if (!solidIn(m, a.x, a.y, a.w, a.h)) return;
    for (let r = 1; r <= 8; r++)
      for (const [dx, dy] of [
        [0, -r],
        [-r, 0],
        [r, 0],
        [0, r],
        [-r, -r],
        [r, -r],
      ]) {
        const x = a.x + dx * TILE;
        const y = a.y + dy * TILE;
        if (!solidIn(m, x, y, a.w, a.h)) {
          a.x = x;
          a.y = y;
          a.vx = 0;
          a.vy = 0;
          return;
        }
      }
    this.recall(a, false);
  }

  protected physics(a: Agent, move: -1 | 0 | 1, jump: boolean, drop: boolean, dt: number) {
    this.unembed(a);
    if (move) a.vx = move * RUN;
    else a.vx *= a.onGround ? 0.6 : 0.95;
    if (jump && a.onGround && a.jumpT <= 0) {
      a.vy = -JUMP_V;
      a.jumpT = JUMP_HOLD;
    }
    if (a.jumpT > 0) {
      if (jump && !solidIn(this.game.map, a.x, a.y - 2, a.w, 2)) {
        a.vy = -JUMP_V;
        a.jumpT -= dt;
      } else a.jumpT = 0;
    }
    const r = moveBox(this.game.map, a, dt, { gravity: a.jumpT > 0 ? 0 : GRAVITY, maxFall: MAX_FALL, stepUp: true, dropThrough: drop });
    if (r.liquid && jump) a.vy = Math.max(-170, a.vy - 900 * dt);
    if (r.liquid === T.Lava && !this.game.buffs.obsidianskin) this.game.hurtFighter(a, 40, 0, "fell into lava");
    if (a.onGround) a.walk += Math.abs(a.vx) * dt;
    a.x = Math.max(0, Math.min(this.game.map.size.width * TILE - a.w, a.x));
    if (a.y > this.game.map.size.height * TILE) this.recall(a);
  }
}

// ── The original one-house crew ─────────────────────────────────────────────────────────────

export interface HousePlan {
  /** Left column of the house and the floor row. */
  x0: number;
  g: number;
}

/** A flat-ish spot to the right of spawn (lowest height variation over the house width). */
export function chooseSite(map: WorldMap, spawnX: number): HousePlan {
  let best = { x0: spawnX + 8, score: Infinity };
  for (let x0 = spawnX + 8; x0 < spawnX + 160; x0++) {
    const hs: number[] = [];
    for (let x = x0 - 1; x <= x0 + HOUSE_W; x++) hs.push(map.surface(x));
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const score = hs.reduce((a, h) => a + Math.abs(h - mean), 0) + (map.biome(x0) === "forest" ? 0 : 50);
    if (score < best.score) best = { x0, score };
  }
  const hs: number[] = [];
  for (let x = best.x0; x < best.x0 + HOUSE_W; x++) hs.push(map.surface(x));
  return { x0: best.x0, g: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) };
}

/** The starter house's tasks, in order. */
export function blueprint(map: WorldMap, plan: HousePlan): Task[] {
  return starterHouse(map, plan.x0, plan.g).tasks;
}

/** The starter house crew (the first build, and the simple case the tests drive). */
export class Builders extends Crew {
  readonly project: Project;
  done = false;
  private announced = false;

  constructor(
    game: Game,
    readonly plan: HousePlan,
    agents: Agent[],
  ) {
    super(game, agents);
    this.project = starterHouse(game.map, plan.x0, plan.g);
    this.addProject(this.project);
    this.goals = [{ id: "starter", kind: "build", project: "starter", crew: 99 }];
    // Home is the doorstep.
    for (const a of agents) a.home = { x: (plan.x0 - 2) * TILE + TILE / 2, y: plan.g * TILE };
    this.done = this.isDone(this.project);
  }

  get tasks() {
    return this.project.tasks;
  }

  get progress() {
    return projectProgress(this.game, this.project);
  }

  /** Wood and stone still to gather (the HUD's summary). */
  get needs() {
    const n = projectNeeds(this.game, this.project);
    const inv = this.game.inventory;
    let wood = 0;
    let stone = 0;
    for (const [id, c] of n) {
      if (id === 9) wood += c;
      else if (id === 94) wood += c / 2;
      else if (id === 3 || id === 2) stone += c;
      else if (id === 36) wood += 10;
      else if (id === 33) {
        stone += 20;
        wood += 5;
      } else if (id === 8) wood += c / 3;
    }
    return { wood: Math.max(0, Math.ceil(wood - countOf(inv, 9) - countOf(inv, 94) / 2)), stone: Math.max(0, Math.ceil(stone - countOf(inv, 3) - countOf(inv, 2))) };
  }

  step(dt: number) {
    if (!this.announced && this.agents[0]) {
      this.announced = true;
      this.speak(this.agents[0], this.done ? "done" : "start");
    }
    const was = this.done;
    this.done = this.isDone(this.project);
    if (this.done && !was) for (const a of this.agents) this.speak(a, "done");
    // Finished: everyone downs tools and relaxes.
    const relax = () => {
      if (this.done) for (const a of this.agents) if (a.job?.kind !== "rest") a.job = { kind: "rest" };
    };
    relax();
    super.step(dt);
    relax();
  }

  status(a: Agent): string {
    if (this.done && (a.job?.kind === "rest" || !a.job)) return "relaxing at home";
    return super.status(a);
  }

  protected assign(a: Agent, i: number): Job {
    if (this.isDone(this.project)) return { kind: "rest" };
    return super.assign(a, i);
  }
}
