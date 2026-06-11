// server/logic/intentRouter.ts
import type { ServerRoom } from '../state.js'
import type { ClientIntent } from '../../shared/protocol.js'
import type { ServerCombatState } from '../data/CombatState.js'
import type { DiceRng } from './rules/dice.js'
import { handleSpawn } from './handlers/spawnHandler.js'
import { handleEndTurn } from './handlers/endTurnHandler.js'
import { handleFreeMove } from './handlers/freeMoveHandler.js'
import { handleFreeCommand } from './handlers/freeCommandHandler.js'
import { handleCommand } from './handlers/commandHandler.js'

export interface IntentResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  turnChange?: { nextSlot: number; newRound: number }
  winner?: string
  privatePayload?: any
}

export function handleIntent(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent,
  rng: DiceRng
): IntentResult {
  let s = state
  const allLogs: { message: string; type: string }[] = []

  switch (intent.type) {
    case 'spawn': {
      const result = handleSpawn(s, room, slotIndex, intent)
      s = result.newState
      allLogs.push(...result.logs)
      if (result.spawnComplete) {
        const turnOrder = room.lastBattleInit?.turnOrder || []
        const nextSlot = turnOrder[0] ?? 0
        return { newState: s, logs: allLogs, turnChange: { nextSlot, newRound: 1 } }
      }
      return { newState: s, logs: allLogs }
    }

    case 'endTurn': {
      const result = handleEndTurn(s, room, slotIndex, rng)
      return {
        newState: result.newState,
        logs: [...allLogs, ...result.logs],
        turnChange: { nextSlot: result.nextSlot, newRound: result.nextRound },
        winner: result.winner,
      }
    }

    case 'freeMove': {
      const result = handleFreeMove(s, room, slotIndex, intent)
      return { newState: result.newState, logs: [...allLogs, ...result.logs] }
    }

    case 'freeCommand': {
      const result = handleFreeCommand(s, room, slotIndex, intent)
      return {
        newState: result.newState,
        logs: [...allLogs, ...result.logs],
        privatePayload: result.relayTarget,
      }
    }

    case 'targetSelection': {
      const result = handleCommand(s, room, slotIndex, intent, rng)
      return {
        newState: result.newState,
        logs: [...allLogs, ...result.logs],
        winner: result.winner,
      }
    }

    default:
      return { newState: s, logs: [{ message: `未知意图: ${intent.type}`, type: 'error' }] }
  }
}
