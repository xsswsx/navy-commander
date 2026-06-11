// server/logic/handlers/endTurnHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import {
  tickEffects, tickTorpedoes, tickFighters, removeFightersByPlayer,
  resetPerTurn, applyDamage, handleDestruction, findShipByComp,
  isShipSunk,
} from '../../data/CombatState.js'
import type { DiceRng } from '../rules/dice.js'

export interface EndTurnResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  nextSlot: number
  nextRound: number
  winner?: string
}

export function handleEndTurn(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  rng: DiceRng
): EndTurnResult {
  const logs: { message: string; type: string }[] = []

  // 1. 权限检查
  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs, nextSlot: room.currentTurnSlot, nextRound: room.roundNumber }
  }

  // 2. tick effects / torpedoes / fighters
  let s = tickEffects(state)
  s = tickFighters(s)
  const torpResult = tickTorpedoes(s)
  s = torpResult.state

  // 结算鱼雷伤害
  for (const t of torpResult.resolved) {
    for (let i = 0; i < t.torpedoCount; i++) {
      const dmg = rng(10) // 1D10
      const dmgResult = applyDamage(s, t.targetCompartmentId, dmg)
      s = dmgResult.state
      const ship = findShipByComp(s, t.targetCompartmentId)
      const shipName = ship?.name ?? '?'
      const comp = ship?.compartments.find(c => c.compId === t.targetCompartmentId)
      logs.push({
        message: `鱼雷 → ${shipName} 第${(comp?.position ?? 0) + 1}舱段 ${dmg}伤害${dmgResult.destroyed ? ' — 击毁!' : ''}`,
        type: dmgResult.destroyed ? 'destroy' : 'damage',
      })
      if (dmgResult.destroyed) {
        const dest = handleDestruction(s, t.targetCompartmentId)
        s = dest.state
        logs.push(...dest.logs)
      }
    }
  }

  // 3. 移除上一个回合的玩家战斗机
  s = removeFightersByPlayer(s, slotIndex)

  // 4. 重置每回合计数器
  s = resetPerTurn(s)

  // 4.5. 强制弃牌至手牌上限（舰船舱段数）
  const pos = s.playerPositions[slotIndex]
  if (pos) {
    const ship = findShipByComp(s, pos.shipId || '') || s.ships.find(sh => sh.shipId === pos.shipId)
    const maxCards = ship?.compartments.length ?? 5
    const hand = room.playerHands.get(slotIndex) || []
    if (hand.length > maxCards) {
      const discarded = hand.splice(maxCards)
      room.discardPile.push(...discarded)
      room.playerHands.set(slotIndex, hand)
      const endPlayer = room.state.slots[slotIndex]
      logs.push({ message: `${endPlayer?.playerName || '?'} 弃牌至${maxCards}张（手牌上限）`, type: 'system' })
    }
  }

  // 5. 计算下一个回合槽位
  const turnOrder = room.lastBattleInit?.turnOrder || []
  const curIdx = turnOrder.indexOf(room.currentTurnSlot)
  let nextIdx = (curIdx + 1) % turnOrder.length
  let safety = 0
  while (safety < turnOrder.length) {
    const checkSlot = turnOrder[nextIdx]
    const slot = room.state.slots[checkSlot]
    if (slot && slot.playerName && slot.socketId) break
    nextIdx = (nextIdx + 1) % turnOrder.length
    safety++
  }

  const nextRound = nextIdx <= curIdx ? room.roundNumber + 1 : room.roundNumber

  // 6. 检查胜利条件
  const aliveTeams = new Set(
    s.ships.filter(sh => !isShipSunk(s, sh.shipId)).map(sh => sh.teamId)
  )
  let winner: string | undefined
  if (aliveTeams.size <= 1 && aliveTeams.size > 0) {
    winner = [...aliveTeams][0]
  }

  const nextSlotPlayer = room.state.slots[turnOrder[nextIdx]]
  const playerName = nextSlotPlayer?.playerName || '?'

  // 先输出回合结束玩家的日志
  const endPlayer = room.state.slots[slotIndex]
  if (endPlayer?.playerName) {
    logs.unshift({ message: `${endPlayer.playerName} 结束回合`, type: 'system' })
  }

  logs.push({ message: `--- ${playerName} 的回合 (第${nextRound}轮) ---`, type: 'system' })

  return { newState: s, logs, nextSlot: turnOrder[nextIdx], nextRound, winner }
}
