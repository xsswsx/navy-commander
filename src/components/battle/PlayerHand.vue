<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { useCardStore } from '@/stores/card'
import { useUiStore } from '@/stores/ui'

const gameStore = useGameStore()
const cardStore = useCardStore()
const uiStore = useUiStore()

const emit = defineEmits<{
  'play-card': [cardId: string]
}>()

const hand = computed(() => {
  if (!gameStore.currentPlayerId) return []
  return cardStore.getPlayerHand(gameStore.currentPlayerId)
})

const cardTypeLabel: Record<string, string> = {
  move: '移动',
  command: '指挥',
  action: '行动',
  coffee: '咖啡',
  scheme: '谋划',
}

const cardTypeColor: Record<string, string> = {
  move: '#e6a23c',
  command: '#409eff',
  action: '#67c23a',
  coffee: '#9060eb',
  scheme: '#f56c6c',
}

const cardTypeIcon: Record<string, string> = {
  move: '→',
  command: '⚡',
  action: '✦',
  coffee: '☕',
  scheme: '♟',
}

function isSelected(cardId: string): boolean {
  return uiStore.selectedCardIds.includes(cardId)
}

function handleCardClick(cardId: string): void {
  if (isSelected(cardId)) {
    uiStore.toggleCardSelection(cardId)
    return
  }
  uiStore.clearCardSelection()
  emit('play-card', cardId)
}

function cardCountByType(type: string): number {
  return hand.value.filter((c) => c.type === type).length
}
</script>

<template>
  <div class="player-hand">
    <div class="hand-header">
      <span v-if="gameStore.currentPlayer">
        {{ gameStore.currentPlayer.name }} 的手牌 ({{ hand.length }}张)
      </span>
      <span v-if="gameStore.currentPlayer?.currentShipId" class="max-cards">
        上限: {{ gameStore.currentPlayer?.currentShipId ? '舰船舱段数' : 'N/A' }}
      </span>
    </div>

    <div class="hand-cards">
      <div v-if="hand.length === 0" class="empty-hand">
        暂无手牌
      </div>
      <div
        v-for="card in hand"
        :key="card.id"
        class="hand-card"
        :class="{ selected: isSelected(card.id) }"
        :style="{ borderColor: cardTypeColor[card.type] }"
        @click="handleCardClick(card.id)"
      >
        <div class="card-icon">{{ cardTypeIcon[card.type] }}</div>
        <div class="card-type" :style="{ color: cardTypeColor[card.type] }">
          {{ cardTypeLabel[card.type] }}
        </div>
      </div>
    </div>

    <div class="hand-counts">
      <span
        v-for="(label, type) in cardTypeLabel"
        :key="type"
        class="type-count"
        :style="{ color: cardTypeColor[type as string] }"
      >
        {{ label }}: {{ cardCountByType(type as string) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.player-hand {
  background: rgba(13, 33, 55, 0.9);
  border-top: 2px solid #1a3355;
  padding: 10px 16px;
  flex-shrink: 0;
}

.hand-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #a0b8d0;
  margin-bottom: 8px;
}

.max-cards {
  font-size: 11px;
  color: #6a8aaa;
}

.hand-cards {
  display: flex;
  gap: 10px;
  min-height: 70px;
  align-items: center;
  flex-wrap: wrap;
}

.empty-hand {
  color: #4a6a8a;
  font-size: 14px;
  padding: 16px 0;
}

.hand-card {
  width: 70px;
  height: 50px;
  background: rgba(20, 40, 70, 0.8);
  border: 2px solid #3a5a7f;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.hand-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.hand-card.selected {
  transform: translateY(-6px);
  box-shadow: 0 6px 16px rgba(64, 158, 255, 0.3);
}

.card-icon {
  font-size: 16px;
}

.card-type {
  font-size: 11px;
  font-weight: bold;
}

.hand-counts {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.type-count {
  font-size: 11px;
}
</style>
