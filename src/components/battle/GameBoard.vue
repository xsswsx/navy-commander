<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { useShipStore } from '@/stores/ship'
import { useCombatStore } from '@/stores/combat'
import { useUiStore } from '@/stores/ui'
import { getEquipment } from '@/game/equipment/registry'
import type { Compartment, Ship } from '@/game/types'

const gameStore = useGameStore()
const shipStore = useShipStore()
const combatStore = useCombatStore()
const uiStore = useUiStore()

const emit = defineEmits<{
  'compartment-click': [compartmentId: string]
  'ship-click': [shipId: string]
  'cancel-targeting': []
}>()

const teamsWithShips = computed(() => {
  return gameStore.aliveTeams.map((team) => ({
    ...team,
    ships: shipStore.ships.filter((s) => s.ownerTeamId === team.id),
  }))
})

function getEqName(eqType: string | null): string {
  if (!eqType) return '空'
  return getEquipment(eqType as any)?.name ?? eqType
}

function hpPercent(current: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (current / max) * 100))
}

function hpColor(percent: number): string {
  if (percent > 60) return '#67c23a'
  if (percent > 30) return '#e6a23c'
  return '#f56c6c'
}

function isCurrentPlayerOnComp(compId: string): boolean {
  const player = gameStore.currentPlayer
  if (!player || !player.currentShipId) return false
  const ship = shipStore.findShip(player.currentShipId)
  if (!ship) return false
  const comp = ship.compartments[player.currentCompartmentIndex ?? 0]
  return comp?.id === compId
}

function isOwnTeamShip(ship: Ship): boolean {
  const player = gameStore.currentPlayer
  if (!player) return false
  return ship.ownerTeamId === player.teamId
}

function isOwnPlayerShip(ship: Ship): boolean {
  const player = gameStore.currentPlayer
  if (!player) return false
  return ship.ownerPlayerId === player.id
}

function canInteract(): boolean {
  return uiStore.battleState !== 'idle'
}

function isCompTargetable(compId: string): boolean {
  if (uiStore.battleState === 'moving') {
    // 移动：只能移动到己方舰船的舱段
    const player = gameStore.currentPlayer
    if (!player || !player.currentShipId) return false
    const ship = shipStore.getShipByCompartment(compId)
    if (!ship || ship.id !== player.currentShipId) return false
    const comp = ship.compartments.find(c => c.id === compId)
    if (!comp) return false
    const currentIdx = player.currentCompartmentIndex ?? 0
    const dist = Math.abs(comp.position - currentIdx)
    const isCardMove = uiStore.pendingAction === 'move' && uiStore.selectedCardIds.length > 0
    return dist > 0 && dist <= (isCardMove ? 1 : 2)
  }
  if (uiStore.battleState === 'targeting_compartment') {
    return uiStore.validTargetCompartmentIds.includes(compId)
  }
  return false
}

function isShipTargetable(shipId: string): boolean {
  if (uiStore.battleState === 'targeting_ship') {
    return uiStore.validTargetShipIds.includes(shipId)
  }
  return false
}

function handleCompClick(compId: string): void {
  if (uiStore.battleState === 'idle') return
  emit('compartment-click', compId)
}

function handleShipClick(shipId: string): void {
  if (uiStore.battleState !== 'targeting_ship') return
  emit('ship-click', shipId)
}

function isMultiCompMaster(comp: Compartment): boolean {
  return comp.multiCompSlaveIds.length > 0
}

function isMultiCompSlave(comp: Compartment): boolean {
  return comp.multiCompRootId != null
}

function getCompBorderStyle(comp: Compartment, ship: Ship): string {
  if (comp.isDestroyed) return 'destroyed'
  if (combatStore.isCompartmentSmoked(comp.id)) return 'smoked'
  if (isCompTargetable(comp.id)) return 'targetable'
  if (isCurrentPlayerOnComp(comp.id)) return 'current-player'
  if (isMultiCompMaster(comp)) return 'multi-master'
  if (isMultiCompSlave(comp)) return 'multi-slave'
  return ''
}

function getSpawnPlayers(comp: Compartment, ship: Ship): string[] {
  return gameStore.players
    .filter(p => p.isAlive && p.currentShipId === ship.id && p.currentCompartmentIndex === comp.position)
    .map(p => p.name)
}

function getTorpedoInfo(compId: string): { source: string; count: number; turns: number }[] {
  return combatStore.pendingTorpedoes
    .filter(t => t.targetCompartmentId === compId)
    .map(t => {
      const srcShip = shipStore.getShipByCompartment(t.sourceCompartmentId)
      return {
        source: srcShip?.name ?? '?',
        count: t.torpedoCount,
        turns: t.remainingTurns,
      }
    })
}

function getFighterGroups(shipId: string): { teamId: string; color: string; count: number }[] {
  const tokens = combatStore.fighterTokens.filter(t => t.shipId === shipId && t.occupiesSortie)
  const groups = new Map<string, number>()
  for (const t of tokens) {
    groups.set(t.ownerTeamId, (groups.get(t.ownerTeamId) ?? 0) + 1)
  }
  return [...groups.entries()].map(([teamId, count]) => {
    const team = gameStore.teams.find(t2 => t2.id === teamId)
    return { teamId, color: team?.color ?? '#888', count }
  })
}
</script>

<template>
  <div class="game-board">
    <!-- 目标选择提示条 -->
    <div v-if="uiStore.battleState !== 'idle'" class="targeting-bar">
      <span class="targeting-text">
        <template v-if="uiStore.battleState === 'moving'">
          选择移动目标舱段 (点击己方舱段)
        </template>
        <template v-else-if="uiStore.battleState === 'commanding'">
          请选择指挥效果...
        </template>
        <template v-else-if="uiStore.battleState === 'targeting_compartment'">
          选择目标舱段 (高亮显示)
        </template>
        <template v-else-if="uiStore.battleState === 'targeting_ship'">
          选择目标舰船 (点击舰船标签)
        </template>
      </span>
      <el-button size="small" type="warning" @click="emit('cancel-targeting')">取消</el-button>
    </div>

    <div v-for="tw in teamsWithShips" :key="tw.id" class="team-area">
      <div class="team-label" :style="{ borderColor: tw.color }">
        <span class="team-color-bar" :style="{ background: tw.color }"></span>
        <strong>{{ tw.name }}</strong>
        <span class="team-players">
          {{ gameStore.players.filter(p => p.teamId === tw.id && p.isAlive).map(p => p.name).join(', ') }}
        </span>
      </div>

      <div
        v-for="ship in tw.ships"
        :key="ship.id"
        class="ship-row"
        :class="{ 'ship-targetable': isShipTargetable(ship.id) }"
        @click.stop="handleShipClick(ship.id)"
      >
        <div class="ship-label">
          <span>{{ ship.name }}</span>
          <el-tag
            v-if="shipStore.isShipSunk(ship.id)"
            type="danger"
            size="small"
          >已战沉</el-tag>
          <span v-else class="ship-hp-sum">
            HP: {{ ship.compartments.reduce((s, c) => s + c.currentHp, 0) }}
          </span>
          <!-- 战斗机标识 -->
          <template v-for="ftg in getFighterGroups(ship.id)" :key="ftg.teamId">
            <span class="fighter-badge" :style="{ borderColor: ftg.color }">
              ✈{{ ftg.count }}
            </span>
          </template>
          <span
            v-if="isShipTargetable(ship.id)"
            class="target-ship-hint"
          >← 点击选择此舰</span>
        </div>

        <div class="compartment-row">
          <div
            v-for="comp in ship.compartments"
            :key="comp.id"
            class="compartment-cell"
            :class="getCompBorderStyle(comp, ship)"
            @click.stop="handleCompClick(comp.id)"
          >
            <!-- HP条 -->
            <div class="comp-hp-bar">
              <div
                class="comp-hp-fill"
                :style="{
                  width: hpPercent(comp.currentHp, comp.maxHp) + '%',
                  background: hpColor(hpPercent(comp.currentHp, comp.maxHp)),
                }"
              ></div>
            </div>

            <!-- 位置编号 -->
            <div class="comp-number">#{{ comp.position + 1 }}</div>

            <!-- 军备名称 -->
            <div class="comp-equipment">
              {{ getEqName(comp.equipmentType) }}
              <span v-if="isMultiCompMaster(comp)" class="multi-badge">主</span>
              <span v-if="isMultiCompSlave(comp)" class="multi-badge-slave">从</span>
            </div>

            <!-- HP数值 -->
            <div class="comp-hp-text">
              {{ comp.currentHp }}/{{ comp.maxHp }}
            </div>

            <!-- 击毁标记 -->
            <div v-if="comp.isDestroyed" class="destroyed-overlay">✕</div>

            <!-- 烟幕标记 -->
            <div v-if="combatStore.isCompartmentSmoked(comp.id) && !comp.isDestroyed" class="smoke-icon">&#x1F4A8;</div>

            <!-- 玩家标记 -->
            <div v-if="isCurrentPlayerOnComp(comp.id)" class="player-marker">&#x1F6B6;</div>

            <!-- 其他玩家 -->
            <div
              v-for="(pName, pi) in getSpawnPlayers(comp, ship).filter(n => n !== gameStore.currentPlayer?.name)"
              :key="pi"
              class="other-player-dot"
              :title="pName"
            >●</div>

            <!-- 鱼雷标记 -->
            <div
              v-if="comp.equipmentType === 'quad_torpedo' && !comp.isDestroyed"
              class="torpedo-marker"
              :class="{ loaded: combatStore.isTorpedoLoaded(comp.id) }"
            >&#x1F4A3;</div>

            <!-- 被鱼雷瞄准标记 -->
            <el-tooltip
              v-for="(tinfo, ti) in getTorpedoInfo(comp.id)"
              :key="'torp_'+ti"
              placement="top"
              effect="dark"
            >
              <template #content>
                <div>🎯 鱼雷来袭 #{{ ti + 1 }}</div>
                <div>来源: {{ tinfo.source }}</div>
                <div>{{ tinfo.count }}颗 · {{ tinfo.turns }}T后到达</div>
              </template>
              <div class="torpedo-target-marker" :style="{ left: (4 + ti * 28) + 'px' }">🎯<span class="torp-count">{{ tinfo.count }}</span></div>
            </el-tooltip>

            <!-- 可交互提示 -->
            <div v-if="isCompTargetable(comp.id) && !comp.isDestroyed" class="target-overlay">
              <span class="target-crosshair">⊙</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="teamsWithShips.length === 0" class="empty-board">
      <p>没有存活舰船</p>
    </div>
  </div>
</template>

<style scoped>
.game-board {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.targeting-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(64, 158, 255, 0.15);
  border: 1px solid #409eff;
  border-radius: 8px;
  padding: 8px 16px;
  margin-bottom: 12px;
}

.targeting-text {
  font-size: 14px;
  color: #409eff;
  font-weight: bold;
}

.team-area {
  margin-bottom: 20px;
}

.team-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(20, 40, 70, 0.5);
  border-left: 4px solid #409eff;
  border-radius: 4px;
  margin-bottom: 10px;
}

.team-color-bar {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}

.team-players {
  color: #6a8aaa;
  font-size: 12px;
}

.ship-row {
  margin-bottom: 12px;
  margin-left: 8px;
  border-radius: 8px;
  transition: all 0.2s;
  padding: 4px;
}

.ship-row.ship-targetable {
  background: rgba(245, 108, 108, 0.1);
  border: 2px dashed #f56c6c;
  cursor: pointer;
}

.ship-row.ship-targetable:hover {
  background: rgba(245, 108, 108, 0.2);
}

.ship-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #a0b8d0;
  margin-bottom: 6px;
}

.ship-hp-sum {
  font-size: 11px;
  color: #6a8aaa;
}

.fighter-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  padding: 1px 6px;
  border: 1.5px solid #888;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  line-height: 1.3;
}

.target-ship-hint {
  font-size: 12px;
  color: #f56c6c;
  font-weight: bold;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.compartment-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.compartment-cell {
  width: 90px;
  min-height: 80px;
  background: rgba(13, 33, 55, 0.8);
  border: 2px solid #2a4a6f;
  border-radius: 8px;
  padding: 6px;
  cursor: default;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transition: all 0.2s;
  user-select: none;
}

.compartment-cell.current-player {
  border-color: #67c23a;
  box-shadow: 0 0 12px rgba(103, 194, 58, 0.3);
}

.compartment-cell.targetable {
  border-color: #409eff !important;
  cursor: pointer;
  box-shadow: 0 0 16px rgba(64, 158, 255, 0.5);
  animation: targetGlow 1s infinite;
}

@keyframes targetGlow {
  0%, 100% { box-shadow: 0 0 8px rgba(64, 158, 255, 0.3); }
  50% { box-shadow: 0 0 20px rgba(64, 158, 255, 0.7); }
}

.compartment-cell.destroyed {
  opacity: 0.5;
  border-color: #4a2020;
  background: rgba(40, 15, 15, 0.6);
}

.compartment-cell.smoked {
  border-color: #5a5a6a;
  background: rgba(40, 40, 50, 0.6);
}

.compartment-cell.multi-master {
  border-color: #e6a23c;
}

.compartment-cell.multi-slave {
  border-color: #8a6a3c;
  border-style: dotted;
}

.comp-hp-bar {
  width: 100%;
  height: 4px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 2px;
  overflow: hidden;
}

.comp-hp-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.comp-number {
  font-size: 10px;
  color: #4a6a8a;
}

.comp-equipment {
  font-size: 11px;
  font-weight: bold;
  color: #c0d0e0;
  text-align: center;
  line-height: 1.3;
}

.multi-badge {
  font-size: 9px;
  color: #e6a23c;
  margin-left: 2px;
}

.multi-badge-slave {
  font-size: 9px;
  color: #8a6a3c;
  margin-left: 2px;
}

.comp-hp-text {
  font-size: 10px;
  color: #6a8aaa;
}

.destroyed-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 32px;
  font-weight: bold;
  color: rgba(245, 108, 108, 0.6);
  pointer-events: none;
}

.smoke-icon {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 14px;
  pointer-events: none;
}

.player-marker {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 14px;
}

.other-player-dot {
  position: absolute;
  bottom: 2px;
  right: 18px;
  font-size: 8px;
  color: #a0b8d0;
}

.torpedo-marker {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 12px;
  opacity: 0.4;
}

.torpedo-marker.loaded {
  opacity: 1;
  color: #e6a23c;
  filter: drop-shadow(0 0 4px #e6a23c);
}

.torpedo-target-marker {
  position: absolute;
  bottom: 2px;
  left: 4px;
  font-size: 12px;
  color: #f56c6c;
  display: flex;
  align-items: center;
  gap: 1px;
  filter: drop-shadow(0 0 4px #f56c6c);
  animation: torpedoPulse 0.8s infinite;
}

.torp-count {
  font-size: 8px;
  font-weight: bold;
  color: #fff;
}

@keyframes torpedoPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

.target-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.target-crosshair {
  font-size: 28px;
  color: rgba(64, 158, 255, 0.5);
}

.empty-board {
  text-align: center;
  padding: 80px 0;
  color: #4a6a8a;
}
</style>
