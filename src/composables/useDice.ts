import { ref } from 'vue'
import { rollMultiple, type DiceType } from '@/game/dice'

export function useDice() {
  const rolling = ref(false)
  const lastResults = ref<{ type: DiceType; results: number[]; total: number } | null>(null)

  async function roll(type: DiceType, count: number, label?: string): Promise<number[]> {
    rolling.value = true
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 600))
    const results = rollMultiple(type, count)
    lastResults.value = { type, results, total: results.reduce((a, b) => a + b, 0) }
    rolling.value = false
    return results
  }

  return { rolling, lastResults, roll }
}
