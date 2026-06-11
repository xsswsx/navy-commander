// server/display/types.ts
import type { Server } from 'socket.io'
import type { ServerCombatState } from '../combatState.js'
import type { ServerRoom } from '../state.js'

export interface IDisplayLayer {
  pushFullState(roomCode: string, combatState: ServerCombatState, room: ServerRoom): void
  pushLog(roomCode: string, log: { message: string; type: string }): void
  pushLogs(roomCode: string, logs: { message: string; type: string }[]): void
  pushPrivate(socketId: string, event: string, payload: any): void
  pushEvent(roomCode: string, event: string, payload: any): void
}

export interface DisplayDeps {
  io: Server
}
