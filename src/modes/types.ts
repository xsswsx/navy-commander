import type { GameMode, Player, TargetingState } from '@/game/types'

export type { GameMode }

export interface IGameModeAdapter {
  readonly mode: GameMode

  /** 回合过渡时调用 (热座: 显示隐私遮罩; 单机: AI自动执行; 多人: 等待网络) */
  onTurnTransition(fromPlayerId: string, toPlayerId: string): Promise<void>

  /** 请求玩家选择目标 */
  requestTargetSelection(
    playerId: string,
    targetState: TargetingState
  ): Promise<string | null>

  /** 检查手牌对观察者是否可见 */
  isHandVisible(playerId: string, viewerId: string): boolean

  /** 检查是否为AI玩家 */
  isAIPlayer(playerId: string): boolean

  /** 获取当前可见的玩家ID (热座: 仅当前回合玩家; 单机: 人类玩家; 多人: 所有) */
  getVisiblePlayerIds(allPlayers: Player[], currentPlayerId: string): string[]
}
