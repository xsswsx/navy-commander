// server/logic/handlers/freeCommandHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState, ServerCompartment, ServerShip } from '../../data/CombatState.js'
import { findShip, getCompartmentByPosition, getCommandsUsed, isFreeActionUsed, markFreeActionUsed, findCompartment } from '../../data/CombatState.js'
import { getEquipment } from '../../../src/game/equipment/registry.js'
import type { DiceRng } from '../rules/dice.js'
import { handleCommand } from './commandHandler.js'

export interface FreeCommandResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
}

export function handleFreeCommand(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent,
  rng: DiceRng
): FreeCommandResult {
  const logs: { message: string; type: string }[] = []

  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs }
  }

  // 每回合限一次自由行动
  if (isFreeActionUsed(state, slotIndex)) {
    return { newState: state, logs: [{ message: '本回合已使用自由行动', type: 'error' }] }
  }

  const pos = state.playerPositions[slotIndex]
  if (!pos) {
    return { newState: state, logs: [{ message: '玩家没有位置', type: 'error' }] }
  }

  const ship = findShip(state, pos.shipId)
  if (!ship) {
    return { newState: state, logs: [{ message: '舰船不存在', type: 'error' }] }
  }

  let comp = getCompartmentByPosition(ship, pos.compIndex)
  if (!comp) {
    return { newState: state, logs: [{ message: '无效舱段', type: 'error' }] }
  }

  // 多舱段：从属重定向到主舱段
  if (comp.multiCompRootId && !comp.equipmentType) {
    const master = ship.compartments.find(c => c.compId === comp!.multiCompRootId)
    if (master && master.equipmentType && !master.isDestroyed) comp = master
  }

  if (!comp.equipmentType || comp.isDestroyed) {
    return { newState: state, logs: [{ message: '当前舱段没有可指挥的军备', type: 'error' }] }
  }

  const eqDef = getEquipment(comp.equipmentType as any)

  // 检查指挥次数
  if (eqDef.commandsPerTurn > 0) {
    const used = getCommandsUsed(state, comp.compId)
    if (used >= eqDef.commandsPerTurn) {
      return { newState: state, logs: [{ message: `本回合已指挥 ${used}/${eqDef.commandsPerTurn} 次`, type: 'error' }] }
    }
  }

  // 构建 targetSelection intent，内部调用 commandHandler 执行
  const { sourceCompId, targetCompId, targetShipId, commandId } = intent.payload
  const finalSourceCompId = sourceCompId || comp.compId

  if (commandId) {
    // 客户端已指定 commandId → 直接执行
    const cmdIntent: ClientIntent = {
      type: 'targetSelection',
      payload: { sourceCompId: finalSourceCompId, commandId, targetCompId, targetShipId },
    }
    const result = handleCommand(state, room, slotIndex, cmdIntent, rng)
    // 自由行动 mark 在 commandHandler 执行之后（防止失败时消耗）
    const newState = markFreeActionUsed(result.newState, slotIndex)
    return { newState, logs: [...logs, ...result.logs] }
  }

  // 客户端未指定 commandId → 自动选择第一个命令
  if (eqDef.commands.length === 0) {
    return { newState: state, logs: [{ message: '此军备没有可执行的指挥', type: 'error' }] }
  }

  // 自目标命令：直接执行
  const firstCmd = eqDef.commands[0]
  if (firstCmd.targeting.scope === 'self') {
    const cmdIntent: ClientIntent = {
      type: 'targetSelection',
      payload: { sourceCompId: finalSourceCompId, commandId: firstCmd.id, targetCompId: finalSourceCompId },
    }
    const result = handleCommand(state, room, slotIndex, cmdIntent, rng)
    const newState = markFreeActionUsed(result.newState, slotIndex)
    return { newState, logs: [...logs, ...result.logs] }
  }

  // 需要目标 → 报错（客户端应提供完整 intent）
  return {
    newState: state,
    logs: [{ message: `${eqDef.name} 需要选择目标，请通过 targetSelection 发送`, type: 'error' }],
  }
}
