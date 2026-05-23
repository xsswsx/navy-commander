import type { IGameModeAdapter } from '../types'
import type { Player } from '@/game/types'

export class MultiplayerAdapter implements IGameModeAdapter {
  readonly mode = 'multiplayer' as const
  async onTurnTransition(): Promise<void> {}
  async requestTargetSelection(): Promise<string | null> { return null }
  isHandVisible(playerId: string, viewerId: string): boolean { return playerId === viewerId }
  isAIPlayer(): boolean { return false }
  getVisiblePlayerIds(all: Player[]): string[] { return all.map(p => p.id) }
}
