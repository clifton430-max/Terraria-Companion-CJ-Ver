// The background world inside the theme window (behind app windows, under the petals and
// garland). Normally it is a picture: nothing to focus, and it only redraws when something
// changes. Where the bare desktop shows, you can drag it (or scroll) to look around the world,
// while the companions keep walking on whatever terrain comes into view; ⌘-scroll zooms. "Explore" makes it interactive until Esc / Done: drag or scroll to look
// around, zoom, and (when editing is on) place or remove tiles. Edits are saved to their own
// file; the camera is saved in prefs when exploring ends, and streamed live to the companions.

import { gameLoad, gameSave, getCharacterRig, patchPrefs, placesLoad, placesSave, stopGame, worldDragging, worldLoad, worldNav, worldSave, worldView, type CharacterId, type CharacterPrefs, type GameMode, type Place, type PlacesFile, type WorldPrefs } from "../bridge";
import { DEFAULT_TERRARIA_KEYS, keyRole, type TerrariaKeys } from "../overlay/controls";
import { TerrariaRig } from "../overlay/terrariaRig";
import { BIOME_NAMES, parseExtras, parseSaved, PLACEABLE, randomSeed, serializeEdits, T, WorldMap } from "./gen";
import { WorldRenderer } from "./render";
import { clampCamera, DEFAULT_ZOOM, defaultCamera, nearestZoom, screenToTile, tilePx, ZOOMS, type Camera } from "./view";
import { Adventure, agentName as defaultAgentName } from "./game/adventure";
import { customName } from "../characters/roster";
import { AdventureHud } from "./game/adventureHud";
import type { Location } from "./game/locations";
import { Game, noInput, type Input } from "./game/game";
import { addItem, countOf } from "./game/inventory";
import { GameHud } from "./game/hud";
import { computeLight, SkyCache, WARM, type LightGrid, type LightSource } from "./game/lighting";
import { OBJECTS, ObjectLayer } from "./game/objects";
import type { Station } from "./game/inventory";
import { TILE } from "./game/physics";
import { drawGame, drawObjects } from "./game/render";

/** Save gameplay progress this often while playing (and when leaving). */
const GAME_SAVE_MS = 30_000;

const VIEW_STREAM_MS = 50;
/** Building mode runs at a fixed step (the builders were tuned and tested at 30 Hz). */
const AUTO_STEP = 1 / 30;
const MAX_BUILDERS = 4;
/** The places gallery is refreshed (and one missing preview drawn) this often while they play. */
const PLACES_MS = 15_000;
/** Previews: a 70 × 39 tile view at the smallest zoom. */
const PREVIEW_W = 560;
const PREVIEW_H = 312;
const CHARACTER_IDS: readonly CharacterId[] = ["terrarian", "princess", "partygirl", "nurse", "zoologist", "goblin"];
const SAVE_DELAY_MS = 800;

export class WorldLayer {
  private prefs: WorldPrefs | null = null;
  private map: WorldMap | null = null;
  private renderer: WorldRenderer | null = null;
  private cam: Camera | null = null;
  private zoom = DEFAULT_ZOOM;
  private nav = false;
  private hud: HTMLDivElement | null = null;
  private drag: { id: number; x: number; y: number; cam: Camera; paint: number | null; moved: boolean } | null = null;
  private tile: number = T.Dirt;
  private saveTimer = 0;
  private lastStream = 0;
  private streamTimer = 0;
  private drawQueued = 0;
  private disposed = false;
  private loading: Promise<void> | null = null;
  // Furniture, chopped trees and crystals taken (saved with the world).
  private objects: ObjectLayer | null = null;
  // Playing: "player" (your waifu, you control her) or "auto" (the waifus build a house).
  private play = false;
  private mode: GameMode = "player";
  private chars: CharacterPrefs | null = null;
  private adv: Adventure | null = null;
  private advHud: AdventureHud | null = null;
  /** Looking at a place (tile coordinates) instead of following a waifu. */
  private lookAt: { x: number; y: number } | null = null;
  private placesTimer = 0;
  private previews = new Map<string, { data: string; progress: number }>();
  private previewRenderer: WorldRenderer | null = null;
  private agentRigs = new Map<string, TerrariaRig>();
  private follow = 0;
  private speed = 1;
  private acc = 0;
  private game: Game | null = null;
  private gameHud: GameHud | null = null;
  private rig: TerrariaRig | null = null;
  private rigKey = "";
  private input: Input = noInput();
  private keys: TerrariaKeys = DEFAULT_TERRARIA_KEYS;
  private loop = 0;
  private lastFrame = 0;
  private clock = 0;
  private light: LightGrid | null = null;
  private lightKey = "";
  private readonly lightCanvas = document.createElement("canvas");
  private sky: SkyCache | null = null;
  private gameSaveTimer = 0;
  private shownWorldVersion = 0;
  private screenMouse = { x: 0, y: 0 };
  // Dragging the bare desktop to look around (when not exploring or playing).
  private pan = false;
  private panDrag: { id: number; x: number; y: number; cam: Camera } | null = null;
  private panSaveTimer = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  private get size() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** New prefs (or first load). */
  apply(p: WorldPrefs | undefined) {
    const prev = this.prefs;
    this.prefs = p ?? null;
    if (!p || !p.enabled) {
      // Off: drop everything (memory stays bounded) and stop listening.
      this.setNav(false, false);
      this.setPlay(false);
      this.syncPan();
      this.game = null;
      this.map = null;
      this.renderer = null;
      this.objects = null;
      this.cam = null;
      this.canvas.hidden = true;
      return;
    }
    this.canvas.hidden = false;
    if (!p.seed) {
      // First time: pick a seed and save it, so the same world comes back next launch.
      void patchPrefs({ world: { ...p, seed: randomSeed() } });
      return;
    }
    const zoom = nearestZoom(p.zoom);
    if (!this.map || this.map.seed !== p.seed) {
      // A different world: pending edits belonged to the old one.
      clearTimeout(this.saveTimer);
      this.saveTimer = 0;
      void this.load(p.seed);
      return;
    }
    if (!this.nav && !this.play && !this.panDrag && !this.panSaveTimer) {
      // Follow saved camera / zoom changes from settings (exploring and dragging keep their own camera).
      if (zoom !== this.zoom || !prev || prev.cameraX !== p.cameraX || prev.cameraY !== p.cameraY) {
        this.zoom = zoom;
        this.cam = this.savedCamera(p);
      }
    }
    if (this.hud) this.renderHud();
    this.syncPan();
    this.queueDraw();
  }

  private savedCamera(p: WorldPrefs): Camera {
    const { width, height } = this.size;
    const map = this.map!;
    if (p.cameraX < 0 || p.cameraY < 0) return defaultCamera(map, width, height, this.zoom);
    return clampCamera(map, { x: p.cameraX, y: p.cameraY }, width, height, this.zoom, window.devicePixelRatio || 1);
  }

  private async load(seed: number) {
    if (this.loading) await this.loading;
    if (this.disposed || this.prefs?.seed !== seed) return;
    this.loading = (async () => {
      const saved = await worldLoad().catch(() => null);
      if (this.disposed || this.prefs?.seed !== seed) return;
      this.map = new WorldMap(seed, parseSaved(saved, seed));
      const extras = parseExtras(saved, seed);
      for (const c of extras.cut) this.map.cut.add(c);
      for (const [x, y, w] of extras.walls) this.map.walls.set(y * 65536 + x, w);
      this.objects = new ObjectLayer(this.map);
      this.objects.load(extras.objects, extras.taken, extras.furnished);
      if (!this.objects.furnished) {
        // First time this world is opened since structures arrived: furnish them and save.
        this.objects.furnish();
        this.scheduleWorldSave();
      }
      this.sky = new SkyCache(this.map);
      this.renderer = new WorldRenderer(this.map);
      this.zoom = nearestZoom(this.prefs.zoom);
      this.cam = this.savedCamera(this.prefs);
      this.syncPan();
      this.queueDraw();
      await this.renderer.load();
      this.queueDraw();
      this.startAmbient();
    })();
    await this.loading;
    this.loading = null;
  }

  resize() {
    if (this.map && this.cam) this.cam = clampCamera(this.map, this.cam, this.size.width, this.size.height, this.zoom, window.devicePixelRatio || 1);
    this.queueDraw();
  }

  /** Draw on the next frame (coalesced; nothing runs between changes). */
  private queueDraw() {
    if (this.drawQueued || this.disposed) return;
    this.drawQueued = requestAnimationFrame(() => {
      this.drawQueued = 0;
      this.draw();
    });
  }

  private draw() {
    const r = this.renderer;
    if (!r || !this.cam || this.canvas.hidden) return;
    const { width, height } = this.size;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = this.play ? this.game : null;
    // The backdrop follows whoever the camera is with (or the middle of the view).
    const f = g ? this.focus(g) : null;
    const time = g ? { daylight: g.daylight, hour: g.hour, day: g.day } : this.game ? { daylight: this.game.daylight, hour: this.game.hour, day: this.game.day } : {};
    r.draw(ctx, this.cam, this.zoom, width, height, { ...time, lit: !!g, ...(f ? { focus: { x: f.x / TILE, y: f.y / TILE } } : {}) });
    const view = { cam: this.cam, zoom: this.zoom, w: width, h: height };
    if (this.objects) drawObjects(ctx, this.objects, view, this.clock);
    if (g) drawGame(ctx, g, view, { rig: this.rig, agents: this.adv?.crew.agents, agentRigs: this.agentRigs, town: this.adv?.town }, this.input, this.light, this.lightCanvas, this.clock);
    r.drawFront(ctx, this.cam, this.zoom, width, height);
  }

  /** While the world is just shown (not played), it still lives: clouds drift, scenery fades
   * between biomes, snow falls. A light loop (about 24 frames a second, paused when hidden). */
  private ambientLoop = 0;
  private ambientLast = 0;
  private startAmbient() {
    if (this.ambientLoop) return;
    const tick = (now: number) => {
      this.ambientLoop = 0;
      if (this.disposed || this.play) return;
      this.ambientLoop = requestAnimationFrame(tick);
      if (document.hidden || this.canvas.hidden || !this.renderer || now - this.ambientLast < 1000 / 24) return;
      this.ambientLast = now;
      this.clock += 1 / 24;
      this.draw();
    };
    this.ambientLoop = requestAnimationFrame(tick);
  }

  // ── Exploring ────────────────────────────────────────────────────────────────────────────

  /** Rust says exploring started / ended. */
  setNav(on: boolean, persist = true) {
    if (on === this.nav) return;
    if (on && this.play) return; // already playing
    if (on && (!this.map || !this.prefs?.enabled)) return;
    this.nav = on;
    document.body.classList.toggle("world-nav", on);
    if (on) {
      this.canvas.addEventListener("pointerdown", this.onDown);
      this.canvas.addEventListener("pointermove", this.onMove);
      this.canvas.addEventListener("pointerup", this.onUp);
      this.canvas.addEventListener("pointercancel", this.onUp);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
      this.canvas.addEventListener("contextmenu", this.onContext);
      window.addEventListener("keydown", this.onKey);
      this.renderHud();
    } else {
      this.canvas.removeEventListener("pointerdown", this.onDown);
      this.canvas.removeEventListener("pointermove", this.onMove);
      this.canvas.removeEventListener("pointerup", this.onUp);
      this.canvas.removeEventListener("pointercancel", this.onUp);
      this.canvas.removeEventListener("wheel", this.onWheel);
      this.canvas.removeEventListener("contextmenu", this.onContext);
      window.removeEventListener("keydown", this.onKey);
      this.drag = null;
      this.hud?.remove();
      this.hud = null;
      if (persist) this.persistView();
    }
    this.syncPan();
  }

  // ── Dragging the desktop to look around ──────────────────────────────────────────────────

  /** Desktop panning is on while the world is shown, the setting allows it, and nothing else has the pointer. */
  private syncPan() {
    const want = !!this.prefs?.enabled && this.prefs.drag !== false && !this.nav && !this.play && !!this.map && !this.disposed;
    if (want === this.pan) return;
    this.pan = want;
    document.body.classList.toggle("world-pan", want);
    if (want) {
      this.canvas.addEventListener("pointerdown", this.onPanDown);
      this.canvas.addEventListener("pointermove", this.onPanMove);
      this.canvas.addEventListener("pointerup", this.onPanUp);
      this.canvas.addEventListener("pointercancel", this.onPanUp);
      this.canvas.addEventListener("lostpointercapture", this.onPanUp);
      this.canvas.addEventListener("wheel", this.onPanWheel, { passive: false });
    } else {
      this.canvas.removeEventListener("pointerdown", this.onPanDown);
      this.canvas.removeEventListener("pointermove", this.onPanMove);
      this.canvas.removeEventListener("pointerup", this.onPanUp);
      this.canvas.removeEventListener("pointercancel", this.onPanUp);
      this.canvas.removeEventListener("lostpointercapture", this.onPanUp);
      this.canvas.removeEventListener("wheel", this.onPanWheel);
      this.endPan();
    }
  }

  private onPanDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.cam) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // released already
    }
    this.panDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, cam: { ...this.cam } };
    document.body.classList.add("world-panning");
    // While the world is being dragged, the companions don't take the pointer (no accidental grabs).
    void worldDragging(true).catch(() => {});
  };

  private onPanMove = (e: PointerEvent) => {
    const d = this.panDrag;
    if (!d || d.id !== e.pointerId) return;
    const tp = tilePx(this.zoom);
    this.moveCamera({ x: d.cam.x - (e.clientX - d.x) / tp, y: d.cam.y - (e.clientY - d.y) / tp });
  };

  private onPanUp = (e: PointerEvent) => {
    if (this.panDrag?.id !== e.pointerId) return;
    this.endPan();
  };

  private endPan() {
    if (!this.panDrag) return;
    this.panDrag = null;
    document.body.classList.remove("world-panning");
    void worldDragging(false).catch(() => {});
    this.savePanSoon();
  }

  private onPanWheel = (e: WheelEvent) => {
    if (!this.cam) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) this.stepZoom(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
    else {
      const tp = tilePx(this.zoom);
      this.moveCamera({ x: this.cam.x + e.deltaX / tp + (e.shiftKey ? e.deltaY / tp : 0), y: this.cam.y + (e.shiftKey ? 0 : e.deltaY / tp) });
    }
    this.savePanSoon();
  };

  /** Remember where you left the view (one write after the movement settles). */
  private savePanSoon() {
    clearTimeout(this.panSaveTimer);
    this.panSaveTimer = window.setTimeout(() => {
      this.panSaveTimer = 0;
      if (!this.nav && !this.play && !this.panDrag) this.persistView();
    }, 600);
  }

  private persistView() {
    const p = this.prefs;
    if (!p || !this.cam) return;
    this.flushSave();
    void patchPrefs({ world: { ...p, cameraX: this.cam.x, cameraY: this.cam.y, zoom: this.zoom } });
  }

  private finish() {
    void worldNav(false);
  }

  private moveCamera(c: Camera) {
    if (!this.map) return;
    this.cam = clampCamera(this.map, c, this.size.width, this.size.height, this.zoom, window.devicePixelRatio || 1);
    this.queueDraw();
    this.streamView();
  }

  /** Tell the companions where the world is (throttled). */
  private streamView() {
    const send = () => {
      this.lastStream = performance.now();
      if (this.cam) void worldView(this.cam.x, this.cam.y, this.zoom).catch(() => {});
    };
    clearTimeout(this.streamTimer);
    const wait = VIEW_STREAM_MS - (performance.now() - this.lastStream);
    if (wait <= 0) send();
    else this.streamTimer = window.setTimeout(send, wait);
  }

  private setZoom(z: number, at?: { x: number; y: number }) {
    if (!this.cam || !this.map) return;
    const next = nearestZoom(z);
    if (next === this.zoom) return;
    const px = at ?? { x: this.size.width / 2, y: this.size.height / 2 };
    // Keep the tile under the pointer in place.
    const before = { x: this.cam.x + px.x / tilePx(this.zoom), y: this.cam.y + px.y / tilePx(this.zoom) };
    this.zoom = next;
    this.renderHud();
    this.moveCamera({ x: before.x - px.x / tilePx(next), y: before.y - px.y / tilePx(next) });
  }

  private stepZoom(dir: 1 | -1, at?: { x: number; y: number }) {
    const i = ZOOMS.indexOf(this.zoom as (typeof ZOOMS)[number]);
    this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + dir))], at);
  }

  private get editing() {
    return !!this.prefs?.edit;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.cam) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // released already
    }
    // Editing: left places, right (or ⇧) removes; otherwise drag to look around.
    const paint = this.editing && (e.button === 0 || e.button === 2) ? (e.button === 2 || e.shiftKey ? T.Air : this.tile) : null;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cam: { ...this.cam }, paint, moved: false };
    if (paint !== null) this.paintAt(e.clientX, e.clientY, paint);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId || !this.cam) return;
    if (d.paint !== null) {
      this.paintAt(e.clientX, e.clientY, d.paint);
      return;
    }
    const tp = tilePx(this.zoom);
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
    this.moveCamera({ x: d.cam.x - (e.clientX - d.x) / tp, y: d.cam.y - (e.clientY - d.y) / tp });
  };

  private onUp = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  private onContext = (e: Event) => e.preventDefault();

  private onWheel = (e: WheelEvent) => {
    if (!this.cam) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.stepZoom(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
      return;
    }
    const tp = tilePx(this.zoom);
    this.moveCamera({ x: this.cam.x + e.deltaX / tp + (e.shiftKey ? e.deltaY / tp : 0), y: this.cam.y + (e.shiftKey ? 0 : e.deltaY / tp) });
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.cam) return;
    const step = 8;
    switch (e.key) {
      case "Escape":
        this.finish();
        return;
      case "ArrowLeft":
      case "a":
        this.moveCamera({ ...this.cam, x: this.cam.x - step });
        break;
      case "ArrowRight":
      case "d":
        this.moveCamera({ ...this.cam, x: this.cam.x + step });
        break;
      case "ArrowUp":
      case "w":
        this.moveCamera({ ...this.cam, y: this.cam.y - step });
        break;
      case "ArrowDown":
      case "s":
        this.moveCamera({ ...this.cam, y: this.cam.y + step });
        break;
      case "+":
      case "=":
        this.stepZoom(1);
        break;
      case "-":
        this.stepZoom(-1);
        break;
      case "e":
        this.toggleEdit();
        break;
      case "Home":
        this.center();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  private center() {
    if (this.map) this.moveCamera(defaultCamera(this.map, this.size.width, this.size.height, this.zoom));
  }

  private toggleEdit() {
    const p = this.prefs;
    if (!p) return;
    void patchPrefs({ world: { ...p, edit: !p.edit } });
  }

  private paintAt(sx: number, sy: number, t: number) {
    const m = this.map;
    const r = this.renderer;
    if (!m || !r || !this.cam) return;
    const { x, y } = screenToTile(this.cam, this.zoom, sx, sy);
    if (!m.set(x, y, t)) return;
    r.invalidate(x, y);
    this.queueDraw();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private flushSave() {
    if (!this.saveTimer || !this.map) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    void worldSave(serializeEdits(this.map.seed, this.map.edits, { cut: this.map.cut, objects: this.objects?.serialize(), taken: this.objects?.taken, walls: this.map.walls, furnished: this.objects?.furnished })).catch(() => {});
  }

  /** Save soon (debounced) — used for tile edits, furniture and chests from the game. */
  private scheduleWorldSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  /** The small explore bar at the top (only while exploring). */
  private renderHud() {
    if (!this.nav) return;
    if (!this.hud) {
      this.hud = document.createElement("div");
      this.hud.className = "world-hud";
      this.hud.addEventListener("pointerdown", (e) => e.stopPropagation());
      document.body.append(this.hud);
    }
    const hud = this.hud;
    hud.replaceChildren();
    const btn = (label: string, act: () => void, title?: string, on = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `world-btn${on ? " on" : ""}`;
      b.textContent = label;
      if (title) {
        b.title = title;
        b.setAttribute("aria-label", title);
      }
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        act();
      });
      return b;
    };
    const title = document.createElement("strong");
    title.textContent = "Exploring the world";
    const hint = document.createElement("span");
    hint.className = "world-hint";
    hint.textContent = this.editing ? "Click to place · right-click to remove · drag paints" : "Drag or scroll to look around · ⌘-scroll or +/− to zoom";
    hud.append(
      title,
      hint,
      btn("−", () => this.stepZoom(-1), "Zoom out"),
      btn(`${this.zoom}×`, () => this.setZoom(DEFAULT_ZOOM), "Reset zoom"),
      btn("+", () => this.stepZoom(1), "Zoom in"),
      btn("Center", () => this.center(), "Back to the middle of the world"),
      btn(this.editing ? "Editing: on" : "Editing: off", () => this.toggleEdit(), "Place and remove tiles (E)", this.editing),
    );
    if (this.editing) for (const t of PLACEABLE) hud.append(btn(t.name, () => ((this.tile = t.id), this.renderHud()), `Place ${t.name}`, this.tile === t.id));
    hud.append(btn("Done", () => this.finish(), "Stop exploring (Esc)"));
  }

  // ── Playing (Control Mode) ──────────────────────────────────────────────────────────────

  setKeys(keys: TerrariaKeys | undefined) {
    this.keys = keys ?? DEFAULT_TERRARIA_KEYS;
  }

  /** Who's on screen, who's selected (for picking who plays). */
  setCharacters(c: CharacterPrefs | undefined) {
    this.chars = c ?? null;
    this.nameAgents();
  }

  /** The waifus go by the names you gave them in the HUD and journal. */
  private nameAgents() {
    for (const a of this.adv?.crew.agents ?? []) a.name = customName(a.id, this.chars) || defaultAgentName(a.id);
  }

  /** The waifu who plays in player mode: the one chosen in World settings, or your selected companion. */
  private get playerId(): CharacterId {
    const want = this.prefs?.player;
    if (want && (CHARACTER_IDS as readonly string[]).includes(want)) return want as CharacterId;
    return this.chars?.selected ?? "terrarian";
  }

  /** Rust says the game started / ended. */
  setPlay(on: boolean, mode: GameMode = "player") {
    if (on && this.play && mode !== this.mode) this.stopPlay();
    if (on === this.play) return;
    if (on && (!this.map || !this.objects || !this.prefs?.enabled)) {
      // Not ready (still loading): try again in a moment.
      if (on) window.setTimeout(() => this.setPlay(true, mode), 300);
      return;
    }
    if (on) void this.startPlay(mode);
    else this.stopPlay();
  }

  private async startPlay(mode: GameMode) {
    if (this.nav) this.setNav(false);
    const map = this.map!;
    const objects = this.objects!;
    if (!this.game || this.game.map !== map) {
      const g = new Game(map, objects);
      g.load(await gameLoad().catch(() => null));
      this.game = g;
    }
    if (this.disposed || !this.map || this.play) return;
    const g = this.game;
    this.mode = mode;
    g.mode = mode;
    this.play = true;
    this.syncPan();
    document.body.classList.add("world-play");
    this.input = noInput();
    this.acc = 0;
    if (mode === "auto") {
      // The companions on screen (up to four) set off on their adventure (or carry on with it).
      const active = (this.chars?.active ?? []).filter((id, i, all) => all.indexOf(id) === i).slice(0, MAX_BUILDERS);
      const ids = active.length ? active : [this.playerId];
      // Gel for the first torches (Terraria players get some from the first slimes).
      const gel = countOf(g.inventory, 23);
      if (gel < 10) addItem(g.inventory, 23, 10 - gel);
      this.adv = new Adventure(g, ids);
      this.nameAgents();
      this.follow = 0;
      this.lookAt = null;
      this.advHud = new AdventureHud(this.adv, {
        stop: () => void stopGame().catch(() => {}),
        follow: (i) => {
          this.follow = i;
          this.lookAt = null;
        },
        following: () => (this.lookAt ? -1 : this.follow),
        speed: () => this.speed,
        setSpeed: (v) => (this.speed = v),
        goto: (l: Location) => this.goto(l.x, l.y),
      });
      void this.loadPreviews();
      this.placesTimer = window.setInterval(() => void this.publishPlaces(), PLACES_MS);
      void this.loadAgentRigs(ids);
      this.canvas.addEventListener("wheel", this.onPlayWheel, { passive: false });
      this.canvas.addEventListener("pointerdown", this.onAutoDown);
      this.canvas.addEventListener("contextmenu", this.onContext);
      window.addEventListener("keydown", this.onAutoKey);
      this.lastFrame = 0;
      this.loop = requestAnimationFrame(this.frame);
      this.gameSaveTimer = window.setInterval(() => this.saveGame(), GAME_SAVE_MS);
      return;
    }
    g.agents = [];
    this.gameHud = new GameHud(g, {
      leave: () => void stopGame().catch(() => {}),
      stationsNear: () => {
        const c = this.game!.playerCenter;
        return objects.stationsNear(c.x / TILE, c.y / TILE) as Set<Station>;
      },
    });
    this.canvas.addEventListener("pointerdown", this.onPlayDown);
    this.canvas.addEventListener("pointermove", this.onPlayMove);
    window.addEventListener("pointerup", this.onPlayUp);
    this.canvas.addEventListener("wheel", this.onPlayWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContext);
    window.addEventListener("keydown", this.onPlayKey);
    window.addEventListener("keyup", this.onPlayKeyUp);
    window.addEventListener("blur", this.onPlayBlur);
    this.rigKey = "";
    void this.loadRig();
    this.lastFrame = 0;
    this.loop = requestAnimationFrame(this.frame);
    this.gameSaveTimer = window.setInterval(() => this.saveGame(), GAME_SAVE_MS);
  }

  private async loadAgentRigs(ids: readonly CharacterId[]) {
    for (const id of ids) {
      if (this.agentRigs.has(id)) continue;
      try {
        const rig = await TerrariaRig.load(await getCharacterRig(id));
        if (rig) this.agentRigs.set(id, rig);
      } catch {
        // drawn as a plain figure
      }
    }
  }

  private onAutoDown = (e: PointerEvent) => {
    // Click: follow the next waifu (and stop looking at a place).
    const n = this.adv?.crew.agents.length ?? 0;
    if (e.button === 0 && n) {
      this.follow = this.lookAt ? this.follow : (this.follow + 1) % n;
      this.lookAt = null;
    }
  };

  private onAutoKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      void stopGame().catch(() => {});
      e.preventDefault();
    } else if (e.key === "+" || e.key === "=") this.stepZoom(1);
    else if (e.key === "-") this.stepZoom(-1);
    else if (e.key === "Tab") {
      const n = this.adv?.crew.agents.length ?? 0;
      if (n) this.follow = (this.follow + 1) % n;
      this.lookAt = null;
      e.preventDefault();
    }
  };

  private stopPlay() {
    if (!this.play) return;
    this.play = false;
    cancelAnimationFrame(this.loop);
    this.startAmbient();
    clearInterval(this.gameSaveTimer);
    document.body.classList.remove("world-play");
    this.canvas.removeEventListener("pointerdown", this.onPlayDown);
    this.canvas.removeEventListener("pointermove", this.onPlayMove);
    window.removeEventListener("pointerup", this.onPlayUp);
    this.canvas.removeEventListener("wheel", this.onPlayWheel);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("keydown", this.onPlayKey);
    window.removeEventListener("keyup", this.onPlayKeyUp);
    window.removeEventListener("blur", this.onPlayBlur);
    this.canvas.removeEventListener("pointerdown", this.onAutoDown);
    window.removeEventListener("keydown", this.onAutoKey);
    clearInterval(this.placesTimer);
    this.advHud?.destroy();
    this.advHud = null;
    if (this.adv) {
      void this.publishPlaces();
      this.adv.detach();
      this.adv = null;
    }
    this.lookAt = null;
    if (this.game) {
      this.game.agents = [];
      this.game.mode = "player";
      this.game.inventoryOpen = false;
      this.game.chest = null;
      if (this.game.cursor) this.game.dropCursor();
    }
    this.gameHud?.destroy();
    this.gameHud = null;
    this.saveGame();
    this.flushSave();
    // Back to the passive background, where the player left the view.
    this.persistView();
    this.syncPan();
    this.queueDraw();
  }

  // ── Places (the gallery) ─────────────────────────────────────────────────────────────────

  /** Look at a place (tile coordinates): while they play, the camera stays there until you pick a
   * waifu to follow; otherwise the background view moves there. */
  goto(x: number, y: number) {
    if (!this.map) return;
    if (this.play) {
      if (this.mode === "auto") this.lookAt = { x, y };
      return;
    }
    const { width, height } = this.size;
    const tp = tilePx(this.zoom);
    this.moveCamera({ x: x - width / tp / 2, y: y - height / tp / 2 });
    if (!this.nav) this.persistView();
  }

  /** Previews drawn in earlier sessions (kept while the world is the same). */
  private async loadPreviews() {
    const raw = await placesLoad().catch(() => null);
    if (!raw || !this.map) return;
    try {
      const f = JSON.parse(raw) as Partial<PlacesFile>;
      if (f.seed !== this.map.seed || !Array.isArray(f.places)) return;
      for (const p of f.places)
        if (p && typeof p.id === "string" && typeof p.preview === "string" && p.preview.startsWith("data:image/") && !this.previews.has(p.id)) this.previews.set(p.id, { data: p.preview, progress: typeof p.progress === "number" ? p.progress : 0 });
    } catch {
      // a damaged file: previews are redrawn
    }
  }

  /** Save the gallery: every place found so far, with one more preview drawn each time. */
  private async publishPlaces() {
    const adv = this.adv;
    const map = this.map;
    if (!adv || !map) return;
    const found = adv.locations.filter((l) => l.discovered);
    const stale = found.find((l) => !this.previews.has(l.id)) ?? found.find((l) => l.progress !== undefined && Math.abs((this.previews.get(l.id)?.progress ?? 0) - l.progress) >= 0.1);
    if (stale) {
      const data = this.renderPreview(stale);
      if (data) this.previews.set(stale.id, { data, progress: stale.progress ?? 0 });
    }
    const places: Place[] = found.map((l) => ({
      id: l.id,
      kind: l.kind,
      name: l.name,
      label: BIOME_NAMES[l.biome] ?? l.biome,
      x: l.x,
      y: l.y,
      day: l.day,
      progress: l.progress,
      status: l.status,
      preview: this.previews.get(l.id)?.data,
    }));
    const file: PlacesFile = { seed: map.seed, places };
    await placesSave(JSON.stringify(file)).catch(() => false);
  }

  /** A small picture of a place (terrain, buildings and furniture), as a JPEG data URL. */
  private renderPreview(l: Location): string | null {
    const map = this.map;
    if (!map || !this.renderer?.hasArt) return null;
    let r = this.previewRenderer;
    if (!r) r = this.previewRenderer = new WorldRenderer(map);
    r.setMap(map);
    r.shareArt(this.renderer);
    const c = document.createElement("canvas");
    c.width = PREVIEW_W;
    c.height = PREVIEW_H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const zoom = ZOOMS[0];
    const tp = tilePx(zoom);
    const cam = clampCamera(map, { x: l.x - PREVIEW_W / tp / 2, y: l.y - PREVIEW_H / tp / 2 }, PREVIEW_W, PREVIEW_H, zoom, 1);
    r.backdrop.reset();
    r.draw(ctx, cam, zoom, PREVIEW_W, PREVIEW_H, { lit: true });
    if (this.objects) drawObjects(ctx, this.objects, { cam, zoom, w: PREVIEW_W, h: PREVIEW_H }, this.clock);
    r.dropCache();
    try {
      return c.toDataURL("image/jpeg", 0.72);
    } catch {
      return null;
    }
  }

  private saveGame() {
    if (!this.game) return;
    if (this.adv) this.game.adventureSave = this.adv.save();
    void gameSave(JSON.stringify(this.game.save())).catch(() => {});
  }

  /** The player is your waifu, in her own look (armour still protects her; it isn't drawn). */
  private async loadRig() {
    if (!this.game) return;
    const id = this.playerId;
    if (id === this.rigKey) return;
    this.rigKey = id;
    try {
      const rig = await TerrariaRig.load(await getCharacterRig(id));
      if (this.rigKey === id) this.rig = rig;
    } catch {
      // keep the previous look
    }
  }

  private frame = (now: number) => {
    if (!this.play || !this.game || !this.map) return;
    this.loop = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.clock += dt;
    const g = this.game;
    const { width, height } = this.size;
    // Mouse in world pixels (it moves with the camera even when the mouse doesn't).
    if (this.cam) {
      const k = tilePx(this.zoom) / TILE;
      this.input.mouse.x = this.cam.x * TILE + this.screenMouse.x / k;
      this.input.mouse.y = this.cam.y * TILE + this.screenMouse.y / k;
    }
    const viewTiles = { w: width / (tilePx(this.zoom) / TILE), h: height / (tilePx(this.zoom) / TILE) };
    if (this.mode === "auto" && this.adv) {
      // Fixed steps (at 16× that's eight a frame; a slow frame doesn't snowball).
      this.acc = Math.min(this.acc + dt * this.speed, AUTO_STEP * 8 * Math.min(this.speed, 2));
      while (this.acc >= AUTO_STEP) {
        this.acc -= AUTO_STEP;
        g.update(AUTO_STEP, noInput(), viewTiles);
        this.adv.step(AUTO_STEP);
      }
    } else g.update(dt, this.input, viewTiles);
    // Tiles the game changed: re-rasterise their chunks and sky columns.
    for (const c of g.changed) {
      this.renderer?.invalidate(c.x, c.y);
      this.sky?.invalidate(c.x);
    }
    if (g.changed.length) this.lightKey = "";
    g.changed = [];
    if (g.worldVersion !== this.shownWorldVersion) {
      this.shownWorldVersion = g.worldVersion;
      this.lightKey = "";
      this.scheduleWorldSave();
    }
    if (this.mode === "player") void this.loadRig();
    this.advHud?.update();
    // The camera follows the player (or the builder you're watching), smoothly.
    const tp = tilePx(this.zoom);
    const c = this.focus(g);
    const want = { x: c.x / TILE - width / tp / 2, y: c.y / TILE - height / tp / 2 };
    const cur = this.cam ?? want;
    const k = Math.min(1, dt * 8);
    this.cam = clampCamera(this.map, { x: cur.x + (want.x - cur.x) * k, y: cur.y + (want.y - cur.y) * k }, width, height, this.zoom, window.devicePixelRatio || 1);
    this.streamView();
    this.updateLight(width, height, g);
    this.draw();
    this.gameHud?.update();
  };

  private focus(g: Game): { x: number; y: number } {
    if (this.lookAt) return { x: this.lookAt.x * TILE, y: this.lookAt.y * TILE };
    const a = this.adv?.crew.agents[this.follow];
    return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : g.playerCenter;
  }

  private updateLight(width: number, height: number, g: Game) {
    if (!this.map || !this.cam || !this.sky || !this.objects) return;
    const tp = tilePx(this.zoom);
    const x0 = Math.floor(this.cam.x) - 1;
    const y0 = Math.floor(this.cam.y) - 1;
    const cols = Math.ceil(width / tp) + 3;
    const rows = Math.ceil(height / tp) + 3;
    const pc0 = this.focus(g);
    // Recomputed when the view, time or the light-carrying figures move (or `lightKey` is cleared).
    const movers = this.mode === "auto" ? (this.adv?.crew.agents ?? []).map((a) => `${Math.floor(a.x / TILE)}:${Math.floor(a.y / TILE)}`).join(";") : `${Math.floor(pc0.x / TILE)}:${Math.floor(pc0.y / TILE)}`;
    const key = `${x0},${y0},${cols},${rows},${Math.round(g.daylight * 20)},${movers}`;
    if (key === this.lightKey && this.light) return;
    const sources: LightSource[] = this.objects
      .inRect(x0 - 12, y0 - 12, x0 + cols + 12, y0 + rows + 12)
      .filter((o) => OBJECTS[o.t].light)
      .map((o) => ({ x: o.x + Math.floor(OBJECTS[o.t].w / 2), y: o.y + Math.floor(OBJECTS[o.t].h / 2), level: OBJECTS[o.t].light!, color: OBJECTS[o.t].glow ?? WARM }));
    // A dim light around the player (or each builder), so caves aren't pitch black before torches.
    const pc = g.playerCenter;
    if (this.mode === "auto") for (const a of this.adv?.crew.agents ?? []) sources.push({ x: Math.floor((a.x + a.w / 2) / TILE), y: Math.floor((a.y + a.h / 2) / TILE), level: 0.5 });
    else if (g.player.dead <= 0) sources.push({ x: Math.floor(pc.x / TILE), y: Math.floor(pc.y / TILE), level: 0.5 });
    this.light = computeLight(this.map, this.sky, x0, y0, cols, rows, g.daylight, sources);
    this.lightKey = key;
  }

  private onPlayDown = (e: PointerEvent) => {
    const g = this.game;
    if (!g) return;
    this.screenMouse = { x: e.clientX, y: e.clientY };
    // With the inventory open, a click in the world throws the held item out.
    if (g.inventoryOpen && g.cursor && e.button === 0) {
      g.dropCursor();
      return;
    }
    if (e.button === 0) this.input.mouse.left = true;
    if (e.button === 2) this.input.mouse.right = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private onPlayMove = (e: PointerEvent) => {
    this.screenMouse = { x: e.clientX, y: e.clientY };
    this.gameHud?.setMouse(e.clientX, e.clientY);
  };

  private onPlayUp = (e: PointerEvent) => {
    if (e.button === 0) this.input.mouse.left = false;
    if (e.button === 2) this.input.mouse.right = false;
  };

  private onPlayWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.stepZoom(e.deltaY < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(e.deltaY) > 2) this.game?.hotbarStep(e.deltaY > 0 ? 1 : -1);
  };

  private onPlayKey = (e: KeyboardEvent) => {
    const g = this.game;
    if (!g) return;
    const role = keyRole(e.code, this.keys);
    if (role) {
      this.input[role] = true;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      // Terraria: Esc opens / closes the inventory (and closes a chest).
      g.inventoryOpen = !g.inventoryOpen;
      if (!g.inventoryOpen) g.chest = null;
      g.version++;
      e.preventDefault();
      return;
    }
    if (/^Digit[0-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      g.selected = (n + 9) % 10;
      g.version++;
      return;
    }
    if (e.code === "KeyH") g.quickHeal();
    if (e.key === "+" || e.key === "=") this.stepZoom(1);
    if (e.key === "-") this.stepZoom(-1);
  };

  private onPlayKeyUp = (e: KeyboardEvent) => {
    const role = keyRole(e.code, this.keys);
    if (role) this.input[role] = false;
  };

  /** Switching to another app lets go of your keys; the world (and the game) keeps running. */
  private onPlayBlur = () => {
    this.input = noInput();
  };

  destroy() {
    this.setPlay(false);
    this.disposed = true;
    this.syncPan();
    clearTimeout(this.panSaveTimer);
    this.flushSave();
    cancelAnimationFrame(this.drawQueued);
    cancelAnimationFrame(this.ambientLoop);
    clearTimeout(this.streamTimer);
    this.setNav(false, false);
    this.map = null;
    this.renderer = null;
  }
}
