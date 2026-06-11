// server/data/CombatState.ts
// 数据层：纯函数。每个函数 (state, ...params) → { state, ...outputs }
// 不掷骰子、不发 socket、不做权限检查。

import type {
  ServerCombatState, ServerCompartment, ServerShip,
  ServerFighterToken, ServerTorpedoSalvo, ServerActiveEffect,
} from '../combatState.js'

// ===== helpers =====
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function findCompartmentIndex(
  state: ServerCombatState, compId: string
): { shipIdx: number; compIdx: number } | null {
  for (let si = 0; si < state.ships.length; si++) {
    const ci = state.ships[si].compartments.findIndex(c => c.compId === compId)
    if (ci !== -1) return { shipIdx: si, compIdx: ci }
  }
  return null
}

// ===== Mutation Functions =====

export interface DamageResult {
  state: ServerCombatState
  destroyed: boolean
}

/** 对舱段施加伤害，血量归零时标记 isDestroyed */
export function applyDamage(
  state: ServerCombatState, compId: string, damage: number
): DamageResult {
  const idx = findCompartmentIndex(state, compId)
  if (!idx) return { state, destroyed: false }

  const s = clone(state)
  const comp = s.ships[idx.shipIdx].compartments[idx.compIdx]

  if (comp.isDestroyed) return { state: s, destroyed: false }

  comp.currentHp = Math.max(0, comp.currentHp - damage)
  const destroyed = comp.currentHp <= 0
  if (destroyed) {
    comp.isDestroyed = true
  }

  return { state: s, destroyed }
}

/** 维修血量，不超过 maxHp */
export function healCompartment(
  state: ServerCombatState, compId: string, amount: number
): ServerCombatState {
  const idx = findCompartmentIndex(state, compId)
  if (!idx) return state

  const s = clone(state)
  const comp = s.ships[idx.shipIdx].compartments[idx.compIdx]
  if (comp.isDestroyed) return state

  comp.currentHp = Math.min(comp.currentHp + amount, comp.maxHp)
  return s
}

/** 玩家移动 */
export function movePlayer(
  state: ServerCombatState, slotIndex: number, shipId: string, compIndex: number
): ServerCombatState {
  const s = clone(state)
  s.playerPositions[slotIndex] = { shipId, compIndex }
  return s
}

/** 设置鱼雷装填状态 */
export function setTorpedoLoaded(
  state: ServerCombatState, compId: string, loaded: boolean
): ServerCombatState {
  const s = clone(state)
  s.torpedoLoaded[compId] = loaded
  return s
}

/** 记录一次指挥使用 */
export function useCommand(
  state: ServerCombatState, compId: string
): ServerCombatState {
  const s = clone(state)
  s.commandsUsed[compId] = (s.commandsUsed[compId] ?? 0) + 1
  return s
}

/** 记录一次出击 */
export function useSortie(
  state: ServerCombatState, compId: string
): ServerCombatState {
  const s = clone(state)
  s.sortiesUsed[compId] = (s.sortiesUsed[compId] ?? 0) + 1
  return s
}

/** 标记弹药库本回合已使用 */
export function markAmmoDepotUsed(
  state: ServerCombatState, compId: string
): ServerCombatState {
  const s = clone(state)
  s.ammoDepotUsed[compId] = true
  return s
}

/** 重置每回合计数器 */
export function resetPerTurn(state: ServerCombatState): ServerCombatState {
  const s = clone(state)
  s.commandsUsed = {}
  s.sortiesUsed = {}
  s.ammoDepotUsed = {}
  return s
}

// ===== Torpedo =====

export function addTorpedoSalvo(
  state: ServerCombatState, salvo: ServerTorpedoSalvo
): ServerCombatState {
  const s = clone(state)
  s.torpedoSalvoes.push({ ...salvo })
  return s
}

export interface TickTorpedoResult {
  state: ServerCombatState
  resolved: ServerTorpedoSalvo[]
}

export function tickTorpedoes(state: ServerCombatState): TickTorpedoResult {
  const s = clone(state)
  const resolved: ServerTorpedoSalvo[] = []
  s.torpedoSalvoes = s.torpedoSalvoes.filter(t => {
    t.remainingTurns--
    if (t.remainingTurns <= 0) { resolved.push(t); return false }
    return true
  })
  return { state: s, resolved }
}

// ===== Fighter =====

export function addFighterToken(
  state: ServerCombatState, token: ServerFighterToken
): ServerCombatState {
  const s = clone(state)
  s.fighterTokens.push({ ...token })
  return s
}

export function tickFighters(state: ServerCombatState): ServerCombatState {
  const s = clone(state)
  for (const f of s.fighterTokens) {
    if (f.remainingTurns > 0) f.remainingTurns--
  }
  s.fighterTokens = s.fighterTokens.filter(f => f.remainingTurns > 0)
  return s
}

export function removeFightersByPlayer(
  state: ServerCombatState, slotIndex: number
): ServerCombatState {
  const s = clone(state)
  s.fighterTokens = s.fighterTokens.filter(f => f.sourcePlayerId !== String(slotIndex))
  return s
}

// ===== Effects =====

export function addEffect(
  state: ServerCombatState, effect: ServerActiveEffect
): ServerCombatState {
  const s = clone(state)
  s.activeEffects.push({ ...effect })
  return s
}

export function tickEffects(state: ServerCombatState): ServerCombatState {
  const s = clone(state)
  s.activeEffects = s.activeEffects.filter(e => {
    e.remainingTurns--
    return e.remainingTurns > 0
  })
  return s
}

/** 按 shipId 查找船只 */
export function findShip(
  state: ServerCombatState, shipId: string
): ServerShip | undefined {
  return state.ships.find(s => s.shipId === shipId)
}

// ===== Query Functions =====

export function findCompartment(
  state: ServerCombatState, compId: string
): ServerCompartment | null {
  for (const ship of state.ships) {
    const c = ship.compartments.find(co => co.compId === compId)
    if (c) return c
  }
  return null
}

/** 按 shipId 查找船只 (返回 null 版本) */
export function findShipOrNull(
  state: ServerCombatState, shipId: string
): ServerShip | null {
  return state.ships.find(s => s.shipId === shipId) ?? null
}

export function findShipByComp(
  state: ServerCombatState, compId: string
): ServerShip | null {
  for (const ship of state.ships) {
    if (ship.compartments.some(c => c.compId === compId)) return ship
  }
  return null
}

export function getCompartmentByPosition(
  ship: ServerShip, position: number
): ServerCompartment | null {
  return ship.compartments.find(c => c.position === position) ?? null
}

/** 获取与指定舱段距离 > 0 且 <= distance 的所有舱段 */
export function getAdjacentComps(
  state: ServerCombatState, compId: string, distance: number
): ServerCompartment[] {
  const ship = findShipByComp(state, compId)
  if (!ship) return []
  const comp = findCompartment(state, compId)
  if (!comp) return []
  return ship.compartments.filter(c =>
    c.compId !== compId &&
    Math.abs(c.position - comp.position) > 0 &&
    Math.abs(c.position - comp.position) <= distance
  )
}

export function isCompartmentSmoked(
  state: ServerCombatState, compId: string
): boolean {
  return state.activeEffects.some(
    e => (e.effectType === 'smoke_short' || e.effectType === 'smoke_long') &&
      e.affectedCompartmentIds.includes(compId)
  )
}

export function isShipSunk(
  state: ServerCombatState, shipId: string
): boolean {
  const ship = findShip(state, shipId)
  if (!ship) return false
  return ship.compartments.every(c => c.isDestroyed)
}

export function isTeamDefeated(
  state: ServerCombatState, teamId: string
): boolean {
  const teamShips = state.ships.filter(s => s.teamId === teamId)
  if (teamShips.length === 0) return true
  return teamShips.every(s => isShipSunk(state, s.shipId))
}

export function getCommandsUsed(
  state: ServerCombatState, compId: string
): number {
  return state.commandsUsed[compId] ?? 0
}

export function isTorpedoLoaded(
  state: ServerCombatState, compId: string
): boolean {
  return state.torpedoLoaded[compId] ?? false
}

export function canUseAmmoDepot(
  state: ServerCombatState, compId: string
): boolean {
  return !state.ammoDepotUsed[compId]
}

/** 获取船上的存活舱段列表 (纯查询, 不含随机) */
export function getLivingCompartments(
  state: ServerCombatState, shipId: string
): ServerCompartment[] {
  const ship = findShip(state, shipId)
  if (!ship) return []
  return ship.compartments.filter(c => !c.isDestroyed)
}

/** 按索引获取存活舱段 (逻辑层负责随机; 数据层保持确定) */
export function getLivingCompartmentByIndex(
  state: ServerCombatState, shipId: string, index: number
): ServerCompartment | null {
  const living = getLivingCompartments(state, shipId)
  if (living.length === 0) return null
  return living[index % living.length] ?? null
}

// ===== Destruction =====

export interface DestructionResult {
  state: ServerCombatState
  logs: { message: string; type: string }[]
}

/** 处理击毁后的链式反应。调用前确保 comp.isDestroyed === true */
export function handleDestruction(
  state: ServerCombatState, compId: string
): DestructionResult {
  let s = clone(state)
  const logs: { message: string; type: string }[] = []
  const comp = findCompartment(s, compId)
  if (!comp) return { state: s, logs }

  // 弹药库殉爆
  if (comp.equipmentType === 'ammo_depot') {
    logs.push({ message: '弹药库殉爆! 殉爆8', type: 'destroy' })
    const adj = getAdjacentComps(s, compId, 1)
    for (const ac of adj) {
      const result = applyDamage(s, ac.compId, 8)
      s = result.state
      const acShip = findShipByComp(s, ac.compId)
      const shipName = acShip?.name ?? '?'
      logs.push({
        message: `殉爆 → ${shipName} 第${ac.position + 1}舱段 8伤害${result.destroyed ? ' — 击毁!' : ''}`,
        type: result.destroyed ? 'destroy' : 'damage',
      })
      if (result.destroyed) {
        const next = handleDestruction(s, ac.compId)
        s = next.state
        logs.push(...next.logs)
      }
    }
  }

  // 鱼雷装填状态殉爆
  if (comp.equipmentType === 'quad_torpedo' && isTorpedoLoaded(state, compId)) {
    logs.push({ message: '鱼雷殉爆! 殉爆5', type: 'destroy' })
    const adj = getAdjacentComps(s, compId, 1)
    for (const ac of adj) {
      const result = applyDamage(s, ac.compId, 5)
      s = result.state
      const acShip = findShipByComp(s, ac.compId)
      const shipName = acShip?.name ?? '?'
      logs.push({
        message: `殉爆 → ${shipName} 第${ac.position + 1}舱段 5伤害${result.destroyed ? ' — 击毁!' : ''}`,
        type: result.destroyed ? 'destroy' : 'damage',
      })
      if (result.destroyed) {
        const next = handleDestruction(s, ac.compId)
        s = next.state
        logs.push(...next.logs)
      }
    }
  }

  // 检查舰船沉没
  const ship = findShipByComp(s, compId)
  if (ship && isShipSunk(s, ship.shipId)) {
    logs.push({ message: `${ship.name} 战沉!`, type: 'destroy' })
  }

  return { state: s, logs }
}

// Re-export types for convenience
export type { ServerCombatState, ServerCompartment, ServerShip, ServerFighterToken, ServerTorpedoSalvo, ServerActiveEffect }
