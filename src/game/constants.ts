import type { CardType } from './types'

/** 卡组构成 */
export const DECK_COMPOSITION: Record<CardType, number> = {
  move: 40,
  command: 40,
  action: 20,
  coffee: 8,
  scheme: 8,
}

/** 总卡牌数 */
export const TOTAL_CARDS = 116

/** 基础HP公式: 25 - 舰船舱段数 */
export function baseHp(shipCompartmentCount: number): number {
  return Math.max(1, 25 - shipCompartmentCount)
}

/** 初始手牌数 */
export const INITIAL_HAND_SIZE = 2

/** 自由行动可移动格数 */
export const FREE_MOVE_RANGE = 2

/** 自由行动可传递手牌数 */
export const FREE_PASS_COUNT = 2

/** 玩家颜色池 */
export const TEAM_COLORS = [
  '#409EFF', '#F56C6C', '#67C23A', '#E6A23C',
  '#9060EB', '#20B2AA', '#FF6B6B', '#48D1CC',
  '#FF8C00', '#8B008B', '#2E8B57', '#DC143C',
]

/** 空优值: 每个战斗机token提供2点空优 */
export const FIGHTER_AIR_SUPERIORITY = 2

/** 防空炮提供空优3 */
export const AA_GUN_AIR_SUPERIORITY = 3

/** 鱼雷每颗伤害 */
export const TORPEDO_DAMAGE_DICE = 'D12' as const

/** 舰炮伤害骰 */
export const NAVAL_GUN_DAMAGE = { dice: 'D6' as const, count: 2 }
export const TRIPLE_GUN_DAMAGE = { dice: 'D6' as const, count: 3 }
