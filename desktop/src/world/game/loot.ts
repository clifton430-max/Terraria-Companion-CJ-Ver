// What generated chests and smashed pots hold, Terraria-style: surface and cabin chests have
// early accessories and tools, sky chests the skyware treasures, dungeon chests (behind the
// Skeletron fight) the dungeon weapons, shadow chests in the underworld fiery gear. Pots spill
// coins, torches, potions and ammo. Rolled once (seeded by the object's position).

import { hash } from "../gen";
import type { Slot } from "./inventory";

type Entry = [id: number, min: number, max: number, chance: number];

const TABLES: Record<string, { main: number[]; extras: Entry[] }> = {
  surface: { main: [280, 196, 49, 3504], extras: [[8, 5, 15, 0.8], [28, 1, 3, 0.6], [40, 10, 25, 0.5], [72, 1, 5, 0.6]] },
  cabin: { main: [54, 53, 50, 49, 84, 159], extras: [[8, 10, 20, 0.8], [28, 2, 4, 0.7], [166, 2, 6, 0.3], [72, 3, 15, 0.8], [292, 1, 2, 0.4], [296, 1, 1, 0.3], [21, 5, 10, 0.3]] },
  sky: { main: [65, 159, 158], extras: [[824, 20, 40, 1], [75, 3, 8, 0.6], [72, 10, 30, 0.8]] },
  dungeon: { main: [155, 156, 165, 164, 113, 163], extras: [[188, 2, 4, 0.8], [72, 20, 50, 1], [327, 1, 1, 0.3], [292, 1, 2, 0.5]] },
  shadow: { main: [119, 112, 220, 193], extras: [[188, 2, 5, 0.8], [288, 1, 2, 0.6], [73, 1, 2, 0.6]] },
};

/** Roll a chest's loot table into slots. */
export function rollChest(table: string, seed: number, x: number, y: number, size: number): Slot[] {
  const out: Slot[] = Array.from({ length: size }, () => null);
  const t = TABLES[table] ?? TABLES.surface;
  let i = 0;
  out[i++] = { id: t.main[Math.floor(hash(seed + 700, x, y) * t.main.length)], count: 1 };
  t.extras.forEach(([id, min, max, chance], k) => {
    if (i >= size || hash(seed + 701 + k, x, y) > chance) return;
    out[i++] = { id, count: min + Math.floor(hash(seed + 760 + k, x, y) * (max - min + 1)) };
  });
  return out;
}

/** What a smashed pot drops: coins, and maybe torches, potions, arrows or bombs. */
export function rollPot(seed: number, x: number, y: number, deep: boolean): { id: number; count: number }[] {
  const r = (k: number) => hash(seed + 800 + k, x, y);
  const out: { id: number; count: number }[] = [{ id: deep ? 72 : 71, count: 1 + Math.floor(r(0) * (deep ? 4 : 60)) }];
  const roll = r(1);
  if (roll < 0.25) out.push({ id: 8, count: 3 + Math.floor(r(2) * 8) });
  else if (roll < 0.45) out.push({ id: deep ? 188 : 28, count: 1 });
  else if (roll < 0.6) out.push({ id: 40, count: 10 + Math.floor(r(3) * 15) });
  else if (roll < 0.66) out.push({ id: 166, count: 1 + Math.floor(r(4) * 3) });
  else if (roll < 0.75) out.push({ id: 292, count: 1 });
  return out;
}

/** Shadow orbs: one of the orb treasures, by how many have been smashed. */
export const ORB_LOOT = [96, 64, 162, 111, 115];
