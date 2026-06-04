<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useShipStore } from '@/stores/ship'
import { useCardStore } from '@/stores/card'
import { useCombatStore } from '@/stores/combat'
import { useUiStore } from '@/stores/ui'
import { getEquipment } from '@/game/equipment/registry'
import { rollDice, rollMultiple } from '@/game/dice'
import type { Compartment } from '@/game/types'
import type { BattleAction, BattleInitPayload } from '@shared/protocol'
import GameBoard from '@/components/battle/GameBoard.vue'
import PlayerHand from '@/components/battle/PlayerHand.vue'
import ActionBar from '@/components/battle/ActionBar.vue'
import CombatLog from '@/components/battle/CombatLog.vue'
import TurnTransition from '@/components/mode-specific/hotseat/TurnTransition.vue'
import CommandDialog from '@/components/battle/CommandDialog.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { multiplayerClient } from '@/modes/multiplayer/MultiplayerClient'

const router = useRouter()
const gameStore = useGameStore()
const shipStore = useShipStore()
const cardStore = useCardStore()
const combatStore = useCombatStore()
const uiStore = useUiStore()

const isMP = computed(() => gameStore.mode === 'multiplayer')
const mySlotIndex = ref(-1)
const currentTurnSlot = ref(-1)
const mpRoundNumber = ref(1)

// 多人模式权限
function mpCanAct(): boolean {
  if (!isMP.value) return true
  return currentTurnSlot.value === mySlotIndex.value
}

const transitionVisible = ref(false)
const transitionToName = ref('')
const showSpawnDialog = ref(false)
const spawnPlayerName = ref('')
const showCommandDialog = ref(false)
const commandDialogComp = ref<Compartment | null>(null)
const commandDialogOptions = ref<{ id: string; name: string }[]>([])
const spawnIndex = ref(0)
const myTeamId = computed(() => {
  if (isMP.value && mySlotIndex.value >= 0) {
    const p = getPlayerBySlot(mySlotIndex.value)
    return p?.teamId ?? ''
  }
  return gameStore.currentPlayer?.teamId ?? ''
})

// 防御: 防止远程操作触发本地操作再发送回服务器
let replayingRemote = false
// slotIndex → player.id 映射 (因 players 数组可能不连续)
const slotToPlayerId = ref<Record<number, string>>({})
const playerIdToSlot = ref<Record<string, number>>({})

function getPlayerBySlot(slotIndex: number) {
  const pid = slotToPlayerId.value[slotIndex]
  return pid ? gameStore.players.find(p => p.id === pid) ?? null : null
}

// ===== 多人模式: 注册事件监听 (在组件 setup 阶段) =====
if (isMP.value) {
  multiplayerClient.onBattleInit((payload: BattleInitPayload & { currentTurnSlot?: number; roundNumber?: number; spawns?: any[]; battleLog?: any[] }) => {
    // 如果已经初始化过 (可能由 DesignView 预先初始化)，跳过
    if (gameStore.players.length > 0 && shipStore.ships.length > 0) {
      // 只更新回合/出生点状态
      if (payload.currentTurnSlot !== undefined) currentTurnSlot.value = payload.currentTurnSlot
      if (payload.roundNumber) mpRoundNumber.value = payload.roundNumber
      // 更新手牌 (服务端为最新权威来源)
      if (payload.playerHands) {
        cardStore.playerHands = {}
        for (const [si, hand] of Object.entries(payload.playerHands)) {
          const pid = slotToPlayerId.value[Number(si)]
          if (pid) cardStore.playerHands[pid] = hand as any
        }
      }
      return
    }
    // 初始化舰船
    for (const [teamId, designs] of Object.entries(payload.ships)) {
      const rep = payload.players.find((p: any) => p.teamId === teamId)
      shipStore.finalizeDesign(rep?.name ?? '', teamId, designs as any)
    }
    // 初始化队伍和玩家
    if (gameStore.players.length === 0) {
      gameStore.initTeams(payload.teams.map((t: any) => ({ name: t.id, color: t.color })))
      gameStore.initPlayers(payload.players.map((p: any) => ({ name: p.name, teamId: p.teamId })))
    }
    // 建立 slotIndex ↔ playerId 映射
    const slotMap: Record<number, string> = {}
    const pidMap: Record<string, number> = {}
    for (let i = 0; i < payload.players.length; i++) {
      const player = gameStore.players[i]
      if (player) {
        slotMap[payload.players[i].slotIndex] = player.id
        pidMap[player.id] = payload.players[i].slotIndex
      }
    }
    slotToPlayerId.value = slotMap
    playerIdToSlot.value = pidMap

    // 尝试通过 playerName 匹配本客户端槽位
    const storedName = localStorage.getItem('mp_playerId') || ''
    for (let i = 0; i < payload.players.length; i++) {
      if (payload.players[i].name === storedName) {
        mySlotIndex.value = payload.players[i].slotIndex
        break
      }
    }

    // 使用服务器牌堆
    cardStore.resetCardStore()
    if (payload.drawPile && payload.drawPile.length > 0) {
      cardStore.drawPile = payload.drawPile as any
      cardStore.discardPile = (payload.discardPile || []) as any
      cardStore.playerHands = {}
      for (const [si, hand] of Object.entries(payload.playerHands)) {
        const pid = slotToPlayerId.value[Number(si)]
        if (pid) {
          cardStore.playerHands[pid] = hand as any
        }
      }
    } else {
      cardStore.initDeck()
      cardStore.dealInitialHands(gameStore.players.map(p => p.id))
    }

    // 回复联机状态
    if (payload.currentTurnSlot !== undefined) currentTurnSlot.value = payload.currentTurnSlot
    if (payload.roundNumber) mpRoundNumber.value = payload.roundNumber

    // 重放战斗日志
    if (payload.battleLog) {
      for (const entry of payload.battleLog) {
        combatStore.log(entry.message, entry.type as any)
      }
    }

    combatStore.log('战斗开始! 请选择出生点', 'system')

    // 检查是否已选择出生点
    const alreadySpawned = payload.spawns?.find((s: any) => s.slotIndex === mySlotIndex.value)
    if (!alreadySpawned) {
      const myP = getPlayerBySlot(mySlotIndex.value)
      if (myP && !myP.currentShipId) {
        spawnPlayerName.value = myP.name
        showSpawnDialog.value = true
      }
    }
  })

  multiplayerClient.onBattleTurn((t) => {
    currentTurnSlot.value = t.playerSlotIndex
    if (t.roundNumber) mpRoundNumber.value = t.roundNumber
    // 对齐 gameStore 的回合索引
    const pid = slotToPlayerId.value[t.playerSlotIndex]
    if (pid) {
      const idx = gameStore.turnOrder.indexOf(pid)
      if (idx >= 0) {
        gameStore.currentTurnIndex = idx
      }
    }
    const player = getPlayerBySlot(t.playerSlotIndex)
    if (player) {
      combatStore.log(`--- ${player.name} 的回合 ---`, 'system')
    }
    // 如果是自己的回合，触发抽牌阶段
    if (t.playerSlotIndex === mySlotIndex.value) {
      gameStore.currentTurnPhase = 'draw'
    }
  })

  multiplayerClient.onBattleAction((action: BattleAction) => {
    // 忽略自己的操作 (本地已执行)
    if (action.senderSlotIndex === mySlotIndex.value) return
    replayingRemote = true
    handleRemoteAction(action)
    replayingRemote = false
  })

  multiplayerClient.onBattleLog((entry) => {
    combatStore.log(entry.message, entry.type as any)
  })

  multiplayerClient.onCardDrawn((d) => {
    const pid = slotToPlayerId.value[mySlotIndex.value]
    if (pid) {
      cardStore.playerHands[pid] = d.hand as any
    }
  })
}

// ===== 战斗开始 =====
onMounted(() => {
  if (gameStore.phase !== 'battle') {
    router.push('/')
    return
  }
  if (isMP.value) {
    // 多人模式: 请求最新战斗状态
    multiplayerClient.requestBattleInit()
    return
  }
  startSpawnPhase()
})

function startSpawnPhase(): void {
  spawnIndex.value = 0
  showSpawnForCurrent()
}

function showSpawnForCurrent(): void {
  const playerIds = gameStore.turnOrder
  if (spawnIndex.value >= playerIds.length) {
    startDrawPhase()
    return
  }
  const pid = playerIds[spawnIndex.value]
  const player = gameStore.players.find(p => p.id === pid)
  if (!player || !player.isAlive) {
    spawnIndex.value++
    showSpawnForCurrent()
    return
  }
  const playerShips = shipStore.ships.filter(s => s.ownerTeamId === player.teamId)
  if (playerShips.length === 0) {
    spawnIndex.value++
    showSpawnForCurrent()
    return
  }
  spawnPlayerName.value = player.name
  if (spawnIndex.value > 0) {
    transitionToName.value = player.name
    transitionVisible.value = true
  } else {
    showSpawnDialog.value = true
  }
}

function onTransitionConfirm(): void {
  transitionVisible.value = false
  const playerIds = gameStore.turnOrder
  if (spawnIndex.value < playerIds.length && spawnIndex.value > 0) {
    showSpawnDialog.value = true
  } else if (gameStore.currentTurnPhase === 'draw') {
    startDrawPhase()
  }
}

function handleSpawnSelect(compartmentId: string): void {
  if (isMP.value) {
    const myPlayer = getPlayerBySlot(mySlotIndex.value)
    if (!myPlayer) return
    const ship = shipStore.getShipByCompartment(compartmentId)
    if (!ship) return
    const comp = ship.compartments.find(c => c.id === compartmentId)
    if (!comp) return
    myPlayer.currentShipId = ship.id
    myPlayer.currentCompartmentIndex = comp.position
    combatStore.log(`${myPlayer.name} 在 ${ship.name} 舱段${comp.position + 1} 出生`, 'system')
    showSpawnDialog.value = false
    multiplayerClient.sendSpawn(compartmentId, ship.id)
    return
  }
  // 热座: 按顺序选出生点
  const playerIds = gameStore.turnOrder
  const pid = playerIds[spawnIndex.value]
  const player = gameStore.players.find(p => p.id === pid)
  if (!player) return
  const ship = shipStore.getShipByCompartment(compartmentId)
  if (!ship) return
  const comp = ship.compartments.find(c => c.id === compartmentId)
  if (!comp) return
  player.currentShipId = ship.id
  player.currentCompartmentIndex = comp.position
  combatStore.log(`${player.name} 在 ${ship.name} 舱段${comp.position + 1} 出生`, 'system')
  showSpawnDialog.value = false
  spawnIndex.value++
  showSpawnForCurrent()
}

// ===== 远程操作回放 =====
function handleRemoteAction(action: BattleAction): void {
  const senderSlot = action.senderSlotIndex ?? -1
  const senderPlayer = gameStore.players[senderSlot]
  if (!senderPlayer) return

  if (action.logMessage) {
    combatStore.log(action.logMessage, (action.logType || 'info') as any)
  }

  switch (action.type) {
    case 'selectSpawn': {
      if (action.compartmentId) {
        const ship = shipStore.getShipByCompartment(action.compartmentId)
        const comp = ship?.compartments.find(c => c.id === action.compartmentId)
        if (ship && comp) {
          senderPlayer.currentShipId = ship.id
          senderPlayer.currentCompartmentIndex = comp.position
          combatStore.log(`${senderPlayer.name} 在 ${ship.name} 舱段${comp.position + 1} 出生`, 'system')
        }
      }
      break
    }
    case 'endTurn': {
      combatStore.log(`${senderPlayer.name} 结束回合`, 'system')
      combatStore.tickEffects()
      combatStore.tickFighterTurns()
      combatStore.resetPerTurnCounters()
      break
    }
    // 其他操作类型由各自的 handler 经过服务器 relay 后处理
  }
}

// ===== 回合切换 =====
watch(() => gameStore.currentPlayerId, (newId, oldId) => {
  if (oldId && newId && gameStore.phase === 'battle' && !isMP.value) {
    const player = gameStore.players.find(p => p.id === newId)
    if (player) {
      transitionToName.value = player.name
      transitionVisible.value = true
      combatStore.log(`--- ${player.name} 的回合 ---`, 'system')
    }
  }
})

watch(() => gameStore.currentTurnPhase, (phase) => {
  if (phase === 'draw' && gameStore.phase === 'battle') {
    startDrawPhase()
  }
})

// ===== 抽牌 =====
function startDrawPhase(): void {
  if (isMP.value) {
    // 多人模式: 从服务器抽牌 (批量)
    const playerId = gameStore.currentPlayerId!
    const player = gameStore.currentPlayer
    if (!player || !player.currentShipId) return
    const ship = shipStore.findShip(player.currentShipId)
    if (!ship) return
    const comp = player.currentCompartmentIndex != null ? ship.compartments[player.currentCompartmentIndex] : null
    let drawAmount = comp ? shipStore.getDrawValue(comp) : 1
    const compensation = gameStore.getFirstRoundCompensation(playerId)
    if (compensation > 0) {
      drawAmount += compensation
      combatStore.log(`${player.name} 第一轮后攻补偿 +${compensation}张`, 'system')
    }
    if (drawAmount > 0) multiplayerClient.drawCards(drawAmount)
    combatStore.log(`${player.name} 在 ${comp ? getEquipment(comp.equipmentType!)?.name ?? '空舱段' : '?'} 抽 ${drawAmount} 张`, 'system')
    combatStore.resetPerTurnCounters()
    uiStore.resetBattleState()
    combatStore.removeFightersByPlayer(playerId)
    gameStore.advancePhase()
    return
  }

  const playerId = gameStore.currentPlayerId!
  const player = gameStore.currentPlayer
  if (!player || !player.currentShipId) return
  const ship = shipStore.findShip(player.currentShipId)
  if (!ship) return
  const comp = player.currentCompartmentIndex != null ? ship.compartments[player.currentCompartmentIndex] : null
  let drawAmount = comp ? shipStore.getDrawValue(comp) : 1
  const compensation = gameStore.getFirstRoundCompensation(playerId)
  if (compensation > 0) { drawAmount += compensation; combatStore.log(`${player.name} 第一轮后攻补偿 +${compensation}张`, 'system') }
  cardStore.playerDrawCards(playerId, drawAmount)
  combatStore.log(`${player.name} 在 ${comp ? getEquipment(comp.equipmentType!)?.name ?? '空舱段' : '?'} 抽 ${drawAmount} 张`, 'system')
  combatStore.resetPerTurnCounters()
  uiStore.resetBattleState()
  combatStore.removeFightersByPlayer(playerId)
  gameStore.advancePhase()
}

// ===== 卡牌点击 =====
function handlePlayCard(cardId: string): void {
  if (!mpCanAct()) { ElMessage.warning('等待你的回合...'); return }
  if (uiStore.battleState !== 'idle') {
    ElMessage.warning('请先完成当前操作或取消')
    return
  }
  const playerId = gameStore.currentPlayerId!
  const card = cardStore.getPlayerHand(playerId).find(c => c.id === cardId)
  if (!card) return

  switch (card.type) {
    case 'move':
      uiStore.selectedCardIds = [cardId]
      uiStore.pendingAction = 'move'
      uiStore.enterMovingState()
      ElMessage.info('选择目标舱段 (手牌移动: 1格)')
      break
    case 'command':
      uiStore.selectedCardIds = [cardId]
      uiStore.pendingAction = 'command'
      uiStore.isFreeAction = false
      commandCurrentCompartment()
      break
    case 'action':
      uiStore.selectedCardIds = [cardId]
      uiStore.isFreeAction = false
      ElMessageBox({
        title: '万能牌 (行动)',
        message: '选择使用方式：',
        showCancelButton: true,
        confirmButtonText: '移动 (1格)',
        cancelButtonText: '指挥',
        type: 'info',
      }).then(() => {
        uiStore.pendingAction = 'move'
        uiStore.enterMovingState()
        ElMessage.info('选择目标舱段 (手牌移动: 1格)')
      }).catch(() => {
        uiStore.pendingAction = 'command'
        commandCurrentCompartment()
      })
      break
    case 'coffee':
      cardStore.removeCardFromHand(playerId, cardId)
      cardStore.playerDrawCards(playerId, 2)
      combatStore.log(`${gameStore.currentPlayer!.name} 使用咖啡，抽2张牌`, 'system')
      if (isMP.value) {
        multiplayerClient.discardCards([cardId])
        multiplayerClient.drawCards(2)
        multiplayerClient.sendBattleLog(`${gameStore.currentPlayer!.name} 使用咖啡，抽2张牌`, 'system')
      }
      break
    case 'scheme':
      handleSchemeCard(cardId)
      break
  }
}

function handleSchemeCard(cardId: string): void {
  const playerId = gameStore.currentPlayerId!
  const player = gameStore.currentPlayer!
  if (!player) return
  cardStore.removeCardFromHand(playerId, cardId)
  for (const tp of gameStore.players.filter(p => p.teamId === player.teamId && p.isAlive)) {
    cardStore.playerDrawCards(tp.id, 1)
  }
  combatStore.log(`${player.name} 使用谋划，己方全员抽1张牌`, 'system')
  if (isMP.value) {
    multiplayerClient.discardCards([cardId])
    multiplayerClient.sendBattleLog(`${player.name} 使用谋划，己方全员抽1张牌`, 'system')
  }
}

// ===== 自由行动 =====
function handleFreeMove(): void {
  if (!mpCanAct()) { ElMessage.warning('等待你的回合...'); return }
  if (gameStore.freeActionUsed) { ElMessage.warning('自由行动已用'); return }
  if (uiStore.battleState !== 'idle') { ElMessage.warning('请先完成当前操作'); return }
  uiStore.clearCardSelection()
  uiStore.pendingAction = 'move'
  uiStore.isFreeAction = true
  uiStore.enterMovingState()
  ElMessage.info('选择目标舱段 (跑动: 1-2格)')
}

function handleFreeCommand(): void {
  if (!mpCanAct()) { ElMessage.warning('等待你的回合...'); return }
  if (gameStore.freeActionUsed) { ElMessage.warning('自由行动已用'); return }
  if (uiStore.battleState !== 'idle') { ElMessage.warning('请先完成当前操作'); return }
  uiStore.clearCardSelection()
  uiStore.pendingAction = 'command'
  uiStore.isFreeAction = true
  commandCurrentCompartment()
}

function handleFreePass(): void {
  if (gameStore.freeActionUsed) { ElMessage.warning('自由行动已用'); return }
  if (uiStore.battleState !== 'idle') { ElMessage.warning('请先完成当前操作'); return }
  gameStore.useFreeAction()
  ElMessage.info('传递功能待实现')
}

function commandCurrentCompartment(): void {
  const playerId = gameStore.currentPlayerId!
  const player = gameStore.currentPlayer!
  if (!player || !player.currentShipId) {
    uiStore.resetBattleState()
    return
  }
  const ship = shipStore.findShip(player.currentShipId)
  if (!ship) { uiStore.resetBattleState(); return }
  const comp = ship.compartments[player.currentCompartmentIndex ?? 0]
  if (!comp || !comp.equipmentType || comp.isDestroyed) {
    ElMessage.warning('当前舱段没有可指挥的军备')
    uiStore.resetBattleState()
    return
  }
  handleCommandCompartment(comp.id)
}

// ===== 舱段点击 =====
function handleCompartmentClick(compartmentId: string): void {
  const state = uiStore.battleState
  if (state === 'idle') return

  if (state === 'moving') {
    resolveMove(compartmentId)
    return
  }

  if (state === 'targeting_compartment') {
    resolveTargetCompartment(compartmentId)
    return
  }
}

function handleShipClick(shipId: string): void {
  if (uiStore.battleState === 'targeting_ship') {
    resolveTargetShip(shipId)
  }
}

// ===== 移动结算 =====
function resolveMove(compartmentId: string): void {
  const playerId = gameStore.currentPlayerId!
  const player = gameStore.currentPlayer!
  if (!player || !player.currentShipId) { uiStore.resetBattleState(); return }

  const ship = shipStore.findShip(player.currentShipId)
  if (!ship) { uiStore.resetBattleState(); return }

  const targetComp = ship.compartments.find(c => c.id === compartmentId)
  if (!targetComp) { uiStore.resetBattleState(); return }

  const currentIdx = player.currentCompartmentIndex ?? 0
  const distance = Math.abs(targetComp.position - currentIdx)
  if (distance === 0) { ElMessage.warning('不能移动到当前位置'); return }

  const isCardMove = uiStore.pendingAction === 'move' && !uiStore.isFreeAction
  const maxDist = isCardMove ? 1 : 2
  if (distance > maxDist) {
    ElMessage.warning(isCardMove ? '手牌移动只能1格' : '跑动最多2格')
    return
  }

  player.currentCompartmentIndex = targetComp.position
  combatStore.log(`${player.name} 移动到舱段${targetComp.position + 1} (${isCardMove ? '手牌移动' : '跑动'})`, 'system')

  if (uiStore.selectedCardIds.length > 0) {
    cardStore.removeCardFromHand(playerId, uiStore.selectedCardIds[0])
    if (isMP.value) multiplayerClient.discardCards(uiStore.selectedCardIds)
  }
  if (uiStore.isFreeAction) gameStore.useFreeAction()

  if (isMP.value) {
    multiplayerClient.sendBattleLog(`${player.name} 移动到舱段${targetComp.position + 1}`, 'system')
  }

  uiStore.resetBattleState()
  ElMessage.success(`已移动到舱段${targetComp.position + 1}`)
}

// ===== 指挥舱段 =====
function handleCommandCompartment(compartmentId: string): void {
  const playerId = gameStore.currentPlayerId!
  const player = gameStore.currentPlayer!
  if (!player || !player.currentShipId) { uiStore.resetBattleState(); return }

  const ship = shipStore.findShip(player.currentShipId)
  if (!ship) { uiStore.resetBattleState(); return }

  let comp = ship.compartments.find(c => c.id === compartmentId)
  if (!comp) { ElMessage.warning('无效的舱段'); return }

  if (comp.multiCompRootId) {
    const master = ship.compartments.find(c => c.id === comp!.multiCompRootId)
    if (!master || !master.equipmentType) { ElMessage.warning('无效的军备'); return }
    comp = master
  }

  if (comp.multiCompSlaveIds.length > 0) {
    const anySlaveDestroyed = comp.multiCompSlaveIds.some(sid => {
      const s = ship.compartments.find(c => c.id === sid)
      return s?.isDestroyed
    })
    if (anySlaveDestroyed || comp.isDestroyed) {
      ElMessage.warning('此多舱段军备有舱段被击毁，无法使用')
      return
    }
  }

  if (!comp.equipmentType || comp.isDestroyed) {
    ElMessage.warning('无效的指挥目标')
    return
  }

  const eqDef = getEquipment(comp.equipmentType)
  if (eqDef.commands.length === 0) {
    ElMessage.warning('此军备没有可执行的指挥')
    return
  }

  const isRemoteCmd = ['command_room', 'command_center', 'integrated_command'].includes(comp.equipmentType)
  if (!isRemoteCmd && !isPlayerOnCompartment(player, comp, ship)) {
    ElMessage.warning('必须身处该舱段才能指挥')
    return
  }

  if (eqDef.commandsPerTurn > 0) {
    const used = combatStore.getCommandsUsed(compartmentId)
    if (used >= eqDef.commandsPerTurn) {
      ElMessage.warning(`本回合已指挥 ${used}/${eqDef.commandsPerTurn} 次`)
      return
    }
  }

  if (eqDef.tags.includes('hangar')) {
    const hangarShip = shipStore.getShipByCompartment(compartmentId)
    if (hangarShip) {
      const totalCap = hangarShip.compartments
        .filter(c => c.equipmentType && getEquipment(c.equipmentType).tags.includes('hangar') && !c.isDestroyed)
        .reduce((sum, c) => sum + getEquipment(c.equipmentType!).sortieCapacity, 0)
      const usedSorties = combatStore.getOccupiedSortieCount(hangarShip.id)
      if (totalCap > 0 && usedSorties >= totalCap) {
        ElMessage.warning(`本舰出击架次已满 (${usedSorties}/${totalCap})`)
        return
      }
    }
  }

  uiStore.enterCommandingState(compartmentId)
  commandDialogComp.value = comp

  if (eqDef.commands.length > 1) {
    commandDialogOptions.value = eqDef.commands.map(c => ({ id: c.id, name: c.name }))
    showCommandDialog.value = true
  } else {
    handleCommandOptionSelected(eqDef.commands[0].id)
  }
}

function handleCommandOptionSelected(optionId: string): void {
  showCommandDialog.value = false
  const comp = commandDialogComp.value
  if (!comp || !comp.equipmentType) { uiStore.resetBattleState(); return }

  const eqDef = getEquipment(comp.equipmentType)
  const cmd = eqDef.commands.find(c => c.id === optionId)
  if (!cmd) { uiStore.resetBattleState(); return }

  uiStore.pendingCommandId = optionId
  uiStore.selectedSourceCompartmentId = comp.id

  if (cmd.targeting.scope === 'self') {
    executeSelfTargetCommand(comp, optionId)
    return
  }

  if (cmd.targeting.scope === 'enemy-compartment' || cmd.targeting.scope === 'own-compartment') {
    enterCompartmentTargeting(comp, optionId, cmd.targeting.scope)
    return
  }

  if (cmd.targeting.scope === 'enemy-ship' || cmd.targeting.scope === 'own-ship' || cmd.targeting.scope === 'any-compartment') {
    enterShipTargeting(comp, optionId, cmd.targeting.scope)
    return
  }
}

function enterCompartmentTargeting(comp: Compartment, cmdId: string, scope: string): void {
  const player = gameStore.currentPlayer!
  let validIds: string[] = []

  if (scope === 'enemy-compartment') {
    for (const s of shipStore.ships.filter(s => s.ownerTeamId !== player.teamId)) {
      const living = shipStore.getLivingCompartments(s.id)
        .filter(c => !combatStore.isCompartmentSmoked(c.id))
      validIds.push(...living.map(c => c.id))
    }
  } else if (scope === 'own-compartment') {
    const sourceShip = shipStore.getShipByCompartment(comp.id)
    if (sourceShip) {
      const living = shipStore.getLivingCompartments(sourceShip.id)
      validIds.push(...living.map(c => c.id))
    }
  }

  if (validIds.length === 0) {
    ElMessage.warning('没有可用的目标')
    uiStore.resetBattleState()
    return
  }

  uiStore.enterTargetingCompartment(comp.id, cmdId, validIds)
  ElMessage.info(`请选择目标舱段 (${validIds.length}个可选)`)
}

function enterShipTargeting(comp: Compartment, cmdId: string, scope: string): void {
  const player = gameStore.currentPlayer!
  let validIds: string[] = []

  if (scope === 'enemy-ship') {
    validIds = shipStore.ships
      .filter(s => s.ownerTeamId !== player.teamId && shipStore.getLivingCompartments(s.id).length > 0)
      .map(s => s.id)
  } else if (scope === 'own-ship') {
    validIds = shipStore.ships
      .filter(s => s.ownerTeamId === player.teamId && shipStore.getLivingCompartments(s.id).length > 0)
      .map(s => s.id)
  } else {
    validIds = shipStore.ships
      .filter(s => shipStore.getLivingCompartments(s.id).length > 0)
      .map(s => s.id)
  }

  if (validIds.length === 0) {
    ElMessage.warning('没有可用的目标')
    uiStore.resetBattleState()
    return
  }

  uiStore.enterTargetingShip(comp.id, cmdId, validIds)
  ElMessage.info(`请选择目标舰船 (${validIds.length}艘可选)`)
}

function resolveTargetCompartment(targetCompId: string): void {
  const sourceCompId = uiStore.selectedSourceCompartmentId
  const cmdId = uiStore.pendingCommandId
  if (!sourceCompId || !cmdId) { uiStore.resetBattleState(); return }

  const comp = shipStore.findCompartment(sourceCompId)
  if (!comp || !comp.equipmentType) { uiStore.resetBattleState(); return }

  if (!uiStore.validTargetCompartmentIds.includes(targetCompId)) {
    ElMessage.warning('无效的目标')
    return
  }

  commandDialogComp.value = comp
  executeTargetedCommand(comp, cmdId, targetCompId)
  uiStore.resetBattleState()
}

function resolveTargetShip(targetShipId: string): void {
  const sourceCompId = uiStore.selectedSourceCompartmentId
  const cmdId = uiStore.pendingCommandId
  if (!sourceCompId || !cmdId) { uiStore.resetBattleState(); return }

  const comp = shipStore.findCompartment(sourceCompId)
  if (!comp || !comp.equipmentType) { uiStore.resetBattleState(); return }

  if (!uiStore.validTargetShipIds.includes(targetShipId)) {
    ElMessage.warning('无效的目标')
    return
  }

  commandDialogComp.value = comp
  executeTargetedCommand(comp, cmdId, targetShipId)
  uiStore.resetBattleState()
}

function cancelTargeting(): void {
  uiStore.resetBattleState()
  ElMessage.info('已取消')
}

function executeSelfTargetCommand(comp: Compartment, cmdId: string): void {
  executeTargetedCommand(comp, cmdId, comp.id)
  uiStore.resetBattleState()
}

function executeTargetedCommand(
  comp: Compartment,
  cmdId: string,
  targetId: string,
  isRelay: boolean = false
): void {
  if (!comp.equipmentType) return
  const playerId = gameStore.currentPlayerId!
  const player = gameStore.currentPlayer!
  if (!player) return

  const eqType = comp.equipmentType
  const eqDef = getEquipment(eqType)

  combatStore.useCommand(comp.id)

  if (!isRelay) {
    if (uiStore.selectedCardIds.length > 0) {
      cardStore.removeCardFromHand(playerId, uiStore.selectedCardIds[0])
      if (isMP.value && !replayingRemote) multiplayerClient.discardCards(uiStore.selectedCardIds)
    }
    if (uiStore.isFreeAction) gameStore.useFreeAction()
  }

  switch (eqType) {
    case 'dual_cannon':
    case 'triple_cannon': {
      const isDual = eqType === 'dual_cannon'
      const isBlind = cmdId.includes('blindfire')

      let hitCompId: string | null = null
      const d8 = rollDice('D8')

      if (isBlind) {
        if (d8 < 3 || d8 > 6) {
          combatStore.log(`[盲射 D8=${d8}] 未命中!`, 'info')
          return
        }
        const targetShip = shipStore.findShip(targetId)
        if (!targetShip) return
        const living = shipStore.getLivingCompartments(targetShip.id)
        if (living.length === 0) return
        hitCompId = living[Math.floor(Math.random() * living.length)].id
      } else {
        const targetShip = shipStore.getShipByCompartment(targetId)
        const hasAB = targetShip?.compartments.some(c => c.equipmentType === 'afterburner' && !c.isDestroyed)
        combatStore.log(`[射击 D8=${d8}] ${hasAB ? '目标有加力引擎' : ''}`, 'system')

        if (hasAB) {
          if (d8 === 4 || d8 === 5) hitCompId = targetId
          else if (d8 === 3) hitCompId = adjacentComp(targetId, -1)
          else if (d8 === 6) hitCompId = adjacentComp(targetId, 1)
        } else {
          if (d8 >= 3 && d8 <= 6) hitCompId = targetId
          else if (d8 === 2) hitCompId = adjacentComp(targetId, -1)
          else if (d8 === 7) hitCompId = adjacentComp(targetId, 1)
        }
      }

      if (!hitCompId) {
        combatStore.log(`${eqDef.name} 未命中!`, 'info')
        return
      }

      const dmgCount = isDual ? 2 : 3
      const dmgResults = rollMultiple('D6', dmgCount)
      const totalDmg = dmgResults.reduce((a, b) => a + b, 0)
      combatStore.log(`[伤害] ${dmgCount}D6 = ${totalDmg}`, 'system')
      applyHitDamage(hitCompId, totalDmg, eqDef.name)
      break
    }

    case 'quad_torpedo': {
      if (cmdId === 'quad_torpedo_load') {
        if (combatStore.isTorpedoLoaded(comp.id)) {
          ElMessage.warning('鱼雷已装填，无需重复装填')
          return
        }
        combatStore.setTorpedoLoaded(comp.id, true)
        combatStore.log(`${player.name} 装填鱼雷`, 'system')
        ElMessage.success('鱼雷已装填，使用【发射】指令发射')
      } else if (cmdId === 'quad_torpedo_fire') {
        if (!combatStore.isTorpedoLoaded(comp.id)) {
          ElMessage.warning('鱼雷未装填，请先装填')
          return
        }
        const fullRound = gameStore.alivePlayerCount
        combatStore.addTorpedoSalvo(comp.id, targetId, 4, fullRound)
        combatStore.setTorpedoLoaded(comp.id, false)
        combatStore.log(`鱼雷发射! 4颗, ${fullRound}全回合后到达`, 'system')
        ElMessage.success('4颗鱼雷发射!')
      }
      break
    }

    case 'small_hangar':
    case 'large_hangar': {
      const tgtShipId = targetId
      if (cmdId.includes('fighter')) {
        combatStore.addFighterToken(tgtShipId, player.teamId, comp.id, playerId, gameStore.alivePlayerCount)
        combatStore.log(`战斗机起飞 → ${shipStore.findShip(tgtShipId)?.name ?? tgtShipId}, 空优+2`, 'effect')
      } else if (cmdId.includes('bomber')) {
        const nfa = getFullAirSuperiority(tgtShipId, player.teamId)
        const d12 = rollDice('D12')
        const dmg = Math.max(0, 16 - nfa * d12)
        combatStore.log(`[轰炸机] 非我方空优=${nfa}, D12=${d12}, 伤害=${dmg}`, 'system')
        applyHitDamageToRandom(tgtShipId, dmg, '轰炸机')
      } else if (cmdId.includes('torpedo')) {
        const nfa = getFullAirSuperiority(tgtShipId, player.teamId)
        const d12 = rollDice('D12')
        const dmg = Math.max(0, d12 - nfa * 2)
        combatStore.log(`[鱼雷机] 非我方空优=${nfa}, D12=${d12}, 伤害=${dmg}`, 'system')
        applyHitDamageToRandom(tgtShipId, dmg, '鱼雷机')
      }
      break
    }

    case 'smoke_generator': {
      const adj = shipStore.getAdjacentCompartments(comp.id, 2)
      const affected = [comp.id, ...adj.map(c => c.id)]
      const isShort = cmdId === 'smoke_short'
      const turns = isShort ? Math.ceil(gameStore.alivePlayerCount / 2) : gameStore.alivePlayerCount
      combatStore.addEffect(isShort ? 'smoke_short' : 'smoke_long', comp.id, affected, turns)
      combatStore.log(`烟幕 (${isShort ? '半' : '全'}回合): ${turns}回合`, 'effect')
      break
    }

    case 'damage_control': {
      if (cmdId === 'damage_control_repair') {
        const adj = shipStore.getAdjacentCompartments(comp.id, 2)
        shipStore.healCompartment(comp.id, 2)
        for (const ac of adj) shipStore.healCompartment(ac.id, 2)
        combatStore.log('综合修复 HP+2', 'effect')
      } else {
        const adj = shipStore.getAdjacentCompartments(comp.id, 2)
        if (adj.length > 0) {
          shipStore.healCompartment(adj[0].id, 8)
          combatStore.log('快速抢修 HP+8', 'effect')
        }
      }
      break
    }

    case 'command_room':
    case 'command_center':
    case 'integrated_command': {
      const tgtComp = shipStore.findCompartment(targetId)
      if (tgtComp && tgtComp.equipmentType) {
        const tgtEq = getEquipment(tgtComp.equipmentType)
        if (tgtEq.commands.length > 0) {
          combatStore.log(`${player.name} 发令 → ${tgtEq.name}`, 'system')
          const relayedCmd = tgtEq.commands[0]
          let relayTarget = targetId
          if (relayedCmd.targeting.scope === 'enemy-compartment' || relayedCmd.targeting.scope === 'enemy-ship') {
            const enemyShip = shipStore.ships.find(s => s.ownerTeamId !== player.teamId && shipStore.getLivingCompartments(s.id).length > 0)
            if (enemyShip) {
              const living = shipStore.getLivingCompartments(enemyShip.id).filter(c => !combatStore.isCompartmentSmoked(c.id))
              relayTarget = living.length > 0 ? living[0].id : enemyShip.id
            }
          } else if (relayedCmd.targeting.scope === 'own-ship' || relayedCmd.targeting.scope === 'own-compartment') {
            const ownShip = shipStore.findShip(player.currentShipId!)
            if (ownShip) {
              const living = shipStore.getLivingCompartments(ownShip.id)
              relayTarget = living.length > 0 ? living[0].id : ownShip.id
            }
          }
          executeTargetedCommand(tgtComp, relayedCmd.id, relayTarget, true)
        }
      }
      break
    }

    case 'depth_charge': {
      const targetShip = shipStore.findShip(targetId)
      if (!targetShip) {
        ElMessage.warning('目标舰船不存在')
        return
      }
      const torps = combatStore.pendingTorpedoes.filter(t => {
        const ts = shipStore.getShipByCompartment(t.targetCompartmentId)
        return ts?.id === targetShip.id
      })
      if (torps.length === 0) {
        ElMessage.info('该舰船没有瞄准中的鱼雷')
        combatStore.log(`深水炸弹: ${targetShip.name} 没有被鱼雷瞄准`, 'info')
        return
      }
      let totalNegated = 0
      let totalCount = 0
      for (const t of torps) {
        const originalCount = t.torpedoCount
        for (let i = 0; i < originalCount; i++) {
          totalCount++
          if (Math.random() < 0.5) {
            t.torpedoCount--
            totalNegated++
          }
        }
        if (t.torpedoCount <= 0) {
          combatStore.pendingTorpedoes = combatStore.pendingTorpedoes.filter(pt => pt.id !== t.id)
        }
      }
      combatStore.log(`深水炸弹 → ${targetShip.name}: ${totalNegated}/${totalCount}颗鱼雷被拦截`, 'effect')
      ElMessage.success(`${totalNegated}/${totalCount}颗鱼雷被拦截`)
      break
    }

    default:
      combatStore.log(`${eqDef.name} 效果执行`, 'info')
  }

  // 弹药库效果
  if (eqDef.category === 'combat') {
    const compShip = shipStore.getShipByCompartment(comp.id)
    if (compShip) {
      const adj = shipStore.getAdjacentCompartments(comp.id, 1)
      const hasAmmoDepot = adj.some(c => c.equipmentType === 'ammo_depot' && !c.isDestroyed)
      if (hasAmmoDepot) {
        cardStore.addCardToHand(playerId, 'command')
        combatStore.log('弹药库效果: 返还一张指挥牌', 'effect')
      }
    }
  }

  // 多人模式: 广播操作
  if (isMP.value && !replayingRemote && !isRelay) {
    multiplayerClient.sendBattleLog(`${player.name} 使用 ${eqDef.name}`, 'system')
  }
}

// ===== 伤害 =====
function applyHitDamage(compId: string, damage: number, source: string): void {
  const comp = shipStore.findCompartment(compId)
  if (!comp) return
  const result = shipStore.applyDamage(compId, damage)
  combatStore.log(`${source} → ${compId} ${damage}伤害${result.destroyed ? ' — 击毁!' : ''}`, result.destroyed ? 'destroy' : 'damage')
  if (result.destroyed) handleCompDestroyed(compId)
}

function applyHitDamageToRandom(shipId: string, damage: number, source: string): void {
  const living = shipStore.getLivingCompartments(shipId)
  if (living.length === 0) { combatStore.log(`${source}: 无存活舱段`, 'info'); return }
  applyHitDamage(living[Math.floor(Math.random() * living.length)].id, damage, source)
}

function handleCompDestroyed(compId: string): void {
  const comp = shipStore.findCompartment(compId)
  if (!comp) return
  if (comp.equipmentType === 'ammo_depot') ammoExplosion(compId)
  if (comp.equipmentType === 'quad_torpedo') torpExplosion(compId)
  const ship = shipStore.getShipByCompartment(compId)
  if (ship && shipStore.isShipSunk(ship.id)) {
    combatStore.log(`${ship.name} 战沉!`, 'destroy')
    shipSunk(ship.id)
  }
  gameStore.checkWinCondition()
}

function ammoExplosion(compId: string): void {
  const adj = shipStore.getAdjacentCompartments(compId, 1)
  combatStore.log('弹药库殉爆! 殉爆8', 'destroy')
  for (const c of adj) { const r = shipStore.applyDamage(c.id, 8); if (r.destroyed) handleCompDestroyed(c.id) }
}

function torpExplosion(compId: string): void {
  const adj = shipStore.getAdjacentCompartments(compId, 1)
  combatStore.log('鱼雷殉爆! 殉爆5', 'destroy')
  for (const c of adj) shipStore.applyDamage(c.id, 5)
}

function shipSunk(shipId: string): void {
  const ship = shipStore.findShip(shipId)
  if (!ship) return
  for (const p of gameStore.players) {
    if (p.currentShipId === shipId) gameStore.eliminatePlayer(p.id)
  }
  if (shipStore.isTeamDefeated(ship.ownerTeamId)) {
    combatStore.log(`队伍 ${ship.ownerTeamId} 全军覆没!`, 'destroy')
  }
}

function adjacentComp(compId: string, offset: number): string | null {
  const ship = shipStore.getShipByCompartment(compId)
  if (!ship) return null
  const comp = ship.compartments.find(c => c.id === compId)
  if (!comp) return null
  const adj = ship.compartments.find(c => c.position === comp.position + offset)
  return adj?.id ?? null
}

function isPlayerOnCompartment(player: any, comp: any, ship: any): boolean {
  if (player.currentCompartmentIndex === comp.position) return true
  const playerComp = ship.compartments[player.currentCompartmentIndex]
  if (!playerComp) return false
  if (playerComp.multiCompSlaveIds.includes(comp.id)) return true
  if (playerComp.multiCompRootId === comp.id) return true
  if (playerComp.multiCompRootId && playerComp.multiCompRootId === comp.multiCompRootId) return true
  return false
}

function getFullAirSuperiority(shipId: string, teamId: string): number {
  const ship = shipStore.findShip(shipId)
  if (!ship) return combatStore.getAirSuperiority(shipId, teamId)

  const ownFighterAS = combatStore.fighterTokens
    .filter(t => t.shipId === shipId && t.ownerTeamId === teamId).length * 2
  const enemyFighterAS = combatStore.fighterTokens
    .filter(t => t.shipId === shipId && t.ownerTeamId !== teamId).length * 2

  let aaBonus = 0
  for (const c of ship.compartments) {
    if (c.equipmentType === 'aa_gun' && !c.isDestroyed) {
      aaBonus += 3
    }
  }

  const ownAS = ownFighterAS + (ship.ownerTeamId === teamId ? aaBonus : 0)
  const enemyAS = enemyFighterAS + (ship.ownerTeamId !== teamId ? aaBonus : 0)
  return Math.max(0, enemyAS - ownAS)
}

// ===== 回合结束 =====
function handleEndTurn(): void {
  const playerId = gameStore.currentPlayerId!
  const ship = gameStore.currentPlayer?.currentShipId
    ? shipStore.findShip(gameStore.currentPlayer.currentShipId) : null
  cardStore.discardDownTo(playerId, ship?.compartments.length ?? 5)
  combatStore.tickEffects()
  combatStore.tickFighterTurns()
  combatStore.resetPerTurnCounters()

  for (const torp of combatStore.tickTorpedoes()) {
    for (let i = 0; i < torp.torpedoCount; i++) {
      applyHitDamage(torp.targetCompartmentId, rollDice('D12'), '鱼雷')
    }
  }

  uiStore.resetBattleState()
  if (isMP.value) {
    multiplayerClient.sendEndTurn()
    multiplayerClient.sendBattleLog(`${gameStore.currentPlayer!.name} 结束回合`, 'system')
    // 通知服务器弃牌
    multiplayerClient.discardDownTo(ship?.compartments.length ?? 5)
    return
  }
  if (gameStore.currentTurnPhase === 'action') {
    gameStore.advancePhase()
  }
  if (gameStore.currentTurnPhase === 'discard') {
    gameStore.advancePhase()
  }
}

watch(() => gameStore.phase, p => { if (p === 'results') router.push('/results') })
</script>

<template>
  <div class="battle-view">
    <!-- 出生点 -->
    <el-dialog v-model="showSpawnDialog" :title="`${spawnPlayerName} — 选择出生点`" width="500px" :close-on-click-modal="false" :show-close="false">
      <div class="spawn-grid">
        <div v-for="ship in shipStore.ships.filter(s => s.ownerTeamId === myTeamId)" :key="ship.id" class="spawn-ship">
          <h4>{{ ship.name }}</h4>
          <div class="spawn-comps">
            <div v-for="comp in ship.compartments" :key="comp.id" class="spawn-comp"
                 :class="{ destroyed: comp.isDestroyed }"
                 @click="handleSpawnSelect(comp.id)">
              <strong>舱段{{ comp.position + 1 }}</strong>
              <span>{{ comp.multiCompRootId ? getEquipment(ship.compartments.find(c => c.id === comp.multiCompRootId)?.equipmentType!)?.name ?? '[从属]' : (getEquipment(comp.equipmentType!)?.name ?? '空') }}</span>
              <span class="spawn-hp">HP: {{ comp.currentHp }}/{{ comp.maxHp }}</span>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 指挥选项 -->
    <CommandDialog v-if="showCommandDialog" :options="commandDialogOptions"
      :compartment="commandDialogComp!" @select="handleCommandOptionSelected"
      @cancel="showCommandDialog = false; uiStore.resetBattleState()" />

    <!-- 热座过渡 -->
    <TurnTransition v-if="transitionVisible" :to-player-name="transitionToName" @confirm="onTransitionConfirm" />

    <div class="battle-layout">
      <div class="battle-main">
        <GameBoard
          @compartment-click="handleCompartmentClick"
          @ship-click="handleShipClick"
          @cancel-targeting="cancelTargeting"
        />

        <ActionBar
          @free-move="handleFreeMove"
          @free-command="handleFreeCommand"
          @free-pass="handleFreePass"
          @end-turn="handleEndTurn"
        />

        <PlayerHand @play-card="handlePlayCard" />
      </div>

      <CombatLog />
    </div>
  </div>
</template>

<style scoped>
.battle-view { height: calc(100vh - 60px); overflow: hidden; }
.battle-layout { display: flex; height: 100%; }
.battle-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.spawn-grid { display: flex; flex-direction: column; gap: 12px; }
.spawn-ship h4 { color: #a0b8d0; margin-bottom: 6px; }
.spawn-comps { display: flex; gap: 8px; flex-wrap: wrap; }
.spawn-comp { background: rgba(20, 50, 80, 0.6); border: 2px solid #3a5a7f; border-radius: 8px; padding: 10px; cursor: pointer; text-align: center; min-width: 100px; transition: all 0.15s; }
.spawn-comp:hover { border-color: #67c23a; box-shadow: 0 0 12px rgba(103, 194, 58, 0.3); }
.spawn-comp strong { display: block; font-size: 14px; margin-bottom: 4px; }
.spawn-comp span { display: block; font-size: 11px; color: #a0b8d0; }
.spawn-hp { color: #6a8aaa !important; }
</style>
