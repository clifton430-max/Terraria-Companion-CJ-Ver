// Typed wrappers around the Rust commands and events.

import { invoke } from "@tauri-apps/api/core";
import type { WorldInput } from "./world/input";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WindowRect } from "./engine/platforms";

export interface Prefs {
  visible: boolean;
  paused: boolean;
  scale: number;
  walkSpeed: number;
  /** Fraction (0..1) of usable screen width, or null if never saved. */
  lastX: number | null;
  /** Whether other apps' windows act as platforms. */
  platforms: boolean;
  /** Equipped hotbar slot (0..9). */
  selectedSlot: number;
  /** Weapon id per inventory slot, or null before the first rearrangement. */
  inventory: (string | null)[] | null;
  /** Whether the combat training sandbox is active. */
  training: boolean;
  /** Look of the Terraria-art character. */
  appearance: Appearance;
  companionMode: CompanionMode;
  /** Stay-put home as fractions (0..1) of the usable screen. */
  stayPosition: { x: number; y: number } | null;
  idlePose: IdlePose;
  cursorMode: CursorMode;
  /** Hide the real cursor while in Become mode (opt-in; restored automatically). */
  hideSystemCursor: boolean;
  effects: { letterBreak: boolean; word: string };
  bossDifficulty: BossDifficulty;
  dock: DockPrefs;
  /** Companion skin; falls back to "default" (with a note) when its resource pack is missing. */
  skin: SkinId;
  audio: AudioPrefs;
  pickaxe: PickaxePrefs;
  control: ControlPrefs;
  build: BuildPrefs;
  theme: ThemePrefs;
  lines: LinePrefs;
  /** Older prefs may lack it. */
  chess?: ChessPrefs;
  world?: WorldPrefs;
  persona: PersonaPrefs;
  affection: AffectionState;
  characters: CharacterPrefs;
  /** Idle-pose rotation (always present after Rust migrates older preferences). */
  idle: IdlePrefs | null;
  awareness: AwarenessPrefs;
  reactions: ReactionRule[];
  ai: AiPrefs;
  voiceInput: VoiceInputPrefs;
  /** Letter Destroyer bookmarklet: whether the local endpoint listens for its pings. */
  destroyer: { connect: boolean };
}

export type AnswerLength = "short" | "medium" | "long";

export interface AiPrefs {
  /** "auto" or an installed Ollama model. */
  model: string;
  length: AnswerLength;
}

export interface VoiceInputPrefs {
  enabled: boolean;
  /** "wispr": Wispr Flow dictates into her input (default). "apple": her own push-to-talk. */
  source?: "wispr" | "apple";
  /** Accelerator, e.g. "Control+Shift+Space". */
  shortcut: string;
  mode: "hold" | "toggle";
  /** WebView audio-input device id, or "default". */
  microphone: string;
  /** Show the recognised text for editing before sending (ignored while auto-submit is on). */
  review: boolean;
  /** Send automatically once you stop speaking. */
  autoSubmit: boolean;
  /** Seconds of silence that end the recording (1–6). */
  silence: number;
}

export interface Transcript {
  text: string;
  onDevice: boolean;
}

export interface VoiceFailure {
  kind: string;
  message: string;
}

export interface IdlePrefs {
  mode: "rotate" | "fixed";
  /** Seconds between pose changes (10–600). */
  interval: number;
  paused: boolean;
}

export interface AwarenessPrefs {
  appEnabled: boolean;
  screenEnabled: boolean;
  keepScreenshots: boolean;
  keepHistory: boolean;
  excluded: string[];
  quiet: boolean;
  quietText: boolean;
}

export type ReactionVoice = "none" | "random" | "hit0" | "hit1" | "hit2" | "killed";
export type ReactionAnimation = "none" | "wave" | "hug" | "jump" | "sit" | "nap";

export interface ReactionRule {
  id: string;
  /** Bundle id, or "*" for any app without its own rule. */
  bundleId: string;
  name: string;
  enabled: boolean;
  comments: string[];
  voice: ReactionVoice;
  animation: ReactionAnimation;
  /** Seconds. */
  cooldown: number;
  /** 0..1 */
  chance: number;
  quiet: boolean;
  windowSwitches: boolean;
}

export interface AppInfo {
  bundleId: string;
  name: string;
}

export interface AppSwitch extends AppInfo {
  sameApp: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StoredMessage extends ChatMessage {
  screen?: boolean;
  thumbnail?: string | null;
}

export interface AiStatus {
  available: boolean;
  provider: string;
  models: { name: string; vision: boolean }[];
  model: string | null;
  reason: string | null;
}

export interface ScreenStatus {
  optedIn: boolean;
  permission: boolean;
  secureInput: boolean;
}

export interface ChatReply {
  text: string;
  thumbnail: string | null;
}

export interface ChatFailure {
  kind: "refused" | "cancelled" | "error";
  message: string;
}

export type SkinId = "default" | "waifu2b";

export interface AudioPrefs {
  /** Master mute (voice and effects). */
  muted: boolean;
  voiceEnabled: boolean;
  /** 0..1 */
  voiceVolume: number;
  /** 0..1 */
  sfxVolume: number;
  /** Voice-pack voice: "active" or a variant number from listVoices(). */
  voice: string;
  /** Master volume 0..1 (on top of voice/effects). */
  master: number;
}

export interface PickaxePrefs {
  /** Seconds between swings (0.15–2). */
  cooldown: number;
  /** Master switch for the glyph-cracking effect at the pointer. */
  effects: boolean;
}

export interface ControlPrefs {
  /** Upward speed while holding Space in Control mode (CSS px/s, 120–640). */
  flightSpeed: number;
  /** Global shortcut that toggles Control mode. */
  toggleEnabled: boolean;
  toggleShortcut: string;
  /** "terraria" (classic) or "silksong" (Hornet-style movement and the Needle). */
  scheme: "terraria" | "silksong";
  /** Silksong Controls bindings (KeyboardEvent.code values). */
  silkKeys: import("./silk/keys").SilkKeys;
  /** Terraria Controls bindings. */
  terrariaKeys: import("./overlay/controls").TerrariaKeys;
}

export interface BuildPrefs {
  /** Global shortcut that toggles Build mode. */
  toggleEnabled: boolean;
  toggleShortcut: string;
  /** Block placed by a click. */
  kind: import("./engine/blocks").BlockKind;
  /** Placed blocks (grid cells from the screen's bottom-left; row 0 sits on the floor). */
  blocks: import("./engine/blocks").Block[];
}

export type PetalStyle = "drift" | "flutter" | "spiral" | "gusts";

export interface ThemePrefs {
  enabled: boolean;
  /** Blossom garland just below the menu bar. */
  garland: boolean;
  /** Grass and flowers along the Dock's edge. */
  grass: boolean;
  petals: boolean;
  density: number;
  speed: number;
  wind: number;
  sway: number;
  spin: number;
  size: number;
  style: PetalStyle;
  /** "behind" app windows (on the desktop) or "front" (over windows, under the menu bar and Dock). */
  layer: "behind" | "front";
  /** Desktop map: cherry blossom, snow or the chess battlefield. */
  map: "sakura" | "snow" | "chess";
}

/** The terrain-only background world (edits are stored separately; see worldLoad / worldSave). */
export interface WorldPrefs {
  enabled: boolean;
  /** 0 = not generated yet (a random seed is picked the first time). */
  seed: number;
  zoom: number;
  /** Saved camera (left / top edge in tiles); negative = the default view. */
  cameraX: number;
  cameraY: number;
  edit: boolean;
  /** The companions walk on the terrain. */
  collide: boolean;
  play?: boolean;
  /** Who plays: "selected" (your selected companion) or a character id. */
  player?: string;
  /** Drag or scroll the bare desktop with the pan chord held to look around the world. */
  drag?: boolean;
  /** The modifiers held for that: "Control" | "Option" | "Shift" | "Command" (default ⌥⌘). */
  panChord?: string[];
}

export interface ChessPrefs {
  /** Board size in CSS px (0 = automatic). */
  board: number;
  maximized: boolean;
  material: string;
  mode: "local" | "companion" | "lesson";
  playerColor: "w" | "b";
  difficulty: "easy" | "normal" | "hard";
  /** Where the board was dragged (fractions of the free space), or -1 for the default spot. */
  x?: number;
  y?: number;
}

export interface LinePrefs {
  toggleEnabled: boolean;
  toggleShortcut: string;
  /** Draw the lines faintly outside edit mode. */
  show: boolean;
  items: import("./engine/lines").Line[];
}

export interface PersonaPrefs {
  intensity: "subtle" | "normal" | "strong";
  spontaneous: boolean;
  /** Spontaneous dialogue frequency multiplier (0.25–3). */
  frequency: number;
  /** Ask for attention after you've been away a while. */
  attention: boolean;
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
  /** Affection lost per hour of active use (0–10). */
  decay: number;
  /** Speech-bubble pinkness 0–1. */
  bubblePink: number;
  showAffection: boolean;
  cookieEnabled: boolean;
  cookieShortcut: string;
}

export type CharacterId = "terrarian" | "princess" | "partygirl" | "nurse" | "zoologist" | "goblin";

export interface CharacterSettings {
  id: CharacterId;
  /** Weapon for fighting on her own ("" = signature weapon). */
  weapon: string;
  hitSound: "voice" | "yamete" | "off";
  chatter: boolean;
  affection: AffectionState;
  /** Look overrides for add-on characters ("" / 0 = her default). */
  look: { skin: string; eyes: string; hair: number };
  /** A name you gave her ("" = her built-in name; older prefs may lack it). */
  name?: string;
}

export interface CharacterPrefs {
  active: CharacterId[];
  selected: CharacterId;
  interactions: boolean;
  interactionFrequency: number;
  autoFight: boolean;
  aiFlight: boolean;
  per: CharacterSettings[];
  /** Movement modes (older prefs files may lack it; see engine/behaviorModes.ts). */
  behavior?: BehaviorPrefs;
}

export type JumpStyle = "normal" | "jumpy" | "grounded";

export interface BehaviorPrefs {
  spread: boolean;
  jump: JumpStyle;
  /** The hangout platform (an invisible line, by its endpoints), or null. */
  watch: import("./engine/lines").Line | null;
}

/** Which installed pack provides each add-on (null if not installed). */
export interface AddonInfo {
  princess: string | null;
  waifu2: string | null;
  moonGirl: string | null;
  queenBee: string | null;
  goblin: string | null;
  yamete: string | null;
}

export interface AffectionState {
  value: number;
  /** Unix ms of the last update. */
  updated: number;
  cookies: number;
}

export interface SkinInfo {
  id: SkinId;
  name: string;
  available: boolean;
  detail: string;
}

export interface VoiceInfo {
  id: string;
  label: string;
  clips: VoiceClip[];
}

export type VoiceClip = "hit0" | "hit1" | "hit2" | "killed";

export type DockLaunch = "remember" | "show" | "hide";
export type DockLayout = "full" | "compact";

export interface DockPrefs {
  /** Currently shown (remembered across launches). */
  visible: boolean;
  /** Visibility at launch: remember the last state, always show, or always hide. */
  onLaunch: DockLaunch;
  expanded: boolean;
  layout: DockLayout;
  /** Window top-left in logical points (global coordinates); null = default spot. */
  position: { x: number; y: number } | null;
}

/** Partial dock update; `resetPosition` moves it back to the default spot. */
export type DockPatch = Partial<Omit<DockPrefs, "position">> & { resetPosition?: boolean };

export type CompanionMode = "roam" | "stay";
export type IdlePose = "stand" | "sit" | "wave" | "lookAround" | "swingLegs" | "nap";
export type CursorMode = "off" | "ride" | "hug" | "become";
export type BossDifficulty = "easy" | "normal" | "expert" | "master";

export interface AppearanceColors {
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  undershirt: string;
  pants: string;
  shoes: string;
}

export interface Appearance {
  /** Body/clothing variant 0–11. */
  skinVariant: number;
  /** Hair style (1-based). */
  hair: number;
  colors: AppearanceColors;
  armor: { head: number | null; body: number | null; legs: number | null };
  hairUnderHelmet: "hide" | "alt" | "full";
  /** Stored for the future; not drawn yet. */
  accessories: number[];
}

/** Atlas description returned by `get_player_rig` (see `src-tauri/src/terraria_app.rs`). */
export interface RigInfo {
  available: boolean;
  reason: string | null;
  path: string | null;
  frameWidth: number;
  frameHeight: number;
  frames: string[];
  /** Hand centre per frame in cell pixels (right-facing). */
  hands: Record<string, [number, number]>;
  body: { x: number; y: number; w: number; h: number };
  gameVersion: string | null;
  missing: string[];
  /** Skin actually drawn. */
  skin: SkinId;
  /** Why the requested skin wasn't used (e.g. its pack is missing). */
  skinNote: string | null;
}

export type PrefsPatch = {
  dock?: DockPatch;
  skin?: SkinId;
  audio?: AudioPrefs;
  pickaxe?: PickaxePrefs;
  control?: ControlPrefs;
  build?: BuildPrefs;
  theme?: ThemePrefs;
  lines?: LinePrefs;
  chess?: ChessPrefs;
  world?: WorldPrefs;
  persona?: PersonaPrefs;
  affection?: AffectionState;
  characters?: CharacterPrefs;
  idle?: IdlePrefs;
  awareness?: AwarenessPrefs;
  reactions?: ReactionRule[];
  ai?: AiPrefs;
  voiceInput?: VoiceInputPrefs;
  destroyer?: { connect: boolean };
} & Partial<
  Pick<
    Prefs,
    | "visible"
    | "paused"
    | "scale"
    | "walkSpeed"
    | "lastX"
    | "selectedSlot"
    | "inventory"
    | "training"
    | "appearance"
    | "companionMode"
    | "stayPosition"
    | "idlePose"
    | "cursorMode"
    | "hideSystemCursor"
    | "effects"
    | "bossDifficulty"
  >
>;

export type CombatAction =
  | "attack"
  | "reset"
  | "dismiss"
  | "summonBoss"
  | "dismissBoss"
  | "summonMoonLord"
  | "summonQueenBee"
  | "toggleCookie"
  | "dismissCookie"
  | "spawnCookie"
  | "affectionChat"
  | "affectionKind"
  | "affectionRude"
  | "retryBoss"
  | "letterSmash"
  | "stopEffects"
  | "toggleBoss"
  | "setFavoriteSpot"
  | "returnToFavorite"
  | "openChess"
  | "closeChess"
  | "flipChess"
  | "studyHelp"
  | "pickHangout"
  | "exploreWorld";

export interface CombatCommand {
  action: CombatAction;
  dir: -1 | 1 | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const getPrefs = () => invoke<Prefs>("get_prefs");
export const patchPrefs = (patch: PrefsPatch) => invoke<Prefs>("patch_prefs", { patch });
export const setHitbox = (rect: Rect | null, extra: Rect[] = []) => invoke<void>("set_hitbox", { rect, extra });
export const setCapture = (active: boolean) => invoke<void>("set_capture", { active });
export const toggleInventory = () => invoke<void>("toggle_inventory");
export const hideInventory = () => invoke<void>("hide_inventory");
/** The notch's compact inventory: put it away, or swap it for the full menu (Combat). */
export const hidePouch = () => invoke<void>("hide_pouch");
export const pouchOpenMenu = () => invoke<void>("pouch_open_menu");
/** The pouch was just opened beside the notch. */
export const onPouchOpened = (cb: () => void): Promise<UnlistenFn> => listen<string>("companion://pouch", () => cb());
export const showInventory = () => invoke<void>("show_inventory");
/** Ask Rust to resize the dock window (validated and kept on screen there). */
export const setDockSize = (width: number, height: number) => invoke<void>("set_dock_size", { width, height });

/** Whether the Eye of Cthulhu is on screen; broadcast by the overlay for the dock's button. */
export const emitBossState = (active: boolean) => emit("companion://boss-state", active);
export const onBossState = (cb: (active: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("companion://boss-state", (event) => cb(event.payload === true));
/** Ask the overlay's combat sandbox to attack, reset or dismiss minions (validated in Rust). */
export const combatCommand = (action: CombatAction, dir?: -1 | 1) =>
  invoke<void>("combat_command", { action, dir: dir ?? null });
/** Eligible windows (front-to-back, overlay CSS pixels). Geometry only, never contents. */
export const getPlatforms = () => invoke<WindowRect[]>("get_platforms");

/** Explore the world (false: it couldn't start, Accessibility permission is missing). */
export const worldNav = (on: boolean) => invoke<boolean>("world_nav", { on });
/** Accessibility permission (exploring and playing take desktop clicks and keys from Finder). */
export const accessibilityStatus = () => invoke<boolean>("accessibility_status");
export const openAccessibilitySettings = () => invoke<void>("open_accessibility_settings");
/** The pointer's position (CSS px of the theme windows), streamed while the chess map shows. */
export const onPointer = (cb: (p: { x: number; y: number }) => void): Promise<UnlistenFn> => listen<{ x: number; y: number }>("companion://pointer", (e) => cb(e.payload));
/** Input aimed at the bare desktop, forwarded by Rust's event tap to the world window. */
export const onWorldInput = (cb: (e: WorldInput) => void): Promise<UnlistenFn> => listen<WorldInput>("companion://world-input", (e) => cb(e.payload));
export const gameLoad = () => invoke<string | null>("game_load");
export const gameSave = (data: string) => invoke<boolean>("game_save", { data });
export const getWorldPlay = () => invoke<boolean>("get_world_play");

/** A saved place in the background world (the gallery). Previews are small JPEG data URLs. */
export interface Place {
  id: string;
  kind: "biome" | "structure" | "settlement" | "town" | "arena" | "house";
  name: string;
  /** Biome label ("Forest", "Snow", "Dungeon"...). */
  label: string;
  x: number;
  y: number;
  day?: number;
  progress?: number;
  status: string;
  preview?: string;
}
export interface PlacesFile {
  seed: number;
  places: Place[];
}
export const placesLoad = () => invoke<string | null>("places_load");
export const placesSave = (data: string) => invoke<boolean>("places_save", { data });
/** Look at a place in the background world (tile coordinates). */
export const placesGoto = (x: number, y: number) => invoke<void>("places_goto", { x, y });
export const onPlaces = (cb: () => void): Promise<UnlistenFn> => listen("companion://places", () => cb());
export const onWorldGoto = (cb: (x: number, y: number) => void): Promise<UnlistenFn> =>
  listen<{ x: number; y: number }>("companion://world-goto", (e) => {
    const { x, y } = e.payload ?? { x: NaN, y: NaN };
    if (Number.isFinite(x) && Number.isFinite(y)) cb(x, y);
  });
/** A desktop drag of the world started / ended (the companions don't take the pointer meanwhile). */
export const worldDragging = (on: boolean) => invoke<void>("world_dragging", { on });
export type GameMode = "player" | "auto";
/** The game started / stopped: "player" (your companion plays) or "auto" (they build a house). */
export const onWorldPlay = (cb: (on: boolean, mode: GameMode) => void): Promise<UnlistenFn> =>
  listen<{ on: boolean; mode: string }>("companion://world-play", (e) => cb(e.payload?.on === true, e.payload?.mode === "auto" ? "auto" : "player"));
/** Start the game (other windows can stay open); refused without Accessibility permission. */
export const startGame = (mode: GameMode) => invoke<{ ok: boolean; blocked: number; needsAccessibility: boolean }>("start_game", { mode });
export const stopGame = () => invoke<void>("stop_game");
export const hideOtherApps = () => invoke<void>("hide_other_apps");
/** Rust asks the companion to say something (e.g. "hide your windows first"). */
export const onCompanionSay = (cb: (text: string) => void): Promise<UnlistenFn> => listen<string>("companion://say", (e) => cb(String(e.payload ?? "")));
/** The game player's rig wearing armour sheets (1 copper, 2 iron, 3 silver, 4 gold). */
export const getGameRig = (head: number | null, body: number | null, legs: number | null) => invoke<RigInfo>("get_game_rig", { head, body, legs });
export const getWorldNav = () => invoke<boolean>("get_world_nav");
export const worldView = (x: number, y: number, zoom: number) => invoke<void>("world_view", { x, y, zoom });
export const worldLoad = () => invoke<string | null>("world_load");
export const worldSave = (data: string) => invoke<boolean>("world_save", { data });
export const onWorldNav = (cb: (on: boolean) => void): Promise<UnlistenFn> => listen<boolean>("companion://world-nav", (e) => cb(e.payload === true));
export const onWorldView = (cb: (v: { x: number; y: number; zoom: number }) => void): Promise<UnlistenFn> =>
  listen<{ x: number; y: number; zoom: number }>("companion://world-view", (e) => cb(e.payload));
export const onWorldEdits = (cb: () => void): Promise<UnlistenFn> => listen("companion://world-edits", () => cb());

export const onPrefs = (cb: (prefs: Prefs) => void): Promise<UnlistenFn> =>
  listen<Prefs>("companion://prefs", (event) => cb(event.payload));

/** Compose (or reuse) the player atlas for the saved appearance from the local Terraria install. */
export const getPlayerRig = () => invoke<RigInfo>("get_player_rig");
/** Atlas for a given skin (previews); doesn't change the saved skin. */
export const getSkinRig = (skin: SkinId) => invoke<RigInfo>("get_skin_rig", { skin });
/** Atlas for a roster character. */
export const getCharacterRig = (id: CharacterId) => invoke<RigInfo>("get_character_rig", { id });
export const listAddons = () => invoke<AddonInfo>("list_addons");
/** URL of an add-on hit sound (Yamete pack). */
export const addonSoundUrl = (clip: string) => assetUrl(`/addonsound/yamete/${clip}.wav`);
export const listSkins = () => invoke<SkinInfo[]>("list_skins");
export const listVoices = () => invoke<{ pack: string | null; voices: VoiceInfo[] }>("list_voices");
/** Pointer position in overlay CSS px (global mouse location only), or null. */
export const getCursor = () => invoke<[number, number] | null>("get_cursor");
/** Voice-pack clip, converted to WAV by Rust. */
export const voiceUrl = (voice: string, clip: VoiceClip) => assetUrl(`/voice/${encodeURIComponent(voice)}/${clip}.wav`);
/** Vanilla Terraria sound effect (`Content/Sounds/<name>.xnb`) as WAV. */
export const soundUrl = (name: string) => assetUrl(`/sound/${name}.wav`);
/** Enter/leave "Control Character" mode (overlay takes keyboard focus and all clicks). */
export const setControlMode = (enabled: boolean) => invoke<void>("set_control_mode", { enabled });
export const getControlMode = () => invoke<boolean>("get_control_mode");
export const onControl = (cb: (enabled: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("companion://control", (event) => cb(event.payload));

/** URL for a `tasset://` route (macOS/Linux form; Windows WebView2 uses http://tasset.localhost). */
export function assetUrl(path: string): string {
  const windows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
  return windows ? `http://tasset.localhost${path}` : `tasset://localhost${path}`;
}

export const onCombat = (cb: (command: CombatCommand) => void): Promise<UnlistenFn> =>
  listen<CombatCommand>("companion://combat", (event) => cb(event.payload));

/** Cursor position (overlay CSS px), streamed only while a cursor mode is active. */
export const runningApps = () => invoke<AppInfo[]>("running_apps");
export const screenStatus = () => invoke<ScreenStatus>("screen_status");
export const requestScreenPermission = () => invoke<boolean>("request_screen_permission");
export const openPrivacySettings = () => invoke<void>("open_privacy_settings");
export const aiStatus = () => invoke<AiStatus>("ai_status");
/** Ask the local model; with `screen`, Rust captures one screenshot after its privacy checks. */
export const chatAsk = (requestId: string, messages: ChatMessage[], screen: boolean) =>
  invoke<ChatReply>("chat_ask", { requestId, messages, screen });
export const chatCancel = (requestId?: string) => invoke<void>("chat_cancel", { requestId: requestId ?? null });
/** Study help: read the text in a box on screen (global points), after the privacy checks. */
export const studyLook = (box: { x: number; y: number; w: number; h: number }) => invoke<{ text: string; x: number; y: number; w: number; h: number }[]>("study_look", box);
/** Study help: a chalkboard lesson (JSON) for a question's text from the local model. */
export const studyAsk = (requestId: string, text: string, task: "teach" | "review" | "simpler") => invoke<string>("study_ask", { requestId, text, task });
/** Study help: hand a hard question to Gemini (prompt copied, Gemini opened in the browser). */
export const studyGemini = (text: string) => invoke<boolean>("study_gemini", { text });
export const chatHistoryLoad = () => invoke<StoredMessage[]>("chat_history_load");
export const chatHistorySave = (messages: StoredMessage[]) => invoke<void>("chat_history_save", { messages });
export const chatHistoryClear = () => invoke<void>("chat_history_clear");
export const showChat = () => invoke<void>("show_chat");
export const hideChat = () => invoke<void>("hide_chat");

/** Foreground-app switches (bundle id + name only), while app awareness is on. */
export const onAppSwitch = (cb: (ev: AppSwitch) => void): Promise<UnlistenFn> =>
  listen<AppSwitch>("companion://app-switch", (event) => cb(event.payload));

/** Settings → overlay: play a reaction rule once (the Preview button). */
export const previewReaction = (rule: ReactionRule) => emit("companion://reaction-preview", rule);
export const onReactionPreview = (cb: (rule: ReactionRule) => void): Promise<UnlistenFn> =>
  listen<ReactionRule>("companion://reaction-preview", (event) => cb(event.payload));

/** Transcribe a push-to-talk recording (base64 WAV) with the bundled Apple Speech helper. */
export const transcribe = (audio: string, locale?: string) => invoke<Transcript>("transcribe", { audio, locale: locale ?? null });
export const voiceShortcutStatus = () => invoke<string>("voice_shortcut_status");
export const controlShortcutStatus = () => invoke<string>("control_shortcut_status");

/** Enter/leave Build mode (overlay takes the mouse: click places a block, right-click removes). */
export const setBuildMode = (enabled: boolean) => invoke<void>("set_build_mode", { enabled });
export const getBuildMode = () => invoke<boolean>("get_build_mode");
export const onBuild = (cb: (enabled: boolean) => void): Promise<UnlistenFn> => listen<boolean>("companion://build", (event) => cb(event.payload));
export const buildShortcutStatus = () => invoke<string>("build_shortcut_status");

/** Enter/leave Platform-edit mode (draw, move, resize, delete invisible platforms). */
export const setLinesMode = (enabled: boolean) => invoke<void>("set_lines_mode", { enabled });
export const getLinesMode = () => invoke<boolean>("get_lines_mode");
export const onLines = (cb: (enabled: boolean) => void): Promise<UnlistenFn> => listen<boolean>("companion://lines", (event) => cb(event.payload));
export const linesShortcutStatus = () => invoke<string>("lines_shortcut_status");

/** Primary display layout for the theme layer (CSS points), or null if unknown. */
export interface AmbientGeometry {
  width: number;
  height: number;
  menuBar: number;
  dockEdge: "bottom" | "left" | "right" | "hidden";
  dockSize: number;
}
export const ambientGeometry = () => invoke<AmbientGeometry | null>("ambient_geometry");

/** Ask the local model which app action (from `catalog` lines) a request means; JSON text back. */
export const aiClassify = (request: string, catalog: string) => invoke<string>("ai_classify", { request, catalog });
/** Seconds since the last keyboard/mouse input anywhere (idle timer only). */
export const userIdleSeconds = () => invoke<number>("user_idle_seconds");
/** Open settings on a tab. */
export const showSettings = (tab?: "items" | "character" | "maps" | "companion" | "awareness") => invoke<void>("show_settings", { tab: tab ?? null });
export const onSettingsTab = (cb: (tab: string) => void): Promise<UnlistenFn> => listen<string>("companion://settings-tab", (e) => cb(e.payload));
export const cookieShortcutStatus = () => invoke<string>("cookie_shortcut_status");
/** Pause/resume every global shortcut while settings records a new one. */
export const suspendShortcuts = (suspended: boolean) => invoke<void>("suspend_shortcuts", { suspended });
/** Open a macOS System Settings pane (fixed list, validated in Rust); false if unknown. */
export const openSystemSettings = (pane: string) => invoke<boolean>("open_system_settings", { pane });
export const destroyerStatus = () => invoke<string>("destroyer_status");
/** Send a pickaxe strike (overlay point) to the Letter Destroyer; resolves to whether a page is listening. */
export const destroyerStrike = (x: number, y: number, power = 1) => invoke<boolean>("destroyer_strike", { x, y, power });
export interface DestroyerEvent {
  event: "on" | "smash" | "off";
  count: number;
}
/** Pings from the Letter Destroyer bookmarklet (event name and count only). */
export const onDestroyer = (cb: (ev: DestroyerEvent) => void): Promise<UnlistenFn> =>
  listen<DestroyerEvent>("companion://destroyer", (event) => cb(event.payload));
export const focusOverlay = () => invoke<void>("focus_overlay");

// ── CustomNotch link (see src-tauri/src/notch_link.rs) ──────────────────────────────────────────

/** Where CustomNotch is, in overlay CSS px, and who lives in it. */
export interface NotchStatus {
  connected: boolean;
  rect: { x: number; y: number; w: number; h: number } | null;
  edge?: "top" | "bottom" | "left" | "right";
  expanded?: boolean;
  dragging?: boolean;
  resident: CharacterId | null;
}

/** Something done to the resident inside the notch; x/y in overlay CSS px, velocity in px/s. */
export interface NotchAction {
  kind: "exit" | "pet" | "feed";
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface NotchResident {
  character: CharacterId;
  name: string;
  /** Base64 PNG strip of `frameWidth`×`frameHeight` cells named by `frames`. */
  atlas: string;
  frameWidth: number;
  frameHeight: number;
  frames: string[];
  body: { x: number; y: number; w: number; h: number };
  bubble: { top: string; bottom: string; border: string; text: string; heart: string };
  gestures: string[];
  stride: number;
  scale: number;
  arrive: boolean;
}

export const notchStatus = () => invoke<NotchStatus>("notch_status");
export const notchEnter = (resident: NotchResident) => invoke<void>("notch_enter", { resident });
export const notchLeave = (character: CharacterId) => invoke<boolean>("notch_leave", { character });
export const notchSay = (character: CharacterId, text: string) => invoke<boolean>("notch_say", { character, text });
export const notchGesture = (character: CharacterId, gesture: string) => invoke<boolean>("notch_gesture", { character, gesture });
export const notchHover = (state: "" | "empty" | "full" | "incoming") => invoke<void>("notch_hover", { state });
export const onNotch = (cb: (s: NotchStatus) => void): Promise<UnlistenFn> => listen<NotchStatus>("companion://notch", (e) => cb(e.payload));
export const onNotchAction = (cb: (a: NotchAction) => void): Promise<UnlistenFn> => listen<NotchAction>("companion://notch-action", (e) => cb(e.payload));
/** Wispr Flow (voice input): why it can't carry voice right now, if it can't. */
export interface WisprStatus {
  problem: "notInstalled" | "notRunning" | "noShortcut" | "noAccessibility" | null;
  message: string;
  canLaunch: boolean;
}
export const wisprStatus = () => invoke<WisprStatus>("wispr_status");
export const wisprLaunch = () => invoke<boolean>("wispr_launch");
/** ⌘Z in the app a dictation meant for the companion went into (if it's still frontmost). */
export const wisprTakeBack = (appId: string) => invoke<boolean>("wispr_take_back", { appId });
/** Wispr Flow's key went down with no other app's text field focused: open her input for it. */
export const onWisprDictate = (cb: () => void): Promise<UnlistenFn> => listen("companion://wispr-dictate", () => cb());
/** Wispr Flow's key went down but it can't carry voice right now. */
export const onWisprProblem = (cb: (s: WisprStatus) => void): Promise<UnlistenFn> => listen<WisprStatus>("companion://wispr-problem", (e) => cb(e.payload));
/** A new Wispr Flow dictation into another app (checked for her name). */
export const onWisprDictation = (cb: (d: { at: string; app: string; text: string }) => void): Promise<UnlistenFn> =>
  listen<{ at: string; app: string; text: string }>("companion://wispr-dictation", (e) => cb(e.payload));
/** Key down/up of the global voice shortcut (only registered while voice input is enabled). */
export const onVoiceKey = (cb: (state: "pressed" | "released") => void): Promise<UnlistenFn> =>
  listen<"pressed" | "released">("companion://voice-key", (event) => cb(event.payload));
/** Overlay → chat window: add a voice question and its answer to the chat log. */
export const emitChatAppend = (question: string, answer: string) => emit("companion://chat-append", { question, answer });
export const onChatAppend = (cb: (qa: { question: string; answer: string }) => void): Promise<UnlistenFn> =>
  listen<{ question: string; answer: string }>("companion://chat-append", (event) => cb(event.payload));

/** Overlay → chat window: focus the input, or start "Ask about my screen". */
export type ChatCommand = "focus" | "screen";
export const emitChatCommand = (cmd: ChatCommand) => emit("companion://chat-command", cmd);
export const onChatCommand = (cb: (cmd: ChatCommand) => void): Promise<UnlistenFn> =>
  listen<ChatCommand>("companion://chat-command", (event) => cb(event.payload));

export const onCursor = (cb: (pos: { x: number; y: number }) => void): Promise<UnlistenFn> =>
  listen<{ x: number; y: number }>("companion://cursor", (event) => cb(event.payload));

export const onPlatforms = (cb: (windows: WindowRect[]) => void): Promise<UnlistenFn> =>
  listen<WindowRect[]>("companion://platforms", (event) => cb(event.payload));
