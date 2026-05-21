import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { HotseatAdapter } from '@/modes/hotseat/HotseatAdapter'
import { MultiplayerAdapter } from '@/modes/multiplayer/MultiplayerAdapter'
import type { IGameModeAdapter } from '@/modes/types'

const hotseatAdapter = new HotseatAdapter()
const multiplayerAdapter = new MultiplayerAdapter()

export function useGameMode() {
  const gameStore = useGameStore()

  const adapter = computed<IGameModeAdapter>(() => {
    switch (gameStore.mode) {
      case 'hotseat':
        return hotseatAdapter
      case 'multiplayer':
        return multiplayerAdapter
      default:
        return hotseatAdapter
    }
  })

  return { adapter }
}

export function getHotseatAdapter(): HotseatAdapter {
  return hotseatAdapter
}

export function getMultiplayerAdapter(): MultiplayerAdapter {
  return multiplayerAdapter
}
