// server/logic/handlers/spawnHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../combatState.js'
import { movePlayer } from '../../data/CombatState.js'

export interface SpawnResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  spawnComplete: boolean
}

export function handleSpawn(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent
): SpawnResult {
  const logs: { message: string; type: string }[] = []

  // 1. 权限检查
  const currentSpawnSlot = room.spawnOrder[room.spawnIndex]
  if (currentSpawnSlot !== slotIndex) {
    return { newState: state, logs: [{ message: '还没轮到你选出生点', type: 'error' }], spawnComplete: false }
  }

  // 如果已出生，跳过
  if (room.spawns.has(slotIndex)) {
    return { newState: state, logs, spawnComplete: false }
  }

  const { shipId, compartmentId } = intent.payload
  const compMatch = compartmentId?.match(/_comp_(\d+)$/)
  const compIndex = compMatch ? parseInt(compMatch[1]) : 0
  const finalShipId = shipId || ''

  // 2. 规则验证：舱段必须属于该玩家的队伍
  const slot = room.state.slots[slotIndex]
  if (!slot) {
    return { newState: state, logs: [{ message: '无效槽位', type: 'error' }], spawnComplete: false }
  }

  // 验证 shipId 属于该队伍
  if (!finalShipId.startsWith(slot.teamId)) {
    return { newState: state, logs: [{ message: '不能出生在敌方舰船', type: 'error' }], spawnComplete: false }
  }

  // 3. 执行：更新 spawns map 和数据层玩家位置
  room.spawns.set(slotIndex, { shipId: finalShipId, compIndex })
  room.spawnIndex++

  const newState = movePlayer(state, slotIndex, finalShipId, compIndex)
  const playerName = slot.playerName || '?'
  logs.push({
    message: `${playerName} 选择出生点 — ${finalShipId} 舱段${compIndex + 1}`,
    type: 'system',
  })

  // 检查是否所有人都已出生
  const occupiedSlots = room.state.slots.filter(s => s.playerName).map(s => s.index)
  const allSpawned = occupiedSlots.every(idx => room.spawns.has(idx))

  return { newState, logs, spawnComplete: allSpawned }
}
