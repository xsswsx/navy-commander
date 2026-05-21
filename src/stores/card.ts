import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Card } from '@/game/types'
import { buildDeck, shuffle, drawCards } from '@/game/deck'
import { INITIAL_HAND_SIZE } from '@/game/constants'

export const useCardStore = defineStore('card', () => {
  const drawPile = ref<Card[]>([])
  const discardPile = ref<Card[]>([])
  const playerHands = ref<Record<string, Card[]>>({})

  let createdCardId = 10000 // 手动创建的卡牌ID起始值

  function addCardToHand(playerId: string, cardType: Card['type']): void {
    const card: Card = { id: `created_${++createdCardId}`, type: cardType }
    if (!playerHands.value[playerId]) {
      playerHands.value[playerId] = []
    }
    playerHands.value[playerId].push(card)
  }

  function initDeck(): void {
    drawPile.value = shuffle(buildDeck())
    discardPile.value = []
    playerHands.value = {}
  }

  function dealInitialHands(playerIds: string[]): void {
    for (const pid of playerIds) {
      const { drawn, newDraw, newDiscard } = drawCards(
        drawPile.value,
        discardPile.value,
        INITIAL_HAND_SIZE
      )
      drawPile.value = newDraw
      discardPile.value = newDiscard
      playerHands.value[pid] = drawn
    }
  }

  function playerDrawCards(playerId: string, count: number): Card[] {
    const { drawn, newDraw, newDiscard } = drawCards(
      drawPile.value,
      discardPile.value,
      count
    )
    drawPile.value = newDraw
    discardPile.value = newDiscard

    if (!playerHands.value[playerId]) {
      playerHands.value[playerId] = []
    }
    playerHands.value[playerId].push(...drawn)
    return drawn
  }

  function removeCardFromHand(playerId: string, cardId: string): Card | null {
    const hand = playerHands.value[playerId]
    if (!hand) return null
    const idx = hand.findIndex((c) => c.id === cardId)
    if (idx === -1) return null
    const [card] = hand.splice(idx, 1)
    return card
  }

  function discardPlayerCards(playerId: string, cardIds: string[]): void {
    const hand = playerHands.value[playerId]
    if (!hand) return
    for (const cid of cardIds) {
      const idx = hand.findIndex((c) => c.id === cid)
      if (idx !== -1) {
        const [card] = hand.splice(idx, 1)
        discardPile.value.push(card)
      }
    }
  }

  function discardDownTo(playerId: string, maxCards: number): Card[] {
    const hand = playerHands.value[playerId]
    if (!hand || hand.length <= maxCards) return []
    const toDiscard = hand.splice(maxCards)
    discardPile.value.push(...toDiscard)
    return toDiscard
  }

  function transferCards(
    fromPlayerId: string,
    toPlayerId: string,
    cardIds: string[]
  ): boolean {
    const fromHand = playerHands.value[fromPlayerId]
    const toHand = playerHands.value[toPlayerId]
    if (!fromHand || !toHand) return false

    for (const cid of cardIds) {
      const idx = fromHand.findIndex((c) => c.id === cid)
      if (idx === -1) return false
      const [card] = fromHand.splice(idx, 1)
      toHand.push(card)
    }
    return true
  }

  function getPlayerHand(playerId: string): Card[] {
    return playerHands.value[playerId] ?? []
  }

  function getPlayerHandCount(playerId: string): number {
    return playerHands.value[playerId]?.length ?? 0
  }

  function getAllPlayersDrawOne(playerIds: string[]): Card[] {
    const drawn: Card[] = []
    for (const pid of playerIds) {
      drawn.push(...playerDrawCards(pid, 1))
    }
    return drawn
  }

  function resetCardStore(): void {
    drawPile.value = []
    discardPile.value = []
    playerHands.value = {}
  }

  return {
    drawPile,
    discardPile,
    playerHands,
    initDeck,
    dealInitialHands,
    playerDrawCards,
    removeCardFromHand,
    discardPlayerCards,
    discardDownTo,
    transferCards,
    getPlayerHand,
    getPlayerHandCount,
    getAllPlayersDrawOne,
    addCardToHand,
    resetCardStore,
  }
})
