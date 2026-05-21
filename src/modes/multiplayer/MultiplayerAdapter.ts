import type { IGameModeAdapter } from '../types'
import type { Player, TargetingState } from '@/game/types'
import { multiplayerClient } from './MultiplayerClient'

export class MultiplayerAdapter implements IGameModeAdapter {
  readonly mode = 'multiplayer' as const

  private transitionResolve: (() => void) | null = null
  private targetingResolve: ((targetId: string | null) => void) | null = null
  private myPlayerId = ''

  setPlayerId(id: string): void { this.myPlayerId = id }

  async onTurnTransition(_fromPlayerId: string, toPlayerId: string): Promise<void> {
    // 等待服务端确认回合切换
    return new Promise((resolve) => {
      if (toPlayerId === this.myPlayerId) {
        // 自己的回合，立即放行
        resolve()
      } else {
        // 等待他人回合结束
        this.transitionResolve = resolve
      }
    })
  }

  notifyTurnChange(): void {
    if (this.transitionResolve) {
      this.transitionResolve()
      this.transitionResolve = null
    }
  }

  async requestTargetSelection(
    _playerId: string,
    _targetState: TargetingState
  ): Promise<string | null> {
    return new Promise((resolve) => {
      this.targetingResolve = resolve
    })
  }

  confirmTargetSelection(targetId: string | null): void {
    if (this.targetingResolve) {
      this.targetingResolve(targetId)
      this.targetingResolve = null
    }
  }

  isHandVisible(playerId: string, _viewerId: string): boolean {
    return playerId === this.myPlayerId
  }

  isAIPlayer(_playerId: string): boolean {
    return false
  }

  getVisiblePlayerIds(allPlayers: Player[], _currentPlayerId: string): string[] {
    return allPlayers.filter(p => p.id === this.myPlayerId || true).map(p => p.id)
  }
}
