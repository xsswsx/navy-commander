<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { computed } from 'vue'

const router = useRouter()
const gameStore = useGameStore()

const showHeader = computed(() => {
  return gameStore.phase !== 'setup'
})
</script>

<template>
  <div class="app-container">
    <header v-if="showHeader" class="app-header">
      <div class="header-left">
        <h1 class="game-title" @click="router.push('/')">海军指挥官</h1>
        <el-tag v-if="gameStore.mode === 'hotseat'" type="warning" size="small">热座模式</el-tag>
        <el-tag v-else size="small">{{ gameStore.mode }}</el-tag>
      </div>
      <div v-if="gameStore.phase === 'battle'" class="header-center">
        <span class="phase-text">
          第 {{ gameStore.roundNumber }} 轮 ·
          <template v-if="gameStore.currentPlayer">
            {{ gameStore.currentPlayer.name }} 的回合 ·
          </template>
          {{ gameStore.currentTurnPhase === 'draw' ? '行动阶段' :
             gameStore.currentTurnPhase === 'action' ? '行动阶段' : '弃牌阶段' }}
        </span>
      </div>
      <div class="header-right">
        <el-button size="small" @click="gameStore.resetGame(); router.push('/')">
          返回主菜单
        </el-button>
      </div>
    </header>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0a1628;
  color: #e0e6ed;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: linear-gradient(135deg, #0d2137 0%, #132744 100%);
  border-bottom: 2px solid #1a3355;
  min-height: 48px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.game-title {
  font-size: 18px;
  color: #409eff;
  cursor: pointer;
  user-select: none;
  margin: 0;
}

.game-title:hover {
  color: #66b1ff;
}

.header-center {
  font-size: 14px;
  color: #a0b8d0;
}

.header-right {
  display: flex;
  gap: 8px;
}

.app-main {
  flex: 1;
  overflow: auto;
  padding: 0;
}
</style>
