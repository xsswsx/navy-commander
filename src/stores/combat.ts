import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  ActiveEffect,
  TorpedoSalvo,
  FighterToken,
  LogEntry,
  DiceRoll,
  TargetingState,
} from '@/game/types'

export const useCombatStore = defineStore('combat', () => {
  const activeEffects = ref<ActiveEffect[]>([])
  const pendingTorpedoes = ref<TorpedoSalvo[]>([])
  const fighterTokens = ref<FighterToken[]>([])
  const combatLog = ref<LogEntry[]>([])
  const pendingDiceRolls = ref<DiceRoll[]>([])
  const targetingState = ref<TargetingState | null>(null)

  /** 每回合每个舱段被指挥的次数 compartmentId -> count */
  const commandsUsedThisTurn = ref<Record<string, number>>({})

  /** 每回合每个机库的出击次数 hangerCompartmentId -> count */
  const sortiesUsedThisTurn = ref<Record<string, number>>({})

  /** 鱼雷装填状态 compartmentId -> loaded */
  const torpedoLoaded = ref<Record<string, boolean>>({})

  let effectIdCounter = 0
  let torpIdCounter = 0
  let tokenIdCounter = 0
  let logIdCounter = 0

  // ===== 效果管理 =====
  function addEffect(
    effectType: ActiveEffect['effectType'],
    sourceCompartmentId: string,
    affectedCompartmentIds: string[],
    remainingTurns: number
  ): string {
    const id = `effect_${++effectIdCounter}`
    activeEffects.value.push({
      id,
      effectType,
      sourceCompartmentId,
      affectedCompartmentIds,
      remainingTurns,
    })
    return id
  }

  function removeEffect(effectId: string): void {
    activeEffects.value = activeEffects.value.filter((e) => e.id !== effectId)
  }

  function tickEffects(): void {
    activeEffects.value = activeEffects.value.filter((e) => {
      e.remainingTurns--
      return e.remainingTurns > 0
    })
  }

  function isCompartmentSmoked(compartmentId: string): boolean {
    return activeEffects.value.some(
      (e) =>
        (e.effectType === 'smoke_short' || e.effectType === 'smoke_long') &&
        e.affectedCompartmentIds.includes(compartmentId)
    )
  }

  // ===== 鱼雷管理 =====
  function addTorpedoSalvo(
    sourceCompartmentId: string,
    targetCompartmentId: string,
    torpedoCount: number,
    remainingTurns: number
  ): string {
    const id = `torp_${++torpIdCounter}`
    pendingTorpedoes.value.push({
      id,
      sourceCompartmentId,
      targetCompartmentId,
      torpedoCount,
      remainingTurns,
    })
    return id
  }

  function tickTorpedoes(): TorpedoSalvo[] {
    const resolved: TorpedoSalvo[] = []
    pendingTorpedoes.value = pendingTorpedoes.value.filter((t) => {
      t.remainingTurns--
      if (t.remainingTurns <= 0) {
        resolved.push(t)
        return false
      }
      return true
    })
    return resolved
  }

  // ===== 战斗机管理 =====
  function addFighterToken(
    shipId: string,
    ownerTeamId: string,
    sourceCompartmentId: string,
    sourcePlayerId: string,
    remainingTurns: number
  ): string {
    const id = `fighter_${++tokenIdCounter}`
    fighterTokens.value.push({
      id,
      shipId,
      ownerTeamId,
      occupiesSortie: true,
      sourceCompartmentId,
      sourcePlayerId,
      remainingTurns,
    })
    return id
  }

  /** 移除指定玩家派出的所有战斗机 (该玩家回合开始时调用) */
  function removeFightersByPlayer(playerId: string): void {
    fighterTokens.value = fighterTokens.value.filter(t => t.sourcePlayerId !== playerId)
  }

  /** 每个回合结束时递减战斗机剩余回合 (0回合的在下个回合开始移除) */
  function tickFighterTurns(): void {
    for (const t of fighterTokens.value) {
      if (t.remainingTurns > 0) t.remainingTurns--
    }
  }

  function removeFighterToken(tokenId: string): void {
    const token = fighterTokens.value.find((t) => t.id === tokenId)
    if (token) {
      token.occupiesSortie = false
    }
    fighterTokens.value = fighterTokens.value.filter((t) => t.id !== tokenId)
  }

  /** 获取某舰船上占用的战斗机架次 */
  function getOccupiedSortieCount(shipId: string): number {
    return fighterTokens.value.filter(
      (t) => t.shipId === shipId && t.occupiesSortie
    ).length
  }

  function getAirSuperiority(shipId: string, teamId: string): number {
    const ownFighters = fighterTokens.value.filter(
      (t) => t.shipId === shipId && t.ownerTeamId === teamId
    ).length * 2
    const enemyFighters = fighterTokens.value.filter(
      (t) => t.shipId === shipId && t.ownerTeamId !== teamId
    ).length * 2
    // 非我方空优 = 敌方空优 - 我方空优，不为负数
    return Math.max(0, enemyFighters - ownFighters)
  }

  // ===== 战斗日志 =====
  function log(message: string, type: LogEntry['type'] = 'info'): void {
    combatLog.value.push({
      id: `log_${++logIdCounter}`,
      timestamp: Date.now(),
      message,
      type,
    })
    if (combatLog.value.length > 500) {
      combatLog.value = combatLog.value.slice(-300)
    }
  }

  // ===== 目标选择 =====
  function setTargetingState(state: TargetingState | null): void {
    targetingState.value = state
  }

  function clearTargeting(): void {
    targetingState.value = null
  }

  // ===== 鱼雷装填状态 =====
  function isTorpedoLoaded(compartmentId: string): boolean {
    return torpedoLoaded.value[compartmentId] ?? false
  }

  function setTorpedoLoaded(compartmentId: string, loaded: boolean): void {
    torpedoLoaded.value[compartmentId] = loaded
  }

  // ===== 每回合指挥/出击次数管理 =====
  function getCommandsUsed(compartmentId: string): number {
    return commandsUsedThisTurn.value[compartmentId] ?? 0
  }

  function useCommand(compartmentId: string): void {
    commandsUsedThisTurn.value[compartmentId] =
      (commandsUsedThisTurn.value[compartmentId] ?? 0) + 1
  }

  function getSortiesUsed(compartmentId: string): number {
    return sortiesUsedThisTurn.value[compartmentId] ?? 0
  }

  function useSortie(compartmentId: string): void {
    sortiesUsedThisTurn.value[compartmentId] =
      (sortiesUsedThisTurn.value[compartmentId] ?? 0) + 1
  }

  function resetPerTurnCounters(): void {
    commandsUsedThisTurn.value = {}
    sortiesUsedThisTurn.value = {}
  }

  function resetCombatStore(): void {
    activeEffects.value = []
    pendingTorpedoes.value = []
    fighterTokens.value = []
    combatLog.value = []
    pendingDiceRolls.value = []
    targetingState.value = null
    commandsUsedThisTurn.value = {}
    sortiesUsedThisTurn.value = {}
    torpedoLoaded.value = {}
    effectIdCounter = 0
    torpIdCounter = 0
    tokenIdCounter = 0
    logIdCounter = 0
  }

  return {
    activeEffects,
    pendingTorpedoes,
    fighterTokens,
    combatLog,
    pendingDiceRolls,
    targetingState,
    commandsUsedThisTurn,
    sortiesUsedThisTurn,
    addEffect,
    removeEffect,
    tickEffects,
    isCompartmentSmoked,
    addTorpedoSalvo,
    tickTorpedoes,
    addFighterToken,
    removeFighterToken,
    removeFightersByPlayer,
    tickFighterTurns,
    getOccupiedSortieCount,
    getAirSuperiority,
    log,
    setTargetingState,
    clearTargeting,
    getCommandsUsed,
    useCommand,
    getSortiesUsed,
    useSortie,
    resetPerTurnCounters,
    resetCombatStore,
    isTorpedoLoaded,
    setTorpedoLoaded,
  }
})
