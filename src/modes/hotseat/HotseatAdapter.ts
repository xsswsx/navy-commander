import type { IGameModeAdapter } from '../types'
import type { Player, TargetingState } from '@/game/types'

export class HotseatAdapter implements IGameModeAdapter {
  readonly mode = 'hotseat' as const

  private transitionResolve: (() => void) | null = null
  private targetingResolve: ((targetId: string | null) => void) | null = null

  async onTurnTransition(_fromPlayerId: string, _toPlayerId: string): Promise<void> {
    return new Promise((resolve) => {
      this.transitionResolve = resolve
    })
  }

  /** UI层调用此方法确认过渡完成 */
  confirmTransition(): void {
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

  cancelTargetSelection(): void {
    if (this.targetingResolve) {
      this.targetingResolve(null)
      this.targetingResolve = null
    }
  }

  isHandVisible(playerId: string, viewerId: string): boolean {
    return playerId === viewerId
  }

  isAIPlayer(_playerId: string): boolean {
    return false
  }

  getVisiblePlayerIds(_allPlayers: Player[], currentPlayerId: string): string[] {
    return [currentPlayerId]
  }
}
