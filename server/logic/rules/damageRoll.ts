// server/logic/rules/damageRoll.ts
import type { DiceRng } from './dice.js'
import { rollMultiple } from './dice.js'

export function rollGunDamage(
  rng: DiceRng, equipmentType: 'dual_cannon' | 'triple_cannon'
): number {
  const count = equipmentType === 'dual_cannon' ? 2 : 3
  return rollMultiple(rng, 6, count).reduce((a, b) => a + b, 0)
}

export function rollTorpedoDamage(rng: DiceRng, count: number): number[] {
  return rollMultiple(rng, 10, count)
}

export function rollBomberDamage(rng: DiceRng, nfa: number): number {
  const d12 = rng(12)
  return Math.max(0, 16 - nfa * d12)
}

export function rollTorpedoBomberDamage(rng: DiceRng, nfa: number): number {
  const d6 = rng(6)
  const d10a = rng(10)
  const d10b = rng(10)
  return Math.max(0, d10a + d10b - nfa * d6)
}
