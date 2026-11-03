// The companion's own actions, as the assistant sees them: a catalog of what can really be done
// (each tied to an actual setting or command), a natural-language parser for common phrasings,
// and an executor that performs an action and then checks it really took effect before reporting.
// General questions never come through here; see router.ts.

import { WEAPONS, isPickaxe, pickaxePower, type WeaponDef } from "../combat/weapons";
import type { BehaviorPrefs, CharacterId, Prefs, PrefsPatch } from "../bridge";
import { DEFAULT_BEHAVIOR, hangoutFromSpeech, normalizeBehavior } from "../engine/behaviorModes";
import { sanitizeLines } from "../engine/lines";

export type ActionId =
  | "control.on"
  | "control.off"
  | "scheme.silksong"
  | "scheme.terraria"
  | "mode.roam"
  | "mode.stay"
  | "pause.on"
  | "pause.off"
  | "idle.pose"
  | "petals.on"
  | "petals.off"
  | "petals.more"
  | "petals.less"
  | "petals.faster"
  | "petals.slower"
  | "theme.on"
  | "theme.off"
  | "equip"
  | "settings.open"
  | "inventory.open"
  | "chat.open"
  | "bubble.pinker"
  | "bubble.paler"
  | "boss.eye"
  | "boss.moon"
  | "boss.dismiss"
  | "boss.queen"
  | "character.select"
  | "character.summon"
  | "character.dismiss"
  | "macos.open"
  | "map.snow"
  | "map.sakura"
  | "map.chess"
  | "training.on"
  | "training.off"
  | "build.on"
  | "build.off"
  | "lines.on"
  | "lines.off"
  | "cookie.give"
  | "companion.hide"
  | "sound.mute"
  | "sound.unmute"
  | "size.small"
  | "size.medium"
  | "size.large"
  | "chatter.on"
  | "chatter.off"
  | "personality.subtle"
  | "personality.normal"
  | "personality.strong"
  | "screen.on"
  | "screen.off"
  | "blocks.clear"
  | "lines.clear"
  | "affection.reset"
  | "chess.open"
  | "chess.close"
  | "chess.flip"
  | "study.help"
  | "behavior.spread"
  | "behavior.together"
  | "behavior.jumpy"
  | "behavior.grounded"
  | "behavior.watch"
  | "behavior.unwatch"
  | "behavior.reset"
  | "world.show"
  | "world.hide"
  | "world.explore"
  | "game.play"
  | "game.auto"
  | "game.stop";

export interface Action {
  id: ActionId;
  /** e.g. { pose: "sit" } for idle.pose, { item: "picksaw" } for equip, { tab } for settings.open. */
  args?: Record<string, string>;
}

export const IDLE_POSES = ["stand", "sit", "wave", "lookAround", "swingLegs", "nap"] as const;
export type IdlePoseName = (typeof IDLE_POSES)[number];
const POSE_LABEL: Record<IdlePoseName, string> = { stand: "standing", sit: "sitting", wave: "waving", lookAround: "looking around", swingLegs: "swinging her legs", nap: "napping" };

interface Spec {
  /** Shown to the local model when it routes a request. */
  describe: string;
  /** Needs a yes before it runs (destructive, privacy or hard to undo). */
  confirm?: string;
}

export const CATALOG: Record<ActionId, Spec> = {
  "control.on": { describe: "start Control mode (the user controls the character with keyboard and mouse)" },
  "control.off": { describe: "stop Control mode" },
  "scheme.silksong": { describe: "switch the control scheme to Silksong controls" },
  "scheme.terraria": { describe: "switch the control scheme to Terraria controls" },
  "mode.roam": { describe: "Roam mode: the companion walks around the desktop on her own" },
  "mode.stay": { describe: "Stay Put mode: the companion stops moving and stays in one place" },
  "pause.on": { describe: "pause the companion completely (freeze)" },
  "pause.off": { describe: "unpause / resume the companion" },
  "idle.pose": { describe: "change the idle animation; args.pose = stand | sit | wave | lookAround | swingLegs | nap | next" },
  "petals.on": { describe: "turn falling cherry blossom petals on" },
  "petals.off": { describe: "turn falling petals off" },
  "petals.more": { describe: "more petals (higher density)" },
  "petals.less": { describe: "fewer petals (lower density)" },
  "petals.faster": { describe: "petals fall faster" },
  "petals.slower": { describe: "petals fall slower" },
  "map.snow": { describe: "switch the desktop map/theme to Snow (falling snow, snowmen, icicles)" },
  "map.sakura": { describe: "switch the desktop map/theme to Cherry Blossom (petals)" },
  "map.chess": { describe: "switch the desktop map/theme to the dark-fantasy Chess battlefield (fallen pieces, lanterns, drifting dust)" },
  "chess.open": { describe: "open the chess board for a local two-player game (the companions cheer and move the pieces)" },
  "chess.close": { describe: "close / put away the chess board" },
  "chess.flip": { describe: "turn the chess board around to see it from the other side" },
  "study.help": { describe: "tutor the user through a homework question on their screen (they box it; she explains on a chalkboard, they choose)" },
  "behavior.spread": { describe: "the companions spread out a bit (prefer different platforms)" },
  "behavior.together": { describe: "the companions stop spreading out and stay together" },
  "behavior.jumpy": { describe: "the companions jump between platforms more" },
  "behavior.grounded": { describe: "the companions stay on the ground and rarely jump" },
  "behavior.watch": { describe: "the companions hang out on an invisible platform; args.which = platform number or left | right | top | bottom | middle | pick" },
  "behavior.unwatch": { describe: "the companions stop hanging out on the platform" },
  "behavior.reset": { describe: "reset the companions' movement (spread, jumping, hangout) to default" },
  "world.show": { describe: "show the Terraria world (terrain background) behind the windows" },
  "world.hide": { describe: "hide the Terraria world background" },
  "world.explore": { describe: "explore the Terraria world background (drag to look around, Esc to finish)" },
  "game.play": { describe: "play Terraria in the background world as the companion" },
  "game.auto": { describe: "the companions play Terraria on their own and build a nice house" },
  "game.stop": { describe: "stop playing the background Terraria game" },
  "theme.on": { describe: "turn the cherry blossom desktop theme on" },
  "theme.off": { describe: "turn the cherry blossom desktop theme off" },
  equip: { describe: "equip an item from the inventory; args.item = item name (e.g. pickaxe, zenith, needle)" },
  "settings.open": { describe: "open the companion's settings window; args.tab = companion | character | maps | items | awareness" },
  "inventory.open": { describe: "open the inventory" },
  "chat.open": { describe: "open the chat window" },
  "bubble.pinker": { describe: "make the speech bubble pinker" },
  "bubble.paler": { describe: "make the speech bubble less pink / paler" },
  "boss.eye": { describe: "summon the Eye of Cthulhu boss" },
  "boss.moon": { describe: "summon the Moon Lord boss" },
  "boss.dismiss": { describe: "dismiss the current boss" },
  "boss.queen": { describe: "summon the Queen Bee boss" },
  "macos.open": { describe: "open a macOS System Settings pane for the user; args.pane = wifi | bluetooth | network | sound | displays | wallpaper | appearance | desktop-dock | control-center | notifications | focus | screen-time | battery | keyboard | trackpad | mouse | accessibility | general | software-update | storage | users | lock-screen | privacy | screen-recording | microphone | speech | camera | location | main" },
  "character.select": { describe: "switch which character is selected/controlled; args.name = princess | party girl | nurse | zoologist | goblin | terrarian" },
  "character.summon": { describe: "bring another character onto the screen; args.name = princess | party girl | nurse | zoologist | goblin | terrarian" },
  "character.dismiss": { describe: "send a character away from the screen; args.name = princess | party girl | nurse | zoologist | goblin | terrarian" },
  "training.on": { describe: "start training mode (training dummies)" },
  "training.off": { describe: "stop training mode" },
  "build.on": { describe: "start Build mode (placing blocks)" },
  "build.off": { describe: "stop Build mode" },
  "lines.on": { describe: "start editing invisible platforms" },
  "lines.off": { describe: "stop editing invisible platforms" },
  "cookie.give": { describe: "spawn a cookie the user can feed to the companion" },
  "companion.hide": { describe: "hide the companion from the screen", confirm: "hide me from your screen (you can bring me back from the menu bar)" },
  "sound.mute": { describe: "mute the companion's sounds" },
  "sound.unmute": { describe: "unmute the companion's sounds" },
  "size.small": { describe: "make the companion small" },
  "size.medium": { describe: "make the companion medium-sized" },
  "size.large": { describe: "make the companion large" },
  "chatter.on": { describe: "turn on spontaneous dialogue (she talks on her own sometimes)" },
  "chatter.off": { describe: "turn off spontaneous dialogue (she stays quiet unless spoken to)" },
  "personality.subtle": { describe: "make the personality subtle (less cutesy)" },
  "personality.normal": { describe: "set the personality to normal" },
  "personality.strong": { describe: "make the personality strong (extra cute)" },
  "screen.on": { describe: "allow asking about the screen (screenshots when asked)", confirm: "let me take a screenshot whenever you ask about your screen" },
  "screen.off": { describe: "stop allowing screenshots / screen questions" },
  "blocks.clear": { describe: "remove all placed blocks", confirm: "remove every block you've placed" },
  "lines.clear": { describe: "remove all invisible platforms", confirm: "delete all your invisible platforms" },
  "affection.reset": { describe: "reset the affection meter", confirm: "reset how close we are back to the start" },
};

export const ACTION_IDS = Object.keys(CATALOG) as ActionId[];

/** "id: description" lines for the local model. */
export const catalogText = () => ACTION_IDS.map((id) => `${id}: ${CATALOG[id].describe}`).join("\n");

// ── Parsing ────────────────────────────────────────────────────────────────────────────────

const norm = (t: string) => ` ${t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9.' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/** A question *about* something ("what is roam mode?") rather than a request to do it. */
export function isInfoQuestion(text: string): boolean {
  const t = norm(text);
  if (has(t, " can you ", " could you ", " would you ", " will you ", " please ", " i want ", " i'd like ", " let me ", " give me ")) return false;
  return /^ (what|why|how|explain|tell me about|describe|who|when|where|which|is there|does|do you know) /.test(t);
}

const ON = [" turn on ", " switch on ", " enable ", " start ", " activate ", " enter ", " go into ", " switch me to ", " switch to ", " put me in ", " use ", " i want ", " let me ", " on ", " back on "];
const OFF = [" turn off ", " switch off ", " disable ", " stop ", " exit ", " leave ", " quit ", " end ", " deactivate ", " no more ", " off ", " get rid of ", " without "];
const offish = (t: string) => has(t, ...OFF);
const onish = (t: string) => has(t, ...ON);

/** Words that suggest the user wants the app to *do* something (for the model fallback). */
export function looksLikeCommand(text: string): boolean {
  const t = norm(text);
  if (isInfoQuestion(text)) return false;
  return has(t, " turn ", " switch ", " make ", " set ", " change ", " enable ", " disable ", " open ", " give ", " equip ", " start ", " stop ", " put ", " show ", " hide ", " mute ", " unmute ", " summon ", " can you ", " could you ", " please ", " let me ", " i want ", " more ", " less ", " fewer ", " bigger ", " smaller ");
}

/** "Play Terraria", "let the girls play Terraria", "build me a house in Terraria", "stop playing". */
export function gameIntent(t: string): ActionId | null {
  if (has(t, " stop playing", " quit terraria", " leave the game", " exit the game", " stop the game", " quit the game", " stop terraria")) return "game.stop";
  if (!has(t, " terraria")) return null;
  if (has(t, " build me a house", " build us a house", " build a house", " build a nice house", " for me", " you play", " you guys play", " girls play", " waifus play", " let them", " let the ", " let my ", " on your own", " by yourselves")) return "game.auto";
  if (has(t, " play", " start", " let me ", " i want to")) return "game.play";
  return null;
}

/** "Show the Terraria world", "hide the world background", "let me explore the world". */
export function worldIntent(t: string): ActionId | null {
  if (!has(t, " terraria world", " world background", " terrain background", " the world ", " my world", " background world", " world behind", " terraria background", " terraria map")) return null;
  if (has(t, " explore", " look around", " scroll around", " navigate", " move around in")) return "world.explore";
  if (has(t, " hide", " turn off", " off ", " remove", " get rid", " disable", " stop showing", " no more")) return "world.hide";
  if (has(t, " show", " turn on", " bring", " put ", " enable", " make ", " give me", " generate", " create", " i want")) return "world.show";
  return null;
}

/** A statement about oneself ("I jump around a lot") isn't a request unless it asks for something. */
function addressed(t: string): boolean {
  if (!/^ (i|im|i'm|my|we|were|we're|he|she|they) /.test(t)) return true;
  return has(t, " you ", " your ", " want ", " can ", " could ", " would ", " please", " let's ", " lets ", " wanna ", " need ", " done ");
}

/** "Help me with my homework", "explain this question", "tutor me". */
export function studyIntent(t: string): boolean {
  return (
    has(t, " homework", " study help", " help me study", " tutor me", " be my tutor", " this question", " this problem", " quiz question", " my assignment", " this assignment") &&
    has(t, " help", " explain", " tutor", " teach", " do ", " solve", " answer", " study", " understand", " stuck")
  );
}

/** "Let's play chess" / "pull up the chessboard" → open; "put the chess board away" → close. */
export function chessIntent(t: string): "chess.open" | "chess.close" | "chess.flip" | null {
  // "Flip the board", "turn the board around", "rotate the chessboard", "see it from black's side".
  if (has(t, " board", " chessboard") && (has(t, " flip", " rotate", " spin ", " other side") || (has(t, " turn") && has(t, " around")))) return "chess.flip";
  if (!has(t, " chess") || !addressed(t)) return null;
  const board = has(t, " chessboard ", " chess board ", " chess set ", " chess game ", " game of chess ", " round of chess ", " match of chess ");
  if (has(t, " put away", " put the chess", " pack up", " close the chess", " close chess", " close the board", " quit chess", " stop playing chess", " stop the chess", " end the chess", " no more chess", " done with chess", " done playing", " enough chess", " chess away", " board away")) return "chess.close";
  if (has(t, " play chess ", " play some chess ", " play a game of chess ", " game of chess ", " round of chess ", " chess time ", " open chess ", " start chess ", " chess please ", " wanna play chess ", " lets play chess ", " let's play chess ")) return "chess.open";
  if (board && has(t, " pull up", " bring out", " get out", " open", " show", " set up", " start", " new ", " lets ", " let's ", " want ", " can we ", " could we ", " play")) return "chess.open";
  return null;
}

const SPREAD = [" spread out", " spread apart", " spread yourselves", " don't bunch up", " dont bunch up", " stop bunching", " give each other space", " give each other some space", " split up", " scatter ", " not so close together", " different platforms"];
const TOGETHER = [" stop spreading", " stay together", " stick together", " group up", " regroup", " bunch up", " come together", " no more spreading"];
const JUMPY = [" more jumpy", " be jumpy", " jumpier", " jump more", " jump around more", " hop around", " hop more", " more jumping", " bouncier", " more bouncy", " jump between platforms", " jump between the platforms", " jump around a lot", " lots of jumping", " be more bouncy", " get jumpy", " become jumpy", " become jumping", " start jumping", " jump around", " jumpy mode", " jumping mode", " jump on the platforms", " jump on platforms", " jump from platform", " make them jumpy", " make them jump"];
/** "jump"/"spread" alone only count with something that makes it a request. */
const JUMP_WORDS = [" jumpy", " jumping", " jump ", " hop ", " hopping", " bouncy", " bouncing"];
const SPREAD_WORDS = [" spread", " apart", " scatter", " more space", " some space"];
const REQUEST_CUES = [" be ", " become ", " get ", " start ", " more ", " mode", " you", " them", " everyone", " guys", " girls", " please", " can ", " could ", " let's ", " lets ", " go ", " make ", " all "];
const GROUNDED = [" stay grounded", " stay on the ground", " keep to the ground", " stay on the floor", " jump less", " less jumpy", " stop jumping so much", " no more jumping", " fewer jumps", " less jumping", " feet on the ground", " stop all the jumping", " quit jumping", " stop jumping around"];
const RESET = [" reset your movement", " reset the movement", " reset movement", " reset your behavior", " reset your behaviour", " reset behavior", " reset behaviour", " normal movement", " move normally", " default movement", " default behavior", " default behaviour", " back to normal movement", " act normal", " behave normally", " movement back to normal", " normal behavior", " normal behaviour"];
const HANGOUT_PLACE = [" platform", " ledge", " hangout", " hang out spot", " hangout spot"];
const HANGOUT_VERB = [" watch from", " watch on", " go watch", " hang out", " hangout", " chill on", " chill out on", " sit on", " sit up on", " go sit", " cuddle on", " relax on", " stay on", " go to", " head to", " pick a hangout", " choose a hangout", " watch mode", " be your hangout", " as your hangout", " as the hangout"];
const UNWATCH = [" stop watching", " stop hanging out", " leave the platform", " leave the hangout", " get off the platform", " come down from the platform", " no more hangout", " stop the hangout", " forget the hangout", " clear the hangout", " no hangout"];

/** Movement-mode requests; ordinary chatter (no mode words) never matches. */
export function behaviorIntent(t: string): { id: ActionId; which?: string } | null {
  if (!addressed(t)) return null;
  if (has(t, ...RESET)) return { id: "behavior.reset" };
  if (has(t, ...UNWATCH)) return { id: "behavior.unwatch" };
  if (has(t, ...HANGOUT_PLACE) && has(t, ...HANGOUT_VERB) && !has(t, " edit", " draw", " delete", " remove", " clear all", " setting", " preference")) {
    const which = t.trim().slice(0, 58);
    return { id: "behavior.watch", which };
  }
  // Spread first: "don't bunch up" also contains "bunch up".
  if (has(t, ...SPREAD)) return { id: "behavior.spread" };
  if (has(t, ...TOGETHER)) return { id: "behavior.together" };
  if (has(t, ...GROUNDED)) return { id: "behavior.grounded" };
  if (has(t, ...JUMPY)) return { id: "behavior.jumpy" };
  const cue = has(t, ...REQUEST_CUES);
  if (cue && has(t, ...SPREAD_WORDS) && !has(t, " butter", " news", " word ")) return { id: "behavior.spread" };
  if (cue && has(t, ...JUMP_WORDS) && !has(t, " jump scare", " jumpscare", " jump rope")) return { id: "behavior.jumpy" };
  return null;
}

function poseFrom(t: string): IdlePoseName | "next" {
  if (has(t, " sit", " seated")) return t.includes(" swing") ? "swingLegs" : "sit";
  if (has(t, " swing")) return "swingLegs";
  if (has(t, " wave", " waving")) return "wave";
  if (has(t, " nap", " sleep", " doze")) return "nap";
  if (has(t, " look around", " looking around", " glance")) return "lookAround";
  if (has(t, " stand")) return "stand";
  return "next";
}

/** macOS System Settings panes, by the words people use for them (first match wins). */
const MAC_PANES: readonly [string, readonly string[], string][] = [
  ["screen-recording", [" screen recording", " screen capture", " screen sharing permission"], "Screen Recording"],
  ["microphone", [" microphone", " mic permission", " mic access"], "Microphone"],
  ["speech", [" speech recognition", " dictation permission"], "Speech Recognition"],
  ["camera", [" camera"], "Camera"],
  ["location", [" location"], "Location Services"],
  ["accessibility-privacy", [" accessibility permission", " accessibility access"], "Accessibility (privacy)"],
  ["privacy", [" privacy", " security", " permissions"], "Privacy & Security"],
  ["wifi", [" wifi", " wi-fi", " wi fi", " wireless", " internet connection"], "Wi-Fi"],
  ["bluetooth", [" bluetooth", " airpods", " headphones"], "Bluetooth"],
  ["network", [" network", " vpn", " ethernet"], "Network"],
  ["sound", [" sound", " volume", " audio output", " speakers", " audio input"], "Sound"],
  ["displays", [" display", " monitor", " brightness", " resolution", " night shift"], "Displays"],
  ["wallpaper", [" wallpaper", " desktop background", " background picture"], "Wallpaper"],
  ["appearance", [" appearance", " dark mode", " light mode", " accent colour", " accent color"], "Appearance"],
  ["desktop-dock", [" dock", " desktop and dock", " mission control", " hot corners", " stage manager"], "Desktop & Dock"],
  ["control-center", [" control center", " control centre", " menu bar"], "Control Center"],
  ["notifications", [" notification"], "Notifications"],
  ["focus", [" focus", " do not disturb"], "Focus"],
  ["screen-time", [" screen time"], "Screen Time"],
  ["battery", [" battery", " power", " energy", " low power"], "Battery"],
  ["keyboard", [" keyboard", " shortcuts", " key repeat", " input source"], "Keyboard"],
  ["trackpad", [" trackpad", " gestures"], "Trackpad"],
  ["mouse", [" mouse"], "Mouse"],
  ["accessibility", [" accessibility", " zoom", " voiceover"], "Accessibility"],
  ["software-update", [" software update", " update macos", " update my mac", " os update"], "Software Update"],
  ["storage", [" storage", " disk space"], "Storage"],
  ["users", [" users", " accounts", " login items"], "Users & Groups"],
  ["lock-screen", [" lock screen", " screen saver", " screensaver"], "Lock Screen"],
  ["general", [" general", " about this mac", " sharing", " airdrop", " date and time", " language"], "General"],
];

export const MAC_PANE_LABEL: Record<string, string> = Object.fromEntries([["main", "System Settings"], ...MAC_PANES.map(([id, , label]) => [id, label])]);

/** Which System Settings pane a request is about, or null if it isn't about the Mac's settings. */
export function macPane(text: string): string | null {
  const t = norm(text);
  // "your settings" / "companion settings" are the app's own.
  if (has(t, " your settings", " your options", " companion settings", " app settings", " your preferences")) return null;
  const explicit = has(t, " mac", " macos", " system settings", " system preferences", " computer settings", " os settings");
  const wants = has(t, " settings", " preferences", " setting ", " take me", " go to", " open ", " where can i", " where do i", " how do i change", " show me", " permission");
  if (!explicit && !wants) return null;
  for (const [id, words] of MAC_PANES) if (has(t, ...words)) return explicit || wants ? id : null;
  return explicit ? "main" : null;
}

/** A roster character named in the text. */
export function characterIn(t: string): CharacterId | null {
  if (t.includes(" princess")) return "princess";
  if (t.includes(" party girl") || t.includes(" partygirl")) return "partygirl";
  if (t.includes(" nurse")) return "nurse";
  if (t.includes(" zoologist") || t.includes(" fox girl") || t.includes(" foxgirl")) return "zoologist";
  if (t.includes(" goblin")) return "goblin";
  if (t.includes(" original companion") || t.includes(" terrarian") || t.includes(" the original")) return "terrarian";
  return null;
}

/** Best inventory item for a spoken name ("my pickaxe" → the strongest pickaxe). */
export function itemFor(name: string, weapons: readonly WeaponDef[] = WEAPONS): WeaponDef | null {
  const t = norm(name);
  if (has(t, " pickaxe", " pick ", " pick axe", " mining tool")) {
    const picks = weapons.filter((w) => isPickaxe(w));
    return picks.sort((a, b) => pickaxePower(b) - pickaxePower(a))[0] ?? null;
  }
  const words = t.trim().split(" ").filter((w) => !["my", "the", "a", "an", "me", "your", "her", "please"].includes(w));
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const query = flat(words.join(""));
  if (query.length < 3) return null;
  let best: WeaponDef | null = null;
  let score = 0;
  for (const w of weapons) {
    const n = flat(w.name);
    const s = n === query ? 3 : n.includes(query) || query.includes(n) ? 2 : words.some((x) => x.length > 3 && n.includes(flat(x))) ? 1 : 0;
    if (s > score) {
      best = w;
      score = s;
    }
  }
  return best;
}

export type Parsed = { kind: "action"; action: Action } | { kind: "clarify"; question: string; options: Action[] } | null;

/**
 * Natural-language → action for common phrasings. Returns null when the text isn't (clearly) a
 * companion command; the router may then ask the local model.
 */
export function parseCommand(text: string): Parsed {
  // The Mac's own settings, including "where can I change my wallpaper?"-style questions.
  const pane = macPane(text);
  if (pane) return { kind: "action", action: { id: "macos.open", args: { pane } } };
  // "How about a game of chess?" is an invitation, not a question about chess.
  if (/^ (how about|what about) /.test(norm(text)) && chessIntent(norm(text)) === "chess.open") return { kind: "action", action: { id: "chess.open" } };
  // Homework and study help ("explain this question" too, before it reads as a general question):
  // she tutors on a chalkboard; you still choose and write.
  if (studyIntent(norm(text))) return { kind: "action", action: { id: "study.help" } };
  if (isInfoQuestion(text)) return null;
  const t = norm(text);
  const act = (id: ActionId, args?: Record<string, string>): Parsed => ({ kind: "action", action: args ? { id, args } : { id } });

  // Chess and movement modes come before the destructive rules ("reset your movement" isn't
  // "clear the platforms") and before platform editing ("hang out on the invisible platform").
  const chess = chessIntent(t);
  if (chess) return act(chess);
  const game = gameIntent(t);
  if (game) return act(game);
  const world = worldIntent(t);
  if (world) return act(world);
  const mode = behaviorIntent(t);
  if (mode) return mode.which ? act(mode.id, { which: mode.which }) : act(mode.id);

  // Destructive / privacy first (most specific wording).
  if (has(t, " clear ", " remove all ", " delete all ", " get rid of all ", " reset ")) {
    if (has(t, " block")) return act("blocks.clear");
    if (has(t, " platform", " lines ")) return act("lines.clear");
    if (has(t, " affection", " relationship", " how close", " love meter")) return act("affection.reset");
  }
  if (has(t, " screen") && has(t, " awareness", " understanding", " screenshot", " look at my screen", " see my screen", " ask about my screen")) {
    if (offish(t) || has(t, " don't look", " dont look", " stop looking")) return act("screen.off");
    if (onish(t) || has(t, " allow ")) return act("screen.on");
  }

  // Control scheme before control mode ("silksong controls" isn't "control mode").
  if (has(t, " silksong", " hornet")) return act("scheme.silksong");
  if (has(t, " terraria control", " classic control", " normal control", " terraria scheme")) return act("scheme.terraria");
  if (has(t, " drive her", " drive you", " steer her", " steer you", " move her myself", " move you myself", " play as her", " play as you", " control her myself", " move her around myself", " walk her myself")) return act("control.on");
  if (has(t, " control mode", " character control", " control the character", " control her", " control you", " controlling", " take control", " control character")) {
    return offish(t) && !has(t, " switch me to ", " switch to ") ? act("control.off") : act("control.on");
  }

  if (has(t, " roam", " wander", " walk around", " explore", " move around", " free roam")) return offish(t) && !has(t, " roam mode on") ? act("mode.stay") : act("mode.roam");
  if (has(t, " stop moving", " stay put", " stay still", " stay here", " stand still", " hold still", " don't move", " dont move", " stop walking", " stay mode", " keep still", " freeze in place")) return act("mode.stay");
  if (has(t, " unpause", " resume", " wake up")) return act("pause.off");
  if (has(t, " pause")) return offish(t) ? act("pause.off") : act("pause.on");

  if (has(t, " idle", " pose", " animation")) return act("idle.pose", { pose: poseFrom(t) });
  if (has(t, " sit down", " take a seat", " go to sleep", " take a nap", " have a nap")) return act("idle.pose", { pose: poseFrom(t) });

  // Maps: "switch to the snow map", "make it snow", "back to cherry blossoms".
  if (has(t, " snow map", " snow theme", " winter map", " winter theme", " make it snow", " let it snow", " christmas theme", " christmas map", " switch to snow", " change to snow", " snowy")) return act("map.snow");
  if (has(t, " chess map", " chess theme", " battlefield map", " battlefield theme", " dark map", " dark fantasy", " hollow knight map", " hollow knight theme", " switch to chess")) return act("map.chess");
  if (has(t, " cherry blossom map", " sakura map", " blossom map", " cherry blossom theme", " back to cherry", " switch to cherry", " spring theme", " spring map", " petal map")) return act("map.sakura");
  if (has(t, " petal", " blossom fall", " sakura fall", " snow", " snowflake")) {
    if (has(t, " faster", " speed up", " quicker")) return act("petals.faster");
    if (has(t, " slower", " slow down", " gentler")) return act("petals.slower");
    if (has(t, " down", " less", " fewer", " reduce", " lower", " tone down", " not so many", " too many")) return act("petals.less");
    if (has(t, " more", " up ", " increase", " lots of", " heavier")) return act("petals.more");
    if (offish(t) || has(t, " no petals", " hide")) return act("petals.off");
    return act("petals.on");
  }
  if (has(t, " cherry blossom theme", " sakura theme", " desktop theme", " theme ")) return offish(t) ? act("theme.off") : act("theme.on");

  if (has(t, " bubble", " speech balloon")) {
    if (has(t, " less pink", " paler", " lighter", " not so pink", " too pink", " whiter")) return act("bubble.paler");
    if (has(t, " pink", " cuter")) return act("bubble.pinker");
  }

  // Roster: "switch to Ryuko", "bring out the goblin girl", "send Satsuki away".
  const who = characterIn(t);
  if (who) {
    if (has(t, " dismiss", " send ", " away", " go home", " leave", " remove", " hide ")) return act("character.dismiss", { name: who });
    if (has(t, " control", " switch to", " switch me to", " play as", " select", " be ", " swap to", " change to")) return act("character.select", { name: who });
    if (has(t, " summon", " bring", " call ", " add ", " show ", " come out", " invite", " spawn")) return act("character.summon", { name: who });
  }
  if (has(t, " queen bee")) return offish(t) || has(t, " dismiss") ? act("boss.dismiss") : act("boss.queen");
  if (has(t, " moon lord")) return offish(t) || has(t, " dismiss", " send away") ? act("boss.dismiss") : act("boss.moon");
  if (has(t, " eye of cthulhu", " eoc ")) return offish(t) || has(t, " dismiss") ? act("boss.dismiss") : act("boss.eye");
  if (has(t, " boss") && has(t, " dismiss", " send away", " get rid", " stop", " end ")) return act("boss.dismiss");
  if (has(t, " training", " dummies", " dummy")) return offish(t) ? act("training.off") : act("training.on");
  if (has(t, " build mode", " building mode", " place blocks", " build something")) return offish(t) ? act("build.off") : act("build.on");
  if (has(t, " invisible platform", " platform edit", " edit platforms", " draw platforms", " platform mode")) return offish(t) ? act("lines.off") : act("lines.on");
  if (has(t, " cookie") && !has(t, " recipe", " bake ", " how to ")) return act("cookie.give");

  if (has(t, " settings", " preferences", " options", " config")) {
    const tab = has(t, " character", " appearance", " outfit") ? "character" : has(t, " map", " theme") ? "maps" : has(t, " awareness", " privacy") ? "awareness" : has(t, " item", " inventory") ? "items" : "companion";
    return act("settings.open", { tab });
  }
  if (has(t, " inventory", " backpack", " your items")) return act("inventory.open");
  if (has(t, " open chat", " open the chat", " chat window")) return act("chat.open");

  if (has(t, " unmute", " sound on", " turn your sound on", " turn the sound on")) return act("sound.unmute");
  if (has(t, " mute", " sound off", " silence your", " be silent")) return act("sound.mute");
  if (has(t, " smaller", " tiny", " small ")) return act("size.small");
  if (has(t, " bigger", " larger", " big ", " large ")) return act("size.large");
  if (has(t, " normal size", " medium size", " medium ")) return act("size.medium");

  if (has(t, " talk on your own", " spontaneous", " chatter", " random comments", " talk less", " stop talking", " be quiet", " talk more", " say things on your own")) {
    return has(t, " stop", " less", " quiet", " off", " disable", " no ") ? act("chatter.off") : act("chatter.on");
  }
  if (has(t, " personality", " cutesy", " less cute", " more cute", " extra cute", " tone it down")) {
    if (has(t, " less", " tone it down", " subtle", " calmer", " normal person")) return act("personality.subtle");
    if (has(t, " more", " extra", " strong", " cuter", " max")) return act("personality.strong");
    return act("personality.normal");
  }
  if (has(t, " hide yourself", " go away for now", " disappear", " hide from my screen")) return act("companion.hide");

  // Equip: "give me my pickaxe", "equip zenith", "switch to the needle".
  const m = t.match(/ (?:give me|equip|wield|hold|take out|pull out|switch to|use|grab|hand me|get out) (?:my |the |a |an |your )?(.+?) $/);
  if (m) {
    const item = itemFor(m[1]);
    if (item) return act("equip", { item: item.id });
  }
  if (has(t, " turn it off", " turn that off", " turn it on", " change it", " switch it")) {
    return { kind: "clarify", question: "Which one should I change?", options: [] };
  }
  return null;
}

/** Words that show a request really is about an action family (guards the local model's picks). */
const FAMILY_WORDS: Record<string, readonly string[]> = {
  control: ["control", "drive", "steer", "myself", "play as", "keyboard"],
  scheme: ["silksong", "terraria", "scheme", "controls"],
  mode: ["roam", "wander", "explore", "walk", "on her own", "by herself", "stay", "still", "stop moving", "move"],
  pause: ["pause", "freeze", "resume"],
  idle: ["idle", "pose", "animation", "sit", "stand", "wave", "nap", "sleep"],
  petals: ["petal", "flower", "blossom", "sakura", "falling", "snow"],
  map: ["map", "theme", "snow", "winter", "cherry", "blossom", "sakura", "christmas", "battlefield", "dark fantasy"],
  theme: ["theme", "blossom", "sakura", "decoration"],
  equip: ["equip", "give", "hold", "use", "weapon", "pickaxe", "sword", "item"],
  settings: ["setting", "preference", "option"],
  inventory: ["inventory", "items", "backpack"],
  chat: ["chat"],
  bubble: ["bubble", "speech", "balloon"],
  boss: ["boss", "moon lord", "eye of cthulhu", "queen bee", "fight", "summon"],
  character: ["princess", "party girl", "nurse", "zoologist", "fox", "goblin", "character", "girl", "companion", "her", "summon", "dismiss", "switch"],
  training: ["training", "dummy", "dummies", "practice", "practise"],
  build: ["build", "block"],
  lines: ["platform", "line"],
  cookie: ["cookie", "snack", "treat", "feed"],
  companion: ["hide", "disappear", "go away"],
  sound: ["mute", "sound", "quiet", "volume"],
  size: ["size", "small", "big", "large", "tiny", "bigger", "smaller"],
  chatter: ["talk", "chatter", "quiet", "spontaneous", "comments"],
  personality: ["personality", "cute", "cutesy", "tone"],
  screen: ["screen", "screenshot"],
  macos: ["mac", "system", "settings", "preferences", "wifi", "wi-fi", "bluetooth", "display", "wallpaper", "sound", "battery", "keyboard", "trackpad", "privacy", "notification", "permission"],
  blocks: ["block"],
  affection: ["affection", "relationship"],
  chess: ["chess"],
  world: ["world", "terrain", "background", "map"],
  behavior: ["spread", "jump", "hop", "ground", "platform", "hang out", "hangout", "watch", "together", "movement", "behavior", "behaviour"],
};

/** Does the request contain words that match this action's family? */
/**
 * Movement modes are checked per action, not per family: a request mentioning "jump" must not
 * let the model pick "hang out on a platform" without asking (that sent everyone to a corner).
 */
const ACTION_WORDS: Partial<Record<ActionId, readonly string[]>> = {
  "behavior.spread": ["spread", "apart", "scatter", "space", "bunch"],
  "behavior.together": ["together", "group", "regroup", "bunch"],
  "behavior.jumpy": ["jump", "hop", "bouncy", "bounce"],
  "behavior.grounded": ["ground", "floor", "jump less", "less jump", "stop jump"],
  "behavior.watch": ["hang out", "hangout", "watch from", "platform", "ledge"],
  "behavior.unwatch": ["hang out", "hangout", "platform", "come down", "stop watching"],
  "behavior.reset": ["reset", "normal", "default"],
};

export function clearlyAbout(text: string, id: ActionId): boolean {
  const t = norm(text);
  const words = ACTION_WORDS[id] ?? FAMILY_WORDS[id.split(".")[0]] ?? [];
  return words.some((w) => t.includes(w));
}

/** Validate an action proposed by the local model (unknown ids or bad args are rejected). */
export function validateAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { action?: unknown; args?: unknown };
  if (typeof r.action !== "string" || !(ACTION_IDS as string[]).includes(r.action)) return null;
  const id = r.action as ActionId;
  const args: Record<string, string> = {};
  if (r.args && typeof r.args === "object") for (const [k, v] of Object.entries(r.args as object)) if (typeof v === "string" && v.length < 60) args[k] = v;
  if (id === "idle.pose" && args.pose && !(IDLE_POSES as readonly string[]).includes(args.pose) && args.pose !== "next") args.pose = poseFrom(norm(args.pose));
  if (id === "equip") {
    const item = itemFor(args.item ?? "");
    if (!item) return null;
    args.item = item.id;
  }
  if (id === "settings.open" && !["companion", "character", "maps", "items", "awareness"].includes(args.tab ?? "")) args.tab = "companion";
  if (id === "macos.open") args.pane = MAC_PANE_LABEL[args.pane ?? ""] ? args.pane! : (macPane(` open ${args.pane ?? ""} settings `) ?? "main");
  if (id === "behavior.watch") args.which = (args.which ?? "pick").slice(0, 58);
  if (id.startsWith("character.")) {
    const who = characterIn(` ${(args.name ?? "").toLowerCase()} `);
    if (!who) return null;
    args.name = who;
  }
  return Object.keys(args).length ? { id, args } : { id };
}

// ── Execution ──────────────────────────────────────────────────────────────────────────────

/** What the executor may touch (the real bridge in the app, fakes in tests). */
export interface ActionDeps {
  getPrefs: () => Promise<Prefs>;
  patchPrefs: (patch: PrefsPatch) => Promise<unknown>;
  getControlMode: () => Promise<boolean>;
  setControlMode: (on: boolean) => Promise<unknown>;
  getBuildMode: () => Promise<boolean>;
  setBuildMode: (on: boolean) => Promise<unknown>;
  getLinesMode: () => Promise<boolean>;
  setLinesMode: (on: boolean) => Promise<unknown>;
  combat: (action: string) => Promise<unknown>;
  showSettings: (tab?: string) => Promise<unknown>;
  showInventory: () => Promise<unknown>;
  showChat: () => Promise<unknown>;
  /** Open a macOS System Settings pane (validated in Rust); resolves false if unknown. */
  openSystemSettings?: (pane: string) => Promise<boolean>;
  /** Start / stop the background-world game (refused without Accessibility permission). */
  startGame?: (mode: "player" | "auto") => Promise<{ ok: boolean; blocked: number; needsAccessibility?: boolean }>;
  /** Accessibility permission: exploring and playing need it (the world is under the desktop icons). */
  accessibility?: () => Promise<boolean>;
  stopGame?: () => Promise<unknown>;
}

const NEEDS_ACCESSIBILITY =
  "The world lives under your desktop icons now, so I need Accessibility permission to give it your clicks and keys. Turn on Terraria Companion CJ Ver in System Settings → Privacy & Security → Accessibility (Maps settings has a button).";

export interface ActionResult {
  ok: boolean;
  /** What actually happened, in her voice. Never claims success unless verified. */
  message: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The confirmation question for an action that needs one, or null. */
/** "Did you mean…?" for a model-picked action whose wording didn't clearly match. */
export function didYouMean(a: Action): string {
  return `Did you mean I should ${CATALOG[a.id].describe.replace(/;.*$/, "")}? (yes / no)`;
}

export function confirmationFor(a: Action): string | null {
  const c = CATALOG[a.id].confirm;
  return c ? `Just to confirm: should I ${c}? (yes / no)` : null;
}

export function isYes(text: string): boolean | null {
  const t = norm(text);
  if (/^ (yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|confirm|y|of course|absolutely) /.test(t)) return true;
  if (/^ (no|nope|nah|cancel|don't|dont|stop|never mind|nevermind|n) /.test(t)) return false;
  return null;
}

/** Perform an action and verify it. */
export async function executeAction(a: Action, d: ActionDeps): Promise<ActionResult> {
  const fail = (what: string): ActionResult => ({ ok: false, message: `I tried to ${what}, but it didn't take. You can change it in my settings.` });
  try {
    const before = await d.getPrefs();
    // Patch prefs, then read them back and check `check` holds.
    const patchAndVerify = async (patch: PrefsPatch, check: (p: Prefs) => boolean, done: string, what: string): Promise<ActionResult> => {
      await d.patchPrefs(patch);
      const after = await d.getPrefs();
      return check(after) ? { ok: true, message: done } : fail(what);
    };
    const toggle = async (get: () => Promise<boolean>, set: (on: boolean) => Promise<unknown>, on: boolean, done: string, what: string): Promise<ActionResult> => {
      await set(on);
      return (await get()) === on ? { ok: true, message: done } : fail(what);
    };
    const theme = before.theme;
    switch (a.id) {
      case "control.on":
        return toggle(d.getControlMode, d.setControlMode, true, "Okay! You're controlling me now. Press Esc to stop.", "start Control mode");
      case "control.off":
        return toggle(d.getControlMode, d.setControlMode, false, "Alright, I'm moving on my own again.", "leave Control mode");
      case "scheme.silksong":
        return patchAndVerify({ control: { ...before.control, scheme: "silksong" } }, (p) => p.control.scheme === "silksong", "Switched to Silksong controls: dash, double jump and pogo.", "switch to Silksong controls");
      case "scheme.terraria":
        return patchAndVerify({ control: { ...before.control, scheme: "terraria" } }, (p) => p.control.scheme === "terraria", "Back to Terraria controls!", "switch to Terraria controls");
      case "mode.roam":
        return patchAndVerify({ companionMode: "roam", paused: false }, (p) => p.companionMode === "roam" && !p.paused, "Roam mode on! I'll go exploring.", "turn on Roam mode");
      case "mode.stay":
        return patchAndVerify({ companionMode: "stay" }, (p) => p.companionMode === "stay", "Okay, I'll stay right here and be good.", "stay put");
      case "pause.on":
        return patchAndVerify({ paused: true }, (p) => p.paused, "Freezing! ...I'll be a statue until you unpause me.", "pause");
      case "pause.off":
        return patchAndVerify({ paused: false }, (p) => !p.paused, "I can move again! Thanks!", "unpause");
      case "idle.pose": {
        const current = before.idlePose as IdlePoseName;
        let pose = (a.args?.pose ?? "next") as IdlePoseName | "next";
        if (pose === "next") pose = IDLE_POSES[(IDLE_POSES.indexOf(current) + 1) % IDLE_POSES.length];
        // A fixed pose (rotation off), shown while she stays idle.
        const idle = before.idle ? { ...before.idle, mode: "fixed" as const } : undefined;
        return patchAndVerify(
          idle ? { idlePose: pose, idle } : { idlePose: pose },
          (p) => p.idlePose === pose && (p.idle?.mode ?? "fixed") === "fixed",
          `My idle pose is now ${POSE_LABEL[pose]}. Do you like it?`,
          "change my idle pose",
        );
      }
      case "petals.on":
        return patchAndVerify({ theme: { ...theme, enabled: true, petals: true, density: theme.density > 0 ? theme.density : 0.3 } }, (p) => p.theme.enabled && p.theme.petals, "Petals are falling! So pretty.", "turn the petals on");
      case "petals.off":
        return patchAndVerify({ theme: { ...theme, petals: false } }, (p) => !p.theme.petals, "Okay, no more petals for now.", "turn the petals off");
      case "petals.more": {
        const density = round2(clamp(theme.density + 0.15, 0.05, 1));
        return patchAndVerify({ theme: { ...theme, enabled: true, petals: true, density } }, (p) => Math.abs(p.theme.density - density) < 0.01, `More petals! Density is ${Math.round(density * 100)}% now.`, "add more petals");
      }
      case "petals.less": {
        const density = round2(clamp(theme.density - 0.15, 0, 1));
        return patchAndVerify({ theme: { ...theme, density } }, (p) => Math.abs(p.theme.density - density) < 0.01, density === 0 ? "I turned the petals all the way down." : `Turned the petals down to ${Math.round(density * 100)}%.`, "turn the petals down");
      }
      case "petals.faster": {
        const speed = round2(clamp(theme.speed + 0.3, 0.25, 2.5));
        return patchAndVerify({ theme: { ...theme, speed } }, (p) => Math.abs(p.theme.speed - speed) < 0.01, `Petals fall faster now (${speed}×).`, "speed up the petals");
      }
      case "petals.slower": {
        const speed = round2(clamp(theme.speed - 0.3, 0.25, 2.5));
        return patchAndVerify({ theme: { ...theme, speed } }, (p) => Math.abs(p.theme.speed - speed) < 0.01, `Petals drift slower now (${speed}×).`, "slow down the petals");
      }
      case "map.snow":
      case "map.sakura":
      case "map.chess": {
        const map = a.id === "map.snow" ? "snow" : a.id === "map.chess" ? "chess" : "sakura";
        const done = map === "snow" ? "Snow map on." : map === "chess" ? "Chess map on." : "Cherry blossom map on.";
        return patchAndVerify({ theme: { ...theme, enabled: true, map } }, (p) => p.theme.map === map && p.theme.enabled, done, `switch to the ${map === "sakura" ? "cherry blossom" : map} map`);
      }
      case "theme.on":
        return patchAndVerify({ theme: { ...theme, enabled: true } }, (p) => p.theme.enabled, "Cherry blossom theme on!", "turn on the theme");
      case "theme.off":
        return patchAndVerify({ theme: { ...theme, enabled: false } }, (p) => !p.theme.enabled, "Theme off. I'll miss the flowers a little.", "turn off the theme");
      case "equip": {
        const id = a.args?.item ?? "";
        const def = WEAPONS.find((w) => w.id === id);
        const slots = [...(before.inventory ?? [])];
        const index = slots.indexOf(id);
        if (!def || index < 0) return { ok: false, message: `I couldn't find ${def?.name ?? "that"} in your inventory.` };
        const sel = Math.min(Math.max(before.selectedSlot ?? 0, 0), 9);
        let selectedSlot = sel;
        if (index < 10) selectedSlot = index;
        else [slots[index], slots[sel]] = [slots[sel], slots[index]];
        return patchAndVerify({ inventory: slots, selectedSlot }, (p) => p.inventory?.[p.selectedSlot] === id, `Here you go! ${def.name} equipped.`, `equip ${def.name}`);
      }
      case "settings.open":
        await d.showSettings(a.args?.tab ?? "companion");
        return { ok: true, message: "Opening my settings for you!" };
      case "inventory.open":
        await d.showInventory();
        return { ok: true, message: "Here's the inventory!" };
      case "chat.open":
        await d.showChat();
        return { ok: true, message: "Chat window's open. Talk to me!" };
      case "bubble.pinker":
      case "bubble.paler": {
        const v = before.persona.bubblePink;
        const next = round2(clamp(v + (a.id === "bubble.pinker" ? 0.25 : -0.25), 0, 1));
        if (next === v) return { ok: true, message: a.id === "bubble.pinker" ? "My bubble is already as pink as it gets!" : "It's already as pale as it goes." };
        return patchAndVerify({ persona: { ...before.persona, bubblePink: next } }, (p) => Math.abs(p.persona.bubblePink - next) < 0.01, a.id === "bubble.pinker" ? "Bubble colour adjusted." : "Bubble colour adjusted.", "change my bubble colour");
      }
      case "boss.eye":
        await d.combat("summonBoss");
        return { ok: true, message: "The Eye of Cthulhu is coming. Get ready." };
      case "boss.moon":
        await d.combat("summonMoonLord");
        return { ok: true, message: "The Moon Lord is rising... I-I'm right behind you!" };
      case "boss.dismiss":
        await d.combat("dismissBoss");
        return { ok: true, message: "I sent the boss away." };
      case "macos.open": {
        const pane = a.args?.pane ?? "main";
        const label = MAC_PANE_LABEL[pane] ?? "System Settings";
        const ok = d.openSystemSettings ? await d.openSystemSettings(pane) : false;
        return ok ? { ok: true, message: `Opening ${label} in System Settings.` } : { ok: false, message: `I couldn't open ${label} in System Settings.` };
      }
      case "boss.queen":
        await d.combat("summonQueenBee");
        return { ok: true, message: "Queen Bee is coming. Watch out for her charges." };
      case "character.select":
      case "character.summon":
      case "character.dismiss": {
        const who = (a.args?.name ?? "") as CharacterId;
        const chars = before.characters;
        if (!chars || !who) return { ok: false, message: "I'm not sure which character you mean." };
        const label = { princess: "the Princess", partygirl: "Party Girl", nurse: "Nurse", zoologist: "Zoologist", goblin: "Goblin Girl", terrarian: "the original companion" }[who];
        if (a.id === "character.select") {
          const active = chars.active.includes(who) ? chars.active : [...chars.active, who].slice(-4);
          return patchAndVerify({ characters: { ...chars, selected: who, active } }, (p) => p.characters?.selected === who, `Switched to ${label}! Control mode will drive her now.`, `switch to ${label}`);
        }
        if (a.id === "character.summon") {
          if (chars.active.includes(who)) return { ok: true, message: `${label} is already here!` };
          if (chars.active.length >= 4) return { ok: false, message: "There are already four of us on screen. Send someone away first?" };
          return patchAndVerify({ characters: { ...chars, active: [...chars.active, who] } }, (p) => !!p.characters?.active.includes(who), `${label} is on her way!`, `bring ${label} out`);
        }
        if (chars.selected === who) return { ok: false, message: `${label} is the selected character. Switch to someone else first, then I can send her away.` };
        if (!chars.active.includes(who)) return { ok: true, message: `${label} isn't on screen.` };
        return patchAndVerify({ characters: { ...chars, active: chars.active.filter((c) => c !== who) } }, (p) => !p.characters?.active.includes(who), `${label} is heading off. Bye-bye!`, `send ${label} away`);
      }
      case "chess.open":
        await d.combat("openChess");
        return { ok: true, message: "The chess board is out. White moves first; we'll move the pieces for you." };
      case "chess.close":
        await d.combat("closeChess");
        return { ok: true, message: "Packing up the board. Good game." };
      case "chess.flip":
        await d.combat("flipChess");
        return { ok: true, message: "Turning the board around." };
      case "study.help":
        await d.combat("studyHelp");
        return { ok: true, message: "Tutor mode. Draw a box around the question and I'll explain it on the board. You choose the answer yourself." };
      case "behavior.spread":
      case "behavior.together":
      case "behavior.jumpy":
      case "behavior.grounded":
      case "behavior.unwatch":
      case "behavior.reset":
      case "behavior.watch": {
        const chars = before.characters;
        if (!chars) return { ok: false, message: "I can't change how we move right now." };
        const cur = normalizeBehavior(chars.behavior);
        let next: BehaviorPrefs;
        let done: string;
        switch (a.id) {
          case "behavior.spread":
            next = { ...cur, spread: true };
            done = "Okay! We'll spread out a bit and try different platforms.";
            break;
          case "behavior.together":
            next = { ...cur, spread: false };
            done = "Okay, we'll stick together!";
            break;
          case "behavior.jumpy":
            next = { ...cur, jump: "jumpy" };
            done = "Boing! More jumping between platforms, coming up!";
            break;
          case "behavior.grounded":
            next = { ...cur, jump: "grounded" };
            done = "Got it, we'll keep our feet on the ground.";
            break;
          case "behavior.unwatch":
            if (!cur.watch) return { ok: true, message: "We weren't on a platform." };
            next = { ...cur, watch: null };
            done = "Okay, we'll come down and roam again.";
            break;
          case "behavior.reset":
            next = { ...DEFAULT_BEHAVIOR };
            done = "Back to our normal moving around!";
            break;
          default: {
            const lines = sanitizeLines(before.lines?.items);
            if (!lines.length) return { ok: false, message: "There aren't any invisible platforms yet. Draw one in platform edit mode first." };
            const which = hangoutFromSpeech(a.args?.which ?? "", lines);
            if (which === "pick") {
              await d.combat("pickHangout");
              return { ok: true, message: `Which one? Click one of the numbered platforms (there ${lines.length === 1 ? "is 1" : `are ${lines.length}`}).` };
            }
            if (which === null) return { ok: false, message: `I can't find that one. There ${lines.length === 1 ? "is only platform 1" : `are platforms 1 to ${lines.length}`}.` };
            next = { ...cur, watch: lines[which] };
            done = `Platform ${which + 1} it is! We'll go hang out there.`;
          }
        }
        const same = (p: Prefs) => JSON.stringify(normalizeBehavior(p.characters?.behavior)) === JSON.stringify(next);
        return patchAndVerify({ characters: { ...chars, behavior: next } }, same, done, "change how we move");
      }
      case "world.show":
      case "world.hide":
      case "world.explore": {
        const w = before.world ?? { enabled: false, seed: 0, zoom: 2, cameraX: -1, cameraY: -1, edit: false, collide: true };
        if (a.id === "world.explore") {
          if (d.accessibility && !(await d.accessibility().catch(() => true))) return { ok: false, message: NEEDS_ACCESSIBILITY };
          await d.combat("exploreWorld");
          return { ok: true, message: "Exploring! Drag or scroll to look around the world, and press Esc when you're done." };
        }
        const on = a.id === "world.show";
        return patchAndVerify({ world: { ...w, enabled: on } }, (p) => !!p.world?.enabled === on, on ? "Here's our Terraria world, behind your windows! Say \"explore the world\" to look around." : "Okay, the world's tucked away.", on ? "show the world" : "hide the world");
      }
      case "game.play":
      case "game.auto": {
        if (!d.startGame) return { ok: false, message: "I can't start the game from here. Try World settings in the inventory." };
        const r = await d.startGame(a.id === "game.auto" ? "auto" : "player");
        if (!r.ok) return { ok: false, message: r.needsAccessibility ? NEEDS_ACCESSIBILITY : "The game wouldn't start. Try World settings in the inventory." };
        return { ok: true, message: a.id === "game.auto" ? "Leave it to us. We'll build you a house." : "Into the world. Lead the way." };
      }
      case "game.stop":
        if (!d.stopGame) return { ok: false, message: "I can't stop the game from here." };
        await d.stopGame();
        return { ok: true, message: "Back to the desktop! That was fun." };
      case "training.on":
        return patchAndVerify({ training: true }, (p) => p.training, "Training dummies are up! Let's practise.", "start training");
      case "training.off":
        return patchAndVerify({ training: false }, (p) => !p.training, "Training's over. Good work!", "stop training");
      case "build.on":
        return toggle(d.getBuildMode, d.setBuildMode, true, "Build mode on! Click to place blocks; Esc when you're done.", "start Build mode");
      case "build.off":
        return toggle(d.getBuildMode, d.setBuildMode, false, "Build mode off.", "stop Build mode");
      case "lines.on":
        return toggle(d.getLinesMode, d.setLinesMode, true, "Platform editing on! Drag to draw a line I can stand on.", "start platform editing");
      case "lines.off":
        return toggle(d.getLinesMode, d.setLinesMode, false, "Done editing platforms.", "stop platform editing");
      case "cookie.give":
        await d.combat("spawnCookie");
        return { ok: true, message: "A cookie! Drag it to me, pretty please?" };
      case "companion.hide":
        return patchAndVerify({ visible: false }, (p) => !p.visible, "Okay... I'll hide. Bring me back from the menu bar anytime!", "hide");
      case "sound.mute":
        return patchAndVerify({ audio: { ...before.audio, muted: true } }, (p) => p.audio.muted, "Shh, I'm muted now.", "mute my sounds");
      case "sound.unmute":
        return patchAndVerify({ audio: { ...before.audio, muted: false } }, (p) => !p.audio.muted, "Sound's back on!", "unmute my sounds");
      case "size.small":
      case "size.medium":
      case "size.large": {
        const scale = a.id === "size.small" ? 2 : a.id === "size.medium" ? 3 : 4;
        return patchAndVerify({ scale }, (p) => p.scale === scale, a.id === "size.small" ? "Smaller size set." : a.id === "size.large" ? "Larger size set." : "Back to my normal size.", "resize myself");
      }
      case "chatter.on":
        return patchAndVerify({ persona: { ...before.persona, spontaneous: true } }, (p) => p.persona.spontaneous, "Understood. I'll check in now and then.", "turn on my chatter");
      case "chatter.off":
        return patchAndVerify({ persona: { ...before.persona, spontaneous: false } }, (p) => !p.persona.spontaneous, "Okay, I'll stay quiet unless you talk to me.", "turn off my chatter");
      case "personality.subtle":
      case "personality.normal":
      case "personality.strong": {
        const intensity = a.id.split(".")[1] as Prefs["persona"]["intensity"];
        return patchAndVerify({ persona: { ...before.persona, intensity } }, (p) => p.persona.intensity === intensity, intensity === "strong" ? "Understood. More personality." : intensity === "subtle" ? "Understood. I'll keep it brief." : "Back to the standard tone.", "change my personality");
      }
      case "screen.on":
        return patchAndVerify({ awareness: { ...before.awareness, screenEnabled: true } }, (p) => p.awareness.screenEnabled, "Okay! When you ask about your screen, I'll take one screenshot for that question only. macOS may still ask you for Screen Recording permission.", "allow screen questions");
      case "screen.off":
        return patchAndVerify({ awareness: { ...before.awareness, screenEnabled: false } }, (p) => !p.awareness.screenEnabled, "Got it, no more screenshots.", "turn off screen questions");
      case "blocks.clear":
        return patchAndVerify({ build: { ...before.build, blocks: [] } }, (p) => p.build.blocks.length === 0, "All the blocks are gone.", "clear the blocks");
      case "lines.clear":
        return patchAndVerify({ lines: { ...before.lines, items: [] } }, (p) => p.lines.items.length === 0, "All the invisible platforms are deleted.", "delete the platforms");
      case "affection.reset":
        return patchAndVerify({ affection: { value: 30, updated: Date.now(), cookies: before.affection.cookies } }, (p) => Math.abs(p.affection.value - 30) < 0.01, "Understood. Starting fresh. Pleased to meet you.", "reset the affection meter");
    }
  } catch (e) {
    return { ok: false, message: `Something went wrong while I tried that (${e instanceof Error ? e.message : String(e)}). Nothing was changed on purpose.` };
  }
}
