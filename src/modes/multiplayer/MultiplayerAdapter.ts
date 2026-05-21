import type { IGameModeAdapter } from '../types'

// 未来实现
export class MultiplayerAdapter implements IGameModeAdapter {
  readonly mode = 'multiplayer' as const

  async onTurnTransition(_from: string, _to: string): Promise<void> {}
  async requestTargetSelection(): Promise<string | null> { return null }
  isHandVisible(): boolean { return false }
  isAIPlayer(): boolean { return false }
  getVisiblePlayerIds(): string[] { return [] }
}
