<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useShipStore } from '@/stores/ship'
import { useCombatStore } from '@/stores/combat'
import { useCardStore } from '@/stores/card'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const gameStore = useGameStore()
const shipStore = useShipStore()
const combatStore = useCombatStore()
const cardStore = useCardStore()
const uiStore = useUiStore()

const winningTeam = computed(() => {
  if (!gameStore.winner) return null
  return gameStore.teams.find((t) => t.id === gameStore.winner) ?? null
})

const winningPlayers = computed(() => {
  if (!winningTeam.value) return []
  return gameStore.players.filter((p) => p.teamId === winningTeam.value!.id)
})

const teamStats = computed(() => {
  return gameStore.teams.map((team) => {
    const teamShips = shipStore.ships.filter((s) => s.ownerTeamId === team.id)
    const totalComps = teamShips.reduce((sum, s) => sum + s.compartments.length, 0)
    const destroyedComps = teamShips.reduce(
      (sum, s) => sum + s.compartments.filter((c) => c.isDestroyed).length,
      0
    )
    const livingComps = teamShips.reduce(
      (sum, s) => sum + s.compartments.filter((c) => !c.isDestroyed).length,
      0
    )
    const totalHp = teamShips.reduce(
      (sum, s) => sum + s.compartments.reduce((s2, c) => s2 + c.currentHp, 0),
      0
    )
    const combatEqCount = teamShips.reduce(
      (sum, s) => sum + s.compartments.filter(
        (c) => c.equipmentType && ['dual_cannon', 'triple_cannon', 'quad_torpedo', 'small_hangar', 'large_hangar'].includes(c.equipmentType)
      ).length,
      0
    )
    return {
      ...team,
      totalComps,
      destroyedComps,
      livingComps,
      totalHp,
      combatEqCount,
    }
  })
})

function playAgain(): void {
  gameStore.resetGame()
  shipStore.resetShipStore()
  combatStore.resetCombatStore()
  cardStore.resetCardStore()
  uiStore.resetUiStore()
  router.push('/')
}
</script>

<template>
  <div class="results-view">
    <div class="results-card">
      <div v-if="winningTeam" class="victory-banner">
        <div class="crown">&#x1f451;</div>
        <h1>
          <span class="color-dot" :style="{ background: winningTeam.color }"></span>
          {{ winningTeam.name }} 获胜!
        </h1>
        <p class="winner-players">
          {{ winningPlayers.map(p => p.name).join(', ') }}
        </p>
      </div>

      <div v-else-if="gameStore.isStalemate" class="victory-banner">
        <h1>游戏陷入僵局</h1>
        <p>根据僵局判定规则...</p>
      </div>

      <el-divider />

      <h3>战斗统计</h3>
      <div class="stats-grid">
        <div
          v-for="stat in teamStats"
          :key="stat.id"
          class="team-stat-card"
          :style="{ borderColor: stat.color }"
        >
          <h4>
            <span class="color-dot" :style="{ background: stat.color }"></span>
            {{ stat.name }}
            <el-tag v-if="stat.id === winningTeam?.id" type="success" size="small">胜者</el-tag>
          </h4>
          <div class="stat-rows">
            <p>剩余战斗军备: {{ stat.combatEqCount }}</p>
            <p>剩余舱段: {{ stat.livingComps }} / {{ stat.totalComps }}</p>
            <p>剩余总HP: {{ stat.totalHp }}</p>
          </div>
        </div>
      </div>

      <el-divider />

      <h3>战斗记录</h3>
      <div class="log-scroll">
        <p
          v-for="entry in combatStore.combatLog.slice(-50)"
          :key="entry.id"
          class="log-line"
          :class="`log-${entry.type}`"
        >
          {{ entry.message }}
        </p>
      </div>

      <div class="results-actions">
        <el-button type="primary" size="large" @click="playAgain">再来一局</el-button>
        <el-button size="large" @click="router.push('/')">返回主菜单</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.results-view {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: calc(100vh - 60px);
  padding: 40px 20px;
  background: radial-gradient(ellipse at center, #0d2137 0%, #0a1628 70%);
  overflow-y: auto;
}

.results-card {
  background: rgba(13, 33, 55, 0.9);
  border: 1px solid #1a3355;
  border-radius: 12px;
  padding: 40px;
  max-width: 700px;
  width: 100%;
}

.victory-banner {
  text-align: center;
  padding: 20px 0;
}

.crown { font-size: 48px; }

.victory-banner h1 {
  font-size: 32px;
  margin: 8px 0;
  color: #e6a23c;
}

.winner-players {
  color: #a0b8d0;
  font-size: 16px;
}

.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
}

.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.team-stat-card {
  flex: 1;
  min-width: 200px;
  background: rgba(20, 40, 70, 0.6);
  border-left: 4px solid #409eff;
  border-radius: 6px;
  padding: 12px;
}

.team-stat-card h4 {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-rows p {
  font-size: 13px;
  color: #a0b8d0;
  line-height: 1.8;
}

.log-scroll {
  max-height: 200px;
  overflow-y: auto;
  background: rgba(10, 22, 40, 0.6);
  border-radius: 6px;
  padding: 8px 12px;
}

.log-line {
  font-size: 12px;
  line-height: 1.8;
  font-family: monospace;
}

.log-info { color: #a0b8d0; }
.log-damage { color: #f56c6c; }
.log-destroy { color: #e6a23c; }
.log-effect { color: #67c23a; }
.log-system { color: #409eff; }

.results-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
}
</style>
