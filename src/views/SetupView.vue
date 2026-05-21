<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useCardStore } from '@/stores/card'
import { useShipStore } from '@/stores/ship'
import { useCombatStore } from '@/stores/combat'
import { useUiStore } from '@/stores/ui'
import { TEAM_COLORS } from '@/game/constants'
import type { GameMode } from '@/game/types'
import { ElMessage } from 'element-plus'
import MultiplayerLobby from '@/components/setup/MultiplayerLobby.vue'
import type { RoomState } from '@shared/protocol'

const router = useRouter()
const gameStore = useGameStore()
const cardStore = useCardStore()
const shipStore = useShipStore()
const combatStore = useCombatStore()
const uiStore = useUiStore()

const step = ref(0) // 0: mode, 1: players, 2: design phase

// 模式选择
const selectedMode = ref<GameMode>('hotseat')

// 玩家配置
const teamCount = ref(2)
const teams = reactive<{ name: string; color: string }[]>([])
const playerNames = reactive<Record<number, string[]>>({})

// 舱段配置
const totalCompartments = ref(10)

const modeOptions = [
  { value: 'hotseat', label: '热座模式', desc: '本地多人轮流操作，适合2-12人同机游玩' },
  { value: 'multiplayer', label: '多人模式', desc: '在线联机对战，与好友远程游玩' },
  { value: 'single', label: '单机模式', desc: '与AI对战（开发中）', disabled: true },
]

function initTeams(): void {
  teams.length = 0
  for (let i = 0; i < teamCount.value; i++) {
    teams.push({ name: `队伍${i + 1}`, color: TEAM_COLORS[i] })
  }
  playerNameCounter = 0
  for (let i = 0; i < teamCount.value; i++) {
    if (!playerNames[i]) playerNames[i] = []
    if (playerNames[i].length === 0) {
      playerNameCounter++
      playerNames[i].push(`玩家${playerNameCounter}`)
    }
  }
}

let playerNameCounter = 0

function addPlayer(teamIndex: number): void {
  if (!playerNames[teamIndex]) playerNames[teamIndex] = []
  playerNameCounter++
  playerNames[teamIndex].push(`玩家${playerNameCounter}`)
}

function removePlayer(teamIndex: number, playerIndex: number): void {
  playerNames[teamIndex].splice(playerIndex, 1)
}

function selectMode(mode: GameMode): void {
  selectedMode.value = mode
  if (mode === 'multiplayer') {
    step.value = 3 // 多人模式 lobby
  } else {
    step.value = 1
    initTeams()
  }
}

function onMultiplayerStartDesign(room: RoomState): void {
  gameStore.setMode('multiplayer')
  gameStore.setTotalCompartments(room.totalCompartments)
  gameStore.initTeams(room.slots.map((s, i) => ({ name: s.teamId, color: TEAM_COLORS[i % TEAM_COLORS.length] })))
  const playerConfigs: { name: string; teamId: string }[] = []
  for (const s of room.slots) {
    if (s.playerName) {
      playerConfigs.push({ name: s.playerName, teamId: s.teamId })
    }
  }
  gameStore.initPlayers(playerConfigs)

  shipStore.resetShipStore()
  combatStore.resetCombatStore()
  uiStore.resetUiStore()
  cardStore.resetCardStore()
  cardStore.initDeck()

  gameStore.startDesignPhase()
  router.push('/design')
}

function goToStep2(): void {
  // 验证
  let totalPlayers = 0
  for (let i = 0; i < teamCount.value; i++) {
    totalPlayers += (playerNames[i] || []).length
  }
  if (totalPlayers < 2) {
    ElMessage.warning('至少需要2名玩家')
    return
  }
  step.value = 2
}

function startDesign(): void {
  if (totalCompartments.value < 2) {
    ElMessage.warning('总舱段数至少为2')
    return
  }

  // 初始化游戏状态
  gameStore.setMode(selectedMode.value)
  gameStore.setTotalCompartments(totalCompartments.value)

  // 初始化队伍
  gameStore.initTeams(teams.map((t) => ({ name: t.name, color: t.color })))

  // 初始化玩家
  const playerConfigs: { name: string; teamId: string }[] = []
  const teamIds = gameStore.teams.map((t) => t.id)
  for (let i = 0; i < teamCount.value; i++) {
    const names = playerNames[i] || []
    for (const name of names) {
      if (name.trim()) {
        playerConfigs.push({ name: name.trim(), teamId: teamIds[i] })
      }
    }
  }
  gameStore.initPlayers(playerConfigs)

  // 更新队伍的playerIds
  for (const team of gameStore.teams) {
    team.playerIds = playerConfigs
      .filter((c) => c.teamId === team.id)
      .map((_, idx) => `player_${playerConfigs.indexOf(playerConfigs.find(p => p.teamId === team.id)!)}`)
  }

  // 清理并初始化
  shipStore.resetShipStore()
  combatStore.resetCombatStore()
  uiStore.resetUiStore()
  cardStore.resetCardStore()
  cardStore.initDeck()

  gameStore.startDesignPhase()
  router.push('/design')
}
</script>

<template>
  <div class="setup-view">
    <!-- 步骤0: 模式选择 -->
    <div v-if="step === 0" class="setup-card">
      <h1 class="setup-title">海军指挥官</h1>
      <p class="setup-subtitle">Navy Commander</p>
      <div class="mode-grid">
        <div
          v-for="opt in modeOptions"
          :key="opt.value"
          class="mode-card"
          :class="{ disabled: opt.disabled }"
          @click="!opt.disabled && selectMode(opt.value as GameMode)"
        >
          <h3>{{ opt.label }}</h3>
          <p>{{ opt.desc }}</p>
        </div>
      </div>
    </div>

    <!-- 步骤1: 玩家配置 -->
    <div v-if="step === 1" class="setup-card">
      <h2>玩家配置</h2>

      <div class="config-row">
        <span class="label">队伍数量：</span>
        <el-input-number v-model="teamCount" :min="2" :max="12" @change="initTeams" />
      </div>

      <div v-for="(team, ti) in teams" :key="ti" class="team-section">
        <div class="team-header">
          <el-input v-model="team.name" size="small" style="width: 120px" />
          <el-color-picker v-model="team.color" size="small" />
          <el-button size="small" type="primary" @click="addPlayer(ti)">添加玩家</el-button>
        </div>
        <div class="player-list">
          <div v-for="(name, pi) in playerNames[ti] || []" :key="pi" class="player-row">
            <span class="color-dot" :style="{ background: team.color }"></span>
            <el-input v-model="playerNames[ti][pi]" size="small" style="width: 150px" :placeholder="`玩家${pi + 1}`" />
            <el-button
              v-if="(playerNames[ti] || []).length > 1"
              size="small"
              type="danger"
              :icon="'Delete'"
              circle
              @click="removePlayer(ti, pi)"
            />
          </div>
        </div>
      </div>

      <div class="step-actions">
        <el-button @click="step = 0">上一步</el-button>
        <el-button type="primary" @click="goToStep2">下一步</el-button>
      </div>
    </div>

    <!-- 步骤2: 舱段配置 -->
    <div v-if="step === 2" class="setup-card">
      <h2>游戏设置</h2>
      <div class="config-row">
        <span class="label">每方总舱段数：</span>
        <el-input-number v-model="totalCompartments" :min="2" :max="50" />
        <span class="hint">（舱段基础HP = 25 - 舰船舱段数）</span>
      </div>
      <el-divider />
      <div class="summary">
        <h4>配置摘要</h4>
        <p><strong>模式：</strong>{{ selectedMode === 'hotseat' ? '热座模式' : selectedMode }}</p>
        <p><strong>队伍数：</strong>{{ teamCount }}</p>
        <div v-for="(team, ti) in teams" :key="ti">
          <p>
            <span class="color-dot" :style="{ background: team.color }"></span>
            <strong>{{ team.name }}：</strong>
            {{ (playerNames[ti] || []).join(', ') }} ({{ (playerNames[ti] || []).length }}人)
          </p>
        </div>
        <p><strong>每方总舱段数：</strong>{{ totalCompartments }}</p>
      </div>
      <div class="step-actions">
        <el-button @click="step = 1">上一步</el-button>
        <el-button type="primary" size="large" @click="startDesign">开始设计舰船</el-button>
      </div>
    </div>

    <!-- 步骤3: 多人模式房间 -->
    <div v-if="step === 3" class="setup-card">
      <MultiplayerLobby @start-design="onMultiplayerStartDesign" @back="step = 0" />
    </div>
  </div>
</template>

<style scoped>
.setup-view {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: calc(100vh - 60px);
  padding: 40px 20px;
  background: radial-gradient(ellipse at center, #0d2137 0%, #0a1628 70%);
}

.setup-card {
  background: rgba(13, 33, 55, 0.9);
  border: 1px solid #1a3355;
  border-radius: 12px;
  padding: 40px;
  max-width: 700px;
  width: 100%;
}

.setup-title {
  font-size: 48px;
  text-align: center;
  color: #409eff;
  margin-bottom: 4px;
  letter-spacing: 8px;
}

.setup-subtitle {
  text-align: center;
  color: #5a7a9a;
  font-size: 16px;
  margin-bottom: 32px;
}

.mode-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mode-card {
  background: rgba(20, 40, 70, 0.8);
  border: 2px solid #1a3355;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-card:hover:not(.disabled) {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.1);
}

.mode-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-card h3 {
  font-size: 18px;
  margin-bottom: 8px;
  color: #c0d0e0;
}

.mode-card p {
  font-size: 13px;
  color: #6a8aaa;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
  flex-wrap: wrap;
}

.label {
  font-weight: bold;
  min-width: 120px;
}

.hint {
  color: #6a8aaa;
  font-size: 12px;
}

.team-section {
  background: rgba(20, 40, 70, 0.6);
  border: 1px solid #1a3355;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}

.team-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.player-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.player-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.step-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}

.summary {
  font-size: 14px;
  line-height: 2;
}

.summary h4 {
  margin-bottom: 8px;
}
</style>
