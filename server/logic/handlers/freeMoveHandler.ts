// server/logic/handlers/freeMoveHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../combatState.js'
import { movePlayer, findShip, getCompartmentByPosition } from '../../data/CombatState.js'

const FREE_MOVE_RANGE = 2

export function handleFreeMove(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent
): { newState: ServerCombatState; logs: { message: string; type: string }[] } {
  const logs: { message: string; type: string }[] = []

  // 1. 权限
  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs }
  }

  const { toCompId } = intent.payload
  if (!toCompId) {
    logs.push({ message: '缺少目标舱段', type: 'error' })
    return { newState: state, logs }
  }

  const pos = state.playerPositions[slotIndex]
  if (!pos) {
    logs.push({ message: '玩家没有位置', type: 'error' })
    return { newState: state, logs }
  }

  const ship = findShip(state, pos.shipId)
  if (!ship) {
    logs.push({ message: '舰船不存在', type: 'error' })
    return { newState: state, logs }
  }

  const fromComp = getCompartmentByPosition(ship, pos.compIndex)
  const toComp = ship.compartments.find(c => c.compId === toCompId)
  if (!fromComp || !toComp) {
    logs.push({ message: '无效移动目标', type: 'error' })
    return { newState: state, logs }
  }

  const distance = Math.abs(toComp.position - fromComp.position)
  if (distance > FREE_MOVE_RANGE || distance === 0) {
    logs.push({ message: `跑动最多${FREE_MOVE_RANGE}格`, type: 'error' })
    return { newState: state, logs }
  }

  const newState = movePlayer(state, slotIndex, pos.shipId, toComp.position)
  const playerName = room.state.slots[slotIndex]?.playerName || '?'
  logs.push({ message: `${playerName} 跑动到舱段${toComp.position + 1}`, type: 'system' })

  return { newState, logs }
}
