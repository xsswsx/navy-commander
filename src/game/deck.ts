import type { Card, CardType } from './types'
import { DECK_COMPOSITION } from './constants'

let cardIdCounter = 0

function nextCardId(): string {
  return `card_${++cardIdCounter}`
}

/** 构建初始卡组 (116张) */
export function buildDeck(): Card[] {
  const cards: Card[] = []
  for (const [type, count] of Object.entries(DECK_COMPOSITION)) {
    for (let i = 0; i < count; i++) {
      cards.push({ id: nextCardId(), type: type as CardType })
    }
  }
  return cards
}

/** Fisher-Yates 洗牌 */
export function shuffle(deck: Card[]): Card[] {
  const arr = [...deck]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 从牌堆抽牌，不够时自动将弃牌堆洗入 */
export function drawCards(
  drawPile: Card[],
  discardPile: Card[],
  count: number
): { drawn: Card[]; newDraw: Card[]; newDiscard: Card[] } {
  let drawArr = [...drawPile]
  let discardArr = [...discardPile]
  const drawn: Card[] = []

  if (drawArr.length < count) {
    if (discardArr.length > 0) {
      drawArr = [...drawArr, ...shuffle(discardArr)]
      discardArr = []
    }
  }

  const available = Math.min(count, drawArr.length)
  drawn.push(...drawArr.splice(0, available))

  return { drawn, newDraw: drawArr, newDiscard: discardArr }
}

/** 重置卡组ID计数器（用于新游戏） */
export function resetCardIdCounter(): void {
  cardIdCounter = 0
}
