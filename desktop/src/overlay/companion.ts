// Imperative runtime for the overlay: runs the simulation loop, draws the sprite,
// handles dragging and keeps the Rust side informed of the interactive hitbox.

import {
  combatCommand,
  ambientGeometry,
  onWorldEdits,
  onWorldView,
  worldLoad,
  emitBossState,
  getCursor,
  chatAsk,
  chatCancel,
  studyAsk,
  studyGemini,
  studyLook,
  destroyerStrike,
  emitChatAppend,
  emitChatCommand,
  focusOverlay,
  wisprLaunch,
  wisprTakeBack,
  type WisprStatus,
  patchPrefs,
  transcribe,
  showChat,
  showInventory,
  type AppSwitch,
  type DestroyerEvent,
  type ReactionRule,
  setCapture,
  setBuildMode,
  setControlMode,
  setLinesMode,
  setHitbox,
  userIdleSeconds,
  listAddons,
  type AddonInfo,
  type CharacterId,
  type BuildPrefs,
  toggleInventory,
  type BossDifficulty,
  type CombatCommand,
  type CompanionMode,
  type CursorMode,
  type Prefs,
  type CharacterPrefs,
} from "../bridge";
import { center, handPosition, type PlayerInfo } from "../combat/geometry";
import { cycle, equippedWeapon, fromSaved, select, type InventoryState } from "../combat/inventory";
import type { NotchAction, NotchResident } from "../bridge";
import { CombatRenderer } from "../combat/render";
import { shortcutFor, type ShortcutAction } from "../combat/shortcuts";
import {
  aimAt,
  aliveDummies,
  attackPose,
  bossHealth,
  canAttack,
  createCombat,
  cancelAttack,
  dismissBoss,
  dismissMoonLord,
  retryMoonLord,
  summonMoonLord,
  anyBoss,
  dismissQueenBee,
  retryQueenBee,
  summonQueenBee,
  dismissMinions,
  fitDummies,
  preferredRange,
  rectOf,
  resetTraining,
  retryBoss,
  setTraining,
  summonBoss,
  stepCombat,
  tryAttack,
  type CombatState,
} from "../combat/sim";
import { MINION_CAPACITY, isPickaxe, pickaxePower, pickaxeUseTime, type WeaponDef } from "../combat/weapons";
import { pickaxeHead } from "../combat/pickaxeAnim";
import { AudioEngine } from "../audio/engine";
import { ReactionEngine, type Reaction, type ReactionSettings } from "../reactions/engine";
import { IdleRotation, idleFrame, type IdleSettings } from "./idle";
import { placeBubble } from "./bubble";
import { ContextMenu, MENU_IDLE_CLOSE, menuPosition, unionRect, type MenuAction } from "./contextMenu";
import { micErrorMessage, voiceStep, type VoiceEffect, type VoiceEvent, type VoiceSettings, type VoiceState } from "../voice/machine";
import { VoiceRecorder } from "../voice/recorder";
import { VoiceCard } from "../voice/VoiceCard";
import { encodeWav, resample, toBase64 } from "../voice/wav";
import { DestroyerBuddy } from "../bookmarklet/buddy";
import { SilkController } from "../silk/controller";
import type { SilkVisual } from "../silk/render";
import { ImpactBursts, crossedImpact, impactTarget, strikeReach } from "../effects/pickaxe";
import {
  attackAnimFor,
  attackFrameIndex,
  frameIndex,
  landDuration,
  selectAnim,
  type Anim,
} from "../engine/animation";
import { decide, initialAi, mulberry32, type AiState, type CombatGoal } from "../engine/behavior";
import { planJump, planJumpToward, type JumpChoice } from "../engine/jump";
import {
  DEFAULT_PHYSICS,
  clampToBounds,
  dragTo,
  makeBody,
  release,
  step,
  throwVelocity,
  type Body,
  type Bounds,
  type Dir,
  type PhysicsConfig,
  type Ceiling,
  type Platform,
  type Wall,
  type PointerSample,
} from "../engine/physics";
import { isBlockKind, sanitizeBlocks, type Block, type BlockKind } from "../engine/blocks";
import { BuildLayer, type BuildStatus } from "./buildLayer";
import { LineLayer, type LineStatus } from "./lineLayer";
import { AffectionEngine, type AffectionConfig } from "../affection/engine";
import { sentiment } from "../affection/model";
import { CookieView, spawnCookie, stepCookie } from "./cookie";
import { Buddy, unstack, type BuddyFight, type BuddyModes, type BuddyWorld } from "./buddy";
import { ChessView } from "../chess/view";
import { HangoutPicker } from "./hangoutPicker";
import { parseSaved, WorldMap } from "../world/gen";
import { clampCamera, defaultCamera, liftOut, nearestZoom, terrainSurfaces, type Camera, type TerrainSurfaces } from "../world/view";
import { DEFAULT_BEHAVIOR, hangoutPose, hangoutSlots, lineIdOf, newWatchNav, normalizeBehavior, tuningFor, watchIndex, watchStep, type HangoutPose, type JumpTuning, type WatchNav } from "../engine/behaviorModes";
import type { ActorPort, ActorPose } from "../chess/director";
import { CHARACTERS, customName, displayName, styleBubble } from "../characters/roster";
import { stripWake } from "../voice/wake";
import { Classroom } from "../study/Classroom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { chooseBanter, makeBanter, nextBanterDelay, type BanterLine } from "../characters/banter";
import { goblinAppRemark } from "../characters/lines";
import { bossTarget, flyToward, tactic, threatsOf, type Threat } from "../combat/tactics";
import { getWeapon as weaponById } from "../combat/weapons";
import { emptyRouter, route, routeText } from "../assistant/router";
import { appDeps } from "../assistant/deps";
import { DEFAULT_SILENCE, feedLevel, newSilence, quietFor, type SilenceState } from "../voice/silence";
import { isLineId, sanitizeLines, type Line } from "../engine/lines";
import { carry, junctionWalls, visibleTops, type WindowRect } from "../engine/platforms";
import { ledgeDistance, rememberVisit } from "../engine/explore";
import { LetterBreaker } from "../effects/letterBreak";
import { sampleWord } from "../effects/sampleWord";
import { FRAMES, SPRITE_H, SPRITE_W, renderFrame } from "../engine/sprites";
import { DEFAULT_TERRARIA_KEYS, aimToward, applyFlight, applyJumpRelease, controlIntent, dropThrough, hitsBody, keyRole, lockFacing, noKeys, normalizeTerrariaKeys, pressAction, type HeldKeys, type TerrariaKeys } from "./controls";
import {
  DEFAULT_CELL,
  FOLLOW_RATE,
  LEGACY_CELL,
  cursorAnchor,
  effectiveMode,
  followStep,
  homeToPosition,
  legacyAnimFor,
  positionToHome,
  releaseFromCursor,
  stayMove,
  type CellGeometry,
} from "./modes";
import { rigScaleFor, selectRigFrame } from "./rigFrames";
import { NotchHome, atlasFromLegacy, atlasFromRig } from "./notch";
import type { TerrariaRig } from "./terrariaRig";
import type { GameMode } from "../bridge";

/** Pointer travel (CSS px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 3;
/** Seconds between opportunistic saves of the horizontal position. */
const SAVE_INTERVAL = 10;
/** Minimum ms between hitbox updates to Rust; the 4px hover padding absorbs the drift. */
const HITBOX_INTERVAL_MS = 50;
/** Frame interval while paused: nothing moves, so redraw rarely. */
/** Seconds on one invisible line before a roaming character drops through it. */
const LINE_ESCAPE_TIME = 20;
/** The same, in "stay grounded" mode. */
const GROUNDED_LINE_ESCAPE = 5;
const PAUSED_FRAME_MS = 250;
/** How long a reaction's pose plays (seconds). */
const REACTION_POSE_TIME = 2.4;


/** Knockback when the boss or a Servant hits the companion (CSS px/s). */
const HIT_KNOCKBACK = { x: 320, y: -260 };

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  samples: PointerSample[];
}

export class Companion {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rng = mulberry32(Date.now());
  private readonly cfg: PhysicsConfig = { ...DEFAULT_PHYSICS };
  private readonly frameCache = new Map<string, HTMLCanvasElement>();
  private bounds: Bounds;
  private body: Body;
  private ai: AiState = initialAi();
  /** Latest eligible windows from Rust and the visible top edges derived from them. */
  private windows: WindowRect[] = [];
  private lastBoss: "eye" | "moon" | "queen" = "eye";
  /** Window-derived surfaces; `platforms`/`walls` add the placed blocks' surfaces to these. */
  private windowPlatforms: Platform[] = [];
  private windowWalls: Wall[] = [];
  private ceilings: Ceiling[] = [];
  /** Build mode (session-only, from Rust) and the placed blocks. */
  private building = false;
  private readonly buildLayer: BuildLayer;
  private buildPrefs: BuildPrefs | null = null;
  private buildSaveTimer = 0;
  /** HUD hook (Overlay.tsx). */
  onBuildStatus: ((s: BuildStatus) => void) | null = null;
  /** Invisible platforms and their edit mode. */
  private editingLines = false;
  private readonly lineLayer: LineLayer;
  private linePrefs: Prefs["lines"] | null = null;
  private lineSaveTimer = 0;
  /** Seconds the roaming character has stood on one invisible line (see the trap guard). */
  private lineStandT = 0;
  onLineStatus: ((s: LineStatus) => void) | null = null;
  private platforms: Platform[] = [];
  private walls: Wall[] = [];
  /** Window tops landed on recently (roaming prefers new ones). */
  private recentSurfaces: number[] = [];
  private scale: number;
  private paused: boolean;
  /** Inside the background-world game: "player" (she is the player) or "auto" (everyone builds). */
  private inGame: GameMode | null = null;
  private hitWall: -1 | 0 | 1 = 0;
  private landTimer = 0;
  private anim: Anim = "fall";
  private animTime = 0;
  private drag: DragState | null = null;
  private lastTime = 0;
  private raf = 0;
  private drawnKey = "";
  private reportedHitbox = "";
  private hitboxSentAt = 0;
  private pausedTimer = 0;
  private savedX: number;
  private saveClock = 0;
  /** Combat sandbox state, its renderer and the equipped inventory. */
  private readonly combat: CombatState = createCombat(Date.now());
  private readonly fx: CombatRenderer;
  private inventory: InventoryState;
  private fxDirty = true;
  private fxDrewLast = false;
  /** Real Terraria character atlas, when the local game install provided one. */
  private rig: TerrariaRig | null = null;
  private walkDistance = 0;
  /** "Control Character" mode: keyboard/mouse drive the character instead of the AI. */
  private control = false;
  private keys: HeldKeys = noKeys();
  /** Your Terraria Controls bindings. */
  private terrariaKeys: TerrariaKeys = DEFAULT_TERRARIA_KEYS;
  private jumpWasHeld = false;
  private mouseHeld = false;
  private cursor = { x: 0, y: 0 };
  /** Companion modes (from prefs). */
  private companionMode: CompanionMode = "roam";
  private cursorMode: CursorMode = "off";
  private bossDifficulty: BossDifficulty = "normal";
  /** Stay-Put home (body top-left x/y, CSS px); null until chosen. */
  private home: { x: number; y: number } | null = null;
  /** Set after a drag in Stay mode: the landing spot becomes the new home. */
  private rehomeOnLand = false;
  /** Latest pointer position streamed by Rust for the cursor modes. */
  private pointer: { x: number; y: number } | null = null;
  /** Atlas frame forced by a mode (sit, ride, hug, wave…); null = normal animation. */
  private frameOverride: string | null = null;
  private clock = 0;
  private readonly letters = new LetterBreaker(sampleWord, Math.random);
  private effectWord = "TERRARIA";
  /** Pickaxe: impact bursts; strikes near the pointer are sent to the Letter Destroyer bookmarklet. */
  private readonly impacts = new ImpactBursts();
  private pickaxeStrikes = true;
  private lastStrikeHint = -Infinity;
  private pickaxeCooldown = 0.45;
  /** The attack whose impact already fired (so each swing connects once). */
  private impactFor: object | null = null;
  /** The swing the user triggered themselves (it strikes at the pointer, any distance). */
  private manualSwing: object | null = null;
  private readonly audio = new AudioEngine();
  private flying = false;
  private flightSpeed = 320;
  /** Idle poses while staying put. */
  private readonly idleRot = new IdleRotation(Math.random);
  private idleSettings: IdleSettings = { mode: "rotate", fixed: "stand", interval: 45, paused: false };
  /** Mirror the character for the current idle frame (looking around). */
  private flipOverride = false;
  private napping = false;
  /** Saved favourite spot (screen fractions), restored on launch and display changes. */
  private favorite: { x: number; y: number } | null = null;
  /** True while `home` is the favourite spot (vs. wherever it was dropped). */
  private homeIsFavorite = false;
  /** App-switch reactions. */
  private readonly reactions = new ReactionEngine(Math.random);
  private reactionRules: ReactionRule[] = [];
  private reactionSettings: ReactionSettings = { enabled: false, quiet: false, quietText: false, excluded: [] };
  private reactionPose: { animation: string; until: number; t0: number } | null = null;
  /** Speech bubble (DOM, pointer-transparent) and when it hides. */
  private readonly bubble: HTMLDivElement;
  private bubbleUntil = 0;
  /** Right-click menu and when it auto-closes (wall-clock seconds). */
  private readonly menu = new ContextMenu((a) => this.onMenuAction(a));
  private menuUntil = 0;
  private screenEnabled = false;
  /** Push-to-talk. */
  private voiceState: VoiceState = { kind: "idle" };
  private voiceSettings: VoiceSettings = { enabled: false, mode: "hold", review: true, autoSubmit: true };
  /** Seconds of silence that end a recording (auto-submit). */
  private voiceSilence = 2;
  private silence: SilenceState = newSilence();
  private silenceClock = 0;
  private interimTimer = 0;
  private interimBusy = false;
  private voiceRouter = emptyRouter();
  /** The hidden affection meter and spontaneous dialogue. */
  private affection!: AffectionEngine;
  private mainAffectionHooks!: import("../affection/engine").AffectionHooks;
  private readonly cookie: CookieView;
  private cookieHoverSaid = false;
  private cookieEater: Buddy | null = null;
  /** The selected roster character (the one this companion draws and Control mode drives). */
  private character: CharacterId = "terrarian";
  /** The other characters on screen, each autonomous. */
  private readonly buddies = new Map<CharacterId, Buddy>();
  /** The chess board, while it's open. */
  private chess: ChessView | null = null;
  /** CustomNotch as a home for one companion (see ./notch.ts). */
  private readonly notch: NotchHome;
  /** Thrown by the user and still in the air until then (the notch can catch her). */
  private thrownUntil = 0;
  private lastPointer: { x: number; y: number } | null = null;
  /** Set while the chess director is moving the main companion (feet position, frame, facing). */
  private chessPose: ActorPose | null = null;
  /** Movement modes (spread / jumpy / grounded / watch), from prefs. */
  private behavior = { ...DEFAULT_BEHAVIOR };
  private watchNav: WatchNav = newWatchNav();
  /** The hangout she already said she can't reach (said once per hangout). */
  private watchComplained = "";
  /** Buddies the hangout is currently positioning (so they can be let go cleanly). */
  private readonly hangoutHeld = new Set<CharacterId>();
  /** Where the main companion stands on the hangout this frame, if she's there. */
  private hangoutSlot: { x: number; face: number | null; pose: HangoutPose } | null = null;
  private hangoutPicker: HangoutPicker | null = null;
  // The background world: its terrain is ground for the companions (see src/world).
  private world: { map: WorldMap; cam: Camera; zoom: number } | null = null;
  private worldSurfaces: TerrainSurfaces | null = null;
  /** Where the overlay sits on the display (below the menu bar / beside a left Dock). */
  private worldOff = { x: 0, y: 0 };
  private worldDisplay = { width: window.screen.width, height: window.screen.height };
  private worldUnlisten: (() => void)[] = [];
  private worldLoading = 0;
  private prefsCache: Prefs;
  private addons: AddonInfo | null = null;
  private affectionSaves = new Map<CharacterId, { value: number; updated: number; cookies: number }>();
  private affectionSaveTimer = 0;
  /** Character conversations. */
  private banterAt = 0;
  private banter: { from: CharacterId; to: CharacterId; lines: BanterLine[]; i: number; nextAt: number; phase: "approach" | "talk"; deadline: number } | null = null;
  private lastGoblinRemark = -Infinity;
  /** Autonomous boss fighting (main companion). */
  private fightFlying = false;
  private sinceStrike = 9;
  private threats: Threat[] = [];
  private voiceShortcut = "Control+Shift+Space";
  private microphone = "default";
  private readonly recorder = new VoiceRecorder();
  private readonly destroyerBuddy = new DestroyerBuddy(Math.random);
  /** Silksong Controls (Control mode with the "silksong" scheme). */
  private scheme: "terraria" | "silksong" = "terraria";
  private readonly silk = new SilkController();
  private silkVisual: SilkVisual | null = null;
  private voiceAskId: string | null = null;
  private voiceCardUntil = 0;
  private readonly voiceCard = new VoiceCard({
    cancel: () => this.voice({ type: "cancel" }),
    stop: () => this.voice({ type: "stop", now: performance.now() / 1000 }),
    send: (text) => this.voice({ type: "send", text }),
    close: () => this.voice({ type: "close" }),
    openChat: () => {
      const st = this.voiceState;
      if (st.kind === "answer") ignore(emitChatAppend(st.question, st.answer).then(() => showChat()));
      else ignore(showChat());
      this.voice({ type: "close" });
    },
    wantFocus: () => ignore(focusOverlay()),
    edit: () => this.voice({ type: "edit" }),
    launchWispr: () => {
      ignore(wisprLaunch());
      this.voice({ type: "close" });
    },
  });

  constructor(
    private readonly canvas: HTMLCanvasElement,
    fxCanvas: HTMLCanvasElement,
    prefs: Prefs,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.prefsCache = prefs;
    this.character = prefs.characters?.selected ?? "terrarian";
    this.scale = prefs.scale;
    this.paused = prefs.paused;
    this.cfg.walkSpeed = prefs.walkSpeed;
    this.bounds = { width: window.innerWidth, height: window.innerHeight };
    this.readModePrefs(prefs);
    this.readToolPrefs(prefs);
    this.bubble = document.createElement("div");
    this.bubble.className = "speech-bubble";
    this.bubble.setAttribute("role", "status");
    this.bubble.hidden = true;
    document.body.appendChild(this.bubble);

    const { w, h } = this.size();
    const fraction = prefs.lastX ?? 0.5;
    // Enter by dropping in from the top of the screen.
    this.body = {
      ...makeBody(fraction * (this.bounds.width - w), this.bounds, w, h),
      y: 0,
      grounded: false,
    };
    this.favorite = prefs.stayPosition;
    if (this.companionMode === "stay" && prefs.stayPosition) {
      // Return to the favourite spot (dropping onto whatever is below it). Fractions of the
      // current usable area, so a changed resolution or a removed display still lands on screen.
      const pos = homeToPosition(prefs.stayPosition, this.bounds, w, h);
      this.body = { ...this.body, x: pos.x, y: pos.y };
      this.home = pos;
      this.homeIsFavorite = true;
    }
    this.savedX = this.body.x;
    this.resizeCanvas();

    this.buildLayer = new BuildLayer({
      changed: (blocks, kind) => this.saveBlocks(blocks, kind),
      surfaces: () => this.mergeSurfaces(),
      status: (st) => this.onBuildStatus?.(st),
      sound: (k) => this.audio.sfxEvent(k === "deny" ? "pickaxeMiss" : "pickaxeHit"),
    });
    this.buildLayer.setGrid(this.rigScale(), this.bounds.width, this.bounds.height);
    this.readBuildPrefs(prefs);
    this.lineLayer = new LineLayer({
      changed: (lines) => this.saveLines(lines),
      surfaces: () => this.mergeSurfaces(),
      status: (st) => this.onLineStatus?.(st),
    });
    this.lineLayer.setBounds(this.bounds.width, this.bounds.height);
    this.readLinePrefs(prefs);

    this.mainAffectionHooks = {
      say: (text) => this.say(text),
      pose: (animation) => {
        if (this.notch?.gesture(this.character, animation)) return;
        if (this.drag || this.cursorMode !== "off" || this.control) return;
        // No hopping for affection reactions (jumps are for conversations and real movement).
        this.reactionPose = { animation: animation === "jump" ? "wave" : animation, until: this.clock + 1.8, t0: this.clock };
      },
      // CJ Ver: no heart effects.
      hearts: () => {},
      save: (affection) => this.saveAffection(this.character, affection),
      busy: () => this.menu.isOpen || this.voiceCard.visible || this.building || this.editingLines || this.control || !!this.drag || this.cookie.out || this.banter !== null || this.chess !== null,
      idleSeconds: () => userIdleSeconds(),
    };
    this.affection = new AffectionEngine(this.affectionFor(prefs, this.character), this.affectionConfig(prefs), this.mainAffectionHooks);
    this.cookie = new CookieView({
      scale: () => this.rigScale(),
      picked: () => {
        ignore(setCapture(true));
        this.cookieHoverSaid = false;
      },
      dismissed: () => this.dismissCookie(),
    });
    this.applyBubbleStyle(prefs);
    this.notch = new NotchHome({
      place: (id, a) => this.placeFromNotch(id, a),
      pet: (id) => {
        if (id === this.character) this.affection.pet(this.clock);
        else this.buddies.get(id)?.pat();
      },
      // A notch cookie: the same as one dragged onto her on the desktop (her line, hearts, hop).
      feed: (id) => {
        this.audio.sfxEvent("eat");
        if (id === this.character) this.affection.fed(this.clock);
        else this.buddies.get(id)?.affection.fed(this.clock);
      },
      present: () => [this.character, ...[...this.buddies.values()].filter((b) => !b.leaving).map((b) => b.id)],
      debug: import.meta.env.DEV ? (op, arg) => this.debugNotch(op, arg) : undefined,
    });
    this.reconcileRoster(prefs);
    listAddons()
      .then((a) => (this.addons = a))
      .catch(() => {});

    this.fx = new CombatRenderer(fxCanvas);
    this.fx.resize(this.bounds.width, this.bounds.height);
    this.inventory = fromSaved(prefs.inventory, prefs.selectedSlot);
    setTraining(this.combat, prefs.training, this.bounds, this.centerX(), this.scale);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("contextmenu", preventDefault);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("pointerdown", this.onWindowPointerDown);
    window.addEventListener("pointermove", this.onWindowPointerMove);
    window.addEventListener("pointerup", this.onWindowPointerUp);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    void this.listenWorld();
    window.addEventListener("blur", this.onBlur);
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.pausedTimer);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.bubble.remove();
    this.notch.destroy();
    clearTimeout(this.buildSaveTimer);
    this.buildLayer.destroy();
    clearTimeout(this.lineSaveTimer);
    this.lineLayer.destroy();
    clearInterval(this.interimTimer);
    this.cookie.destroy();
    for (const b of this.buddies.values()) b.destroy();
    this.buddies.clear();
    this.closeBuddyMenu();
    this.flushAffection();
    this.menu.destroy();
    this.recorder.cancel();
    this.voiceCard.destroy();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("contextmenu", preventDefault);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("pointerdown", this.onWindowPointerDown);
    window.removeEventListener("pointermove", this.onWindowPointerMove);
    window.removeEventListener("pointerup", this.onWindowPointerUp);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onBlur);
    ignore(setHitbox(null));
    ignore(setCapture(false));
    this.chess?.destroy();
    this.chess = null;
    this.hangoutPicker?.close();
    for (const u of this.worldUnlisten) u();
    this.worldUnlisten = [];
    this.stopToolEffects();
    this.audio.dispose();
  }

  applyPrefs(prefs: Prefs) {
    const resumed = this.paused && !prefs.paused;
    this.paused = prefs.paused;
    if (resumed) {
      // Don't count the paused time as elapsed.
      this.lastTime = 0;
      this.wake();
    }
    this.cfg.walkSpeed = prefs.walkSpeed;
    this.applyModePrefs(prefs);
    this.readToolPrefs(prefs);
    this.announceBoss();
    if (prefs.scale !== this.scale) {
      this.scale = prefs.scale;
      this.resizeBody();
      fitDummies(this.combat, this.bounds, this.scale);
    }
    this.inventory = fromSaved(prefs.inventory, prefs.selectedSlot);
    setTraining(this.combat, prefs.training, this.bounds, this.centerX(), this.scale);
    this.readBuildPrefs(prefs);
    this.readLinePrefs(prefs);
    this.readWorldPrefs(prefs);
    const nextBehavior = normalizeBehavior(prefs.characters?.behavior);
    if (JSON.stringify(nextBehavior.watch) !== JSON.stringify(this.behavior.watch)) this.watchNav = newWatchNav();
    this.behavior = nextBehavior;
    this.prefsCache = prefs;
    const selected = prefs.characters?.selected ?? "terrarian";
    if (selected !== this.character) this.switchCharacter(selected, prefs);
    this.affection?.configure(this.affectionConfig(prefs));
    this.affection?.adopt(this.affectionFor(prefs, this.character));
    this.applyBubbleStyle(prefs);
    this.reconcileRoster(prefs);
    this.fxDirty = true;
  }

  /** Saved affection for a character (the original companion uses the top-level value). */
  private affectionFor(prefs: Prefs, id: CharacterId) {
    if (id === "terrarian") return prefs.affection ?? { value: 30, updated: 0, cookies: 0 };
    return prefs.characters?.per.find((c) => c.id === id)?.affection ?? { value: 30, updated: 0, cookies: 0 };
  }

  /** Queue a character's affection to be saved (batched into one preferences write). */
  private saveAffection(id: CharacterId, state: { value: number; updated: number; cookies: number }) {
    this.affectionSaves.set(id, state);
    clearTimeout(this.affectionSaveTimer);
    this.affectionSaveTimer = window.setTimeout(() => this.flushAffection(), 800);
  }

  private flushAffection() {
    clearTimeout(this.affectionSaveTimer);
    if (!this.affectionSaves.size) return;
    const saves = new Map(this.affectionSaves);
    this.affectionSaves.clear();
    const patch: Parameters<typeof patchPrefs>[0] = {};
    const t = saves.get("terrarian");
    if (t) patch.affection = t;
    const chars = this.prefsCache.characters;
    if (chars && [...saves.keys()].some((k) => k !== "terrarian")) {
      patch.characters = { ...chars, per: chars.per.map((c) => (saves.has(c.id) && c.id !== "terrarian" ? { ...c, affection: saves.get(c.id)! } : c)) };
    }
    ignore(patchPrefs(patch));
  }

  private characterSettings(id: CharacterId) {
    return this.prefsCache.characters?.per.find((c) => c.id === id);
  }

  /**
   * The selected character changed: the outgoing one stays on screen as an autonomous buddy where
   * she stood, and the incoming one takes over the buddy's spot (nobody else is touched).
   */
  private switchCharacter(next: CharacterId, prefs: Prefs) {
    const prev = this.character;
    this.affection.flush(this.clock, true);
    this.flushAffection();
    const incoming = this.buddies.get(next);
    const prevBody = { ...this.body };
    if (incoming) {
      const b = incoming.body;
      this.body = { ...this.body, x: b.x + (b.w - this.body.w) / 2, y: b.y + b.h - this.body.h, vx: 0, vy: 0, grounded: false, platformId: null };
      incoming.destroy();
      this.buddies.delete(next);
    }
    this.character = next;
    this.affection = new AffectionEngine(this.affectionFor(prefs, next), this.affectionConfig(prefs, next), this.mainAffectionHooks);
    if ((prefs.characters?.active ?? []).includes(prev) && !this.buddies.has(prev)) this.addBuddy(prev, prefs, prevBody, false);
    // The resident is whoever has her id, so a switch keeps her in the notch, as main or buddy.
    // If she was dismissed in the same change there's no one left to live there.
    if (this.notch.occupant === prev && !this.buddies.has(prev)) this.notch.release(prev, false);
    this.fightFlying = false;
  }

  /** Make the buddies match the roster: walk new ones on, walk dismissed ones off. */
  private reconcileRoster(prefs: Prefs) {
    const want = new Set((prefs.characters?.active ?? []).filter((id) => id !== this.character));
    for (const [id, b] of this.buddies) {
      if (!want.has(id)) b.leaving = true;
      else {
        b.leaving = false;
        const cs = prefs.characters?.per.find((c) => c.id === id);
        b.configure(this.affectionConfig(prefs, id), cs?.weapon || CHARACTERS[id].signature);
        b.setLook(JSON.stringify(cs?.look ?? null));
      }
    }
    for (const id of want) if (!this.buddies.has(id)) this.addBuddy(id, prefs, null, true);
  }

  private addBuddy(id: CharacterId, prefs: Prefs, at: Body | null, walkOn: boolean) {
    const { w, h } = this.size();
    const fromLeft = this.centerX() > this.bounds.width / 2;
    const start: Body = at
      ? { ...at, w, h }
      : { ...makeBody(fromLeft ? -w - 10 : this.bounds.width + 10, this.bounds, w, h), y: this.bounds.height - h, grounded: true, facing: fromLeft ? 1 : -1 };
    const cs = prefs.characters?.per.find((c) => c.id === id);
    const b = new Buddy(id, start, this.affectionFor(prefs, id), this.affectionConfig(prefs, id), cs?.weapon || CHARACTERS[id].signature, {
      busy: () => this.menu.isOpen || this.voiceCard.visible || this.building || this.editingLines || !!this.drag || this.banter !== null || this.chess !== null,
      save: (st) => this.saveAffection(id, st),
      idleSeconds: () => userIdleSeconds(),
      select: (who) => {
        const c = this.prefsCache.characters;
        if (c) ignore(patchPrefs({ characters: { ...c, selected: who } }));
      },
      sound: (k) => {
        // Character voice only on pickup (and damage); weapon swings keep their sound effect.
        if (k === "pickup") this.audio.voiceEvent("pickup");
        else if (k === "swing") this.audio.sfxEvent("swing");
      },
      capture: (on) => {
        ignore(setCapture(on));
        this.reportedHitbox = "";
      },
      menu: (who, x, y) => this.openBuddyMenu(who, x, y),
      combat: () => this.combat,
      target: () => bossTarget(this.combat) ?? (this.combat.training ? this.nearestTrainingDummy() : null),
      notchSay: (who, text) => this.notch.say(who, text),
      notchGesture: (who, kind) => this.notch.gesture(who, kind),
      dragging: (who, pointer) => this.notch.hover(who.id, who.rect(), pointer),
      dropped: (who, pointer) => this.offerToNotch(who.id, who.rect(), who.canvas, pointer),
      rigChanged: (who) => this.notch.refresh(who, () => this.residentFor(who)),
    });
    if (walkOn) {
      // Walk in from the edge to a spot on screen, then roam.
      b.goal = 120 + Math.random() * (this.bounds.width - 240);
      setTimeout(() => (b.goal = null), 4500);
    }
    this.buddies.set(id, b);
    b.setLook(JSON.stringify(cs?.look ?? null));
    void b.loadRig();
    this.reportedHitbox = "";
  }

  private buddyMenu: { el: HTMLDivElement; until: number } | null = null;

  /** Right-click on a buddy: Select her, give her a cookie, or send her away. */
  private openBuddyMenu(id: CharacterId, x: number, y: number) {
    this.closeBuddyMenu();
    const el = document.createElement("div");
    el.className = "ctx-menu buddy-menu";
    el.setAttribute("role", "menu");
    const name = CHARACTERS[id].name;
    const chars = () => this.prefsCache.characters;
    const item = (label: string, act: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ctx-item";
      b.textContent = label;
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        act();
        this.closeBuddyMenu();
      });
      return b;
    };
    const title = document.createElement("div");
    title.className = "ctx-title";
    title.textContent = name;
    el.append(
      title,
      item(`Select ${name} (control her)`, () => {
        const c = chars();
        if (c) ignore(patchPrefs({ characters: { ...c, selected: id } }));
      }),
      item("Give her a cookie", () => this.summonCookie()),
      item("Swing her weapon", () => this.buddies.get(id)?.attack()),
      item("Send her away", () => {
        const c = chars();
        if (c) ignore(patchPrefs({ characters: { ...c, active: c.active.filter((a) => a !== id) } }));
      }),
    );
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.round(Math.min(x, this.bounds.width - r.width - 8))}px`;
    el.style.top = `${Math.round(Math.min(y, this.bounds.height - r.height - 8))}px`;
    this.buddyMenu = { el, until: performance.now() / 1000 + 8 };
    this.reportedHitbox = "";
  }

  private closeBuddyMenu() {
    this.buddyMenu?.el.remove();
    this.buddyMenu = null;
    this.reportedHitbox = "";
  }

  /** Step, fight and draw the buddies (and drop the ones that walked off). */
  private stepBuddies(dt: number) {
    if (!this.buddies.size) return;
    const world: BuddyWorld = { bounds: this.bounds, platforms: this.platforms, walls: this.walls, ceilings: this.ceilings, rigScale: this.rigScale() };
    const fightOn = (this.prefsCache.characters?.autoFight ?? true) && (anyBoss(this.combat) || this.combat.training);
    const target = bossTarget(this.combat);
    const practice = !target && this.combat.training ? this.nearestTrainingDummy() : null;
    // Whoever lives in the notch is hidden here (and leaves it if she's sent away).
    for (const b of [...this.buddies.values()]) {
      if (!this.notch.holds(b.id)) continue;
      if (b.leaving) {
        this.notch.release(b.id, false);
        b.destroy();
        this.buddies.delete(b.id);
        this.reportedHitbox = "";
      } else b.away(this.paused ? 0 : dt);
    }
    const list = [...this.buddies.values()].filter((b) => !this.notch.holds(b.id));
    const mainFighting = fightOn && !this.control && !this.inNotch;
    list.forEach((b, i) => {
      const others = [...(this.inNotch ? [] : [this.body]), ...list.filter((o) => o !== b).map((o) => o.body)];
      world.modes = this.buddyModes(b);
      const fight: BuddyFight = {
        active: fightOn,
        target,
        threats: this.threats,
        slot: i + (mainFighting ? 1 : 0),
        slots: list.length + (mainFighting ? 1 : 0),
        canFly: this.prefsCache.characters?.aiFlight ?? true,
        combat: this.combat,
        practice,
      };
      if (!this.paused) b.step(dt, world, others, fight);
      if (b.thrown) this.catchBuddy(b);
      b.draw(this.rigScale(), this.bounds);
      if (b.gone(this.bounds)) {
        b.destroy();
        this.buddies.delete(b.id);
        this.reportedHitbox = "";
      }
    });
  }

  // ── Movement modes ─────────────────────────────────────────────────────────────────────────

  /** The hangout platform, if Watch is on and it still exists (never during chess). */
  private watchTarget(): Platform | null {
    if (!this.behavior.watch || this.chess) return null;
    const i = watchIndex(this.lineLayer.lines, this.behavior.watch);
    if (i < 0) return null;
    const id = lineIdOf(i);
    return this.lineLayer.platforms.find((p) => p.id === id) ?? null;
  }

  /** Another companion stands on the same surface, not far away. */
  private crowded(body: Body): boolean {
    if (!body.grounded) return false;
    const cx = body.x + body.w / 2;
    return this.everyone().some((c) => c.body !== body && c.body.grounded && c.body.platformId === body.platformId && Math.abs(c.body.x + c.body.w / 2 - cx) < 260);
  }

  /** Jump tuning for the movement modes; undefined keeps the long-standing default behaviour. */
  private behaviorTuning(body: Body): JumpTuning | undefined {
    if (this.behavior.jump === "normal" && !this.behavior.spread) return undefined;
    const crowded = this.behavior.spread && this.crowded(body);
    if (this.behavior.jump === "normal" && !crowded) return undefined;
    return tuningFor(this.behavior, crowded);
  }

  /** Which surfaces to avoid (spread) and whether only downward jumps are allowed (grounded). */
  private jumpChoice(body: Body): JumpChoice {
    const avoid = new Set<number>();
    if (this.behavior.spread) for (const c of this.everyone()) if (c.body !== body && c.body.platformId !== null) avoid.add(c.body.platformId);
    return { avoid, downOnly: this.behavior.jump === "grounded" && !(this.behavior.spread && this.crowded(body)) };
  }

  private buddyModes(b: Buddy): BuddyModes | undefined {
    const hangout = this.watchTarget();
    const tuning = this.behaviorTuning(b.body);
    const plans = this.behavior.spread || this.behavior.jump === "jumpy";
    if (!hangout && !tuning && !plans) return undefined;
    return {
      tuning,
      plan: plans ? (body, recent) => planJump(body, this.platforms, this.bounds, Math.random, undefined, recent, this.jumpChoice(body)) : undefined,
      hangout,
      planToward: hangout ? (body) => planJumpToward(body, hangout, this.platforms, this.bounds) : undefined,
    };
  }

  /** Main companion in Watch mode: the intent to get to (or stay at) the hangout, or null. */
  private watchIntent(dt: number): Parameters<typeof step>[1] | null {
    const target = this.watchTarget();
    if (!target) return null;
    const cx = this.centerX();
    if (this.body.grounded && this.body.platformId === target.id) {
      const slot = this.hangoutSlot;
      if (!slot) return { move: 0, jump: false };
      const dx = slot.x - cx;
      if (Math.abs(dx) > 6) return { move: dx < 0 ? -1 : 1, jump: false };
      const face: Dir = slot.face !== null ? (slot.face < cx ? -1 : 1) : this.body.facing;
      return { move: 0, jump: false, face };
    }
    const r = watchStep(this.watchNav, this.body, target, () => planJumpToward(this.body, target, this.platforms, this.bounds, this.cfg), dt, this.rng);
    this.watchNav = r.nav;
    if (r.resting) {
      // Can't find a way up: say so once, then roam normally (she tries again later).
      const key = JSON.stringify(this.behavior.watch);
      if (this.watchComplained !== key) {
        this.watchComplained = key;
        this.say("I can't find a way up to that platform. I'll try again later. (Say \"stop hanging out\" to cancel it.)");
      }
      return null;
    }
    return r.jump ? { move: 0, jump: true, jumpVelocity: r.jump.vy, jumpVx: r.jump.vx } : { move: r.move, jump: false };
  }

  /**
   * The hangout: everyone who has made it onto the platform gets a spot, side by side or cuddling
   * in pairs, alternating. Buddies walk to their spot and pose; the main companion's spot is used
   * by her own simulation.
   */
  private stepHangout(now: number) {
    const target = this.watchTarget();
    const inBanter = (id: CharacterId) => !!this.banter && (this.banter.from === id || this.banter.to === id);
    const mainFree = !this.control && this.cursorMode === "off" && this.companionMode === "roam" && !this.drag && !this.chessPose;
    const here = target
      ? this.everyone().filter((c) => c.body.grounded && c.body.platformId === target.id && !inBanter(c.id) && (c.buddy ? !c.buddy.held && !c.buddy.leaving : mainFree))
      : [];
    for (const id of [...this.hangoutHeld]) {
      if (here.some((c) => c.id === id)) continue;
      this.hangoutHeld.delete(id);
      const b = this.buddies.get(id);
      if (b && !inBanter(id)) {
        b.goal = null;
        b.hold = false;
        b.faceToward = null;
      }
    }
    this.hangoutSlot = null;
    if (!target || !here.length) return;
    const pose = hangoutPose(now);
    // Keep left-to-right order so nobody walks through anybody.
    const sorted = [...here].sort((a, b) => a.body.x - b.body.x);
    const slots = hangoutSlots(sorted.length, target.left, target.right, this.body.w, pose);
    sorted.forEach((c, i) => {
      const slot = slots[i];
      if (!c.buddy) {
        this.hangoutSlot = { ...slot, pose };
        return;
      }
      const b = c.buddy;
      this.hangoutHeld.add(c.id);
      const cx = b.body.x + b.body.w / 2;
      if (Math.abs(slot.x - cx) > 6) {
        b.goal = slot.x;
        b.hold = false;
        b.faceToward = null;
      } else {
        b.goal = null;
        b.hold = true;
        b.faceToward = slot.face;
        if (!b.posing) b.gesture("sit", 2.2);
      }
    });
  }

  /** "Pick on screen": numbered badges over the invisible platforms. */
  private openHangoutPicker() {
    const lines = this.lineLayer.lines;
    if (!lines.length) {
      this.say("There aren't any invisible platforms yet. Draw one in platform edit mode first.");
      return;
    }
    this.hangoutPicker?.close();
    ignore(setCapture(true));
    this.hangoutPicker = new HangoutPicker(lines, this.bounds, watchIndex(lines, this.behavior.watch), {
      chosen: (i) => {
        const c = this.prefsCache.characters;
        if (!c) return;
        ignore(patchPrefs({ characters: { ...c, behavior: { ...normalizeBehavior(c.behavior), watch: lines[i] } } }));
        this.say(`Heading to platform ${i + 1}.`);
      },
      closed: () => {
        this.hangoutPicker = null;
        ignore(setCapture(false));
        this.reportedHitbox = "";
      },
    });
    if (this.paused) this.wake();
  }

  // ── Chess ──────────────────────────────────────────────────────────────────────────────────

  /** Open the local two-player chess board; the companions on screen become team supporters. */
  openChess() {
    if (this.inNotch) this.notch.release(this.character);
    if (this.chess) {
      if (!this.chess.isClosing) {
        this.say("The board is already out. Your move.");
        return;
      }
    }
    this.closeBuddyMenu();
    if (this.menu.isOpen) this.menu.close();
    const view = new ChessView(this.bounds, {
      actors: () => this.chessActors(),
      selected: () => this.character,
      opponentAvailable: (id) => id === this.character && !!this.prefsCache.visible && !this.paused,
      prefs: () => this.prefsCache.chess,
      save: (chess) => {
        this.prefsCache = { ...this.prefsCache, chess };
        ignore(patchPrefs({ chess }));
      },
      say: (id, text) => {
        const b = this.buddies.get(id);
        if (b && id !== this.character) b.say(text);
        else this.say(text);
      },
      closed: () => {
        if (this.chess === view) this.chess = null;
        this.chessPose = null;
        this.reportedHitbox = "";
      },
    });
    this.chess = view;
    this.reportedHitbox = "";
    if (this.paused) this.wake();
  }

  /** Close the board; everyone goes back to where they were and carries on. */
  closeChess() {
    if (!this.chess) return;
    this.chess.close();
    this.reportedHitbox = "";
  }

  get chessOpen() {
    return this.chess !== null && !this.chess.isClosing;
  }

  private applyChessPose(p: ActorPose) {
    this.body = { ...this.body, x: p.x - this.body.w / 2, y: p.y - this.body.h, vx: 0, vy: 0, facing: p.facing, grounded: false, platformId: null };
    this.frameOverride = p.frame;
    this.flipOverride = false;
  }

  /** The characters on screen as chess actors (the main companion first). */
  private chessActors(): ActorPort[] {
    const mainId = this.character;
    const main: ActorPort = {
      id: mainId,
      feet: () => ({ x: this.body.x + this.body.w / 2, y: this.body.y + this.body.h }),
      size: () => ({ w: this.body.w, h: this.body.h }),
      // Switching the selected character mid-game hands her back (her slot just goes quiet).
      usable: () => this.character === mainId && !!this.prefsCache.visible && !this.paused && !this.drag && !this.control && this.cursorMode === "off" && !this.combat.player.dead,
      pose: (p) => {
        this.chessPose = p;
        if (p) this.applyChessPose(p);
        else {
          this.frameOverride = null;
          this.body = { ...this.body, grounded: false, platformId: null };
        }
      },
    };
    const buddyPort = (b: Buddy): ActorPort => ({
      id: b.id,
      feet: () => ({ x: b.body.x + b.body.w / 2, y: b.body.y + b.body.h }),
      size: () => ({ w: b.body.w, h: b.body.h }),
      // (Not while she lives in the notch: she's hidden there and can't carry pieces.)
      usable: () => this.buddies.get(b.id) === b && !b.leaving && !b.held && !this.paused && !this.notch.holds(b.id),
      pose: (p) => b.setPuppet(p),
    });
    return [main, ...[...this.buddies.values()].filter((b) => !b.leaving && !this.notch.holds(b.id)).map(buddyPort)];
  }

  private nearestTrainingDummy() {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const d of this.combat.dummies) {
      if ((d.kind ?? "dummy") !== "dummy" || d.respawn > 0) continue;
      const c = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
      const dist = Math.abs(c.x - this.centerX());
      if (dist < bd) {
        bd = dist;
        best = c;
      }
    }
    return best;
  }

  /** Every character on screen: the main one first. */
  private everyone(): { id: CharacterId; body: Body; buddy: Buddy | null }[] {
    // (Not whoever lives in the notch: no conversations, hangouts or crowding with her.)
    const main = this.inNotch ? [] : [{ id: this.character, body: this.body, buddy: null }];
    return [...main, ...[...this.buddies.values()].filter((b) => !b.leaving && !this.notch.holds(b.id)).map((b) => ({ id: b.id, body: b.body, buddy: b }))];
  }

  /** If the main companion is in a conversation, the partner's x (to face); else null. */
  private banterPartnerOfMain(): number | null {
    const bt = this.banter;
    if (!bt || bt.to !== this.character) return null;
    const w = this.buddies.get(bt.from);
    return w ? w.body.x + w.body.w / 2 : null;
  }

  /** Conversations: one character walks over to another for a short work huddle. */
  private stepBanter(now: number) {
    // Nobody wanders off for a chat during a chess game (and one in progress is called off).
    if (this.chess) {
      if (this.banter) {
        for (const id of [this.banter.from, this.banter.to]) {
          const b = this.buddies.get(id);
          if (b) {
            b.goal = null;
            b.hold = false;
            b.faceToward = null;
          }
        }
        this.banter = null;
      }
      return;
    }
    const s = this.prefsCache.characters;
    const settings = { enabled: s?.interactions ?? true, frequency: s?.interactionFrequency ?? 1, quiet: !!this.prefsCache.awareness?.quiet || !(this.prefsCache.persona?.spontaneous ?? true) };
    if (!this.banter) {
      if (!this.banterAt) this.banterAt = now + nextBanterDelay(settings.frequency, Math.random) * 0.5;
      if (now < this.banterAt) return;
      this.banterAt = now + nextBanterDelay(settings.frequency, Math.random);
      const busy = this.menu.isOpen || this.voiceCard.visible || this.building || this.editingLines || !!this.drag || this.cookie.out;
      if (busy) return;
      const present = this.everyone().map((c) => c.id);
      const pick = chooseBanter(present, this.control ? this.character : null, settings, anyBoss(this.combat), Math.random);
      if (!pick) return;
      // The one who walks over must be a buddy (the main companion keeps its own AI).
      let { from, to } = pick;
      if (!this.buddies.has(from)) [from, to] = [to, from];
      if (!this.buddies.has(from)) return;
      const { lines } = makeBanter(from, to, Math.random);
      this.banter = { from, to, lines, i: 0, nextAt: now, phase: "approach", deadline: now + 12 };
      return;
    }
    const bt = this.banter;
    const walker = this.buddies.get(bt.from);
    const partner = bt.to === this.character ? { body: this.body, buddy: null as Buddy | null } : (() => {
      const b = this.buddies.get(bt.to);
      return b ? { body: b.body, buddy: b } : null;
    })();
    const stop = () => {
      for (const b of [walker, partner?.buddy]) {
        if (!b) continue;
        b.goal = null;
        b.hold = false;
        b.faceToward = null;
      }
      this.banter = null;
    };
    // Called off by control of a participant, a boss fight, or a missing participant.
    // Called off if a participant is picked up, controlled or missing, or a boss shows up.
    if (!walker || !partner || walker.held || partner.buddy?.held || (bt.to === this.character && (this.control || !!this.drag)) || anyBoss(this.combat)) return stop();
    const px = partner.body.x + partner.body.w / 2;
    const wx = walker.body.x + walker.body.w / 2;
    // The partner waits, facing the one coming over, from the start until the conversation ends.
    if (partner.buddy) {
      partner.buddy.hold = true;
      partner.buddy.faceToward = wx;
    }
    if (bt.phase === "talk") {
      walker.faceToward = px;
      walker.hold = true;
    }
    if (bt.phase === "approach") {
      const side = wx < px ? -1 : 1;
      walker.goal = px + side * (partner.body.w + 18);
      if (Math.abs(walker.goal - wx) < 16 || now > bt.deadline) {
        bt.phase = "talk";
        walker.goal = null;
        walker.hold = true;
        walker.faceToward = px;
        if (partner.buddy) {
          partner.buddy.hold = true;
          partner.buddy.faceToward = wx;
        }
        bt.nextAt = now;
      }
      return;
    }
    if (now < bt.nextAt) return;
    const line = bt.lines[bt.i];
    if (!line) {
      stop();
      return;
    }
    const speaker = line.speaker === this.character && !this.buddies.has(line.speaker) ? null : this.buddies.get(line.speaker);
    if (speaker) {
      speaker.say(line.text);
      if (line.gesture) speaker.gesture(line.gesture);
    } else {
      this.say(line.text);
      if (line.gesture && !this.control && !this.drag) {
        this.reactionPose = { animation: line.gesture, until: this.clock + 1.8, t0: this.clock };
        // A little hop to express herself, only during a conversation.
        if (line.gesture === "jump" && this.body.grounded) this.body = { ...this.body, vy: -380, grounded: false, platformId: null };
      }
    }
    bt.i++;
    bt.nextAt = now + 2.6 + line.text.length * 0.035;
  }

  private affectionConfig(prefs: Prefs, character: CharacterId = this.character): AffectionConfig {
    const p = prefs.persona;
    const cs = prefs.characters?.per.find((c) => c.id === character);
    return {
      character,
      intensity: p?.intensity ?? "normal",
      decay: p?.decay ?? 1.5,
      spontaneous: (p?.spontaneous ?? true) && (cs?.chatter ?? true),
      frequency: p?.frequency ?? 1,
      attention: p?.attention ?? true,
      // Quiet mode (Awareness) also silences her spontaneous remarks.
      quiet: !!prefs.awareness?.quiet,
      quietHours: p?.quietHours ?? false,
      quietStart: p?.quietStart ?? 22,
      quietEnd: p?.quietEnd ?? 8,
    };
  }

  /** Speech-bubble pinkness (0 pale … 1 very pink), as CSS variables on the bubble. */
  private applyBubbleStyle(prefs: Prefs) {
    styleBubble(this.bubble, this.character, prefs.persona?.bubblePink ?? 0.5);
    this.bubbleSize = null;
    this.bubblePlaced = "";
  }

  // ── The cookie ──────────────────────────────────────────────────────────────────────────

  private summonCookie() {
    if (this.cookie.out) return;
    const size = this.cookie.size();
    this.cookie.show(spawnCookie(this.body, this.bounds, size, this.cookie.nextKind()));
    this.reportedHitbox = "";
    if (this.paused) this.wake();
  }

  private dismissCookie() {
    this.cookie.hide();
    ignore(setCapture(false));
    this.reportedHitbox = "";
  }

  private stepCookieFrame(dt: number) {
    const c = this.cookie.state;
    if (!c) return;
    const wasHeld = c.held;
    // The cookie feeds whichever character it's nearest to.
    const cc = { x: c.body.x + c.body.w / 2, y: c.body.y + c.body.h / 2 };
    const near = this.everyone().reduce((a, b) => (Math.hypot(b.body.x + b.body.w / 2 - cc.x, b.body.y + b.body.h / 2 - cc.y) < Math.hypot(a.body.x + a.body.w / 2 - cc.x, a.body.y + a.body.h / 2 - cc.y) ? b : a));
    const r = stepCookie(c, dt, this.bounds, this.platforms, this.walls, near.body);
    this.cookieEater = near.buddy;
    this.cookie.state = r.state;
    if (wasHeld && !r.state.held) ignore(setCapture(false));
    // Hovering it over her: she notices (once per pick-up).
    if (r.state.held && r.state.hover > 0 && !this.cookieHoverSaid) {
      this.cookieHoverSaid = true;
      this.say("Ooh! Is that for me?");
    }
    if (r.event === "feed") {
      this.audio.sfxEvent("eat");
      if (this.cookieEater) this.cookieEater.affection.fed(this.clock);
      else this.affection.fed(this.clock);
    } else if (r.event === "eaten" || r.event === "expired") {
      this.dismissCookie();
    }
  }

  private readLinePrefs(prefs: Prefs) {
    this.linePrefs = prefs.lines ?? null;
    if (this.lineSaveTimer) return; // the lines on screen are newer than the saved ones
    this.lineLayer.load(sanitizeLines(prefs.lines?.items), prefs.lines?.show ?? false);
  }

  private saveLines(items: Line[]) {
    clearTimeout(this.lineSaveTimer);
    this.lineSaveTimer = window.setTimeout(() => {
      this.lineSaveTimer = 0;
      const base: Prefs["lines"] = this.linePrefs ?? { toggleEnabled: true, toggleShortcut: "Control+Shift+P", show: false, items };
      ignore(patchPrefs({ lines: { ...base, items }, ...this.hangoutAfterEdit(sanitizeLines(base.items), items) }));
    }, 350);
  }

  /** A moved hangout line stays the hangout; a deleted one stops being it. */
  private hangoutAfterEdit(before: Line[], after: Line[]): { characters?: CharacterPrefs } {
    const c = this.prefsCache.characters;
    const watch = this.behavior.watch;
    const i = watchIndex(before, watch);
    if (!c || !watch || i < 0 || watchIndex(after, watch) >= 0) return {};
    const next = after.length === before.length ? after[i] : null;
    return { characters: { ...c, behavior: { ...this.behavior, watch: next } } };
  }

  /** Platform-edit mode on/off (from Rust: shortcut, tray, settings). */
  setLinesEdit(enabled: boolean) {
    this.editingLines = enabled;
    this.lineLayer.setActive(enabled);
    if (this.drag) this.endDrag(false);
    this.mouseHeld = false;
    if (this.paused) this.wake();
  }

  private readBuildPrefs(prefs: Prefs) {
    this.buildPrefs = prefs.build ?? null;
    // While a save is pending, the blocks on screen are newer than the preferences.
    if (this.buildSaveTimer) return;
    const kind: BlockKind = isBlockKind(prefs.build?.kind) ? prefs.build.kind : "dirt";
    this.buildLayer.load(sanitizeBlocks(prefs.build?.blocks), kind);
  }

  /** Persist placed blocks shortly after the last change (one write per burst of painting). */
  private saveBlocks(blocks: Block[], kind: BlockKind) {
    clearTimeout(this.buildSaveTimer);
    this.buildSaveTimer = window.setTimeout(() => {
      this.buildSaveTimer = 0;
      const base: BuildPrefs = this.buildPrefs ?? { toggleEnabled: true, toggleShortcut: "Control+Shift+B", kind, blocks };
      ignore(patchPrefs({ build: { ...base, kind, blocks } }));
    }, 350);
  }

  /** Window surfaces plus the placed blocks' tops, sides and undersides. */
  private mergeSurfaces() {
    const s = this.buildLayer.surfaces;
    const lines = this.lineLayer?.platforms ?? [];
    const t = this.worldSurfaces;
    this.platforms = s.platforms.length || lines.length || t ? [...this.windowPlatforms, ...s.platforms, ...lines, ...(t?.platforms ?? [])] : this.windowPlatforms;
    this.walls = s.walls.length || t ? [...this.windowWalls, ...s.walls, ...(t?.walls ?? [])] : this.windowWalls;
    this.ceilings = t ? [...s.ceilings, ...t.ceilings] : s.ceilings;
    if (this.paused) this.wake();
  }

  // ── The background world as ground ─────────────────────────────────────────────────────

  private async listenWorld() {
    const add = (u: () => void) => (this.worldUnlisten.push(u), u);
    add(
      await onWorldView((v) => {
        if (!this.world) return;
        this.world = { ...this.world, cam: { x: v.x, y: v.y }, zoom: nearestZoom(v.zoom) };
        this.refreshTerrain();
      }),
    );
    add(await onWorldEdits(() => void this.reloadWorldEdits()));
    const g = await ambientGeometry().catch(() => null);
    if (g) this.setWorldGeometry(g);
  }

  private setWorldGeometry(g: { width: number; height: number; menuBar: number; dockEdge: string; dockSize: number }) {
    this.worldDisplay = { width: g.width, height: g.height };
    this.worldOff = { x: g.dockEdge === "left" ? g.dockSize : 0, y: g.menuBar };
    if (this.world) this.readWorldPrefs(this.prefsCache);
  }

  /** Follow the world settings: build the same world as the background window from its seed. */
  private readWorldPrefs(prefs: Prefs) {
    const w = prefs.world;
    if (!w || !w.enabled || !w.collide || !w.seed) {
      if (this.world || this.worldSurfaces) {
        this.world = null;
        this.worldSurfaces = null;
        this.mergeSurfaces();
      }
      return;
    }
    const zoom = nearestZoom(w.zoom);
    const { width, height } = this.worldDisplay;
    const dpr = window.devicePixelRatio || 1;
    const camFor = (map: WorldMap) => (w.cameraX < 0 || w.cameraY < 0 ? defaultCamera(map, width, height, zoom) : clampCamera(map, { x: w.cameraX, y: w.cameraY }, width, height, zoom, dpr));
    if (this.world && this.world.map.seed === w.seed) {
      this.world = { ...this.world, cam: camFor(this.world.map), zoom };
      this.refreshTerrain();
      return;
    }
    const token = ++this.worldLoading;
    void worldLoad()
      .catch(() => null)
      .then((saved) => {
        if (token !== this.worldLoading) return;
        const map = new WorldMap(w.seed, parseSaved(saved, w.seed));
        map.maxChunks = 96;
        this.world = { map, cam: camFor(map), zoom };
        this.refreshTerrain();
      });
  }

  private async reloadWorldEdits() {
    const cur = this.world;
    if (!cur) return;
    const saved = await worldLoad().catch(() => null);
    if (this.world !== cur && this.world?.map.seed !== cur.map.seed) return;
    const map = new WorldMap(cur.map.seed, parseSaved(saved, cur.map.seed));
    map.maxChunks = 96;
    this.world = { ...(this.world ?? cur), map };
    this.refreshTerrain();
  }

  /** Recompute the terrain surfaces for the current camera, and free anyone it now traps. */
  private refreshTerrain() {
    const w = this.world;
    if (!w) return;
    this.worldSurfaces = terrainSurfaces(w.map, w.cam, w.zoom, this.worldOff, this.bounds);
    this.mergeSurfaces();
    const lift = (b: Body): Body => {
      const y = liftOut(w.map, w.cam, w.zoom, this.worldOff, b);
      return y === null ? b : { ...b, y, vy: 0, grounded: false, platformId: null };
    };
    if (!this.drag && !this.chessPose) this.body = lift(this.body);
    for (const b of this.buddies.values()) if (!b.held && !b.puppeted) b.body = lift(b.body);
  }

  /** Build mode on/off (from Rust: shortcut, tray, settings). */
  setBuild(enabled: boolean) {
    this.building = enabled;
    this.buildLayer.setActive(enabled);
    if (this.drag) this.endDrag(false);
    this.mouseHeld = false;
    if (this.paused) this.wake();
  }

  /** Audio, pickaxe and flight settings. */
  private readToolPrefs(prefs: Prefs) {
    if (prefs.audio) this.audio.configure(prefs.audio);
    if (prefs.pickaxe) {
      this.pickaxeCooldown = prefs.pickaxe.cooldown;
      this.pickaxeStrikes = prefs.pickaxe.effects;
      if (!prefs.pickaxe.effects) this.impacts.stop();
    }
    if (prefs.control) {
      this.flightSpeed = prefs.control.flightSpeed;
      const scheme = prefs.control.scheme === "silksong" ? "silksong" : "terraria";
      if (scheme !== this.scheme) {
        this.scheme = scheme;
        this.silk.reset();
        this.silkVisual = null;
        this.setFlying(false);
        this.fxDirty = true;
      }
      this.silk.setKeys(prefs.control.silkKeys);
      this.terrariaKeys = normalizeTerrariaKeys(prefs.control.terrariaKeys);
    }
    if (prefs.voiceInput) {
      const v = prefs.voiceInput;
      this.voiceSettings = { enabled: v.enabled, mode: v.mode, review: v.review, autoSubmit: v.autoSubmit ?? true };
      this.voiceSilence = Math.min(6, Math.max(1, v.silence ?? 2));
      this.voiceShortcut = v.shortcut;
      this.microphone = v.microphone;
      // Turning voice input off stops any recording at once.
      if (!v.enabled && this.voiceState.kind === "listening") this.voice({ type: "cancel" });
    }
  }

  /** A ping from the Letter Destroyer bookmarklet in the browser. */
  onDestroyer(ev: DestroyerEvent) {
    const r = this.destroyerBuddy.react(ev, performance.now() / 1000);
    if (!r) return;
    if (!this.reactionSettings.quietText) this.say(r.text);
    if (r.pose && !this.drag && this.cursorMode === "off" && !this.control) {
      this.reactionPose = { animation: r.pose, until: this.clock + 2, t0: this.clock };
      if (r.pose === "jump" && this.body.grounded) this.body = { ...this.body, vy: -480, grounded: false, platformId: null };
    }
  }

  private study: Classroom | null = null;
  private studyAsk: string | null = null;

  /**
   * Study help: you box a question, she teaches it on a chalkboard beside it (answer first, then
   * the explanation in waves), with a ghost cursor that shows but never clicks.
   */
  openStudy() {
    if (this.study?.isOpen) return;
    if (this.inNotch) this.notch.release(this.character);
    this.study = new Classroom({
      origin: async () => {
        const w = getCurrentWindow();
        const [pos, scale] = await Promise.all([w.outerPosition(), w.scaleFactor()]);
        return { x: pos.x / scale, y: pos.y / scale };
      },
      look: (box) => studyLook(box).catch((e: { message?: string }) => Promise.reject(new Error(e?.message ?? String(e)))),
      ask: (text, task) => {
        const id = `study-${Date.now().toString(36)}`;
        this.studyAsk = id;
        return studyAsk(id, text, task).catch((e: { message?: string }) => Promise.reject(new Error(e?.message ?? String(e))));
      },
      cancel: () => {
        if (this.studyAsk) ignore(chatCancel(this.studyAsk));
        this.studyAsk = null;
      },
      gemini: (text) => studyGemini(text),
      capture: (on) => {
        ignore(setCapture(on));
        this.reportedHitbox = "";
      },
      wantFocus: () => ignore(focusOverlay()),
      say: (text) => this.say(text),
      react: (pose) => {
        if (pose === "think" || this.control || this.drag) return;
        this.reactionPose = { animation: pose === "jump" ? "wave" : pose, until: this.clock + 1.8, t0: this.clock };
        if (pose === "jump" && this.body.grounded) this.body = { ...this.body, vy: -340, grounded: false, platformId: null };
      },
      closed: () => {
        this.study = null;
        this.reportedHitbox = "";
      },
    });
    this.reportedHitbox = "";
    if (this.paused) this.wake();
  }

  /** Wispr Flow is about to dictate (its key, with no other app's text field focused). */
  onWisprDictate() {
    this.voice({ type: "dictate" });
  }

  /** Wispr Flow's key went down but it can't carry voice right now: say why. */
  onWisprProblem(s: WisprStatus) {
    this.voice({ type: "unavailable", message: s.message, launch: s.canLaunch });
  }

  /**
   * A Wispr Flow dictation went into another app. If it starts with her name ("Hey Rose, …"), it
   * was for her: take it back out of that app (⌘Z) and answer it.
   */
  onWisprDictation(d: { app: string; text: string }) {
    const id = this.character;
    const rest = stripWake(d.text, [CHARACTERS[id].name, customName(id, this.prefsCache.characters)]);
    if (rest === null) return;
    void wisprTakeBack(d.app)
      .catch(() => false)
      .then((undone) => {
        if (!undone) this.say("That also went into the other app (I couldn't take it back there).");
      });
    if (rest) this.voice({ type: "dictated", text: rest });
    else this.voice({ type: "dictate" });
  }

  /** Key down / up of the global voice shortcut (from Rust). */
  onVoiceKey(state: "pressed" | "released") {
    this.voice({ type: state === "pressed" ? "keyDown" : "keyUp", now: performance.now() / 1000 });
  }

  /** Advance the push-to-talk state machine and perform its side effect. */
  private voice(ev: VoiceEvent) {
    const t = voiceStep(this.voiceState, ev, this.voiceSettings);
    this.voiceState = t.state;
    this.runVoiceEffect(t.effect);
    this.canvas.classList.toggle("listening", t.state.kind === "listening");
    const now = performance.now() / 1000;
    this.voiceCardUntil = t.state.kind === "answer" ? now + 30 : t.state.kind === "error" ? now + 8 : Infinity;
    this.voiceCard.render(t.state, { shortcut: this.voiceShortcut, mode: this.voiceSettings.mode, autoSubmit: this.voiceSettings.autoSubmit, silence: this.voiceSilence });
    if (t.state.kind !== "listening") {
      clearInterval(this.interimTimer);
      this.interimTimer = 0;
    }
    this.positionVoiceCard();
    this.reportedHitbox = "";
    if (this.paused) this.wake();
  }

  private runVoiceEffect(effect: VoiceEffect) {
    switch (effect) {
      case "startRecording":
        this.silence = newSilence();
        this.silenceClock = 0;
        clearInterval(this.interimTimer);
        // Live transcript: re-transcribe the audio so far every couple of seconds while talking.
        this.interimTimer = window.setInterval(() => this.interimTranscribe(), 2200);
        this.recorder
          .start(
            this.microphone,
            (v, dt) => this.onVoiceLevel(v, dt),
            () => this.voice({ type: "stop", now: performance.now() / 1000 }),
          )
          .catch((e: unknown) => {
            this.recorder.cancel();
            this.voice({ type: "failed", message: micErrorMessage(e instanceof DOMException ? e.name : "") });
          });
        break;
      case "stopAndTranscribe": {
        const { samples, rate } = this.recorder.stop();
        const audio = toBase64(encodeWav(resample(samples, rate)));
        transcribe(audio)
          .then((r) => this.voice({ type: "transcribed", text: r.text }))
          .catch((e: { message?: string }) => this.voice({ type: "failed", message: e?.message ?? String(e) }));
        break;
      }
      case "discardRecording":
        this.recorder.cancel();
        break;
      case "ask": {
        const st = this.voiceState;
        if (st.kind !== "thinking") break;
        const id = `voice-${Date.now().toString(36)}`;
        this.voiceAskId = id;
        const question = st.question;
        const mood = sentiment(question);
        this.affection.remark(mood ?? "plain", true, false);
        // Companion requests are performed (and verified) by the app; questions go to the model,
        // with a fresh screenshot when they're about the screen.
        route(question, this.voiceRouter, appDeps())
          .then((r) => {
            this.voiceRouter = r.state;
            if (this.voiceAskId !== id) return;
            if (r.route.kind !== "ask") {
              this.voice({ type: "answered", answer: routeText(r.route) });
              return;
            }
            return chatAsk(id, [{ role: "user", content: question }], r.route.screen).then((a) => this.voiceAskId === id && this.voice({ type: "answered", answer: a.text }));
          })
          .catch((e: { message?: string }) => this.voiceAskId === id && this.voice({ type: "failed", message: e?.message ?? String(e) }));
        break;
      }
      case "cancelAsk":
        if (this.voiceAskId) ignore(chatCancel(this.voiceAskId));
        this.voiceAskId = null;
        break;
      case null:
        break;
    }
  }

  /** Each audio block: update the meter and the end-of-speech detector. */
  private onVoiceLevel(v: number, dt: number) {
    this.voiceCard.setLevel(v);
    if (this.voiceState.kind !== "listening") return;
    this.silenceClock += dt;
    const cfg = { ...DEFAULT_SILENCE, timeout: this.voiceSilence };
    const r = feedLevel(this.silence, v, this.silenceClock, dt, cfg);
    this.silence = r.state;
    const q = quietFor(r.state, this.silenceClock, cfg);
    this.voiceCard.setListening(r.state.speaking, this.voiceSettings.autoSubmit && q !== null ? cfg.timeout - q : null);
    if (!this.voiceSettings.autoSubmit) return;
    if (r.verdict === "done") this.voice({ type: "silence", now: performance.now() / 1000 });
    else if (r.verdict === "noSpeech") this.voice({ type: "noSpeech" });
  }

  /** Partial transcript of what's been said so far (shown while still listening). */
  private interimTranscribe() {
    if (this.voiceState.kind !== "listening" || this.interimBusy || this.silence.speech < 0.4) return;
    const snap = this.recorder.peek();
    if (!snap) return;
    this.interimBusy = true;
    transcribe(toBase64(encodeWav(resample(snap.samples, snap.rate))))
      .then((r) => this.voiceState.kind === "listening" && r.text.trim() && this.voice({ type: "interim", text: r.text }))
      .catch(() => {})
      .finally(() => (this.interimBusy = false));
  }

  private positionVoiceCard() {
    if (!this.voiceCard.visible) return;
    const r = this.voiceCard.rect() ?? { x: 0, y: 0, w: 240, h: 120 };
    const pos = menuPosition(this.body, { w: r.w, h: r.h }, this.bounds);
    this.voiceCard.place(pos.x, Math.max(6, this.body.y - r.h - 10 > 6 ? this.body.y - r.h - 10 : pos.y));
  }

  /** Grabbing the character or changing modes interrupts a pickaxe swing (no strike happens). */
  private cancelToolSwing() {
    const a = this.combat.attack;
    if (a && isPickaxe(equippedWeapon(this.inventory)) && a.weaponId === equippedWeapon(this.inventory)?.id) {
      cancelAttack(this.combat);
      this.impactFor = null;
      this.fxDirty = true;
    }
  }

  /** Clear every pickaxe effect right now (stop action, mode changes, shutdown). */
  private stopToolEffects() {
    this.impacts.stop();
    this.fxDirty = true;
  }

  /** Tell the dock whether the boss is on screen (re-sent on every prefs change for late joiners). */
  private announceBoss() {
    ignore(emitBossState(this.bossFight()));
  }

  private readModePrefs(prefs: Prefs) {
    this.companionMode = prefs.companionMode;
    const idle = prefs.idle ?? { mode: "rotate", interval: 45, paused: false };
    this.idleSettings = { mode: idle.mode, fixed: prefs.idlePose, interval: idle.interval, paused: idle.paused };
    this.favorite = prefs.stayPosition;
    if (prefs.awareness) {
      const a = prefs.awareness;
      this.reactionSettings = { enabled: a.appEnabled, quiet: a.quiet, quietText: a.quietText, excluded: a.excluded };
      if (!a.appEnabled) this.reactions.cancel();
    }
    this.reactionRules = prefs.reactions ?? [];
    this.screenEnabled = !!prefs.awareness?.screenEnabled;
    this.cursorMode = prefs.cursorMode;
    this.bossDifficulty = prefs.bossDifficulty;
    this.effectWord = prefs.effects.word || "TERRARIA";
    this.letters.setEnabled(prefs.effects.letterBreak);
  }

  /** React to mode changes: enter/leave Stay and the cursor modes. */
  private applyModePrefs(prefs: Prefs) {
    const wasStay = this.companionMode === "stay";
    const wasCursor = this.cursorMode;
    this.readModePrefs(prefs);
    if (this.companionMode === "stay" && !wasStay) {
      // Go back to the favourite spot if there is one; otherwise this spot becomes the favourite.
      if (this.favorite) this.returnToFavorite(false);
      else this.saveFavorite(false);
      this.ai = { ...this.ai, mode: "idle", timer: 1 };
      this.idleRot.switchTo(this.idleSettings.mode === "fixed" ? this.idleSettings.fixed : "stand", performance.now() / 1000);
    }
    if (this.companionMode !== "stay") {
      this.home = null;
      this.homeIsFavorite = false;
    }
    if (wasCursor !== this.cursorMode) {
      if (this.cursorMode === "off") {
        this.pointer = null;
        this.frameOverride = null;
        this.body = releaseFromCursor(this.body, this.bounds);
        this.stopToolEffects();
      } else {
        this.drag = null;
      }
      // Become Cursor draws the character small; other modes use the normal size.
      if (wasCursor === "become" || this.cursorMode === "become") this.resizeBody();
    }
    this.fxDirty = true;
    if (this.paused) this.wake();
  }

  private setHome(x: number, y: number, persist: boolean) {
    this.home = { x, y };
    this.homeIsFavorite = persist;
    if (persist) {
      this.favorite = positionToHome({ x, y }, this.bounds, this.body.w, this.body.h);
      ignore(patchPrefs({ stayPosition: this.favorite }));
    }
  }

  /** "Set Favorite Spot": remember this spot and stay here. */
  private saveFavorite(announce: boolean) {
    this.setHome(this.body.x, this.body.y, true);
    if (announce) this.say("Understood. I'll stay here.");
    if (this.companionMode !== "stay") ignore(patchPrefs({ companionMode: "stay" }));
  }

  /** "Return to Favorite Spot": hop back there (walking only covers small, same-level moves). */
  private returnToFavorite(announce: boolean) {
    if (!this.favorite) {
      if (announce) this.say("I don't have a favorite spot yet. Drag me somewhere and choose Set Favorite Spot!");
      return;
    }
    const pos = homeToPosition(this.favorite, this.bounds, this.body.w, this.body.h);
    this.home = pos;
    this.homeIsFavorite = true;
    if (!this.drag && this.cursorMode === "off" && !this.control) {
      const far = Math.abs(pos.x - this.body.x) > 48 || Math.abs(pos.y - this.body.y) > 24;
      if (far) this.body = { ...this.body, x: pos.x, y: Math.min(pos.y, this.body.y), vx: 0, vy: -180, grounded: false, platformId: null };
    }
    if (announce) this.say("Back to my favorite spot!");
    if (this.companionMode !== "stay") ignore(patchPrefs({ companionMode: "stay" }));
  }

  /** Show a speech bubble above the character. */
  /**
   * A game started or ended in the background world. She stays on the desktop the whole time,
   * living as usual (the world plays its own copy of her); the other companions on screen step
   * into the world while the waifus play on their own, and come back afterwards.
   */
  setInGame(mode: GameMode | null) {
    if (mode === this.inGame) return;
    this.inGame = mode;
    document.body.classList.toggle("in-game-all", mode === "auto");
    this.reportedHitbox = "";
    this.lastTime = 0;
    this.wake();
  }

  say(text: string, seconds = Math.min(9, 3.5 + text.length * 0.05)) {
    // Living in the notch: what she says waits for you there.
    if (this.notch?.say(this.character, text)) return;
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    this.bubbleSize = null; // new text: measure again
    this.bubbleUntil = performance.now() / 1000 + seconds;
    this.positionBubble();
    if (this.paused) this.wake();
  }

  /** The bubble's size only changes with its text, so it's measured once per line (no per-frame layout). */
  private bubbleSize: { w: number; h: number } | null = null;
  private bubblePlaced = "";

  private positionBubble() {
    if (this.bubble.hidden) return;
    if (!this.bubbleSize || !this.bubbleSize.w) this.bubbleSize = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
    const p = placeBubble(this.body, { w: this.bubbleSize.w || 200, h: this.bubbleSize.h || 40 }, this.bounds);
    const transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    const tail = `${Math.round(p.tailX)}px`;
    if (transform + tail === this.bubblePlaced) return;
    this.bubblePlaced = transform + tail;
    this.bubble.style.transform = transform;
    this.bubble.style.setProperty("--tail-x", tail);
  }

  /** An app switch from Rust (bundle id + name only). */
  onAppSwitch(ev: AppSwitch) {
    this.reactions.onSwitch(ev, performance.now() / 1000);
    // Goblin Girl comments on the app you switched to now and then (only its name is known).
    const now = performance.now() / 1000;
    const goblin = this.character === "goblin" ? null : this.buddies.get("goblin");
    const present = this.character === "goblin" || !!goblin;
    const quiet = !!this.prefsCache.awareness?.quiet || !(this.prefsCache.persona?.spontaneous ?? true) || !(this.characterSettings("goblin")?.chatter ?? true);
    if (present && !quiet && now - this.lastGoblinRemark > 180 && Math.random() < 0.35 && ev.name) {
      this.lastGoblinRemark = now;
      const line = goblinAppRemark(ev.name, Math.random);
      if (goblin) goblin.say(line);
      else this.say(line);
    }
    if (this.paused) this.wake();
  }

  /** Settings → Preview: play a rule once, ignoring cooldowns. */
  previewReaction(rule: ReactionRule) {
    this.react(this.reactions.preview(rule, this.reactionSettings));
  }

  private react(r: Reaction) {
    console.info(`reaction for ${r.bundleId}: text=${r.text !== null} voice=${r.voice ?? "none"} pose=${r.animation ?? "none"}`);
    if (r.text) this.say(r.text);
    // App reactions no longer play voice lines (character audio is only for pickup and damage).
    if (r.animation && !this.drag && this.cursorMode === "off" && !this.control) {
      this.reactionPose = { animation: r.animation, until: this.clock + REACTION_POSE_TIME, t0: this.clock };
      if (r.animation === "jump" && this.body.grounded) this.body = { ...this.body, vy: -520, grounded: false, platformId: null };
    }
  }

  /** Frame for an active reaction pose, or null. */
  private reactionFrame(): string | null {
    const p = this.reactionPose;
    if (!p) return null;
    if (this.clock >= p.until || this.drag || this.combat.attack) {
      this.reactionPose = null;
      return null;
    }
    const t = this.clock - p.t0;
    switch (p.animation) {
      case "wave":
        return idleFrame("wave", t).frame;
      case "hug":
        return "hug";
      case "sit":
        return "sit";
      case "nap":
        return "nap";
      default:
        return null; // "jump" is the hop itself
    }
  }

  /** Pointer position streamed by Rust while a cursor mode is on. */
  setPointer(pos: { x: number; y: number }) {
    this.pointer = pos;
    if (this.paused) this.wake();
  }

  /** Commands relayed by Rust from the tray menu or the inventory window. */
  handleCombatCommand(command: CombatCommand) {
    switch (command.action) {
      case "attack":
        this.attack(command.dir ?? undefined, true);
        break;
      case "reset":
        resetTraining(this.combat, this.bounds, this.centerX(), this.scale);
        break;
      case "dismiss":
        dismissMinions(this.combat);
        break;
      case "summonBoss":
        summonBoss(this.combat, this.bossDifficulty, this.bounds, this.rigScale(), this.centerX());
        this.lastBoss = "eye";
        break;
      case "summonMoonLord":
        summonMoonLord(this.combat, this.bossDifficulty, this.bounds, this.centerX(), this.addons?.moonGirl ? "girl" : "classic");
        this.lastBoss = "moon";
        break;
      case "summonQueenBee":
        summonQueenBee(this.combat, this.bossDifficulty, this.bounds, this.centerX());
        this.lastBoss = "queen";
        break;
      case "dismissBoss":
        dismissBoss(this.combat);
        dismissMoonLord(this.combat);
        dismissQueenBee(this.combat);
        break;
      case "retryBoss":
        // Retries whichever boss was summoned last.
        if (this.lastBoss === "moon") retryMoonLord(this.combat, this.bossDifficulty, this.bounds, this.centerX(), this.addons?.moonGirl ? "girl" : "classic");
        else if (this.lastBoss === "queen") retryQueenBee(this.combat, this.bossDifficulty, this.bounds, this.centerX());
        else retryBoss(this.combat, this.bossDifficulty, this.bounds, this.rigScale(), this.centerX());
        break;
      case "setFavoriteSpot":
        this.saveFavorite(true);
        break;
      case "returnToFavorite":
        this.returnToFavorite(true);
        break;
      case "toggleBoss":
        if (this.bossFight()) {
          dismissBoss(this.combat);
          dismissMoonLord(this.combat);
          dismissQueenBee(this.combat);
        } else summonBoss(this.combat, this.bossDifficulty, this.bounds, this.rigScale(), this.centerX());
        break;
      case "toggleCookie":
        if (this.cookie.out) this.dismissCookie();
        else this.summonCookie();
        break;
      case "spawnCookie":
        this.summonCookie();
        break;
      case "dismissCookie":
        this.dismissCookie();
        break;
      case "affectionChat":
        this.affection.remark("plain", false, false);
        break;
      case "affectionKind":
        this.affection.remark("kind", false, true);
        break;
      case "affectionRude":
        this.affection.remark("rude", false, true);
        break;
      case "letterSmash":
        this.smashLetters();
        break;
      case "stopEffects":
        this.letters.stop();
        this.stopToolEffects();
        break;
      case "openChess":
        this.openChess();
        break;
      case "closeChess":
        this.closeChess();
        break;
      case "flipChess":
        this.chess?.flip();
        break;
      case "studyHelp":
        this.openStudy();
        break;
      case "pickHangout":
        this.openHangoutPicker();
        break;
    }
    this.fxDirty = true;
    if (this.paused) this.wake();
  }

  /** Start the letter effect above the companion (rate-limited inside LetterBreaker). */
  private smashLetters() {
    const result = this.letters.trigger(
      this.clock,
      this.effectWord,
      { x: this.centerX(), y: Math.max(40, this.body.y - 50) },
      this.bounds,
    );
    if (result === "rate-limited" || result === "busy") this.fx.message("Letters need a moment to recover...", "#c8c8c8");
    if (result === "disabled") this.fx.message("Letter effects are turned off in settings.", "#c8c8c8");
  }

  /** Switch to (or away from, with null) the real Terraria character art. */
  setRig(rig: TerrariaRig | null) {
    this.rig = rig;
    this.resizeBody();
    this.notch.refresh(this.character, () => this.residentFor(this.character));
  }

  /** Enter/leave Control Character mode (driven by the Rust-side toggle). */
  setControl(enabled: boolean) {
    // Controlling her needs her on the desktop.
    if (enabled && this.inNotch) this.notch.release(this.character);
    this.control = enabled;
    this.keys = noKeys();
    this.jumpWasHeld = false;
    this.mouseHeld = false;
    this.setFlying(false);
    this.silk.reset();
    this.silkVisual = null;
    if (this.drag) this.endDrag(false);
    this.cancelToolSwing();
    this.stopToolEffects();
    if (!enabled) this.ai = { ...this.ai, mode: "idle", timer: 1 };
    if (this.paused) this.wake();
  }

  private rigScale() {
    return this.cursorMode === "become" ? 1 : rigScaleFor(this.scale);
  }

  /** Built-in sprite scale (Become Cursor shrinks it too). */
  private legacyScale() {
    return this.cursorMode === "become" ? 1 : this.scale;
  }

  /** Cell geometry for placing the character relative to the pointer. */
  private cell(): CellGeometry {
    if (!this.rig) return LEGACY_CELL;
    const { body, frameWidth, hands } = this.rig.info;
    const shoot = hands["shoot"];
    return { ...DEFAULT_CELL, cellW: frameWidth, originX: body.x, originY: body.y, hand: shoot ? { x: shoot[0], y: shoot[1] } : DEFAULT_CELL.hand };
  }

  /** Re-derive body size from the current art, keeping the feet and horizontal centre in place. */
  private resizeBody() {
    const { w, h } = this.size();
    const b = this.body;
    this.body = clampToBounds({ ...b, x: b.x + (b.w - w) / 2, y: b.y + b.h - h, w, h }, this.bounds);
    this.resizeCanvas();
    // Blocks are one Terraria tile at the character's art scale.
    this.buildLayer?.setGrid(this.rigScale(), this.bounds.width, this.bounds.height);
  }

  private centerX() {
    return this.body.x + this.body.w / 2;
  }

  private player(): PlayerInfo {
    const { x, y, w, h, facing } = this.body;
    return { x, y, w, h, facing, scale: this.legacyScale(), rig: this.rig?.geometry(this.rigScale()) };
  }

  /** Nearest standing target (by horizontal distance), optionally only in one direction. */
  private nearestDummy(dir?: Dir) {
    const cx = this.centerX();
    let best: ReturnType<typeof aliveDummies>[number] | null = null;
    for (const d of aliveDummies(this.combat)) {
      const dx = d.x + d.w / 2 - cx;
      if (dir !== undefined && Math.sign(dx) !== dir) continue;
      if (!best || Math.abs(dx) < Math.abs(best.x + best.w / 2 - cx)) best = d;
    }
    return best;
  }

  private distanceTo(d: { x: number; y: number; w: number; h: number }) {
    const c = center(d);
    return Math.hypot(c.x - this.centerX(), c.y - (this.body.y + this.body.h / 2));
  }

  /** True while the Eye of Cthulhu (or its Servants) are on screen. */
  private bossFight() {
    return anyBoss(this.combat);
  }

  /** The equipped item, with the pickaxe's swing time taken from settings. */
  private equipped(): WeaponDef | undefined {
    const def = equippedWeapon(this.inventory);
    return def && isPickaxe(def) ? { ...def, useTime: pickaxeUseTime(this.pickaxeCooldown, pickaxePower(def)) } : def;
  }

  /**
   * Use the equipped weapon, facing `dir` (default: current facing), aiming at a dummy if one is in
   * range. `manual`: the user asked for this swing (click, F, dock), not the AI.
   */
  private attack(dir?: Dir, manual = false) {
    const def = this.equipped();
    if (!def || this.drag || this.paused || this.combat.player.dead || this.cursorMode !== "off") return;
    if (dir !== undefined && !this.combat.attack) this.body = { ...this.body, facing: dir };
    const facing = this.body.facing;
    const target = this.nearestDummy(facing);
    const inRange = target && this.distanceTo(target) <= preferredRange(def, this.scale) * 1.6;
    const aim = inRange ? aimAt(def, this.player(), facing, rectOf(target)) : undefined;
    if (tryAttack(this.combat, def, this.player(), facing, aim, inRange ? center(rectOf(target)) : undefined).ok && isPickaxe(def)) {
      this.audio.sfxEvent("swing");
      if (manual) this.manualSwing = this.combat.attack;
    }
    this.fxDirty = true;
  }

  /** Control mode: use the equipped weapon toward the mouse cursor. */
  private attackTowardCursor() {
    const def = this.equipped();
    if (!def || this.paused || this.combat.attack) return;
    const center = { x: this.centerX(), y: this.body.y + this.body.h / 2 };
    const { dir } = aimToward(center, this.cursor);
    const hand = handPosition({ ...this.player(), facing: dir }, attackPose(def.kind, 1), dir);
    const { angle } = aimToward(hand, this.cursor);
    this.body = { ...this.body, facing: dir };
    if (tryAttack(this.combat, def, this.player(), dir, angle, { ...this.cursor }).ok) {
      if (isPickaxe(def)) this.audio.sfxEvent("swing");
      this.manualSwing = this.combat.attack;
      this.fxDirty = true;
    }
  }

  /**
   * Pickaxe: when the swing connects, burst at the pointer and send a Letter Destroyer strike there
   * (manual swings: anywhere; automatic swings: within reach), otherwise burst at the pickaxe head.
   * Pointer comes from the mouse in Control mode, else from Rust (global mouse location; nothing
   * under it is read). Strikes reach the page only through the Destroyer link, never as a click, so
   * nothing underneath is activated.
   */
  private checkPickaxeImpact(prevProgress: number) {
    const attack = this.combat.attack;
    if (!attack || this.impactFor === attack) return;
    const def = equippedWeapon(this.inventory);
    if (!isPickaxe(def) || def?.id !== attack.weaponId) return;
    const progress = attack.t / attack.duration;
    if (!crossedImpact(prevProgress, progress)) return;
    this.impactFor = attack;
    const player = this.player();
    const hand = handPosition(player, "point", attack.dir);
    // Where the drawn pick head actually is at the strike.
    const head = pickaxeHead(hand, progress, attack.dir, (def?.kind === "sword" ? def.reach : 18) * player.scale);
    const power = pickaxePower(def);
    const manual = this.manualSwing === attack;
    const land = (pointer: { x: number; y: number } | null) => {
      const target = impactTarget(hand, head, pointer, strikeReach(manual, power));
      this.audio.sfxEvent(target.eligible ? "pickaxeHit" : "pickaxeMiss");
      if (!this.pickaxeStrikes) return;
      this.impacts.add(target, power);
      this.fxDirty = true;
      if (!target.eligible) return;
      // The Letter Destroyer running in the browser smashes the real letters at this point.
      destroyerStrike(target.point.x, target.point.y, power)
        .then((connected) => {
          const now = performance.now() / 1000;
          if (!connected && now - this.lastStrikeHint > 45) {
            this.lastStrikeHint = now;
            this.say("Click the Letter Destroyer bookmark in your browser, then my pickaxe can smash letters there!");
          }
        })
        .catch(() => {});
    };
    if (this.control) land({ ...this.cursor });
    else getCursor().then((c) => land(c ? { x: c[0], y: c[1] } : null)).catch(() => land(null));
  }

  private setFlying(on: boolean) {
    if (this.flying === on) return;
    this.flying = on;
    this.canvas.classList.toggle("flying", on);
    document.body.dataset.flying = on ? "1" : "";
  }

  /** AI goal in training mode or a boss fight: walk to the nearest target and attack it. */
  private combatGoal(def: WeaponDef | undefined): CombatGoal | null {
    if (!def || (!this.combat.training && !this.bossFight()) || this.combat.player.dead) return null;
    const target = this.nearestDummy();
    if (!target) return null;
    const summonFull = def.kind === "summon" && this.combat.minions.length >= MINION_CAPACITY;
    return {
      targetX: target.x + target.w / 2,
      range: preferredRange(def, this.scale),
      ready: canAttack(this.combat, def).ok && !summonFull,
      distance: this.distanceTo(target),
    };
  }

  /** Channelled beams and Zenith swords keep tracking the target (or cursor) during the attack. */
  private trackAim() {
    const attack = this.combat.attack;
    if (!attack) return;
    if (this.control) {
      attack.aimPoint = { ...this.cursor };
      return;
    }
    const target = this.nearestDummy();
    if (target && attack.aimPoint) attack.aimPoint = center(rectOf(target));
  }

  /** React to what happened in the combat sim this step (knockback, deaths, announcements). */
  private consumeCombatEvents() {
    for (const e of this.combat.events) {
      switch (e.type) {
        case "playerHit":
          if (this.characterSettings(this.character)?.hitSound === "yamete") this.audio.addonHit();
          else if (this.characterSettings(this.character)?.hitSound !== "off") this.audio.voiceEvent("damage");
          if (this.cursorMode === "off" && !this.drag) {
            const away = Math.sign(this.centerX() - e.fromX) || 1;
            this.body = { ...this.body, vx: away * HIT_KNOCKBACK.x, vy: HIT_KNOCKBACK.y, grounded: false, platformId: null };
          }
          break;
        case "message":
          this.fx.message(e.text, e.color);
          break;
        case "playerSlain":
          this.audio.voiceEvent("death");
          break;
        case "bossDefeated":
          // (no voice line: character audio is only for pickup and damage)
          this.affection.victory();
          break;
        case "playerRespawned":
          this.body = { ...this.body, vx: 0, vy: 0 };
          break;
        case "bossSummoned":
        case "bossGone":
          this.announceBoss();
          break;
        default:
          break;
      }
    }
    if (this.combat.events.length) this.fxDirty = true;
    this.combat.events = [];
  }

  private applyShortcut(action: ShortcutAction) {
    switch (action.type) {
      case "select":
      case "cycle": {
        const next = action.type === "select" ? select(this.inventory, action.slot) : cycle(this.inventory, action.delta);
        this.inventory = next;
        ignore(patchPrefs({ selectedSlot: next.selected }));
        break;
      }
      case "attack":
        this.attack(action.dir, true);
        break;
      case "training":
        ignore(patchPrefs({ training: !this.combat.training }));
        break;
      case "reset":
        this.handleCombatCommand({ action: "reset", dir: null });
        break;
      case "dismiss":
        this.handleCombatCommand({ action: "dismiss", dir: null });
        break;
      case "boss":
        this.handleCombatCommand({ action: this.bossFight() ? "dismissBoss" : "summonBoss", dir: null });
        break;
      case "letters":
        ignore(combatCommand("letterSmash"));
        break;
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Typing in the voice card (or any text field) never drives the character.
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === "Escape" && this.cookie.held) {
      // Esc while holding the cookie puts it away.
      e.preventDefault();
      this.dismissCookie();
      return;
    }
    if (this.editingLines && !(e.metaKey || e.ctrlKey || e.altKey)) {
      // Platform-edit mode: Esc deselects, then leaves; Delete removes; arrows nudge.
      const r = this.lineLayer.key(e);
      if (r) {
        e.preventDefault();
        if (r === "exit") ignore(setLinesMode(false));
        return;
      }
    }
    if (this.building) {
      // Build mode: Esc leaves it (first, before Control mode); 1/2/3 pick the block.
      if (e.key === "Escape") {
        e.preventDefault();
        ignore(setBuildMode(false));
        return;
      }
      if (!(e.metaKey || e.ctrlKey || e.altKey) && this.buildLayer.key(e.code)) {
        e.preventDefault();
        return;
      }
    }
    if (this.control) {
      if (e.key === "Escape") {
        e.preventDefault();
        ignore(setControlMode(false));
        return;
      }
      if (this.silkMode && !(e.metaKey || e.ctrlKey || e.altKey) && this.silk.keyDown(e.code)) {
        e.preventDefault();
        return;
      }
      const role = e.metaKey || e.ctrlKey || e.altKey ? null : keyRole(e.code, this.terrariaKeys);
      if (role) {
        e.preventDefault();
        if (role === "down" && !this.keys.down) this.body = dropThrough(this.body);
        this.keys = { ...this.keys, [role]: true };
        return;
      }
    }
    const action = shortcutFor(e);
    if (!action) return;
    e.preventDefault();
    this.applyShortcut(action);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.silkMode && this.silk.keyUp(e.code)) return;
    const role = keyRole(e.code, this.terrariaKeys);
    if (this.control && role) this.keys = { ...this.keys, [role]: false };
  };

  private onWindowPointerDown = (e: PointerEvent) => {
    if (this.buddyMenu) this.closeBuddyMenu();
    // Platform-edit mode: clicks draw / select / move lines (right-click deletes).
    if (this.editingLines && !this.drag && this.lineLayer.pointerDown(e.clientX, e.clientY, e.button)) {
      if (this.menu.isOpen) this.menu.close();
      return;
    }
    // Build mode: clicks place (left) or remove (right / Shift+click) blocks instead of attacking.
    if (this.building && !this.drag && this.buildLayer.pointerDown(e.clientX, e.clientY, e.button, e.shiftKey, this.body)) {
      if (this.menu.isOpen) this.menu.close();
      return;
    }
    if (!this.control || e.button !== 0 || this.drag) return;
    this.cursor = { x: e.clientX, y: e.clientY };
    if (this.silkMode) this.silk.mouse(true);
    else this.mouseHeld = true;
  };

  private onWindowPointerMove = (e: PointerEvent) => {
    if (this.control) this.cursor = { x: e.clientX, y: e.clientY };
    if (this.building) this.buildLayer.pointerMove(e.clientX, e.clientY, this.body);
    if (this.editingLines) this.lineLayer.pointerMove(e.clientX, e.clientY, e.shiftKey);
  };

  private onWindowPointerUp = (e: PointerEvent) => {
    this.buildLayer.pointerUp();
    this.lineLayer.pointerUp();
    if (e.button !== 0) return;
    this.mouseHeld = false;
    this.silk.mouse(false);
  };

  /** Mouse wheel cycles the hotbar, as in Terraria. */
  private onWheel = (e: WheelEvent) => {
    if (!this.control || e.deltaY === 0) return;
    e.preventDefault();
    this.applyShortcut({ type: "cycle", delta: e.deltaY > 0 ? 1 : -1 });
  };

  /** Losing focus (e.g. ⌘-Tab) ends control mode so the desktop is clickable again. */
  private onBlur = () => {
    // Finish any chess animation at once so nothing is left half-moved.
    this.chess?.interrupt();
    // Switching apps ends Control mode, stops flight and drops anything held.
    this.keys = noKeys();
    if (this.cookie.held) {
      this.cookie.drop();
      ignore(setCapture(false));
    }
    this.setFlying(false);
    if (this.control) ignore(setControlMode(false));
    // Build mode captures every click, so it also ends when another app comes to the front.
    if (this.building) ignore(setBuildMode(false));
    if (this.editingLines) ignore(setLinesMode(false));
  };

  /** Apply a new window snapshot, carrying the character if its window moved. */
  setWindows(next: WindowRect[]) {
    if (!this.drag && this.cursorMode === "off") {
      const before = this.body;
      this.body = carry(this.body, this.windows, next, this.bounds);
      // A Stay home on a moving window moves with it.
      if (this.home && (before.x !== this.body.x || before.y !== this.body.y)) {
        this.home = { x: this.home.x + this.body.x - before.x, y: this.home.y + this.body.y - before.y };
      }
    }
    this.windows = next;
    this.windowPlatforms = visibleTops(next, this.bounds);
    this.windowWalls = junctionWalls(next, this.bounds);
    this.mergeSurfaces();
  }

  /** Skip any pending slow paused-frame wait and run the next frame now. */
  private wake() {
    clearTimeout(this.pausedTimer);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Body box size: Terraria's measured 20×42 hitbox, or the whole built-in sprite. */
  private size() {
    if (this.rig) {
      const s = this.rigScale();
      return { w: this.rig.info.body.w * s, h: this.rig.info.body.h * s };
    }
    return { w: SPRITE_W * this.legacyScale(), h: SPRITE_H * this.legacyScale() };
  }

  /** Canvas covers the full 40×56 Terraria cell (limbs reach outside the body box). */
  private canvasSize() {
    if (this.rig) {
      const s = this.rigScale();
      return { w: this.rig.info.frameWidth * s, h: this.rig.info.frameHeight * s };
    }
    return this.size();
  }

  private resizeCanvas() {
    const { w, h } = this.canvasSize();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.drawnKey = "";
  }

  private tick = (now: number) => {
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = now;

    if (!this.paused) {
      this.clock += dt;
      for (let left = dt; left > 1e-6; left -= this.cfg.maxStep) {
        const h = Math.min(left, this.cfg.maxStep);
        if (!this.drag && !this.inNotch) this.simulate(h);
        this.trackAim();
        const prevProgress = this.combat.attack ? this.combat.attack.t / this.combat.attack.duration : 0;
        // Projectiles, minions and effects keep running while the character is held.
        if (stepCombat(this.combat, h, this.player(), this.bounds)) this.fxDirty = true;
        this.checkPickaxeImpact(prevProgress);
        this.consumeCombatEvents();
        this.letters.step(h, this.body.y + this.body.h);
        this.impacts.step(h);
      }
      if (this.letters.effects.length || this.impacts.impacts.length || this.flying || this.napping || this.fx.busy()) {
        this.fxDirty = true;
      }
      if (this.thrownUntil && !this.drag && !this.inNotch) this.catchThrow();
    }
    // Reactions and the speech bubble run on wall-clock time (also while paused).
    const real = now / 1000;
    const reaction = this.reactions.tick(real, this.reactionRules, this.reactionSettings);
    if (reaction) this.react(reaction);
    if (!this.bubble.hidden) {
      if (real >= this.bubbleUntil) this.bubble.hidden = true;
      else this.positionBubble();
    }
    if (this.voiceCard.visible) {
      if (real >= this.voiceCardUntil) this.voice({ type: "close" });
      else this.positionVoiceCard();
    }
    if (this.menu.isOpen && real >= this.menuUntil) {
      this.menu.close();
      this.reportedHitbox = "";
    }
    this.buildLayer.draw(this.body);
    this.lineLayer.draw();
    this.affection.tick(real);
    this.threats = threatsOf(this.combat, this.bounds);
    if (this.buddyMenu && real > this.buddyMenu.until) this.closeBuddyMenu();
    this.stepBuddies(this.paused || this.inGame === "auto" ? 0 : dt);
    this.chess?.step(dt);
    this.stepBanter(real);
    this.stepHangout(real);
    if (this.cookie.out) {
      if (!this.paused) this.stepCookieFrame(dt);
      const eater = this.cookieEater?.body ?? this.body;
      this.cookie.draw({ x: eater.x + eater.w / 2 + eater.facing * eater.w * 0.15, y: eater.y + eater.h * 0.22 });
    }
    this.draw(this.paused ? 0 : dt);
    this.drawFx();
    this.reportHitbox(now);
    this.maybeSaveX(dt);
    if (this.paused && !this.drag && !this.chess) {
      // Idle while paused; pointer events and applyPrefs() still run immediately.
      this.pausedTimer = window.setTimeout(() => {
        this.raf = requestAnimationFrame(this.tick);
      }, PAUSED_FRAME_MS);
    } else {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private simulate(dt: number) {
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.frameOverride = null;
    this.flipOverride = false;
    this.napping = false;
    const mode = effectiveMode({ control: this.control, cursorMode: this.cursorMode, companionMode: this.companionMode });
    if (mode === "control") {
      this.simulateControlled(dt);
      return;
    }
    if (mode === "cursor") {
      this.simulateCursor(dt);
      return;
    }
    if (this.chessPose) {
      // Moving chess pieces: the chess director places her (no AI, no physics).
      this.applyChessPose(this.chessPose);
      return;
    }
    if (this.combat.player.dead) {
      // Slain: lie still until the respawn timer runs out.
      this.advance({ move: 0, jump: false }, dt);
      return;
    }
    // A boss is out and auto-fight is on: fight with the shared tactics (dodge, keep range, fly).
    if (anyBoss(this.combat) && (this.prefsCache.characters?.autoFight ?? true)) {
      this.simulateFight(dt);
      return;
    }
    if (this.fightFlying) {
      this.fightFlying = false;
      this.body = { ...this.body, grounded: false, platformId: null };
    }
    if (mode === "stay") {
      this.simulateStay(dt);
      return;
    }
    const decision = decide(
      this.ai,
      {
        grounded: this.body.grounded,
        landing: this.landTimer > 0,
        hitWall: this.hitWall,
        x: this.body.x,
        w: this.body.w,
        boundsWidth: this.bounds.width,
        planJump: () => planJump(this.body, this.platforms, this.bounds, this.rng, this.cfg, this.recentSurfaces, this.jumpChoice(this.body)),
        ledgeAhead: ledgeDistance(this.body, this.ai.dir, this.platforms, this.cfg),
        busy: this.combat.attack !== null,
        combat: this.combatGoal(equippedWeapon(this.inventory)),
        tuning: this.behaviorTuning(this.body),
      },
      dt,
      this.rng,
    );
    this.ai = decision.ai;
    if (decision.attack !== undefined) this.attack(decision.attack);
    // Talking with a buddy: stand still facing her until the conversation is over.
    const talkPartner = this.banterPartnerOfMain();
    if (talkPartner !== null) {
      const face: Dir = talkPartner < this.centerX() ? -1 : 1;
      this.advance({ move: 0, jump: false, face }, dt);
      this.body = { ...this.body, facing: face };
      return;
    }
    // Watch mode: make her way to the hangout, then sit or cuddle there.
    const toHangout = this.combat.attack === null ? this.watchIntent(dt) : null;
    if (toHangout) {
      this.advance(toHangout, dt);
      this.lineStandT = 0;
      if (this.hangoutSlot && toHangout.move === 0 && this.body.grounded) this.frameOverride = "sit";
      return;
    }
    // Don't stand exactly on top of another character (no fixed spacing otherwise).
    let intent = decision.intent;
    if (this.body.grounded && !intent.jump) {
      const step = unstack(this.body, intent.move !== 0, [...this.buddies.values()].filter((b) => !b.leaving && !b.held).map((b) => b.body), this.bounds.width);
      if (step) intent = { ...intent, move: step };
    }
    this.advance(intent, dt);
    // Trap guard: invisible lines are one-way, so a roaming character that has stayed on the same
    // line for a while drops through it rather than pacing up there forever.
    if (this.body.grounded && isLineId(this.body.platformId)) {
      this.lineStandT += dt;
      // "Stay grounded" drops down much sooner.
      if (this.lineStandT > (this.behavior.jump === "grounded" ? GROUNDED_LINE_ESCAPE : LINE_ESCAPE_TIME) && this.combat.attack === null) {
        this.body = dropThrough(this.body);
        this.lineStandT = 0;
      }
    } else if (this.body.grounded) {
      this.lineStandT = 0;
    }
    const reaction = this.body.grounded && Math.abs(this.body.vx) < 1 ? this.reactionFrame() : null;
    if (reaction) this.frameOverride = reaction;
  }

  /** Visual cursor modes: no physics; the character follows the pointer. */
  /** The weapon to fight with: the equipped one, unless it's a tool, then the best hotbar weapon. */
  private fightWeapon(): WeaponDef | undefined {
    const eq = this.equipped();
    const usable = (d: WeaponDef | undefined) => !!d && !isPickaxe(d) && !d.silk;
    if (usable(eq)) return eq;
    let best: WeaponDef | undefined;
    let score = 0;
    for (const id of this.inventory.slots.slice(0, 10)) {
      const d = id ? weaponById(id) : undefined;
      if (!usable(d)) continue;
      const sc = d!.damage / Math.max(0.05, d!.useTime);
      if (sc > score) {
        score = sc;
        best = d;
      }
    }
    return best;
  }

  /** Autonomous boss fight for the main companion (the buddies do the same in buddy.ts). */
  private simulateFight(dt: number) {
    this.sinceStrike += dt;
    const target = bossTarget(this.combat);
    const def = this.fightWeapon();
    if (!target || !def) {
      if (this.fightFlying) {
        this.fightFlying = false;
        this.body = { ...this.body, grounded: false, platformId: null };
      }
      this.advance({ move: 0, jump: false }, dt);
      return;
    }
    const cx = this.centerX();
    const cy = this.body.y + this.body.h / 2;
    const melee = def.kind === "sword" && !def.fractal;
    const out = tactic({
      x: cx,
      y: cy,
      r: this.body.w / 2,
      grounded: this.body.grounded,
      target,
      threats: this.threats,
      range: preferredRange(def, this.scale),
      melee,
      slot: 0,
      slots: 1 + [...this.buddies.values()].filter((b) => !b.leaving).length,
      canFly: this.prefsCache.characters?.aiFlight ?? true,
      bounds: this.bounds,
      sinceStrike: this.sinceStrike,
    });
    if (out.fly) {
      this.fightFlying = true;
      const p = flyToward(cx, cy, this.body.vx, this.body.vy, out.goal, dt);
      this.body = { ...this.body, x: p.x - this.body.w / 2, y: p.y - this.body.h / 2, vx: p.vx, vy: p.vy, grounded: false, platformId: null, facing: out.face };
      if (!this.combat.attack) this.frameOverride = "glide";
    } else {
      if (this.fightFlying) {
        this.fightFlying = false;
        this.body = { ...this.body, grounded: false, platformId: null };
      }
      const dx = out.goal.x - cx;
      this.advance({ move: Math.abs(dx) > 14 ? (Math.sign(dx) as -1 | 1) : 0, jump: out.jump, face: out.face }, dt);
      this.body = { ...this.body, facing: out.face };
    }
    if (out.attack && !this.combat.attack && !this.combat.player.dead) {
      const hand = handPosition(this.player(), attackPose(def.kind, 1), out.face);
      const aim = Math.atan2(target.y - hand.y, target.x - hand.x);
      if (tryAttack(this.combat, def, this.player(), out.face, aim, target).ok) this.sinceStrike = 0;
    }
  }

  private simulateCursor(dt: number) {
    if (this.cursorMode === "off" || !this.pointer) {
      this.frameOverride = this.cursorMode === "ride" ? "ride" : null;
      return;
    }
    const anchor = cursorAnchor(this.cursorMode, this.pointer, this.rig ? this.rigScale() : this.legacyScale(), this.bounds.width, this.cell());
    const pos = followStep(this.body, anchor, dt, FOLLOW_RATE[this.cursorMode]);
    this.body = { ...this.body, x: pos.x, y: pos.y, vx: 0, vy: 0, facing: anchor.facing, grounded: false, platformId: null };
    this.frameOverride = anchor.frame;
  }

  /** Stay-Put: no wandering or pursuit; keeps physics (gravity, platforms, being thrown). */
  private simulateStay(dt: number) {
    const def = equippedWeapon(this.inventory);
    const grounded = this.body.grounded;
    if (this.rehomeOnLand && grounded) {
      this.rehomeOnLand = false;
      this.setHome(this.body.x, this.body.y, false);
    }
    // Defend itself without moving: attack targets that come within reach during a boss fight.
    const goal = this.combatGoal(def);
    if (goal && goal.ready && !this.combat.attack && (goal.distance ?? Infinity) <= goal.range * 1.2) {
      this.attack(goal.targetX >= this.centerX() ? 1 : -1);
    }
    const move = grounded && !this.combat.attack && this.home && !this.rehomeOnLand ? stayMove(this.body.x, this.home.x) : 0;
    this.advance({ move, jump: false }, dt);
    const reaction = this.reactionFrame();
    if (reaction) {
      this.frameOverride = reaction;
    } else if (grounded && move === 0 && !this.combat.attack && this.landTimer <= 0 && Math.abs(this.body.vx) < 1) {
      // Idle poses only change the drawing, never the position or hitbox.
      const f = this.idleRot.update(performance.now() / 1000, this.idleSettings);
      this.frameOverride = f.frame;
      this.flipOverride = f.flip;
      this.napping = f.frame === "nap";
    }
  }

  private get silkMode() {
    return this.control && this.scheme === "silksong";
  }

  /** Silksong Controls: Hornet-style movement and the Needle (see silk/controller.ts). */
  private simulateSilk(dt: number) {
    const out = this.silk.step(
      dt,
      this.body,
      { bounds: this.bounds, platforms: this.platforms, walls: this.walls, ceilings: this.ceilings, cfg: this.cfg },
      this.combat,
      this.rigScale(),
      this.rigScale(),
      this.cursor,
      (b, dir) => handPosition({ ...this.player(), x: b.x, y: b.y, facing: dir }, "point", dir),
      { def: this.equipped(), use: (dir, aim, point) => this.useWeaponSilk(dir, aim, point) },
    );
    this.body = out.body;
    // A Terraria weapon in use shows its own swing/shoot frames (and keeps facing its target).
    const weaponInUse = this.combat.attack !== null && this.silk.needle.attack === null;
    this.frameOverride = weaponInUse ? null : out.frame.frame;
    this.flipOverride = weaponInUse ? false : out.frame.flip;
    if (weaponInUse) this.body = lockFacing(this.body, this.combat.attack?.dir ?? null);
    this.silkVisual = out.visual;
    this.fxDirty = true;
    for (const fx of out.sfx) this.audio.sfxEvent(fx);
    for (const st of out.strikes) {
      this.impacts.add({ point: { x: st.x, y: st.y }, eligible: true }, st.power);
      destroyerStrike(st.x, st.y, st.power).catch(() => {});
    }
  }

  /** Silksong Controls using a Terraria weapon: the sim's own use (timing, cooldown, effects). */
  private useWeaponSilk(dir: Dir, aim: number, point: { x: number; y: number } | null): boolean {
    const def = this.equipped();
    if (!def || this.paused || this.combat.player.dead || this.combat.attack) return false;
    this.body = { ...this.body, facing: dir };
    const ok = tryAttack(this.combat, def, this.player(), dir, aim, point ?? undefined).ok;
    if (ok && isPickaxe(def)) this.audio.sfxEvent("swing");
    if (ok) this.manualSwing = this.combat.attack;
    if (ok) this.fxDirty = true;
    return ok;
  }

  /** Keyboard/mouse-driven step through the same physics as the AI. */
  private simulateControlled(dt: number) {
    if (this.silkMode) {
      this.simulateSilk(dt);
      return;
    }
    // Hold Space in the air to fly; releasing hands back to gravity (and still cuts a jump short).
    const flight = applyFlight(this.body, this.keys, dt, this.flightSpeed, this.cfg.gravity);
    this.setFlying(flight.flying);
    this.body = flight.flying ? flight.body : applyJumpRelease(this.body, this.jumpWasHeld, this.keys.jump);
    this.jumpWasHeld = this.keys.jump;
    if (this.mouseHeld) this.attackTowardCursor();
    // Movement continues while attacking; facing stays locked to the attack until it ends.
    if (flight.flying) this.advance({ move: 0, jump: false }, dt);
    else this.advance(controlIntent(this.keys, this.body), dt);
    this.body = lockFacing(this.body, this.combat.attack?.dir ?? null);
  }

  private advance(intent: Parameters<typeof step>[1], dt: number) {
    const result = step(this.body, intent, dt, this.bounds, this.cfg, this.platforms, this.walls, this.ceilings);
    this.body = result.body;
    this.hitWall = result.hitWall;
    if (result.landed) {
      this.landTimer = landDuration(result.impactSpeed);
      this.recentSurfaces = rememberVisit(this.recentSurfaces, this.body.platformId);
      // (landing is silent: character audio is only for pickup and damage)
    }
    if (this.body.grounded) this.walkDistance += Math.abs(this.body.vx) * dt;
  }

  /** Redraw combat visuals only while something changes, plus one frame to clear. */
  private drawFx() {
    if (this.fxDirty || this.fxDrewLast) {
      this.fx.draw(this.combat, this.player(), this.letters.effects, bossHealth(this.combat), {
        impacts: this.impacts.impacts,
        flying: this.flying,
        napping: this.napping,
        silk: this.silkMode ? this.silkVisual : null,
      });
    }
    this.fxDrewLast = this.fxDirty;
    this.fxDirty = false;
  }

  private draw(dt: number) {
    // Living in the notch: CustomNotch draws her.
    const away = this.inNotch ? "hidden" : "";
    if (this.canvas.style.visibility !== away) {
      this.canvas.style.visibility = away;
      this.drawnKey = "";
    }
    if (away) return;
    const attack = this.combat.attack;
    const attackAnim = attack ? attackAnimFor(attack.kind) : null;
    const anim = selectAnim({
      grounded: this.body.grounded,
      vx: this.body.vx,
      vy: this.body.vy,
      landTimer: this.landTimer,
      dragging: this.drag?.moved ?? false,
      attack: attackAnim,
    });
    if (anim !== this.anim) {
      this.anim = anim;
      this.animTime = 0;
    } else {
      this.animTime += dt;
    }

    const flip = this.body.facing < 0 !== this.flipOverride;
    const p = this.combat.player;
    // Slain: gone until respawn. Recently hit: blink like Terraria's invincibility frames.
    const opacity = p.dead ? "0" : p.iframes > 0 && Math.floor(p.iframes * 16) % 2 === 0 ? "0.45" : "1";
    if (this.canvas.style.opacity !== opacity) this.canvas.style.opacity = opacity;
    if (this.rig) {
      const s = this.rigScale();
      const left = Math.round(this.body.x - this.rig.info.body.x * s);
      const top = Math.round(this.body.y - this.rig.info.body.y * s);
      this.canvas.style.transform = `translate(${left}px, ${top}px)`;
      const frame =
        this.frameOverride ??
        selectRigFrame({
          anim,
          attackProgress: attack ? attack.t / attack.duration : 0,
          walkDistance: this.walkDistance,
          rigScale: s,
        });
      const drawKey = `rig:${this.rig.key}:${frame}:${flip}:${this.canvas.width}`;
      if (drawKey === this.drawnKey) return;
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.rig.draw(this.ctx, frame, flip, this.canvas.width, this.canvas.height);
      this.drawnKey = drawKey;
      return;
    }

    const legacyAnim = this.frameOverride ? legacyAnimFor(this.frameOverride) : anim;
    const frames = FRAMES[legacyAnim];
    const index =
      attack && legacyAnim === attackAnim
        ? attackFrameIndex(attackAnim, attack.t / attack.duration)
        : frameIndex(legacyAnim, this.animTime, frames.length);
    const frameKey = `${legacyAnim}:${index}:${flip}`;
    const drawKey = `${frameKey}:${this.canvas.width}`;

    this.canvas.style.transform = `translate(${Math.round(this.body.x)}px, ${Math.round(this.body.y)}px)`;
    if (drawKey === this.drawnKey) return;

    let sprite = this.frameCache.get(frameKey);
    if (!sprite) {
      sprite = renderFrame(frames[index], flip);
      this.frameCache.set(frameKey, sprite);
    }
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(sprite, 0, 0, this.canvas.width, this.canvas.height);
    this.drawnKey = drawKey;
  }

  private reportHitbox(now: number) {
    const menuRect = this.menu.rect();
    const cardRect = this.voiceCard.rect();
    if (now - this.hitboxSentAt < HITBOX_INTERVAL_MS && !this.drag && this.reportedHitbox !== "") return;
    // (Nothing to click on the desktop while she lives in the notch.)
    const body = this.inNotch
      ? { x: -10000, y: -10000, w: 0, h: 0 }
      : {
          x: Math.round(this.body.x),
          y: Math.round(this.body.y),
          w: this.body.w,
          h: this.body.h,
        };
    // While the menu is open it's part of the clickable region; everywhere else stays click-through.
    let rect = menuRect ? unionRect(body, menuRect) : body;
    if (cardRect) rect = unionRect(rect, cardRect);
    // The cookie is clickable on its own (not merged, so the desktop between stays clickable).
    const cookie = this.cookie.rect();
    const extra = cookie ? [{ x: cookie.x - 4, y: cookie.y - 4, w: cookie.w + 8, h: cookie.h + 8 }] : [];
    // The chess board and its controls take clicks while it's open.
    if (this.chess && !this.chess.isClosing) extra.unshift(this.chess.rect());
    // The study classroom (or the whole screen while you draw the box).
    if (this.study?.isOpen) extra.unshift(...this.study.rects());
    // Buddies are clickable too (pat / double-click to select), each on its own.
    if (this.buddyMenu) {
      const r = this.buddyMenu.el.getBoundingClientRect();
      extra.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
    // (Not while they're off playing in the world: they're hidden then.)
    if (this.inGame !== "auto") for (const b of this.buddies.values()) if (!b.leaving && !this.notch.holds(b.id) && extra.length < 8) extra.push(b.rect());
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}|${extra.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join()}`;
    if (key === this.reportedHitbox) return;
    this.reportedHitbox = key;
    this.hitboxSentAt = now;
    ignore(setHitbox(rect, extra));
  }

  private maybeSaveX(dt: number) {
    this.saveClock += dt;
    if (this.saveClock < SAVE_INTERVAL) return;
    this.saveClock = 0;
    if (Math.abs(this.body.x - this.savedX) > 20) this.saveX();
  }

  private saveX() {
    this.savedX = this.body.x;
    const span = Math.max(1, this.bounds.width - this.body.w);
    ignore(patchPrefs({ lastX: this.body.x / span }));
  }

  private onPointerDown = (e: PointerEvent) => {
    // Cursor modes: the character isn't draggable. Control mode: only a press on the character
    // itself picks it up; anywhere else is an attack (handled by the window listener).
    if (e.button !== 0) return;
    if (this.menu.isOpen) {
      this.menu.close();
      this.reportedHitbox = "";
    }
    // In normal mode the canvas only receives presses near the character (click-through elsewhere).
    const onBody = !(this.control || this.building || this.editingLines) || hitsBody(this.body, e.clientX, e.clientY);
    if (pressAction({ control: this.control, cursorMode: this.cursorMode, onBody }) !== "pickup") return;
    e.stopPropagation();
    this.mouseHeld = false;
    this.setFlying(false);
    this.cancelToolSwing();
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - this.body.x,
      offsetY: e.clientY - this.body.y,
      moved: false,
      samples: [],
    };
    ignore(setCapture(true));
    if (this.paused) this.wake();
  };

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) {
      return;
    }
    if (!drag.moved) {
      // Picked up.
      this.canvas.classList.add("held");
      this.audio.voiceEvent("pickup");
      this.audio.sfxEvent("grab");
    }
    drag.moved = true;
    this.body = dragTo(this.body, e.clientX - drag.offsetX, e.clientY - drag.offsetY, this.bounds);
    drag.samples.push({ x: this.body.x, y: this.body.y, t: performance.now() });
    if (drag.samples.length > 12) drag.samples.shift();
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.notch.hover(this.character, this.body, this.lastPointer);
  };

  private onPointerUp = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.endDrag(true);
  };

  /** Finish a press: throw/release after a drag, or treat it as a click. `act` = false cancels. */
  private endDrag(act: boolean) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.canvas.classList.remove("held");
    ignore(setCapture(false));
    if (drag.moved) {
      // Let go over the notch: in she goes (or she's bounced off if someone else lives there).
      if (act && this.offerToNotch(this.character, this.body, this.canvas, this.lastPointer) !== "no") {
        this.ai = { ...this.ai, mode: "idle", timer: 1.5 };
        return;
      }
      this.notch.hover(this.character, null);
      const v = act ? throwVelocity(drag.samples, performance.now()) : { vx: 0, vy: 0 };
      this.body = release(this.body, v.vx, v.vy, this.cfg);
      if (act && Math.hypot(v.vx, v.vy) > 150) this.thrownUntil = this.clock + 2.5;
      this.ai = { ...this.ai, mode: "idle", timer: 1.5 };
      this.saveX();
      if (act) {
        this.audio.sfxEvent("throw");
        if (Math.hypot(v.vx, v.vy) > 400) this.audio.sfxEvent("throw");
      }
      // Stay-Put: wherever it lands becomes the new spot.
      // Stay-Put: stay where it's dropped (the saved favourite only changes via Set Favorite Spot).
      if (this.companionMode === "stay") this.rehomeOnLand = true;
    } else if (act) {
      // A click (no drag) uses the equipped weapon.
      // A click is also a little pat (or the answer to "can I have a kiss?").
      if (this.affection.pet(this.clock)) return;
      this.attack(undefined, true);
    }
  }

  /** Right-click on the character opens the menu (a right-click never starts a drag). */
  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (this.drag) return;
    this.menu.open(
      {
        stay: this.companionMode === "stay",
        rotating: this.idleSettings.mode === "rotate",
        pose: this.idleSettings.fixed,
        screenEnabled: this.screenEnabled,
        voiceAvailable: this.voiceSettings.enabled,
      },
      (size) => menuPosition(this.body, size, this.bounds),
    );
    this.menuUntil = performance.now() / 1000 + MENU_IDLE_CLOSE;
    this.menu.el.onpointermove = () => (this.menuUntil = performance.now() / 1000 + MENU_IDLE_CLOSE);
    this.reportedHitbox = ""; // include the menu in the clickable region right away
    if (this.paused) this.wake();
  };

  private onMenuAction(a: MenuAction) {
    this.reportedHitbox = "";
    switch (a.type) {
      case "askQuestion":
        ignore(showChat().then(() => emitChatCommand("focus")));
        break;
      case "openChat":
        ignore(showChat());
        break;
      case "askScreen":
        ignore(showChat().then(() => emitChatCommand("screen")));
        break;
      case "study":
        this.openStudy();
        break;
      case "toggleStay":
        ignore(patchPrefs({ companionMode: this.companionMode === "stay" ? "roam" : "stay" }));
        break;
      case "pose": {
        const idle = { mode: this.idleSettings.mode, interval: this.idleSettings.interval, paused: this.idleSettings.paused };
        if (a.pose === "rotate") ignore(patchPrefs({ idle: { ...idle, mode: "rotate" } }));
        else ignore(patchPrefs({ idlePose: a.pose, idle: { ...idle, mode: "fixed" } }));
        break;
      }
      case "settings":
        ignore(showInventory());
        break;
      case "voice":
        this.voice({ type: "start", now: performance.now() / 1000 });
        break;
      case "close":
        break;
    }
  }

  private onDoubleClick = () => {
    if (!this.control) ignore(toggleInventory());
  };

  private get inNotch(): boolean {
    return this.notch?.holds(this.character) ?? false;
  }

  /** What CustomNotch needs to draw her: her atlas as drawn now, name, colours and manner. */
  private residentFor(id: CharacterId): NotchResident | null {
    const rig = id === this.character ? this.rig : this.buddies.get(id)?.atlas ?? null;
    if (id !== this.character && !rig) return null;
    const art = rig ? atlasFromRig(rig) : atlasFromLegacy();
    if (!art) return null;
    const def = CHARACTERS[id];
    return {
      ...art,
      character: id,
      name: displayName(id, this.prefsCache.characters),
      bubble: { ...def.bubble },
      gestures: [...def.gestures],
      stride: def.stride,
      scale: rig ? this.rigScale() : this.legacyScale(),
      arrive: true,
    };
  }

  /**
   * She was let go (or is flying) over the notch. Absorbed: she's hidden here and CustomNotch
   * takes over. Full: she's bounced off and says who's in there.
   */
  private offerToNotch(id: CharacterId, body: { x: number; y: number; w: number; h: number }, el: HTMLCanvasElement, pointer: { x: number; y: number } | null): "in" | "full" | "no" {
    const r = this.notch.offer(id, body, el, () => this.residentFor(id), pointer);
    if (r === "in") {
      this.audio.voiceEvent("pickup");
      this.reportedHitbox = "";
      if (id === this.character) this.thrownUntil = 0;
    } else if (r === "full") {
      const v = this.notch.bounce();
      const who = this.notch.occupant;
      const name = who ? displayName(who, this.prefsCache.characters) : "Someone";
      if (id === this.character) {
        this.body = release({ ...this.body, grounded: false, platformId: null }, v.vx, v.vy, this.cfg);
        this.thrownUntil = 0;
        this.say(`${name} is already in there.`);
      } else {
        const b = this.buddies.get(id);
        b?.bounceOff(v.vx, v.vy);
        b?.say(`${name} is already in there... no fair!`);
      }
      this.audio.sfxEvent("throw");
    }
    return r;
  }

  /** Thrown: if she flies into the notch on the way, it catches her. */
  private catchThrow() {
    if (this.body.grounded || this.clock > this.thrownUntil) {
      this.thrownUntil = 0;
      return;
    }
    if (this.offerToNotch(this.character, this.body, this.canvas, null) !== "no") this.thrownUntil = 0;
  }

  private catchBuddy(b: Buddy) {
    if (this.offerToNotch(b.id, b.rect(), b.canvas, null) !== "no") b.thrown = false;
  }

  /**
   * Dev builds: "drop <id>" carries her onto the notch (hovering on the way) and lets go there;
   * "throw <id>" flings her at it from a little way off; "say <text>" makes the resident talk.
   */
  private debugNotch(op: string, arg: string) {
    const g = this.notch.geometry;
    if (op === "say") {
      const who = this.notch.occupant;
      if (who === this.character) this.say(arg);
      else if (who) this.buddies.get(who)?.say(arg);
      return;
    }
    const id = (arg || this.character) as CharacterId;
    const buddy = id === this.character ? null : this.buddies.get(id);
    if (!g || (id !== this.character && !buddy)) return;
    const rect = g.rect;
    const target = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const d = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[g.edge ?? "right"];
    const start = { x: target.x + d[0] * 320, y: target.y + d[1] * 220 - (d[1] === 0 ? 80 : 0) };
    const body = () => (buddy ? buddy.body : this.body);
    const setBody = (x: number, y: number) => {
      const b = body();
      const moved = clampToBounds({ ...b, x: x - b.w / 2, y: y - b.h / 2, vx: 0, vy: 0, grounded: false, platformId: null }, this.bounds);
      if (buddy) buddy.body = moved;
      else this.body = moved;
    };
    if (op === "throw") {
      setBody(start.x, start.y);
      const b = body();
      const t = 0.5;
      const vx = (target.x - (b.x + b.w / 2)) / t;
      const vy = (target.y - (b.y + b.h / 2)) / t - 0.5 * this.cfg.gravity * t;
      if (buddy) {
        buddy.body = release(b, vx, vy);
        buddy.thrown = true;
      } else {
        this.body = release(b, vx, vy, this.cfg);
        this.thrownUntil = this.clock + 2.5;
      }
      return;
    }
    // "drop": glide over like a held drag, hovering, then let go over the notch.
    let i = 0;
    const steps = 24;
    const timer = window.setInterval(() => {
      i++;
      const k = i / steps;
      const p = { x: start.x + (target.x - start.x) * k, y: start.y + (target.y - start.y) * k };
      setBody(p.x, p.y);
      this.notch.hover(id, body(), p);
      if (i < steps) return;
      window.clearInterval(timer);
      const r = this.offerToNotch(id, body(), buddy ? buddy.canvas : this.canvas, p);
      if (r === "no") this.notch.hover(id, null);
    }, 30);
  }

  /** Out of the notch and back on the desktop, centred on (x, y) and moving at (vx, vy). */
  private placeFromNotch(id: CharacterId, a: NotchAction) {
    if (id !== this.character) {
      this.buddies.get(id)?.placeAt(a.x, a.y, a.vx, a.vy, this.bounds);
      this.reportedHitbox = "";
      return;
    }
    const { w, h } = this.size();
    this.body = clampToBounds({ ...this.body, w, h, x: a.x - w / 2, y: a.y - h / 2, grounded: false, platformId: null }, this.bounds);
    this.body = release(this.body, a.vx, a.vy, this.cfg);
    this.ai = { ...this.ai, mode: "idle", timer: 1.5 };
    this.thrownUntil = 0;
    this.drawnKey = "";
    this.reportedHitbox = "";
    this.audio.voiceEvent("pickup");
    if (this.companionMode === "stay") this.rehomeOnLand = true;
    this.wake();
  }

  private onResize = () => {
    this.bounds = { width: window.innerWidth, height: window.innerHeight };
    // A grounded body re-checks the floor next step, so a taller window makes it fall.
    this.body = clampToBounds({ ...this.body, grounded: false, platformId: null }, this.bounds);
    this.windowPlatforms = visibleTops(this.windows, this.bounds);
    this.windowWalls = junctionWalls(this.windows, this.bounds);
    this.buildLayer.setGrid(this.rigScale(), this.bounds.width, this.bounds.height);
    this.lineLayer.setBounds(this.bounds.width, this.bounds.height);
    this.mergeSurfaces();
    this.fx.resize(this.bounds.width, this.bounds.height);
    fitDummies(this.combat, this.bounds, this.scale);
    this.chess?.resize(this.bounds);
    // The display may have changed too: re-read where the overlay sits, then re-place the terrain.
    void ambientGeometry().then((g) => g && this.setWorldGeometry(g)).catch(() => {});
    this.refreshTerrain();
    // A new resolution or arrangement: re-derive the favourite spot from its screen fractions.
    if (this.home && this.homeIsFavorite && this.favorite) this.home = homeToPosition(this.favorite, this.bounds, this.body.w, this.body.h);
    else if (this.home) this.home = clampToBounds({ ...this.body, ...this.home }, this.bounds);
    this.fxDirty = true;
  };
}

function preventDefault(e: Event) {
  e.preventDefault();
}

/** Fire-and-forget an IPC call; failures (e.g. during shutdown) are not actionable. */
function ignore(promise: Promise<unknown>) {
  promise.catch(() => {});
}
