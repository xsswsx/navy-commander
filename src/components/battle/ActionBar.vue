<script setup lang="ts">
import { useGameStore } from '@/stores/game'
import { useUiStore } from '@/stores/ui'

const gameStore = useGameStore()
const uiStore = useUiStore()

const emit = defineEmits<{
  'free-move': []
  'free-command': []
  'free-pass': []
  'end-turn': []
}>()

const canAct = uiStore.battleState === 'idle'
</script>

<template>
  <div class="action-bar">
    <div class="actions">
      <div class="action-group">
        <span class="group-label">自由行动：</span>
        <el-button
          size="small"
          :type="gameStore.freeActionUsed ? 'default' : 'primary'"
          :disabled="gameStore.freeActionUsed || !canAct"
          @click="emit('free-move')"
        >
          跑动 (1-2格)
        </el-button>
        <el-button
          size="small"
          :type="gameStore.freeActionUsed ? 'default' : 'primary'"
          :disabled="gameStore.freeActionUsed || !canAct"
          @click="emit('free-command')"
        >
          指挥
        </el-button>
        <el-button
          size="small"
          :type="gameStore.freeActionUsed ? 'default' : 'primary'"
          :disabled="gameStore.freeActionUsed || !canAct"
          @click="emit('free-pass')"
        >
          传递 (至多2张)
        </el-button>
      </div>

      <div class="phase-actions">
        <el-tag v-if="gameStore.freeActionUsed" type="info" size="small">自由行动已用</el-tag>
        <el-tag v-else type="success" size="small">自由行动可用</el-tag>

        <el-button
          type="warning"
          size="small"
          @click="emit('end-turn')"
        >
          结束回合
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.action-bar {
  background: rgba(13, 33, 55, 0.8);
  border-top: 1px solid #1a3355;
  padding: 8px 16px;
  flex-shrink: 0;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-label {
  font-size: 13px;
  color: #a0b8d0;
  font-weight: bold;
}

.phase-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
