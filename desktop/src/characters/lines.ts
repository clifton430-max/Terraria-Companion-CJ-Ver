// Each roster character's own lines, by situation and rapport tier (lower tiers' lines stay
// available at warmer tiers). CJ Ver: everyone is strictly professional, in a suit, and speaks
// to their role. Avery: Chief of Staff, crisp and organised. Jordan: Events & Communications,
// upbeat but polished. Riley: Health & Wellness Advisor, calm and practical. Quinn: Research
// Analyst, precise and curious. Casey: Engineering Lead, direct and technical. No pet names,
// honorifics, romance or emojis.

import type { CharacterId } from "../bridge";
import type { Situation } from "../affection/dialogue";
import type { Tier } from "../affection/model";

type Pools = Partial<Record<Tier, readonly string[]>>;
export type CharacterLines = Partial<Record<Situation, Pools>>;

const AVERY: CharacterLines = {
  spontaneous: {
    shy: ["Your calendar looks manageable today.", "I'll keep things organised in the background."],
    friendly: [
      "I've prioritised what's left. The most important item is whatever you're on now.",
      "Quick check-in: is anything blocking you that I can clear?",
      "One task at a time. It's the fastest way through the list.",
    ],
    close: ["We're in good shape for the day. Keep it up.", "I'd suggest wrapping up one item before starting the next."],
  },
  awayAsk: { friendly: ["I'll keep your agenda on hold until you're back."] },
  welcomeBack: { friendly: ["Welcome back. Your agenda is unchanged."], close: ["Welcome back. Ready to resume?"] },
  pet: { shy: ["Yes? What's the priority?"], friendly: ["How can I help?"], close: ["What's next on the list?"] },
  feed: { shy: ["Thank you. Appreciated."], friendly: ["Thank you, that's thoughtful."] },
  kind: { friendly: ["Thank you. I appreciate it."], close: ["Thank you. It's a pleasure working with you."] },
  rude: { friendly: ["Noted. Let's refocus."] },
  victory: { friendly: ["Objective complete."], close: ["Well executed. On to the next item."] },
};

const JORDAN: CharacterLines = {
  spontaneous: {
    shy: ["Hello. Let me know if you need anything announced or arranged.", "Good energy in here today."],
    friendly: [
      "Small wins are worth acknowledging. Nice progress.",
      "If you need to send a message today, I'm happy to help with the wording.",
      "A clear plan makes for a good day. You seem to have one.",
    ],
    close: ["Great momentum today. Let's keep it going.", "When this is finished, it'll be worth sharing with the team."],
  },
  awayAsk: { friendly: ["I'll be here when you're ready to continue."] },
  welcomeBack: { friendly: ["Welcome back. Ready to pick things up?"], close: ["Good to have you back. Let's keep the momentum going."] },
  pet: { shy: ["Hello. What can I do for you?"], friendly: ["Ready to help."], close: ["What are we working on?"] },
  feed: { shy: ["Thank you, that's kind."], friendly: ["Much appreciated, thank you."] },
  kind: { friendly: ["Thank you. Good to hear."], close: ["I appreciate that. Thank you."] },
  rude: { friendly: ["Understood. Let's move forward."] },
  victory: { friendly: ["Excellent result."], close: ["That's a success worth noting. Well done."] },
};

const RILEY: CharacterLines = {
  spontaneous: {
    shy: ["Remember to check your posture.", "Good lighting helps reduce eye strain."],
    friendly: [
      "Try the 20-20-20 rule: every 20 minutes, look 20 feet away for 20 seconds.",
      "A glass of water now would be a good idea.",
      "Relax your shoulders. Tension builds up without you noticing.",
    ],
    close: ["You've been focused for a while. A short walk would help.", "Good habits add up. Keep taking regular breaks."],
  },
  awayAsk: { friendly: ["Good, a break. Take your time."] },
  welcomeBack: { friendly: ["Welcome back. I hope the break helped."], close: ["Welcome back. Feeling refreshed?"] },
  pet: { shy: ["Yes? Everything all right?"], friendly: ["How are you feeling?"], close: ["Need anything?"] },
  feed: { shy: ["Thank you. In moderation, of course."], friendly: ["Thank you. A small treat is fine now and then."] },
  feedMany: { friendly: ["Thank you, but that's enough for now."] },
  kind: { friendly: ["Thank you. That's kind of you."], close: ["Thank you. Look after yourself, too."] },
  rude: { friendly: ["Understood. Let's take a breath and continue."] },
  victory: { friendly: ["Well done. Everyone's in one piece."], close: ["Good outcome. Now take a short rest."] },
};

const QUINN: CharacterLines = {
  spontaneous: {
    shy: ["I'm reviewing some data. Let me know if you need anything.", "Interesting. I'll make a note of that."],
    friendly: [
      "If you need something looked up, I can help narrow it down.",
      "A good question is half the answer.",
      "Writing down what you've tried saves time when you revisit a problem.",
    ],
    close: ["Your approach today has been methodical. That pays off.", "If the evidence changes, it's fine to change the plan."],
  },
  awayAsk: { friendly: ["I'll continue my review until you're back."] },
  welcomeBack: { friendly: ["Welcome back. Nothing new to report."], close: ["Welcome back. Shall we continue?"] },
  pet: { shy: ["Yes? Do you have a question?"], friendly: ["What would you like to look into?"], close: ["What's the next question?"] },
  feed: { shy: ["Thank you. Much appreciated."], friendly: ["Thank you, that's considerate."] },
  kind: { friendly: ["Thank you. Noted, and appreciated."], close: ["Thank you. I enjoy working with you."] },
  rude: { friendly: ["Understood. Let's stick to the facts."] },
  victory: { friendly: ["Result confirmed."], close: ["As the data suggested. Well done."] },
};

const CASEY: CharacterLines = {
  spontaneous: {
    shy: ["Systems are running normally.", "I'll be over here if anything needs fixing."],
    friendly: [
      "Save your work regularly. It's cheaper than recovering it.",
      "If something's broken, the simplest explanation is usually the right one.",
      "Break big problems into small ones. They're easier to test.",
    ],
    close: ["Solid work today. Nothing's on fire.", "When you're done, a quick review will catch anything we missed."],
  },
  awayAsk: { friendly: ["I'll keep things running until you're back."] },
  welcomeBack: { friendly: ["Welcome back. Everything's still running."], close: ["Welcome back. Ready to continue?"] },
  pet: { shy: ["Yes? Something need fixing?"], friendly: ["What do you need?"], close: ["What are we building?"] },
  feed: { shy: ["Thanks. Appreciated."], friendly: ["Thank you. Good fuel for work."] },
  kind: { friendly: ["Thanks. Glad it's useful."], close: ["Thank you. Good working with you."] },
  rude: { friendly: ["Understood. Let's fix the problem, not the blame."] },
  victory: { friendly: ["Job done."], close: ["Clean result. Nicely done."] },
};

export const CHARACTER_LINES: Partial<Record<CharacterId, CharacterLines>> = { princess: AVERY, partygirl: JORDAN, nurse: RILEY, zoologist: QUINN, goblin: CASEY };

/** Casey's remark about the app you just switched to (only the app's name is used). */
export function goblinAppRemark(appName: string, rnd: () => number): string {
  const n = appName.trim() || "that app";
  const lower = n.toLowerCase();
  const code = /code|xcode|terminal|iterm|cursor|studio|intellij|vim/.test(lower);
  const web = /safari|chrome|firefox|arc|edge|brave/.test(lower);
  const game = /terraria|steam|minecraft|game/.test(lower);
  const pool = code
    ? [`${n}. Remember to commit your changes regularly.`, `Working in ${n}? Small, tested steps are the way to go.`, `${n}. If you get stuck, explaining the problem out loud often helps.`]
    : web
      ? [`${n}. Try to keep the number of open tabs manageable.`, `Researching in ${n}? Bookmark anything worth coming back to.`]
      : game
        ? [`${n}. Enjoy the break.`, `${n}. Time for a well-earned break.`]
        : [`${n}. Good choice for the task.`, `${n}. Let me know if you need a hand with it.`];
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}
