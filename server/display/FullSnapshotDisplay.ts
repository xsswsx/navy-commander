// server/display/FullSnapshotDisplay.ts
import type { IDisplayLayer, DisplayDeps } from './types.js'
import type { ServerCombatState } from '../combatState.js'
import type { ServerRoom } from '../state.js'
import { getRoom } from '../state.js'
import { buildSnapshot } from './snapshotBuilder.js'

export class FullSnapshotDisplay implements IDisplayLayer {
  private io: DisplayDeps['io']

  constructor(deps: DisplayDeps) {
    this.io = deps.io
  }

  pushFullState(roomCode: string, combatState: ServerCombatState, room: ServerRoom): void {
    const snapshot = buildSnapshot(combatState, room)
    this.io.to(roomCode).emit('battle:state', snapshot)
  }

  pushLog(roomCode: string, log: { message: string; type: string }): void {
    const room = getRoom(roomCode)
    if (!room) return
    const entry = { ...log, timestamp: Date.now() }
    room.battleLog.push(entry)
    this.io.to(roomCode).emit('battle:log', entry)
  }

  pushLogs(roomCode: string, logs: { message: string; type: string }[]): void {
    for (const log of logs) {
      this.pushLog(roomCode, log)
    }
  }

  pushPrivate(socketId: string, event: string, payload: any): void {
    this.io.to(socketId).emit(event, payload)
  }

  pushEvent(roomCode: string, event: string, payload: any): void {
    this.io.to(roomCode).emit(event, payload)
  }
}
