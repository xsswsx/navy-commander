import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { HotseatAdapter } from '@/modes/hotseat/HotseatAdapter'
import type { IGameModeAdapter } from '@/modes/types'

const hotseatAdapter = new HotseatAdapter()

export function useGameMode() {
  const gameStore = useGameStore()

  const adapter = computed<IGameModeAdapter>(() => {
    switch (gameStore.mode) {
      case 'hotseat':
        return hotseatAdapter
      default:
        return hotseatAdapter
    }
  })

  return { adapter }
}

/** 直接获取热座适配器实例 (用于调用 confirmTransition 等特定方法) */
export function getHotseatAdapter(): HotseatAdapter {
  return hotseatAdapter
}
