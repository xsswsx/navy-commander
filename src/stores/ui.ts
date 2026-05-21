import { defineStore } from 'pinia'
import { ref } from 'vue'

export type BattleActionState =
  | 'idle'
  | 'moving'
  | 'commanding'
  | 'targeting_compartment'
  | 'targeting_ship'

export const useUiStore = defineStore('ui', () => {
  // 热座隐私
  const showTurnTransition = ref(false)
  const transitionFromPlayer = ref('')
  const transitionToPlayer = ref('')

  // 弹窗管理
  const showDiceOverlay = ref(false)
  const showTargetSelector = ref(false)
  const showCombatLog = ref(false)

  // 战斗流程状态机
  const battleState = ref<BattleActionState>('idle')
  const validTargetCompartmentIds = ref<string[]>([])
  const validTargetShipIds = ref<string[]>([])
  const selectedSourceCompartmentId = ref<string | null>(null)
  const pendingCommandId = ref<string | null>(null)
  const isFreeAction = ref(false)

  // 手牌选择
  const selectedCardIds = ref<string[]>([])
  const pendingAction = ref<'move' | 'command' | 'pass' | null>(null)
  const selectedEquipmentType = ref<string | null>(null)

  // 确认对话框
  const confirmDialog = ref<{
    title: string
    message: string
    onConfirm: () => void
    onCancel?: () => void
  } | null>(null)

  // 通用设置
  const animationsEnabled = ref(true)

  // ===== 战斗状态机 =====
  function setBattleState(state: BattleActionState): void {
    battleState.value = state
  }

  function enterMovingState(): void {
    battleState.value = 'moving'
    validTargetCompartmentIds.value = []
    validTargetShipIds.value = []
  }

  function enterCommandingState(sourceCompId: string): void {
    battleState.value = 'commanding'
    selectedSourceCompartmentId.value = sourceCompId
    validTargetCompartmentIds.value = []
    validTargetShipIds.value = []
  }

  function enterTargetingCompartment(
    sourceCompId: string,
    commandId: string,
    validCompIds: string[]
  ): void {
    battleState.value = 'targeting_compartment'
    selectedSourceCompartmentId.value = sourceCompId
    pendingCommandId.value = commandId
    validTargetCompartmentIds.value = validCompIds
    validTargetShipIds.value = []
  }

  function enterTargetingShip(
    sourceCompId: string,
    commandId: string,
    validShipIds: string[]
  ): void {
    battleState.value = 'targeting_ship'
    selectedSourceCompartmentId.value = sourceCompId
    pendingCommandId.value = commandId
    validTargetShipIds.value = validShipIds
    validTargetCompartmentIds.value = []
  }

  function resetBattleState(): void {
    battleState.value = 'idle'
    validTargetCompartmentIds.value = []
    validTargetShipIds.value = []
    selectedSourceCompartmentId.value = null
    pendingCommandId.value = null
    isFreeAction.value = false
    selectedCardIds.value = []
    pendingAction.value = null
  }

  // ===== 回合过渡 =====
  function openTurnTransition(fromName: string, toName: string): void {
    showTurnTransition.value = true
    transitionFromPlayer.value = fromName
    transitionToPlayer.value = toName
  }

  function closeTurnTransition(): void {
    showTurnTransition.value = false
    transitionFromPlayer.value = ''
    transitionToPlayer.value = ''
  }

  // ===== 卡牌选择 =====
  function toggleCardSelection(cardId: string): void {
    const idx = selectedCardIds.value.indexOf(cardId)
    if (idx === -1) {
      selectedCardIds.value.push(cardId)
    } else {
      selectedCardIds.value.splice(idx, 1)
    }
  }

  function clearCardSelection(): void {
    selectedCardIds.value = []
    pendingAction.value = null
  }

  // ===== 确认对话框 =====
  function showConfirm(
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void
  ): void {
    confirmDialog.value = { title, message, onConfirm, onCancel }
  }

  function closeConfirm(): void {
    confirmDialog.value = null
  }

  function resetUiStore(): void {
    showTurnTransition.value = false
    transitionFromPlayer.value = ''
    transitionToPlayer.value = ''
    showDiceOverlay.value = false
    showTargetSelector.value = false
    showCombatLog.value = false
    resetBattleState()
    selectedEquipmentType.value = null
    confirmDialog.value = null
  }

  return {
    showTurnTransition,
    transitionFromPlayer,
    transitionToPlayer,
    showDiceOverlay,
    showTargetSelector,
    showCombatLog,
    battleState,
    validTargetCompartmentIds,
    validTargetShipIds,
    selectedSourceCompartmentId,
    pendingCommandId,
    isFreeAction,
    selectedCardIds,
    pendingAction,
    selectedEquipmentType,
    confirmDialog,
    animationsEnabled,
    setBattleState,
    enterMovingState,
    enterCommandingState,
    enterTargetingCompartment,
    enterTargetingShip,
    resetBattleState,
    openTurnTransition,
    closeTurnTransition,
    toggleCardSelection,
    clearCardSelection,
    showConfirm,
    closeConfirm,
    resetUiStore,
  }
})
