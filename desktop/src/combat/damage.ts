// Deterministic damage rolls and the serialisable RNG used by the combat simulation.

export interface DamageRoll {
  amount: number;
  crit: boolean;
}

/**
 * Roll damage from two uniform random numbers in [0, 1):
 * ±15% variance, double on a critical hit, then half the defence subtracted (minimum 1).
 */
export function rollDamage(
  base: number,
  defense: number,
  critChance: number,
  varianceRoll: number,
  critRoll: number,
): DamageRoll {
  const crit = critRoll < critChance;
  const varied = Math.round(base * (0.85 + 0.3 * varianceRoll));
  const amount = Math.max(1, varied * (crit ? 2 : 1) - Math.floor(defense / 2));
  return { amount, crit };
}

/** One step of mulberry32 on an explicit 32-bit state: returns [value in [0,1), next state]. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
