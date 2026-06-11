// server/logic/handlers/freeCommandHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../combatState.js'
import { findShip, getCompartmentByPosition, getCommandsUsed } from '../../data/CombatState.js'
import { getEquipment } from '../../../src/game/equipment/registry.js'

export interface FreeCommandResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  relayTarget?: {
    sourceCompId: string
    relayedCommandId: string
    scope: string
  }
}

export function handleFreeCommand(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent
): FreeCommandResult {
  const logs: { message: string; type: string }[] = []

  if (room.currentTurnSlot !== slotIndex) {
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

  let comp = getCompartmentByPosition(ship, pos.compIndex)
  if (!comp) {
    logs.push({ message: '无效舱段', type: 'error' })
    return { newState: state, logs }
  }

  // 多舱段：从属重定向到主舱段
  if (comp.multiCompRootId && !comp.equipmentType) {
    const master = ship.compartments.find(c => c.compId === comp!.multiCompRootId)
    if (master && master.equipmentType && !master.isDestroyed) comp = master
  }

  if (!comp.equipmentType || comp.isDestroyed) {
    logs.push({ message: '当前舱段没有可指挥的军备', type: 'error' })
    return { newState: state, logs }
  }

  const eqDef = getEquipment(comp.equipmentType)

  // 检查指挥次数
  if (eqDef.commandsPerTurn > 0) {
    const used = getCommandsUsed(state, comp.compId)
    if (used >= eqDef.commandsPerTurn) {
      logs.push({ message: `本回合已指挥 ${used}/${eqDef.commandsPerTurn} 次`, type: 'error' })
      return { newState: state, logs }
    }
  }

  // 如果是中继类装备，返回 relayTarget
  if (['command_room', 'command_center', 'integrated_command'].includes(comp.equipmentType)) {
    return {
      newState: state,
      logs,
      relayTarget: {
        sourceCompId: comp.compId,
        relayedCommandId: eqDef.commands[0]?.id || '',
        scope: eqDef.commands[0]?.targeting.scope || 'own-compartment',
      },
    }
  }

  return {
    newState: state,
    logs: [{ message: `选择 ${eqDef.name} 的目标`, type: 'system' }],
  }
}
