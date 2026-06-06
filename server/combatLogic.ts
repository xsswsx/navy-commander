// ==================== 服务端战斗逻辑层 ====================
// 接收 combat results，应用到数据层，返回新状态和日志

import type {
  ServerCombatState, ServerCompartment, ServerShip,
  ServerFighterToken, ServerTorpedoSalvo, ServerActiveEffect,
} from './combatState.js'

interface OpResult {
  state: ServerCombatState
  logs: { message: string; type: string }[]
}

type DiceOp = (sides: number) => number

export function applyCombatResults(
  state: ServerCombatState,
  results: import('../shared/protocol.js').CombatActionResult[],
  slotIndex: number,
  rollDice: DiceOp,
): OpResult {
  let s: ServerCombatState = JSON.parse(JSON.stringify(state))
  const logs: { message: string; type: string }[] = []

  for (const r of results) {
    switch (r.op) {
      case 'damage': {
        for (const d of r.damages || []) {
          const comp = findComp(s, d.compartmentId)
          if (!comp) continue
          comp.currentHp = Math.max(0, comp.currentHp - d.damage)
          const destroyed = comp.currentHp <= 0
          const ship = findShipByComp(s, d.compartmentId)
          const shipName = ship?.name ?? '?'
          logs.push({
            message: `${r.source || '?'} → ${shipName} 第${comp.position + 1}舱段 ${d.damage}伤害${destroyed ? ' — 击毁!' : ''}`,
            type: destroyed ? 'destroy' : 'damage',
          })
          if (destroyed) {
            comp.isDestroyed = true
            const result = applyDestruction(s, d.compartmentId, logs, rollDice)
            s = result.state
            logs.push(...result.logs)
          }
        }
        break
      }
      case 'addTorpedo': {
        if (r.torpSourceCompId && r.torpTargetCompId) {
          const count = r.torpCount || 0
          const turns = r.torpTurns || 0
          const id = `torp_${++torpCtr}`
          s.torpedoSalvoes.push({ id, sourceCompartmentId: r.torpSourceCompId, targetCompartmentId: r.torpTargetCompId, torpedoCount: count, remainingTurns: turns })
          logs.push({ message: `鱼雷发射! ${count}颗, ${turns}全回合后到达`, type: 'system' })
        }
        break
      }
      case 'addFighter': {
        if (r.fighterShipId && r.fighterTeamId && r.fighterCompId) {
          const id = `fighter_${++tokenCtr}`
          s.fighterTokens.push({ id, shipId: r.fighterShipId, ownerTeamId: r.fighterTeamId, sourceCompartmentId: r.fighterCompId, sourcePlayerId: String(slotIndex), remainingTurns: r.fighterTurns || 0 })
          const shipName = s.ships.find(sh => sh.shipId === r.fighterShipId)?.name ?? r.fighterShipId
          logs.push({ message: `战斗机起飞 → ${shipName}, 空优+2`, type: 'effect' })
        }
        break
      }
      case 'addEffect': {
        if (r.effectType && r.effectSourceCompId) {
          const id = `effect_${++effectCtr}`
          const et = r.effectType === 'smoke_short' ? 'smoke_short' : 'smoke_long'
          s.activeEffects.push({ id, effectType: et as 'smoke_short' | 'smoke_long', sourceCompartmentId: r.effectSourceCompId, affectedCompartmentIds: r.effectAffectedCompIds || [], remainingTurns: r.effectTurns || 0 })
          const shortLabel = r.effectType === 'smoke_short' ? '半' : '全'
          logs.push({ message: `烟幕 (${shortLabel}回合): ${r.effectTurns}回合`, type: 'effect' })
        }
        break
      }
      case 'compHeal': {
        if (r.healCompId) {
          const comp = findComp(s, r.healCompId)
          if (comp) {
            comp.currentHp = Math.min(comp.currentHp + (r.healAmount || 0), comp.maxHp)
            logs.push({ message: `维修 HP+${r.healAmount}`, type: 'effect' })
          }
        }
        break
      }
      case 'move': {
        if (r.toCompIdx != null && s.playerPositions[slotIndex]) {
          s.playerPositions[slotIndex].compIndex = r.toCompIdx
        }
        break
      }
    }
  }

  return { state: s, logs }
}

// ====== 辅助 ======

let torpCtr = 0
let tokenCtr = 0
let effectCtr = 0

function findComp(state: ServerCombatState, compId: string): ServerCompartment | null {
  for (const ship of state.ships) {
    const c = ship.compartments.find(co => co.compId === compId)
    if (c) return c
  }
  return null
}

function findShipByComp(state: ServerCombatState, compId: string): ServerShip | null {
  for (const ship of state.ships) {
    if (ship.compartments.some(c => c.compId === compId)) return ship
  }
  return null
}

function getAdjacentComps(state: ServerCombatState, compId: string, distance: number): ServerCompartment[] {
  const ship = findShipByComp(state, compId)
  if (!ship) return []
  const comp = ship.compartments.find(c => c.compId === compId)
  if (!comp) return []
  return ship.compartments.filter(c => c.compId !== compId && Math.abs(c.position - comp.position) > 0 && Math.abs(c.position - comp.position) <= distance)
}

/** 处理击毁后的链式反应 */
function applyDestruction(
  s: ServerCombatState, compId: string, logs: { message: string; type: string }[],
  rollDice: DiceOp,
): OpResult {
  let state = s
  const comp = findComp(state, compId)
  if (!comp) return { state, logs }

  // 弹药库殉爆
  if (comp.equipmentType === 'ammo_depot') {
    logs.push({ message: '弹药库殉爆! 殉爆8', type: 'destroy' })
    const adj = getAdjacentComps(state, compId, 1)
    for (const ac of adj) {
      ac.currentHp = Math.max(0, ac.currentHp - 8)
      if (ac.currentHp <= 0) {
        ac.isDestroyed = true
        logs.push({ message: `殉爆 → ${findShipByComp(state, ac.compId)?.name ?? '?'} 第${ac.position + 1}舱段 击毁!`, type: 'destroy' })
        // 递归链式反应
        const next = applyDestruction(state, ac.compId, logs, rollDice)
        state = next.state
        logs = next.logs
      }
    }
  }

  // 鱼雷殉爆
  if (comp.equipmentType === 'quad_torpedo') {
    logs.push({ message: '鱼雷殉爆! 殉爆5', type: 'destroy' })
    const adj = getAdjacentComps(state, compId, 1)
    for (const ac of adj) {
      ac.currentHp = Math.max(0, ac.currentHp - 5)
      if (ac.currentHp <= 0) {
        ac.isDestroyed = true
        logs.push({ message: `殉爆 → ${findShipByComp(state, ac.compId)?.name ?? '?'} 第${ac.position + 1}舱段 击毁!`, type: 'destroy' })
      }
    }
  }

  // 检查舰船沉没
  const ship = findShipByComp(state, compId)
  if (ship && ship.compartments.every(c => c.isDestroyed)) {
    logs.push({ message: `${ship.name} 战沉!`, type: 'destroy' })
  }

  return { state, logs }
}

/** tick effects: -1 turn, remove expired */
export function tickEffectsState(state: ServerCombatState): ServerCombatState {
  const s = JSON.parse(JSON.stringify(state)) as ServerCombatState
  s.activeEffects = s.activeEffects.filter(e => {
    e.remainingTurns--
    return e.remainingTurns > 0
  })
  return s
}

/** tick torpedoes: -1 turn, return resolved ones + new state */
export function tickTorpedoesState(state: ServerCombatState, rollDice: DiceOp): {
  state: ServerCombatState
  resolved: ServerTorpedoSalvo[]
  logs: { message: string; type: string }[]
} {
  const s = JSON.parse(JSON.stringify(state)) as ServerCombatState
  const resolved: ServerTorpedoSalvo[] = []
  const logs: { message: string; type: string }[] = []
  s.torpedoSalvoes = s.torpedoSalvoes.filter(t => {
    t.remainingTurns--
    if (t.remainingTurns <= 0) {
      resolved.push(t)
      return false
    }
    return true
  })
  // 结算鱼雷伤害
  for (const t of resolved) {
    for (let i = 0; i < t.torpedoCount; i++) {
      const dmg = rollDice(10)
      const comp = findComp(s, t.targetCompartmentId)
      if (comp) {
        comp.currentHp = Math.max(0, comp.currentHp - dmg)
        const destroyed = comp.currentHp <= 0
        const ship = findShipByComp(s, t.targetCompartmentId)
        const shipName = ship?.name ?? '?'
        logs.push({ message: `鱼雷 → ${shipName} 第${comp.position + 1}舱段 ${dmg}伤害${destroyed ? ' — 击毁!' : ''}`, type: destroyed ? 'destroy' : 'damage' })
        if (destroyed) {
          comp.isDestroyed = true
          const result = applyDestruction(s, t.targetCompartmentId, logs, rollDice)
          Object.assign(s, result.state)
          logs.push(...result.logs)
        }
      }
    }
  }
  return { state: s, resolved, logs }
}

/** tick fighter turns: -1 turn, remove expired */
export function tickFightersState(state: ServerCombatState): ServerCombatState {
  const s = JSON.parse(JSON.stringify(state)) as ServerCombatState
  s.fighterTokens = s.fighterTokens.filter(f => {
    if (f.remainingTurns > 0) f.remainingTurns--
    return f.remainingTurns > 0
  })
  return s
}

/** remove fighters by player (their turn begins again) */
export function removeFightersByPlayerState(state: ServerCombatState, slotIndex: number): ServerCombatState {
  const s = JSON.parse(JSON.stringify(state)) as ServerCombatState
  s.fighterTokens = s.fighterTokens.filter(f => f.sourcePlayerId !== String(slotIndex))
  return s
}

/** 重置每回合计数器 */
export function resetPerTurnState(state: ServerCombatState): ServerCombatState {
  const s = JSON.parse(JSON.stringify(state)) as ServerCombatState
  s.commandsUsed = {}
  s.sortiesUsed = {}
  s.ammoDepotUsed = {}
  return s
}
