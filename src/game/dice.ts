export type DiceType = 'D4' | 'D6' | 'D8' | 'D12'

const DICE_SIDES: Record<DiceType, number> = {
  D4: 4,
  D6: 6,
  D8: 8,
  D12: 12,
}

/** 投掷一个骰子，返回1到面数之间的值 */
export function rollDice(type: DiceType): number {
  const sides = DICE_SIDES[type]
  return Math.floor(Math.random() * sides) + 1
}

/** 投掷多个骰子 */
export function rollMultiple(type: DiceType, count: number): number[] {
  return Array.from({ length: count }, () => rollDice(type))
}

/** 解析骰子表达式，如 "2D6" -> 投2个6面骰 */
export function parseDiceAndRoll(expr: string): { results: number[]; total: number } {
  const match = expr.match(/^(\d+)D(\d+)$/i)
  if (!match) throw new Error(`Invalid dice expression: ${expr}`)
  const count = parseInt(match[1])
  const sides = parseInt(match[2])
  const key = `D${sides}` as DiceType
  if (!DICE_SIDES[key]) throw new Error(`Unknown dice: ${key}`)
  const results = rollMultiple(key, count)
  return { results, total: results.reduce((a, b) => a + b, 0) }
}

/** 随机浮点概率判定 */
export function probability(chance: number): boolean {
  return Math.random() < chance
}
