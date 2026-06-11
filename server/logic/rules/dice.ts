// server/logic/rules/dice.ts
// 逻辑层骰子工具

export type DiceRng = (sides: number) => number

/** 基于 Math.random 的真随机骰子 */
export function createRng(): DiceRng {
  return (sides: number) => Math.floor(Math.random() * sides) + 1
}

/** 测试用固定值骰子：依次返回预设值 */
export function mockRng(sequence: number[]): DiceRng {
  let i = 0
  return () => {
    const v = sequence[i % sequence.length]
    i++
    return v
  }
}

/** 投掷多个同面数骰子 */
export function rollMultiple(rng: DiceRng, sides: number, count: number): number[] {
  return Array.from({ length: count }, () => rng(sides))
}

/** 投掷一个骰子 */
export function rollOne(rng: DiceRng, sides: number): number {
  return rng(sides)
}
